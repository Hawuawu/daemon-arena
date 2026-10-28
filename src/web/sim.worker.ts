/// <reference lib="webworker" />
import { runMatch } from '../engine/match';
import { hashSeed } from '../engine/rng';
import { runTournament } from '../engine/tournament';
import { compileCore } from '../runtime/sandbox';
import type { WorkerRequest, WorkerResponse } from './protocol';

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'validate') {
      post({ type: 'validate', id: req.id, meta: compileCore(req.source, 'probe').meta });
    } else if (req.type === 'match') {
      const factories = req.cores.map((c) => compileCore(c.source, c.id));
      const logs: { daemon: number; line: string }[] = [];
      const { replay } = runMatch(
        factories.map((f, slot) => f.create(hashSeed(req.seed, slot))),
        { seed: req.seed, config: req.config, record: true, onLog: (daemon, line) => logs.length < 500 && logs.push({ daemon, line }) },
      );
      post({ type: 'match', id: req.id, replay: replay!, logs });
    } else if (req.type === 'tournament') {
      const factories = req.cores.map((c) => compileCore(c.source, c.id));
      const result = runTournament(factories, {
        rounds: req.rounds,
        baseSeed: req.seed,
        mode: req.mode,
        config: req.config,
        onProgress: (done, total) => post({ type: 'progress', id: req.id, done, total }),
      });
      post({ type: 'tournament', id: req.id, result });
    }
  } catch (err) {
    post({ type: 'error', id: req.id, message: (err as Error)?.message ?? String(err) });
  }
};
