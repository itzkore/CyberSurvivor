// Modular Ghost Protocol ability for Rogue Hacker
// Inspired by Vladimir's Sanguine Pool: brief intangibility, limited movement, aura damage + debuff.

import type { Enemy } from '../EnemyManager';
import type { Player } from '../Player';
import { WeaponType } from '../WeaponType';

export interface GhostProtocolOptions {
  durationMs: number;       // active window
  cooldownMs: number;       // cooldown after end
  auraRadius: number;       // damaging aura radius
  dps: number;              // damage per second dealt as ticks
  tickMs: number;           // tick cadence in ms
  slowPct: number;          // movement slow applied to enemies (0..1 fraction reduction)
  glitchMs: number;         // additional debuff window
  moveSpeedMul: number;     // movement multiplier while phased
}

/**
 * Ghost Protocol: temporary intangibility + damaging aura.
 * - Grants invulnerability and untargetability to the player while active.
 * - Allows limited movement with a speed multiplier.
 * - Damages and debuffs enemies in a circular pool centered on the player.
 */
export class GhostProtocolAbility {
  private player: Player;
  private opts: GhostProtocolOptions;
  private active = false;
  private start = 0;
  private nextTick = 0;
  private end = 0;
  private prevSpeed = 0;
  // Evolved palette flag (read from player weapons; cached per-frame in draw)
  private evolvedPalette = false;
  // Predefined hacking command snippets used to render the text-based aura rings
  private cmdSnippets: string[] = [
    'nmap -A 10.0.0.0/24',
    'ssh root@core --force',
    'curl -s https://ai/core | sh',
    'iptables -F',
    'kill -9 $(pgrep sentry)',
    'nc -lvnp 31337',
    'wget -qO- /api/override',
    'grep -R "token" /etc',
    'systemctl stop guardian',
    'tail -f /var/log/core.log'
  ];

  constructor(player: Player, opts: GhostProtocolOptions) {
    this.player = player;
    this.opts = opts;
  }

  get isActive() { return this.active; }
  get timeLeftMs() { return Math.max(0, this.end - performance.now()); }
  /** Expose configured duration/cooldown for HUD meters */
  get durationMs() { return this.opts.durationMs; }
  get cooldownMs() { return this.opts.cooldownMs; }
  /** Returns the absolute timestamp (performance.now) when cooldown ends, or 0 if ready */
  get cooldownReadyAt() { return (this as any)._ghostProtocolCdUntil || 0; }

  /** Update key scalar knobs (safe while active): DPS, radius, move multiplier. */
  updateScaling(partial: Partial<Pick<GhostProtocolOptions, 'dps'|'auraRadius'|'moveSpeedMul'|'tickMs'>> & { evolved?: boolean }) {
    if (partial.dps != null && partial.dps > 0) this.opts.dps = partial.dps;
    if (partial.auraRadius != null && partial.auraRadius > 0) this.opts.auraRadius = partial.auraRadius;
    if (partial.moveSpeedMul != null && partial.moveSpeedMul > 0) this.opts.moveSpeedMul = partial.moveSpeedMul;
    if (partial.tickMs != null && partial.tickMs >= 30) this.opts.tickMs = partial.tickMs;
    if (typeof partial.evolved === 'boolean') this.evolvedPalette = partial.evolved;
  }

  tryActivate(): boolean {
    if (this.active) return false;
    const now = performance.now();
    const cdLeft = (this as any)._ghostProtocolCdUntil || 0;
    if (cdLeft > now) return false;

    // Activate
    this.active = true;
    this.start = now;
    this.end = now + this.opts.durationMs;
    this.nextTick = now;
    // Grant i-frames/untargetable
    (this.player as any).invulnerableUntilMs = Math.max((this.player as any).invulnerableUntilMs || 0, this.end);
    (this.player as any)._ghostProtocolActive = true;
  (this.player as any)._ghostProtocolPrevSpeed = this.player.speed;
  this.prevSpeed = this.player.speed || 2.2;
  // Apply full slow immediately; then ease back to full over duration in update()
  const mul = (this.opts.moveSpeedMul || 0.6);
  this.player.speed = this.prevSpeed * mul;

    // Visual hook for start
    try { window.dispatchEvent(new CustomEvent('ghostProtocolStart', { detail: { durationMs: this.opts.durationMs } })); } catch {}
    return true;
  }

