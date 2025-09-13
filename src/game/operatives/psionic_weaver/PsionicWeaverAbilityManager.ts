import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { PhaseStitchRMB } from './abilities/phase_stitch_rmb';

export class PsionicWeaverAbilityManager extends BaseAbilityManagerImpl {
  private stitch?: PhaseStitchRMB;

  constructor() { super('psionic_weaver'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.stitch = new PhaseStitchRMB(g, player as Player);
      const self = this;
      if (!(player as any).getWeaverStitchMeter) {
        (player as any).getWeaverStitchMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          return self.stitch ? self.stitch.getMeter(now) : { value: 0, max: 15000, ready: true, active: false };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.stitch) this.stitch = new PhaseStitchRMB(g, p);
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const downEdge = rDown && !prev;
    const upEdge = !rDown && prev;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    if (!inputLocked) {
      if (downEdge) this.stitch!.beginAim();
      if (upEdge) {
        const cx = (ms && typeof ms.worldX === 'number') ? ms.worldX : p.x;
        const cy = (ms && typeof ms.worldY === 'number') ? ms.worldY : p.y;
        this.stitch!.commit(now, cx, cy);
      }
    } else {
      // Cancel aiming if input is locked (e.g., shop/cutscene)
      if (downEdge || rDown) this.stitch!.cancelAim();
    }

    this.stitch!.update(now, deltaTime);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const out: any = {};
    const p: any = this.player;
    if (p && typeof p.getWeaverStitchMeter === 'function') {
      const m = p.getWeaverStitchMeter();
      out.weaver_stitch = { value: m.value, max: m.max, ready: m.ready, active: !!m.active };
    }
    if (p && typeof p.getWeaverLatticeMeter === 'function') {
      const lm = p.getWeaverLatticeMeter();
      out.weaver_lattice = { value: lm.value, max: lm.max, ready: lm.ready, active: !!lm.active };
    }
    return out;
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  render(ctx: CanvasRenderingContext2D, player: any): void {
    try { this.stitch?.render(ctx, player); } catch {}
  }

  /** Shift internal timers when resuming from auto-pause. */
  onTimeShift(deltaMs: number): void {
    const s: any = this.stitch as any; if (!s) return;
    try {
      if (typeof s['cdUntil'] === 'number') s['cdUntil'] += deltaMs;
      if (typeof s['returnAt'] === 'number') s['returnAt'] += deltaMs;
      if (typeof s['lingerUntil'] === 'number') s['lingerUntil'] += deltaMs;
      if (typeof s['justTeleportedAt'] === 'number') s['justTeleportedAt'] += deltaMs;
      if (typeof s['justReturnedAt'] === 'number') s['justReturnedAt'] += deltaMs;
      if (s['activeThread'] && typeof s['activeThread'].ttlMs === 'number') s['activeThread'].ttlMs += 0; // TTL is relative; no shift
    } catch {}
  }
}
