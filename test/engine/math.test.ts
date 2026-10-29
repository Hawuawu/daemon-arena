import { describe, expect, it } from 'vitest';
import { clamp, normalizeAngle, round2, segmentHitsCircle, TAU } from '../../src/engine/math';

describe('normalizeAngle', () => {
  it.each([
    [0, 0],
    [Math.PI, Math.PI],
    [-Math.PI, Math.PI],
    [TAU, 0],
    [3 * Math.PI, Math.PI],
    [-Math.PI / 2 - TAU, -Math.PI / 2],
    [1.5 * Math.PI, -Math.PI / 2],
  ])('maps %f into (-π, π] as %f', (input, expected) => {
    expect(normalizeAngle(input)).toBeCloseTo(expected, 12);
  });
});

describe('clamp', () => {
  it.each([
    [-1, 0],
    [0.5, 0.5],
    [2, 1],
  ])('clamp(%f, 0, 1) = %f', (v, expected) => expect(clamp(v, 0, 1)).toBe(expected));
});

describe('segmentHitsCircle', () => {
  it('detects a segment passing through the circle (tunnelling-proof)', () => {
    expect(segmentHitsCircle(0, 0, 100, 0, 50, 0, 1)).toBe(true);
  });

  it('counts touching the edge as a hit and misses just outside it', () => {
    expect(segmentHitsCircle(0, 5, 100, 5, 50, 0, 5)).toBe(true);
    expect(segmentHitsCircle(0, 5.01, 100, 5.01, 50, 0, 5)).toBe(false);
  });

  it('only considers the segment, not the infinite line', () => {
    expect(segmentHitsCircle(0, 0, 10, 0, 50, 0, 5)).toBe(false);
    expect(segmentHitsCircle(60, 0, 100, 0, 50, 0, 5)).toBe(false);
  });

  it('handles a zero-length segment as a point test', () => {
    expect(segmentHitsCircle(3, 4, 3, 4, 0, 0, 5)).toBe(true);
    expect(segmentHitsCircle(3, 4, 3, 4, 0, 0, 4.9)).toBe(false);
  });
});

describe('round2', () => {
  it('rounds to two decimals', () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(-0.004)).toBe(-0);
  });
});
