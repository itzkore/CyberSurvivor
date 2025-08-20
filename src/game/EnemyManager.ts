export type Enemy = { x: number; y: number; hp: number; maxHp: number; radius: number; speed: number; active: boolean; type: 'small' | 'medium' | 'large'; damage: number; _lastDamageTime?: number; id: string;
  _lastHitByWeapon?: WeaponType; // Track the last weapon type that hit this enemy
  knockbackVx?: number; // Knockback velocity X (px/sec)
  knockbackVy?: number; // Knockback velocity Y (px/sec)
  knockbackTimer?: number; // Remaining knockback time in ms
  _lodCarryMs?: number; // accumulated skipped time for LOD far updates
};

export type Chest = { x: number; y: number; radius: number; active: boolean; }; // New Chest type

import { Player } from './Player';
import type { Bullet } from './Bullet';
import { ParticleManager } from './ParticleManager';
import type { Gem } from './Gem';
import { GEM_TIERS, getGemTierSpec } from './Gem';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';
import { Logger } from '../core/Logger';
import { WEAPON_SPECS } from './WeaponConfig';
import { SpatialGrid } from '../physics/SpatialGrid'; // Import SpatialGrid

interface Wave {
  startTime: number; // in seconds
  enemyType: 'small' | 'medium' | 'large';
  count: number;
  spawnInterval: number; // in frames
  spawned: number;
  lastSpawnTime: number;
  spawnPattern?: 'normal' | 'ring' | 'cone' | 'surge'; // New property for spawn pattern
}

export class EnemyManager {
  private player: Player;
  public enemies: Enemy[] = []; // Made public for Game.ts to pass to bullet collision
  // Cached list of active enemies (rebuilt each update to avoid repeated filter allocations)
  private activeEnemies: Enemy[] = [];
  private enemyPool: Enemy[] = []; // Explicit enemy pool
  private particleManager: ParticleManager | null = null;
  private gems: Gem[] = [];
  private gemPool: Gem[] = []; // Explicit gem pool
  private gemMergeAnims: { group: Gem[]; tier: number; x: number; y: number; t: number; dur: number; spawned?: boolean }[] = [];
  private pendingVacuum: boolean = false; // flag when a boss-triggered full vacuum is in progress
  private vacuumDurationMs: number = 5000; // 5 second vacuum animation window
  private vacuumElapsedMs: number = 0; // elapsed time during current vacuum
  private chests: Chest[] = []; // Active chests
  private chestPool: Chest[] = []; // Chest pool
  private assetLoader: AssetLoader | null = null;
  private waves: Wave[]; // legacy static waves (will phase out)
  private dynamicWaveAccumulator: number = 0; // ms accumulator for dynamic spawner
  private pressureBaseline: number = 100; // grows over time
  private adaptiveGemBonus: number = 0; // multiplicative bonus for higher tier chance
  private bulletSpatialGrid: SpatialGrid<Bullet>; // Spatial grid for bullets
  private spawnBudgetCarry: number = 0; // carry fractional spawn budget between ticks so early game spawns occur
  private enemySpeedScale: number = 0.62; // reduced global speed scaler (was 0.85) to slow overall chase velocity
  // Base XP gem tier awarded per enemy type (before random upgrade chances)
  private enemyXpBaseTier: Record<Enemy['type'], number> = { small: 1, medium: 2, large: 3 };
  // Adaptive performance
  private avgFrameMs: number = 16; // exponential moving average of frame time (ms)
  private lastPerfSample: number = performance.now();
  private spawnIntervalDynamic: number = 300; // base spawn cadence in ms (can stretch under load)
  // Knockback configuration
  private knockbackDecayTauMs: number = 220; // exponential decay time constant (larger = longer slide)
  private readonly knockbackBaseMs: number = 140;
  private readonly knockbackMaxVelocity: number = 4200; // clamp to avoid extreme stacking
  private readonly knockbackStackScale: number = 0.55; // scaling when stacking onto existing velocity
  private readonly knockbackMinPerFrame: number = 4; // legacy per-frame minimum (converted to px/sec later)
  // LOD
  private lodToggle: boolean = false; // flip each update to stagger LOD skips
  private readonly lodFarDistSq: number = 1600*1600; // >1600px from player qualifies as far
  private readonly lodSkipRatio: number = 0.5; // skip every other frame for far enemies
  private killCount: number = 0; // total enemies killed this run

  // Poison puddle system
  private poisonPuddles: { x: number, y: number, radius: number, life: number, maxLife: number, active: boolean }[] = [];
  // Burn (Blaster) status: applied per enemy; stacking DoT (up to 3 stacks), 2s duration refreshed per stack add
  // We'll store transient fields directly on Enemy object via symbol-like keys to avoid changing type globally.
  private readonly burnTickIntervalMs: number = 500; // 4 ticks over 2s
  private readonly burnDurationMs: number = 2000; // total duration per stack refresh
  // Pre-rendered enemy sprites (normal / flash) keyed by type
  private enemySprites: Record<string, { normal: HTMLCanvasElement; flash: HTMLCanvasElement; normalFlipped?: HTMLCanvasElement; flashFlipped?: HTMLCanvasElement } > = Object.create(null);
  private sharedEnemyImageLoaded = false; // indicates enemy_default.png processed
  private usePreRenderedSprites: boolean = true;

