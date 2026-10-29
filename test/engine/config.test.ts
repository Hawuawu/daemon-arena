import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_SCORING, resolveConfig } from '../../src/engine/config';

describe('arena config', () => {
  it('matches the rules documented in AGENTS.md', () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      width: 800, height: 800, maxTicks: 3000, daemonRadius: 20, maxSpeed: 4, turnRate: 0.14,
      projectileSpeed: 13, attackCooldown: 15, evadeCooldown: 75, evadeTicks: 14, evadeSpeed: 12,
      maxIntegrity: 100, hitDamage: 5, tickBudgetMs: 20,
    });
    expect(DEFAULT_SCORING).toEqual({ hit: 10, hurt: -10 });
  });

  it('returns the defaults when nothing is overridden', () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG);
  });

  it('applies overrides and merges partial scoring with the default scoring', () => {
    const cfg = resolveConfig({ maxTicks: 10, scoring: { hit: 3 } as never });
    expect(cfg.maxTicks).toBe(10);
    expect(cfg.width).toBe(DEFAULT_CONFIG.width);
    expect(cfg.scoring).toEqual({ hit: 3, hurt: -10 });
  });

  it('never mutates the shared defaults', () => {
    resolveConfig({ scoring: { hit: 1, hurt: -1 } }).scoring.hit = 99;
    expect(DEFAULT_CONFIG.scoring).toEqual({ hit: 10, hurt: -10 });
  });
});
