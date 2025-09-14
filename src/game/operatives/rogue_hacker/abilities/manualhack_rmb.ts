import { HackingSystem, type HackState } from '../../../HackingSystem';
import { WeaponType } from '../../../WeaponType';

/**
 * Rogue Hacker RMB: Manual Hack controller (per-operative).
 *
 * Behavior:
 * - On RMB press, we start charging and CAPTURE the initial cursor world position as an anchor.
 * - The telegraph ring stays FIXED at that anchor while charging (does not follow the cursor).
 * - On release (or full charge), the control zone spawns exactly at the anchored position.
 * - Anchor is cleared when the cast is committed or the charge is cancelled.
 */
export class RogueHackerHackRMB {
  private game: any;
  private hacking: HackingSystem;
  private enabled = false;
  private prevState: HackState = 'IDLE';
  private lastCastAt: number = 0;
  private cooldownMs: number;
  /** Anchor world position captured at charge start; telegraph remains fixed here. */
  private anchorX: number | null = null;
  private anchorY: number | null = null;

  constructor(game: any, opts: { radius?: number; minChargeMs?: number; fullChargeMs?: number; cooldownMs?: number } = {}) {
    this.game = game;
    // 30s cooldown per latest balance request
    this.cooldownMs = opts.cooldownMs ?? 30000;
    // Requires FULL cast: minChargeMs equals fullChargeMs by default
    this.hacking = new HackingSystem({
      // Smaller manual-hack zone per request
      radius: Math.max(40, opts.radius ?? 120),
      // 2s cast/telegraph fill to 360°
      fullChargeMs: opts.fullChargeMs ?? 2000,
      // To enforce full cast: minChargeMs defaults to fullChargeMs
      minChargeMs: opts.minChargeMs ?? (opts.fullChargeMs ?? 2000),
      cooldownMs: this.cooldownMs,
    });
  }

  /** True while RMB is charging (casting). */
  isCharging(): boolean { const v = this.hacking.getVisual(); return (v?.state === 'CHARGING'); }

  setEnabled(v: boolean) { this.enabled = !!v; this.hacking.setEnabled(this.enabled); }

  /** Cancel any in-progress charge (e.g., when input becomes locked). */
  cancel(): void {
    // Toggle enabled to reset internal state cleanly
    const was = this.enabled;
    this.hacking.setEnabled(false);
    if (was) this.hacking.setEnabled(true);
    this.prevState = 'IDLE';
    // Clear any pending telegraph anchor
    this.anchorX = this.anchorY = null;
  }

