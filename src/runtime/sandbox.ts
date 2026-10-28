import type { CoreContext, CoreMeta, DaemonCore } from '../api';
import { createRng } from '../engine/rng';
import type { CoreFactory, CoreRuntime } from './types';

export class CoreLoadError extends Error {}

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

export function makeContext(seed: number, logs: string[]): CoreContext {
  return {
    random: createRng(seed),
    memory: {},
    log: (...args: unknown[]) => {
      if (logs.length < 200) logs.push(formatLog(args));
    },
  };
}

/** Accepts `module.exports = core`, `exports.default = core` (esbuild cjs output) or `{ core }`. */
export function pickCore(exportsObj: unknown): DaemonCore {
  const e = exportsObj as Record<string, unknown> | undefined;
  const candidate = (e && (e.default ?? e.core ?? e)) as Partial<DaemonCore> | undefined;
  if (!candidate || typeof candidate !== 'object') throw new CoreLoadError('core must export an object');
  if (typeof candidate.tick !== 'function') throw new CoreLoadError('core must export a tick(obs, ctx) function');
  const meta = candidate.meta as CoreMeta | undefined;
  if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) throw new CoreLoadError('core must export meta.name');
  return candidate as DaemonCore;
}

const BLOCKED_GLOBALS = [
  'window', 'self', 'globalThis', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts',
  'postMessage', 'Worker', 'setTimeout', 'setInterval', 'queueMicrotask', 'Date', 'performance',
  'localStorage', 'sessionStorage', 'indexedDB', 'require', 'process',
];

function instantiateInline(source: string, seed: number): { core: DaemonCore; ctx: CoreContext; logs: string[] } {
  const logs: string[] = [];
  const ctx = makeContext(seed, logs);
  const seededMath = Object.freeze(Object.assign(Object.create(Math) as Math, { random: ctx.random }));
  const consoleShim = { log: ctx.log, info: ctx.log, warn: ctx.log, error: ctx.log, debug: ctx.log };
  const module = { exports: {} as unknown };
  let fn: (...args: unknown[]) => void;
  try {
    fn = new Function('module', 'exports', 'Math', 'console', ...BLOCKED_GLOBALS, `"use strict";\n${source}`) as typeof fn;
  } catch (err) {
    throw new CoreLoadError(`syntax error: ${(err as Error).message}`);
  }
  try {
    fn(module, module.exports, seededMath, consoleShim, ...BLOCKED_GLOBALS.map(() => undefined));
  } catch (err) {
    throw new CoreLoadError(`core threw while loading: ${(err as Error).message}`);
  }
  return { core: pickCore(module.exports), ctx, logs };
}

/**
 * In-process core loader (browser + fast CLI mode). Shadows ambient globals and seeds Math.random
 * for determinism. This is hygiene, not a security boundary: in the browser, matches run inside a
 * Web Worker that the UI terminates if a core hangs.
 */
export function compileCore(source: string, id = 'core'): CoreFactory {
  const probe = instantiateInline(source, 0);
  const meta: CoreMeta = { ...probe.core.meta };
  return {
    id,
    meta,
    source,
    create(seed: number): CoreRuntime {
      const { core, ctx, logs } = instantiateInline(source, seed);
      return {
        meta,
        init: (arena) => core.init?.call(core, arena, ctx),
        tick: (obs) => core.tick.call(core, obs, ctx),
        drainLogs: () => logs.splice(0, logs.length),
      };
    },
  };
}
