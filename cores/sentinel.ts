import { defineCore } from '../src/api';
import { TAU, angleTo, distance, wrapAngle } from './lib/nav';

/**
 * Holds the center and sweeps fire around the compass. When a shot lands it remembers
 * the angle that shot was fired at and narrows the sweep around it.
 */
export default defineCore({
  meta: { name: 'SENTINEL', author: 'arena', version: '1.0', color: '#00f0ff', description: 'Center turret, sweep-and-lock.' },
  init(_arena, ctx) {
    Object.assign(ctx.memory, { sweep: 0, lock: null, lockTtl: 0, shots: {} });
  },
  tick(obs, ctx) {
    const m = ctx.memory as { sweep: number; lock: number | null; lockTtl: number; shots: Record<number, number> };
    const { self, arena } = obs;
    for (const e of obs.events) {
      if (e.type === 'hit' && m.shots[e.firedAt] !== undefined) {
        m.lock = m.shots[e.firedAt];
        m.lockTtl = 6;
      }
    }
    const cx = arena.width / 2;
    const cy = arena.height / 2;
    if (self.attackCooldown === 0) {
      let aim: number;
      if (m.lock !== null && m.lockTtl > 0) {
        aim = wrapAngle(m.lock + (ctx.random() - 0.5) * 0.35);
        m.lockTtl--;
      } else {
        m.lock = null;
        m.sweep = wrapAngle(m.sweep + TAU / 14);
        aim = m.sweep;
      }
      m.shots[obs.tick] = aim;
      delete m.shots[obs.tick - 200];
      return { type: 'attack', heading: aim };
    }
    if (distance(self.x, self.y, cx, cy) > 60) return { type: 'move', heading: angleTo(self.x, self.y, cx, cy), throttle: 0.6 };
    return { type: 'idle' };
  },
});
