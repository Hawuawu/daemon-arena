/// <reference lib="webworker" />
import { loadPools, runMatchAsync, runTournamentAsync } from './host';
import type { WorkerRequest, WorkerResponse } from './protocol';

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const pools = await loadPools(req.type === 'validate' ? [{ id: 'probe', source: req.source }] : req.cores).catch((err: Error) => {
    post({ type: 'error', id: req.id, message: err.message });
    return null;
  });
  if (!pools) return;
  try {
    if (req.type === 'validate') {
      post({ type: 'validate', id: req.id, meta: pools[0].meta });
    } else if (req.type === 'match') {
      const logs: { daemon: number; line: string }[] = [];
      const { replay } = await runMatchAsync(pools, {
        seed: req.seed,
        config: req.config,
        record: true,
        onLog: (daemon, line) => logs.length < 500 && logs.push({ daemon, line }),
      });
      post({ type: 'match', id: req.id, replay: replay!, logs });
    } else {
      const result = await runTournamentAsync(
        pools,
        { rounds: req.rounds, baseSeed: req.seed, mode: req.mode, config: req.config },
        (done, total) => post({ type: 'progress', id: req.id, done, total }),
      );
      post({ type: 'tournament', id: req.id, result });
    }
  } catch (err) {
    post({ type: 'error', id: req.id, message: (err as Error)?.message ?? String(err) });
  } finally {
    pools.forEach((p) => p.terminate());
  }
};
