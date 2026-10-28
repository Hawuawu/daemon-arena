import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchSim, runMatch, validateAction } from '../src/engine/match';
import { hashSeed } from '../src/engine/rng';
import { runTournament } from '../src/engine/tournament';
import { compileCoreVm } from '../src/runtime/node';
import { CoreLoadError, compileCore, parseMeta } from '../src/runtime/sandbox';
import type { CoreFactory } from '../src/runtime/types';

const builtin = (name: string) => readFileSync(path.join(__dirname, '..', 'cores', `${name}.js`), 'utf8');
const run = (factories: CoreFactory[], seed: number, record = false, maxTicks?: number) =>
  runMatch(factories.map((f, i) => f.create(hashSeed(seed, i))), { seed, record, config: maxTicks ? { maxTicks } : undefined });
const script = (name: string, body: string) => `// @name ${name}\n${body}`;
const sitter = (name: string) => compileCore(script(name, 'function tick() { return idle(); }'));

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
    const probe = run([sitter('A'), sitter('B')], 7, true).replay!.frames[0].d;
    const heading = Math.atan2(probe[1][1] - probe[0][1], probe[1][0] - probe[0][0]);
    const shooter = compileCore(script('SHOOTER', `function tick(obs) { return obs.self.attackCooldown === 0 ? attack(${heading}) : null; }`));
    const target = compileCore(script('TARGET', `function tick(obs) {
      for (const e of obs.events) if (e.type !== 'hurt' && e.type !== 'wall') throw new Error('leak ' + e.type);
      return null; }`));
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
    const bad = compileCore(script('BAD', `function tick(obs) { if (obs.tick % 2) throw new Error('x'); return { type: 'teleport' }; }`));
    const { result } = run([bad, sitter('OK')], 1, false, 50);
    expect(result.standings.find((s) => s.name === 'BAD')!.faults).toBe(50);
  });

  it('keeps an offline (crashed) core on the field as a target', () => {
    const sim = new MatchSim([{ name: 'A' }, { name: 'B' }], { seed: 1, config: { maxTicks: 20 } });
    sim.setOffline(1, 'core unresponsive');
    while (!sim.done) {
      const obs = sim.observe();
      expect(obs.map((o) => o.id)).toEqual([0]);
      sim.step(new Map([[0, { raw: null, ms: 0 }]]));
    }
    const { result } = sim.finish();
    expect(result.ticks).toBe(20);
    expect(result.standings.find((s) => s.name === 'B')!.faults).toBe(1);
  });

  it('validates actions', () => {
    expect(validateAction(null)).toEqual({ type: 'idle' });
    expect(validateAction({ type: 'move', heading: 1, throttle: 5 })).toEqual({ type: 'move', heading: 1, throttle: 1 });
    expect(validateAction({ type: 'attack', heading: NaN })).toBeNull();
    expect(validateAction({ type: 'evade' })).toEqual({ type: 'evade', heading: undefined });
    expect(validateAction('attack')).toBeNull();
  });
});

describe('core scripts', () => {
  it('parses header metadata without running the script', () => {
    expect(parseMeta('// @name  X-1\n// @color #abc\n// @author me\nthrow 1')).toEqual({ name: 'X-1', color: '#abc', author: 'me' });
    expect(parseMeta('// @name X\n// @color red;background:url(x)').color).toBeUndefined();
    expect(() => parseMeta('function tick() {}')).toThrow(/@name/);
  });

  it('rejects malformed cores', () => {
    expect(() => compileCore('// @name X\nlet a = 1;')).toThrow(/function tick/);
    expect(() => compileCore('// @name X\nthis is not js')).toThrow(/syntax/);
    expect(() => compileCore('// @name X\nthrow new Error("boom")')).toThrow(CoreLoadError);
  });

  it('keeps top-level state per instance, seeds random() and hides ambient globals', () => {
    const src = script('R', `let n = 0; const r = random();
      const probe = [typeof Date, typeof fetch, typeof globalThis, typeof self, typeof Function, Math.random() === Math.random()];
      function tick() { n++; log(n, r, probe); return idle(); }`);
    const f = compileCore(src);
    const a = f.create(5);
    const b = f.create(5);
    a.tick({} as never);
    a.tick({} as never);
    b.tick({} as never);
    const [la, lb] = [a.drainLogs(), b.drainLogs()];
    expect(la).toHaveLength(2);
    expect(JSON.parse(`[${la[1].replace(/ /g, ',')}]`)[0]).toBe(2);
    expect(lb[0]).toBe(la[0]);
    expect(la[0]).toContain('["undefined","undefined","undefined","undefined","undefined",false]');
  });

  it('node:vm runtime matches the inline runtime and enforces timeouts', () => {
    const names = ['hunter', 'sentinel'];
    const inline = names.map((n) => compileCore(builtin(n), n));
    const vm = names.map((n) => compileCoreVm(builtin(n), n));
    expect(run(vm, 5).result).toEqual(run(inline, 5).result);

    const hang = compileCoreVm(script('HANG', 'function tick(obs) { if (obs.tick === 3) for(;;){} return null; }'), 'hang', { timeoutMs: 20 });
    const { result } = run([hang, sitter('OK')], 1, false, 10);
    expect(result.standings.find((s) => s.name === 'HANG')!.faults).toBeGreaterThanOrEqual(1);
  });
});

describe('tournament', () => {
  it('builds a consistent duel scoring matrix', () => {
    const cores = ['hunter', 'phantom', 'spinner'].map((n) => compileCore(builtin(n), n));
    const t = runTournament(cores, { rounds: 3, baseSeed: 9 });
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
