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

Faults (count in stats, action becomes idle): throwing, returning an invalid action, exceeding the per-tick time budget (20 ms; hard 50 ms timeout under `--isolate`, worker terminated after 3 s in the browser).

## Core format

A core is **one plain JavaScript file**. The same file runs in the CLI and uploads unchanged at https://arena.maiyun.eu (CORES tab).

```js
// @name   MY-DAEMON        (required, max 24 chars)
// @author agent
// @color  #9d4dff

let aim = random() * TAU;   // top-level variables persist for the whole match

function tick(obs) {        // every tick: return ONE action
  const me = obs.self;
  if (obs.events.some((e) => e.type === 'hurt') && me.evadeCooldown === 0) return evade();
  if (me.attackCooldown === 0) return attack((aim += 0.4));
  return move(angleTo(obs.arena.width / 2, obs.arena.height / 2), 0.5);
}

// optional: function init(arena) { ... }  runs once before the first tick
```

- `obs = { tick, ticksLeft, self, events, arena }`; full types in [`src/api.ts`](src/api.ts).
- Globals: `move(heading, throttle?)`, `evade(heading?)`, `attack(heading)`, `idle()`, `angleTo(x, y)` and `distanceTo(x, y)` (from your chassis), `wrapAngle(a)`, `TAU`, `random()`, `log(...)`. You can also return plain objects like `{ type: 'attack', heading }`.
- `random()` / `Math.random()` are seeded per daemon, so matches are reproducible from the seed. A fresh instance (fresh top-level state) is created for every match.
- No `Date`, timers, network, DOM, storage, `eval`/`Function`, imports or `require`. One file, no build step.
- `log(...)` / `console.log(...)` output shows with `--verbose` in the CLI and in the browser signal feed.
- In the browser each core runs in its own locked-down Web Worker on the viewer's machine; a core that does not answer for 3 s is terminated and its chassis stays in the arena as a target (counts as a fault).

## Workflow

```bash
npm install
npm run arena -- new my-daemon                         # scaffold my-daemon.js
npm run arena -- validate my-daemon.js
npm run arena -- match my-daemon.js hunter --seed 7 --verbose
npm run arena -- match my-daemon.js hunter --seed 7 --replay out.replay.json   # watch it in the browser
npm run arena -- tournament my-daemon.js hunter phantom sentinel drifter spinner --rounds 20 --json
```

- Core refs: builtin name (`hunter`, `phantom`, `sentinel`, `drifter`, `spinner` from [`cores/`](cores/)) or a path to a `.js` core.
- `--json` prints machine-readable results (`MatchResult` / `TournamentResult` from `src/engine/*.ts`); errors print `{ "ok": false, "error": ... }` and exit 1.
- `--isolate` runs each core in its own `node:vm` context with a hard per-tick timeout — use it if your core may hang.
- Evaluate on many seeds (`--rounds 20+`) before trusting a change; single matches are noisy. The same seed is reproducible within the CLI (or within one browser); CLI and browser can diverge slightly because their `Math.sin`/`cos` differ in the last bits.

## Intel

- Projectiles fly straight at constant speed. A `hit` observed on tick `T` for a shot fired at tick `F` from `(x, y)` along `h` means the target was ≈ `radius + 5 + speed × (T − F)` units along that ray. [`cores/hunter.js`](cores/hunter.js) uses this to triangulate.
- `hurt` has no direction, but someone has a firing solution on you — evading or changing course breaks it.
- Moving and attacking compete for ticks; momentum lets you drift while firing.
- Baselines to beat, roughly in order: `HUNTER` > `PHANTOM` > `SENTINEL` > `DRIFTER` > `SPINNER`.
