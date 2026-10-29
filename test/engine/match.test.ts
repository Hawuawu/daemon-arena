import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../src/engine/config';
import { arenaInfo, MatchSim, PALETTE, runMatch } from '../../src/engine/match';
import { compileCore } from '../../src/runtime/sandbox';
import type { CoreRuntime } from '../../src/runtime/types';
import { builtin, core, idler, play, script, standing } from '../support/fixtures';
import { attack, Harness } from '../support/harness';

describe('match lifecycle', () => {
  it('runs until maxTicks and is a draw when nobody scores', () => {
    const { result } = play([idler('A'), idler('B')], { seed: 1, config: { maxTicks: 50 } });
    expect(result.ticks).toBe(50);
    expect(result.winner).toBeNull();
    expect(result.standings.map((s) => s.rank)).toEqual([1, 1]);
  });

  it('never calls a core when maxTicks is 0', () => {
    const boom = core('BOOM', 'function tick() { throw new Error("called"); }');
    const { result } = play([boom, idler()], { seed: 1, config: { maxTicks: 0 } });
    expect(result.ticks).toBe(0);
    expect(standing(result, 'BOOM').faults).toBe(0);
  });

  it('lets a single daemon run until maxTicks', () => {
    expect(play([idler()], { seed: 1, config: { maxTicks: 30 } }).result.ticks).toBe(30);
  });

  it('ends as soon as only one daemon is left', () => {
    const h = new Harness(2, { maxIntegrity: 5 }).place(0, { x: 200, y: 400 }).place(1, { x: 400, y: 400 });
    h.step({ 0: attack(0) });
    const tick = h.until(() => h.sim.done);
    expect(h.sim.finish().result).toMatchObject({ ticks: tick, winner: 0 });
    expect(h.sim.observe()).toEqual([]);
  });
});

describe('observations', () => {
  it('gives each daemon the tick, ticks left, and the arena constants it may rely on', () => {
    const h = new Harness(3, { maxTicks: 100 });
    const obs = h.step().get(2)!;
    expect(obs.tick).toBe(1);
    expect(obs.ticksLeft).toBe(99);
    expect(obs.arena).toEqual(arenaInfo(resolveConfig({ maxTicks: 100 }), 3));
    expect(obs.arena.daemons).toBe(3);
  });

  it('never reveals other daemons', () => {
    const obs = new Harness(2).step().get(0)!;
    expect(Object.keys(obs).sort()).toEqual(['arena', 'events', 'self', 'tick', 'ticksLeft']);
    expect(JSON.stringify(obs)).not.toContain('D1');
  });

  it('spawns every daemon inside the arena margins', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const h = new Harness(8, {}, { seed });
      for (let id = 0; id < 8; id++) {
        const { x, y, heading } = h.chassis(id);
        expect(x).toBeGreaterThanOrEqual(80);
        expect(x).toBeLessThanOrEqual(720);
        expect(y).toBeGreaterThanOrEqual(80);
        expect(y).toBeLessThanOrEqual(720);
        expect(Math.abs(heading)).toBeLessThanOrEqual(Math.PI);
      }
    }
  });
});

