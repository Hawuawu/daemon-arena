import { describe, expect, it } from 'vitest';
import type { Observation } from '../../src/api';
import { compileCoreVm } from '../../src/runtime/node';
import { CoreLoadError, compileCore } from '../../src/runtime/sandbox';
import { builtin, builtinSource, idler, play, script, standing } from '../support/fixtures';

const obs = { self: { x: 0, y: 0 } } as Observation;
const vmCore = (body: string, timeoutMs = 50) => compileCoreVm(script('V', body), 'v', { timeoutMs });

describe('compileCoreVm (node:vm isolation)', () => {
  it.each([
    [['hunter', 'sentinel'], 5],
    [['phantom', 'drifter'], 11],
  ])('plays %j exactly like the in-process runtime (seed %i)', (names, seed) => {
    const vm = names.map((n) => compileCoreVm(builtinSource(n), n));
    expect(play(vm, { seed }).result).toEqual(play(names.map(builtin), { seed }).result);
  });

  it('exposes the same helpers and metadata', () => {
    const f = vmCore('// @color #00ff00\nfunction tick() { return [move(1, 0.5), angleTo(3, 4), distanceTo(3, 4)]; }');
    expect(f.meta).toEqual({ name: 'V', color: '#00ff00' });
    expect(f.create(1).tick(obs)).toEqual([{ type: 'move', heading: 1, throttle: 0.5 }, Math.atan2(4, 3), 5]);
  });

  it('seeds Math.random per instance', () => {
    const f = vmCore('const r = Math.random();\nfunction tick() { return r; }');
    expect(f.create(3).tick(obs)).toBe(f.create(3).tick(obs));
    expect(f.create(3).tick(obs)).not.toBe(f.create(4).tick(obs));
  });

  it('forwards init(arena) and logs', () => {
    const rt = vmCore('function init(a) { console.log("w", a.width); }\nfunction tick() { log("t"); }').create(1);
    rt.init({ width: 800 } as never);
    rt.tick(obs);
    expect(rt.drainLogs()).toEqual(['w 800', 't']);
  });

  it('blocks code generation, Date and Node globals', () => {
    const rt = vmCore(`function tick(o) {
      if (o.tick === 1) return eval("1");
      if (o.tick === 2) return new Function("return 1")();
      return [typeof Date, typeof process, typeof require];
    }`).create(1);
    expect(() => rt.tick({ ...obs, tick: 1 })).toThrow(/code generation/i);
    expect(() => rt.tick({ ...obs, tick: 2 })).toThrow(/code generation/i);
    expect(rt.tick({ ...obs, tick: 3 })).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('interrupts a tick that runs past the timeout', () => {
    const rt = vmCore('function tick() { for (;;) {} }', 20).create(1);
    expect(() => rt.tick(obs)).toThrow(/timed out/);
  });

  it('interrupts a hanging init()', () => {
    const rt = vmCore('function init() { for (;;) {} }\nfunction tick() {}', 20).create(1);
    expect(() => rt.init({} as never)).toThrow(/timed out/);
  });

  it('rejects a core that hangs while loading', () => {
    expect(() => vmCore('for (;;) {}\nfunction tick() {}', 20)).toThrow(CoreLoadError);
  });

  it.each([
    ['a missing tick()', 'let a = 1;', /function tick/],
    ['a syntax error', 'this is not js', /failed to load/],
  ])('rejects %s', (_label, body, message) => {
    expect(() => vmCore(body)).toThrow(message);
  });

  it('turns a hung tick into a fault and finishes the match', () => {
    const hang = vmCore('function tick(o) { if (o.tick === 3) for (;;) {} return null; }', 20);
    const { result } = play([hang, idler('OK')], { seed: 1, config: { maxTicks: 10 } });
    expect(result.ticks).toBe(10);
    // The timeout itself, and (since it took >= timeoutMs) possibly the blown tick budget too.
    expect(standing(result, 'V').faults).toBeGreaterThanOrEqual(1);
    expect(standing(result, 'V').faults).toBeLessThanOrEqual(2);
  });

  it('compiles the same sources as the in-process runtime', () => {
    expect(compileCoreVm(builtinSource('hunter')).meta).toEqual(compileCore(builtinSource('hunter')).meta);
  });
});
