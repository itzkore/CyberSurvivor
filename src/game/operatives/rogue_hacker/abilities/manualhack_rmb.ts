import { HackingSystem } from '../../HackingSystem';

/** Rogue Hacker RMB: Manual Hack controller (per-operative). */
export class RogueHackerHackRMB {
  private game: any;
  private hacking: HackingSystem;
  private enabled = false;

  constructor(game: any, opts: { radius?: number; minChargeMs?: number; fullChargeMs?: number; cooldownMs?: number } = {}) {
    this.game = game;
    this.hacking = new HackingSystem({
      radius: Math.max(40, opts.radius ?? 200),
      minChargeMs: opts.minChargeMs ?? 260,
      fullChargeMs: opts.fullChargeMs ?? 1000,
      cooldownMs: opts.cooldownMs ?? 4000,
    });
  }

  setEnabled(v: boolean) { this.enabled = !!v; this.hacking.setEnabled(this.enabled); }

  update(nowMs: number, deltaMs: number, rDown: boolean, worldX: number, worldY: number) {
    if (!this.enabled) return;
    const enemies = this.game.enemyManager?.getEnemies ? this.game.enemyManager.getEnemies() : this.game.enemyManager?.enemies;
    this.hacking.update(nowMs, deltaMs, enemies || [], worldX, worldY, rDown);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number, _renderScale: number, canvasW: number, canvasH: number) {
    if (!this.enabled) return;
    const v = this.hacking.getVisual(); if (!v || v.state === 'COOLDOWN') return;
    const rawMx = (window as any).__mouseX ?? 0; const rawMy = (window as any).__mouseY ?? 0;
    const worldX = rawMx + camX; const worldY = rawMy + camY; const sx = worldX - camX; const sy = worldY - camY;
    if (sx < -20 || sy < -20 || sx > canvasW + 20 || sy > canvasH + 20) return;
    ctx.save();
    try {
      ctx.lineWidth = 2; const base = v.state === 'CHARGING' ? '#FFAA33' : '#888'; ctx.strokeStyle = base; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(sx, sy, v.radius, 0, Math.PI * 2); ctx.stroke();
      if (v.state === 'CHARGING') { const a = Math.max(0.05, v.chargeFrac) * Math.PI * 2; ctx.strokeStyle = '#FFD580'; ctx.beginPath(); ctx.arc(sx, sy, v.radius + 4, -Math.PI / 2, -Math.PI / 2 + a); ctx.stroke(); }
      if (v.target) { const tx = (v.target as any).x - camX; const ty = (v.target as any).y - camY; ctx.strokeStyle = '#FF5533'; ctx.lineWidth = 3; const r = (v.target as any).radius || 18; ctx.beginPath(); ctx.arc(tx, ty, r + 6, 0, Math.PI * 2); ctx.stroke(); }
    } catch {}
    ctx.restore();
  }
}