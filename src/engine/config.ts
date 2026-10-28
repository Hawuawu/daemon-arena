export interface ScoringRules {
  /** Points for each of your projectiles that strikes a daemon. */
  hit: number;
  /** Points for each projectile that strikes you (negative). */
  hurt: number;
}

export interface ArenaConfig {
  width: number;
  height: number;
  maxTicks: number;
  daemonRadius: number;
  maxSpeed: number;
  accel: number;
  friction: number;
  turnRate: number;
  projectileSpeed: number;
  projectileRadius: number;
  projectileLifetime: number;
  attackCooldown: number;
  evadeCooldown: number;
  evadeTicks: number;
  evadeSpeed: number;
  maxIntegrity: number;
  hitDamage: number;
  wallBounce: number;
  /** Max wall-clock ms a core may spend in one tick before it is treated as idle (fault). */
  tickBudgetMs: number;
  scoring: ScoringRules;
}

export const DEFAULT_SCORING: ScoringRules = { hit: 10, hurt: -10 };

export const DEFAULT_CONFIG: ArenaConfig = {
  width: 800,
  height: 800,
  maxTicks: 3000,
  daemonRadius: 20,
  maxSpeed: 4,
  accel: 0.5,
  friction: 0.94,
  turnRate: 0.14,
  projectileSpeed: 13,
  projectileRadius: 3,
  projectileLifetime: 110,
  attackCooldown: 15,
  evadeCooldown: 75,
  evadeTicks: 14,
  evadeSpeed: 12,
  maxIntegrity: 100,
  hitDamage: 5,
  wallBounce: 0.3,
  tickBudgetMs: 20,
  scoring: DEFAULT_SCORING,
};

export function resolveConfig(overrides: Partial<ArenaConfig> = {}): ArenaConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    scoring: { ...DEFAULT_SCORING, ...(overrides.scoring ?? {}) },
  };
}
