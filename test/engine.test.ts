import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMatch, validateAction } from '../src/engine/match';
import { hashSeed } from '../src/engine/rng';
import { runTournament } from '../src/engine/tournament';
import { compileCoreVm } from '../src/runtime/node';
import { CoreLoadError, compileCore } from '../src/runtime/sandbox';
import type { CoreFactory } from '../src/runtime/types';

const builtin = (name: string) => readFileSync(path.join(__dirname, '..', 'cores', 'dist', `${name}.core.js`), 'utf8');
const run = (factories: CoreFactory[], seed: number, record = false) =>
  runMatch(factories.map((f, i) => f.create(hashSeed(seed, i))), { seed, record });

const sitter = (name: string) => compileCore(`module.exports = { meta: { name: '${name}' }, tick() { return null; } };`);

describe('match engine', () => {
  it('is deterministic for a given seed', () => {
    const cores = ['hunter', 'phantom'].map((n) => compileCore(builtin(n), n));
    const a = run(cores, 42, true);
    const b = run(cores, 42, true);
    expect(a.result).toEqual(b.result);
    expect(JSON.stringify(a.replay!.frames)).toEqual(JSON.stringify(b.replay!.frames));
    expect(run(cores, 43).result).not.toEqual(a.result);
  });

  it('scores +hit for the shooter and -hurt for the target, and feeds back only hit/hurt', () => {
    // Shooter fires along its line to the sitter; spawn positions are revealed via a probe run.
    const probe = run([sitter('A'), sitter('B')], 7, true).replay!.frames[0].d;
    const [ax, ay] = probe[0];
    const [bx, by] = probe[1];
    const heading = Math.atan2(by - ay, bx - ax);
    const shooter = compileCore(`module.exports = { meta: { name: 'SHOOTER' },
      tick(obs) { return obs.self.attackCooldown === 0 ? { type: 'attack', heading: ${heading} } : null; } };`);
    const target = compileCore(`module.exports = { meta: { name: 'TARGET' },
      tick(obs) { for (const e of obs.events) if (e.type !== 'hurt' && e.type !== 'wall') throw new Error('leak ' + e.type); return null; } };`);
    const { result } = run([shooter, target], 7);
    const s = result.standings.find((x) => x.name === 'SHOOTER')!;
    const t = result.standings.find((x) => x.name === 'TARGET')!;
    expect(s.hits).toBeGreaterThan(0);
    expect(s.score).toBe(s.hits * 10);
    expect(t.score).toBe(-t.hurts * 10);
    expect(t.hurts).toBe(s.hits);
    expect(t.faults).toBe(0);
    expect(t.derezzedAt).not.toBeNull();
    expect(result.winner).toBe(s.id);
    expect(result.hitMatrix[s.id][t.id]).toBe(s.hits);
  });

  it('turns exceptions and invalid actions into faults', () => {
    const thrower = compileCore(`module.exports = { meta: { name: 'BAD' }, tick(obs) { if (obs.tick % 2) throw new Error('x'); return { type: 'teleport' }; } };`);
    const { result } = runMatch([thrower.create(1), sitter('OK').create(2)], { seed: 1, config: { maxTicks: 50 } });
    expect(result.standings.find((s) => s.name === 'BAD')!.faults).toBe(50);
  });

  it('validates actions', () => {
    expect(validateAction(null)).toEqual({ type: 'idle' });
    expect(validateAction({ type: 'move', heading: 1, throttle: 5 })).toEqual({ type: 'move', heading: 1, throttle: 1 });
    expect(validateAction({ type: 'attack', heading: NaN })).toBeNull();
    expect(validateAction({ type: 'evade' })).toEqual({ type: 'evade', heading: undefined });
    expect(validateAction('attack')).toBeNull();
  });
});

describe('core runtime', () => {
  it('rejects malformed cores', () => {
    expect(() => compileCore('module.exports = {}')).toThrow(CoreLoadError);
    expect(() => compileCore('module.exports = { meta: {}, tick() {} }')).toThrow(/meta.name/);
    expect(() => compileCore('this is not js')).toThrow(/syntax/);
  });

  it('seeds Math.random and hides Date / fetch', () => {
    const src = `module.exports = { meta: { name: 'R' }, tick() { return null; },
      probe: [Math.random(), typeof Date, typeof fetch, typeof globalThis] };`;
    const a = compileCore(src);
    expect(a.meta.name).toBe('R');
    const mod = { exports: {} as { probe?: unknown[] } };
    new Function('module', 'Math', 'Date', 'fetch', 'globalThis', src)(mod, Object.assign(Object.create(Math), { random: () => 0.5 }));
    expect(mod.exports.probe!.slice(1)).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('node:vm runtime matches the inline runtime and enforces timeouts', () => {
    const inline = ['hunter', 'sentinel'].map((n) => compileCore(builtin(n), n));
    const vm = ['hunter', 'sentinel'].map((n) => compileCoreVm(builtin(n), n));
    expect(run(vm, 5).result).toEqual(run(inline, 5).result);

    const hang = compileCoreVm(`module.exports = { meta: { name: 'HANG' }, tick(obs) { if (obs.tick === 3) for(;;){} return null; } };`, 'hang', { timeoutMs: 20 });
    const { result } = runMatch([hang.create(1), sitter('OK').create(2)], { seed: 1, config: { maxTicks: 10 } });
    expect(result.standings.find((s) => s.name === 'HANG')!.faults).toBeGreaterThanOrEqual(1);
  });
});

describe('tournament', () => {
  it('builds a consistent duel scoring matrix', () => {
    const cores = ['hunter', 'phantom', 'spinner'].map((n) => compileCore(builtin(n), n));
    const t = runTournament(cores, { rounds: 3, baseSeed: 9 });
    expect(t.matrix.score).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(t.matrix.score[i][i]).toBeNull();
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        expect(t.matrix.score[i][j]).toBeCloseTo(-(t.matrix.score[j][i] as number), 6);
        expect((t.matrix.winRate[i][j] as number) + (t.matrix.winRate[j][i] as number)).toBeCloseTo(1, 6);
      }
    }
    expect(t.leaderboard.reduce((n, r) => n + r.matches, 0)).toBe(3 * 2 * 3);
    expect(t.leaderboard[0].rank).toBe(1);
  });
});
