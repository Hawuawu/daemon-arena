import vm from 'node:vm';
import type { Observation } from '../api';
import { createRng } from '../engine/rng';
import { CoreLoadError, checkExports, createHelpers, HELPER_NAMES, parseMeta, scriptExpression, type ScriptExports } from './sandbox';
import type { CoreFactory, CoreRuntime } from './types';

export interface VmOptions {
  /** Hard per-call timeout enforced by node:vm (ms). */
  timeoutMs?: number;
}

const TICK = new vm.Script('__out = __core.tick(__obs)', { filename: 'daemon-tick' });
const INIT = new vm.Script('__core.init && __core.init(__arena)', { filename: 'daemon-init' });

function instantiateVm(source: string, seed: number, id: string, timeout: number) {
  const logs: string[] = [];
  const random = createRng(seed);
  const current = { obs: null as Observation | null };
  const { helpers, log } = createHelpers(random, logs, current);
  const sandbox: Record<string, unknown> = { console: { log, info: log, warn: log, error: log, debug: log }, __rng: random };
  for (const n of HELPER_NAMES) sandbox[n] = helpers[n];
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext('Math.random = __rng; delete globalThis.__rng; globalThis.Date = undefined;', context);
  let core: ScriptExports;
  try {
    new vm.Script(`__core = ${scriptExpression(source)}`, { filename: `${id}.js` }).runInContext(context, { timeout });
    core = checkExports(sandbox.__core);
  } catch (err) {
    if (err instanceof CoreLoadError) throw err;
    throw new CoreLoadError(`core failed to load: ${(err as Error).message}`);
  }
  return { core, context, sandbox, logs, current };
}

/** Isolated core loader for Node (CLI --isolate, tests): separate V8 context, no eval, hard timeouts. */
export function compileCoreVm(source: string, id = 'core', opts: VmOptions = {}): CoreFactory {
  const timeout = opts.timeoutMs ?? 50;
  const meta = parseMeta(source);
  instantiateVm(source, 0, id, timeout);
  return {
    id,
    meta,
    source,
    create(seed: number): CoreRuntime {
      const { context, sandbox, logs, current } = instantiateVm(source, seed, id, timeout);
      return {
        meta,
        init(arena) {
          sandbox.__arena = arena;
          INIT.runInContext(context, { timeout });
        },
        tick(obs) {
          current.obs = obs;
          sandbox.__obs = obs;
          TICK.runInContext(context, { timeout });
          return sandbox.__out;
        },
        drainLogs: () => logs.splice(0, logs.length),
      };
    },
  };
}
