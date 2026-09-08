# Maze AR

Procedurally generated mazes you solve by **swiping your hand in front of the webcam**.
Hand tracking runs fully in the browser with Google MediaPipe (Hand Landmarker, GPU delegate).
Pokémon / GBA-style pixel art. No backend.

## Play

1. Click **START** and allow camera access when the browser asks.
2. Swipe your hand up / down / left / right in front of the camera to move the trainer.
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
  gestures.ts         MediaPipe hand tracking + swipe detection + camera preview
  render.ts           pixel-art maze + animated trainer sprite
  ui.ts               HUD / dialogs
  style.css           Pokémon text-box styling
```