describe('faults', () => {
  it('counts a thrown error as a fault and treats the tick as idle', () => {
    const bad = core('BAD', 'function tick() { throw new Error("kaput"); }');
    const { result, replay } = play([bad, idler()], { seed: 1, record: true, config: { maxTicks: 5 } });
    expect(standing(result, 'BAD').faults).toBe(5);
    expect(replay!.frames[1].e).toContainEqual({ k: 'fault', d: 0, msg: 'kaput' });
  });

  it('counts an invalid action as a fault', () => {
    const bad = core('BAD', 'function tick() { return { type: "teleport" }; }');
    const { result, replay } = play([bad, idler()], { seed: 1, record: true, config: { maxTicks: 3 } });
    expect(standing(result, 'BAD').faults).toBe(3);
    expect(replay!.frames[1].e[0]).toMatchObject({ k: 'fault', msg: expect.stringContaining('invalid action') });
  });

  it('counts a tick over the time budget as a fault and discards its action', () => {
    let clock = 0;
    const slow = core('SLOW', 'function tick() { return move(0); }');
    const { result, replay } = play([slow, idler()], {
      seed: 1, record: true, config: { maxTicks: 4, tickBudgetMs: 20 }, now: () => (clock += 25),
    });
    expect(standing(result, 'SLOW').faults).toBe(4);
    const xs = replay!.frames.map((f) => f.d[0][0]);
    expect(new Set(xs).size).toBe(1);
  });

  it('counts a throwing init() as one fault and keeps the core in the match', () => {
    const src = script('INIT', 'function init() { throw new Error("no"); }\nfunction tick() { return idle(); }');
    const { result, replay } = play([compileCore(src), idler()], { seed: 1, record: true, config: { maxTicks: 3 } });
    expect(standing(result, 'INIT').faults).toBe(1);
    expect(replay!.frames[1].e).toContainEqual({ k: 'fault', d: 0, msg: 'init: no' });
  });

  it('keeps an offline (terminated) core on the field as a target', () => {
    const h = new Harness(2).place(0, { x: 200, y: 400 }).place(1, { x: 400, y: 400 });
    h.sim.setOffline(1, 'core unresponsive');
    h.sim.setOffline(1, 'again');
    expect([...h.step({ 0: attack(0) }).keys()]).toEqual([0]);
    h.until(() => h.stats(1).hurts > 0);
    expect(h.stats(1).faults).toBe(1);
  });
});

describe('runMatch runtime contract', () => {
  it('routes init and tick logs to onLog with the daemon id', () => {
    const talker = core('TALK', 'function init() { log("ready"); }\nfunction tick(o) { log("t", o.tick); return idle(); }');
    const onLog = vi.fn();
    play([idler(), talker], { seed: 1, config: { maxTicks: 2 }, onLog });
    expect(onLog.mock.calls).toEqual([[1, 'ready'], [1, 't 1'], [1, 't 2']]);
  });

  it('disposes every runtime when the match ends', () => {
    const dispose = vi.fn();
    const rt: CoreRuntime = { meta: { name: 'R' }, init() {}, tick: () => null, drainLogs: () => [], dispose };
    runMatch([rt, { ...rt }], { seed: 1, config: { maxTicks: 3 } });
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});

describe('determinism and replays', () => {
  const pair = () => [builtin('hunter'), builtin('phantom')];

  it('reproduces the same match and replay from the same seed', () => {
    const a = play(pair(), { seed: 42, record: true });
    const b = play(pair(), { seed: 42, record: true });
    expect(a.result).toEqual(b.result);
    expect(JSON.stringify(a.replay)).toBe(JSON.stringify(b.replay));
  });

  it('plays a different match for a different seed', () => {
    expect(play(pair(), { seed: 43 }).result).not.toEqual(play(pair(), { seed: 42 }).result);
  });

  it('records the same result whether or not a replay is recorded', () => {
    expect(play(pair(), { seed: 7, record: true }).result).toEqual(play(pair(), { seed: 7 }).result);
  });

  it('records one frame per tick plus the spawn frame', () => {
    const { result, replay } = play(pair(), { seed: 3, record: true, config: { maxTicks: 40 } });
    expect(replay).toMatchObject({ format: 'daemon-arena-replay', version: 1, seed: 3, result });
    expect(replay!.config.maxTicks).toBe(40);
    expect(replay!.frames.map((f) => f.t)).toEqual(Array.from({ length: result.ticks + 1 }, (_, i) => i));
    for (const f of replay!.frames) for (const d of f.d) expect(d).toHaveLength(6);
    expect(replay!.frames[0].d.every((d) => (d[5] & 1) === 1)).toBe(true);
  });

  it('assigns unique colours, keeping valid custom ones', () => {
    const red = (n: string) => compileCore(script(n, '// @color #FF0000\nfunction tick() { return idle(); }'));
    const sim = new MatchSim([red('A').meta, red('B').meta, idler('C').meta], { seed: 1, record: true, config: { maxTicks: 1 } });
    const colours = sim.finish().replay!.daemons.map((d) => d.color);
    expect(colours[0]).toBe('#ff0000');
    expect(new Set(colours).size).toBe(3);
    expect(colours.slice(1).every((c) => PALETTE.includes(c))).toBe(true);
  });
});
