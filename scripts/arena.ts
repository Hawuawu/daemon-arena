#!/usr/bin/env tsx
/**
 * Daemon Arena CLI — headless runner for agents.
 *
 *   npm run arena -- build <entry.ts> [-o out.core.js]
 *   npm run arena -- match <core> <core> [...] [--seed N] [--ticks N] [--replay file.json] [--json] [--verbose]
 *   npm run arena -- tournament <core> <core> [...] [--rounds N] [--seed N] [--mode duel|ffa] [--json]
 *   npm run arena -- new <name>
 *
 * <core> may be a builtin name (hunter, sentinel, ...), a .ts/.js source (bundled on the fly) or a built .core.js.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { ArenaConfig } from '../src/engine/config';
import { runMatch } from '../src/engine/match';
import { hashSeed } from '../src/engine/rng';
import { runTournament, type TournamentMode } from '../src/engine/tournament';
import type { Standing } from '../src/engine/types';
import { bundleCore } from '../src/runtime/bundle';
import { compileCoreVm } from '../src/runtime/node';
import { compileCore } from '../src/runtime/sandbox';
import type { CoreFactory } from '../src/runtime/types';

const root = path.resolve(import.meta.dirname, '..');

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' },
    seed: { type: 'string', short: 's' },
    ticks: { type: 'string', short: 't' },
    rounds: { type: 'string', short: 'r' },
    mode: { type: 'string', short: 'm' },
    replay: { type: 'string' },
    json: { type: 'boolean' },
    verbose: { type: 'boolean', short: 'v' },
    isolate: { type: 'boolean' },
    'keep-matches': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, ...args] = positionals;

function usage(): never {
  console.log(`daemon-arena CLI
  build <entry.ts|js> [-o out.core.js]      bundle a daemon script (and its imports) into a core
  match <core>... [--seed N] [--ticks N] [--replay f.json] [--json] [--verbose]
  tournament <core>... [--rounds N] [--seed N] [--mode duel|ffa] [--json] [--keep-matches]
  new <name>                                scaffold cores/<name>.ts from the template
options: --isolate  run each core in its own node:vm context with a hard per-tick timeout
           (slower; use it while developing a core that might hang or misbehave)`);
  process.exit(command ? 1 : 0);
}

async function loadSource(ref: string): Promise<{ id: string; source: string }> {
  const builtin = path.join(root, 'cores', 'dist', `${ref}.core.js`);
  if (!ref.includes('/') && !ref.includes('.') && existsSync(builtin)) return { id: ref, source: await readFile(builtin, 'utf8') };
  const file = path.resolve(ref);
  if (!existsSync(file)) throw new Error(`core not found: ${ref}`);
  const id = path.basename(file).replace(/(\.core)?\.(ts|js)$/, '');
  if (file.endsWith('.core.js')) return { id, source: await readFile(file, 'utf8') };
  return { id, source: await bundleCore(file) };
}

async function loadCores(refs: string[]): Promise<CoreFactory[]> {
  if (refs.length < 1) throw new Error('no cores given');
  return Promise.all(
    refs.map(async (ref) => {
      const { id, source } = await loadSource(ref);
      return values.isolate ? compileCoreVm(source, id) : compileCore(source, id);
    }),
  );
}

function configOverrides(): Partial<ArenaConfig> {
  return values.ticks ? { maxTicks: Number(values.ticks) } : {};
}

function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cells = rows.map((r) => cols.map((c) => String(r[c] ?? '')));
  const width = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(width[i])).join('  ');
  return [line(cols), line(width.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

function standingRow(s: Standing) {
  return {
    rank: s.rank, daemon: s.name, score: s.score, hits: s.hits, hurts: s.hurts, shots: s.shots,
    acc: s.accuracy, evades: s.evades, dodges: s.dodges, integrity: s.integrity,
    derez: s.derezzedAt ?? '-', faults: s.faults,
  };
}

async function cmdBuild() {
  const entry = args[0];
  if (!entry) usage();
  const code = await bundleCore(path.resolve(entry));
  const factory = compileCoreVm(code, path.basename(entry));
  const out = values.out ?? entry.replace(/\.(ts|js)$/, '.core.js');
  await writeFile(out, code);
  const result = { ok: true, out, meta: factory.meta, bytes: code.length };
  console.log(values.json ? JSON.stringify(result) : `built ${factory.meta.name} -> ${out} (${code.length} bytes)`);
}

async function cmdMatch() {
  const factories = await loadCores(args);
  const seed = Number(values.seed ?? 1);
  const runtimes = factories.map((f, slot) => f.create(hashSeed(seed, slot)));
  const { result, replay } = runMatch(runtimes, {
    seed,
    config: configOverrides(),
    record: Boolean(values.replay),
    onLog: values.verbose ? (d, line) => console.error(`[${factories[d].meta.name}] ${line}`) : undefined,
  });
  if (values.replay && replay) {
    await writeFile(values.replay, JSON.stringify(replay));
  }
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`seed ${seed}  ticks ${result.ticks}  winner ${result.winner === null ? 'DRAW' : result.standings.find((s) => s.id === result.winner)?.name}`);
  console.log(table(result.standings.map(standingRow)));
  if (values.replay) console.log(`replay written to ${values.replay} (load it in the browser: REPLAY > Load)`);
}

async function cmdTournament() {
  const factories = await loadCores(args);
  const mode = (values.mode ?? 'duel') as TournamentMode;
  if (mode !== 'duel' && mode !== 'ffa') throw new Error('--mode must be duel or ffa');
  if (mode === 'duel' && factories.length < 2) throw new Error('duel tournaments need at least 2 cores');
  const result = runTournament(factories, {
    rounds: Number(values.rounds ?? 10),
    baseSeed: Number(values.seed ?? 1),
    mode,
    config: configOverrides(),
    keepMatches: values['keep-matches'],
    onProgress: values.json ? undefined : (done, total) => process.stderr.write(`\r${done}/${total} matches`),
  });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  process.stderr.write('\n');
  console.log(`\nLEADERBOARD (${mode}, ${result.rounds} rounds, seed ${result.baseSeed})`);
  console.log(table(result.leaderboard.map((r) => ({
    rank: r.rank, daemon: r.name, meanScore: r.meanScore, winRate: r.winRate, W: r.wins, L: r.losses, D: r.draws,
    hits: r.hits, hurts: r.hurts, acc: r.accuracy, dodges: r.dodges, derez: r.derezzed, faults: r.faults,
  }))));
  const names = result.cores.map((c) => c.name);
  const printMatrix = (title: string, m: (number | null)[][]) => {
    if (!m.length) return;
    console.log(`\n${title} (row vs column)`);
    console.log(table(m.map((row, i) => ({ '': names[i], ...Object.fromEntries(row.map((v, j) => [names[j], v ?? '—'])) }))));
  };
  printMatrix('SCORE MATRIX: mean score', result.matrix.score);
  printMatrix('WIN-RATE MATRIX', result.matrix.winRate);
  printMatrix('HIT MATRIX: mean hits landed', result.matrix.hits);
}

async function cmdNew() {
  const name = args[0];
  if (!name || !/^[a-z0-9-_]+$/i.test(name)) throw new Error('usage: new <name> (letters, digits, - and _)');
  const target = path.join(root, 'cores', `${name}.ts`);
  if (existsSync(target)) throw new Error(`${target} already exists`);
  const template = (await readFile(path.join(root, 'scripts', 'core-template.ts.txt'), 'utf8')).replaceAll('__NAME__', name.toUpperCase());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, template);
  console.log(`created ${path.relative(process.cwd(), target)}\nnext: npm run arena -- match cores/${name}.ts hunter`);
}

try {
  if (values.help || !command) usage();
  const handlers: Record<string, () => Promise<void>> = { build: cmdBuild, match: cmdMatch, tournament: cmdTournament, new: cmdNew };
  const handler = handlers[command];
  if (!handler) usage();
  await handler();
} catch (err) {
  const message = (err as Error).message ?? String(err);
  if (values.json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`error: ${message}`);
  process.exit(1);
}
