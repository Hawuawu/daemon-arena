// @name   __NAME__
// @author you
// @color  #9d4dff
//
// A daemon core is one plain JavaScript file. tick(obs) runs every tick and returns ONE action:
//   move(heading, throttle?)   evade(heading?)   attack(heading)   idle()
// You cannot see enemies. You only know your own chassis and what happened to you:
//   obs.self   = { x, y, heading, vx, vy, speed, integrity, attackCooldown, evadeCooldown, phasing }
//   obs.events = [{ type: 'hit', firedAt }, { type: 'hurt' }, { type: 'wall' }]
//   obs.arena  = { width, height, projectileSpeed, attackCooldown, evadeCooldown, ... }
//   obs.tick, obs.ticksLeft
// Helpers: angleTo(x, y), distanceTo(x, y), wrapAngle(a), TAU, random(), log(...)
// Top-level variables keep their value for the whole match.

let aim = random() * TAU;

function tick(obs) {
  const me = obs.self;
  if (obs.events.some((e) => e.type === 'hurt') && me.evadeCooldown === 0) return evade();
  if (me.attackCooldown === 0) return attack((aim += 0.4));
  return move(angleTo(obs.arena.width / 2, obs.arena.height / 2), 0.5);
}
