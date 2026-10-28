import { defineCore } from '../src/api';

/** Baseline: spins slowly in place and fires along its heading whenever the gun is cool. */
export default defineCore({
  meta: { name: 'SPINNER', author: 'arena', version: '1.0', color: '#f9f871', description: 'Rotating turret baseline.' },
  tick(obs) {
    const aim = obs.tick * 0.05;
    if (obs.self.attackCooldown === 0) return { type: 'attack', heading: aim };
    return { type: 'move', heading: obs.self.heading + 0.5, throttle: 0.1 };
  },
});
