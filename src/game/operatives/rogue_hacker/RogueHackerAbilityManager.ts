import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { RogueHackerHackRMB } from './abilities/manualhack_rmb';

/**
 * Rogue Hacker Ability Manager
 * RMB: Backdoor Spike — place an empowered virus zone at target point.
 * Shift and Space remain handled by existing systems (Ghost Protocol + System Hack).
 */
export class RogueHackerAbilityManager extends BaseAbilityManagerImpl {
  private rmb?: RogueHackerHackRMB;
  private prevRight: boolean = false;

  constructor() { super('rogue_hacker'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    if (g) {
      this.rmb = new RogueHackerHackRMB(g, { radius: 120, minChargeMs: 0, fullChargeMs: 2000, cooldownMs: 30000 });
      this.rmb.setEnabled(true);
      const self = this;
      if (!(player as any).getHackerRmbMeter) {
        (player as any).getHackerRmbMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          return self.rmb ? self.rmb.getMeter(now) : { value: 0, max: 30000, ready: true, active: false };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.rmb) { this.rmb = new RogueHackerHackRMB(g); this.rmb.setEnabled(true); }
    const ms: any = (window as any).mouseState;
    const right = !!(ms && ms.right);

    if (inputLocked) {
      // Cancel charging if UI locks inputs (e.g., shop/cinematic)
      this.rmb.cancel();
      this.prevRight = right;
      return;
    }

    const worldX = (ms && typeof ms.worldX === 'number') ? ms.worldX : p.x;
    const worldY = (ms && typeof ms.worldY === 'number') ? ms.worldY : p.y;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.rmb.update(now, deltaTime, right, worldX, worldY);
    // While casting, freeze movement and suppress basic fire
    try {
      const charging = this.rmb.isCharging();
      p._inputMoveLocked = !!charging;
      p._basicFireSuppressed = !!charging;
    } catch {}
    this.prevRight = right;
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this.rmb) {
      const m = this.rmb.getMeter(now);
      return { hacker_rmb: { value: m.value, max: m.max, ready: m.ready, active: false } };
    }
    return { hacker_rmb: { value: 0, max: 30000, ready: true, active: false } };
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  /** Shift internal timers when resuming from auto-pause. */
  onTimeShift(deltaMs: number): void {
    try { (this.rmb as any)?.onTimeShift?.(deltaMs); } catch {}
  }

  /** Draw overlays after Fog-of-War so telegraph is never hidden. */
  renderPostFog(ctx: CanvasRenderingContext2D, player: any): void {
    try {
      if (!this.rmb) return;
      const g: any = (player as any).gameContext || (window as any).__gameInstance;
      if (!g) return;
      const camX = (g as any).camX ?? 0;
      const camY = (g as any).camY ?? 0;
      const cw = (g as any).designWidth ?? (ctx.canvas?.width || 1920);
      const ch = (g as any).designHeight ?? (ctx.canvas?.height || 1080);
      this.rmb.drawOverlay(ctx as any, camX, camY, (g as any).renderScale ?? 1, cw, ch);
    } catch { /* ignore */ }
  }
}
