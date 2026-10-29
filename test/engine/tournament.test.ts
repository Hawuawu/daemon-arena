import { describe, expect, it, vi } from 'vitest';
import { rankStandings } from '../../src/engine/match';
import { hashSeed } from '../../src/engine/rng';
import { aggregateTournament, planTournament, runTournament } from '../../src/engine/tournament';
import type { DaemonStats, MatchResult } from '../../src/engine/types';
import { builtin, idler, play } from '../support/fixtures';

/** A MatchResult for daemons in slot order, ranked by the real ranking rules. */
function result(slots: Partial<DaemonStats>[], hitMatrix?: number[][]): MatchResult {
  const daemons = slots.map((s, id) => ({
    id, name: `S${id}`,
    stats: { score: 0, hits: 0, hurts: 0, shots: 0, evades: 0, dodges: 0, wallHits: 0, faults: 0, derezzedAt: null, integrity: 100, ...s },
  }));
  const { standings, winner } = rankStandings(daemons);
  return { seed: 0, ticks: 100, standings, winner, hitMatrix: hitMatrix ?? slots.map(() => slots.map(() => 0)) };
}
const metas = (...names: string[]) => names.map((name) => ({ name }));

describe('planTournament', () => {
  it('schedules every pair `rounds` times in duel mode, alternating sides', () => {
    const plan = planTournament(3, { rounds: 2, baseSeed: 5 });
    expect(plan.map((m) => m.entrants)).toEqual([[0, 1], [1, 0], [0, 2], [2, 0], [1, 2], [2, 1]]);
    expect(plan.map((m) => m.seed)).toEqual([0, 1, 0, 1, 0, 1].map((r) => hashSeed(5, r)));
  });

  it('schedules `rounds` all-vs-all matches in ffa mode', () => {
    const plan = planTournament(4, { rounds: 3, mode: 'ffa', baseSeed: 1 });
    expect(plan).toHaveLength(3);
    expect(plan.every((m) => m.entrants.join() === '0,1,2,3')).toBe(true);
  });

  it('defaults to duel mode with base seed 1', () => {
    expect(planTournament(2, { rounds: 1 })).toEqual([{ seed: hashSeed(1, 0), entrants: [0, 1] }]);
  });
});

describe('aggregateTournament', () => {
  // A beats B 20:-20 from slot 0, then they draw 0:0 with sides swapped.
  const played = [
    { seed: 1, entrants: [0, 1], result: result([{ score: 20, hits: 2, shots: 4 }, { score: -20, hurts: 2, derezzedAt: 50, faults: 1 }], [[0, 2], [0, 0]]) },
    { seed: 2, entrants: [1, 0], result: result([{ score: 0 }, { score: 0 }]) },
  ];
  const t = aggregateTournament(metas('A', 'B'), { rounds: 2, baseSeed: 1 }, played);
  const row = (name: string) => t.leaderboard.find((r) => r.name === name)!;

  it('counts wins, losses and draws per core (draw = half a win)', () => {
    expect(row('A')).toMatchObject({ matches: 2, wins: 1, losses: 0, draws: 1, winRate: 0.75 });
    expect(row('B')).toMatchObject({ matches: 2, wins: 0, losses: 1, draws: 1, winRate: 0.25 });
  });

  it('sums combat stats and derives mean score and accuracy', () => {
    expect(row('A')).toMatchObject({ totalScore: 20, meanScore: 10, hits: 2, shots: 4, accuracy: 0.5 });
    expect(row('B')).toMatchObject({ totalScore: -20, meanScore: -10, hurts: 2, derezzed: 1, faults: 1, accuracy: 0 });
  });

  it('maps match slots back to cores when building the pairwise matrices', () => {
    expect(t.matrix.score).toEqual([[null, 10], [-10, null]]);
    expect(t.matrix.winRate).toEqual([[null, 0.75], [0.25, null]]);
    expect(t.matrix.hits).toEqual([[null, 1], [0, null]]);
  });

  it('ranks by mean score', () => {
    expect(t.leaderboard.map((r) => [r.name, r.rank])).toEqual([['A', 1], ['B', 2]]);
    expect(t).toMatchObject({ mode: 'duel', rounds: 2, baseSeed: 1, cores: [{ id: 0, name: 'A' }, { id: 1, name: 'B' }] });
    expect(t.matches).toBeUndefined();
  });

  it('shares a rank between cores with identical mean score and win rate', () => {
    const tie = aggregateTournament(metas('A', 'B', 'C'), { rounds: 1 }, [
      { seed: 1, entrants: [0, 1, 2], result: result([{ score: 10 }, { score: 10 }, { score: -20 }]) },
    ]);
    expect(tie.leaderboard.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('keeps individual matches on request', () => {
    const kept = aggregateTournament(metas('A', 'B'), { rounds: 2, keepMatches: true }, played);
    expect(kept.matches!.map((m) => m.seed)).toEqual([1, 2]);
  });

  it('only reports the hit matrix in ffa mode', () => {
    const ffa = aggregateTournament(metas('A', 'B', 'C'), { rounds: 1, mode: 'ffa' }, [
      { seed: 1, entrants: [0, 1, 2], result: result([{}, {}, {}], [[0, 1, 2], [0, 0, 0], [3, 0, 0]]) },
    ]);
    expect(ffa.matrix.score).toEqual([]);
    expect(ffa.matrix.winRate).toEqual([]);
    expect(ffa.matrix.hits).toEqual([[null, 1, 2], [0, null, 0], [3, 0, null]]);
  });
});

describe('runTournament', () => {
  const cores = () => ['hunter', 'phantom', 'spinner'].map(builtin);

  it('plays the planned schedule and reports progress', () => {
    const onProgress = vi.fn();
    const t = runTournament(cores(), { rounds: 2, baseSeed: 9, onProgress, keepMatches: true });
    expect(onProgress).toHaveBeenCalledTimes(6);
    expect(onProgress).toHaveBeenLastCalledWith(6, 6);
    expect(t.matches!.map(({ seed, entrants }) => ({ seed, entrants }))).toEqual(planTournament(3, { rounds: 2, baseSeed: 9 }));
  });

  it('matches the result of playing each scheduled match individually', () => {
    const t = runTournament(cores(), { rounds: 1, baseSeed: 4, keepMatches: true });
    for (const m of t.matches!) expect(m.result).toEqual(play(m.entrants.map((i) => cores()[i]), { seed: m.seed }).result);
  });

  it('produces zero-sum duel matrices', () => {
    const t = runTournament(cores(), { rounds: 3, baseSeed: 9 });
    for (let i = 0; i < 3; i++) {
      expect(t.matrix.score[i][i]).toBeNull();
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        expect(t.matrix.score[i][j]! + t.matrix.score[j][i]!).toBeCloseTo(0, 6);
        expect(t.matrix.winRate[i][j]! + t.matrix.winRate[j][i]!).toBeCloseTo(1, 6);
      }
    }
  });

  it('is deterministic for a base seed', () => {
    expect(runTournament(cores(), { rounds: 2, baseSeed: 3 })).toEqual(runTournament(cores(), { rounds: 2, baseSeed: 3 }));
  });

  it('passes config overrides to every match', () => {
    const t = runTournament([idler('A'), idler('B')], { rounds: 1, config: { maxTicks: 10 }, keepMatches: true });
    expect(t.matches![0].result.ticks).toBe(10);
    expect(t.leaderboard.every((r) => r.draws === 1)).toBe(true);
  });
});
