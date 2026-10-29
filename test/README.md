# Tests

`npm test` runs everything; `npm run coverage` adds the coverage gate.

| Folder | What it covers |
|---|---|
| `engine/` | Rules of the arena: `math`, `rng`, `config`, action validation, steering/thrust/walls (`movement`), attack/hit/evade/derez (`combat`), match lifecycle, faults and replays (`match`), ranking (`standings`), tournament schedule and matrices (`tournament`). |
| `runtime/` | Daemon core scripts: header parsing (`meta`), the in-process sandbox (`sandbox`), `node:vm` isolation (`node-vm`), builtin cores and the template (`cores`). |
| `web/` | The browser side without a browser: the per-core worker (`core.worker`, against a fake worker scope) and the match coordinator (`host`, with `support/fake-worker.ts`). |
| `cli/` | `scripts/arena.ts` and `scripts/serve-dist.mjs` run as real subprocesses. |
| `support/` | Fixtures (`fixtures.ts`), a tick-by-tick `Harness` that places chassis exactly (`harness.ts`), and `FakeWorker`. |

Physics tests use `Harness` to put daemons at known positions and drive single ticks; numbers are derived from `DEFAULT_CONFIG`, so tuning the config should not require rewriting tests. Parity tests check that the `node:vm` runtime, the worker coordinator and the CLI produce exactly the same results as the synchronous engine.
