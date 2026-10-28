import type { Action, ArenaInfo, DaemonEvent, Observation } from '../api';
import type { CoreRuntime } from '../runtime/types';
import { resolveConfig, type ArenaConfig } from './config';
import { clamp, normalizeAngle, round2, segmentHitsCircle } from './math';
import { createRng } from './rng';
import type { DaemonStats, Frame, FrameDaemon, FrameEvent, MatchResult, Replay, ReplayDaemon, Standing } from './types';

export const PALETTE = ['#00f0ff', '#ff2bd6', '#f9f871', '#39ff14', '#ff6b00', '#9d4dff', '#ff3864', '#2de2e6'];

interface Daemon {
  id: number;
  runtime: CoreRuntime;
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  integrity: number;
  attackCd: number;
  evadeCd: number;
  phase: number;
  alive: boolean;
  moving: boolean;
  events: DaemonEvent[];
  stats: DaemonStats;
}

interface Projectile {
  owner: number;
  firedAt: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  dodged: Set<number>;
}

export interface MatchOptions {
  seed: number;
  config?: Partial<ArenaConfig>;
  /** Record a full replay (frames). Off for fast tournaments. */
  record?: boolean;
  onLog?: (daemonId: number, line: string) => void;
  now?: () => number;
}

export interface MatchOutput {
  result: MatchResult;
  replay?: Replay;
}

const IDLE: Action = { type: 'idle' };

export function validateAction(raw: unknown): Action | null {
  if (raw === null || raw === undefined) return IDLE;
  if (typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  switch (a.type) {
    case 'idle':
      return IDLE;
    case 'move':
      if (!num(a.heading)) return null;
      if (a.throttle !== undefined && !num(a.throttle)) return null;
      return { type: 'move', heading: a.heading as number, throttle: clamp((a.throttle as number | undefined) ?? 1, 0, 1) };
    case 'attack':
      if (!num(a.heading)) return null;
      return { type: 'attack', heading: a.heading as number };
    case 'evade':
      if (a.heading !== undefined && !num(a.heading)) return null;
      return { type: 'evade', heading: a.heading as number | undefined };
    default:
      return null;
  }
}

function emptyStats(integrity: number): DaemonStats {
  return { score: 0, hits: 0, hurts: 0, shots: 0, evades: 0, dodges: 0, wallHits: 0, faults: 0, derezzedAt: null, integrity };
}

function spawn(count: number, cfg: ArenaConfig, rng: () => number): { x: number; y: number; heading: number }[] {
  const margin = 80;
  const minSep = Math.min(cfg.width, cfg.height) / (count > 4 ? 4 : 2.5);
  const out: { x: number; y: number; heading: number }[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: 0, y: 0, d: -1 };
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = margin + rng() * (cfg.width - 2 * margin);
      const y = margin + rng() * (cfg.height - 2 * margin);
      const d = out.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), Infinity);
      if (d > best.d) best = { x, y, d };
      if (d >= minSep) break;
    }
    out.push({ x: best.x, y: best.y, heading: normalizeAngle(rng() * Math.PI * 2) });
  }
  return out;
}

export function arenaInfo(cfg: ArenaConfig, daemons: number): ArenaInfo {
  return {
    width: cfg.width,
    height: cfg.height,
    daemonRadius: cfg.daemonRadius,
    maxSpeed: cfg.maxSpeed,
    turnRate: cfg.turnRate,
    projectileSpeed: cfg.projectileSpeed,
    attackCooldown: cfg.attackCooldown,
    evadeCooldown: cfg.evadeCooldown,
    evadeTicks: cfg.evadeTicks,
    maxIntegrity: cfg.maxIntegrity,
    hitDamage: cfg.hitDamage,
    daemons,
    maxTicks: cfg.maxTicks,
  };
}

export function rankStandings(daemons: { id: number; name: string; stats: DaemonStats }[]): { standings: Standing[]; winner: number | null } {
  const standings: Standing[] = daemons.map((d) => ({
    id: d.id,
    name: d.name,
    rank: 0,
    accuracy: d.stats.shots > 0 ? round2(d.stats.hits / d.stats.shots) : 0,
    ...d.stats,
  }));
  standings.sort((a, b) => b.score - a.score || b.integrity - a.integrity || a.id - b.id);
  standings.forEach((s, i) => {
    const prev = standings[i - 1];
    s.rank = prev && prev.score === s.score && prev.integrity === s.integrity ? prev.rank : i + 1;
  });
  const top = standings.filter((s) => s.rank === 1);
  return { standings, winner: top.length === 1 ? top[0].id : null };
}

