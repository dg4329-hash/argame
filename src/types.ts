// Shared contracts. All modules import from here; do not change signatures without updating main.ts.

export type Dir = "up" | "down" | "left" | "right";

export const DIR_DELTA: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

export interface Walls {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface Cell {
  x: number;
  y: number;
  walls: Walls;
}

export interface Point {
  x: number;
  y: number;
}

export interface Maze {
  width: number;   // columns
  height: number;  // rows
  cells: Cell[][]; // cells[y][x]
  start: Point;
  end: Point;
  seed: number;
}

/** Result of attempting a move in the game model. */
export interface MoveResult {
  ok: boolean;       // false if a wall blocked it
  from: Point;
  to: Point;         // equals from when blocked
  dir: Dir;
  won: boolean;      // true if `to` is the maze end
}

/** Emitted by the gesture controller. */
export interface SwipeEvent {
  dir: Dir;
  /** normalized speed of the swipe, for optional UI feedback */
  speed: number;
  ts: number;
}

export type TrackerStatus = "idle" | "loading" | "ready" | "error";

/** Continuous index-fingertip position, mirrored, normalized 0..1 over the camera frame. */
export interface PointerSample {
  x: number;
  y: number;
  visible: boolean;
  ts: number;
}
