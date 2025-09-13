import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import type { Player } from '../../Player';
import { GhostUltRMB } from './abilities/ghost_ult_rmb';

/**
 * Ghost Operative Ability Manager
 * - RMB: Ultimate Charging Shot — hold 3s, locks movement & normal fire, absorbs particles, then fires a massive unlimited‑range beam
 */
export class GhostOperativeAbilityManager extends BaseAbilityManagerImpl {
  private ult?: GhostUltRMB;
  private gameRef: any;
  private spinAngle: number = 0;

  constructor() { super('ghost_operative'); }

  init(player: any): void {
    super.init(player);
    const g: any = (player as any).gameContext || (window as any).__gameInstance;
    this.gameRef = g;
    if (g) {
      this.ult = new GhostUltRMB(g, player as Player);
      const self = this;
      // Expose HUD meter accessor if not already present
      if (!(player as any).getGhostUltMeter) {
        (player as any).getGhostUltMeter = function() {
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          return self.ult ? self.ult.getMeter(now) : { value: 0, max: 30000, ready: true, active: false };
        };
      }
    }
  }

  update(deltaTime: number, _keyState: any, inputLocked: boolean): void {
    const p = this.player as Player & any; if (!p) return;
    const g: any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
    if (!this.ult) this.ult = new GhostUltRMB(g, p);
    const ms: any = (window as any).mouseState;
    const rDown = !!(ms && ms.right);
    const prev = (this as any)._prevR || false; (this as any)._prevR = rDown;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!inputLocked) this.ult!.update(now, deltaTime, rDown, g.camX || 0, g.camY || 0);

    // Update rotation while charging
    if (this.ult?.isCharging()) {
      const prog = this.ult.getChargeProgress(now);
      const speed = 1.8 + 4.2 * prog; // rad/s
      this.spinAngle += speed * (deltaTime / 1000);
      if (this.spinAngle > Math.PI * 2) this.spinAngle -= Math.PI * 2;
    }
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const out: any = {};
    const p: any = this.player;
    if (p && typeof p.getGhostUltMeter === 'function') {
      const m = p.getGhostUltMeter();
      out.ghost_ult = { value: m.value, max: m.max, ready: m.ready, active: !!m.active };
    }
    return out;
  }

  handleKeyPress(_key: string, _keyState: any): boolean { return false; }

  render(ctx: CanvasRenderingContext2D, player: any): void {
    const u = this.ult; if (!u) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Draw fired beam if present
    (u as any).render?.(ctx, player);
    // Draw charging ring if charging
    if (!u.isCharging()) return;
    const prog = u.getChargeProgress(now);
    const g: any = this.gameRef || (player?.gameContext) || (window as any).__gameInstance;
    const lowFX = !!(g && g.lowFX);

    // Ring parameters
    const cx = player.x;
    const cy = player.y;
    const baseR = 30;
    const r = baseR + 6 * prog;
    const alpha = 0.35 + 0.65 * prog;
    const lw = lowFX ? 2 + 2 * prog : 2.5 + 3.5 * prog;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.spinAngle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.globalCompositeOperation = 'lighter';
    // Outer soft ring
    ctx.strokeStyle = `rgba(200,240,255,${0.25 * alpha})`;
    ctx.lineWidth = lw * 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    // Rotating bright arc segment
    const segLen = (lowFX ? 0.9 : 1.2) + 1.6 * prog; // radians
    ctx.strokeStyle = `rgba(210,250,255,${0.75 * alpha})`;
    ctx.shadowColor = `rgba(200,240,255,${0.6 * alpha})`;
    ctx.shadowBlur = lowFX ? 0 : 12 + 10 * prog;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(0, 0, r, -segLen / 2, segLen / 2);
    ctx.stroke();

    if (!lowFX) {
      // Small inner ticks for motion cue
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(180,225,240,${0.35 * alpha})`;
      ctx.lineWidth = 1.5;
      const innerR = r - 5;
      const ticks = 8;
      for (let i = 0; i < ticks; i++) {
        const a = (i * (Math.PI * 2)) / ticks;
        const ca = Math.cos(a), sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(ca * (innerR - 3), sa * (innerR - 3));
        ctx.lineTo(ca * (innerR + 3), sa * (innerR + 3));
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
