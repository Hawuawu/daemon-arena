import type { ArenaInfo, CoreMeta, Observation } from '../api';

/** A live, per-match instance of a daemon core. */
export interface CoreRuntime {
  readonly meta: CoreMeta;
  init(arena: ArenaInfo): void;
  /** Returns the raw (unvalidated) action produced by the core. May throw. */
  tick(obs: Observation): unknown;
  /** Drains log lines produced since the last call. */
  drainLogs(): string[];
  dispose?(): void;
}

/** A compiled daemon core that can spawn fresh runtimes for each match. */
export interface CoreFactory {
  readonly id: string;
  readonly meta: CoreMeta;
  readonly source: string;
  create(seed: number): CoreRuntime;
}
