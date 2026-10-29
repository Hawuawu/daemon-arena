import { describe, expect, it } from 'vitest';
import { rankStandings } from '../../src/engine/match';
import type { DaemonStats } from '../../src/engine/types';

const stats = (s: Partial<DaemonStats>): DaemonStats => ({
  score: 0, hits: 0, hurts: 0, shots: 0, evades: 0, dodges: 0, wallHits: 0, faults: 0, derezzedAt: null, integrity: 100, ...s,
});
const entry = (id: number, s: Partial<DaemonStats>) => ({ id, name: `D${id}`, stats: stats(s) });

describe('rankStandings', () => {
  it('orders by score, highest first, and names a single winner', () => {
    const { standings, winner } = rankStandings([entry(0, { score: -10 }), entry(1, { score: 30 }), entry(2, { score: 0 })]);
    expect(standings.map((s) => [s.id, s.rank])).toEqual([[1, 1], [2, 2], [0, 3]]);
    expect(winner).toBe(1);
  });

  it('breaks score ties by remaining integrity', () => {
    const { standings, winner } = rankStandings([entry(0, { score: 10, integrity: 40 }), entry(1, { score: 10, integrity: 90 })]);
    expect(standings.map((s) => s.id)).toEqual([1, 0]);
    expect(winner).toBe(1);
  });

  it('gives equal results the same rank and declares no winner on a tie for first', () => {
    const { standings, winner } = rankStandings([entry(0, { score: 5 }), entry(1, { score: 5 }), entry(2, { score: -5 })]);
    expect(standings.map((s) => s.rank)).toEqual([1, 1, 3]);
    expect(winner).toBeNull();
  });

  it('computes accuracy as hits / shots rounded to 2 decimals, 0 without shots', () => {
    const { standings } = rankStandings([entry(0, { hits: 1, shots: 3 }), entry(1, { hits: 0, shots: 0 })]);
    expect(standings.find((s) => s.id === 0)!.accuracy).toBe(0.33);
    expect(standings.find((s) => s.id === 1)!.accuracy).toBe(0);
  });

  it('carries every stat through to the standing', () => {
    const s = stats({ score: 20, hits: 2, hurts: 1, shots: 4, evades: 3, dodges: 1, wallHits: 2, faults: 1, derezzedAt: 99, integrity: 0 });
    expect(rankStandings([{ id: 0, name: 'X', stats: s }]).standings[0]).toMatchObject({ ...s, id: 0, name: 'X', rank: 1 });
  });
});
