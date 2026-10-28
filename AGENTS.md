# AGENTS.md — writing daemon cores

You are writing a **daemon core**: a script that drives one combat chassis in a blind arena.
Your goal is to maximise **mean score** in tournaments. Everything you need is here.

## The problem

- Daemons **cannot see each other**. Each tick you observe only your own chassis (`obs.self`), arena constants (`obs.arena`) and the events that happened to you since your last tick (`obs.events`).
- The only combat feedback is **`hit`** (one of your projectiles struck a daemon; carries `firedAt`, the tick you fired it) and **`hurt`** (you were struck; no direction, no attacker). You also get **`wall`** when your chassis bumps the arena edge.
- Each tick you return exactly one of three behaviors: **move**, **evade** or **attack** (or `idle` / `null`).

## Scoring matrix

| Event | Score |
|---|---|
| Your projectile strikes a daemon | **+10** |
| A projectile strikes you | **−10** |
| Projectile passes through you while phasing (evade) | 0 (stat: `dodges`) |
| Wall bump | 0 |
| Integrity reaches 0 (20 hits) | derezzed — you stop acting and can no longer score |

Match winner = highest score (tiebreak: integrity). Duels are zero-sum.
Tournaments rank by **meanScore**, then **winRate**, and report pairwise matrices: `score[row][col]` (mean score of row vs col), `winRate[row][col]`, `hits[row][col]`.

## Behaviors

| Action | Effect | Cooldown |
|---|---|---|
| `{ type: 'move', heading, throttle? }` | Turn chassis toward `heading` (≤ 0.14 rad/tick) and thrust (`throttle` 0..1). Top speed 4 u/tick; friction when not thrusting. | — |
| `{ type: 'evade', heading? }` | Dash at 12 u/tick (default 90° left of chassis) and **phase** for 14 ticks: projectiles pass through. | 75 ticks |
| `{ type: 'attack', heading }` | Fire a projectile in any direction (independent of chassis). 13 u/tick, 5 damage. | 15 ticks |

Angles are radians: `0` = east (+x), `π/2` = south (+y). Arena 800×800, daemon radius 20, 3000 ticks max.
All constants are in `obs.arena` — read them instead of hard-coding. Source of truth: `src/engine/config.ts`.

Faults (count in stats, action becomes idle): throwing, returning an invalid action, exceeding the per-tick time budget (20 ms; hard 50 ms timeout under `--isolate`).

## API

Types live in [`src/api.ts`](src/api.ts). Minimal core:

```ts
import { defineCore } from '../src/api';

export default defineCore({
  meta: { name: 'MY-DAEMON', author: 'agent', color: '#9d4dff' },
  init(arena, ctx) { ctx.memory.shots = {}; },
  tick(obs, ctx) {
    if (obs.self.attackCooldown === 0) return { type: 'attack', heading: ctx.random() * Math.PI * 2 };
    return { type: 'move', heading: 0 };
  },
});
```

- `ctx.random()` / `Math.random()` are seeded per daemon → matches are reproducible from the seed.
- `ctx.memory` (or closure variables) persist for the whole match. A fresh instance is created per match.
- `ctx.log(...)` / `console.log(...)` are captured (`--verbose` in the CLI, signal feed in the browser).
- No `Date`, timers, network, DOM or `eval`. Imports are bundled; Node built-ins are not available.
- Helpers in [`cores/lib/nav.ts`](cores/lib/nav.ts): `angleTo`, `wrapAngle`, `distance`, `towardCenter`, `wallClearance`, `estimateImpactDistance`.

## Workflow

```bash
npm install
npm run arena -- new my-daemon                         # scaffold cores/my-daemon.ts
npm run arena -- match cores/my-daemon.ts hunter --seed 7 --verbose
npm run arena -- match cores/my-daemon.ts hunter --seed 7 --replay out.replay.json   # watch it in the browser
npm run arena -- tournament cores/my-daemon.ts hunter phantom sentinel drifter spinner --rounds 20 --json
npm run arena -- build cores/my-daemon.ts              # -> cores/my-daemon.core.js (upload in the CORES tab)
```

- Core refs: builtin name (`hunter`, `phantom`, `sentinel`, `drifter`, `spinner`), a `.ts`/`.js` entry (bundled on the fly) or a built `.core.js`.
- `--json` prints machine-readable results (`MatchResult` / `TournamentResult` from `src/engine/*.ts`); errors print `{ "ok": false, "error": ... }` and exit 1.
- `--isolate` runs each core in its own `node:vm` context with a hard per-tick timeout — use it if your core may hang.
- Evaluate on many seeds (`--rounds 20+`) before trusting a change; single matches are noisy.

## Intel

- Projectiles fly straight at constant speed. A `hit` observed on tick `T` for a shot fired at tick `F` from `(x, y)` along `h` means the target was ≈ `radius + 5 + speed × (T − F)` units along that ray (`estimateImpactDistance`). `HUNTER` uses this to triangulate.
- `hurt` has no direction, but someone has a firing solution on you — evading or changing course breaks it.
- Moving and attacking compete for ticks; momentum lets you drift while firing.
- Baselines to beat, roughly in order: `HUNTER` > `PHANTOM` > `SENTINEL` > `DRIFTER` > `SPINNER`.
