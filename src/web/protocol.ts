/** Worker message protocol shared by main thread and sim worker. */
import type { ArenaConfig } from '../engine/config';
import type { TournamentMode, TournamentResult } from '../engine/tournament';
import type { Replay } from '../engine/types';
import type { CoreMeta } from '../api';

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
