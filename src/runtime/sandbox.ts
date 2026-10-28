import type { ArenaInfo, CoreMeta, Observation } from '../api';
import { createRng } from '../engine/rng';
import type { CoreFactory, CoreRuntime } from './types';

/**
 * Daemon core = one plain JavaScript script:
 *
 *   // @name  BLINKER
 *   // @color #f9f871
 *   let aim = 0;
 *   function tick(obs) {
 *     if (obs.self.attackCooldown === 0) return attack(aim += 0.4);
 *     return move(angleTo(obs.arena.width / 2, obs.arena.height / 2));
 *   }
 *
 * Top-level variables persist for the match (one fresh instance per daemon per match).
 * Optional `function init(arena)` runs once before the first tick.
 */

export class CoreLoadError extends Error {}

export const META_KEYS = ['name', 'author', 'version', 'color', 'description'] as const;

/** Reads `// @key value` header comments. Requires `@name`. Never executes the script. */
export function parseMeta(source: string): CoreMeta {
  const meta: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const m = /^\s*\/\/\s*@(\w+)\s+(.+?)\s*$/.exec(line);
    if (m && (META_KEYS as readonly string[]).includes(m[1]) && !(m[1] in meta)) meta[m[1]] = m[2].slice(0, 200);
  }
  if (!meta.name) throw new CoreLoadError('missing core name: add a header line like `// @name MY-DAEMON`');
  meta.name = meta.name.slice(0, 24);
  if (meta.color && !/^#[0-9a-f]{3,8}$/i.test(meta.color)) delete meta.color;
  return meta as unknown as CoreMeta;
}

export function formatLog(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ')
    .slice(0, 500);
}

export interface ScriptExports {
  init?: (arena: ArenaInfo) => void;
  tick: (obs: Observation) => unknown;
}

/** Globals available to every core script. */
export const HELPER_NAMES = ['move', 'evade', 'attack', 'idle', 'angleTo', 'distanceTo', 'wrapAngle', 'TAU', 'random', 'log'] as const;
const TAU = Math.PI * 2;

export function createHelpers(random: () => number, logs: string[], current: { obs: Observation | null }) {
  const self = () => current.obs?.self ?? { x: 0, y: 0 };
  const log = (...args: unknown[]) => {
    if (logs.length < 200) logs.push(formatLog(args));
  };
  const helpers: Record<(typeof HELPER_NAMES)[number], unknown> = {
    move: (heading: number, throttle = 1) => ({ type: 'move', heading, throttle }),
    evade: (heading?: number) => ({ type: 'evade', heading }),
    attack: (heading: number) => ({ type: 'attack', heading }),
    idle: () => ({ type: 'idle' }),
    angleTo: (x: number, y: number) => Math.atan2(y - self().y, x - self().x),
    distanceTo: (x: number, y: number) => Math.hypot(x - self().x, y - self().y),
    wrapAngle: (a: number) => {
      a %= TAU;
      if (a <= -Math.PI) a += TAU;
      if (a > Math.PI) a -= TAU;
      return a;
    },
    TAU,
    random,
    log,
  };
  return { helpers, log };
}

/** The script wrapped as an expression evaluating to its `{ init, tick }`. */
export function scriptExpression(source: string): string {
  return `(function () {"use strict";\n${source}\n;return { init: typeof init === "function" ? init : undefined, tick: typeof tick === "function" ? tick : undefined };\n})()`;
}

export function checkExports(exp: unknown): ScriptExports {
  const e = exp as Partial<ScriptExports> | undefined;
  if (!e || typeof e.tick !== 'function') throw new CoreLoadError('core must define `function tick(obs) { ... }`');
  return e as ScriptExports;
}

const BLOCKED_GLOBALS = [
  'window', 'self', 'globalThis', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'postMessage', 'Worker', 'setTimeout', 'setInterval', 'queueMicrotask', 'Date', 'performance', 'Function',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'navigator', 'location', 'require', 'process', 'module', 'exports',
];

function instantiate(source: string, seed: number): CoreRuntime & { exports: ScriptExports } {
  const logs: string[] = [];
  const random = createRng(seed);
  const current = { obs: null as Observation | null };
  const { helpers, log } = createHelpers(random, logs, current);
  const seededMath = Object.freeze(Object.assign(Object.create(Math) as Math, { random }));
  const consoleShim = { log, info: log, warn: log, error: log, debug: log };
  let fn: (...args: unknown[]) => unknown;
  try {
    fn = new Function('Math', 'console', ...HELPER_NAMES, ...BLOCKED_GLOBALS, `return ${scriptExpression(source)};`) as typeof fn;
  } catch (err) {
    throw new CoreLoadError(`syntax error: ${(err as Error).message}`);
  }
  let exports: ScriptExports;
  try {
    exports = checkExports(fn(seededMath, consoleShim, ...HELPER_NAMES.map((n) => helpers[n]), ...BLOCKED_GLOBALS.map(() => undefined)));
  } catch (err) {
    if (err instanceof CoreLoadError) throw err;
    throw new CoreLoadError(`core threw while loading: ${(err as Error)?.message ?? err}`);
  }
  return {
    meta: { name: '' },
    exports,
    init: (arena) => exports.init?.(arena),
    tick: (obs) => {
      current.obs = obs;
      return exports.tick(obs);
    },
    drainLogs: () => logs.splice(0, logs.length),
  };
}

/**
 * In-process core loader (CLI default, browser core workers). Shadows ambient globals and seeds
 * Math.random for determinism. Not a security boundary on its own: in the browser every core
 * runs inside its own hardened Web Worker (see src/web/core.worker.ts).
 */
export function compileCore(source: string, id = 'core'): CoreFactory {
  const meta = parseMeta(source);
  instantiate(source, 0);
  return {
    id,
    meta,
    source,
    create(seed: number): CoreRuntime {
      const rt = instantiate(source, seed);
      return { ...rt, meta };
    },
  };
}
