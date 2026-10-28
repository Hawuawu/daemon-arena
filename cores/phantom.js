// @name        PHANTOM
// @author      arena
// @color       #ff2bd6
// @description Orbit + evade on hurt.
//
// Circles the arena, phases away the moment it is hit, fires a rotating fan toward the center.

let fan = 0;
let dir = 1;

function tick(obs) {
  const me = obs.self;
  const arena = obs.arena;
  const center = angleTo(arena.width / 2, arena.height / 2);

  if (obs.events.some((e) => e.type === 'wall')) dir = -dir;
  if (obs.events.some((e) => e.type === 'hurt') && me.evadeCooldown === 0) {
    return evade(me.heading + (dir * Math.PI) / 2);
  }
  if (me.attackCooldown === 0 && obs.tick % 2 === 0) {
    fan = wrapAngle(fan + 0.9);
    return attack(center + Math.sin(fan) * 1.2);
  }
  const wall = Math.min(me.x, me.y, arena.width - me.x, arena.height - me.y);
  return move(wall < 70 ? center : center + (dir * Math.PI) / 2.2);
}
