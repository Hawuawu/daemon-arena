import vm from 'node:vm';
import type { CoreMeta, DaemonCore } from '../api';
import { CoreLoadError, makeContext, pickCore } from './sandbox';
import type { CoreFactory, CoreRuntime } from './types';

export interface VmOptions {
  /** Hard per-call timeout enforced by node:vm (ms). */
  timeoutMs?: number;
}

const TICK = new vm.Script('__out = __core.tick(__obs, __ctx)', { filename: 'daemon-tick' });
const INIT = new vm.Script('__core.init && __core.init(__arena, __ctx)', { filename: 'daemon-init' });

function instantiateVm(source: string, seed: number, id: string, timeout: number) {
  const logs: string[] = [];
  const ctx = makeContext(seed, logs);
  const consoleShim = { log: ctx.log, info: ctx.log, warn: ctx.log, error: ctx.log, debug: ctx.log };
  const sandbox: Record<string, unknown> = { module: { exports: {} }, console: consoleShim, __rng: ctx.random, __ctx: ctx };
  sandbox.exports = (sandbox.module as { exports: unknown }).exports;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext('Math.random = __rng; delete globalThis.__rng; globalThis.Date = undefined;', context);
  try {
    new vm.Script(source, { filename: `${id}.core.js` }).runInContext(context, { timeout });
  } catch (err) {
    throw new CoreLoadError(`core failed to load: ${(err as Error).message}`);
  }
  const core: DaemonCore = pickCore((sandbox.module as { exports: unknown }).exports);
  sandbox.__core = core;
  return { core, context, sandbox, logs };
}

/** Isolated core loader for Node (CLI/tests): separate V8 context, no eval, hard timeouts. */
export function compileCoreVm(source: string, id = 'core', opts: VmOptions = {}): CoreFactory {
  const timeout = opts.timeoutMs ?? 50;
  const probe = instantiateVm(source, 0, id, timeout);
  const meta: CoreMeta = JSON.parse(JSON.stringify(probe.core.meta));
  return {
    id,
    meta,
    source,
    create(seed: number): CoreRuntime {
      const { context, sandbox, logs } = instantiateVm(source, seed, id, timeout);
      return {
        meta,
        init(arena) {
          sandbox.__arena = arena;
          INIT.runInContext(context, { timeout });
        },
        tick(obs) {
          sandbox.__obs = obs;
          TICK.runInContext(context, { timeout });
          return sandbox.__out;
        },
        drainLogs: () => logs.splice(0, logs.length),
      };
    },
  };
}
