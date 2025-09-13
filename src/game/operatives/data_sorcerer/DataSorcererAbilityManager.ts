import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import '../../keyState';
import type { Player } from '../../Player';
import { DataStormRMB } from './abilities/data_storm_rmb';

/** Data Sorcerer Ability Manager
 * - Space: handled in Player via getSorcererSigilMeter
 * - RMB: Data Storm (>=8s duration) — sustained planting of Data Sigils around cursor center
 */
export class DataSorcererAbilityManager extends BaseAbilityManagerImpl {
  private storm?: DataStormRMB;

  constructor() { super('data_sorcerer'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.storm = new DataStormRMB(g);
      const self = this;
      // Expose HUD meter immediately
      if (!player.getSorcererStormMeter) {
        player.getSorcererStormMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          const m = self.storm ? self.storm.getMeter(now) : { value: 0, max: 30000, ready: true };
          return { value: m.value, max: m.max, ready: (m as any).ready, active: !!(m as any).active };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.storm) this.storm = new DataStormRMB(g);
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const edge = rDown && !prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const camX = g.camX || 0, camY = g.camY || 0;
    if (!inputLocked) this.storm!.update(now, deltaTime, rDown, edge, camX, camY);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const out: any = {};
    const p: any = this.player;
    if (p && typeof p.getSorcererStormMeter === 'function') {
      const m = p.getSorcererStormMeter();
      out.data_storm = { value: m.value, max: m.max, ready: m.ready, active: !!m.active };
    }
    // Also surface Space (Sigil Surge) via Player metering
    if (p && typeof p.getSorcererSigilMeter === 'function') {
      const sm = p.getSorcererSigilMeter();
      out.sigil_surge = { value: sm.value, max: sm.max, ready: sm.ready, active: false };
    }
    return out;
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  onTimeShift(deltaMs: number): void {
    const s: any = this.storm as any; if (!s) return;
    try {
      if (typeof s['cdUntil'] === 'number') s['cdUntil'] += deltaMs;
      if (typeof s['activeUntil'] === 'number') s['activeUntil'] += deltaMs;
    } catch {}
  }
}
