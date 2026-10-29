import { describe, expect, it } from 'vitest';
import type { Observation } from '../../src/api';
import { CoreLoadError, compileCore, formatLog, HELPER_NAMES } from '../../src/runtime/sandbox';
import { script } from '../support/fixtures';

const obsAt = (x: number, y: number) => ({ self: { x, y } }) as Observation;
/** Instantiates a core and returns the first tick's result. */
const tickOnce = (body: string, obs = obsAt(0, 0), seed = 1) => compileCore(script('T', body)).create(seed).tick(obs);
const logsOf = (body: string, seed = 1) => {
  const rt = compileCore(script('T', body)).create(seed);
  rt.tick(obsAt(0, 0));
  return rt.drainLogs();
};

describe('compileCore', () => {
  it('returns a factory with the parsed metadata and source', () => {
    const src = script('ALPHA', '// @color #123456\nfunction tick() { return idle(); }');
    const f = compileCore(src, 'alpha');
    expect(f).toMatchObject({ id: 'alpha', meta: { name: 'ALPHA', color: '#123456' }, source: src });
    expect(f.create(1).meta).toBe(f.meta);
  });

  it.each([
    ['a missing @name', 'function tick() {}', /@name/],
    ['a missing tick()', '// @name X\nlet a = 1;', /function tick/],
    ['tick that is not a function', '// @name X\nconst tick = 5;', /function tick/],
    ['a syntax error', '// @name X\nthis is not js', /syntax error/],
    ['an error thrown at load time', '// @name X\nthrow new Error("boom")', /threw while loading: boom/],
  ])('rejects %s with a CoreLoadError', (_label, src, message) => {
    expect(() => compileCore(src)).toThrow(CoreLoadError);
    expect(() => compileCore(src)).toThrow(message);
  });

  it('calls the optional init(arena) with the arena info', () => {
    const rt = compileCore(script('I', 'function init(a) { log(a.width); }\nfunction tick() {}')).create(1);
    rt.init({ width: 640 } as never);
    expect(rt.drainLogs()).toEqual(['640']);
  });

  it('accepts cores without init()', () => {
    expect(() => compileCore(script('N', 'function tick() {}')).create(1).init({} as never)).not.toThrow();
  });

  it('passes through whatever tick() returns (validation happens in the engine)', () => {
    expect(tickOnce('function tick() { return { type: "attack", heading: 1 }; }')).toEqual({ type: 'attack', heading: 1 });
    expect(tickOnce('function tick() { return 42; }')).toBe(42);
  });

  it('runs in strict mode', () => {
    expect(() => tickOnce('function tick() { undeclared = 1; }')).toThrow(ReferenceError);
  });
});

describe('helper globals', () => {
  it('exposes exactly the documented helpers', () => {
    expect([...HELPER_NAMES].sort()).toEqual(['TAU', 'angleTo', 'attack', 'distanceTo', 'evade', 'idle', 'log', 'move', 'random', 'wrapAngle']);
  });

  it.each([
    ['move(1)', { type: 'move', heading: 1, throttle: 1 }],
    ['move(1, 0.3)', { type: 'move', heading: 1, throttle: 0.3 }],
    ['evade()', { type: 'evade', heading: undefined }],
    ['evade(2)', { type: 'evade', heading: 2 }],
    ['attack(-1)', { type: 'attack', heading: -1 }],
    ['idle()', { type: 'idle' }],
  ])('%s builds the action', (call, expected) => {
    expect(tickOnce(`function tick() { return ${call}; }`)).toEqual(expected);
  });

  it('measures angleTo and distanceTo from the daemon’s own position', () => {
    expect(tickOnce('function tick() { return [angleTo(110, 110), distanceTo(13, 14)]; }', obsAt(10, 10))).toEqual([Math.PI / 4, 5]);
  });

  it('wraps angles into (-π, π] and provides TAU', () => {
    expect(tickOnce('function tick() { return [wrapAngle(3 * Math.PI), wrapAngle(-Math.PI), wrapAngle(TAU + 1), TAU]; }')).toEqual([
      expect.closeTo(Math.PI, 12), expect.closeTo(Math.PI, 12), expect.closeTo(1, 12), Math.PI * 2,
    ]);
  });
});

describe('determinism', () => {
  const draws = 'const xs = [random(), Math.random(), random()];\nfunction tick() { return xs; }';

  it('seeds random() and Math.random() from the instance seed', () => {
    expect(tickOnce(draws, undefined, 5)).toEqual(tickOnce(draws, undefined, 5));
    expect(tickOnce(draws, undefined, 5)).not.toEqual(tickOnce(draws, undefined, 6));
  });

  it('gives every instance its own top-level state', () => {
    const f = compileCore(script('C', 'let n = 0;\nfunction tick() { return ++n; }'));
    const [a, b] = [f.create(1), f.create(1)];
    a.tick(obsAt(0, 0));
    expect(a.tick(obsAt(0, 0))).toBe(2);
    expect(b.tick(obsAt(0, 0))).toBe(1);
  });

  it('does not let a core patch Math for other instances', () => {
    expect(() => tickOnce('function tick() { Math.random = () => 0.5; }')).toThrow(TypeError);
    expect(tickOnce('function tick() { return [Math.sqrt(16), Math.PI]; }')).toEqual([4, Math.PI]);
  });
});

describe('ambient globals', () => {
  it.each([
    'window', 'self', 'globalThis', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'postMessage',
    'Worker', 'setTimeout', 'setInterval', 'queueMicrotask', 'Date', 'performance', 'Function', 'localStorage',
    'sessionStorage', 'indexedDB', 'caches', 'navigator', 'location', 'require', 'process', 'module', 'exports',
  ])('hides %s', (name) => {
    expect(tickOnce(`function tick() { return typeof ${name}; }`)).toBe('undefined');
  });
});

describe('logging', () => {
  it('collects log() and console.* output per tick and drains it', () => {
    const rt = compileCore(script('L', 'function tick(o) { log("a", 1, { b: 2 }); console.warn("w"); return idle(); }')).create(1);
    rt.tick(obsAt(0, 0));
    expect(rt.drainLogs()).toEqual(['a 1 {"b":2}', 'w']);
    expect(rt.drainLogs()).toEqual([]);
  });

  it('caps the number of buffered lines and the line length', () => {
    const lines = logsOf('function tick() { for (let i = 0; i < 300; i++) log("x".repeat(1000)); }');
    expect(lines).toHaveLength(200);
    expect(lines[0]).toHaveLength(500);
  });

  it('formats values that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatLog(['s', 1, null, circular])).toBe('s 1 null [object Object]');
  });
});
