import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { PhantomBladesRMB } from './abilities/phantom_blades_rmb';

export class ShadowOperativeAbilityManager extends BaseAbilityManagerImpl {
  private blades?: PhantomBladesRMB;

  constructor() { super('shadow_operative'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.blades = new PhantomBladesRMB(g, player as Player);
      const self = this;
      if (!(player as any).getShadowRmbMeter) {
        (player as any).getShadowRmbMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          return self.blades ? self.blades.getMeter(now) : { value: 0, max: 22000, ready: true, active: false };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.blades) this.blades = new PhantomBladesRMB(g, p);
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const downEdge = rDown && !prev;
    const upEdge = !rDown && prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (!inputLocked) {
      if (downEdge) this.blades!.beginAim(now);
      if (rDown) this.blades!.update(now, deltaTime);
      if (upEdge) this.blades!.commit(now);
    } else {
      // Cancel if UI locks inputs
      if (rDown || downEdge) this.blades!.cancelAim();
    }
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const p:any = this.player;
    if (p?.getShadowRmbMeter) {
      const m = p.getShadowRmbMeter();
      return { shadow_rmb: { value: m.value, max: m.max, ready: m.ready, active: !!m.active } };
    }
    return {};
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  renderPostFog(ctx: CanvasRenderingContext2D, _player: any): void {
    try { this.blades?.render(ctx); } catch {}
  }

  onTimeShift(deltaMs: number): void { try { (this.blades as any)?.onTimeShift?.(deltaMs); } catch {} }
}