  /**
   * EnemyManager constructor
   * @param player Player instance
   * @param bulletSpatialGrid SpatialGrid for bullets
   * @param particleManager ParticleManager instance
   * @param assetLoader AssetLoader instance
   * @param difficulty Difficulty multiplier
   */
  constructor(player: Player, bulletSpatialGrid: SpatialGrid<Bullet>, particleManager?: ParticleManager, assetLoader?: AssetLoader, difficulty: number = 1) {
    this.player = player;
    this.bulletSpatialGrid = bulletSpatialGrid; // Assign spatial grid
    this.particleManager = particleManager || null;
    this.assetLoader = assetLoader || null;
    this.preallocateEnemies(difficulty);
    this.preallocateGems();
    this.preallocateChests();
  this.waves = []; // legacy disabled; dynamic system takes over
    // Listen for spawnChest event from BossManager
    window.addEventListener('spawnChest', (e: Event) => {
      const customEvent = e as CustomEvent;
      // Redirect chest spawn to farthest (prefer unvisited) room center for exploration incentive
      const rm = (window as any).__roomManager;
      if (rm && typeof rm.getFarthestRoom === 'function') {
        const player = this.player;
        const far = rm.getFarthestRoom(player.x, player.y, true);
        if (far) {
          const fx = far.x + far.w/2;
          const fy = far.y + far.h/2;
          this.spawnChest(fx, fy);
          return;
        }
      }
      this.spawnChest(customEvent.detail.x, customEvent.detail.y);
    });
    window.addEventListener('bossGemVacuum', () => this.vacuumGemsToPlayer());
    window.addEventListener('bossDefeated', () => { // trigger new timed vacuum logic
      this.startTimedVacuum();
    });
    window.addEventListener('bossXPSpray', (e: Event) => {
      const { x, y } = (e as CustomEvent).detail;
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI * 2 * i) / 6;
        this.spawnGem(x + Math.cos(angle) * 40, y + Math.sin(angle) * 40, 3);
      }
    });
    if (this.usePreRenderedSprites) this.preRenderEnemySprites();
  // Attempt to load shared enemy image and build size variants
  this.loadSharedEnemyImage();
  }

  /** Pre-render circle enemies (normal + flash variant) to cut per-frame path & stroke cost. */
  private preRenderEnemySprites() {
    const defs: Array<{type: Enemy['type']; radius: number; color: string; flashColor: string}> = [
      { type: 'small', radius: 20, color: '#f00', flashColor: '#ff8080' },
      { type: 'medium', radius: 28, color: '#d40000', flashColor: '#ff9090' },
      { type: 'large', radius: 36, color: '#b00000', flashColor: '#ff9999' }
    ];
    for (let i=0;i<defs.length;i++) {
      const d = defs[i];
      const size = d.radius * 2 + 4; // small padding to avoid clipping stroke
      const normal = document.createElement('canvas');
      normal.width = size; normal.height = size;
      const flash = document.createElement('canvas');
      flash.width = size; flash.height = size;
      const canvases: [HTMLCanvasElement, string][] = [[normal, d.color],[flash, d.flashColor]];
      for (let j=0;j<canvases.length;j++) {
        const [cv, fill] = canvases[j];
        const cctx = cv.getContext('2d')!;
        cctx.beginPath();
        cctx.arc(size/2, size/2, d.radius, 0, Math.PI*2);
        cctx.fillStyle = fill;
        cctx.fill();
        cctx.lineWidth = 2;
        cctx.strokeStyle = '#fff';
        cctx.stroke();
      }
  // Circles are horizontally symmetric; reuse same canvas for flipped to simplify draw path
  this.enemySprites[d.type] = { normal, flash, normalFlipped: normal, flashFlipped: flash } as any;
    }
  }

  /** Load single enemy_default.png and create scaled canvases per size category. */
  private loadSharedEnemyImage() {
    const path = (location.protocol === 'file:' ? './assets/enemies/enemy_default.png' : '/assets/enemies/enemy_default.png');
    const img = new Image();
    img.onload = () => {
      const defs: Array<{type: Enemy['type']; radius: number}> = [
        { type: 'small', radius: 20 },
        { type: 'medium', radius: 28 },
        { type: 'large', radius: 36 }
      ];
      for (let i=0;i<defs.length;i++) {
        const d = defs[i];
        const size = d.radius * 2;
        // Normal
        const normal = document.createElement('canvas');
        normal.width = size; normal.height = size;
        const nctx = normal.getContext('2d')!;
        nctx.imageSmoothingEnabled = true;
        nctx.drawImage(img, 0, 0, size, size);
        // Flash variant (tinted)
        const flash = document.createElement('canvas');
        flash.width = size; flash.height = size;
        const fctx = flash.getContext('2d')!;
        fctx.drawImage(img, 0, 0, size, size);
        fctx.globalCompositeOperation = 'lighter';
        fctx.fillStyle = 'rgba(255,128,128,0.6)';
        fctx.fillRect(0,0,size,size);
        fctx.globalCompositeOperation = 'source-over';
        // Flipped variants (precomputed to avoid per-enemy save/scale)
        const normalFlipped = document.createElement('canvas');
        normalFlipped.width = size; normalFlipped.height = size;
        const fnctx = normalFlipped.getContext('2d')!;
        fnctx.translate(size,0); fnctx.scale(-1,1); fnctx.drawImage(normal,0,0);
        const flashFlipped = document.createElement('canvas');
        flashFlipped.width = size; flashFlipped.height = size;
        const ffctx = flashFlipped.getContext('2d')!;
        ffctx.translate(size,0); ffctx.scale(-1,1); ffctx.drawImage(flash,0,0);
        this.enemySprites[d.type] = { normal, flash, normalFlipped, flashFlipped } as any; // overwrite circle fallback
      }
      this.sharedEnemyImageLoaded = true;
    };
    img.onerror = () => { /* fallback circles already exist */ };
    img.src = path;
  }

  private preallocateEnemies(difficulty: number): void {
    const initial = Math.floor(20 * difficulty * 2); // Increased initial pool size
    for (let i = 0; i < initial; i++) {
      this.enemyPool.push({ x: 0, y: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, active: false, type: 'small', damage: 0, id: '', _lastHitByWeapon: undefined }); // Initialize with empty ID and last hit
    }
  }

  private preallocateGems(): void {
    for (let i = 0; i < 1200; i++) { // expanded pool to prevent reuse popping
      this.gemPool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, value: 0, active: false, tier: 1, color: '#FFD700' });
    }
  }

  private preallocateChests(): void {
    for (let i = 0; i < 10; i++) { // Pre-allocate a small number of chests
      this.chestPool.push({ x: 0, y: 0, radius: 16, active: false });
    }
  }

  public getEnemies() {
  return this.activeEnemies;
  }

  public getGems() {
    return this.gems.filter(g => g.active);
  }

  /** Begin 5s timed vacuum after boss kill */
  private startTimedVacuum() {
    if (this.pendingVacuum) return;
    this.pendingVacuum = true;
    this.vacuumElapsedMs = 0;
  }

  public getChests() {
    return this.chests.filter(c => c.active);
  }

  /**
   * Applies damage & (optional) knockback. Knockback direction now derives from precise source coordinates (e.g., bullet impact),
   * eliminating previous randomness that used the moving player's position.
   * @param sourceX X of damage source (bullet / player). Required for directional knockback.
   * @param sourceY Y of damage source (bullet / player).
   */
  public takeDamage(enemy: Enemy, amount: number, isCritical: boolean = false, ignoreActiveCheck: boolean = false, sourceWeaponType?: WeaponType, sourceX?: number, sourceY?: number, weaponLevel?: number): void {
    if (!ignoreActiveCheck && (!enemy.active || enemy.hp <= 0)) return; // Only damage active, alive enemies unless ignored

    enemy.hp -= amount;
    // Side-effect: apply burn on Blaster direct damage (initial hit only, not DoT ticks)
  if (sourceWeaponType === WeaponType.LASER && amount > 0) {
      this.applyBurn(enemy, amount * 0.10); // store per-tick damage reference (10% bullet damage per tick)
    }
    if (sourceWeaponType !== undefined) {
      enemy._lastHitByWeapon = sourceWeaponType;
      // --- Knockback logic ---
      /**
       * Compute direction from source to enemy if coordinates provided.
       */
      const spec = WEAPON_SPECS[sourceWeaponType];
    if (spec) {
  // Direction: force radial from player so enemies are always pushed directly away from hero
  // (user feedback: side impacts sometimes produced lateral slide instead of backward push).
  const sx = this.player.x;
  const sy = this.player.y;
  // spec.knockback historically represented px per 60fps frame
        let perFrame = spec.knockback ?? this.knockbackMinPerFrame;
        if (perFrame < this.knockbackMinPerFrame) perFrame = this.knockbackMinPerFrame;
        if (weaponLevel && weaponLevel > 1) perFrame *= 1 + (weaponLevel - 1) * 0.25; // simple linear scaling
        const baseForcePerSec = perFrame * 60; // convert to px/sec
        // Compute direction from chosen source point to enemy (push enemy away from source)
        let dx = enemy.x - sx;
        let dy = enemy.y - sy;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.0001) {
          // Overlapping: default unit vector (1,0)
          if (dist < 0.0001) { dx = 1; dy = 0; dist = 1; }
        }
        const invDist = 1 / dist;
        const nx = dx * invDist;
        const ny = dy * invDist;
        // Mass attenuation (bigger radius -> more mass -> less acceleration)
        const massScale = 24 / Math.max(8, enemy.radius);
  let impulse = baseForcePerSec * massScale * 0.3; // reduce overall strength by 70%
        // Radial-only stacking: project any existing knockback onto radial axis, discard sideways component
        let existingRadial = 0;
        if (enemy.knockbackTimer && enemy.knockbackTimer > 0 && (enemy.knockbackVx || enemy.knockbackVy)) {
          existingRadial = (enemy.knockbackVx ?? 0) * nx + (enemy.knockbackVy ?? 0) * ny; // dot product
          if (existingRadial < 0) existingRadial = 0; // don't let opposing vectors cancel into pull
        }
        const added = impulse * (existingRadial > 0 ? this.knockbackStackScale : 1);
        let newMagnitude = existingRadial + added;
        if (newMagnitude > this.knockbackMaxVelocity) newMagnitude = this.knockbackMaxVelocity;
        enemy.knockbackVx = nx * newMagnitude;
        enemy.knockbackVy = ny * newMagnitude;
        const kMag = newMagnitude; // already clamped
        // Timer extension: proportional bonus to initial impulse (capped)
        const bonus = Math.min(180, (impulse / 2200) * 90);
        enemy.knockbackTimer = Math.max(enemy.knockbackTimer ?? 0, this.knockbackBaseMs + bonus);
      }
    }
  // Dispatch damage event with enemy world coordinates so floating damage text appears above the enemy
  window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount, isCritical, x: enemy.x, y: enemy.y } }));
  }

  /** Apply or refresh a burn stack (max 3). Each stack deals storedTickDamage every burnTickIntervalMs for burnDurationMs. */
  private applyBurn(enemy: Enemy, tickDamage: number) {
    if (!enemy.active || enemy.hp <= 0) return;
    const now = performance.now();
    const eAny: any = enemy as any;
    if (!eAny._burnStacks) {
      eAny._burnStacks = 0;
      eAny._burnTickDamage = 0;
      eAny._burnNextTick = now + this.burnTickIntervalMs;
      eAny._burnExpire = now + this.burnDurationMs;
    }
    // Increase stacks up to 3
    if (eAny._burnStacks < 3) eAny._burnStacks++;
    // Recompute per-tick damage as average to avoid runaway scaling when rapidly stacking; could also sum.
    // We'll sum contributions: base existing tickDamage + new tickDamage (capped by stacks count times base tickDamage maybe). Simpler: accumulate.
    eAny._burnTickDamage = (eAny._burnTickDamage || 0) + tickDamage;
    // Refresh expiration
    eAny._burnExpire = now + this.burnDurationMs;
  }

  /** Update burn DoT across enemies (called each frame). */
  private updateBurns() {
    const now = performance.now();
    for (let i = 0; i < this.activeEnemies.length; i++) {
      const e: any = this.activeEnemies[i];
      if (!e._burnStacks) continue;
      if (!e.active || e.hp <= 0) { e._burnStacks = 0; continue; }
      if (now >= e._burnExpire) { // burn ended
        e._burnStacks = 0;
        e._burnTickDamage = 0;
        continue;
      }
      if (now >= e._burnNextTick) {
        e._burnNextTick += this.burnTickIntervalMs;
        if (e._burnTickDamage > 0) {
          // Apply damage without recursion side-effects (ignoreActiveCheck true to ensure processing; pass source weapon for consistency)
          this.takeDamage(e as Enemy, e._burnTickDamage, false, false, WeaponType.LASER);
          // Optionally spawn a tiny ember particle (future enhancement)
        }
      }
    }
  }

  public spawnPoisonPuddle(x: number, y: number) {
    let puddle = this.poisonPuddles.find(p => !p.active);
  if (!puddle) {
    puddle = { x, y, radius: 32, life: 3000, maxLife: 3000, active: true };
      this.poisonPuddles.push(puddle);
    } else {
      puddle.x = x;
      puddle.y = y;
      puddle.radius = 32;
    puddle.life = 3000;
    puddle.maxLife = 3000;
      puddle.active = true;
    }
  }

  private updatePoisonPuddles(deltaMs: number) {
    for (const puddle of this.poisonPuddles) {
      if (!puddle.active) continue;
    puddle.life -= deltaMs;
    if (puddle.life <= 0) {
        puddle.active = false;
        continue;
      }
      let didDamage = false;
      for (const enemy of this.enemies) {
        if (!enemy.active || enemy.hp <= 0) continue;
        const dx = enemy.x - puddle.x;
        const dy = enemy.y - puddle.y;
        const dist = Math.hypot(dx, dy);
        if (dist < puddle.radius + enemy.radius) {
          this.takeDamage(enemy, 2.5, false, false, WeaponType.BIO_TOXIN); // Apply poison damage via centralized method, respect active check
          didDamage = true; // Still track if damage was dealt for visual feedback
        }
      }
      // Visual feedback if puddle is damaging
      if (didDamage && this.particleManager) {
        this.particleManager.spawn(puddle.x, puddle.y, 1, '#00FF00');
      }
    }
  }

  /**
   * Draws a cyberpunk grid background, then all enemies, gems, and chests to the canvas.
   * @param ctx Canvas 2D context
   * @param camX Camera X offset (unused)
   * @param camY Camera Y offset (unused)
   */
  public draw(ctx: CanvasRenderingContext2D, camX: number = 0, camY: number = 0) {
  ctx.save();
  // Visible rect for culling (pad to avoid pop-in at edges)
  const viewW = (window as any).__designWidth || (ctx.canvas as HTMLCanvasElement).width;
  const viewH = (window as any).__designHeight || (ctx.canvas as HTMLCanvasElement).height;
  const pad = 120; // prefetch margin
  const minX = camX - pad;
  const maxX = camX + viewW + pad;
  const minY = camY - pad;
  const maxY = camY + viewH + pad;
  // Draw enemies (cached sprite images if enabled)
    if (this.usePreRenderedSprites) {
      for (let i = 0, len = this.activeEnemies.length; i < len; i++) {
        const enemy = this.activeEnemies[i];
    if (enemy.x < minX || enemy.x > maxX || enemy.y < minY || enemy.y > maxY) continue; // cull offscreen
        const bundle = this.enemySprites[enemy.type];
        if (!bundle) continue;
  const faceLeft = this.player.x < enemy.x;
  const baseImg = faceLeft ? (bundle.normalFlipped || bundle.normal) : bundle.normal;
  const size = baseImg.width;
  ctx.drawImage(baseImg, enemy.x - size/2, enemy.y - size/2, size, size);
        // HP bar (only if damaged and alive)
        if (enemy.hp < enemy.maxHp && enemy.hp > 0) {
          const hpBarWidth = enemy.radius * 2;
          const hpBarHeight = 4;
          const hpBarX = enemy.x - enemy.radius;
          const hpBarY = enemy.y - enemy.radius - 8;
          ctx.fillStyle = '#222';
          ctx.fillRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);
          const w = (enemy.hp / enemy.maxHp) * hpBarWidth;
          ctx.fillStyle = '#0F0';
          ctx.fillRect(hpBarX, hpBarY, w, hpBarHeight);
        }
      }
    } else {
      // Fallback original vector draw
      for (let i = 0, len = this.activeEnemies.length; i < len; i++) {
        const enemy = this.activeEnemies[i];
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
        ctx.fillStyle = enemy.hp > 0 ? '#f00' : '#222';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.closePath();
      }
    }
    for (let i = 0, len = this.gems.length; i < len; i++) {
      const gem = this.gems[i]; if (!gem.active) continue; if (gem.x < minX || gem.x > maxX || gem.y < minY || gem.y > maxY) continue;
      ctx.fillStyle = gem.color;
      ctx.beginPath();
      ctx.arc(gem.x, gem.y, gem.size, 0, Math.PI*2);
      ctx.fill();
    }
    for (let i = 0, len = this.chests.length; i < len; i++) {
      const chest = this.chests[i]; if (!chest.active) continue; if (chest.x < minX || chest.x > maxX || chest.y < minY || chest.y > maxY) continue;
      ctx.fillStyle = '#00f';
      ctx.beginPath();
      ctx.arc(chest.x, chest.y, chest.radius, 0, Math.PI*2);
      ctx.fill();
    }
    // Draw poison puddles
    for (let i = 0; i < this.poisonPuddles.length; i++) {
      const puddle = this.poisonPuddles[i];
      if (!puddle.active) continue;
      ctx.save();
      const alpha = puddle.life / puddle.maxLife; // Fade out over time
      ctx.globalAlpha = alpha * 0.6; // Max 60% opacity
      ctx.beginPath();
      ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#00FF00'; // Green color for poison
      ctx.shadowColor = '#00FF00';
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Updates all enemies, gems, chests, and poison puddles.
   * Moves enemies toward the player and handles collisions/death.
   * @param deltaTime Time since last frame in ms
   * @param gameTime Current game time in seconds
   * @param bullets Array of active bullets
   */
  public update(deltaTime: number, gameTime: number = 0, bullets: Bullet[] = []) {
  this.lodToggle = !this.lodToggle;
  // --- Adaptive frame time tracking ---
  // Use a fast EMA to smooth deltaTime (weight 0.1 new value)
  this.avgFrameMs = this.avgFrameMs * 0.9 + deltaTime * 0.1;
  const highLoad = this.avgFrameMs > 40; // ~25 FPS
  const severeLoad = this.avgFrameMs > 55; // <18 FPS
  // Stretch spawn interval under load (caps enemy growth pressure when Electron throttles)
  const targetInterval = severeLoad ? 600 : highLoad ? 450 : 300;
  // Ease toward target to avoid abrupt shifts
  this.spawnIntervalDynamic += (targetInterval - this.spawnIntervalDynamic) * 0.15;
    // Wave-based spawning
    // Dynamic spawning (every 300ms)
    this.dynamicWaveAccumulator += deltaTime;
    if (this.dynamicWaveAccumulator >= this.spawnIntervalDynamic) {
      this.dynamicWaveAccumulator -= this.spawnIntervalDynamic;
      this.runDynamicSpawner(gameTime);
    }

    // Update enemies
    const playerX = this.player.x;
    const playerY = this.player.y;
    // Rebuild active enemy cache while updating (single pass)
    this.activeEnemies.length = 0;
    const deltaFactor = deltaTime / 16.6667; // 1 at 60fps, scales movement under variable timestep
    for (let i = 0, len = this.enemies.length; i < len; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;
      this.activeEnemies.push(enemy);
      // Decay damage flash counter (ms-based) so hit highlight fades out
  // (damage flash removed)
      // Calculate distance to player for movement and collision
      const dx = playerX - enemy.x;
      const dy = playerY - enemy.y;
      const distSq = dx*dx + dy*dy;
      const dist = distSq > 0 ? Math.sqrt(distSq) : 0;
      // LOD: if far, skip some frames but accumulate skipped time so motion stays consistent
      let effectiveDelta = deltaTime;
      if (distSq > this.lodFarDistSq) {
        if (this.lodToggle) {
          enemy._lodCarryMs = (enemy._lodCarryMs || 0) + deltaTime;
          // Still decay knockback timers minimally even if skipping movement (no heavy math)
          if (enemy.knockbackTimer && enemy.knockbackTimer > 0) {
            enemy.knockbackTimer -= deltaTime;
            if (enemy.knockbackTimer < 0) enemy.knockbackTimer = 0;
          }
          continue; // skip heavy update this frame
        } else if (enemy._lodCarryMs) {
          effectiveDelta += enemy._lodCarryMs; enemy._lodCarryMs = 0;
        }
      }
      // Apply knockback velocity if active
      if (enemy.knockbackTimer && enemy.knockbackTimer > 0) {
        const dtSec = effectiveDelta / 1000;
        // Recompute outward direction each frame so knockback always moves enemy further from hero
        let kdx = enemy.x - playerX;
        let kdy = enemy.y - playerY;
        let kdist = Math.hypot(kdx, kdy);
        if (kdist < 0.0001) { kdx = 1; kdy = 0; kdist = 1; }
        const knx = kdx / kdist;
        const kny = kdy / kdist;
        const speed = Math.hypot(enemy.knockbackVx ?? 0, enemy.knockbackVy ?? 0);
        enemy.x += knx * speed * dtSec;
        enemy.y += kny * speed * dtSec;
        // Decay speed
        let lin = 1 - (effectiveDelta / this.knockbackDecayTauMs);
        if (lin < 0) lin = 0;
        const newSpeed = speed * lin;
        enemy.knockbackVx = knx * newSpeed;
        enemy.knockbackVy = kny * newSpeed;
        enemy.knockbackTimer -= effectiveDelta;
        if (enemy.knockbackTimer < 0) enemy.knockbackTimer = 0;
      } else {
        enemy.knockbackVx = 0;
        enemy.knockbackVy = 0;
        enemy.knockbackTimer = 0;
        // Move toward player
        if (dist > enemy.radius) { // Use radius to prevent jittering when close
          const inv = dist === 0 ? 0 : 1 / dist;
          const moveScale = (effectiveDelta / 16.6667); // scale like deltaFactor but using effective delta
          enemy.x += dx * inv * enemy.speed * moveScale;
          enemy.y += dy * inv * enemy.speed * moveScale;
        }
      }
      // After position changes, clamp to walkable (prevents embedding in walls via knockback)
      const rm = (window as any).__roomManager;
      if (rm && typeof rm.clampToWalkable === 'function') {
        const clamped = rm.clampToWalkable(enemy.x, enemy.y, enemy.radius || 20);
        enemy.x = clamped.x; enemy.y = clamped.y;
      }
      // Player-enemy collision
      if (dist < enemy.radius + this.player.radius) {
        // Hit cooldown: enemies can damage player at most once per second
        const now = performance.now();
        const lastHit = (enemy as any)._lastPlayerHitTime || 0;
        if (now - lastHit >= 1000) {
          (enemy as any)._lastPlayerHitTime = now;
          // Clamp enemy damage into 1-10 range
          const dmg = Math.min(10, Math.max(1, enemy.damage || 1));
          this.player.takeDamage(dmg);
          // Apply small knockback to player away from enemy
          const kdx = (this.player.x - enemy.x);
          const kdy = (this.player.y - enemy.y);
          const kd = Math.hypot(kdx, kdy) || 1;
          const kb = 24; // pixels immediate displacement
          this.player.x += (kdx / kd) * kb;
          this.player.y += (kdy / kd) * kb;
        }
      }
  // Bullet collisions handled centrally in BulletManager.update now (removed duplicate per-enemy pass)
      // Death handling
      if (enemy.hp <= 0 && enemy.active) {
        enemy.active = false;
        // Bigger enemies drop higher base tier gems
        const baseTier = this.enemyXpBaseTier[enemy.type] || 1;
        this.spawnGem(enemy.x, enemy.y, baseTier);
  // Removed on-kill explosion effect for Mech Mortar (Titan Mech)
  this.killCount++;
        this.enemyPool.push(enemy);
      }
    }

    // Timed vacuum animation for existing gems (after boss defeat)
    if (this.pendingVacuum) {
      this.vacuumElapsedMs += deltaTime;
      const t = Math.min(1, this.vacuumElapsedMs / this.vacuumDurationMs); // 0..1
      // Ease (accelerate toward player): use quadratic ease-in
      const ease = t * t;
      const px = this.player.x;
      const py = this.player.y;
      for (let i = 0; i < this.gems.length; i++) {
        const g = this.gems[i];
        if (!g.active) continue;
        // Lerp gem toward player based on ease proportion each frame (stronger as t increases)
        g.x += (px - g.x) * (0.04 + ease * 0.18); // base pull + stronger as time passes
        g.y += (py - g.y) * (0.04 + ease * 0.18);
        if (Math.hypot(px - g.x, py - g.y) < 18) {
          this.player.gainExp(g.value);
          g.active = false;
          this.gemPool.push(g);
        }
      }
      if (t >= 1) {
        // finalize: any remaining active gems instantly grant XP
        for (let i = 0; i < this.gems.length; i++) {
          const g = this.gems[i];
          if (!g.active) continue;
          this.player.gainExp(g.value);
          g.active = false;
          this.gemPool.push(g);
        }
        this.pendingVacuum = false;
        // compact array
        let w = 0; for (let r = 0; r < this.gems.length; r++) { const g = this.gems[r]; if (g.active) this.gems[w++] = g; }
        this.gems.length = w;
      }
    }
    // Update active gem merge animations (shrink/fade in-place)
    if (this.gemMergeAnims.length) {
      for (let i = 0; i < this.gemMergeAnims.length; i++) {
        const anim = this.gemMergeAnims[i];
        anim.t += deltaTime;
        const r = Math.min(1, anim.t / anim.dur);
        const ease = r * r; // ease-in fade/scale
        for (let gIndex = 0; gIndex < anim.group.length; gIndex++) {
          const g = anim.group[gIndex];
          if (!g.active) continue;
          (g as any)._mergeFade = 1 - ease; // fade value
          (g as any)._mergeScale = 1 - ease * 0.65; // shrink toward 35%
        }
        if (r === 1 && !anim.spawned) {
          // Convert – deactivate originals and spawn upgraded gem
            for (const g of anim.group) { if (g.active) { g.active = false; this.gemPool.push(g); } }
            this.spawnGem(anim.x, anim.y, anim.tier + 1);
            anim.spawned = true;
        }
      }
      // Remove completed animations & compact gems list (drop inactive pieces)
      this.gemMergeAnims = this.gemMergeAnims.filter(a => !a.spawned || a.t < a.dur + 32);
      let w=0; for (let r=0; r<this.gems.length; r++){ const g=this.gems[r]; if (g.active) this.gems[w++]=g; } this.gems.length = w;
    }
    // update gems
  for (let i = 0, len = this.gems.length; i < len; i++) {
      const g = this.gems[i];
      if (!g.active) continue;

  // Magnet effect: gently float toward player everywhere
  const ddx = this.player.x - g.x;
  const ddy = this.player.y - g.y;
  const distSq = ddx*ddx + ddy*ddy;
  const dist = distSq > 0 ? Math.sqrt(distSq) : 0;
      const pullStrength = 0.7; // Lower = slower
      g.vx = (ddx / (dist || 1)) * pullStrength;
      g.vy = (ddy / (dist || 1)) * pullStrength;
      // Update position
      g.x += g.vx * (deltaTime / 1000); // Use deltaTime
      g.y += g.vy * (deltaTime / 1000); // Use deltaTime
  // XP orbs should not expire anymore: removed lifetime countdown & recycling.
  // (Keep lifeMs field untouched for potential future use; no decrement.)
      // Pickup if near player
  if (distSq < 18*18) {
        this.player.gainExp(g.value);
        g.active = false;
        if (this.particleManager) this.particleManager.spawn(g.x, g.y, 1, '#0ff');
        this.gemPool.push(g); // Return to pool
      }
    }
    // In-place compact gems after update
    {
      let write = 0;
      for (let read = 0; read < this.gems.length; read++) {
        const g = this.gems[read];
        if (g.active) this.gems[write++] = g;
      }
      this.gems.length = write;
    }
    this.handleGemMerging();

    // Update chests
    this.updateChests(deltaTime);

  // Poison puddle update (ensure this runs every frame; now ms-based)
  this.updatePoisonPuddles(deltaTime);
  // Burn status updates
  this.updateBurns();
  }

  /** Total enemies killed this run. */
  public getKillCount() { return this.killCount; }

  private spawnEnemy(type: 'small' | 'medium' | 'large', gameTime: number, pattern: 'normal' | 'ring' | 'cone' | 'surge' = 'normal') {
    let enemy = this.enemyPool.pop();
    if (!enemy) {
      enemy = { x: 0, y: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, active: false, type: 'small', damage: 0, id: '', _lastHitByWeapon: undefined };
    }
    enemy.active = true;
    enemy.type = type;
    enemy.id = `enemy-${Date.now()}-${Math.random().toFixed(4)}`; // Assign unique ID
  // (damage flash removed)
    switch (type) {
      case 'small':
  enemy.hp = 100; // Small baseline
  enemy.maxHp = 100;
  enemy.radius = 20;
  // Further reduced base speed (was 1.25 * 0.4)
  enemy.speed = 1.05 * 0.38 * this.enemySpeedScale; // ~0.247 at scale 0.62
        enemy.damage = 4; // within 1-10
        break;
      case 'medium':
  enemy.hp = 320; // Slight bump for medium
  enemy.maxHp = 320;
  enemy.radius = 28;
  // Reduced base speed (was 0.85 * 0.4)
  enemy.speed = 0.75 * 0.36 * this.enemySpeedScale; // ~0.167
        enemy.damage = 7; // within 1-10
        break;
      case 'large':
  enemy.hp = 900; // Tankier large enemy
  enemy.maxHp = 900;
  enemy.radius = 36;
  // Further reduced (was 0.6 * 0.4)
  enemy.speed = 0.5 * 0.34 * this.enemySpeedScale; // ~0.105
        enemy.damage = 10; // cap at 10
        break;
    }
    // Restore original spawn distance and pattern logic
    const spawnDistance = 800; // Base distance from player
    let spawnX = this.player.x;
    let spawnY = this.player.y;
    switch (pattern) {
      case 'normal': {
        const angle = Math.random() * Math.PI * 2;
        spawnX += Math.cos(angle) * spawnDistance;
        spawnY += Math.sin(angle) * spawnDistance;
        break;
      }
      case 'ring': {
        const ringAngle = Math.random() * Math.PI * 2;
        const ringRadius = spawnDistance + Math.random() * 100;
        spawnX += Math.cos(ringAngle) * ringRadius;
        spawnY += Math.sin(ringAngle) * ringRadius;
        break;
      }
      case 'cone': {
        const coneAngle = Math.random() * Math.PI * 0.6 - Math.PI * 0.3;
        const finalAngle = -Math.PI / 2 + coneAngle;
        const coneDistance = spawnDistance + Math.random() * 200;
        spawnX += Math.cos(finalAngle) * coneDistance;
        spawnY += Math.sin(finalAngle) * coneDistance;
        break;
      }
      case 'surge': {
        const randomAngle = Math.random() * Math.PI * 2;
        spawnX += Math.cos(randomAngle) * spawnDistance;
        spawnY += Math.sin(randomAngle) * spawnDistance;
        break;
      }
    }
    // Constrain spawn to walkable (rooms / corridors) via global roomManager if available
    const rm = (window as any).__roomManager;
    if (rm && typeof rm.clampToWalkable === 'function') {
      const clamped = rm.clampToWalkable(spawnX, spawnY, enemy.radius || 20);
      enemy.x = clamped.x; enemy.y = clamped.y;
    } else {
      enemy.x = spawnX;
      enemy.y = spawnY;
    }
    this.enemies.push(enemy);
  }

  private spawnGem(x: number, y: number, baseTier: number = 1) {
    let gem = this.gemPool.pop();
    if (!gem) {
      gem = { x: 0, y: 0, vx: 0, vy: 0, life: 0, lifeMs: 0, size: 0, value: 0, active: false, tier: 1, color: '#FFD700' } as any;
    }
    // Weighted upgrade chance influenced by adaptiveGemBonus
    let tier = baseTier;
    if (tier < 5) {
      const roll = Math.random();
      // Simple progressive chance to upgrade tiers
      if (roll < 0.12 + this.adaptiveGemBonus && tier < 2) tier = 2;
      if (roll < 0.05 + this.adaptiveGemBonus*0.6 && tier < 3) tier = 3;
      if (roll < 0.015 + this.adaptiveGemBonus*0.3 && tier < 4) tier = 4;
      if (roll < 0.003 + this.adaptiveGemBonus*0.1 && tier < 5) tier = 5;
    }
    const spec = getGemTierSpec(tier);
  const gg = gem as any; // assert non-null
  gg.x = x;
  gg.y = y;
  gg.vx = (Math.random() - 0.5) * 1.5;
  gg.vy = (Math.random() - 0.5) * 1.5;
  gg.life = 0; // deprecated (no expiry)
  gg.lifeMs = undefined; // disable ms-based expiry entirely
  gg.size = 4 + tier * 1.6;
  gg.value = spec.value;
  gg.tier = tier;
  gg.color = spec.color;
  gg.active = true;
  this.gems.push(gg);
  }

  private spawnChest(x: number, y: number): void {
    let chest = this.chestPool.pop();
    if (!chest) {
      chest = { x: 0, y: 0, radius: 16, active: false };
    }
    chest.x = x;
    chest.y = y;
    chest.active = true;
    this.chests.push(chest);
    Logger.info(`Chest spawned at ${x}, ${y}`);
  }

  // Merge lower tier gems into higher if enough cluster
  private handleGemMerging(): void {
    // We require merges to be spatially local: a cluster of N same-tier gems within a small radius.
    // Parameters (tunable):
    const clusterRadius = 120; // px radius defining a "small area" for merging
    const clusterRadiusSq = clusterRadius * clusterRadius;

    // Build per-tier lists (tiers 1-4 only) of active gems for quick iteration
    const perTier: Record<number, Gem[]> = { 1: [], 2: [], 3: [], 4: [] } as any;
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
      if (!g.active || g.tier > 4) continue;
      const arr = perTier[g.tier];
      if (arr) arr.push(g);
    }

    // Iterate tiers; stop after performing at most one merge this frame
    for (let t = 1; t <= 4; t++) {
      const list = perTier[t];
      if (!list || !list.length) continue;
      const spec = getGemTierSpec(t);
      if (list.length < spec.merge) continue; // not enough of this tier globally

      // Attempt to find a local cluster: for each candidate gem, count neighbors within clusterRadius
      // Early exit when found.
      const needed = spec.merge;
      for (let i = 0; i < list.length; i++) {
        const g0 = list[i];
        if (!g0.active) continue;
        let count = 1; // include g0
        const cluster: Gem[] = [g0];
        let sumX = g0.x, sumY = g0.y;
        for (let j = 0; j < list.length && count < needed; j++) {
          if (i === j) continue;
            const gj = list[j];
            if (!gj.active) continue;
            const dx = gj.x - g0.x;
            const dy = gj.y - g0.y;
            if (dx*dx + dy*dy <= clusterRadiusSq) {
              cluster.push(gj);
              sumX += gj.x; sumY += gj.y;
              count++;
            }
        }
        if (count === needed) {
          // We found a tight cluster to merge; enqueue animation and stop.
          const cx = sumX / count;
          const cy = sumY / count;
          this.gemMergeAnims.push({ group: cluster, tier: t, x: cx, y: cy, t: 0, dur: 480 });
          return; // only one merge per frame
        }
      }
    }
  }

  // Dynamic spawner: allocate enemy budget based on elapsed time and performance constraints
  private runDynamicSpawner(gameTime: number) {
    const minutes = gameTime / 60;
    // Increase baseline over time (soft exponential flavor)
    this.pressureBaseline = 100 + minutes * 60 + minutes * minutes * 25;
    // Performance guard: if too many enemies active, reduce baseline
  const activeEnemies = this.activeEnemies.length;
    if (activeEnemies > 500) this.pressureBaseline *= 0.5;
    else if (activeEnemies > 350) this.pressureBaseline *= 0.75;
    // Budget per tick (every ~300ms). Previously fractional budgets (<1) were lost causing ~70s no-spawn gap.
    const perTickBudget = this.pressureBaseline / 200; // heuristic scaling
    this.spawnBudgetCarry += perTickBudget; // accumulate fractional part

    // Guarantee some baseline pressure: if nothing active, seed a bit of budget
    if (activeEnemies === 0 && this.spawnBudgetCarry < 1) this.spawnBudgetCarry = 1; // ensure at least one spawn soon after reset

    // Spend accumulated budget spawning enemies by cost weight
    let safety = 20; // safety cap per tick to avoid infinite loops
    while (this.spawnBudgetCarry >= 1 && safety-- > 0) {
      const roll = Math.random();
      let type: 'small' | 'medium' | 'large' = 'small';
      if (roll > 0.85 + minutes * 0.005) type = 'large';
      else if (roll > 0.55 + minutes * 0.01) type = 'medium';

      const cost = type === 'small' ? 1 : type === 'medium' ? 3 : 6;
      if (cost > this.spawnBudgetCarry) break; // wait for more budget next tick
      this.spawnBudgetCarry -= cost;
      this.spawnEnemy(type, gameTime, this.pickPattern(gameTime));
    }
  }

  private pickPattern(gameTime: number): Wave['spawnPattern'] {
    const cycle = Math.floor(gameTime / 15) % 4;
    return cycle === 0 ? 'normal' : cycle === 1 ? 'surge' : cycle === 2 ? 'ring' : 'cone';
  }

  // Event: absorb all active gems (boss kill QoL)
  public vacuumGemsToPlayer() {
  // Legacy immediate vacuum retained for backward compatibility events; redirect to timed vacuum.
  this.startTimedVacuum();
  }

  private updateChests(deltaTime: number): void {
    for (let i = 0; i < this.chests.length; i++) {
      const chest = this.chests[i];
      if (!chest.active) continue;

      const dx = this.player.x - chest.x;
      const dy = this.player.y - chest.y;
      const dist = Math.hypot(dx, dy);

      // Magnet effect towards player
      if (dist > 0 && dist < this.player.magnetRadius * 2) { // Increased magnet radius for chests
        const pullStrength = 1.5; // Stronger pull for chests
        chest.x += (dx / dist) * pullStrength * (deltaTime / 1000);
        chest.y += (dy / dist) * pullStrength * (deltaTime / 1000);
      }

      // Pickup if near player
      if (dist < chest.radius + this.player.radius) {
        chest.active = false;
        this.chestPool.push(chest); // Return to pool
        Logger.info('Chest picked up!');
        // Dispatch event for Player to handle evolution
        window.dispatchEvent(new CustomEvent('chestPickedUp'));
      }
    }
    {
      let write = 0;
      for (let read = 0; read < this.chests.length; read++) {
        const c = this.chests[read];
        if (c.active) this.chests[write++] = c;
      }
      this.chests.length = write;
    }
  }
}

