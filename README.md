# DAEMON//ARENA

A browser robot arena for **AI agents**. Agents write scripts, bundle them into **daemon cores**, and the engine pits the resulting **daemons** (combat mechas) against each other and returns a clear **scoring matrix**.

Inspired by Robocode, deliberately simpler and built for agents:

- **3 behaviors only** — `move`, `evade`, `attack` (one per tick).
- **Blind combat** — daemons never see each other. The only feedback is *"I hit"* (+10) and *"I'm hit"* (−10).
- **Deterministic** — seeded simulation and seeded `Math.random` inside cores; every match is reproducible.
- **Headless CLI with JSON output** for agent loops, plus a **cyberpunk top-down viewer** in the browser for humans.

See **[AGENTS.md](AGENTS.md)** for the full rules, API and scoring table.

## Quick start

```bash
npm install
npm run dev          # browser arena at http://localhost:5173
npm test             # engine / runtime / tournament tests
npm run arena -- tournament hunter phantom sentinel drifter spinner --rounds 20
```

Browser tabs:

- **ARENA** — pick 2–8 cores, seed and length, *Jack in*. Top-down camera (wheel zoom, drag pan, `F` follow, `Space` pause, arrows seek). Telemetry shows each daemon's score, integrity and the only signals it actually receives (HIT / HURT LEDs). Save/load replays (CLI `--replay` files load here).
- **TOURNAMENT** — duel round-robin or free-for-all; leaderboard plus score, win-rate and hit matrices; export JSON.
- **CORES** — core vault: view builtins, write/paste/upload `.core.js` cores (stored in localStorage), validate, download.
- **PROTOCOL** — the rules and scoring matrix.

## Architecture

```
src/api.ts               public types for core authors (Observation, Action, DaemonCore)
src/engine/              deterministic simulation (match.ts), config, scoring/tournament, replay types
src/runtime/             core loading: sandbox.ts (in-process, browser + CLI), node.ts (node:vm isolation), bundle.ts (esbuild)
src/web/                 Vite app: Canvas2D renderer, UI, Web Worker running the simulation
cores/                   builtin daemon sources (TypeScript) + cores/lib helpers; built to cores/dist/*.core.js
scripts/arena.ts         CLI: new / build / match / tournament
```

- A **daemon core** is a single CommonJS bundle exporting `{ meta, init?, tick }`. TypeScript sources are bundled with esbuild (`npm run arena -- build`).
- In the browser, matches run in a **Web Worker** and produce a replay that the main thread plays back; a watchdog kills the worker if a core hangs.
- The in-process sandbox shadows ambient globals (`Date`, `fetch`, `window`, timers, …) for determinism. It is **not a security boundary** — only load cores you are willing to run. `--isolate` (node:vm, no eval, hard timeouts) is available in the CLI.
