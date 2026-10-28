/**
 * Runs matches in the sim worker while every daemon core executes in its own Web Worker.
 * Each tick the coordinator batches all pending core calls per worker into a single message,
 * so many concurrent tournament matches cost one round trip per core per tick.
 */
import type { CoreMeta } from '../api';
import type { ArenaConfig } from '../engine/config';
import { MatchSim, type MatchOutput, type TickOutcome } from '../engine/match';
import { hashSeed } from '../engine/rng';
import { aggregateTournament, planTournament, type TournamentMode, type TournamentResult } from '../engine/tournament';
import type { CoreOp, CoreOpResult, CoreSource, CoreWorkerIn, CoreWorkerOut } from './protocol';

/** A core that does not answer a batch within this time is terminated. */
const HANG_MS = 3000;

class CoreHungError extends Error {}

interface QueuedOp {
  op: CoreOp;
  resolve: (r: CoreOpResult) => void;
  reject: (e: Error) => void;
}

export class CorePool {
  meta!: CoreMeta;
  private worker: Worker | null = null;
  private generation = 0;
  private queue: QueuedOp[] = [];
  private inflight = new Map<number, { ops: QueuedOp[]; timer: ReturnType<typeof setTimeout> }>();
  private batchSeq = 0;
  private flushScheduled = false;
  private instGen = new Map<number, number>();
  private static instSeq = 0;
  private flushChannel = new MessageChannel();

  constructor(private core: CoreSource) {
    this.flushChannel.port1.onmessage = () => this.flush();
  }

  /** (Re)spawn the worker and load the script. Resolves with the parsed metadata. */
  async load(): Promise<CoreMeta> {
    this.worker?.terminate();
    this.generation++;
    const worker = new Worker(new URL('./core.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.meta = await new Promise<CoreMeta>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error(`${this.core.id}: core hung while loading`));
      }, HANG_MS);
      worker.onmessage = (ev: MessageEvent<CoreWorkerOut>) => {
        clearTimeout(timer);
        if (ev.data.type === 'loaded') resolve(ev.data.meta);
        else if (ev.data.type === 'load-error') reject(new Error(ev.data.message));
      };
      worker.onerror = (ev) => {
        clearTimeout(timer);
        ev.preventDefault();
        reject(new Error(`${this.core.id}: ${ev.message || 'worker failed to start'}`));
      };
      worker.postMessage({ type: 'load', id: this.core.id, source: this.core.source } satisfies CoreWorkerIn);
    });
    worker.onmessage = (ev: MessageEvent<CoreWorkerOut>) => this.onResults(ev.data);
    return this.meta;
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }

  /** Create a fresh instance. Respawns the worker first if a previous instance hung it. */
  async create(seed: number): Promise<number> {
    if (!this.worker) await this.load();
    const inst = ++CorePool.instSeq;
    this.instGen.set(inst, this.generation);
    const r = await this.call({ op: 'create', inst, seed });
    if (r.error) throw new Error(r.error);
    return inst;
  }

  call(op: CoreOp): Promise<CoreOpResult> {
    if (!this.worker || this.instGen.get(op.inst) !== this.generation) return Promise.reject(new CoreHungError('core terminated'));
    return new Promise((resolve, reject) => {
      this.queue.push({ op, resolve, reject });
      if (!this.flushScheduled) {
        this.flushScheduled = true;
        this.flushChannel.port2.postMessage(null);
      }
    });
  }

  release(inst: number) {
    if (this.instGen.get(inst) === this.generation) this.call({ op: 'dispose', inst }).catch(() => {});
    this.instGen.delete(inst);
  }

  private flush() {
    this.flushScheduled = false;
    if (!this.queue.length || !this.worker) return;
    const ops = this.queue;
    this.queue = [];
    const batch = ++this.batchSeq;
    const timer = setTimeout(() => this.hang(), HANG_MS);
    this.inflight.set(batch, { ops, timer });
    this.worker.postMessage({ type: 'ops', batch, ops: ops.map((o) => o.op) } satisfies CoreWorkerIn);
  }

  private onResults(msg: CoreWorkerOut) {
    if (msg.type !== 'results') return;
    const entry = this.inflight.get(msg.batch);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.inflight.delete(msg.batch);
    entry.ops.forEach((o, i) => o.resolve(msg.results[i]));
  }

  private hang() {
    this.terminate();
    const err = new CoreHungError(`core unresponsive for ${HANG_MS}ms — terminated`);
    for (const { ops, timer } of this.inflight.values()) {
      clearTimeout(timer);
      ops.forEach((o) => o.reject(err));
    }
    this.inflight.clear();
    this.queue.splice(0).forEach((o) => o.reject(err));
  }
}

