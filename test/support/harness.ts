/**
 * Drives a MatchSim tick by tick with hand-picked actions, and lets a test place chassis at exact
 * positions (spawns are random). Reads simulator internals on purpose: these are white-box physics tests.
 */
import type { Action, DaemonEvent, Observation } from '../../src/api';
import type { ArenaConfig } from '../../src/engine/config';
import { MatchSim, type TickOutcome } from '../../src/engine/match';
import type { DaemonStats } from '../../src/engine/types';

export interface Chassis {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  integrity: number;
  attackCd: number;
  evadeCd: number;
  phase: number;
  alive: boolean;
  offline: boolean;
  events: DaemonEvent[];
  stats: DaemonStats;
}

interface Internals {
  daemons: Chassis[];
  projectiles: { x: number; y: number; owner: number; age: number }[];
}

type Answer = Action | TickOutcome | null;
const isOutcome = (a: Answer): a is TickOutcome => a !== null && typeof a === 'object' && 'ms' in a;

export class Harness {
  readonly sim: MatchSim;

  constructor(count: number, config: Partial<ArenaConfig> = {}, opts: { seed?: number; record?: boolean } = {}) {
    const metas = Array.from({ length: count }, (_, i) => ({ name: `D${i}` }));
    this.sim = new MatchSim(metas, { seed: opts.seed ?? 1, config, record: opts.record });
  }

  private get internals() {
    return this.sim as unknown as Internals;
  }

  chassis(id: number): Chassis {
    return this.internals.daemons[id];
  }

  stats(id: number): DaemonStats {
    return this.chassis(id).stats;
  }

  get projectiles() {
    return this.internals.projectiles;
  }

  /** Put a chassis somewhere, at rest unless velocities are given. */
  place(id: number, state: Partial<Chassis>): this {
    Object.assign(this.chassis(id), { vx: 0, vy: 0, ...state });
    return this;
  }

  /** One tick: observe, answer with `actions` (missing ids idle), simulate. Returns what each daemon observed. */
  step(actions: Record<number, Answer> = {}): Map<number, Observation> {
    const seen = new Map<number, Observation>();
    const outcomes = new Map<number, TickOutcome>();
    for (const { id, obs } of this.sim.observe()) {
      seen.set(id, obs);
      const a = actions[id] ?? null;
      outcomes.set(id, isOutcome(a) ? a : { raw: a, ms: 0 });
    }
    this.sim.step(outcomes);
    return seen;
  }

  /** Step `ticks` times; `actions` may depend on the tick about to be simulated. */
  run(ticks: number, actions: Record<number, Answer> | ((tick: number) => Record<number, Answer>) = {}) {
    for (let i = 0; i < ticks && !this.sim.done; i++) this.step(typeof actions === 'function' ? actions(this.sim.tick + 1) : actions);
  }

  /** Step until `cond` holds (or `limit` ticks). Returns the tick on which it became true. */
  until(cond: () => boolean, actions: Record<number, Answer> = {}, limit = 500): number {
    for (let i = 0; i < limit && !this.sim.done; i++) {
      this.step(actions);
      if (cond()) return this.sim.tick;
    }
    throw new Error(`condition not met within ${limit} ticks`);
  }

  /** What daemon `id` observes on the next tick (advances the clock by one idle tick). */
  nextObservation(id: number): Observation {
    const obs = this.step().get(id);
    if (!obs) throw new Error(`daemon ${id} is not observed`);
    return obs;
  }
}

export const move = (heading: number, throttle?: number): Action => ({ type: 'move', heading, throttle });
export const attack = (heading: number): Action => ({ type: 'attack', heading });
export const evade = (heading?: number): Action => ({ type: 'evade', heading });
