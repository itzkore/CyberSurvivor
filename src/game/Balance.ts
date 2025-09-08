/**
 * Central balance constants used across gameplay & UI so displays stay consistent.
 */
export const SPEED_SCALE = 0.45; // Converts character sheet speed -> in‑game movement units
// Expose in window for runtime guards used in managers (defensive clamps)
try { (window as any).SPEED_SCALE = SPEED_SCALE; } catch {}

// --- Runtime / Progression Pacing ---
// Target: ~10 minute survival window (previously ~5) with 3 boss encounters.
// Boss every 180s -> 3 spawns at ~3m, 6m, 9m mark (player likely still active near 10m).
export const BOSS_SPAWN_INTERVAL_SEC = 180;

// Enemy pressure curve coefficients (baseline + linear * minutes + quadratic * minutes^2)
// Previously linear=60, quadratic=25 produced very steep ramp; we soften to prolong viability.
export const ENEMY_PRESSURE_BASE = 100;
export const ENEMY_PRESSURE_LINEAR = 80;      // per minute (harder ramp)
export const ENEMY_PRESSURE_QUADRATIC = 28;   // per minute^2 (much steeper late-game)

// XP economy adjustments – reduce overall XP gain rate so player progression spreads across ~10m
// Enemy base XP gem tiers (was small:1, medium:2, large:3). Medium & Large shifted down by 1 tier.
export const XP_ENEMY_BASE_TIERS: Record<string, number> = { small: 1, medium: 1, large: 2 };

// Scale factor applied to base gem upgrade roll thresholds ( <1 lowers upgrade frequency )
export const GEM_UPGRADE_PROB_SCALE = 0.6; // 60% of previous chance

// Player experience curve coefficients (used in Player.getNextExp)
// nextExp(level) = EXP_BASE + n*EXP_LINEAR + floor(n*n*EXP_QUAD) where n = level-1
// Slightly higher quadratic term spreads final two added upgrade levels to ~late run.
export const EXP_BASE = 6;
export const EXP_LINEAR = 3;
export const EXP_QUAD = 0.40; // was 0.35

// XP orb drop probability per enemy type (reduces orb count to smooth pacing)
// Small enemies drop less frequently; large more consistently.
export const XP_DROP_CHANCE_SMALL = 0.35;
export const XP_DROP_CHANCE_MEDIUM = 0.55;
export const XP_DROP_CHANCE_LARGE = 0.80;

// XP gem lifetime before expiring (milliseconds). Long enough to avoid punishing pace but keeps memory clean.
export const GEM_TTL_MS = 90000; // 90s

/**
 * Global healing efficiency over time.
 * Full efficiency through 15:00, then linearly drops to 1% by 30:00 and clamps thereafter.
 * @param gameTimeSec Elapsed gameplay time in seconds.
 * @returns Multiplier in [0.01, 1.0]
 */
export function getHealEfficiency(gameTimeSec: number): number {
	const minutes = gameTimeSec / 60;
	if (minutes <= 15) return 1.0;
	if (minutes >= 30) return 0.01;
	const t = (minutes - 15) / 15; // 0..1 across 15->30m
	return 1.0 - 0.99 * t; // 1.0 -> 0.01
}

