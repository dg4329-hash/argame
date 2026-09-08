// Hand-swipe gesture controller built on MediaPipe HandLandmarker.
//
// Pipeline per video frame:
//   detectForVideo → palm center (lm 0,5,9,13,17) → mirror x → EMA smooth
//   → push into ~300ms history → measure displacement over the window
//   → fire SwipeEvent when displacement is big enough and clearly axis-aligned
//   → cooldown + return-motion suppression so one physical gesture = one swipe.
//
// All coordinates handled here are MIRRORED normalized units (0..1), i.e. the
// user sees themselves as in a mirror: moving the hand physically to the right
// moves the tracked point to screen-right and produces a "right" swipe.

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { Dir, SwipeEvent, TrackerStatus } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

/** Where the MediaPipe wasm runtime is fetched from. */
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";
/** Hand landmark model (served from /public). */
const MODEL_PATH = "/models/hand_landmarker.task";

/** Requested camera stream. */
const CAM_WIDTH = 640;
const CAM_HEIGHT = 480;
const CAM_FPS = 30;

/** EMA factor applied to the palm point before it enters the history (1 = no smoothing). */
const EMA_ALPHA = 0.5;
/** How far back (ms) the position history reaches when measuring a swipe. */
const HISTORY_MS = 300;
/** Minimum displacement (normalized units) over the window to count as a swipe. */
const SWIPE_MIN_DISP = 0.18;
/** Dominant axis must be at least this many times the other axis (rejects diagonals). */
const AXIS_RATIO = 1.6;
/** Minimum time span (ms) the window must cover before a swipe can be evaluated. */
const MIN_WINDOW_MS = 60;

/** After a swipe, no new swipe until this expires OR the hand goes stationary. */
const COOLDOWN_MS = 450;
/** Instantaneous speed (units/s) below which the hand counts as stationary. */
const STATIONARY_SPEED = 0.25;
/** The hand must stay stationary this long (ms) to re-arm before the cooldown ends. */
const STATIONARY_MS = 80;

/** After a swipe, the OPPOSITE direction is suppressed for this long (ms)... */
const RETURN_SUPPRESS_MS = 600;
/** ...unless the return is at least this many times larger than the swipe's peak displacement... */
const RETURN_OVERRIDE_DISP_RATIO = 1.35;
/** ...and at least this many times faster than the swipe's peak speed. */
const RETURN_OVERRIDE_SPEED_RATIO = 1.15;

/** Preview: how long (ms) the swipe arrow/flash stays visible. */
const FLASH_MS = 400;

// Lower than MediaPipe's 0.5 defaults: momentary track loss feels worse than a bit of drift.
const MIN_DETECTION_CONF = 0.45;
const MIN_PRESENCE_CONF = 0.45;
const MIN_TRACKING_CONF = 0.45;

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

const PALM_LANDMARKS = [0, 5, 9, 13, 17];
const FINGERTIPS = new Set([4, 8, 12, 16, 20]);
const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [0, 5], [5, 9], [9, 13], [13, 17], [0, 17],
  [1, 2], [2, 3], [3, 4],
  [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [17, 18], [18, 19], [19, 20],
];

const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

interface Sample { x: number; y: number; t: number }

interface WindowMotion {
  dx: number;
  dy: number;
  /** Displacement along the dominant axis (absolute). */
  disp: number;
  /** disp / window duration, in normalized units per second. */
  speed: number;
  /** Direction of the dominant axis, or null if no clear axis. */
  dir: Dir | null;
  /** Whether the dominant axis clearly dominates the other one. */
  axisClear: boolean;
}

interface LastSwipe {
  dir: Dir;
  ts: number;
  /** Peak window displacement/speed observed during the swipe (updated through the cooldown). */
  peakDisp: number;
  peakSpeed: number;
}

interface Flash { dir: Dir; ts: number; x: number; y: number }

/** Arrow glyph for a direction, for HUD use. */
export function dirLabel(d: Dir): string {
  switch (d) {
    case "up": return "↑";
    case "down": return "↓";
    case "left": return "←";
    case "right": return "→";
  }
}

