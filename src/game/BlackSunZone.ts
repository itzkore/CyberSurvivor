import type { Player } from './Player';

export type BlackSunSeedParams = {
  fuseMs: number;
  pullRadius: number;
  pullStrength: number;
  collapseRadius: number;
  slowPct: number;
  tickIntervalMs: number;
  ticks: number;
  tickDmg: number;
  collapseDmg: number;
};

// Zone data structure removed; stubbing out for compatibility
class BlackSunSeed {}

/**
 * Black Sun zones disabled: this manager is a no-op stub.
 *
 * Rationale: request to remove the Black Sun zone. We keep the class/API so
 * references in EnemyManager/Player remain valid, but nothing spawns or updates.
 */
export class BlackSunZoneManager {
  private seeds: BlackSunSeed[] = [];
  private player: Player;

  constructor(enemyManager: any, player: Player) {
    // enemyManager intentionally unused in stub
    this.player = player;
  }

  spawn(x:number, y:number, params: BlackSunSeedParams): void {
    // No-op: zones are disabled
    return;
  }

  isPointWithinAny(x:number, y:number, expand:number = 0): boolean {
    return false;
  }

  /**
   * Returns true if a point lies within a short-lived spawn suppression ring or inside any active pull radius.
   * Use this to fully suppress and clear outward knockback on and right after seed spawn.
   * The suppression ring is slightly larger than pullRadius to catch fringe targets.
   */
  shouldSuppressKnockbackAt(_x:number, _y:number): boolean { return false; }

  update(deltaMs:number): void {
    // No-op: zones are disabled
    return;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // No-op visuals; zones are removed
    return;
  }

  /** Returns true if a point lies within any short-lived spawn-suppression ring. */
  public isWithinSpawnSuppress(x:number, y:number): boolean {
    return false;
  }
}
