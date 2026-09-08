// Canvas renderer: GBA-style hedge maze + procedurally drawn pixel trainer.
// Everything is authored in "art pixels" (one art pixel = `unit` device pixels, integer)
// so the result stays crisp at any devicePixelRatio.

import type { Dir, Maze, Point, MoveResult } from "./types";
import { DIR_DELTA } from "./types";

// ---------- Art-space constants ----------
const TILE = 20;            // art px per maze cell
const WT = 6;               // hedge thickness (centered on cell edges)
const HALF_WT = WT / 2;
const PAD = 4;              // art px of ground around the maze
const SPR_W = 16;           // trainer sprite width
const BODY_H = 16;          // trainer body rows
const LEGS_H = 6;           // trainer leg rows
const SPR_H = BODY_H + LEGS_H;
const MOVE_MS = 180;
const BUMP_MS = 120;
const MAX_UNIT = 10;        // cap on device px per art px
const STAGE_MARGIN_CSS = 12; // breathing room inside the container (CSS px)

// ---------- Palette ----------
const C = {
  ground: "#0f1a12",
  grass: "#78c058",
  grassDark: "#64ac48",
  grassLight: "#94d46c",
  hedgeOutline: "#183a1e",
  hedgeHi: "#74c858",
  hedgeMidHi: "#50a844",
  hedgeMid: "#3c8c38",
  hedgeShade: "#2c6c30",
  sand: "#e8d090",
  sandDark: "#b89858",
  sandLight: "#f8ecb8",
  glow: "#f8f080",
  sparkA: "#fff8c0",
  sparkB: "#f8d048",
};

/** Character/prop pixel palette: one char per color, "." = transparent. */
const PAL: Record<string, string> = {
  o: "#1c1420", // outline
  h: "#d84040", // hat
  H: "#f47878", // hat highlight
  w: "#f8f8f8", // white (hat brim)
  s: "#f8c8a0", // skin
  S: "#d09068", // skin shade
  e: "#202038", // eyes
  k: "#583018", // hair
  j: "#f09030", // jacket
  J: "#c06018", // jacket shade
  b: "#f8d048", // bag
  B: "#c8a030", // bag shade
  p: "#3858a0", // pants
  P: "#284078", // pants shade
  f: "#282030", // shoes
  r: "#e83838", // item ball red
  R: "#ff8080", // item ball shine
};

// ---------- Trainer sprite matrices (16 wide) ----------
// Body = rows 0..15, legs = rows 16..21. Right-facing = mirrored left-facing.
const BODY_DOWN = [
  "......oooo......",
  "....oohhhhoo....",
  "...ohhhHhhhhho..",
  "..ohhhHhhhhhhho.",
  "..ohhhhhhhhhhho.",
  ".owwwwwwwwwwwwo.",
  "..okkkssssskkko.",
  "..oksessssesko..",
  "..oksessssesko..",
  "...ossssssssso..",
  "....oSSSSSSSo...",
  "...ojjjjjjjjjo..",
  "..ojjJjjjjjJjjo.",
  "..ojjjjjjjjjjjo.",
  "..osjJJJJJJJjso.",
  "..ooJJJJJJJJJoo.",
];

const BODY_UP = [
  "......oooo......",
  "....oohhhhoo....",
  "...ohhhhhhhhho..",
  "..ohhhhhhhhhhho.",
  "..ohhhhhhhhhhho.",
  ".owwwwwwwwwwwwo.",
  "..okkkkkkkkkkko.",
  "..okkkkkkkkkkko.",
  "..okkkkkkkkkkko.",
  "...okkkkkkkkko..",
  "....oSSSSSSSo...",
  "...ojjjjjjjjjo..",
  "..ojjobbbbbojjo.",
  "..ojjobBBBbojjo.",
  "..osjobbbbbojso.",
  "..ooJJoooooJJoo.",
];

// Facing left: face on the left, hair/bag on the right.
const BODY_SIDE = [
  "......oooo......",
  "....oohhhhoo....",
  "...ohhhhhhhhho..",
  "..ohhHhhhhhhhho.",
  "..ohhhhhhhhhhho.",
  "owwwwwwwwwwwwo..",
  ".osssssskkkkkko.",
  ".osesssskkkkkko.",
  ".osesssskkkkkko.",
  "..osssssskkkkko.",
  "...oSSSSSSSo....",
  "...ojjjjjjjjjo..",
  "..ojjjjjjjjjbbo.",
  "..ojjjjjjjjjbbo.",
  "..ojsjjjjjjjbbo.",
  "..ooJJJJJJJJJoo.",
];

