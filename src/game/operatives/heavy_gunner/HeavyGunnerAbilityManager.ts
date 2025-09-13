import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { MicroTurretRMB } from './abilities/microturret_rmb';

/**
 * Heavy Gunner Ability Manager
 * - Wires RMB Micro Turret ability
 * - Leaves minigun/overheat to Player (existing implementation)
 */
export class HeavyGunnerAbilityManager extends BaseAbilityManagerImpl {
  constructor() {
    super('heavy_gunner');
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any;
    if (!p) return;
    // If input is locked, do not allow placing a new turret, but let existing turret tick (firing/TTL)
    const hasTurret = !!((p as any).__hgTurret && (p as any).__hgTurret.turret);
    if (inputLocked && !hasTurret) {
      // Ensure HUD class bar shows even before first use
      if (!p.getGunnerTurret) {
        const COOLDOWN_MS = 20000;
        p.getGunnerTurret = function() {
          return { value: COOLDOWN_MS, max: COOLDOWN_MS, ready: true, active: false };
        };
      }
      return;
    }
    MicroTurretRMB.update(p, deltaTime);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const p = this.player as Player;
    const meter = MicroTurretRMB.getMeter(p) as any;
    if (meter) return { gunner_micro_turret: meter };
    return {};
  }

  handleKeyPress(_key: string, _keyState: any): boolean {
    // MicroTurret handles RMB edge internally via mouseState; nothing to do here
    return false;
  }

  render(ctx: CanvasRenderingContext2D, _player: any): void {
    try { MicroTurretRMB.drawWorld(this.player as Player & any, ctx); } catch {}
    // Note: drawOverlay is skipped here to avoid mixing spaces; HUD already shows cooldown ring.
  }
}
