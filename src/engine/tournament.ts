import type { CoreMeta } from '../api';
import type { CoreFactory } from '../runtime/types';
import type { ArenaConfig } from './config';
import { runMatch } from './match';
import { hashSeed } from './rng';
import type { MatchResult } from './types';

export type TournamentMode = 'duel' | 'ffa';

export interface TournamentOptions {
  /** Number of seeds per pairing (duel) or number of matches (ffa). */
  rounds: number;
  baseSeed?: number;
  mode?: TournamentMode;
  config?: Partial<ArenaConfig>;
  /** Keep every individual MatchResult in the output. */
  keepMatches?: boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface LeaderboardRow {
  core: number;
  name: string;
  rank: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** (wins + 0.5 * draws) / matches */
  winRate: number;
  totalScore: number;
  meanScore: number;
  hits: number;
  hurts: number;
  shots: number;
  accuracy: number;
  evades: number;
  dodges: number;
  faults: number;
  derezzed: number;
}

export interface TournamentResult {
  mode: TournamentMode;
  rounds: number;
  baseSeed: number;
  cores: { id: number; name: string; author?: string }[];
  /**
   * Pairwise matrices, indexed [row core][column core].
   * duel: score = mean score of row vs column; winRate = row's win rate vs column.
   * both modes: hits = mean projectiles from row that struck column per match.
   * Diagonal is null in duel mode.
   */
  matrix: {
    score: (number | null)[][];
    winRate: (number | null)[][];
    hits: (number | null)[][];
  };
  leaderboard: LeaderboardRow[];
  matches?: { seed: number; entrants: number[]; result: MatchResult }[];
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export interface ScheduledMatch {
  seed: number;
  /** entrants[slot] = core index. */
  entrants: number[];
}

/** Deterministic match schedule. Slot seeds are `hashSeed(match.seed, slot)`. */
export function planTournament(coreCount: number, opts: Pick<TournamentOptions, 'rounds' | 'baseSeed' | 'mode'>): ScheduledMatch[] {
  const mode = opts.mode ?? 'duel';
  const baseSeed = opts.baseSeed ?? 1;
  const schedule: ScheduledMatch[] = [];
  if (mode === 'duel') {
    for (let i = 0; i < coreCount; i++)
      for (let j = i + 1; j < coreCount; j++)
        for (let r = 0; r < opts.rounds; r++) schedule.push({ seed: hashSeed(baseSeed, r), entrants: r % 2 ? [j, i] : [i, j] });
  } else {
    for (let r = 0; r < opts.rounds; r++) schedule.push({ seed: hashSeed(baseSeed, r), entrants: Array.from({ length: coreCount }, (_, i) => i) });
  }
  return schedule;
}

export function aggregateTournament(
  metas: CoreMeta[],
  opts: Pick<TournamentOptions, 'rounds' | 'baseSeed' | 'mode' | 'keepMatches'>,
  played: (ScheduledMatch & { result: MatchResult })[],
): TournamentResult {
  const mode = opts.mode ?? 'duel';
  const baseSeed = opts.baseSeed ?? 1;
  const grid = () => metas.map(() => metas.map(() => 0));
  const scoreSum = grid();
  const winSum = grid();
  const hitSum = grid();
  const pairCount = grid();
  const rows: LeaderboardRow[] = metas.map((m, core) => ({
    core, name: m.name, rank: 0, matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
    totalScore: 0, meanScore: 0, hits: 0, hurts: 0, shots: 0, accuracy: 0, evades: 0, dodges: 0, faults: 0, derezzed: 0,
  }));

  for (const { entrants, result } of played) {
    for (const s of result.standings) {
      const row = rows[entrants[s.id]];
      row.matches++;
      row.totalScore += s.score;
      row.hits += s.hits;
      row.hurts += s.hurts;
      row.shots += s.shots;
      row.evades += s.evades;
      row.dodges += s.dodges;
      row.faults += s.faults;
      if (s.derezzedAt !== null) row.derezzed++;
      if (result.winner === null && s.rank === 1) row.draws++;
      else if (result.winner === s.id) row.wins++;
      else row.losses++;
    }
    entrants.forEach((a, sa) => {
      entrants.forEach((b, sb) => {
        if (sa === sb) return;
        pairCount[a][b]++;
        hitSum[a][b] += result.hitMatrix[sa][sb];
        if (mode === 'duel') {
          scoreSum[a][b] += result.standings.find((s) => s.id === sa)!.score;
          winSum[a][b] += result.winner === sa ? 1 : result.winner === null ? 0.5 : 0;
        }
      });
    });
  }

  for (const row of rows) {
    row.meanScore = row.matches ? r3(row.totalScore / row.matches) : 0;
    row.winRate = row.matches ? r3((row.wins + 0.5 * row.draws) / row.matches) : 0;
    row.accuracy = row.shots ? r3(row.hits / row.shots) : 0;
  }
  const board = [...rows].sort((a, b) => b.meanScore - a.meanScore || b.winRate - a.winRate || a.core - b.core);
  board.forEach((row, i) => {
    const prev = board[i - 1];
    row.rank = prev && prev.meanScore === row.meanScore && prev.winRate === row.winRate ? prev.rank : i + 1;
  });

  const cell = (sum: number[][], i: number, j: number) => (i === j || !pairCount[i][j] ? null : r3(sum[i][j] / pairCount[i][j]));
  const square = (sum: number[][]) => metas.map((_, i) => metas.map((_, j) => cell(sum, i, j)));
  return {
    mode,
    rounds: opts.rounds,
    baseSeed,
    cores: metas.map((m, id) => ({ id, name: m.name, author: m.author })),
    matrix: {
      score: mode === 'duel' ? square(scoreSum) : [],
      winRate: mode === 'duel' ? square(winSum) : [],
      hits: square(hitSum),
    },
    leaderboard: board,
    ...(opts.keepMatches ? { matches: played.map(({ seed, entrants, result }) => ({ seed, entrants, result })) } : {}),
  };
}

/** Synchronous tournament (CLI, tests). */
export function runTournament(factories: CoreFactory[], opts: TournamentOptions): TournamentResult {
  const schedule = planTournament(factories.length, opts);
  const played = schedule.map((m, idx) => {
    const runtimes = m.entrants.map((core, slot) => factories[core].create(hashSeed(m.seed, slot)));
    const { result } = runMatch(runtimes, { seed: m.seed, config: opts.config });
    opts.onProgress?.(idx + 1, schedule.length);
    return { ...m, result };
  });
  return aggregateTournament(factories.map((f) => f.meta), opts, played);
}
