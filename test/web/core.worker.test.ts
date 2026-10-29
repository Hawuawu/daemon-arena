/**
 * Runs the real core worker module against a fake worker global scope. `harden()` strips the
 * Function constructors process-wide, so they are restored after every load.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRng } from '../../src/engine/rng';
import type { CoreOp, CoreWorkerIn, CoreWorkerOut } from '../../src/web/protocol';
import { script } from '../support/fixtures';

const protos = [function () {}, async function () {}, function* () {}, async function* () {}].map((f) => Object.getPrototypeOf(f));
const originals = protos.map((p) => p.constructor);
const restore = () => protos.forEach((p, i) => Object.defineProperty(p, 'constructor', { value: originals[i], configurable: true, writable: true }));

const posted: CoreWorkerOut[] = [];
const scope: Record<string, unknown> = { postMessage: (m: CoreWorkerOut) => posted.push(m), fetch: () => 'network' };
const send = (msg: CoreWorkerIn) => {
  (scope.onmessage as (ev: { data: CoreWorkerIn }) => void)({ data: msg });
  return posted.at(-1)!;
};
let constructorsStripped = false;
const load = (source: string) => {
  const reply = send({ type: 'load', id: 'c', source });
  constructorsStripped = protos.every((p) => p.constructor === undefined);
  restore();
  return reply;
};
let batch = 0;
const ops = (...list: CoreOp[]) => {
  const reply = send({ type: 'ops', batch: ++batch, ops: list });
  if (reply.type !== 'results') throw new Error(`unexpected ${reply.type}`);
  expect(reply.batch).toBe(batch);
  return reply.results;
};
const obs = (tick = 1) => ({ tick, self: { x: 0, y: 0 } }) as never;

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../../src/web/core.worker');
});
afterAll(() => {
  restore();
  vi.unstubAllGlobals();
});

describe('loading', () => {
  it('answers with the core metadata', () => {
    expect(load(script('W', '// @color #abcdef\nfunction tick() { return idle(); }'))).toEqual({ type: 'loaded', meta: { name: 'W', color: '#abcdef' } });
  });

  it('answers with a load error for a broken core', () => {
    expect(load('// @name W\nnope(')).toEqual({ type: 'load-error', message: expect.stringMatching(/syntax error/) });
  });

  it('removes network APIs and Function constructors before any core code runs', () => {
    expect(load(script('W', 'if ((function () {}).constructor) throw new Error("escaped");\nfunction tick() {}')).type).toBe('loaded');
    expect(constructorsStripped).toBe(true);
    expect(scope.fetch).toBeUndefined();
    expect(() => (scope.fetch = 'restored?')).toThrow(TypeError);
  });
});

describe('ops', () => {
  it('creates, initialises, ticks and disposes instances in one batch, in order', () => {
    load(script('W', 'let n = 0;\nfunction init(a) { log("init", a.width); }\nfunction tick() { n++; return attack(n); }'));
    const results = ops(
      { op: 'create', inst: 1, seed: 1 },
      { op: 'init', inst: 1, arena: { width: 800 } as never },
      { op: 'tick', inst: 1, obs: obs(1) },
      { op: 'tick', inst: 1, obs: obs(2) },
      { op: 'dispose', inst: 1 },
      { op: 'tick', inst: 1, obs: obs(3) },
    );
    expect(results.map(({ ms, ...r }) => (expect(ms).toBeGreaterThanOrEqual(0), r))).toEqual([
      { inst: 1 },
      { inst: 1, logs: ['init 800'] },
      { inst: 1, raw: { type: 'attack', heading: 1 } },
      { inst: 1, raw: { type: 'attack', heading: 2 } },
      { inst: 1 },
      { inst: 1, error: 'unknown instance' },
    ]);
  });

  it('returns plain cloneable data from tick', () => {
    load(script('W', 'function tick(o) { return o.tick === 1 ? { type: "idle", fn: () => 1, nested: { a: 1 } } : undefined; }'));
    const [, first, second] = ops({ op: 'create', inst: 2, seed: 1 }, { op: 'tick', inst: 2, obs: obs(1) }, { op: 'tick', inst: 2, obs: obs(2) });
    expect(first.raw).toEqual({ type: 'idle', nested: { a: 1 } });
    expect(second.raw).toBeNull();
  });

  it('reports errors with the logs produced before them, truncated to 300 characters', () => {
    load(script('W', 'function tick() { log("before"); throw new Error("x".repeat(400)); }'));
    const [, r] = ops({ op: 'create', inst: 3, seed: 1 }, { op: 'tick', inst: 3, obs: obs() });
    expect(r.logs).toEqual(['before']);
    expect(r.error).toHaveLength(300);
  });

  it('reports a core that throws while creating an instance', () => {
    load(script('W', 'if (random() > 0.5) throw new Error("unlucky");\nfunction tick() {}'));
    expect(createRng(0)()).toBeLessThanOrEqual(0.5);
    let seed = 1;
    while (createRng(seed)() <= 0.5) seed++;
    const [r] = ops({ op: 'create', inst: 4, seed });
    expect(r.error).toMatch(/unlucky/);
  });
});