/** Run one deterministic match between already-instantiated core runtimes. */
export function runMatch(runtimes: CoreRuntime[], opts: MatchOptions): MatchOutput {
  const cfg = resolveConfig(opts.config);
  const now = opts.now ?? (() => globalThis.performance?.now() ?? Date.now());
  const rng = createRng(opts.seed);
  const info = arenaInfo(cfg, runtimes.length);
  const spawns = spawn(runtimes.length, cfg, rng);

  const daemons: Daemon[] = runtimes.map((runtime, id) => ({
    id,
    runtime,
    ...spawns[id],
    vx: 0,
    vy: 0,
    integrity: cfg.maxIntegrity,
    attackCd: 0,
    evadeCd: 0,
    phase: 0,
    alive: true,
    moving: false,
    events: [],
    stats: emptyStats(cfg.maxIntegrity),
  }));
  let projectiles: Projectile[] = [];
  const hitMatrix = daemons.map(() => daemons.map(() => 0));
  const frames: Frame[] = [];
  let frameEvents: FrameEvent[] = [];

  const fault = (d: Daemon, msg: string) => {
    d.stats.faults++;
    if (opts.record) frameEvents.push({ k: 'fault', d: d.id, msg: msg.slice(0, 200) });
  };
  const flushLogs = (d: Daemon) => {
    for (const line of d.runtime.drainLogs()) opts.onLog?.(d.id, line);
  };

  for (const d of daemons) {
    try {
      d.runtime.init(info);
    } catch (err) {
      fault(d, `init: ${String((err as Error)?.message ?? err)}`);
    }
    flushLogs(d);
  }

  const snapshot = (t: number) => {
    frames.push({
      t,
      d: daemons.map((d): FrameDaemon => [
        round2(d.x), round2(d.y), round2(d.heading), d.integrity, d.stats.score,
        (d.alive ? 1 : 0) | (d.phase > 0 ? 2 : 0) | (d.moving ? 4 : 0),
      ]),
      p: projectiles.map((p) => [round2(p.x), round2(p.y), p.owner]),
      e: frameEvents,
    });
    frameEvents = [];
  };
  if (opts.record) snapshot(0);

  let tick = 0;
  const multi = daemons.length > 1;
  while (tick < cfg.maxTicks) {
    tick++;

    // 1. Decide: every live daemon sees the same world state.
    const actions = new Map<number, Action>();
    for (const d of daemons) {
      if (!d.alive) continue;
      const obs: Observation = {
        tick,
        ticksLeft: cfg.maxTicks - tick,
        self: {
          x: d.x, y: d.y, heading: d.heading, vx: d.vx, vy: d.vy,
          speed: Math.hypot(d.vx, d.vy), integrity: d.integrity,
          attackCooldown: d.attackCd, evadeCooldown: d.evadeCd, phasing: d.phase > 0,
        },
        events: d.events,
        arena: info,
      };
      d.events = [];
      let action: Action = IDLE;
      const started = now();
      try {
        const raw = d.runtime.tick(obs);
        const valid = validateAction(raw);
        if (valid) action = valid;
        else fault(d, `invalid action: ${safeJson(raw)}`);
      } catch (err) {
        fault(d, String((err as Error)?.message ?? err));
      }
      if (now() - started > cfg.tickBudgetMs) {
        fault(d, `tick budget exceeded (${cfg.tickBudgetMs}ms)`);
        action = IDLE;
      }
      flushLogs(d);
      actions.set(d.id, action);
    }

    // 2. Act.
    for (const d of daemons) {
      if (!d.alive) continue;
      if (d.attackCd > 0) d.attackCd--;
      if (d.evadeCd > 0) d.evadeCd--;
      if (d.phase > 0) d.phase--;
      const a = actions.get(d.id) ?? IDLE;
      d.moving = false;
      if (a.type === 'move') {
        const diff = normalizeAngle(a.heading - d.heading);
        d.heading = normalizeAngle(d.heading + clamp(diff, -cfg.turnRate, cfg.turnRate));
        const thrust = cfg.accel * (a.throttle ?? 1);
        d.vx += Math.cos(d.heading) * thrust;
        d.vy += Math.sin(d.heading) * thrust;
        d.moving = thrust > 0;
      } else if (a.type === 'evade' && d.evadeCd === 0) {
        const h = normalizeAngle(a.heading ?? d.heading - Math.PI / 2);
        d.vx = Math.cos(h) * cfg.evadeSpeed;
        d.vy = Math.sin(h) * cfg.evadeSpeed;
        d.phase = cfg.evadeTicks;
        d.evadeCd = cfg.evadeCooldown;
        d.stats.evades++;
        if (opts.record) frameEvents.push({ k: 'evade', d: d.id, h: round2(h) });
      } else if (a.type === 'attack' && d.attackCd === 0) {
        const h = normalizeAngle(a.heading);
        const off = cfg.daemonRadius + cfg.projectileRadius + 2;
        const x = d.x + Math.cos(h) * off;
        const y = d.y + Math.sin(h) * off;
        projectiles.push({
          owner: d.id, firedAt: tick, x, y,
          vx: Math.cos(h) * cfg.projectileSpeed, vy: Math.sin(h) * cfg.projectileSpeed,
          age: 0, dodged: new Set(),
        });
        d.attackCd = cfg.attackCooldown;
        d.stats.shots++;
        if (opts.record) frameEvents.push({ k: 'fire', d: d.id, x: round2(x), y: round2(y), h: round2(h) });
      }
    }

    // 3. Integrate chassis.
    for (const d of daemons) {
      if (!d.alive) continue;
      const speed = Math.hypot(d.vx, d.vy);
      if (d.phase > 0) {
        d.vx *= 0.9;
        d.vy *= 0.9;
      } else if (speed > cfg.maxSpeed) {
        const k = Math.max(cfg.maxSpeed / speed, 0.8);
        d.vx *= k;
        d.vy *= k;
      } else if (!d.moving) {
        d.vx *= cfg.friction;
        d.vy *= cfg.friction;
      }
      d.x += d.vx;
      d.y += d.vy;
      const r = cfg.daemonRadius;
      let bumped = false;
      if (d.x < r) { d.x = r; d.vx = -d.vx * cfg.wallBounce; bumped = true; }
      if (d.x > cfg.width - r) { d.x = cfg.width - r; d.vx = -d.vx * cfg.wallBounce; bumped = true; }
      if (d.y < r) { d.y = r; d.vy = -d.vy * cfg.wallBounce; bumped = true; }
      if (d.y > cfg.height - r) { d.y = cfg.height - r; d.vy = -d.vy * cfg.wallBounce; bumped = true; }
      if (bumped) {
        d.stats.wallHits++;
        d.events.push({ type: 'wall' });
        if (opts.record) frameEvents.push({ k: 'wall', d: d.id, x: round2(d.x), y: round2(d.y) });
      }
    }

    // 4. Projectiles.
    const survivors: Projectile[] = [];
    for (const p of projectiles) {
      const x0 = p.x;
      const y0 = p.y;
      p.x += p.vx;
      p.y += p.vy;
      p.age++;
      let consumed = false;
      for (const d of daemons) {
        if (!d.alive || d.id === p.owner) continue;
        if (!segmentHitsCircle(x0, y0, p.x, p.y, d.x, d.y, cfg.daemonRadius + cfg.projectileRadius)) continue;
        if (d.phase > 0) {
          if (!p.dodged.has(d.id)) {
            p.dodged.add(d.id);
            d.stats.dodges++;
            if (opts.record) frameEvents.push({ k: 'dodge', d: d.id, x: round2(p.x), y: round2(p.y) });
          }
          continue;
        }
        const owner = daemons[p.owner];
        d.integrity = Math.max(0, d.integrity - cfg.hitDamage);
        d.stats.integrity = d.integrity;
        d.stats.hurts++;
        d.stats.score += cfg.scoring.hurt;
        d.events.push({ type: 'hurt' });
        owner.stats.hits++;
        hitMatrix[owner.id][d.id]++;
        owner.stats.score += cfg.scoring.hit;
        owner.events.push({ type: 'hit', firedAt: p.firedAt });
        if (opts.record) frameEvents.push({ k: 'hit', d: d.id, by: owner.id, x: round2(p.x), y: round2(p.y) });
        if (d.integrity <= 0) {
          d.alive = false;
          d.phase = 0;
          d.stats.derezzedAt = tick;
          if (opts.record) frameEvents.push({ k: 'derez', d: d.id, x: round2(d.x), y: round2(d.y) });
        }
        consumed = true;
        break;
      }
      const inside = p.x >= 0 && p.y >= 0 && p.x <= cfg.width && p.y <= cfg.height;
      if (!consumed && inside && p.age < cfg.projectileLifetime) survivors.push(p);
    }
    projectiles = survivors;

    if (opts.record) snapshot(tick);
    const alive = daemons.filter((d) => d.alive).length;
    if (multi ? alive <= 1 : alive === 0) break;
  }

  for (const d of daemons) d.runtime.dispose?.();

  const { standings, winner } = rankStandings(
    daemons.map((d) => ({ id: d.id, name: d.runtime.meta.name, stats: d.stats })),
  );
  const result: MatchResult = { seed: opts.seed, ticks: tick, standings, winner, hitMatrix };
  if (!opts.record) return { result };
  return {
    result,
    replay: {
      format: 'daemon-arena-replay',
      version: 1,
      seed: opts.seed,
      config: cfg,
      daemons: assignColors(daemons.map((d) => ({
        id: d.id,
        name: d.runtime.meta.name,
        author: d.runtime.meta.author,
        color: d.runtime.meta.color ?? '',
      }))),
      frames,
      result,
    },
  };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)?.slice(0, 120) ?? String(v);
  } catch {
    return String(v);
  }
}

function assignColors(list: ReplayDaemon[]): ReplayDaemon[] {
  const used = new Set<string>();
  return list.map((d) => {
    let color = d.color.toLowerCase();
    if (!color || used.has(color)) color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[d.id % PALETTE.length];
    used.add(color);
    return { ...d, color };
  });
}
