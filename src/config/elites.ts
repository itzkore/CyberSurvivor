import type { EliteKind } from '../game/elites/types';

/** Base visual radius per elite kind (kept in sync with EnemyManager scaling). */
export const ELITE_BASE_RADIUS: Record<EliteKind, number> = {
  DASHER: 60,
  GUNNER: 68,
  SUPPRESSOR: 72,
  BOMBER: 68,
  BLINKER: 60,
  BLOCKER: 72,
  SIPHON: 68,
} as any;

/** Soft caps by kind to limit simultaneous elites on screen. */
export const ELITE_SOFT_CAP: Record<EliteKind, number> = {
  DASHER: 18,
  GUNNER: 10,
  SUPPRESSOR: 12,
  BOMBER: 8,
  BLINKER: 10,
  BLOCKER: 8,
  SIPHON: 8,
} as any;

/** Deterministic schedule parameters. */
export const ELITE_SCHEDULE = {
  firstOffsetSec: 15,
  startIntervalSec: 30,
  intervalAt20MinSec: 6,
  minIntervalLateSec: 2.5,
};
