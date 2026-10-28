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

export function runTournament(factories: CoreFactory[], opts: TournamentOptions): TournamentResult {
  const mode = opts.mode ?? 'duel';
  const baseSeed = opts.baseSeed ?? 1;
  const n = factories.length;
  const grid = () => factories.map(() => factories.map(() => 0));
  const scoreSum = grid();
  const winSum = grid();
  const hitSum = grid();
  const pairCount = grid();
  const rows: LeaderboardRow[] = factories.map((f, core) => ({
    core, name: f.meta.name, rank: 0, matches: 0, wins: 0, losses: 0, draws: 0, winRate: 0,
    totalScore: 0, meanScore: 0, hits: 0, hurts: 0, shots: 0, accuracy: 0, evades: 0, dodges: 0, faults: 0, derezzed: 0,
  }));
  const matches: TournamentResult['matches'] = [];

  const schedule: { seed: number; entrants: number[] }[] = [];
  if (mode === 'duel') {
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        for (let r = 0; r < opts.rounds; r++) schedule.push({ seed: hashSeed(baseSeed, r), entrants: r % 2 ? [j, i] : [i, j] });
  } else {
    for (let r = 0; r < opts.rounds; r++) schedule.push({ seed: hashSeed(baseSeed, r), entrants: factories.map((_, i) => i) });
  }

  schedule.forEach(({ seed, entrants }, idx) => {
    const runtimes = entrants.map((core, slot) => factories[core].create(hashSeed(seed, slot)));
    const { result } = runMatch(runtimes, { seed, config: opts.config });
    if (opts.keepMatches) matches.push({ seed, entrants, result });
    for (const s of result.standings) {
      const core = entrants[s.id];
      const row = rows[core];
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
    opts.onProgress?.(idx + 1, schedule.length);
  });

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
  return {
    mode,
    rounds: opts.rounds,
    baseSeed,
    cores: factories.map((f, id) => ({ id, name: f.meta.name, author: f.meta.author })),
    matrix: {
      score: mode === 'duel' ? factories.map((_, i) => factories.map((_, j) => cell(scoreSum, i, j))) : [],
      winRate: mode === 'duel' ? factories.map((_, i) => factories.map((_, j) => cell(winSum, i, j))) : [],
      hits: factories.map((_, i) => factories.map((_, j) => cell(hitSum, i, j))),
    },
    leaderboard: board,
    ...(opts.keepMatches ? { matches } : {}),
  };
}
