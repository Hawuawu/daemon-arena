/// <reference lib="webworker" />
/**
 * Hosts ONE daemon core script (possibly many instances of it, one per match slot).
 * Before any core code runs, network / storage / eval capabilities are removed from this
 * worker's global scope. The coordinator terminates the worker if it stops answering.
 */
import { compileCore } from '../runtime/sandbox';
import type { CoreFactory, CoreRuntime } from '../runtime/types';
import type { CoreOp, CoreOpResult, CoreWorkerIn, CoreWorkerOut } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope & Record<string, unknown>;
const post = scope.postMessage.bind(scope) as (msg: CoreWorkerOut) => void;
const now = performance.now.bind(performance);

const STRIP = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts',
  'indexedDB', 'caches', 'cookieStore', 'BroadcastChannel', 'Worker', 'SharedWorker', 'Request', 'Response',
  'navigator', 'FileReaderSync', 'webkitRequestFileSystem', 'webkitRequestFileSystemSync', 'eval', 'WebAssembly',
  'setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame', 'Notification', 'close',
];

function harden() {
  for (const name of STRIP) {
    for (let o: object | null = scope; o; o = Object.getPrototypeOf(o)) {
      try {
        if (Object.prototype.hasOwnProperty.call(o, name)) delete (o as Record<string, unknown>)[name];
      } catch {
        /* non-configurable: shadowed below */
      }
    }
    try {
      Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false });
    } catch {
      /* already gone */
    }
  }
  // Function constructors are a way back to the global scope; cores have no use for them.
  const ctors = [function () {}, async function () {}, function* () {}, async function* () {}];
  for (const f of ctors) Object.defineProperty(Object.getPrototypeOf(f), 'constructor', { value: undefined });
}

let factory: CoreFactory | null = null;
const instances = new Map<number, CoreRuntime>();
const message = (err: unknown) => String((err as Error)?.message ?? err).slice(0, 300);

function runOp(op: CoreOp): CoreOpResult {
  const started = now();
  const done = (r: Omit<CoreOpResult, 'inst' | 'ms' | 'logs'>, rt?: CoreRuntime): CoreOpResult => {
    const logs = rt?.drainLogs();
    return { inst: op.inst, ms: now() - started, ...r, ...(logs?.length ? { logs } : {}) };
  };
  if (op.op === 'create') {
    try {
      const rt = factory!.create(op.seed);
      instances.set(op.inst, rt);
      return done({}, rt);
    } catch (err) {
      return done({ error: message(err) });
    }
  }
  const rt = instances.get(op.inst);
  if (!rt) return done({ error: 'unknown instance' });
  if (op.op === 'dispose') {
    instances.delete(op.inst);
    return done({});
  }
  try {
    if (op.op === 'init') {
      rt.init(op.arena);
      return done({}, rt);
    }
    let raw = rt.tick(op.obs);
    // Results must be structured-cloneable; actions are plain data anyway.
    if (raw !== null && typeof raw === 'object') raw = JSON.parse(JSON.stringify(raw));
    return done({ raw: raw ?? null }, rt);
  } catch (err) {
    return done({ error: message(err) }, rt);
  }
}

scope.onmessage = (ev: MessageEvent<CoreWorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    try {
      harden();
      factory = compileCore(msg.source, msg.id);
      post({ type: 'loaded', meta: factory.meta });
    } catch (err) {
      post({ type: 'load-error', message: message(err) });
    }
    return;
  }
  post({ type: 'results', batch: msg.batch, results: msg.ops.map(runOp) });
};
