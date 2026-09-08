// DOM/HUD helpers. Pure view layer: no game logic lives here.
import type { Dir } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const setText = (id: string, text: string): void => {
  const el = $(id);
  if (el) el.textContent = text;
};

const ARROWS: Record<Dir, string> = {
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

let swipeTimer: ReturnType<typeof setTimeout> | null = null;

export const ui: {
  setLevel(n: number): void;
  setMoves(n: number): void;
  setTime(seconds: number): void;
  setTracker(status: string, handVisible: boolean): void;
  flashSwipe(dir: Dir): void;
  showStart(onStart: () => void): void;
  hideStart(): void;
  showWin(
    stats: { level: number; moves: number; par: number; seconds: number },
    onNext: () => void,
  ): void;
  hideWin(): void;
  setPipLabel(text: string): void;
} = {
  setLevel(n) {
    setText("hud-level", String(n));
  },

  setMoves(n) {
    setText("hud-moves", String(n));
  },

  setTime(seconds) {
    setText("hud-time", seconds.toFixed(1));
  },

  setTracker(status, handVisible) {
    const el = $("hud-tracker");
    if (!el) return;
    el.textContent =
      status === "ready" ? `ready · ${handVisible ? "hand" : "no hand"}` : status;
    el.dataset.state = status;
  },

  flashSwipe(dir) {
    const el = $("swipe-indicator");
    if (!el) return;
    if (swipeTimer !== null) {
      clearTimeout(swipeTimer);
      swipeTimer = null;
    }
    el.textContent = ARROWS[dir];
    el.classList.remove("hidden", "pop");
    // Force reflow so the animation restarts on rapid consecutive swipes.
    void el.offsetWidth;
    el.classList.add("pop");
    swipeTimer = setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("pop");
      swipeTimer = null;
    }, 400);
  },

  showStart(onStart) {
    $("overlay-start")?.classList.remove("hidden");
    const btn = $<HTMLButtonElement>("btn-start");
    if (btn) btn.onclick = () => onStart();
  },

  hideStart() {
    $("overlay-start")?.classList.add("hidden");
  },

  showWin(stats, onNext) {
    setText(
      "win-stats",
      `Level ${stats.level} cleared in ${stats.seconds.toFixed(1)}s\nMoves: ${stats.moves} (par ${stats.par})`,
    );
    $("overlay-win")?.classList.remove("hidden");
    const btn = $<HTMLButtonElement>("btn-next");
    if (btn) btn.onclick = () => onNext();
  },

  hideWin() {
    $("overlay-win")?.classList.add("hidden");
  },

  setPipLabel(text) {
    setText("pip-label", text);
  },
};
