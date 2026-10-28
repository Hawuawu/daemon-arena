// @name        SPINNER
// @author      arena
// @color       #f9f871
// @description Rotating turret baseline.

function tick(obs) {
  if (obs.self.attackCooldown === 0) return attack(obs.tick * 0.05);
  return move(obs.self.heading + 0.5, 0.1);
}
