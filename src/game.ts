import type { Dir, Maze, Point, MoveResult } from "./types";
import { DIR_DELTA } from "./types";
import { generateMaze, canMove, solve, levelSize } from "./maze";

/** Pure game model: no DOM, no rendering. */
export class Game {
  readonly maze: Maze;
  readonly level: number;
  readonly par: number;
  private _player: Point;
  private _facing: Dir = "down";
  private _moves = 0;
  private _won = false;
  private readonly startTime: number;

  constructor(level = 1) {
    this.level = level;
    const { width, height } = levelSize(level);
    this.maze = generateMaze(width, height);
    this._player = { ...this.maze.start };
    this.par = Math.max(0, solve(this.maze).length - 1);
    this.startTime = performance.now();
  }

  get player(): Point {
    return this._player;
  }
  get facing(): Dir {
    return this._facing;
  }
  get moves(): number {
    return this._moves;
  }
  get won(): boolean {
    return this._won;
  }

  tryMove(dir: Dir): MoveResult {
    const from = { ...this._player };
    if (this._won) {
      return { ok: false, from, to: from, dir, won: true };
    }
    this._facing = dir;
    if (!canMove(this.maze, from, dir)) {
      return { ok: false, from, to: from, dir, won: false };
    }
    const to = { x: from.x + DIR_DELTA[dir].dx, y: from.y + DIR_DELTA[dir].dy };
    this._player = to;
    this._moves++;
    if (to.x === this.maze.end.x && to.y === this.maze.end.y) this._won = true;
    return { ok: true, from, to, dir, won: this._won };
  }

  elapsedSeconds(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  nextLevel(): Game {
    return new Game(this.level + 1);
  }
}