const LEGS_FRONT_STAND = [
  "....oppppppppo..",
  "....opppoopppo..",
  "....oppo..oppo..",
  "....oPPo..oPPo..",
  "....offo..offo..",
  "....oooo..oooo..",
];

const LEGS_FRONT_WALK = [
  "....oppppppppo..",
  "....opppoopppo..",
  "....oppo..oppo..",
  "....oPPo..offo..",
  "....offo..oooo..",
  "....oooo........",
];

const LEGS_SIDE_STAND = [
  "....oppppppppo..",
  "....oppppppppo..",
  ".....oppppppo...",
  ".....oPPPPPPo...",
  "....offfffffo...",
  "....ooooooooo...",
];

const LEGS_SIDE_WALK_A = [
  "....oppppppppo..",
  "....oppppppppo..",
  "...opppoooppppo.",
  "...oPPo..oPPPo..",
  "..offfo..offfo..",
  "..ooooo..ooooo..",
];

const LEGS_SIDE_WALK_B = [
  "....oppppppppo..",
  "....oppppppppo..",
  "....opppppppo...",
  "....oPPPPPPo....",
  "...offffffo.....",
  "...ooooooo......",
];

/** Exit marker: a sparkling item ball (10x9). */
const ITEM_BALL = [
  "...oooo...",
  ".oorrrroo.",
  ".orRrrrro.",
  "orrRrrrrro",
  "oooooooooo",
  "oowwwwwwoo",
  ".owwwwwwo.",
  ".oowwwwoo.",
  "...oooo...",
];

type Frame = "stand" | "a" | "b";

type Anim =
  | { kind: "move"; from: Point; to: Point; t: number; dur: number }
  | { kind: "bump"; at: Point; dir: Dir; t: number; dur: number };

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
}

