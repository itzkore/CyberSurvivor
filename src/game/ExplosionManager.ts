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
  // Lightweight shockwave rings (purely visual) with simple pooling
  private shockwaves: { x: number; y: number; startR: number; endR: number; life: number; maxLife: number; color: string; alphaScale?: number }[] = [];
  private shockwavePool: { x: number; y: number; startR: number; endR: number; life: number; maxLife: number; color: string; alphaScale?: number }[] = [];
  // Transient charge glows (visual-only, e.g., Railgun charge-up)
  private chargeGlows: { x: number; y: number; radius: number; color: string; start: number; duration: number }[] = [];
  // Scheduled ion field pulses (plasma overcharged path)
  private ionFieldSchedules: { x: number; y: number; radius: number; damage: number; interval: number; next: number; remaining: number; color: string }[] = [];
  // Soft budget for simultaneous shockwaves; tuned by perf each frame
  private shockwaveBudget = 48;

  constructor(particleManager: ParticleManager, enemyManager: EnemyManager, player: Player, bulletManager?: BulletManager, onShake?: (duration: number, intensity: number) => void) {
    this.particleManager = particleManager;
    this.enemyManager = enemyManager;
    this.onShake = onShake;
    this.player = player; // Store player reference
    this.bulletManager = bulletManager;
  }

  public triggerExplosion(x: number, y: number, damage: number, hitEnemy?: any, radius: number = 100, color: string = '#FFA07A') {
  const avgMs = (window as any).__avgFrameMs || 16;
  const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
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
  if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(enemy, scaledDamage, false, false, undefined, x, y, undefined, true, 'PLAYER');
      }
    }
    // Also damage boss within blast radius
    try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
      if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
        const dxB = (boss.x ?? 0) - x; const dyB = (boss.y ?? 0) - y;
        const rB = (boss.radius || 160);
        if (dxB*dxB + dyB*dyB <= (scaledRadius + rB) * (scaledRadius + rB)) {
          (this.enemyManager as any).takeBossDamage?.(boss, damage, false, undefined, x, y, undefined, true, 'PLAYER');
        }
      }
    } catch { /* ignore boss explosion errors */ }
    // Also damage treasures within blast radius
    try {
      const emAny: any = this.enemyManager as any;
      if (typeof emAny.getTreasures === 'function') {
        const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
        const r2T = scaledRadius * scaledRadius;
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
          try { if ((window as any).__gameInstance?.gameMode === 'LAST_STAND') continue; } catch {}
          const dxT = t.x - x; const dyT = t.y - y;
          if (dxT*dxT + dyT*dyT <= r2T && typeof emAny.damageTreasure === 'function') {
            emAny.damageTreasure(t, scaledDamage);
          }
        }
      }
    } catch { /* ignore treasure explosion errors */ }
    // Single faint ring (alpha scaled down) with pooling
  if (!vfxLow || this.shockwaves.length < Math.min(24, this.shockwaveBudget)) {
      const sw = this.shockwavePool.pop() || { x:0, y:0, startR:0, endR:0, life:0, maxLife:0, color:'#fff' };
      sw.x = x; sw.y = y; sw.startR = Math.max(4, scaledRadius * 0.55);
      sw.endR = scaledRadius * 1.05; // slightly shorter for perf
      const life = vfxLow ? 120 : 160;
      sw.life = life; sw.maxLife = life; sw.color = color; sw.alphaScale = 0.18;
      this.shockwaves.push(sw);
    }
  }

  /**
   * Titan Mech dedicated mortar explosion (stronger + larger; independent from generic toned-down explosion).
   * Full damage, larger radius, brief lingering burn for extra ticks.
   */
  public triggerTitanMortarExplosion(x: number, y: number, damage: number, radius: number = 220, color: string = '#FFD700') {
  const avgMs = (window as any).__avgFrameMs || 16;
  const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
    // Balance: mortar explosions were dealing ~5x intended damage. Apply a corrective scaler here
    // so both Mech Mortar and Siege Howitzer explosions align with per-level targets.
    const DAMAGE_SCALE = 0.20; // reduce to 20% of incoming (≈5x reduction)
    const scaledDamage = Math.max(1, Math.round(damage * DAMAGE_SCALE));
    // Immediate full-damage AoE inside radius
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      const r2 = radius * radius;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
        const dx = e.x - x; const dy = e.y - y;
  if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(e, scaledDamage, false, false, undefined, x, y, undefined, true, 'PLAYER');
      }
    }
    // Also damage boss in the blast
    try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
      if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
        const dxB = (boss.x ?? 0) - x; const dyB = (boss.y ?? 0) - y;
        const rB = (boss.radius || 160);
        if (dxB*dxB + dyB*dyB <= (radius + rB) * (radius + rB)) {
          (this.enemyManager as any).takeBossDamage?.(boss, scaledDamage, false, undefined, x, y, undefined, true, 'PLAYER');
        }
      }
    } catch { /* ignore boss explosion errors */ }
    // Also damage treasures immediately in the blast
    try {
      const emAny: any = this.enemyManager as any;
      if (typeof emAny.getTreasures === 'function') {
        const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
        const r2T = radius * radius;
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
          try { if ((window as any).__gameInstance?.gameMode === 'LAST_STAND') continue; } catch {}
          const dxT = t.x - x; const dyT = t.y - y;
          if (dxT*dxT + dyT*dyT <= r2T && typeof emAny.damageTreasure === 'function') {
            emAny.damageTreasure(t, scaledDamage);
          }
        }
      }
    } catch { /* ignore treasure explosion errors */ }
    // Add a short-lived residual AoE zone (15% of scaled damage over 0.6s) with transparent fill
  const burnDamage = scaledDamage * 0.15;
  this.aoeZones.push(new AoEZone(x, y, radius * 0.55, burnDamage, 600, 'rgba(0,0,0,0)', this.enemyManager, this.player));

    // Multi-phase shockwaves (primary + thermal + dust) – adapt count for perf
    const addShock = (sx:number, sy:number, sr:number, er:number, life:number, col:string, alpha?:number) => {
      if (vfxLow && this.shockwaves.length >= Math.min(24, this.shockwaveBudget)) return;
      const sw = this.shockwavePool.pop() || { x:0, y:0, startR:0, endR:0, life:0, maxLife:0, color:'#fff' };
      sw.x = sx; sw.y = sy; sw.startR = sr; sw.endR = er; const lf = vfxLow ? Math.max(160, Math.round(life*0.7)) : life; sw.life = lf; sw.maxLife = lf; sw.color = col; sw.alphaScale = alpha;
      this.shockwaves.push(sw);
    };
    addShock(x, y, Math.max(18, radius * 0.30), radius * 1.05, 260, color, 0.9);
    if (!vfxLow) addShock(x, y, Math.max(10, radius * 0.15), radius * 0.78, 220, '#FFF5C0', 0.6);
    addShock(x, y, Math.max(6, radius * 0.10), radius * 1.15, vfxLow ? 260 : 360, '#D2B48C', 0.35); // dust ring

    // Particle bursts
  const scale = vfxLow ? 0.6 : 1;
  this.particleManager.spawn(x, y, Math.round(36*scale), '#FFE066', { sizeMin: 5, sizeMax: 10, lifeMs: 220, speedMin: 1, speedMax: 3 });
  this.particleManager.spawn(x, y, Math.round(44*scale), '#FFB347', { sizeMin: 3, sizeMax: 7, lifeMs: vfxLow ? 420 : 540, speedMin: 1.5, speedMax: 4 });
  this.particleManager.spawn(x, y, Math.round(18*scale), '#FFFFFF', { sizeMin: 2, sizeMax: 5, lifeMs: 160, speedMin: 0.8, speedMax: 2 });
  this.particleManager.spawn(x, y, Math.round(28*scale), '#C0C0C0', { sizeMin: 2, sizeMax: 3, lifeMs: vfxLow ? 700 : 900, speedMin: 3, speedMax: 7 });
  this.particleManager.spawn(x, y, Math.round(26*scale), '#4A4A4A', { sizeMin: 6, sizeMax: 14, lifeMs: vfxLow ? 800 : 1100, speedMin: 0.6, speedMax: 1.8 });
  this.particleManager.spawn(x, y, Math.round(28*scale), '#FFDD99', { sizeMin: 1, sizeMax: 3, lifeMs: vfxLow ? 1100 : 1400, speedMin: 1, speedMax: 2.2 });
  this.particleManager.spawn(x, y, Math.round(16*scale), '#FFFFE0', { sizeMin: 1, sizeMax: 2, lifeMs: 160, speedMin: 0.4, speedMax: 1.2 });
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
  if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(e, finalDamage, false, false, undefined, x, y, undefined, true);
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
  public triggerShockwave(x: number, y: number, damage: number, radius: number = 100, color: string = '#FFA07A', bossDamageFrac?: number) {
  const avgMs = (window as any).__avgFrameMs || 16;
  const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
    // Apply global area multiplier to radius
    const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
    const finalRadius = radius * (areaMul || 1);
    // Immediate damage application (single tick)
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      for (let i=0;i<enemies.length;i++) {
        const e = enemies[i];
        const dx = e.x - x; const dy = e.y - y;
  if (dx*dx + dy*dy <= finalRadius*finalRadius) this.enemyManager.takeDamage(e, damage, false, false, undefined, x, y, undefined, true);
      }
    }
    // Also damage boss in shockwave radius
  try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
      if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
        const dxB = (boss.x ?? 0) - x; const dyB = (boss.y ?? 0) - y;
        const rB = (boss.radius || 160);
        if (dxB*dxB + dyB*dyB <= (finalRadius + rB) * (finalRadius + rB)) {
      const bossDmg = (typeof bossDamageFrac === 'number' ? Math.max(0, bossDamageFrac) : 1) * damage;
  (this.enemyManager as any).takeBossDamage?.(boss, bossDmg, false, undefined, x, y, undefined, true);
        }
      }
    } catch { /* ignore boss shockwave errors */ }
    // Also damage treasures in shockwave radius
    try {
      const emAny: any = this.enemyManager as any;
      if (typeof emAny.getTreasures === 'function') {
        const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
        const r2T = finalRadius * finalRadius;
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
          try { if ((window as any).__gameInstance?.gameMode === 'LAST_STAND') continue; } catch {}
          const dxT = t.x - x; const dyT = t.y - y;
          if (dxT*dxT + dyT*dyT <= r2T && typeof emAny.damageTreasure === 'function') {
            emAny.damageTreasure(t, damage);
          }
        }
      }
    } catch { /* ignore treasure shockwave errors */ }
    // Shockwave visuals (reuse logic path by manually pushing similar rings)
  if (!vfxLow || this.shockwaves.length < Math.min(24, this.shockwaveBudget)) {
      const sw = this.shockwavePool.pop() || { x:0, y:0, startR:0, endR:0, life:0, maxLife:0, color:'#fff' };
      sw.x = x; sw.y = y; sw.startR = Math.max(6, finalRadius*0.22); sw.endR = finalRadius*1.02;
      const life = vfxLow ? 150 : 200; sw.life = life; sw.maxLife = life; sw.color = color; sw.alphaScale = vfxLow ? 0.6 : 1;
      this.shockwaves.push(sw);
    }
  // Removed second ring and screen shake
  }

  public update(deltaMs: number = 16.6667): void {
  const avgMs = (window as any).__avgFrameMs || 16;
  const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
    // Tune shockwaveBudget dynamically each frame
    this.shockwaveBudget = avgMs > 40 ? 28 : avgMs > 32 ? 36 : 48;
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
      sw.life -= deltaMs * (vfxLow ? 1.15 : 1);
      if (sw.life <= 0) {
        // return to pool
        this.shockwavePool.push(sw);
        this.shockwaves[i] = this.shockwaves[this.shockwaves.length - 1];
        this.shockwaves.pop();
        i--;
      }
    }

    // Prune expired charge glows
  if (this.chargeGlows.length) {
      const now = performance.now();
      this.chargeGlows = this.chargeGlows.filter(g => now - g.start < g.duration);
    }
  }

  public draw(ctx: CanvasRenderingContext2D): void {
  const avgMs = (window as any).__avgFrameMs || 16;
  const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
    // Viewport for offscreen culling of shockwaves
    const dW = (window as any).__designWidth || ctx.canvas.width;
    const dH = (window as any).__designHeight || ctx.canvas.height;
    const camX = (window as any).__camX || 0;
    const camY = (window as any).__camY || 0;
    const minX = camX - 64, maxX = camX + dW + 64;
    const minY = camY - 64, maxY = camY + dH + 64;
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
  const alpha = 0.02 + 0.12 * ease; // softer: 0.02 → 0.14
  const r = g.radius * (0.92 + 0.08 * ease);
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
  // Remove crisp white rim; keep only soft additive fill for a cleaner look
        ctx.restore();
      }
    }

    // Draw shockwaves after zones and glows (so rings appear atop)
    // Stride in low mode to reduce draw calls
    const step = vfxLow ? 2 : 1;
    for (let i = 0; i < this.shockwaves.length; i += step) {
      const sw = this.shockwaves[i];
      // Offscreen cull by bounding box of current radius
      const tCull = 1 - sw.life / sw.maxLife;
      const rCull = sw.startR + (sw.endR - sw.startR) * tCull;
      if (sw.x + rCull < minX || sw.x - rCull > maxX || sw.y + rCull < minY || sw.y - rCull > maxY) continue;
      const t = 1 - sw.life / sw.maxLife; // 0..1
      const radius = sw.startR + (sw.endR - sw.startR) * t;
      const alphaBase = (1 - t) * (vfxLow ? 0.25 : 0.35);
      const alpha = alphaBase * (sw.alphaScale != null ? sw.alphaScale : 1);
      ctx.save();
      // Avoid additive blending in low mode to cut fill-rate cost
      if (!vfxLow) ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = Math.max(1, (vfxLow ? 2 : 3) * (1 - t));
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
      // Single pass stroke on low; dual on normal
      if (vfxLow) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = sw.color;
        ctx.stroke();
      } else {
        ctx.shadowColor = sw.color;
        ctx.shadowBlur = 10 * (1 - t * 0.7);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = sw.color;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = Math.min(1, alpha * 1.1);
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - t)})`;
        ctx.lineWidth = Math.max(1, 1.5 * (1 - t));
        ctx.stroke();
      }
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
  const dx = e.x - x; const dy = e.y - y; if (dx*dx + dy*dy <= r2) this.enemyManager.takeDamage(e, damage, false, false, undefined, x, y, undefined, true, 'PLAYER');
      }
    }
    // Boss in plasma detonation radius
    try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
      if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
        const dxB = (boss.x ?? 0) - x; const dyB = (boss.y ?? 0) - y;
        const rB = (boss.radius || 160);
        if (dxB*dxB + dyB*dyB <= (finalRadius + rB) * (finalRadius + rB)) {
          (this.enemyManager as any).takeBossDamage?.(boss, damage, false, undefined, x, y, undefined, true, 'PLAYER');
        }
      }
    } catch { /* ignore boss plasma errors */ }
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
