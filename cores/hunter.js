// @name        HUNTER
// @author      arena
// @color       #ff6b00
// @description Triangulates from hit timing.
//
// A hit on tick T for a shot fired at tick F from (x, y) at angle h means the target was about
// projectileSpeed * (T - F) units along that ray. Hunt that estimate, strafe while the gun
// cools, evade when hurt.

const shots = {};          // tick -> { x, y, h }
let tx = null, ty = null;  // estimated target position
let conf = 0;              // how much we trust it
let scan = random() * TAU;
let orbit = 1;

function tick(obs) {
  const me = obs.self;
  const arena = obs.arena;

  for (const e of obs.events) {
    if (e.type === 'hit' && shots[e.firedAt]) {
      const s = shots[e.firedAt];
      const d = arena.daemonRadius + 5 + arena.projectileSpeed * Math.max(1, obs.tick - e.firedAt);
      tx = s.x + Math.cos(s.h) * d;
      ty = s.y + Math.sin(s.h) * d;
      conf = Math.min(conf + 3, 8);
    }
    if (e.type === 'wall') orbit = -orbit;
  }
  if (obs.events.some((e) => e.type === 'hurt') && me.evadeCooldown === 0) {
    return evade(me.heading + (orbit * Math.PI) / 2);
  }

  if (me.attackCooldown === 0) {
    let aim;
    if (tx !== null && conf > 0) {
      aim = angleTo(tx, ty) + (random() - 0.5) * 0.25;
      conf -= 0.5;
    } else {
      scan = wrapAngle(scan + 0.45);
      aim = scan;
    }
    shots[obs.tick] = { x: me.x, y: me.y, h: aim };
    delete shots[obs.tick - 150];
    return attack(aim);
  }

  const wall = Math.min(me.x, me.y, arena.width - me.x, arena.height - me.y);
  if (wall < 90) return move(angleTo(arena.width / 2, arena.height / 2));
  if (tx !== null && conf > 0) {
    const toTarget = angleTo(tx, ty);
    return move(distanceTo(tx, ty) > 320 ? toTarget : toTarget + (orbit * Math.PI) / 2);
  }
  return move(me.heading + 0.04 * orbit, 0.7);
}
