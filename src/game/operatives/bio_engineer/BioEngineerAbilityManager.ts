import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import '../../keyState';
import type { Player } from '../../Player';
import { MycelialNetworkRMB } from './abilities/mycelial_network_rmb';

/** Bio Engineer Ability Manager
 * - Wires RMB Mycelial Network
 * - Exposes cooldown meter for HUD
 */
export class BioEngineerAbilityManager extends BaseAbilityManagerImpl {
  private network?: MycelialNetworkRMB;

  constructor() { super('bio_engineer'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.network = new MycelialNetworkRMB(g);
      // Expose HUD meter from start
      const self = this;
      if (!player.getBioNetworkMeter) {
        player.getBioNetworkMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          const m = self.network ? self.network.getMeter(now) : { value: 0, max: 15000, ready: true };
          return { value: m.value, max: m.max, ready: m.ready };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.network) this.network = new MycelialNetworkRMB(g);
    // RMB edge from global mouseState
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const edge = rDown && !prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const camX = g.camX || 0, camY = g.camY || 0;
    if (!inputLocked) this.network!.update(now, deltaTime, rDown, edge, camX, camY);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const out: any = {};
    const p: any = this.player;
    if (p && typeof p.getBioNetworkMeter === 'function') {
      const m = p.getBioNetworkMeter();
      out.bio_network = { value: m.value, max: m.max, ready: m.ready, active: false };
    }
    // Also surface base Space/Shift meters already provided by Player for HUD
    if (p && typeof p.getBioOutbreakMeter === 'function') {
      const m = p.getBioOutbreakMeter();
      out.bio_outbreak = { value: m.value, max: m.max, ready: m.ready, active: m.active };
    }
    if (p && typeof p.getBioBoostMeter === 'function') {
      const m = p.getBioBoostMeter();
      out.bio_boost = { value: m.value, max: m.max, ready: m.ready, active: m.active };
    }
    return out;
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }
}
