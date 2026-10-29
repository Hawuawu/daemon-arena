import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../src/engine/rng';

const take = (rng: () => number, n: number) => Array.from({ length: n }, rng);

describe('createRng (mulberry32)', () => {
  it('produces the same sequence for the same seed', () => {
    expect(take(createRng(42), 20)).toEqual(take(createRng(42), 20));
  });

  it('produces different sequences for different seeds', () => {
    expect(take(createRng(1), 5)).not.toEqual(take(createRng(2), 5));
  });

  it('returns floats in [0, 1) with a roughly uniform mean', () => {
    const xs = take(createRng(7), 10_000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0.5, 1);
  });

  it('treats seeds as unsigned 32-bit integers', () => {
    expect(take(createRng(-1), 3)).toEqual(take(createRng(0xffffffff), 3));
  });
});

describe('hashSeed', () => {
  it('is a deterministic unsigned 32-bit hash', () => {
    const h = hashSeed(1, 2);
    expect(h).toBe(hashSeed(1, 2));
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
  });

  it('depends on part order and part boundaries', () => {
    expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
    expect(hashSeed(12, 3)).not.toBe(hashSeed(1, 23));
  });

  it('gives every match slot a distinct seed', () => {
    const slots = new Set(Array.from({ length: 8 }, (_, slot) => hashSeed(99, slot)));
    expect(slots.size).toBe(8);
  });
});
