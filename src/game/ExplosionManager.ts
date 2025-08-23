import { ParticleManager } from './ParticleManager';
import { EnemyManager } from './EnemyManager';
import { AoEZone } from './AoEZone';
import { Player } from './Player'; // Import Player type
import { BulletManager } from './BulletManager';

export class ExplosionManager {
  private particleManager: ParticleManager;
  private enemyManager: EnemyManager;
  private onShake?: (duration: number, intensity: number) => void;
  private player: Player; // Add player reference
  private bulletManager?: BulletManager; // For spawning plasma fragments
  private aoeZones: AoEZone[] = []; // Manage active AoE zones
  // Lightweight shockwave rings (purely visual)
  private shockwaves: { x: number; y: number; startR: number; endR: number; life: number; maxLife: number; color: string; alphaScale?: number }[] = [];
  // Transient charge glows (visual-only, e.g., Railgun charge-up)
  private chargeGlows: { x: number; y: number; radius: number; color: string; start: number; duration: number }[] = [];
  // Scheduled ion field pulses (plasma overcharged path)
  private ionFieldSchedules: { x: number; y: number; radius: number; damage: number; interval: number; next: number; remaining: number; color: string }[] = [];

  constructor(particleManager: ParticleManager, enemyManager: EnemyManager, player: Player, bulletManager?: BulletManager, onShake?: (duration: number, intensity: number) => void) {
    this.particleManager = particleManager;
    this.enemyManager = enemyManager;
    this.onShake = onShake;
    this.player = player; // Store player reference
    this.bulletManager = bulletManager;
  }

