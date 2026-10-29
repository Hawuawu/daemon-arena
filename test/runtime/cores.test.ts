import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTournament } from '../../src/engine/tournament';
import { compileCoreVm } from '../../src/runtime/node';
import { compileCore } from '../../src/runtime/sandbox';
import { BUILTINS, builtin, builtinSource, idler, play, ROOT } from '../support/fixtures';

describe.each(BUILTINS)('builtin core %s', (name) => {
  it('loads in both runtimes with complete metadata', () => {
    const meta = compileCore(builtinSource(name), name).meta;
    expect(meta).toMatchObject({ name: name.toUpperCase(), author: 'arena', color: expect.stringMatching(/^#/), description: expect.any(String) });
    expect(compileCoreVm(builtinSource(name), name).meta).toEqual(meta);
  });

  it('plays a full match without faults', () => {
    const { result } = play([builtin(name), idler()], { seed: 3 });
    expect(result.standings.every((s) => s.faults === 0)).toBe(true);
  });
});

describe('builtin baselines', () => {
  it('are strong enough to beat a sitting target', () => {
    for (const name of BUILTINS) {
      const t = runTournament([builtin(name), idler()], { rounds: 2, baseSeed: 1, config: { maxTicks: 1500 } });
      expect(t.leaderboard[0].name, name).toBe(name.toUpperCase());
    }
  });

  it('keep HUNTER ahead of SPINNER, as documented in AGENTS.md', () => {
    const t = runTournament([builtin('hunter'), builtin('spinner')], { rounds: 4, baseSeed: 1 });
    expect(t.leaderboard.map((r) => r.name)).toEqual(['HUNTER', 'SPINNER']);
  });
});

describe('core template', () => {
  it('is a valid, fault-free core once named', () => {
    const src = readFileSync(path.join(ROOT, 'scripts', 'core-template.js'), 'utf8').replaceAll('__NAME__', 'MINE');
    const { result } = play([compileCore(src), idler()], { seed: 2, config: { maxTicks: 500 } });
    expect(result.standings.find((s) => s.name === 'MINE')).toMatchObject({ faults: 0, shots: expect.any(Number) });
    expect(result.standings.find((s) => s.name === 'MINE')!.shots).toBeGreaterThan(0);
  });
});