  /**
   * Update per-frame and manage hack state transitions.
   * - Captures telegraph anchor on transition into CHARGING.
   * - Spawns zone at the anchor on transition to COOLDOWN (cast committed).
   */
  update(nowMs: number, deltaMs: number, rDown: boolean, worldX: number, worldY: number) {
    if (!this.enabled) return;
    const enemies = this.game.enemyManager?.getEnemies ? this.game.enemyManager.getEnemies() : this.game.enemyManager?.enemies;
    // Live radius scaling by Hacker Virus level (L1 smaller zone); evolved uses Backdoor level
    try {
      const p: any = this.game.player;
      const aw: Map<number, number> | undefined = p?.activeWeapons;
      const evolved = !!(aw && aw.has(WeaponType.HACKER_BACKDOOR));
      const lvl = aw ? (aw.get(evolved ? WeaponType.HACKER_BACKDOOR : WeaponType.HACKER_VIRUS) || 1) : 1;
      // Base 120 at L7; scale down at low levels. Map: L1 80, L2 92, L3 104, L4 116, L5 128, L6 140, L7 152 (then apply Area mul below)
      const baseTable = [0, 80, 92, 104, 116, 128, 140, 152];
      const baseR = Math.max(60, baseTable[Math.max(1, Math.min(7, lvl))] || 120);
      const areaMul = p?.getGlobalAreaMultiplier?.() ?? (p?.globalAreaMultiplier ?? 1);
      const effR = Math.max(60, Math.min(360, Math.round(baseR * (areaMul || 1))));
      this.hacking.setRadius(effR);
    } catch { /* ignore scaling errors */ }
    this.hacking.update(nowMs, deltaMs, enemies || [], worldX, worldY, rDown);

    // Detect state changes
    const v = this.hacking.getVisual();
    const curr = v?.state ?? 'IDLE';
    // Capture anchor on charge start (first frame entering CHARGING)
    if (this.prevState !== 'CHARGING' && curr === 'CHARGING' && this.anchorX == null && this.anchorY == null) {
      let ax = worldX, ay = worldY;
      try {
        const rm: any = this.game.roomManager;
        if (rm && typeof rm.clampToWalkable === 'function') { const c = rm.clampToWalkable(ax, ay, 14, 'player'); ax = c.x; ay = c.y; }
      } catch {}
      this.anchorX = ax; this.anchorY = ay;
    }
    // Detect successful activation edge: CHARGING -> COOLDOWN on release
    if (this.prevState === 'CHARGING' && curr === 'COOLDOWN') {
      // Spawn effect at clamped position
      const rm: any = this.game.roomManager;
      // Prefer anchored telegraph position; fallback to current cursor if missing
      let tx = (this.anchorX ?? worldX), ty = (this.anchorY ?? worldY);
      try { if (rm && typeof rm.clampToWalkable === 'function') { const c = rm.clampToWalkable(tx, ty, 14, 'player'); tx = c.x; ty = c.y; } } catch {}
      const radius = Math.max(60, Math.min(420, (v?.radius ?? 120)));
      const lifeMs = 2000;
      // Convert enemies inside to allies for 10 seconds
      const convertMs = 10000;
      try { window.dispatchEvent(new CustomEvent('spawnHackerZone', { detail: { x: tx, y: ty, radius, lifeMs, convertMs } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 60, intensity: 1.1 } })); } catch {}
      this.lastCastAt = nowMs;
      // Clear anchor after cast is committed
      this.anchorX = this.anchorY = null;
    }
    // If charge was cancelled back to IDLE, clear anchor as well
    if (this.prevState === 'CHARGING' && curr === 'IDLE') {
      this.anchorX = this.anchorY = null;
    }
    this.prevState = curr;
  }

  /** Draw the fixed telegraph at the anchored position while CHARGING. */
  drawOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number, _renderScale: number, canvasW: number, canvasH: number) {
    if (!this.enabled) return;
    const v = this.hacking.getVisual();
    // Only draw telegraph while actively charging
    if (!v || v.state !== 'CHARGING') return;
    // Draw at anchored position captured on charge start
    if (this.anchorX == null || this.anchorY == null) return;
    const sx = this.anchorX - camX; const sy = this.anchorY - camY;
    if (sx < -20 || sy < -20 || sx > canvasW + 20 || sy > canvasH + 20) return;
    ctx.save();
    try {
      // Base ring
      ctx.lineWidth = 2; const base = '#FFAA33'; ctx.strokeStyle = base; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(sx, sy, v.radius, 0, Math.PI * 2); ctx.stroke();
      // Premium radial fill telegraph (0..360° over fullChargeMs)
      const frac = Math.max(0, Math.min(1, v.chargeFrac));
      const ang = frac * Math.PI * 2;
      // Outer glow sweep
      ctx.save();
      ctx.shadowColor = '#ffcc88';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#FFD580';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, v.radius + 4, -Math.PI/2, -Math.PI/2 + ang);
      ctx.stroke();
      ctx.restore();
      // Soft filled wedge inside ring (low alpha for performance)
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.18 * frac;
      ctx.fillStyle = '#FFAA33';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, v.radius - 3, -Math.PI/2, -Math.PI/2 + ang, false);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (v.target) { const tx = (v.target as any).x - camX; const ty = (v.target as any).y - camY; ctx.strokeStyle = '#FF5533'; ctx.lineWidth = 3; const r = (v.target as any).radius || 18; ctx.beginPath(); ctx.arc(tx, ty, r + 6, 0, Math.PI * 2); ctx.stroke(); }
    } catch {}
    ctx.restore();
  }

  /** HUD meter for RMB cooldown */
  getMeter(nowMs: number) {
    // Show cooldown fill; during charging we present an active state for HUD styling
    const last = this.lastCastAt || 0;
    const elapsed = nowMs - last;
    const ready = last === 0 || elapsed >= this.cooldownMs;
    const value = ready ? this.cooldownMs : Math.max(0, Math.min(this.cooldownMs, elapsed));
    const vis = this.hacking.getVisual();
    const active = vis?.state === 'CHARGING';
    return { value, max: this.cooldownMs, ready, active };
  }

  /** Shift absolute timestamps when resuming from auto-pause */
  onTimeShift(deltaMs: number) { if (this.lastCastAt) this.lastCastAt += deltaMs; }
}