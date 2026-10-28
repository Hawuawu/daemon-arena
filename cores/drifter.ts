import { defineCore } from '../src/api';
import { angleTo, distance } from './lib/nav';

/** Baseline: wanders between random waypoints and sprays shots in random directions. */
export default defineCore({
  meta: { name: 'DRIFTER', author: 'arena', version: '1.0', color: '#39ff14', description: 'Random waypoints, random fire.' },
  init(arena, ctx) {
    ctx.memory.wx = arena.width / 2;
    ctx.memory.wy = arena.height / 2;
  },
  tick(obs, ctx) {
    const m = ctx.memory as { wx: number; wy: number };
    const { self, arena } = obs;
    if (distance(self.x, self.y, m.wx, m.wy) < 40) {
      m.wx = 80 + ctx.random() * (arena.width - 160);
      m.wy = 80 + ctx.random() * (arena.height - 160);
    }
    if (self.attackCooldown === 0 && ctx.random() < 0.5) return { type: 'attack', heading: ctx.random() * Math.PI * 2 };
    return { type: 'move', heading: angleTo(self.x, self.y, m.wx, m.wy) };
  },
});