  update(deltaMs: number) {
    if (!this.active) return;
    const now = performance.now();
  // Ease movement speed from slowed to normal across the duration
  const span = Math.max(1, this.end - this.start);
  const t = Math.max(0, Math.min(1, (now - this.start) / span));
  const mul = (this.opts.moveSpeedMul || 0.6);
  // Linear release: speed = prev * lerp(mul, 1, t)
  this.player.speed = this.prevSpeed * (mul + (1 - mul) * t);
    // Ticking aura damage + debuff
    if (now >= this.nextTick) {
      this.nextTick = now + this.opts.tickMs;
      const enemyMgr: any = (this.player as any).gameContext?.enemyManager;
      const areaMul = (this.player as any).getGlobalAreaMultiplier?.() ?? ((this.player as any).globalAreaMultiplier ?? 1);
      const r = (this.opts.auraRadius || 200) * (areaMul || 1);
      const enemies: Enemy[] = (enemyMgr && typeof enemyMgr.queryEnemies === 'function')
        ? enemyMgr.queryEnemies(this.player.x, this.player.y, r + 16)
        : (enemyMgr?.getEnemies?.() || []);
      const dmg = Math.max(1, Math.round(this.opts.dps * (this.opts.tickMs / 1000)));
      const r2 = r * r;
      for (let i = 0; i < enemies.length; i++) {
        const e: any = enemies[i]; if (!e || !e.active || e.hp <= 0) continue;
        const dx = e.x - this.player.x, dy = e.y - this.player.y; if (dx*dx + dy*dy > r2) continue;
        // Damage via EM, mark as HACKER_VIRUS for KB suppression style
        enemyMgr?.takeDamage?.(e, dmg, false, false, WeaponType.HACKER_VIRUS, this.player.x, this.player.y);
        // Debuff: slow + glitch timer
        const now2 = now;
        e._glitchUntil = Math.max(e._glitchUntil || 0, now2 + this.opts.glitchMs);
        e._hackerSlowPct = Math.max(e._hackerSlowPct || 0, Math.min(0.95, this.opts.slowPct));
        e._hackerSlowUntil = now2 + this.opts.tickMs + 80;
      }
    }

    // Expire
    if (now >= this.end) {
      this.active = false;
      // Restore speed and clear flag
  const prev = (this.player as any)._ghostProtocolPrevSpeed;
      if (prev) this.player.speed = prev;
      (this.player as any)._ghostProtocolActive = false;
      // Start cooldown
      const cdUntil = now + this.opts.cooldownMs;
      (this as any)._ghostProtocolCdUntil = cdUntil;
      try { window.dispatchEvent(new CustomEvent('ghostProtocolEnd', {})); } catch {}
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    if (!this.active) return;
    const game: any = (this.player as any).gameContext; if (!game) return;
    const now = performance.now();
    const t = Math.max(0, Math.min(1, (now - this.start) / Math.max(1, (this.end - this.start))));
    const px = this.player.x, py = this.player.y;
    const areaMul = (this.player as any).getGlobalAreaMultiplier?.() ?? ((this.player as any).globalAreaMultiplier ?? 1);
    const rBase = (this.opts.auraRadius || 200) * (areaMul || 1);

    const lowFX = !!(game.lowFX || (window as any).__lowFX);
    // Detect evolved ownership once per frame (cheap) if not explicitly set
    try {
      const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
      if (aw) this.evolvedPalette = aw.has(WeaponType.HACKER_BACKDOOR);
    } catch { /* ignore */ }
  const coreColor = this.evolvedPalette ? 'rgba(160, 10, 26, 0.80)' : 'rgba(120, 60, 0, 0.80)';

    ctx.save();
    ctx.globalCompositeOperation = lowFX ? 'source-over' : 'screen';
    // Core pixelated disk
  ctx.globalAlpha = 0.36;
  const grad = ctx.createRadialGradient(px, py, 6, px, py, rBase * (0.88 + 0.08 * (1 - t)));
    grad.addColorStop(0, coreColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, rBase, 0, Math.PI * 2); ctx.fill();

    // Text-based AOE rings: render hacking commands around concentric circles
  const ringCount = lowFX ? 1 : 2;
    // Precompute parameters to reduce per-iteration work
    const outerR = Math.max(32, rBase * 0.92);
    const innerR = Math.max(26, rBase * (lowFX ? 0.68 : 0.74));
    const radii = ringCount === 1 ? [outerR] : [outerR, innerR];
    const fontSizes = ringCount === 1 ? [11] : [11, 10];
    const speeds = ringCount === 1 ? [0.18] : [0.24, -0.18]; // rad/s, opposite directions for parallax
  const alphas = ringCount === 1 ? [0.9] : [0.92, 0.64];
    const maxGlyphs = ringCount === 1 ? [88] : [100, 84];
    // Draw rings
    for (let ri = 0; ri < radii.length; ri++) {
      const rr = radii[ri];
      const fontPx = fontSizes[ri];
      const alpha = alphas[ri];
      const maxG = maxGlyphs[ri];
      const circ = 2 * Math.PI * rr;
      // Approximate glyph width for monospace font
      const glyphW = fontPx * 0.62;
      let count = Math.max(28, Math.min(maxG, Math.floor(circ / Math.max(6, glyphW + 4))));
      const step = (2 * Math.PI) / count;
      const rot = (now * speeds[ri]) + (ri * 0.6) + (t * Math.PI * 0.5);
      // Pick a stable snippet based on time and ring index
      const cmdIndex = Math.abs(((Math.floor(now / 900) + ri * 3) % this.cmdSnippets.length));
      const cmd = this.cmdSnippets[cmdIndex];
      // Setup draw state once per ring
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rot);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `bold ${fontPx}px Orbitron, monospace`;
  // Orange base vs dark neon red when evolved
  const fill = this.evolvedPalette ? `rgba(255,64,64,${alpha.toFixed(3)})` : `rgba(255,190,100,${alpha.toFixed(3)})`;
  ctx.fillStyle = fill as any;
  ctx.shadowColor = this.evolvedPalette ? 'rgba(255,32,32,0.5)' : 'rgba(255,150,0,0.45)';
      ctx.shadowBlur = lowFX ? 2 : 5;
      // Draw characters around the ring with minimal allocations
      for (let i = 0; i < count; i++) {
        const ch = cmd.charAt(i % cmd.length);
        // slight per-glyph flicker
        if (!lowFX) {
          const flick = ((i * 37 + ri * 91 + Math.floor(now / 120)) % 7) * 0.012;
          ctx.globalAlpha = Math.max(0.25, Math.min(1, alpha + flick));
        }
        ctx.fillText(ch, 0, -rr);
        ctx.rotate(step);
      }
      ctx.restore();
    }

    ctx.restore();
  }
}
