import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import '../../keyState'; // Ensure mouseState/right-click tracking is available globally
import type { Player } from '../../Player';
import { ScavengerRedirectRMB } from './abilities/redirect_rmb';

/**
 * Wasteland Scavenger Ability Manager
 * - Wires RMB Scrap Lash redirect
 * - Exposes cooldown meters for HUD (redirect + pulse)
 */
export class WastelandScavengerAbilityManager extends BaseAbilityManagerImpl {
  private redirect?: ScavengerRedirectRMB;

  constructor() {
    super('wasteland_scavenger');
  }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) this.redirect = new ScavengerRedirectRMB(g);
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    // Ensure helper exists
    if (!this.redirect) this.redirect = new ScavengerRedirectRMB(g);

    // Read RMB edge from global mouse state (consistent with other managers)
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const edge = rDown && !prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const camX = g.camX || 0, camY = g.camY || 0;
    // Allow redirect while input is not globally locked
    if (!inputLocked) this.redirect!.update(now, deltaTime, rDown, edge, camX, camY);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const p: any = this.player;
    const out: any = {};
    if (p && typeof p.getScavengerRedirect === 'function') {
      const m = p.getScavengerRedirect();
      out.scavenger_redirect = { value: m.value, max: m.max, ready: m.ready, active: false };
    }
    if (p && typeof p.getScavengerPulse === 'function') {
      const m = p.getScavengerPulse();
      out.scavenger_pulse = { value: m.value, max: m.max, ready: m.ready, active: false };
    }
    return out;
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  onTimeShift(deltaMs: number): void {
    const r: any = this.redirect as any; if (!r) return;
    try {
      if (typeof r['redirectCdUntil'] === 'number') r['redirectCdUntil'] += deltaMs;
      if (typeof r['pulseCdUntil'] === 'number') r['pulseCdUntil'] += deltaMs;
    } catch {}
  }
}
