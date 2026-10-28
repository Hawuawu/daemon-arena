import { defineCore } from '../src/api';
import { TAU, angleTo, distance, estimateImpactDistance, wallClearance, wrapAngle } from './lib/nav';

interface Shot { x: number; y: number; h: number }
interface Mem {
  shots: Record<number, Shot>;
  tx: number | null;
  ty: number | null;
  conf: number;
  scan: number;
  orbit: number;
}

/**
 * Uses hit timing to triangulate: a hit on tick T for a shot fired at tick F from (x, y) at angle h
 * means the target was about speed * (T - F) units along that ray. Hunts that estimate,
 * strafes while the gun cools, and evades when hurt.
 */
export default defineCore({
  meta: { name: 'HUNTER', author: 'arena', version: '1.0', color: '#ff6b00', description: 'Triangulates from hit timing.' },
  init(_arena, ctx) {
    const m: Mem = { shots: {}, tx: null, ty: null, conf: 0, scan: ctx.random() * TAU, orbit: 1 };
    Object.assign(ctx.memory, m);
  },
  tick(obs, ctx) {
    const m = ctx.memory as unknown as Mem;
    const { self, arena } = obs;

    for (const e of obs.events) {
      if (e.type === 'hit') {
        const s = m.shots[e.firedAt];
        if (s) {
          const d = estimateImpactDistance(e.firedAt, obs.tick, arena);
          m.tx = s.x + Math.cos(s.h) * d;
          m.ty = s.y + Math.sin(s.h) * d;
          m.conf = Math.min(m.conf + 3, 8);
        }
      }
      if (e.type === 'wall') m.orbit = -m.orbit;
    }
    if (obs.events.some((e) => e.type === 'hurt') && self.evadeCooldown === 0) {
      return { type: 'evade', heading: self.heading + (m.orbit * Math.PI) / 2 };
    }

    if (self.attackCooldown === 0) {
      let aim: number;
      if (m.tx !== null && m.ty !== null && m.conf > 0) {
        aim = angleTo(self.x, self.y, m.tx, m.ty) + (ctx.random() - 0.5) * 0.25;
        m.conf -= 0.5;
      } else {
        m.scan = wrapAngle(m.scan + 0.45);
        aim = m.scan;
      }
      m.shots[obs.tick] = { x: self.x, y: self.y, h: aim };
      delete m.shots[obs.tick - 150];
      return { type: 'attack', heading: aim };
    }

    if (wallClearance(self, arena) < 90) return { type: 'move', heading: angleTo(self.x, self.y, arena.width / 2, arena.height / 2) };
    if (m.tx !== null && m.ty !== null && m.conf > 0) {
      const toTarget = angleTo(self.x, self.y, m.tx, m.ty);
      const d = distance(self.x, self.y, m.tx, m.ty);
      const heading = d > 320 ? toTarget : toTarget + (m.orbit * Math.PI) / 2;
      return { type: 'move', heading };
    }
    return { type: 'move', heading: self.heading + 0.04 * m.orbit, throttle: 0.7 };
  },
});
