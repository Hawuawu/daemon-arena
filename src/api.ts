/**
 * Types of the data a daemon core script sees. A core is a plain JavaScript file:
 * `// @name X` header + `function tick(obs) { return move(...) | evade(...) | attack(...) }`.
 * See AGENTS.md.
 *
 * A daemon cannot see other daemons. Each tick it receives an Observation of
 * its own chassis plus the events that happened to it since the previous tick,
 * and answers with exactly one Action: move, evade or attack (or nothing).
 */

/** Angles are radians. 0 = +x (east), PI/2 = +y (south, screen down). */
export type Radians = number;

export interface SelfState {
  x: number;
  y: number;
  /** Chassis heading. Changes gradually while moving (limited turn rate). */
  heading: Radians;
  vx: number;
  vy: number;
  speed: number;
  /** 0..maxIntegrity. At 0 the daemon is derezzed and stops acting. */
  integrity: number;
  /** Ticks until `attack` is available again (0 = ready). */
  attackCooldown: number;
  /** Ticks until `evade` is available again (0 = ready). */
  evadeCooldown: number;
  /** True while an evade dash is active: incoming projectiles pass through. */
  phasing: boolean;
}

export type DaemonEvent =
  /** One of your projectiles struck a daemon. `firedAt` is the tick you fired it. */
  | { type: 'hit'; firedAt: number }
  /** You were struck by a projectile. No direction, no attacker identity. */
  | { type: 'hurt' }
  /** Your chassis collided with the arena wall. */
  | { type: 'wall' };

export interface ArenaInfo {
  width: number;
  height: number;
  daemonRadius: number;
  maxSpeed: number;
  turnRate: Radians;
  projectileSpeed: number;
  attackCooldown: number;
  evadeCooldown: number;
  evadeTicks: number;
  maxIntegrity: number;
  hitDamage: number;
  /** Number of daemons in the match (including you). */
  daemons: number;
  maxTicks: number;
}

export interface Observation {
  tick: number;
  ticksLeft: number;
  self: SelfState;
  /** Events since your previous tick. Empty most of the time. */
  events: DaemonEvent[];
  arena: ArenaInfo;
}

export type Action =
  /** Turn the chassis toward `heading` (limited turn rate) and thrust with `throttle` 0..1 (default 1). */
  | { type: 'move'; heading: Radians; throttle?: number }
  /** Dash in `heading` (default: 90deg left of chassis) and phase through projectiles briefly. */
  | { type: 'evade'; heading?: Radians }
  /** Fire one projectile in `heading`. Independent of chassis heading. */
  | { type: 'attack'; heading: Radians }
  | { type: 'idle' };

/** Parsed from `// @key value` header comments in the core script. */
export interface CoreMeta {
  name: string;
  author?: string;
  version?: string;
  /** CSS color for the renderer, e.g. '#00f0ff'. */
  color?: string;
  description?: string;
}
