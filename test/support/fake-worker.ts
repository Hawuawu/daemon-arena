/**
 * In-process stand-in for the browser Worker running src/web/core.worker.ts, so the coordinator in
 * src/web/host.ts can be tested under Node. Messages are delivered asynchronously (setImmediate).
 * Directives in a core's source simulate misbehaving workers:
 *   // @test-hang-load      never answers the load message
 *   // @test-crash          fires `error` instead of loading (worker failed to start)
 *   // @test-hang-tick N    stops answering once asked for tick N
 */
import { compileCore } from '../../src/runtime/sandbox';
import type { CoreFactory, CoreRuntime } from '../../src/runtime/types';
import type { CoreOp, CoreOpResult, CoreWorkerIn, CoreWorkerOut } from '../../src/web/protocol';

export class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((ev: { data: CoreWorkerOut }) => void) | null = null;
  onerror: ((ev: { message: string; preventDefault(): void }) => void) | null = null;
  terminated = false;
  received: CoreWorkerIn[] = [];
  private hung = false;
  private source = '';
  private factory: CoreFactory | null = null;
  private instances = new Map<number, CoreRuntime>();

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.all.push(this);
  }

  postMessage(msg: CoreWorkerIn) {
    if (this.terminated) return;
    this.received.push(structuredClone(msg));
    setImmediate(() => this.handle(msg));
  }

  terminate() {
    this.terminated = true;
  }

  private reply(data: CoreWorkerOut) {
    if (!this.terminated) this.onmessage?.({ data: structuredClone(data) });
  }

  private handle(msg: CoreWorkerIn) {
    if (this.terminated || this.hung) return;
    if (msg.type === 'load') {
      this.source = msg.source;
      if (msg.source.includes('@test-hang-load')) return void (this.hung = true);
      if (msg.source.includes('@test-crash')) return this.onerror?.({ message: 'worker crashed', preventDefault() {} });
      try {
        this.factory = compileCore(msg.source, msg.id);
        this.reply({ type: 'loaded', meta: this.factory.meta });
      } catch (err) {
        this.reply({ type: 'load-error', message: (err as Error).message });
      }
      return;
    }
    const hangAt = Number(/@test-hang-tick\s+(\d+)/.exec(this.source)?.[1]);
    if (msg.ops.some((op) => op.op === 'tick' && op.obs.tick === hangAt)) return void (this.hung = true);
    this.reply({ type: 'results', batch: msg.batch, results: msg.ops.map((op) => this.run(op)) });
  }

  private run(op: CoreOp): CoreOpResult {
    const result = (r: Partial<CoreOpResult>, rt?: CoreRuntime): CoreOpResult => {
      const logs = rt?.drainLogs();
      return { inst: op.inst, ms: 0, ...r, ...(logs?.length ? { logs } : {}) };
    };
    if (op.op === 'create') {
      const rt = this.factory!.create(op.seed);
      this.instances.set(op.inst, rt);
      return result({}, rt);
    }
    const rt = this.instances.get(op.inst);
    if (!rt) return result({ error: 'unknown instance' });
    if (op.op === 'dispose') {
      this.instances.delete(op.inst);
      return result({});
    }
    try {
      if (op.op === 'init') {
        rt.init(op.arena);
        return result({}, rt);
      }
      return result({ raw: rt.tick(op.obs) ?? null }, rt);
    } catch (err) {
      return result({ error: (err as Error).message }, rt);
    }
  }
}
