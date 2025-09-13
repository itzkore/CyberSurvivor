/**
 * Ghost Operative — distance-based damage bonus helper.
 * Moved into operative folder per request. Keep logic isolated and documented.
 */

/** Threshold distance in pixels after which Ghost-based shots gain a bonus. */
export const GHOST_RANGE_THRESHOLD_PX = 600;

/**
 * Compute a non-crit multiplicative bonus based on travel distance.
 * For Ghost Sniper and Spectral Executioner we use a flat 1.25× beyond threshold.
 * Returns 1.0 when under threshold.
 */
export function computeGhostRangeBonus(distPx: number): number {
  return distPx > GHOST_RANGE_THRESHOLD_PX ? 1.25 : 1.0;
}