// ---------- Small helpers ----------
type RGB = [number, number, number];
function hex(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Deterministic 0..1 hash for texture variation. */
function hash2(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function mirrorRows(rows: string[]): string[] {
  return rows.map((r) => r.split("").reverse().join(""));
}

function paintMatrix(rows: string[]): HTMLCanvasElement {
  const h = rows.length;
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

const spriteCache = new Map<string, HTMLCanvasElement>();
let ballCanvas: HTMLCanvasElement | null = null;

function spriteFor(facing: Dir, frame: Frame): HTMLCanvasElement {
  const key = `${facing}:${frame}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  let body: string[];
  let legs: string[];
  let mirror = false;
  if (facing === "down" || facing === "up") {
    body = facing === "down" ? BODY_DOWN : BODY_UP;
    legs = frame === "stand" ? LEGS_FRONT_STAND : frame === "a" ? LEGS_FRONT_WALK : mirrorRows(LEGS_FRONT_WALK);
  } else {
    body = BODY_SIDE;
    legs = frame === "stand" ? LEGS_SIDE_STAND : frame === "a" ? LEGS_SIDE_WALK_A : LEGS_SIDE_WALK_B;
    mirror = facing === "right";
  }
  let rows = body.concat(legs);
  if (mirror) rows = mirrorRows(rows);
  const canvas = paintMatrix(rows);
  spriteCache.set(key, canvas);
  return canvas;
}

function ballSprite(): HTMLCanvasElement {
  if (!ballCanvas) ballCanvas = paintMatrix(ITEM_BALL);
  return ballCanvas;
}

// ---------- Renderer ----------
export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly container: HTMLElement;
  private readonly staticCanvas: HTMLCanvasElement;

  private maze: Maze | null = null;
  private unit = 1;
  private dpr = 1;
  private artW = TILE;
  private artH = TILE;
  private lastCW = -1;
  private lastCH = -1;

  private pos: Point = { x: 0, y: 0 };  // resting cell
  private facing: Dir = "down";
  private anim: Anim | null = null;
  private stepParity = 0;
  private time = 0;

  private particles: Particle[] = [];
  private emitT = 0;
  private hopT = -1;

  // Finger pointer + trail (canvas px).
  private pointer: { x: number; y: number } | null = null;
  private trail: { x: number; y: number; t: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.container = (canvas.parentElement as HTMLElement | null) ?? document.body;
    this.staticCanvas = document.createElement("canvas");
    this.computeSize();
  }

  /** Install a maze; resets animation state and re-fits the canvas to its container. */
  setMaze(maze: Maze, player: Point, facing: Dir): void {
    this.maze = maze;
    this.pos = { x: player.x, y: player.y };
    this.facing = facing;
    this.anim = null;
    this.particles = [];
    this.emitT = 0;
    this.hopT = -1;
    this.resize();
  }

  /**
   * Called on every attempted move. ok -> slide from->to (~180ms) with walk cycle;
   * blocked -> short bump toward the wall (~120ms). Always faces result.dir.
   */
  applyMove(result: MoveResult): void {
    this.facing = result.dir;
    // Snap any in-flight movement so rapid input never lags behind the model.
    if (this.anim && this.anim.kind === "move") this.pos = { ...this.anim.to };
    if (result.ok) {
      this.stepParity ^= 1;
      this.pos = { x: result.from.x, y: result.from.y };
      this.anim = { kind: "move", from: { ...result.from }, to: { ...result.to }, t: 0, dur: MOVE_MS };
    } else {
      this.pos = { x: result.from.x, y: result.from.y };
      this.anim = { kind: "bump", at: { ...result.from }, dir: result.dir, t: 0, dur: BUMP_MS };
    }
  }

  /** Draw one frame. dt in seconds. Call from a requestAnimationFrame loop. */
  frame(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.1);
    this.time += dt;

    // Auto-detect container size changes (cheap layout read).
    if (this.container.clientWidth !== this.lastCW || this.container.clientHeight !== this.lastCH) {
      this.resize();
    }

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    if (!this.maze) {
      ctx.fillStyle = C.ground;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    this.tickAnim(dt);
    ctx.drawImage(this.staticCanvas, 0, 0);
    this.drawExit();
    this.drawPlayer();
    this.tickParticles(dt);
    this.drawPointer(dt);
  }

  /** True while the character is sliding/bumping (caller should wait before issuing the next step). */
  isAnimating(): boolean {
    return this.anim !== null;
  }

  /** Update the finger pointer from normalized (0..1) coords over the canvas; pass visible=false to hide. */
  setPointer(nx: number, ny: number, visible: boolean): void {
    if (!visible) { this.pointer = null; return; }
    const x = nx * this.canvas.width, y = ny * this.canvas.height;
    this.pointer = { x, y };
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > this.unit * 1.5) this.trail.push({ x, y, t: this.time });
  }

  /** Convert normalized (0..1) canvas coords into continuous cell coords (cell centers at n + 0.5). */
  normToCell(nx: number, ny: number): { cx: number; cy: number } {
    const u = this.unit;
    return {
      cx: (nx * this.canvas.width / u - PAD) / TILE,
      cy: (ny * this.canvas.height / u - PAD) / TILE,
    };
  }

  private drawPointer(dt: number): void {
    const ctx = this.ctx;
    const u = this.unit;
    const LIFE = 0.7;
    this.trail = this.trail.filter((p) => this.time - p.t < LIFE);
    if (this.trail.length > 1) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        const age = (this.time - b.t) / LIFE;
        ctx.strokeStyle = `rgba(255, 236, 120, ${(1 - age) * 0.85})`;
        ctx.lineWidth = Math.max(1, (1 - age) * 3 * u);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }
    if (this.pointer) {
      const { x, y } = this.pointer;
      const r = (3 + Math.sin(this.time * 8) * 0.6) * u;
      ctx.save();
      ctx.fillStyle = "rgba(255, 236, 120, 0.35)";
      ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff4a8";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#5a3a10"; ctx.lineWidth = Math.max(1, u * 0.8);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Recompute sizing (call on window resize; frame() also detects container changes). */
  resize(): void {
    this.computeSize();
    this.buildStatic();
  }

  /** Sparkle burst around exit + character, with a little victory hop. */
  celebrate(): void {
    if (!this.maze) return;
    this.emitT = 0.9;
    this.hopT = 0;
    // Immediate burst so the win reads instantly.
    const e = this.cellCenter(this.maze.end);
    for (let i = 0; i < 14; i++) this.spawnParticle(e.x, e.y, 26);
    const p = this.playerCenter();
    for (let i = 0; i < 10; i++) this.spawnParticle(p.x, p.y, 20);
  }

  // ---------- Sizing ----------
  private computeSize(): void {
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const cwRaw = this.container.clientWidth;
    const chRaw = this.container.clientHeight;
    this.lastCW = cwRaw;
    this.lastCH = chRaw;
    const cw = Math.max(0, cwRaw - STAGE_MARGIN_CSS * 2);
    const ch = Math.max(0, chRaw - STAGE_MARGIN_CSS * 2);

    if (this.maze) {
      this.artW = this.maze.width * TILE + PAD * 2;
      this.artH = this.maze.height * TILE + PAD * 2;
    } else {
      this.artW = TILE;
      this.artH = TILE;
    }

    const availW = Math.floor(cw * this.dpr);
    const availH = Math.floor(ch * this.dpr);
    let u = Math.floor(Math.min(availW / this.artW, availH / this.artH));
    if (!Number.isFinite(u)) u = 1;
    u = Math.max(1, Math.min(MAX_UNIT, u));
    this.unit = u;

    const w = this.artW * u;
    const h = this.artH * u;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    // Backing store maps 1:1 onto device pixels -> crisp integer-scaled art.
    this.canvas.style.width = `${w / this.dpr}px`;
    this.canvas.style.height = `${h / this.dpr}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  // ---------- Static layer (ground, grass, start marker, hedges) ----------
  private buildStatic(): void {
    const m = this.maze;
    const W = this.artW;
    const H = this.artH;
    const u = this.unit;

    this.staticCanvas.width = W * u;
    this.staticCanvas.height = H * u;
    const sctx = this.staticCanvas.getContext("2d")!;
    sctx.imageSmoothingEnabled = false;
    if (!m) {
      sctx.fillStyle = C.ground;
      sctx.fillRect(0, 0, W * u, H * u);
      return;
    }

    // Author at art resolution, then upscale with nearest-neighbour.
    const art = document.createElement("canvas");
    art.width = W;
    art.height = H;
    const actx = art.getContext("2d")!;
    actx.fillStyle = C.ground;
    actx.fillRect(0, 0, W, H);

    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        this.drawGrass(actx, PAD + x * TILE, PAD + y * TILE, x, y, m.seed);
      }
    }
    this.drawStartMarker(actx, PAD + m.start.x * TILE, PAD + m.start.y * TILE);

    // Hedge mask: union of thick strips centered on every wall edge.
    const mask = new Uint8Array(W * H);
    const fill = (x0: number, y0: number, x1: number, y1: number) => {
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(W, x1);
      y1 = Math.min(H, y1);
      for (let y = y0; y < y1; y++) {
        mask.fill(1, y * W + x0, y * W + x1);
      }
    };
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const cell = m.cells[y][x];
        const ox = PAD + x * TILE;
        const oy = PAD + y * TILE;
        if (cell.walls.top) fill(ox - HALF_WT, oy - HALF_WT, ox + TILE + HALF_WT, oy + HALF_WT);
        if (cell.walls.bottom) fill(ox - HALF_WT, oy + TILE - HALF_WT, ox + TILE + HALF_WT, oy + TILE + HALF_WT);
        if (cell.walls.left) fill(ox - HALF_WT, oy - HALF_WT, ox + HALF_WT, oy + TILE + HALF_WT);
        if (cell.walls.right) fill(ox + TILE - HALF_WT, oy - HALF_WT, ox + TILE + HALF_WT, oy + TILE + HALF_WT);
      }
    }

    // Shade each hedge pixel from its neighbourhood: outline ring, lit top face,
    // shadowed bottom/right face, leafy mid. Junctions come out continuous for free.
    const img = actx.getImageData(0, 0, W, H);
    const d = img.data;
    const isH = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
    const outline = hex(C.hedgeOutline);
    const hi = hex(C.hedgeHi);
    const midHi = hex(C.hedgeMidHi);
    const mid = hex(C.hedgeMid);
    const shade = hex(C.hedgeShade);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!mask[y * W + x]) continue;
        let col: RGB;
        if (!isH(x - 1, y) || !isH(x + 1, y) || !isH(x, y - 1) || !isH(x, y + 1)) col = outline;
        else if (!isH(x, y - 2)) col = hi;
        else if (!isH(x, y - 3)) col = midHi;
        else if (!isH(x, y + 2) || !isH(x + 2, y)) col = shade;
        else {
          const r = hash2(x, y, 7);
          col = r < 0.14 ? shade : r < 0.26 ? midHi : mid;
        }
        const i = (y * W + x) * 4;
        d[i] = col[0];
        d[i + 1] = col[1];
        d[i + 2] = col[2];
        d[i + 3] = 255;
      }
    }
    actx.putImageData(img, 0, 0);

    sctx.drawImage(art, 0, 0, W * u, H * u);
  }

  private drawGrass(ctx: CanvasRenderingContext2D, ox: number, oy: number, cx: number, cy: number, seed: number): void {
    ctx.fillStyle = C.grass;
    ctx.fillRect(ox, oy, TILE, TILE);
    // Small "v" tufts, deterministic per cell.
    const n = 2 + Math.floor(hash2(cx, cy, seed) * 3);
    for (let k = 0; k < n; k++) {
      const tx = ox + 2 + Math.floor(hash2(cx, cy, seed + 11 + k * 3) * 14);
      const ty = oy + 2 + Math.floor(hash2(cx, cy, seed + 12 + k * 3) * 14);
      ctx.fillStyle = C.grassDark;
      ctx.fillRect(tx, ty, 1, 1);
      ctx.fillRect(tx + 2, ty, 1, 1);
      ctx.fillRect(tx + 1, ty + 1, 1, 1);
      ctx.fillStyle = C.grassLight;
      ctx.fillRect(tx + 1, ty, 1, 1);
    }
    // A lone bright blade here and there.
    if (hash2(cx, cy, seed + 99) < 0.5) {
      const bx = ox + 3 + Math.floor(hash2(cx, cy, seed + 100) * 13);
      const by = oy + 3 + Math.floor(hash2(cx, cy, seed + 101) * 13);
      ctx.fillStyle = C.grassLight;
      ctx.fillRect(bx, by, 1, 1);
    }
  }

  private drawStartMarker(ctx: CanvasRenderingContext2D, ox: number, oy: number): void {
    // Plain sandy doormat tile.
    const x = ox + 5;
    const y = oy + 5;
    ctx.fillStyle = C.sandDark;
    ctx.fillRect(x, y, 10, 10);
    ctx.fillStyle = C.sand;
    ctx.fillRect(x + 1, y + 1, 8, 8);
    ctx.fillStyle = C.sandLight;
    ctx.fillRect(x + 1, y + 1, 8, 1);
    ctx.fillRect(x + 1, y + 1, 1, 8);
    ctx.fillStyle = C.sandDark;
    ctx.fillRect(x + 3, y + 3, 1, 1);
    ctx.fillRect(x + 6, y + 4, 1, 1);
    ctx.fillRect(x + 4, y + 6, 1, 1);
    ctx.fillRect(x + 7, y + 7, 1, 1);
  }

  // ---------- Dynamic layer ----------
  private tickAnim(dt: number): void {
    const a = this.anim;
    if (a) {
      a.t += dt * 1000;
      if (a.t >= a.dur) {
        if (a.kind === "move") this.pos = { ...a.to };
        this.anim = null;
      }
    }
    if (this.hopT >= 0) {
      this.hopT += dt / 0.45;
      if (this.hopT >= 1) this.hopT = -1;
    }
  }

  /** Art-px rect helper (scaled by unit). */
  private rect(x: number, y: number, w: number, h: number): void {
    const u = this.unit;
    this.ctx.fillRect(x * u, y * u, w * u, h * u);
  }

  private cellCenter(p: Point): { x: number; y: number } {
    return { x: PAD + p.x * TILE + TILE / 2, y: PAD + p.y * TILE + TILE / 2 };
  }

  /** Current character position in continuous cell coordinates + animation frame. */
  private playerState(): { cx: number; cy: number; frame: Frame } {
    const a = this.anim;
    let cx = this.pos.x;
    let cy = this.pos.y;
    let frame: Frame = "stand";
    if (a && a.kind === "move") {
      const p = Math.min(1, a.t / a.dur);
      cx = a.from.x + (a.to.x - a.from.x) * p;
      cy = a.from.y + (a.to.y - a.from.y) * p;
      frame = p < 0.62 ? (this.stepParity ? "a" : "b") : "stand";
    } else if (a && a.kind === "bump") {
      const p = Math.min(1, a.t / a.dur);
      const off = Math.sin(p * Math.PI) * (3 / TILE);
      cx = a.at.x + DIR_DELTA[a.dir].dx * off;
      cy = a.at.y + DIR_DELTA[a.dir].dy * off;
    }
    return { cx, cy, frame };
  }

  private playerCenter(): { x: number; y: number } {
    const s = this.playerState();
    return { x: PAD + s.cx * TILE + TILE / 2, y: PAD + s.cy * TILE + TILE / 2 - 4 };
  }

  private drawPlayer(): void {
    const { cx, cy, frame } = this.playerState();
    const sprite = spriteFor(this.facing, frame);
    // Feet sit 2px above the cell's bottom edge; head overlaps the row above (GBA style).
    let sx = Math.round(PAD + cx * TILE + (TILE - SPR_W) / 2);
    let sy = Math.round(PAD + cy * TILE + TILE - 2 - SPR_H);
    if (frame !== "stand") sy -= 1; // walk bob
    if (this.hopT >= 0) sy -= Math.round(Math.sin(this.hopT * Math.PI) * 5);
    const u = this.unit;
    this.ctx.drawImage(sprite, sx * u, sy * u, SPR_W * u, SPR_H * u);
  }

  private drawExit(): void {
    const m = this.maze!;
    const ox = PAD + m.end.x * TILE;
    const oy = PAD + m.end.y * TILE;
    const ctx = this.ctx;
    const t = this.time;

    // Pulsing glow on the floor.
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    const g = Math.round(pulse * 2);
    ctx.globalAlpha = 0.16 + 0.16 * pulse;
    ctx.fillStyle = C.glow;
    this.rect(ox + 4 - g, oy + 4 - g, 12 + g * 2, 12 + g * 2);
    ctx.globalAlpha = 0.28 + 0.2 * pulse;
    this.rect(ox + 6, oy + 6, 8, 8);
    ctx.globalAlpha = 1;

    // Item ball, gently bobbing.
    const bob = Math.round(Math.sin(t * 2.5));
    const ball = ballSprite();
    const u = this.unit;
    ctx.drawImage(ball, (ox + 5) * u, (oy + 5 + bob) * u, ball.width * u, ball.height * u);

    // Three orbiting, blinking sparkles.
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.7 + i / 3) % 1;
      if (phase > 0.55) continue;
      const size = phase < 0.15 || phase > 0.4 ? 1 : 2;
      const ang = i * 2.094 + t * 0.6;
      const x = ox + 10 + Math.round(Math.cos(ang) * 8);
      const y = oy + 9 + Math.round(Math.sin(ang) * 6);
      this.drawSparkle(x, y, size, i % 2 ? C.sparkB : C.sparkA);
    }
  }

  private drawSparkle(x: number, y: number, size: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    this.rect(x - size, y, size * 2 + 1, 1);
    this.rect(x, y - size, 1, size * 2 + 1);
    if (size > 1) {
      ctx.fillStyle = "#ffffff";
      this.rect(x, y, 1, 1);
    }
  }

  private spawnParticle(x: number, y: number, speed: number): void {
    const ang = Math.random() * Math.PI * 2;
    const sp = speed * (0.4 + Math.random() * 0.8);
    this.particles.push({
      x,
      y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 8,
      life: 0,
      max: 0.7 + Math.random() * 0.6,
      color: Math.random() < 0.5 ? C.sparkA : C.sparkB,
    });
  }

  private tickParticles(dt: number): void {
    if (this.emitT > 0 && this.maze) {
      this.emitT -= dt;
      const e = this.cellCenter(this.maze.end);
      const p = this.playerCenter();
      if (Math.random() < 0.8) this.spawnParticle(e.x, e.y, 24);
      if (Math.random() < 0.6) this.spawnParticle(p.x, p.y, 18);
    }
    if (this.particles.length === 0) return;
    const ctx = this.ctx;
    const alive: Particle[] = [];
    for (const q of this.particles) {
      q.life += dt;
      if (q.life >= q.max) continue;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy -= 6 * dt; // sparkles drift upward
      q.vx *= 1 - 1.5 * dt;
      const k = q.life / q.max;
      const size = k < 0.3 ? 2 : k < 0.75 ? 1 : 0;
      ctx.globalAlpha = 1 - k * k;
      this.drawSparkle(Math.round(q.x), Math.round(q.y), size, q.color);
      alive.push(q);
    }
    ctx.globalAlpha = 1;
    this.particles = alive;
  }
}
