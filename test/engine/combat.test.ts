import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../../src/engine/config';
import { attack, evade, Harness } from '../support/harness';

/** Shooter D0 at (200, 400) facing a target D1 at (400, 400), both at rest. */
function duel(config = {}) {
  return new Harness(2, config).place(0, { x: 200, y: 400, heading: 0 }).place(1, { x: 400, y: 400, heading: 0 });
}

/** Tick on which a shot fired east on tick 1 from x=200 strikes a chassis at x=400. */
const muzzle = cfg.daemonRadius + cfg.projectileRadius + 2;
const HIT_TICK = Math.ceil((400 - (cfg.daemonRadius + cfg.projectileRadius) - (200 + muzzle)) / cfg.projectileSpeed);

describe('attack', () => {
  it('spawns a projectile just outside the chassis in the requested direction, independent of chassis heading', () => {
    const h = new Harness(1).place(0, { x: 400, y: 400, heading: 0 });
    h.step({ 0: attack(Math.PI / 2) });
    const [p] = h.projectiles;
    expect(p.owner).toBe(0);
    expect(p.x).toBeCloseTo(400, 9);
    expect(p.y).toBeCloseTo(400 + muzzle + cfg.projectileSpeed, 9);
    expect(h.chassis(0).heading).toBe(0);
    expect(h.stats(0).shots).toBe(1);
  });

  it('can fire again only every attackCooldown ticks; attacking during cooldown is a no-op, not a fault', () => {
    const h = new Harness(1).place(0, { x: 400, y: 400 });
    const seen: number[] = [];
    for (let i = 0; i < 2 * cfg.attackCooldown + 1; i++) seen.push(h.step({ 0: attack(0) }).get(0)!.self.attackCooldown);
    expect(h.stats(0).shots).toBe(3);
    expect(h.stats(0).faults).toBe(0);
    expect(seen.slice(0, 3)).toEqual([0, cfg.attackCooldown, cfg.attackCooldown - 1]);
  });

  it('removes projectiles that leave the arena', () => {
    const h = new Harness(1).place(0, { x: cfg.width - 30, y: 400 });
    h.step({ 0: attack(0) });
    expect(h.projectiles).toHaveLength(0);
  });

  it('removes projectiles after projectileLifetime ticks', () => {
    const h = new Harness(1, { projectileLifetime: 3 }).place(0, { x: 100, y: 400 });
    h.step({ 0: attack(0) });
    h.step();
    expect(h.projectiles).toHaveLength(1);
    h.step();
    expect(h.projectiles).toHaveLength(0);
  });
});

describe('hits and scoring', () => {
  it('awards +hit to the shooter and hurt to the target when the projectile arrives', () => {
    const h = duel();
    h.step({ 0: attack(0) });
    const tick = h.until(() => h.stats(1).hurts > 0);
    expect(tick).toBe(HIT_TICK);
    expect(h.stats(0)).toMatchObject({ hits: 1, score: cfg.scoring.hit });
    expect(h.stats(1)).toMatchObject({ hurts: 1, score: cfg.scoring.hurt, integrity: cfg.maxIntegrity - cfg.hitDamage });
    expect(h.chassis(1).integrity).toBe(cfg.maxIntegrity - cfg.hitDamage);
    expect(h.projectiles).toHaveLength(0);
  });

  it('tells the shooter only "hit" with the firing tick, and the target only an anonymous "hurt"', () => {
    const h = duel();
    h.step({ 0: attack(0) });
    h.until(() => h.stats(1).hurts > 0);
    const seen = h.step();
    expect(seen.get(0)!.events).toEqual([{ type: 'hit', firedAt: 1 }]);
    expect(seen.get(1)!.events).toEqual([{ type: 'hurt' }]);
  });

  it('records who hit whom in the hit matrix', () => {
    const h = duel();
    h.step({ 0: attack(0) });
    h.until(() => h.stats(1).hurts > 0);
    expect(h.sim.finish().result.hitMatrix).toEqual([[0, 1], [0, 0]]);
  });

  it('uses the configured scoring rules', () => {
    const h = duel({ scoring: { hit: 3, hurt: -1 } });
    h.step({ 0: attack(0) });
    h.until(() => h.stats(1).hurts > 0);
    expect([h.stats(0).score, h.stats(1).score]).toEqual([3, -1]);
  });

  it('a projectile strikes only the first daemon in its path', () => {
    const h = new Harness(3).place(0, { x: 100, y: 400 }).place(1, { x: 300, y: 400 }).place(2, { x: 500, y: 400 });
    h.step({ 0: attack(0) });
    h.run(60);
    expect([h.stats(1).hurts, h.stats(2).hurts]).toEqual([1, 0]);
  });
});

describe('derez', () => {
  it('removes a daemon at 0 integrity: it stops acting, is no longer a target, and the match ends when one is left', () => {
    const h = new Harness(3, { maxIntegrity: cfg.hitDamage })
      .place(0, { x: 100, y: 400 }).place(1, { x: 300, y: 400 }).place(2, { x: 500, y: 400 });
    h.step({ 0: attack(0) });
    const derezTick = h.until(() => !h.chassis(1).alive);
    expect(h.stats(1).derezzedAt).toBe(derezTick);
    expect([...h.step().keys()]).toEqual([0, 2]);

    h.run(cfg.attackCooldown, { 0: attack(0) });
    h.until(() => h.sim.done);
    expect(h.stats(2).derezzedAt).not.toBeNull();
    expect(h.stats(1).hurts).toBe(1);
  });
});

describe('evade', () => {
  it('dashes at evadeSpeed in the requested direction (default: 90° left of the chassis)', () => {
    const explicit = new Harness(1).place(0, { x: 400, y: 400, heading: 0 });
    explicit.step({ 0: evade(Math.PI / 2) });
    expect(explicit.chassis(0).vy).toBeCloseTo(cfg.evadeSpeed * 0.9, 9);

    const byDefault = new Harness(1).place(0, { x: 400, y: 400, heading: 0 });
    byDefault.step({ 0: evade() });
    expect(byDefault.chassis(0).vy).toBeCloseTo(-cfg.evadeSpeed * 0.9, 9);
    expect(byDefault.stats(0).evades).toBe(1);
  });

  it('phases for evadeTicks ticks', () => {
    const h = new Harness(1).place(0, { x: 400, y: 400 });
    h.step({ 0: evade() });
    const phasing: boolean[] = [];
    for (let i = 0; i < cfg.evadeTicks + 1; i++) phasing.push(h.step().get(0)!.self.phasing);
    expect(phasing.filter(Boolean)).toHaveLength(cfg.evadeTicks);
    expect(phasing.at(-1)).toBe(false);
  });

  it('can be used again only after evadeCooldown ticks', () => {
    const h = new Harness(1).place(0, { x: 400, y: 400 });
    h.run(cfg.evadeCooldown + 1, { 0: evade(0) });
    expect(h.stats(0).evades).toBe(2);
    expect(h.stats(0).faults).toBe(0);
  });

  it('lets projectiles pass through while phasing: a dodge, no score change', () => {
    const h = duel({ evadeSpeed: 0 });
    h.step({ 0: attack(0) });
    h.run(HIT_TICK - 2 - cfg.evadeTicks / 2);
    h.step({ 1: evade() });
    h.run(cfg.evadeTicks);
    expect(h.stats(1)).toMatchObject({ dodges: 1, hurts: 0, score: 0 });
    expect(h.stats(0)).toMatchObject({ hits: 0, score: 0 });
  });
});
