import { Game } from "./game";
import { Renderer } from "./render";
import { GestureController } from "./gestures";
import { ui } from "./ui";
import { sfx } from "./sfx";
import type { Dir, PointerSample } from "./types";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const video = document.getElementById("cam") as HTMLVideoElement;
const pipCanvas = document.getElementById("pip-canvas") as HTMLCanvasElement;
const btnNew = document.getElementById("btn-new") as HTMLButtonElement | null;
const startError = document.getElementById("start-error") as HTMLElement | null;

const renderer = new Renderer(canvas);
let game = new Game(1);
let gestures: GestureController | null = null;
let started = false;

function loadGame(next: Game) {
  game = next;
  renderer.setMaze(game.maze, game.player, game.facing);
  ui.setLevel(game.level);
  ui.setMoves(game.moves);
  ui.setTime(0);
  ui.hideWin();
}

function move(dir: Dir) {
  if (!started || game.won) return;
  const res = game.tryMove(dir);
  renderer.applyMove(res);
  ui.flashSwipe(dir);
  if (res.ok) sfx.step(); else sfx.bump();
  ui.setMoves(game.moves);
  if (res.won) onWin();
}

function onWin() {
  renderer.celebrate();
  sfx.win();
  const seconds = game.elapsedSeconds();
  // Small delay so the player sees the character reach the exit before the popup.
  window.setTimeout(() => {
    ui.showWin(
      { level: game.level, moves: game.moves, par: game.par, seconds },
      () => loadGame(game.nextLevel()),
    );
  }, 650);
}

// ---- Input: keyboard fallback (also handy for testing without a camera) ----
const KEYMAP: Record<string, Dir> = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  w: "up", s: "down", a: "left", d: "right",
  W: "up", S: "down", A: "left", D: "right",
};
window.addEventListener("keydown", (e) => {
  const dir = KEYMAP[e.key];
  if (dir) {
    e.preventDefault();
    move(dir);
    return;
  }
  if (e.key === "n" || e.key === "N") newMaze();
  if (e.key === "m" || e.key === "M") sfx.toggleMute();
  if (e.key === "Enter" && game.won) loadGame(game.nextLevel());
});

function newMaze() {
  if (!started) return;
  loadGame(new Game(game.level));
}
btnNew?.addEventListener("click", newMaze);

// ---- Camera + gestures ----
async function startGestures() {
  if (gestures) return;
  gestures = new GestureController(video, pipCanvas);
  gestures.onStatus((s) => {
    ui.setTracker(s, gestures?.handVisible ?? false);
    if (s === "ready") ui.setPipLabel("POINT TO MOVE");
    if (s === "loading") ui.setPipLabel("LOADING HAND MODEL…");
    if (s === "error") ui.setPipLabel("CAMERA OFF · USE ARROW KEYS");
  });
  // Finger-follow control: the trainer chases the index fingertip, one tile at a time.
  gestures.onPointer((p) => { pointer = p; });
  try {
    await gestures.init();
  } catch (err: any) {
    const msg = gestures.errorMessage ?? err?.message ?? String(err);
    console.warn("gesture init failed:", msg);
    ui.setTracker("error", false);
    ui.setPipLabel("CAMERA OFF · USE ARROW KEYS");
    if (startError) {
      startError.textContent = `Camera unavailable: ${msg}. You can still play with the arrow keys.`;
      startError.classList.remove("hidden");
    }
  }
}

// ---- Finger follow ----
// Camera coords are mirrored+normalized. Map an inner window of the frame onto the whole maze
// so the player doesn't have to reach the edges of the camera view.
const EDGE = 0.12;
const STEP_MS = 170;       // min time between steps (matches the slide animation)
const DEADZONE = 0.45;     // in cells; how far the finger must be from the trainer's center to step
let pointer: PointerSample | null = null;
let lastStepAt = 0;

function followPointer(now: number) {
  if (!started || game.won || !pointer) return;
  if (!pointer.visible) { renderer.setPointer(0, 0, false); return; }
  const nx = Math.min(1, Math.max(0, (pointer.x - EDGE) / (1 - 2 * EDGE)));
  const ny = Math.min(1, Math.max(0, (pointer.y - EDGE) / (1 - 2 * EDGE)));
  renderer.setPointer(nx, ny, true);
  if (renderer.isAnimating() || now - lastStepAt < STEP_MS) return;

  const { cx, cy } = renderer.normToCell(nx, ny);
  const dx = cx - (game.player.x + 0.5);
  const dy = cy - (game.player.y + 0.5);
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DEADZONE) return;

  const primary: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
  const secondary: Dir = Math.abs(dx) > Math.abs(dy) ? (dy > 0 ? "down" : "up") : (dx > 0 ? "right" : "left");
  const secondaryMag = Math.abs(dx) > Math.abs(dy) ? Math.abs(dy) : Math.abs(dx);

  lastStepAt = now;
  let res = game.tryMove(primary);
  if (!res.ok && secondaryMag >= DEADZONE) res = game.tryMove(secondary);
  renderer.applyMove(res);
  ui.setMoves(game.moves);
  if (res.ok) sfx.step();
  if (res.won) onWin();
}

// ---- Boot ----
ui.setTracker("idle", false);
ui.showStart(async () => {
  if (started) return;
  started = true;
  sfx.unlock();
  sfx.start();
  ui.hideStart();
  loadGame(new Game(1));
  // Request the camera only after the user clicks START (browsers require a user gesture
  // for a clean permission prompt, and it makes the ask feel intentional).
  void startGestures();
});
renderer.setMaze(game.maze, game.player, game.facing);
window.addEventListener("resize", () => renderer.resize());

let last = performance.now();
let lastHandVisible: boolean | null = null;
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  followPointer(now);
  renderer.frame(dt);
  if (started && !game.won) ui.setTime(game.elapsedSeconds());
  if (gestures && gestures.handVisible !== lastHandVisible) {
    lastHandVisible = gestures.handVisible;
    ui.setTracker(gestures.status, gestures.handVisible);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