export async function loadPools(cores: CoreSource[]): Promise<CorePool[]> {
  const pools = cores.map((c) => new CorePool(c));
  try {
    await Promise.all(pools.map((p) => p.load()));
  } catch (err) {
    pools.forEach((p) => p.terminate());
    throw err;
  }
  return pools;
}

export interface AsyncMatchOptions {
  seed: number;
  config?: Partial<ArenaConfig>;
  record?: boolean;
  onLog?: (daemon: number, line: string) => void;
}

/** One match; `slots[i]` is the pool driving daemon i. Same seeds/semantics as the CLI's runMatch. */
export async function runMatchAsync(slots: CorePool[], opts: AsyncMatchOptions): Promise<MatchOutput> {
  const sim = new MatchSim(slots.map((p) => p.meta), opts);
  const insts: (number | null)[] = slots.map(() => null);
  const logs = (id: number, r: CoreOpResult) => r.logs?.forEach((line) => opts.onLog?.(id, line));
  const fail = (id: number, err: unknown) => {
    const msg = (err as Error)?.message ?? String(err);
    if (err instanceof CoreHungError || insts[id] === null) sim.setOffline(id, msg);
    else sim.fault(id, msg);
  };

  await Promise.all(
    slots.map(async (pool, id) => {
      try {
        const inst = await pool.create(hashSeed(opts.seed, id));
        insts[id] = inst;
        const r = await pool.call({ op: 'init', inst, arena: sim.info });
        logs(id, r);
        if (r.error) sim.fault(id, `init: ${r.error}`);
      } catch (err) {
        fail(id, err);
      }
    }),
  );

  while (!sim.done) {
    const outcomes = new Map<number, TickOutcome>();
    await Promise.all(
      sim.observe().map(async ({ id, obs }) => {
        const inst = insts[id];
        if (inst === null) return;
        try {
          const r = await slots[id].call({ op: 'tick', inst, obs });
          logs(id, r);
          outcomes.set(id, r.error !== undefined ? { error: r.error, ms: r.ms } : { raw: r.raw, ms: r.ms });
        } catch (err) {
          fail(id, err);
        }
      }),
    );
    sim.step(outcomes);
  }
  insts.forEach((inst, id) => inst !== null && slots[id].release(inst));
  return sim.finish();
}

export async function runTournamentAsync(
  pools: CorePool[],
  opts: { rounds: number; baseSeed: number; mode: TournamentMode; config?: Partial<ArenaConfig>; concurrency?: number },
  onProgress?: (done: number, total: number) => void,
): Promise<TournamentResult> {
  const schedule = planTournament(pools.length, opts);
  const played: Parameters<typeof aggregateTournament>[2] = new Array(schedule.length);
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < schedule.length) {
      const idx = next++;
      const m = schedule[idx];
      const { result } = await runMatchAsync(m.entrants.map((c) => pools[c]), { seed: m.seed, config: opts.config });
      played[idx] = { ...m, result };
      onProgress?.(++done, schedule.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 24, schedule.length) }, lane));
  return aggregateTournament(pools.map((p) => p.meta), opts, played);
}
