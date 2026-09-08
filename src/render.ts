// Compact canvas-2D maze renderer (GBA-style pixel look).
import type { Dir, Maze, Point, MoveResult } from "./types";
import { DIR_DELTA } from "./types";

const TWEEN_MS = 180;
const BUMP_MS = 120;
const WALK_MS = 90;
const SPARKLE_MS = 1500;

interface Anim {
  kind: "tween" | "bump";
  from: Point;
  to: Point;
  dir: Dir;
  t: number; // elapsed ms
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private maze: Maze | null = null;
  private player: Point = { x: 0, y: 0 };
  private facing: Dir = "down";
  private tile = 12;
  private time = 0;
  private anim: Anim | null = null;
  private sparkleT = -1; // <0 = off

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
  }

  setMaze(maze: Maze, player: Point, facing: Dir): void {
    this.maze = maze;
    this.player = { ...player };
    this.facing = facing;
    this.anim = null;
    this.sparkleT = -1;
    this.resize();
  }

  applyMove(result: MoveResult): void {
    this.facing = result.dir;
    if (result.ok) {
      this.anim = { kind: "tween", from: { ...result.from }, to: { ...result.to }, dir: result.dir, t: 0 };
      this.player = { ...result.to };
    } else {
      this.anim = { kind: "bump", from: { ...result.from }, to: { ...result.from }, dir: result.dir, t: 0 };
      this.player = { ...result.from };
    }
  }

  celebrate(): void {
    this.sparkleT = 0;
  }

  resize(): void {
    const maze = this.maze;
    const parent = this.canvas.parentElement;
    const cw = parent?.clientWidth || 600;
    const ch = parent?.clientHeight || 600;
    const cols = maze?.width ?? 1;
    const rows = maze?.height ?? 1;
    this.tile = Math.max(12, Math.floor(Math.min(cw / cols, ch / rows)));
    this.canvas.width = this.tile * cols;
    this.canvas.height = this.tile * rows;
    this.ctx.imageSmoothingEnabled = false;
  }

  frame(dt: number): void {
    this.time += dt;
    if (this.anim) {
      this.anim.t += dt;
      const dur = this.anim.kind === "tween" ? TWEEN_MS : BUMP_MS;
      if (this.anim.t >= dur) this.anim = null;
    }
    if (this.sparkleT >= 0) {
      this.sparkleT += dt;
      if (this.sparkleT > SPARKLE_MS) this.sparkleT = -1;
    }
    const maze = this.maze;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!maze) return;
    this.drawFloor(maze);
    this.drawMarkers(maze);
    this.drawWalls(maze);
    this.drawPlayer();
    if (this.sparkleT >= 0) this.drawSparkles(maze);
  }

  private drawFloor(maze: Maze): void {
    const { ctx, tile } = this;
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#78c850" : "#70b848";
        ctx.fillRect(x * tile, y * tile, tile, tile);
      }
    }
  }

  private drawMarkers(maze: Maze): void {
    const { ctx, tile } = this;
    // Start: small cream marker.
    const s = Math.max(2, Math.floor(tile * 0.3));
    ctx.fillStyle = "#f8f0d8";
    ctx.fillRect(
      Math.floor(maze.start.x * tile + (tile - s) / 2),
      Math.floor(maze.start.y * tile + (tile - s) / 2),
      s,
      s,
    );
    // End: pulsing gold circle.
    const pulse = 0.5 + 0.5 * Math.sin(this.time / 250);
    const r = tile * (0.22 + 0.1 * pulse);
    const cx = maze.end.x * tile + tile / 2;
    const cy = maze.end.y * tile + tile / 2;
    ctx.fillStyle = pulse > 0.5 ? "#f8d820" : "#e0b000";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawWalls(maze: Maze): void {
    const { ctx, tile } = this;
    const th = Math.max(3, tile * 0.18);
    const edge = Math.max(1, Math.floor(th / 3));
    for (let y = 0; y < maze.height; y++) {
      for (let x = 0; x < maze.width; x++) {
        const w = maze.cells[y][x].walls;
        const px = x * tile;
        const py = y * tile;
        const strip = (sx: number, sy: number, sw: number, sh: number) => {
          ctx.fillStyle = "#2c6c30";
          ctx.fillRect(sx, sy, sw, sh);
          ctx.fillStyle = "#48a048";
          ctx.fillRect(sx, sy, sw, Math.min(edge, sh)); // lighter top edge
        };
        if (w.top) strip(px, py, tile, th);
        if (w.bottom) strip(px, py + tile - th, tile, th);
        if (w.left) strip(px, py, th, tile);
        if (w.right) strip(px + tile - th, py, th, tile);
      }
    }
  }

  /** Player position in tile units, including tween/bump offsets. */
  private playerPos(): Point {
    const a = this.anim;
    if (!a) return this.player;
    const d = DIR_DELTA[a.dir];
    if (a.kind === "tween") {
      const k = Math.min(1, a.t / TWEEN_MS);
      return { x: a.from.x + (a.to.x - a.from.x) * k, y: a.from.y + (a.to.y - a.from.y) * k };
    }
    const k = Math.sin((Math.min(1, a.t / BUMP_MS)) * Math.PI) * 0.2; // out and back
    return { x: a.from.x + d.dx * k, y: a.from.y + d.dy * k };
  }

  private drawPlayer(): void {
    const { ctx, tile } = this;
    const pos = this.playerPos();
    const u = tile / 16; // pixel unit
    const ox = pos.x * tile + 4 * u;
    const oy = pos.y * tile + 2 * u;
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(ox + x * u), Math.round(oy + y * u), Math.ceil(w * u), Math.ceil(h * u));
    };
    const walking = this.anim?.kind === "tween";
    const step = walking && Math.floor(this.anim!.t / WALK_MS) % 2 === 1;
    // Cap
    px(1, 0, 6, 2, "#e04030");
    px(0, 2, 8, 1, "#e04030");
    // Head
    px(1, 3, 6, 4, "#f8d0a0");
    // Eyes shifted toward facing
    const d = DIR_DELTA[this.facing];
    const ey = 4 + (d.dy > 0 ? 1 : 0);
    if (d.dx < 0) { px(1, ey, 1, 1, "#202020"); px(3, ey, 1, 1, "#202020"); }
    else if (d.dx > 0) { px(4, ey, 1, 1, "#202020"); px(6, ey, 1, 1, "#202020"); }
    else if (d.dy < 0) { /* facing away: no eyes */ }
    else { px(2, ey, 1, 1, "#202020"); px(5, ey, 1, 1, "#202020"); }
    // Shirt
    px(1, 7, 6, 4, "#3860c8");
    px(0, 7, 1, 2, "#f8d0a0");
    px(7, 7, 1, 2, "#f8d0a0");
    // Legs
    const lo = step ? 1 : 0;
    px(1 + lo, 11, 2, 3, "#3040a0");
    px(5 - lo, 11, 2, 3, "#3040a0");
    px(1 + lo, 13, 2, 1, "#503020");
    px(5 - lo, 13, 2, 1, "#503020");
  }

  private drawSparkles(maze: Maze): void {
    const { ctx, tile } = this;
    const k = this.sparkleT / SPARKLE_MS;
    const cx = maze.end.x * tile + tile / 2;
    const cy = maze.end.y * tile + tile / 2;
    const n = 8;
    const s = Math.max(2, Math.floor(tile * 0.12));
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.time / 400;
      const r = tile * (0.4 + 0.8 * k);
      const on = Math.floor(this.time / 100 + i) % 2 === 0;
      ctx.fillStyle = on ? "#fff8a0" : "#f8d820";
      ctx.fillRect(Math.round(cx + Math.cos(ang) * r - s / 2), Math.round(cy + Math.sin(ang) * r - s / 2), s, s);
    }
  }
}
