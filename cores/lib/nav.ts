import type { ArenaInfo, SelfState } from '../../src/api';

export const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return a;
}

export function angleTo(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.atan2(toY - fromY, toX - fromX);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Heading toward the arena center. */
export function towardCenter(self: SelfState, arena: ArenaInfo): number {
  return angleTo(self.x, self.y, arena.width / 2, arena.height / 2);
}

/** Distance to the closest wall. */
export function wallClearance(self: SelfState, arena: ArenaInfo): number {
  return Math.min(self.x, self.y, arena.width - self.x, arena.height - self.y);
}

/**
 * Estimate where a projectile fired at tick `firedAt` struck, given it was observed as a hit on `nowTick`.
 * Projectiles fly in a straight line at constant speed, so travel time encodes distance.
 */
export function estimateImpactDistance(firedAt: number, nowTick: number, arena: ArenaInfo): number {
  return arena.daemonRadius + 5 + arena.projectileSpeed * Math.max(1, nowTick - firedAt);
}