export class GestureController {
  status: TrackerStatus = "idle";
  errorMessage: string | null = null;
  handVisible = false;

  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private lastVideoTime = -1;

  private swipeCbs = new Set<(e: SwipeEvent) => void>();
  private statusCbs = new Set<(s: TrackerStatus) => void>();

  // Swipe state
  private smoothed: { x: number; y: number } | null = null;
  private history: Sample[] = [];
  private armed = true;
  private lastSwipe: LastSwipe | null = null;
  private stationarySince: number | null = null;

  // Preview state
  private lastLandmarks: NormalizedLandmark[] | null = null;
  private flash: Flash | null = null;

  constructor(video: HTMLVideoElement, previewCanvas: HTMLCanvasElement) {
    this.video = video;
    this.canvas = previewCanvas;
    const ctx = previewCanvas.getContext("2d");
    if (!ctx) throw new Error("Could not get a 2D context for the preview canvas.");
    this.ctx = ctx;
    this.video.addEventListener("loadedmetadata", this.sizeCanvas);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Start the camera, load the model, and begin the rAF loop. Resolves when ready. */
  async init(): Promise<void> {
    if (this.status === "loading" || this.status === "ready") return;
    this.errorMessage = null;
    this.setStatus("loading");

    try {
      await this.startCamera();
    } catch (err) {
      this.fail(cameraErrorMessage(err));
      throw err;
    }

    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: MIN_DETECTION_CONF,
        minHandPresenceConfidence: MIN_PRESENCE_CONF,
        minTrackingConfidence: MIN_TRACKING_CONF,
      });
    } catch (err) {
      this.stopCamera();
      this.fail(
        "Could not load the hand-tracking model. Check your connection and that " +
          MODEL_PATH + " is being served. (" + errString(err) + ")",
      );
      throw err;
    }

    this.resetSwipeState();
    this.setStatus("ready");
    this.lastVideoTime = -1;
    cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(this.loop);
  }

  onSwipe(cb: (e: SwipeEvent) => void): () => void {
    this.swipeCbs.add(cb);
    return () => { this.swipeCbs.delete(cb); };
  }

  onStatus(cb: (s: TrackerStatus) => void): () => void {
    this.statusCbs.add(cb);
    return () => { this.statusCbs.delete(cb); };
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.stopCamera();
    if (this.landmarker) {
      try { this.landmarker.close(); } catch { /* ignore */ }
      this.landmarker = null;
    }
    this.resetSwipeState();
    this.lastLandmarks = null;
    this.flash = null;
    this.handVisible = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.status !== "error") this.setStatus("idle");
  }

  // ── Setup helpers ──────────────────────────────────────────────────────────

  private async startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia is not available (camera requires HTTPS or localhost).");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: CAM_WIDTH },
        height: { ideal: CAM_HEIGHT },
        frameRate: { ideal: CAM_FPS },
        facingMode: "user",
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.sizeCanvas();
  }

  private stopCamera(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.video.srcObject) this.video.srcObject = null;
  }

  private sizeCanvas = (): void => {
    const w = this.video.videoWidth || CAM_WIDTH;
    const h = this.video.videoHeight || CAM_HEIGHT;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  };

  private setStatus(s: TrackerStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  private fail(message: string): void {
    this.errorMessage = message;
    this.setStatus("error");
  }

  private resetSwipeState(): void {
    this.smoothed = null;
    this.history = [];
    this.armed = true;
    this.lastSwipe = null;
    this.stationarySince = null;
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.landmarker || this.video.readyState < 2) return;

    const now = performance.now();
    let advanced = false;
    if (this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      advanced = true;
      let result: HandLandmarkerResult | null = null;
      try {
        result = this.landmarker.detectForVideo(this.video, now);
      } catch (err) {
        console.warn("[gestures] detectForVideo failed", err);
      }
      if (result) this.processResult(result, now);
    }

    if (advanced || this.flash) this.draw(now);
  };

  private processResult(result: HandLandmarkerResult, now: number): void {
    const lm = result.landmarks?.[0];
    if (!lm || lm.length < 21) {
      this.onHandLost();
      return;
    }
    this.handVisible = true;
    this.lastLandmarks = lm;

    // Palm center in mirrored normalized coords.
    let px = 0, py = 0;
    for (const i of PALM_LANDMARKS) { px += lm[i].x; py += lm[i].y; }
    px = 1 - px / PALM_LANDMARKS.length;
    py = py / PALM_LANDMARKS.length;

    // EMA smoothing.
    if (!this.smoothed) {
      this.smoothed = { x: px, y: py };
    } else {
      this.smoothed.x += EMA_ALPHA * (px - this.smoothed.x);
      this.smoothed.y += EMA_ALPHA * (py - this.smoothed.y);
    }

    this.pushSample(this.smoothed.x, this.smoothed.y, now);
    this.updateSwipe(now);
  }

  private onHandLost(): void {
    this.handVisible = false;
    this.lastLandmarks = null;
    this.smoothed = null;
    this.history = [];
    this.stationarySince = null;
  }

  private pushSample(x: number, y: number, t: number): void {
    this.history.push({ x, y, t });
    const cutoff = t - HISTORY_MS;
    // Keep one sample at or before the cutoff so the window spans the full HISTORY_MS.
    while (this.history.length > 2 && this.history[1].t <= cutoff) this.history.shift();
  }

  // ── Swipe detection ────────────────────────────────────────────────────────

  private updateSwipe(now: number): void {
    const motion = this.measureWindow();
    const stationary = this.updateStationary(now);

    if (!this.armed && this.lastSwipe) {
      // While cooling down, keep tracking how big/fast the original swipe really was,
      // so the return motion is compared against its peak rather than the trigger threshold.
      if (motion && motion.dir === this.lastSwipe.dir) {
        this.lastSwipe.peakDisp = Math.max(this.lastSwipe.peakDisp, motion.disp);
        this.lastSwipe.peakSpeed = Math.max(this.lastSwipe.peakSpeed, motion.speed);
      }
      const cooled = now - this.lastSwipe.ts >= COOLDOWN_MS;
      if (cooled || stationary) {
        this.armed = true;
        // Start a fresh window so the tail of the same motion can't re-trigger.
        const last = this.history[this.history.length - 1];
        this.history = last ? [last] : [];
      }
      return;
    }

    if (!motion || !motion.dir || !motion.axisClear) return;
    if (motion.disp < SWIPE_MIN_DISP) return;

    // Return-motion suppression: the hand coming back after a swipe.
    const prev = this.lastSwipe;
    if (
      prev &&
      motion.dir === OPPOSITE[prev.dir] &&
      now - prev.ts < RETURN_SUPPRESS_MS
    ) {
      const clearlyBigger =
        motion.disp >= prev.peakDisp * RETURN_OVERRIDE_DISP_RATIO &&
        motion.speed >= prev.peakSpeed * RETURN_OVERRIDE_SPEED_RATIO;
      if (!clearlyBigger) return;
    }

    this.fire(motion.dir, motion, now);
  }

  /** Displacement over the current history window, or null if the window is too short. */
  private measureWindow(): WindowMotion | null {
    const n = this.history.length;
    if (n < 2) return null;
    const a = this.history[0];
    const b = this.history[n - 1];
    const dt = b.t - a.t;
    if (dt < MIN_WINDOW_MS) return null;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const horizontal = ax >= ay;
    const disp = horizontal ? ax : ay;
    const other = horizontal ? ay : ax;
    const dir: Dir = horizontal ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    return {
      dx,
      dy,
      disp,
      speed: disp / (dt / 1000),
      dir: disp > 0 ? dir : null,
      axisClear: disp >= AXIS_RATIO * other,
    };
  }

  /** Tracks whether the hand has been (nearly) still for STATIONARY_MS. */
  private updateStationary(now: number): boolean {
    const n = this.history.length;
    if (n < 2) { this.stationarySince = null; return false; }
    const a = this.history[n - 2];
    const b = this.history[n - 1];
    const dt = Math.max(1, b.t - a.t) / 1000;
    const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;
    if (speed < STATIONARY_SPEED) {
      if (this.stationarySince === null) this.stationarySince = now;
      return now - this.stationarySince >= STATIONARY_MS;
    }
    this.stationarySince = null;
    return false;
  }

  private fire(dir: Dir, motion: WindowMotion, now: number): void {
    this.armed = false;
    this.stationarySince = null;
    this.lastSwipe = { dir, ts: now, peakDisp: motion.disp, peakSpeed: motion.speed };

    const p = this.smoothed ?? { x: 0.5, y: 0.5 };
    this.flash = { dir, ts: now, x: p.x, y: p.y };

    const ev: SwipeEvent = { dir, speed: motion.speed, ts: now };
    for (const cb of this.swipeCbs) cb(ev);
  }

  // ── Preview drawing ────────────────────────────────────────────────────────

  private draw(now: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (w === 0 || h === 0) return;

    // Mirrored video.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.restore();

    const lm = this.lastLandmarks;
    if (lm) {
      // Connections
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(34, 211, 238, 0.85)";
      ctx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        ctx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
        ctx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
      }
      ctx.stroke();

      // Landmarks
      for (let i = 0; i < lm.length; i++) {
        const tip = FINGERTIPS.has(i);
        ctx.fillStyle = tip ? "#ffffff" : "#22d3ee";
        ctx.beginPath();
        ctx.arc((1 - lm[i].x) * w, lm[i].y * h, tip ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Palm point
      if (this.smoothed) {
        const cx = this.smoothed.x * w;
        const cy = this.smoothed.y * h;
        ctx.save();
        ctx.shadowColor = "#22d3ee";
        ctx.shadowBlur = 14;
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Swipe flash
    if (this.flash) {
      const age = now - this.flash.ts;
      if (age >= FLASH_MS) {
        this.flash = null;
      } else {
        this.drawFlash(this.flash, 1 - age / FLASH_MS, w, h);
      }
    }
  }

  private drawFlash(f: Flash, alpha: number, w: number, h: number): void {
    const ctx = this.ctx;
    const dx = f.dir === "right" ? 1 : f.dir === "left" ? -1 : 0;
    const dy = f.dir === "down" ? 1 : f.dir === "up" ? -1 : 0;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Edge band on the side the hand moved toward.
    const band = Math.round(Math.min(w, h) * 0.08);
    const grad =
      dx !== 0
        ? ctx.createLinearGradient(dx > 0 ? w - band : band, 0, dx > 0 ? w : 0, 0)
        : ctx.createLinearGradient(0, dy > 0 ? h - band : band, 0, dy > 0 ? h : 0);
    grad.addColorStop(0, "rgba(34, 211, 238, 0)");
    grad.addColorStop(1, "rgba(34, 211, 238, 0.85)");
    ctx.fillStyle = grad;
    if (dx > 0) ctx.fillRect(w - band, 0, band, h);
    else if (dx < 0) ctx.fillRect(0, 0, band, h);
    else if (dy > 0) ctx.fillRect(0, h - band, w, band);
    else ctx.fillRect(0, 0, w, band);

    // Arrow from where the swipe fired, pointing in the swipe direction.
    const len = Math.min(w, h) * 0.22;
    const head = len * 0.35;
    const sx = f.x * w;
    const sy = f.y * h;
    const ex = sx + dx * len;
    const ey = sy + dy * len;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "#22d3ee";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    // Arrowhead: two strokes at ±45° back from the tip.
    const px = -dy, py = dx; // perpendicular
    ctx.moveTo(ex - dx * head + px * head * 0.7, ey - dy * head + py * head * 0.7);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex - dx * head - px * head * 0.7, ey - dy * head - py * head * 0.7);
    ctx.stroke();
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error helpers
// ─────────────────────────────────────────────────────────────────────────────

function errString(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Camera access was denied. Allow camera permission for this site and reload.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect a webcam and reload.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is in use by another app or could not be started.";
    case "OverconstrainedError":
      return "The camera does not support the requested resolution.";
    default:
      return "Could not start the camera: " + errString(err);
  }
}
