import { screenToWorld } from '../../../../core/coords';
import { WEAPON_SPECS } from '../../../WeaponConfig';
import { WeaponType } from '../../../WeaponType';

/** Data Sorcerer RMB — Data Tornado (Data Storm rework)
 * Summons a single golden data tornado at the cursor that chases targets and pulses AoE
 * for a long duration (>=8s). Uses EnemyManager.spawnDataTornado (perf‑friendly, single zone).
 */
export class DataStormRMB {
  private game: any;
  private cdUntil = 0;
  private activeUntil = 0;
  // Long cooldown, long duration per user request
  private readonly cooldownMs = 30000; // 30s CD
  private readonly durationMs = 10000; // 10s active (still >=8s)

  constructor(game: any) { this.game = game; }

  /** Expose HUD meter for RMB cooldown */
  public getMeter(nowMs: number): { value: number; max: number; ready: boolean; active?: boolean } {
    const max = this.cooldownMs;
    const remain = Math.max(0, this.cdUntil - nowMs);
    const ready = remain <= 0;
    const active = nowMs < this.activeUntil;
    return { value: (max - remain), max, ready, active } as any;
  }

  /** Try cast on RMB edge; while active, EnemyManager handles tornado movement/damage. */
  update(nowMs: number, deltaMs: number, rDown: boolean, edge: boolean, camX: number, camY: number) {
    // Activate on edge if off cooldown
    if (edge && nowMs >= this.cdUntil) {
      // World‑space mouse position
      let wx = 0, wy = 0; const ms: any = (window as any).mouseState;
      if (ms && typeof ms.worldX === 'number' && typeof ms.worldY === 'number') { wx = ms.worldX; wy = ms.worldY; }
      else { const mx = (window as any).__mouseX || 0; const my = (window as any).__mouseY || 0; const w = screenToWorld(mx, my, camX, camY); wx = w.x; wy = w.y; }
      this.activeUntil = nowMs + this.durationMs; this.cdUntil = nowMs + this.cooldownMs;
      // Pull scaling from Data Sigil weapon to match progression
      let baseRadius = 120, baseDmg = 140;
      try {
        const lvl = this.game.player?.activeWeapons?.get(WeaponType.DATA_SIGIL) ?? 1;
        const spec: any = (WEAPON_SPECS as any)[WeaponType.DATA_SIGIL];
        const stats = spec?.getLevelStats ? spec.getLevelStats(lvl) : null;
        baseRadius = stats?.sigilRadius ?? baseRadius;
        baseDmg = stats?.pulseDamage ?? baseDmg;
      } catch { /* fallback */ }
  // Slow-moving tornado per request (further slowed)
  try { this.game.enemyManager?.spawnDataTornado(wx, wy, { radius: Math.round(baseRadius * 0.9), dmg: Math.round(baseDmg * 1.2), tickMs: 260, speed: 80, chaseRadius: 900, lifeMs: this.durationMs }); } catch {}
      // Feedback
      try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 110, intensity: 2.3 } })); } catch {}
      try { this.game.particleManager?.spawn(wx, wy, 18, '#FFE066', { sizeMin: 1, sizeMax: 2.8, lifeMs: 520, speedMin: 1.0, speedMax: 3.2 }); } catch {}
    }
    // No per-frame work needed; tornado is managed by EnemyManager
  }
}
