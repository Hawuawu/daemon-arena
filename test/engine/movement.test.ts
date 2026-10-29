import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../../src/engine/config';
import { Harness, move } from '../support/harness';

const centre = { x: 400, y: 400, heading: 0 };

describe('steering', () => {
  it('turns toward the requested heading by at most turnRate per tick', () => {
    const h = new Harness(1).place(0, centre);
    h.step({ 0: move(Math.PI / 2, 0) });
    expect(h.chassis(0).heading).toBeCloseTo(cfg.turnRate, 12);
    h.step({ 0: move(Math.PI / 2, 0) });
    expect(h.chassis(0).heading).toBeCloseTo(2 * cfg.turnRate, 12);
  });

  it('snaps exactly onto a heading that is within turnRate', () => {
    const h = new Harness(1).place(0, centre);
    h.step({ 0: move(0.1, 0) });
    expect(h.chassis(0).heading).toBeCloseTo(0.1, 12);
  });

  it('turns the short way across the ±π seam', () => {
    const h = new Harness(1).place(0, { ...centre, heading: 3.1 });
    h.step({ 0: move(-3.1, 0) });
    expect(h.chassis(0).heading).toBeCloseTo(-3.1, 12);
  });
});

describe('thrust and speed', () => {
  it('accelerates along the chassis heading, scaled by throttle', () => {
    const h = new Harness(1).place(0, centre);
    h.step({ 0: move(0, 0.5) });
    const c = h.chassis(0);
    expect(c.vx).toBeCloseTo(cfg.accel * 0.5, 12);
    expect(c.vy).toBeCloseTo(0, 12);
    expect(c.x).toBeCloseTo(400 + cfg.accel * 0.5, 12);
  });

  it('never exceeds maxSpeed under sustained thrust', () => {
    const h = new Harness(1).place(0, { ...centre, x: 100 });
    let top = 0;
    for (let i = 0; i < 60; i++) {
      h.step({ 0: move(0) });
      top = Math.max(top, Math.hypot(h.chassis(0).vx, h.chassis(0).vy));
    }
    expect(top).toBeLessThanOrEqual(cfg.maxSpeed + 1e-9);
    expect(top).toBeCloseTo(cfg.maxSpeed, 9);
  });

  it.each([
    ['idle', null],
    ['move with throttle 0', move(0, 0)],
  ])('coasts and loses speed to friction on %s', (_label, action) => {
    const h = new Harness(1).place(0, { ...centre, vx: 2 });
    h.step({ 0: action });
    expect(h.chassis(0).vx).toBeCloseTo(2 * cfg.friction, 12);
    expect(h.chassis(0).x).toBeCloseTo(400 + 2 * cfg.friction, 12);
  });
});

describe('arena walls', () => {
  const r = cfg.daemonRadius;
  const v = 3 * cfg.friction;
  it.each([
    ['west', { x: r + 1, vx: -3 }, { x: r, vx: v * cfg.wallBounce }],
    ['east', { x: cfg.width - r - 1, vx: 3 }, { x: cfg.width - r, vx: -v * cfg.wallBounce }],
    ['north', { y: r + 1, vy: -3 }, { y: r, vy: v * cfg.wallBounce }],
    ['south', { y: cfg.height - r - 1, vy: 3 }, { y: cfg.height - r, vy: -v * cfg.wallBounce }],
  ])('keep the chassis inside on the %s edge and bounce it back', (_edge, start, expected) => {
    const h = new Harness(1).place(0, { ...centre, ...start });
    h.step();
    for (const [k, val] of Object.entries(expected)) expect(h.chassis(0)[k as 'x']).toBeCloseTo(val, 9);
  });

  it('reports a bump as a wall event on the next tick only and counts it', () => {
    const h = new Harness(1).place(0, { ...centre, x: r + 1, vx: -3 });
    h.step();
    expect(h.stats(0).wallHits).toBe(1);
    expect(h.nextObservation(0).events).toEqual([{ type: 'wall' }]);
    expect(h.nextObservation(0).events).toEqual([]);
  });
});

describe('self observation', () => {
  it('exposes own position, velocity, speed, heading and cooldowns', () => {
    const h = new Harness(1).place(0, { ...centre, vx: 1, vy: 2, heading: 0.5 });
    h.step();
    const c = { ...h.chassis(0) };
    const { self } = h.nextObservation(0);
    expect(self).toEqual({
      x: c.x, y: c.y, heading: 0.5, vx: c.vx, vy: c.vy, speed: Math.hypot(c.vx, c.vy),
      integrity: cfg.maxIntegrity, attackCooldown: 0, evadeCooldown: 0, phasing: false,
    });
  });
});
