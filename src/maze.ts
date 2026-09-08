import type { Dir, Maze, Cell, Point } from "./types";
import { DIR_DELTA } from "./types";

// ---------- PRNG (mulberry32) ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const WALL_KEY: Record<Dir, keyof Cell["walls"]> = { up: "top", down: "bottom", left: "left", right: "right" };
const DIRS: Dir[] = ["up", "down", "left", "right"];

function inBounds(maze: Maze, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < maze.width && y < maze.height;
}

/** BFS from `from`; returns dist grid (-1 = unreachable) and parent map. */
function bfs(maze: Maze, from: Point): { dist: number[][]; parent: (Point | null)[][] } {
  const dist: number[][] = [];
  const parent: (Point | null)[][] = [];
  for (let y = 0; y < maze.height; y++) {
    dist.push(new Array<number>(maze.width).fill(-1));
    parent.push(new Array<Point | null>(maze.width).fill(null));
  }
  const queue: Point[] = [from];
  dist[from.y][from.x] = 0;
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    for (const d of DIRS) {
      if (!canMove(maze, p, d)) continue;
      const nx = p.x + DIR_DELTA[d].dx;
      const ny = p.y + DIR_DELTA[d].dy;
      if (dist[ny][nx] !== -1) continue;
      dist[ny][nx] = dist[p.y][p.x] + 1;
      parent[ny][nx] = p;
      queue.push({ x: nx, y: ny });
    }
  }
  return { dist, parent };
}

// ---------- Public API ----------

export function generateMaze(width: number, height: number, seed?: number): Maze {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const actualSeed = seed === undefined ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : (seed >>> 0);
  const rand = mulberry32(actualSeed);

  const cells: Cell[][] = [];
  for (let y = 0; y < h; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) {
      row.push({ x, y, walls: { top: true, right: true, bottom: true, left: true } });
    }
    cells.push(row);
  }

  const maze: Maze = { width: w, height: h, cells, start: { x: 0, y: 0 }, end: { x: w - 1, y: h - 1 }, seed: actualSeed };

  // Iterative recursive backtracker.
  const visited: boolean[][] = cells.map((row) => row.map(() => false));
  const stack: Point[] = [{ x: 0, y: 0 }];
  visited[0][0] = true;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const candidates: Dir[] = [];
    for (const d of DIRS) {
      const nx = cur.x + DIR_DELTA[d].dx;
      const ny = cur.y + DIR_DELTA[d].dy;
      if (inBounds(maze, nx, ny) && !visited[ny][nx]) candidates.push(d);
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const d = candidates[Math.floor(rand() * candidates.length)];
    const nx = cur.x + DIR_DELTA[d].dx;
    const ny = cur.y + DIR_DELTA[d].dy;
    cells[cur.y][cur.x].walls[WALL_KEY[d]] = false;
    cells[ny][nx].walls[WALL_KEY[OPPOSITE[d]]] = false;
    visited[ny][nx] = true;
    stack.push({ x: nx, y: ny });
  }

  // End = farthest cell from start by BFS distance.
  const { dist } = bfs(maze, maze.start);
  let best = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dist[y][x] > best) {
        best = dist[y][x];
        maze.end = { x, y };
      }
    }
  }
  return maze;
}

export function canMove(maze: Maze, from: Point, dir: Dir): boolean {
  if (!inBounds(maze, from.x, from.y)) return false;
  const nx = from.x + DIR_DELTA[dir].dx;
  const ny = from.y + DIR_DELTA[dir].dy;
  if (!inBounds(maze, nx, ny)) return false;
  return !maze.cells[from.y][from.x].walls[WALL_KEY[dir]];
}

/** BFS shortest path from start to end, inclusive of both. Empty if unreachable. */
export function solve(maze: Maze): Point[] {
  const { dist, parent } = bfs(maze, maze.start);
  if (dist[maze.end.y][maze.end.x] === -1) return [];
  const path: Point[] = [];
  let cur: Point | null = maze.end;
  while (cur) {
    path.push(cur);
    cur = parent[cur.y][cur.x];
  }
  path.reverse();
  return path;
}

/** Difficulty ramp: level 1 -> 6x6, +1 per level, capped at 16x12. */
export function levelSize(level: number): { width: number; height: number } {
  const n = Math.max(1, Math.floor(level));
  return {
    width: Math.min(16, 5 + n),
    height: Math.min(12, 5 + n),
  };
}

/** Dev-only sanity check: perfect-maze reachability + solvable path across 20 mazes. */
export function _selfTest(): boolean {
  for (let i = 0; i < 20; i++) {
    const { width, height } = levelSize(1 + (i % 12));
    const maze = generateMaze(width, height, 1000 + i);
    const { dist } = bfs(maze, maze.start);
    let reached = 0;
    for (const row of dist) for (const d of row) if (d !== -1) reached++;
    if (reached !== width * height) return false;
    const path = solve(maze);
    if (path.length === 0) return false;
    const first = path[0];
    const last = path[path.length - 1];
    if (first.x !== maze.start.x || first.y !== maze.start.y) return false;
    if (last.x !== maze.end.x || last.y !== maze.end.y) return false;
    if (path.length - 1 !== dist[maze.end.y][maze.end.x]) return false;
    const again = generateMaze(width, height, 1000 + i);
    if (again.end.x !== maze.end.x || again.end.y !== maze.end.y) return false;
  }
  return true;
}
