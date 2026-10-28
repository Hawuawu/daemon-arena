/** Message protocols: main thread <-> sim worker, and sim worker <-> per-core workers. */
import type { ArenaInfo, CoreMeta, Observation } from '../api';
import type { ArenaConfig } from '../engine/config';
import type { TournamentMode, TournamentResult } from '../engine/tournament';
import type { Replay } from '../engine/types';

export interface CoreSource {
  id: string;
  source: string;
}

export type WorkerRequest =
  | { type: 'match'; id: number; cores: CoreSource[]; seed: number; config: Partial<ArenaConfig> }
  | { type: 'tournament'; id: number; cores: CoreSource[]; rounds: number; seed: number; mode: TournamentMode; config: Partial<ArenaConfig> }
  | { type: 'validate'; id: number; source: string };

export type WorkerResponse =
  | { type: 'match'; id: number; replay: Replay; logs: { daemon: number; line: string }[] }
  | { type: 'tournament'; id: number; result: TournamentResult }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'validate'; id: number; meta: CoreMeta }
  | { type: 'error'; id: number; message: string };

export type CoreOp =
  | { op: 'create'; inst: number; seed: number }
  | { op: 'init'; inst: number; arena: ArenaInfo }
  | { op: 'tick'; inst: number; obs: Observation }
  | { op: 'dispose'; inst: number };

export interface CoreOpResult {
  inst: number;
  ms: number;
  raw?: unknown;
  error?: string;
  logs?: string[];
}

export type CoreWorkerIn = { type: 'load'; id: string; source: string } | { type: 'ops'; batch: number; ops: CoreOp[] };

export type CoreWorkerOut =
  | { type: 'loaded'; meta: CoreMeta }
  | { type: 'load-error'; message: string }
  | { type: 'results'; batch: number; results: CoreOpResult[] };
