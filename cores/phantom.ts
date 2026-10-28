import { defineCore } from '../src/api';
import { towardCenter, wallClearance, wrapAngle } from './lib/nav';

/** Circles the arena, phases away the moment it is hit, fires a rotating fan. */
export default defineCore({
  meta: { name: 'PHANTOM', author: 'arena', version: '1.0', color: '#ff2bd6', description: 'Orbit + evade on hurt.' },
  init(_arena, ctx) {
    ctx.memory.fan = 0;
    ctx.memory.dir = 1;
  },
  tick(obs, ctx) {
    const m = ctx.memory as { fan: number; dir: number };
    const { self, arena } = obs;
    const hurt = obs.events.some((e) => e.type === 'hurt');
    if (obs.events.some((e) => e.type === 'wall')) m.dir = -m.dir;
    if (hurt && self.evadeCooldown === 0) {
      return { type: 'evade', heading: self.heading + (m.dir * Math.PI) / 2 };
    }
    if (self.attackCooldown === 0 && obs.tick % 2 === 0) {
      m.fan = wrapAngle(m.fan + 0.9);
      return { type: 'attack', heading: towardCenter(self, arena) + Math.sin(m.fan) * 1.2 };
    }
    const orbit = towardCenter(self, arena) + (m.dir * Math.PI) / 2.2;
    const heading = wallClearance(self, arena) < 70 ? towardCenter(self, arena) : orbit;
    return { type: 'move', heading };
  },
});
