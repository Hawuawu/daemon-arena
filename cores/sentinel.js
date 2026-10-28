// @name        SENTINEL
// @author      arena
// @color       #00f0ff
// @description Center turret, sweep-and-lock.
//
// Holds the center and sweeps fire around the compass. When a shot lands it remembers the
// angle that shot was fired at and keeps firing around it for a while.

let sweep = 0;
let lock = null;
let lockTtl = 0;
const shots = {}; // tick -> angle

function tick(obs) {
  const me = obs.self;
  for (const e of obs.events) {
    if (e.type === 'hit' && shots[e.firedAt] !== undefined) {
      lock = shots[e.firedAt];
      lockTtl = 6;
    }
  }
  if (me.attackCooldown === 0) {
    let aim;
    if (lock !== null && lockTtl > 0) {
      aim = wrapAngle(lock + (random() - 0.5) * 0.35);
      lockTtl--;
    } else {
      lock = null;
      sweep = wrapAngle(sweep + TAU / 14);
      aim = sweep;
    }
    shots[obs.tick] = aim;
    delete shots[obs.tick - 200];
    return attack(aim);
  }
  const cx = obs.arena.width / 2;
  const cy = obs.arena.height / 2;
  if (distanceTo(cx, cy) > 60) return move(angleTo(cx, cy), 0.6);
  return idle();
}
