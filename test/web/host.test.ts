import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTournament } from '../../src/engine/tournament';
import { CorePool, loadPools, runMatchAsync, runTournamentAsync } from '../../src/web/host';
import { builtin, builtinSource, play, script, standing } from '../support/fixtures';
import { FakeWorker } from '../support/fake-worker';

const src = (name: string, body = 'function tick() { return idle(); }') => ({ id: name.toLowerCase(), source: script(name, body) });
const builtinSrc = (name: string) => ({ id: name, source: builtinSource(name) });
const opsMessages = (w: FakeWorker) => w.received.filter((m) => m.type === 'ops');

/** Resolve `p` while advancing fake setTimeout time; real setImmediate keeps messages flowing. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  while (!done) {
    await new Promise((r) => setImmediate(r));
    if (!done) await vi.advanceTimersByTimeAsync(100);
  }
  return p;
}

beforeEach(() => {
  FakeWorker.all = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadPools', () => {
  it('spawns one module worker per core and resolves with each core’s metadata', async () => {
    const pools = await loadPools([builtinSrc('hunter'), src('B')]);
    expect(pools.map((p) => p.meta.name)).toEqual(['HUNTER', 'B']);
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0].options).toEqual({ type: 'module' });
    expect(FakeWorker.all[0].url.pathname).toMatch(/core\.worker\.ts$/);
  });

  it('rejects with the load error and terminates every worker', async () => {
    await expect(loadPools([src('OK'), { id: 'bad', source: '// @name BAD\nlet x;' }])).rejects.toThrow(/function tick/);
    expect(FakeWorker.all.every((w) => w.terminated)).toBe(true);
  });

  it('rejects when a worker fails to start', async () => {
    await expect(loadPools([src('C', '// @test-crash\nfunction tick() {}')])).rejects.toThrow(/c: worker crashed/);
  });

  it('gives up on a core that hangs while loading', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await expect(settle(loadPools([src('H', '// @test-hang-load\nfunction tick() {}')]))).rejects.toThrow(/hung while loading/);
    expect(FakeWorker.all[0].terminated).toBe(true);
  });
});

describe('runMatchAsync', () => {
  it('plays exactly the same match as the synchronous engine', async () => {
    const pools = await loadPools([builtinSrc('hunter'), builtinSrc('phantom')]);
    const asyncOut = await runMatchAsync(pools, { seed: 21, record: true, config: { maxTicks: 600 } });
    const syncOut = play([builtin('hunter'), builtin('phantom')], { seed: 21, record: true, config: { maxTicks: 600 } });
    expect(asyncOut.result).toEqual(syncOut.result);
    expect(JSON.stringify(asyncOut.replay)).toBe(JSON.stringify(syncOut.replay));
  });

  it('forwards logs and turns init and tick errors into faults', async () => {
    const pools = await loadPools([
      src('LOUD', 'function init() { log("hi"); throw new Error("init failed"); }\nfunction tick(o) { if (o.tick === 2) throw new Error("t2"); return idle(); }'),
      src('IDLE'),
    ]);
    const onLog = vi.fn();
    const { result, replay } = await runMatchAsync(pools, { seed: 1, record: true, config: { maxTicks: 3 }, onLog });
    expect(onLog).toHaveBeenCalledWith(0, 'hi');
    expect(standing(result, 'LOUD').faults).toBe(2);
    expect(replay!.frames.flatMap((f) => f.e)).toEqual(
      expect.arrayContaining([{ k: 'fault', d: 0, msg: 'init: init failed' }, { k: 'fault', d: 0, msg: 't2' }]),
    );
  });

  it('releases its core instances when the match ends', async () => {
    const pools = await loadPools([src('A'), src('B')]);
    await runMatchAsync(pools, { seed: 1, config: { maxTicks: 2 } });
    await new Promise((r) => setTimeout(r, 0));
    const ops = FakeWorker.all.flatMap((w) => opsMessages(w).flatMap((m) => (m.type === 'ops' ? m.ops : [])));
    expect(ops.filter((o) => o.op === 'dispose')).toHaveLength(2);
  });

  it('terminates a hung core, keeps its chassis as a target and finishes the match', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pools = await settle(loadPools([src('HANG', '// @test-hang-tick 5\nfunction tick() { return idle(); }'), src('OK')]));
    const { result } = await settle(runMatchAsync(pools, { seed: 1, config: { maxTicks: 20 } }));
    expect(result.ticks).toBe(20);
    expect(standing(result, 'HANG').faults).toBe(1);
    expect(FakeWorker.all[0].terminated).toBe(true);

    // The next match respawns the worker.
    vi.useRealTimers();
    const again = await runMatchAsync(pools, { seed: 2, config: { maxTicks: 3 } });
    expect(again.result.ticks).toBe(3);
    expect(FakeWorker.all).toHaveLength(3);
  });
});

describe('CorePool', () => {
  it('rejects calls for instances of a terminated worker', async () => {
    const pool = new CorePool(src('A'));
    await pool.load();
    const inst = await pool.create(1);
    pool.terminate();
    await expect(pool.call({ op: 'tick', inst, obs: {} as never })).rejects.toThrow(/terminated/);
  });

  it('ignores results for batches it is not waiting on', async () => {
    const pool = new CorePool(src('A'));
    await pool.load();
    FakeWorker.all[0].onmessage!({ data: { type: 'results', batch: -1, results: [] } });
    await expect(pool.create(1)).resolves.toEqual(expect.any(Number));
  });
});

describe('runTournamentAsync', () => {
  it('matches the synchronous tournament and reports progress', async () => {
    const names = ['hunter', 'phantom', 'spinner'];
    const pools = await loadPools(names.map(builtinSrc));
    const onProgress = vi.fn();
    const opts = { rounds: 1, baseSeed: 2, mode: 'duel' as const, config: { maxTicks: 400 } };
    const t = await runTournamentAsync(pools, opts, onProgress);
    expect(t).toEqual(runTournament(names.map(builtin), opts));
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it('batches the ticks of concurrent matches into one message per worker', async () => {
    const pools = await loadPools([src('A'), src('B')]);
    await runTournamentAsync(pools, { rounds: 6, baseSeed: 1, mode: 'duel', config: { maxTicks: 5 } });
    const sizes = opsMessages(FakeWorker.all[0]).map((m) => (m.type === 'ops' ? m.ops.length : 0));
    expect(Math.max(...sizes)).toBe(6);
  });
});
