import type { Action, CoreMeta } from '../api';
import type { ArenaConfig } from './config';

export interface DaemonStats {
  score: number;
  hits: number;
  hurts: number;
  shots: number;
  evades: number;
  /** Projectiles that passed through this daemon while it was phasing. */
  dodges: number;
  wallHits: number;
  /** Ticks where the core threw, returned an invalid action or blew its time budget. */
  faults: number;
  /** Tick at which integrity reached 0, or null if it survived. */
  derezzedAt: number | null;
  integrity: number;
}

export interface Standing extends DaemonStats {
  id: number;
  name: string;
  rank: number;
  accuracy: number;
}

export interface MatchResult {
  seed: number;
  ticks: number;
  standings: Standing[];
  /** Daemon id with the best score, or null on a tie for first. */
  winner: number | null;
  /** hitMatrix[a][b] = projectiles fired by daemon a that struck daemon b. */
  hitMatrix: number[][];
}

export type FrameEvent =
  | { k: 'fire'; d: number; x: number; y: number; h: number }
  | { k: 'hit'; d: number; by: number; x: number; y: number }
  | { k: 'dodge'; d: number; x: number; y: number }
  | { k: 'evade'; d: number; h: number }
  | { k: 'wall'; d: number; x: number; y: number }
  | { k: 'derez'; d: number; x: number; y: number }
  | { k: 'fault'; d: number; msg: string };

/** Per-daemon frame tuple: [x, y, heading, integrity, score, flags]. flags: 1=alive, 2=phasing, 4=moving */
export type FrameDaemon = [number, number, number, number, number, number];
/** Projectile tuple: [x, y, ownerId]. */
export type FrameProjectile = [number, number, number];

export interface Frame {
  t: number;
  d: FrameDaemon[];
  p: FrameProjectile[];
  e: FrameEvent[];
}

export interface ReplayDaemon {
  id: number;
  name: string;
  color: string;
  author?: string;
}

export interface Replay {
  format: 'daemon-arena-replay';
  version: 1;
  seed: number;
  config: ArenaConfig;
  daemons: ReplayDaemon[];
  frames: Frame[];
  result: MatchResult;
}

export interface TickTrace {
  tick: number;
  daemon: number;
  action: Action;
}

export interface EntrantInfo {
  meta: CoreMeta;
}
