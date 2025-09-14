import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { SiegeBarrageRMB } from './abilities/siege_barrage_rmb';

export class TitanMechAbilityManager extends BaseAbilityManagerImpl {
  private barrage?: SiegeBarrageRMB;

  constructor() { super('titan_mech'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.barrage = new SiegeBarrageRMB(g, player as Player);
      const self = this;
      if (!(player as any).getTitanRmbMeter) {
        (player as any).getTitanRmbMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          return self.barrage ? self.barrage.getMeter(now) : { value: 0, max: 24000, ready: true, active: false };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.barrage) this.barrage = new SiegeBarrageRMB(g, p);
    const ms: any = (window as any).mouseState; const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const downEdge = rDown && !prev; const upEdge = !rDown && prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (inputLocked) {
      if (rDown || downEdge) this.barrage!.cancelAim();
      this.barrage!.update(now, deltaTime);
      return;
    }
    if (downEdge) this.barrage!.beginAim(now);
    if (upEdge) this.barrage!.commit(now);
    // Always tick barrage so scheduled impacts fire even after release
    this.barrage!.update(now, deltaTime);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const p:any = this.player;
    if (p?.getTitanRmbMeter) {
      const m = p.getTitanRmbMeter();
      return { titan_rmb: { value: m.value, max: m.max, ready: m.ready, active: !!m.active } };
    }
    return {};
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  renderPostFog(ctx: CanvasRenderingContext2D, _player: any): void { try { this.barrage?.render(ctx); } catch {} }

  onTimeShift(deltaMs: number): void { try { (this.barrage as any)?.onTimeShift?.(deltaMs); } catch {} }
}
