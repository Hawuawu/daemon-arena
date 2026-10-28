// @name        DRIFTER
// @author      arena
// @color       #39ff14
// @description Random waypoints, random fire.

let wx = null, wy = null;

function init(arena) {
  wx = arena.width / 2;
  wy = arena.height / 2;
}

function tick(obs) {
  const arena = obs.arena;
  if (distanceTo(wx, wy) < 40) {
    wx = 80 + random() * (arena.width - 160);
    wy = 80 + random() * (arena.height - 160);
  }
  if (obs.self.attackCooldown === 0 && random() < 0.5) return attack(random() * TAU);
  return move(angleTo(wx, wy));
}
