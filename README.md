# Maze AR

Procedurally generated mazes you solve by **pointing at your webcam**: the pixel-art trainer follows your index
fingertip through the maze, one tile at a time. Hand tracking runs fully in the browser with Google MediaPipe
(Hand Landmarker, GPU delegate). Retro handheld-RPG pixel art, drawn procedurally in code, with synthesized
8-bit sound effects. No backend.

**Stack:** TypeScript · Vite · MediaPipe Tasks Vision · Canvas 2D · Web Audio API · Vercel

## Play

1. Click **START** and allow camera access when the browser asks.
2. Point your index finger at the camera. The trainer walks toward your fingertip (a fading trail shows where you are
   pointing). The center of the camera frame maps onto the whole maze, so you don't need to reach the edges.
3. Reach the glowing exit. A popup offers the **next randomly generated maze** (bigger each level).
4. **NEW MAZE** in the top bar (or `N`) regenerates the current level. Arrow keys / WASD also work.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5190
```

## Deploy to Vercel (one shot)

Push this folder to a GitHub repo, then **Vercel → Add New Project → Import** that repo.
`vercel.json` already pins the Vite framework preset, build command and `dist/` output, so no
settings need changing. Vercel serves over HTTPS, which the camera API requires.

> If you import a repo where this project lives in a subfolder, set **Root Directory** to that
> folder in the import screen. Nothing else changes.

## Structure

```
index.html            page skeleton (HUD, canvas, camera PIP, start/win dialogs)
public/models/        hand_landmarker.task (MediaPipe model, served statically)
src/
  main.ts             wiring: game ↔ renderer ↔ gestures ↔ ui
  types.ts            shared contracts
  maze.ts             seeded recursive-backtracker generator, BFS solver, level sizes
  game.ts             game model: player, moves, win detection
  gestures.ts         MediaPipe hand tracking, fingertip pointer + swipe detection, camera preview
  render.ts           pixel-art maze + animated trainer sprite (render_min.ts: older compact renderer, unused)
  ui.ts               HUD / dialogs
  sfx.ts              procedural Web Audio sound effects
  style.css           retro RPG text-box styling
```
