/** End-to-end tests of the agent CLI (scripts/arena.ts), run as a real subprocess. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtin, play, ROOT } from '../support/fixtures';

function arena(args: string[], cwd = ROOT) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'scripts', 'arena.ts'), ...args], {
    cwd: ROOT, env: { ...process.env, INIT_CWD: cwd }, encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
}

describe('arena CLI', { timeout: 30_000 }, () => {
  it('match --json prints the same MatchResult as the engine', () => {
    const r = arena(['match', 'hunter', 'spinner', '--seed', '7', '--ticks', '300', '--json']);
    expect(r.status).toBe(0);
    expect(r.json()).toEqual(play([builtin('hunter'), builtin('spinner')], { seed: 7, config: { maxTicks: 300 } }).result);
  });

  it('match --isolate gives the same result and --replay writes a replay file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'arena-'));
    const r = arena(['match', 'hunter', 'spinner', '--seed', '7', '--ticks', '300', '--isolate', '--json', '--replay', 'out.json'], dir);
    expect(r.status).toBe(0);
    const replay = JSON.parse(readFileSync(path.join(dir, 'out.json'), 'utf8'));
    expect(replay).toMatchObject({ format: 'daemon-arena-replay', seed: 7, result: r.json() });
  });

  it('tournament --json prints a TournamentResult with leaderboard and matrices', () => {
    const r = arena(['tournament', 'hunter', 'spinner', 'drifter', '--rounds', '1', '--ticks', '300', '--json']);
    expect(r.status).toBe(0);
    const t = r.json();
    expect(t.leaderboard).toHaveLength(3);
    expect(t.matrix.score).toHaveLength(3);
  });

  it('new scaffolds a valid core from the template, which validate accepts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'arena-'));
    expect(arena(['new', 'my-bot'], dir).status).toBe(0);
    expect(existsSync(path.join(dir, 'my-bot.js'))).toBe(true);
    const v = arena(['validate', 'my-bot.js', '--json'], dir);
    expect(v.json()).toEqual([{ ok: true, id: 'my-bot', meta: { name: 'MY-BOT', author: 'you', color: '#9d4dff' } }]);
    expect(arena(['new', 'my-bot'], dir).stderr).toMatch(/already exists/);
  });

  it.each([
    [['match', 'nope', '--json'], /core not found: nope/],
    [['tournament', 'hunter', '--json'], /at least 2 cores/],
    [['tournament', 'hunter', 'spinner', '--mode', 'chaos', '--json'], /--mode must be duel or ffa/],
    [['new', '../evil', '--json'], /usage: new/],
  ])('%j fails with exit code 1 and a JSON error', (args, message) => {
    const r = arena(args);
    expect(r.status).toBe(1);
    expect(r.json()).toEqual({ ok: false, error: expect.stringMatching(message) });
  });

  it('reports an invalid core file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'arena-'));
    writeFileSync(path.join(dir, 'bad.js'), '// @name BAD\nlet x = 1;');
    expect(arena(['validate', 'bad.js', '--json'], dir).json()).toEqual({ ok: false, error: expect.stringMatching(/function tick/) });
  });

  it('prints usage with --help (exit 0) and for an unknown command (exit 1)', () => {
    expect(arena(['--help'])).toMatchObject({ status: 0, stdout: expect.stringContaining('daemon-arena CLI') });
    expect(arena(['explode']).status).toBe(1);
  });
});