  public triggerExplosion(x: number, y: number, damage: number, hitEnemy?: any, radius: number = 100, color: string = '#FFA07A') {
    // Rebalanced enemy death explosion: slightly larger area, full damage, lower visual intensity (no lingering zone).
    const scaledRadius = Math.max(30, radius * 0.55); // mild area increase
    const scaledDamage = damage; // full damage
    // Immediate single tick damage only (no persistent AoE)
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      const r2 = scaledRadius * scaledRadius;
      for (let i=0;i<enemies.length;i++) {
        const enemy = enemies[i];
        if (!enemy.active || enemy.hp <= 0) continue;
        const dx = enemy.x - x; const dy = enemy.y - y;
        if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(enemy, scaledDamage);
      }
    }
    // Single faint ring (alpha scaled down)
    this.shockwaves.push({
      x,
      y,
      startR: Math.max(4, scaledRadius * 0.55),
      endR: scaledRadius * 1.15,
      life: 160,
      maxLife: 160,
      color,
      alphaScale: 0.22
    });
  }

  /**
   * Titan Mech dedicated mortar explosion (stronger + larger; independent from generic toned-down explosion).
   * Full damage, larger radius, brief lingering burn for extra ticks.
   */
  public triggerTitanMortarExplosion(x: number, y: number, damage: number, radius: number = 220, color: string = '#FFD700') {
    // Immediate full-damage AoE inside radius
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      const r2 = radius * radius;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
        const dx = e.x - x; const dy = e.y - y;
        if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(e, damage);
      }
    }
    // Add a short-lived high-damage AoE zone (25% over 0.6s) with transparent fill
    const burnDamage = damage * 0.25;
    this.aoeZones.push(new AoEZone(x, y, radius * 0.55, burnDamage, 600, 'rgba(0,0,0,0)', this.enemyManager, this.player));

    // Multi-phase shockwaves (primary + thermal + dust)
    this.shockwaves.push({ x, y, startR: Math.max(18, radius * 0.30), endR: radius * 1.1, life: 300, maxLife: 300, color });
    this.shockwaves.push({ x, y, startR: Math.max(10, radius * 0.15), endR: radius * 0.8, life: 240, maxLife: 240, color: '#FFF5C0' });
    this.shockwaves.push({ x, y, startR: Math.max(6, radius * 0.10), endR: radius * 1.25, life: 420, maxLife: 420, color: '#D2B48C' }); // dust ring

    // Particle bursts
    this.particleManager.spawn(x, y, 36, '#FFE066', { sizeMin: 5, sizeMax: 10, lifeMs: 260, speedMin: 1, speedMax: 3 });
    this.particleManager.spawn(x, y, 44, '#FFB347', { sizeMin: 3, sizeMax: 7, lifeMs: 540, speedMin: 1.5, speedMax: 4 });
    this.particleManager.spawn(x, y, 18, '#FFFFFF', { sizeMin: 2, sizeMax: 5, lifeMs: 180, speedMin: 0.8, speedMax: 2 });
    this.particleManager.spawn(x, y, 28, '#C0C0C0', { sizeMin: 2, sizeMax: 3, lifeMs: 900, speedMin: 3, speedMax: 7 });
    this.particleManager.spawn(x, y, 26, '#4A4A4A', { sizeMin: 6, sizeMax: 14, lifeMs: 1100, speedMin: 0.6, speedMax: 1.8 });
    this.particleManager.spawn(x, y, 42, '#FFDD99', { sizeMin: 1, sizeMax: 3, lifeMs: 1400, speedMin: 1, speedMax: 2.2 });
    this.particleManager.spawn(x, y, 20, '#FFFFE0', { sizeMin: 1, sizeMax: 2, lifeMs: 160, speedMin: 0.4, speedMax: 1.2 });
    if (this.onShake) this.onShake(160, 6);
  }

  /**
   * Quick implosion precursor: inward pulling ring then fades (purely visual).
   * alphaScale optionally lowers intensity for subtle effects.
   * lifeMs optionally controls duration (default 120ms to keep pre-explosion snappy).
   */
  public triggerMortarImplosion(
    x: number,
    y: number,
    radius: number,
    color: string = '#FFE66D',
    alphaScale?: number,
    lifeMs?: number
  ) {
    // Represent implosion by adding a reversed shockwave (start larger, shrink)
    const life = Math.max(60, Math.min(lifeMs ?? 120, 800));
    this.shockwaves.push({ x, y, startR: radius, endR: Math.max(4, radius * 0.3), life, maxLife: life, color, alphaScale });
    if (this.onShake) this.onShake(Math.min(90, life * 0.5), 2);
  }

  /**
   * Dedicated Kamikaze Drone explosion: (1) triple previous area (≈ sqrt(3) radius multiplier),
   * (2) double base damage, (3) richer cyan/white energy + debris visuals (no yellow),
   * (4) light lingering ion burn zone for a few extra ticks.
   * Incoming radius refers to legacy dispatch radius (pre-toned); we upscale internally.
   */
  public triggerDroneExplosion(x: number, y: number, damage: number, radius: number = 110, color: string = '#00BFFF') {
    // Scale radius to achieve ~300% area (area ∝ r^2) => r' = r * sqrt(3)
    const R_SCALE = Math.sqrt(3); // ≈1.732
    const finalRadius = Math.max(60, radius * R_SCALE);
    const finalDamage = damage * 2; // requested damage doubling

    // Immediate damage application inside full radius
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      const r2 = finalRadius * finalRadius;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
        const dx = e.x - x, dy = e.y - y;
        if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(e, finalDamage);
      }
    }
    // Light lingering ionized zone (15% of finalDamage over 0.5s) – transparent for no filled disk
    const residualDmg = finalDamage * 0.15;
    this.aoeZones.push(new AoEZone(x, y, finalRadius * 0.55, residualDmg, 500, 'rgba(0,0,0,0)', this.enemyManager, this.player));

    // Shockwave rings: core flash, main wave, dissipating halo
    this.shockwaves.push({ x, y, startR: Math.max(10, finalRadius * 0.25), endR: finalRadius * 1.05, life: 240, maxLife: 240, color });
    this.shockwaves.push({ x, y, startR: Math.max(6, finalRadius * 0.10), endR: finalRadius * 0.70, life: 200, maxLife: 200, color: '#E0FFFF' }); // pale inner core
    this.shockwaves.push({ x, y, startR: Math.max(14, finalRadius * 0.40), endR: finalRadius * 1.30, life: 360, maxLife: 360, color: '#00E0FF' }); // outer halo

    // Particle effects (cyan energy + sparks + smoke wisps)
    this.particleManager.spawn(x, y, 26, '#CFFFFF', { sizeMin: 3, sizeMax: 7, lifeMs: 260, speedMin: 1, speedMax: 3.2 }); // core flash shards
    this.particleManager.spawn(x, y, 34, '#00D5FF', { sizeMin: 2, sizeMax: 5, lifeMs: 520, speedMin: 1.5, speedMax: 4.5 }); // energy sparks
    this.particleManager.spawn(x, y, 18, '#FFFFFF', { sizeMin: 1, sizeMax: 3, lifeMs: 180, speedMin: 0.8, speedMax: 2 }); // hot flickers
    this.particleManager.spawn(x, y, 20, '#0F2A38', { sizeMin: 6, sizeMax: 12, lifeMs: 900, speedMin: 0.4, speedMax: 1.6 }); // dark smoke puffs
    this.particleManager.spawn(x, y, 22, '#66F2FF', { sizeMin: 1, sizeMax: 2, lifeMs: 650, speedMin: 0.9, speedMax: 2.2 }); // lingering ions

    if (this.onShake) this.onShake(110, 4); // modest shake (less than mortar)
  }

  /**
   * Shockwave-only instant explosion (no lingering filled AoE zone). Applies damage immediately and spawns wave rings.
   */
  public triggerShockwave(x: number, y: number, damage: number, radius: number = 100, color: string = '#FFA07A') {
    // Apply global area multiplier to radius
    const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
    const finalRadius = radius * (areaMul || 1);
    // Immediate damage application (single tick)
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      for (let i=0;i<enemies.length;i++) {
        const e = enemies[i];
        const dx = e.x - x; const dy = e.y - y;
        if (dx*dx + dy*dy <= finalRadius*finalRadius) this.enemyManager.takeDamage(e, damage);
      }
    }
    // Shockwave visuals (reuse logic path by manually pushing similar rings)
    this.shockwaves.push({ x, y, startR: Math.max(6, finalRadius*0.25), endR: finalRadius*1.1, life: 200, maxLife: 200, color });
  // Removed second ring and screen shake
  }

  public update(deltaMs: number = 16.6667): void {
    // Update all active AoE zones
    for (let i = 0; i < this.aoeZones.length; i++) {
      const zone = this.aoeZones[i];
      if (zone.active) {
  zone.update(deltaMs);
      }
    }
    // Filter out inactive zones
    this.aoeZones = this.aoeZones.filter(zone => zone.active);

    // Ion field pulse scheduling: spawn transparent AoE zones every interval
    if (this.ionFieldSchedules.length) {
      const now = performance.now();
      for (let i = 0; i < this.ionFieldSchedules.length; i++) {
        const s = this.ionFieldSchedules[i];
        if (now >= s.next && s.remaining > 0) {
          s.remaining--;
          s.next = now + s.interval;
          // Transparent zone (damage only); minor shockwave for feedback
          this.aoeZones.push(new AoEZone(s.x, s.y, s.radius, s.damage, 10, 'rgba(0,0,0,0)', this.enemyManager, this.player));
          this.shockwaves.push({ x: s.x, y: s.y, startR: s.radius * 0.4, endR: s.radius * 1.05, life: 140, maxLife: 140, color: s.color, alphaScale: 0.15 });
          // Light particle flicker
          this.particleManager.spawn(s.x, s.y, 6, '#9FFFFF', { sizeMin: 2, sizeMax: 4, lifeMs: 240, speedMin: 0.4, speedMax: 1.2 });
        }
      }
      this.ionFieldSchedules = this.ionFieldSchedules.filter(s => s.remaining > 0);
    }

    // Update shockwaves
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      sw.life -= deltaMs;
    }
    this.shockwaves = this.shockwaves.filter(sw => sw.life > 0);

    // Prune expired charge glows
    if (this.chargeGlows.length) {
      const now = performance.now();
      this.chargeGlows = this.chargeGlows.filter(g => now - g.start < g.duration);
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    // Draw all active AoE zones
    for (let i = 0; i < this.aoeZones.length; i++) {
      const zone = this.aoeZones[i];
      if (zone.active) {
        zone.draw(ctx);
      }
    }

    // Draw charge glows before shockwaves (so completion shockwave sits atop)
    if (this.chargeGlows.length) {
      const now = performance.now();
      for (let i = 0; i < this.chargeGlows.length; i++) {
        const g = this.chargeGlows[i];
        const t = Math.max(0, Math.min(1, (now - g.start) / g.duration));
        const ease = t * (0.6 + 0.4 * t); // ramps in, slightly faster at end
        const alpha = 0.05 + 0.25 * ease; // 0.05 → 0.30
        const r = g.radius * (0.9 + 0.1 * ease);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        const grad = ctx.createRadialGradient(g.x, g.y, Math.max(0, r * 0.25), g.x, g.y, r);
        grad.addColorStop(0, `${g.color}80`);
        grad.addColorStop(0.7, `${g.color}25`);
        grad.addColorStop(1, `${g.color}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
        ctx.fill();
        // Thin rim hint
        ctx.globalAlpha = alpha * 0.7;
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * ease})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw shockwaves after zones and glows (so rings appear atop)
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      const t = 1 - sw.life / sw.maxLife; // 0..1 progress
  const radius = sw.startR + (sw.endR - sw.startR) * t;
  const alphaBase = (1 - t) * 0.35;
  const alpha = alphaBase * (sw.alphaScale != null ? sw.alphaScale : 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, 3 * (1 - t));
  ctx.beginPath();
  ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
  // Dual stroke: inner color glow + crisp white rim
  ctx.shadowColor = sw.color;
  ctx.shadowBlur = 10 * (1 - t * 0.7);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = sw.color;
  ctx.stroke();
  // Crisp rim
  ctx.shadowBlur = 0;
  ctx.globalAlpha = Math.min(1, alpha * 1.1);
  ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
  ctx.lineWidth = Math.max(1, 1.5 * (1 - t));
  ctx.stroke();
      ctx.restore();
    }
  }

  /** Visual-only: starts a soft radial glow used for weapon charging UX (e.g., Railgun). */
  public triggerChargeGlow(x: number, y: number, radius: number = 30, color: string = '#00FFE6', durationMs: number = 1000) {
    const start = performance.now();
    this.chargeGlows.push({ x, y, radius: Math.max(8, radius), color, start, duration: Math.max(120, durationMs) });
  }

  /** Plasma normal detonation: immediate AoE (no fragments) with clear impact visuals */
  public triggerPlasmaDetonation(x: number, y: number, damage: number, fragments: number = 0, radius: number = 120, color: string = '#66CCFF') {
    // Apply global area multiplier to radius
    const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
    const finalRadius = radius * (areaMul || 1);
    // Immediate AoE damage (single tick) scaled
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      const r2 = finalRadius * finalRadius;
      for (let i=0;i<enemies.length;i++) {
        const e = enemies[i]; if (!e.active || e.hp <= 0) continue;
        const dx = e.x - x; const dy = e.y - y; if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(e, damage);
      }
    }
  // Brief filled AoE ring for clear hit location
    // Residual after-damage area reduced to avoid oversized zones
    this.aoeZones.push(new AoEZone(x, y, finalRadius * 0.35, Math.round(damage * 0.15), 120, 'rgba(140,200,255,0.18)', this.enemyManager, this.player));
  // Visual shockwaves in blue‑white plasma palette
    this.shockwaves.push({ x, y, startR: Math.max(8, finalRadius * 0.33), endR: finalRadius * 1.05, life: 240, maxLife: 240, color: '#A8E6FF', alphaScale: 0.6 });
  this.shockwaves.push({ x, y, startR: Math.max(4, radius * 0.18), endR: radius * 0.66, life: 190, maxLife: 190, color: '#E6FBFF', alphaScale: 0.4 });
  this.particleManager.spawn(x, y, 20, '#E6FBFF', { sizeMin: 3, sizeMax: 6, lifeMs: 420, speedMin: 1, speedMax: 2.8 });
  this.particleManager.spawn(x, y, 12, '#66CCFF', { sizeMin: 2, sizeMax: 4, lifeMs: 300, speedMin: 0.6, speedMax: 1.8 });
    if (this.onShake) this.onShake(90, 3);
  // No fragment bullets for plasma detonation anymore
  }

  /** Plasma overcharged ion field: schedule multiple invisible damage pulses */
  public triggerPlasmaIonField(x: number, y: number, damage: number, radius: number = 120, color: string = '#55C8FF') {
    // Single initial flash (no direct damage here; pulses handle damage)
    this.shockwaves.push({ x, y, startR: radius*0.25, endR: radius*1.15, life: 300, maxLife: 300, color, alphaScale: 0.5 });
    this.particleManager.spawn(x, y, 30, '#9FFFFF', { sizeMin: 3, sizeMax: 6, lifeMs: 500, speedMin: 0.5, speedMax: 2 });
    if (this.onShake) this.onShake(120, 3.5);
    // Schedule pulses (5 ticks)
    const pulses = 5;
    const interval = 120; // ms
    const perPulseDmg = Math.round(damage * 0.12); // fraction per pulse
    this.ionFieldSchedules.push({ x, y, radius, damage: perPulseDmg, interval, next: performance.now(), remaining: pulses, color });
  }
}

// Fallback enum ref if global not available during build-time (avoid circular import)
enum WeaponTypeFallback { PLASMA = 0 }
