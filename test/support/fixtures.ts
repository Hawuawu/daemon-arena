/** Shared fixtures: builtin cores, inline test cores and a one-call match runner. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runMatch, type MatchOptions } from '../../src/engine/match';
import { hashSeed } from '../../src/engine/rng';
import { compileCore } from '../../src/runtime/sandbox';
import type { MatchResult, Standing } from '../../src/engine/types';
import type { CoreFactory } from '../../src/runtime/types';

export const ROOT = path.resolve(__dirname, '../..');
export const BUILTINS = ['hunter', 'phantom', 'sentinel', 'drifter', 'spinner'] as const;

export const builtinSource = (name: string) => readFileSync(path.join(ROOT, 'cores', `${name}.js`), 'utf8');
export const builtin = (name: string) => compileCore(builtinSource(name), name);

/** Core source with a `// @name` header followed by `body`. */
export const script = (name: string, body: string) => `// @name ${name}\n${body}`;
export const core = (name: string, body: string) => compileCore(script(name, body), name.toLowerCase());
export const idler = (name = 'IDLE') => core(name, 'function tick() { return idle(); }');

/** Runs a match the same way the CLI does (slot seeds = hashSeed(seed, slot)). */
export function play(factories: CoreFactory[], opts: MatchOptions) {
  return runMatch(factories.map((f, slot) => f.create(hashSeed(opts.seed, slot))), opts);
}

export function standing(result: MatchResult, name: string): Standing {
  const s = result.standings.find((x) => x.name === name);
  if (!s) throw new Error(`no standing for ${name}`);
  return s;
}
