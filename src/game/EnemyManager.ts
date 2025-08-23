export type Enemy = { x: number; y: number; hp: number; maxHp: number; radius: number; speed: number; active: boolean; type: 'small' | 'medium' | 'large'; damage: number; _lastDamageTime?: number; id: string;
  _lastHitByWeapon?: WeaponType; // Track the last weapon type that hit this enemy
  knockbackVx?: number; // Knockback velocity X (px/sec)
  knockbackVy?: number; // Knockback velocity Y (px/sec)
  knockbackTimer?: number; // Remaining knockback time in ms
  _lodCarryMs?: number; // accumulated skipped time for LOD far updates
  _facingX?: number; // -1 left, +1 right
  _walkFlip?: boolean; // toggled for visual walk cycle
  _walkFlipTimerMs?: number; // timer accumulator
  _walkFlipIntervalMs?: number; // dynamic per speed
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
import { ENEMY_PRESSURE_BASE, ENEMY_PRESSURE_LINEAR, ENEMY_PRESSURE_QUADRATIC, XP_ENEMY_BASE_TIERS, GEM_UPGRADE_PROB_SCALE, XP_DROP_CHANCE_SMALL, XP_DROP_CHANCE_MEDIUM, XP_DROP_CHANCE_LARGE } from './Balance';

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
  private enemySpeedScale: number = 0.55; // further reduced global speed scaler to keep mobs slower overall
  // Cap enemies' effective chase speed to a ratio of the player's current speed to avoid runaway scaling
  private readonly enemyChaseCapRatio: number = 0.9; // cap enemy chase to ~90% of player speed to avoid runaway pursuit
  // Base XP gem tier awarded per enemy type (before random upgrade chances)
  private enemyXpBaseTier: Record<Enemy['type'], number> = {
    small: XP_ENEMY_BASE_TIERS.small as number,
    medium: XP_ENEMY_BASE_TIERS.medium as number,
    large: XP_ENEMY_BASE_TIERS.large as number
  };
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
  // Ghost cloak follow: locked target position while cloak is active
  private _ghostCloakFollow: { active: boolean; x: number; y: number; until: number } = { active: false, x: 0, y: 0, until: 0 };
  // Data Sigils: planted glyphs that pulse AoE damage
  private dataSigils: { x:number; y:number; radius:number; pulsesLeft:number; pulseDamage:number; nextPulseAt:number; active:boolean; spin:number; created:number; follow?: boolean }[] = [];

  // Rogue Hacker paralysis/DoT zones (spawned under enemies on virus impact)
  // pulseUntil: draw a stronger spawn pulse/line for first ~220ms to improve visibility
  private hackerZones: { x:number; y:number; radius:number; created:number; lifeMs:number; active:boolean; hit:Set<string>; pulseUntil?: number; seed?: number }[] = [];
  // Rogue Hacker auto-cast state: gate next cast until previous zone has expired and cooldown passed
  private hackerAutoCooldownUntil: number = 0;

  // Poison puddle system
  private poisonPuddles: { x: number, y: number, radius: number, life: number, maxLife: number, active: boolean }[] = [];
  // Poison (Bio Engineer) status: stacking DoT with movement slow and contagion
  private readonly poisonTickIntervalMs: number = 500; // damage application cadence
  private readonly poisonDurationMs: number = 4000; // duration refreshed per stack add
  private readonly poisonDpsPerStack: number = 3.2; // increased DPS per stack to emphasize DoT over impact
  private readonly poisonMaxStacks: number = 10; // hard cap to avoid runaway
  private readonly poisonSlowPerStack: number = 0.01; // 1% slow per stack
  private readonly poisonSlowCap: number = 0.20; // max 20% slow
  // Burn (Blaster) status: applied per enemy; stacking DoT (up to 3 stacks), 2s duration refreshed per stack add
  // We'll store transient fields directly on Enemy object via symbol-like keys to avoid changing type globally.
  private readonly burnTickIntervalMs: number = 500; // 4 ticks over 2s
  private readonly burnDurationMs: number = 2000; // total duration per stack refresh
  // Pre-rendered enemy sprites (normal / flash) keyed by type
  private enemySprites: Record<string, { normal: HTMLCanvasElement; flash: HTMLCanvasElement; normalFlipped?: HTMLCanvasElement; flashFlipped?: HTMLCanvasElement } > = Object.create(null);
  private sharedEnemyImageLoaded = false; // indicates enemy_default.png processed
  private usePreRenderedSprites: boolean = true;
  // Weaver Lattice tick scheduler
  private latticeTickIntervalMs: number = 500; // 0.5s
  private latticeNextTickMs: number = 0;
  // Boss-specific status trackers (stored on boss object via dynamic fields but we tick from here)
  private _bossLastVoidTickMs: number = 0;
  private _bossLastHackerTickMs: number = 0;

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
    // Ghost Operative cloak: lock enemies to the player's position at start until cloak ends
    window.addEventListener('ghostCloakStart', (e: Event) => {
      try {
        const d = (e as CustomEvent).detail || {};
        this._ghostCloakFollow = { active: true, x: d.x ?? this.player.x, y: d.y ?? this.player.y, until: (performance.now() + (d.durationMs || 5000)) };
      } catch { this._ghostCloakFollow = { active: true, x: this.player.x, y: this.player.y, until: performance.now() + 5000 }; }
    });
    window.addEventListener('ghostCloakEnd', () => { this._ghostCloakFollow = { active: false, x: 0, y: 0, until: 0 }; });
    // Listen for Data Sigil planting
    window.addEventListener('plantDataSigil', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      // Apply player's global area multiplier to radius if provided
      const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
      const baseRadius = d.radius || 120;
      const radius = baseRadius * (areaMul || 1);
      this.plantDataSigil(d.x, d.y, radius, d.pulseCount || 3, d.pulseDamage || 90, !!d.follow);
    });
    window.addEventListener('bossDefeated', () => { // trigger new timed vacuum logic
      this.startTimedVacuum();
    });
    window.addEventListener('bossXPSpray', (e: Event) => {
      const { x, y } = (e as CustomEvent).detail;
      for (let i = 0; i < 3; i++) { // further reduced count
        const angle = (Math.PI * 2 * i) / 3;
        this.spawnGem(x + Math.cos(angle) * 56, y + Math.sin(angle) * 56, 2); // lower tier
      }
    });
    // Listen for Rogue Hacker zone spawns
    window.addEventListener('spawnHackerZone', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      this.spawnHackerZone(d.x, d.y, d.radius || 120, d.lifeMs || 2000);
    });
    // Listen for Rogue Hacker ultimate: System Hack
    window.addEventListener('rogueHackUltimate', (e: Event) => {
      const d = (e as CustomEvent).detail as { x:number; y:number; radius:number; damage:number; paralyzeMs:number; glitchMs:number };
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      // Visual ping storage
      try { (window as any).__rogueHackFX = { x: d.x, y: d.y, start: now, duration: 480, radius: d.radius }; } catch {}
      // Apply to enemies in radius
      const r2 = d.radius * d.radius;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e1 = this.activeEnemies[i];
        if (!e1.active || e1.hp <= 0) continue;
        const dx = e1.x - d.x, dy = e1.y - d.y;
        if (dx*dx + dy*dy <= r2) {
          this.takeDamage(e1, d.damage, false, false, WeaponType.HACKER_VIRUS);
          const anyE: any = e1 as any;
          anyE._paralyzedUntil = Math.max(anyE._paralyzedUntil || 0, now + d.paralyzeMs);
          anyE._rgbGlitchUntil = now + Math.max(260, d.glitchMs|0);
          anyE._rgbGlitchPhase = ((anyE._rgbGlitchPhase || 0) + 2) % 7;
        }
      }
      // Apply to boss as well
      try {
        const bm: any = (window as any).__bossManager;
        const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const bdx = boss.x - d.x, bdy = boss.y - d.y;
          if (bdx*bdx + bdy*bdy <= r2) {
            this.takeBossDamage(boss, d.damage, false, d.x, d.y);
            const bAny: any = boss as any;
            bAny._paralyzedUntil = Math.max(bAny._paralyzedUntil || 0, now + d.paralyzeMs);
            bAny._rgbGlitchUntil = now + Math.max(260, d.glitchMs|0);
            bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 2) % 7;
          }
        }
      } catch { /* ignore */ }
    });
    if (this.usePreRenderedSprites) this.preRenderEnemySprites();
  // Attempt to load shared enemy image and build size variants
  this.loadSharedEnemyImage();
  }
  /** Plant a Data Sigil at position with radius and a limited number of pulses. */
  private plantDataSigil(x:number, y:number, radius:number, pulseCount:number, pulseDamage:number, follow:boolean=false){
    let sig = this.dataSigils.find(s => !s.active);
    const now = performance.now();
    if (!sig) {
      sig = { x, y, radius, pulsesLeft: pulseCount, pulseDamage, nextPulseAt: now + 220, active: true, spin: Math.random()*Math.PI*2, created: now, follow };
      this.dataSigils.push(sig);
    } else {
      sig.x = x; sig.y = y; sig.radius = radius; sig.pulsesLeft = pulseCount; sig.pulseDamage = pulseDamage; sig.nextPulseAt = now + 220; sig.active = true; sig.spin = Math.random()*Math.PI*2; sig.created = now; sig.follow = follow;
    }
  // Golden spark burst on plant
  try { this.particleManager?.spawn(x, y, 12, '#FFD700', { sizeMin: 1, sizeMax: 3, lifeMs: 420, speedMin: 1.2, speedMax: 3.2 }); } catch {}
  }

  /** Update Data Sigils: emit pulses on cadence and apply AoE damage. */
  private updateDataSigils(deltaMs:number){
    const now = performance.now();
    for (let i=0;i<this.dataSigils.length;i++){
      const s = this.dataSigils[i];
      if (!s.active) continue;
  s.spin += deltaMs * 0.006; // slow rotation
  if (s.follow) { s.x = this.player.x; s.y = this.player.y; }
      if (now >= s.nextPulseAt && s.pulsesLeft > 0){
        s.pulsesLeft--;
        s.nextPulseAt = now + 420; // pulse cadence
        // Apply AoE damage to enemies inside radius
        const r2 = s.radius * s.radius;
    for (let j=0;j<this.enemies.length;j++){
          const e = this.enemies[j];
          if (!e.active || e.hp <= 0) continue;
          const dx = e.x - s.x; const dy = e.y - s.y; if (dx*dx + dy*dy <= r2){
  const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      this.takeDamage(e, s.pulseDamage * gdm, false, false, WeaponType.DATA_SIGIL);
            // Brief magenta flash/shake for impact
            const anyE:any = e as any; anyE._poisonFlashUntil = now + 80; // reuse green flash channel but we’ll tint magenta in draw
            anyE._shakeAmp = Math.max(anyE._shakeAmp||0, 1.2); anyE._shakeUntil = now + 90; if (!anyE._shakePhase) anyE._shakePhase = Math.random()*10;
          }
        }
  // Emit golden sparks on pulse
  try { this.particleManager?.spawn(s.x, s.y, 10, '#FFE066', { sizeMin: 1, sizeMax: 2.5, lifeMs: 360, speedMin: 1.2, speedMax: 2.6 }); } catch {}
      }
      if (s.pulsesLeft <= 0 && now > s.nextPulseAt + 200){ s.active = false; }
    }
  }

  /** Spawn a Rogue Hacker zone at x,y with radius; lasts lifeMs. */
  private spawnHackerZone(x:number, y:number, radius:number, lifeMs:number){
    // Reuse inactive or push new
    let z = this.hackerZones.find(z=>!z.active);
    const now = performance.now();
    if (!z){
      z = { x, y, radius, created: now, lifeMs, active: true, hit: new Set<string>(), pulseUntil: now + 220, seed: Math.floor(now % 100000) };
      this.hackerZones.push(z);
    } else {
      z.x = x; z.y = y; z.radius = radius; z.created = now; z.lifeMs = lifeMs; z.active = true; z.hit.clear(); z.pulseUntil = now + 220; z.seed = Math.floor(now % 100000);
    }
  }

  /** Returns true if any Rogue Hacker zone is currently active. */
  private hasActiveHackerZone(): boolean {
    for (let i = 0; i < this.hackerZones.length; i++) {
      if (this.hackerZones[i].active) return true;
    }
    return false;
  }

  /** Compute effective movement speed considering temporary status effects. */
  private getEffectiveEnemySpeed(e: Enemy, baseSpeed: number): number {
    let slow = 0;
    // Poison slow (existing)
    const eAny: any = e as any;
  // Rogue Hacker paralysis: hard stop while active
  const nowPar = performance.now();
  if (eAny._paralyzedUntil && eAny._paralyzedUntil > nowPar) return 0;
    if (eAny._poisonStacks) slow = Math.max(slow, Math.min(this.poisonSlowCap, (eAny._poisonStacks | 0) * this.poisonSlowPerStack));
    // Psionic mark slow: flat 25% while active
  const now = performance.now();
  if (eAny._psionicMarkUntil && eAny._psionicMarkUntil > now) slow = Math.max(slow, 0.25);
    // Weaver Lattice slow: 70% slow to all enemies currently within lattice radius around player
    try {
      const until = (window as any).__weaverLatticeActiveUntil || 0;
      if (until > now) {
        const dx = e.x - this.player.x; const dy = e.y - this.player.y;
        const r = 320; // match draw/update radius
        if (dx*dx + dy*dy <= r*r) slow = Math.max(slow, 0.70);
      }
    } catch {}
    return baseSpeed * (1 - slow);
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

    // Armor shred debuff reduces incoming damage slightly when active
    const anyE: any = enemy as any;
    if (anyE._armorShredExpire && performance.now() < anyE._armorShredExpire) {
      // Shred reduces effective armor, so damage increases; apply 12% bonus while active
      amount *= 1.12;
    }
    enemy.hp -= amount;
    // Side-effect: apply burn on Blaster direct damage (initial hit only, not DoT ticks)
  if (sourceWeaponType === WeaponType.LASER && amount > 0) {
      this.applyBurn(enemy, amount * 0.10); // store per-tick damage reference (10% bullet damage per tick)
    }
    if (sourceWeaponType !== undefined) {
      enemy._lastHitByWeapon = sourceWeaponType;
      // Apply extra poison stacks on Bio Toxin direct hits to bias damage into DoT
      if (sourceWeaponType === WeaponType.BIO_TOXIN && amount > 0) {
        this.applyPoison(enemy, 2);
      }
      // Apply armor shred on Scrap-Saw hits: short 0.6s window
      if (sourceWeaponType === WeaponType.SCRAP_SAW && amount > 0) {
        const now = performance.now();
        anyE._armorShredExpire = now + 600;
      }
      // --- Knockback logic ---
      /**
       * Compute knockback direction.
       * - For continuous BEAM: push strictly away from the player to avoid sideways slide while ticking.
       * - For all other sources: if impact coordinates are provided, use those (feels more physical);
       *   otherwise fall back to radial-from-player.
       */
      const spec = WEAPON_SPECS[sourceWeaponType];
      if (spec) {
        // Choose knockback origin per weapon type
        const isBeam = sourceWeaponType === WeaponType.BEAM;
        let sx: number; let sy: number;
        if (isBeam) {
          // Continuous beams originate at the player for stable, radial push
          sx = this.player.x; sy = this.player.y;
        } else if (typeof sourceX === 'number' && typeof sourceY === 'number') {
          // Use precise impact origin when available (projectile or melee contact point)
          sx = sourceX; sy = sourceY;
        } else {
          // Fallback to player position
          sx = this.player.x; sy = this.player.y;
        }
        // spec.knockback historically represented px per 60fps frame
        let perFrame = spec.knockback ?? this.knockbackMinPerFrame;
        if (!isBeam) {
          // Preserve legacy minimum and level scaling for impulse-based weapons
          if (perFrame < this.knockbackMinPerFrame) perFrame = this.knockbackMinPerFrame;
          if (weaponLevel && weaponLevel > 1) perFrame *= 1 + (weaponLevel - 1) * 0.25; // simple linear scaling
        } else {
          // Continuous beams: honor exact spec.knockback (can be near-zero) and do NOT scale by level
          if (perFrame < 0) perFrame = 0;
        }
        const baseForcePerSec = perFrame * 60; // convert to px/sec
        // Compute direction from chosen source point to enemy (push enemy away from source)
        let dx = enemy.x - sx;
        let dy = enemy.y - sy;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.0001) { dx = 1; dy = 0; dist = 1; }
        const invDist = 1 / dist;
        const nx = dx * invDist;
        const ny = dy * invDist;
        // Mass attenuation (bigger radius -> more mass -> less acceleration)
        const massScale = 24 / Math.max(8, enemy.radius);
        // Strongly dampen beams to avoid runaway stacking between frames
        const beamDampen = isBeam ? 0.12 : 0.3;
        let impulse = baseForcePerSec * massScale * beamDampen;
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
        // Timer extension: proportional bonus to initial impulse (capped)
        const bonus = Math.min(180, (impulse / 2200) * 90);
        enemy.knockbackTimer = Math.max(enemy.knockbackTimer ?? 0, this.knockbackBaseMs + bonus);
      }
    }
  // Dispatch damage event with enemy world coordinates so floating damage text appears above the enemy
  window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount, isCritical, x: enemy.x, y: enemy.y } }));
  }

  /** Centralized boss damage application to unify DPS tracking and flash/particles. */
  public takeBossDamage(
    boss: any,
    amount: number,
    isCritical: boolean = false,
    sourceWeaponType?: WeaponType,
    sourceX?: number,
    sourceY?: number,
    weaponLevel?: number
  ): void {
    if (!boss || boss.hp <= 0 || boss.state !== 'ACTIVE') return;
    // Armor shred increases damage taken while active (mirror enemy logic)
    const bAny: any = boss as any;
    if (bAny._armorShredExpire && performance.now() < bAny._armorShredExpire) {
      amount *= 1.12;
    }
    boss.hp -= amount;
    boss._damageFlash = Math.max(10, (boss._damageFlash || 0));
    // Side-effects based on source weapon (limited for boss to avoid runaway)
    if (sourceWeaponType !== undefined) {
      bAny._lastHitByWeapon = sourceWeaponType;
      // Apply short shred on Scrap-Saw
      if (sourceWeaponType === WeaponType.SCRAP_SAW && amount > 0) {
        const now = performance.now();
        bAny._armorShredExpire = now + 600;
      }
      // Apply burn on Laser: cap stacks to 3, tick via boss burn ticker
      if (sourceWeaponType === WeaponType.LASER && amount > 0) {
        const perTick = amount * 0.10;
        this.applyBossBurn(boss, perTick);
      }
      // Apply poison stacks on Bio Toxin hit
      if (sourceWeaponType === WeaponType.BIO_TOXIN && amount > 0) {
        this.applyBossPoison(boss, 2);
      }
      // Rogue Hacker impacts schedule separate DoT elsewhere; mark glitch flash
      if (sourceWeaponType === WeaponType.HACKER_VIRUS && amount > 0) {
        const now = performance.now();
        bAny._rgbGlitchUntil = now + 260;
        bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 1) % 7;
      }
    }
    // Emit particle + DPS event
    try { this.particleManager?.spawn(boss.x, boss.y, 1, isCritical ? '#ffcccc' : '#ffd280'); } catch {}
    try { window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount, isCritical, x: boss.x, y: boss.y } })); } catch {}
  }

  /** Apply or refresh poison on boss (reduced slow cap same as enemies). */
  private applyBossPoison(boss: any, stacks: number = 1) {
    const now = performance.now();
    const b: any = boss as any;
    if (!b._poisonStacks) {
      b._poisonStacks = 0;
      b._poisonNextTick = now + this.poisonTickIntervalMs;
      b._poisonExpire = now + this.poisonDurationMs;
    }
    b._poisonStacks = Math.min(this.poisonMaxStacks, (b._poisonStacks || 0) + stacks);
    b._poisonExpire = now + this.poisonDurationMs;
  }

  /** Tick boss poison damage over time. */
  private updateBossPoisons(now: number, boss: any) {
    const b: any = boss as any;
    if (!b._poisonStacks) return;
    if (now >= b._poisonExpire) { b._poisonStacks = 0; return; }
    if (now >= b._poisonNextTick) {
      b._poisonNextTick += this.poisonTickIntervalMs;
      const stacks = b._poisonStacks | 0; if (stacks <= 0) return;
      // Scale like enemies: level + global damage multiplier
      let level = 1; try { level = this.player?.activeWeapons?.get(WeaponType.BIO_TOXIN) ?? 1; } catch {}
      const levelMul = 1 + Math.max(0, (level - 1)) * 0.35;
  const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const dps = this.poisonDpsPerStack * levelMul * dmgMul * stacks;
      const perTick = dps * (this.poisonTickIntervalMs / 1000);
      this.takeBossDamage(boss, perTick, false, WeaponType.BIO_TOXIN, boss.x, boss.y);
      // Visual: reuse green flash channel
      b._poisonFlashUntil = now + 120;
    }
  }

  /** Apply or refresh a burn stack on boss. */
  private applyBossBurn(boss: any, tickDamage: number) {
    const now = performance.now();
    const b: any = boss as any;
    if (!b._burnStacks) {
      b._burnStacks = 0;
      b._burnTickDamage = 0;
      b._burnNextTick = now + this.burnTickIntervalMs;
      b._burnExpire = now + this.burnDurationMs;
    }
    if (b._burnStacks < 3) b._burnStacks++;
    b._burnTickDamage = (b._burnTickDamage || 0) + tickDamage;
    b._burnExpire = now + this.burnDurationMs;
  }

  /** Tick boss burn DoT. */
  private updateBossBurn(now: number, boss: any) {
    const b: any = boss as any;
    if (!b._burnStacks) return;
    if (now >= b._burnExpire) { b._burnStacks = 0; b._burnTickDamage = 0; return; }
    if (now >= b._burnNextTick) {
      b._burnNextTick += this.burnTickIntervalMs;
      if (b._burnTickDamage > 0) {
        this.takeBossDamage(boss, b._burnTickDamage, false, WeaponType.LASER, boss.x, boss.y);
      }
    }
  }

  /** Apply or refresh poison on an enemy, increasing stacks up to cap and refreshing expiration. */
  private applyPoison(enemy: Enemy, stacks: number = 1) {
    if (!enemy.active || enemy.hp <= 0 || stacks <= 0) return;
    const now = performance.now();
    const e: any = enemy as any;
    if (!e._poisonStacks) {
      e._poisonStacks = 0;
      e._poisonNextTick = now + this.poisonTickIntervalMs;
      e._poisonExpire = now + this.poisonDurationMs;
    }
    e._poisonStacks = Math.min(this.poisonMaxStacks, (e._poisonStacks || 0) + stacks);
    e._poisonExpire = now + this.poisonDurationMs; // refresh duration on application
  }

  /** Update poison damage and manage expiration; also applies movement slow via effective speed scale during update loop. */
  private updatePoisons() {
    const now = performance.now();
    for (let i = 0; i < this.activeEnemies.length; i++) {
      const e: any = this.activeEnemies[i];
      if (!e._poisonStacks) continue;
      if (!e.active || e.hp <= 0) { e._poisonStacks = 0; continue; }
      if (now >= e._poisonExpire) { e._poisonStacks = 0; continue; }
    if (now >= e._poisonNextTick) {
        e._poisonNextTick += this.poisonTickIntervalMs;
        const stacks = e._poisonStacks | 0;
        if (stacks > 0) {
      // Convert per-second DPS into per-tick damage.
      // Scale Bio Toxin DoT with weapon level and global damage multiplier so DoT is the primary scaler.
      const perStackBase = this.poisonDpsPerStack;
      let level = 1;
      try { level = this.player?.activeWeapons?.get(WeaponType.BIO_TOXIN) ?? 1; } catch {}
      const levelMul = 1 + Math.max(0, (level - 1)) * 0.35; // +35% per level after L1 (L7 ~ 3.1x)
  const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const dps = perStackBase * levelMul * dmgMul * stacks;
          const perTick = dps * (this.poisonTickIntervalMs / 1000);
          this.takeDamage(e as Enemy, perTick, false, false, WeaponType.BIO_TOXIN);
          // Visual feedback: brief green flash + micro-shake
          e._poisonFlashUntil = now + 120;
          if (!e._shakePhase) e._shakePhase = Math.random() * 10;
          e._shakeAmp = Math.min(2.2, 0.12 * stacks + 0.6);
          e._shakeUntil = now + 120;
        }
      }
    }
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

  public spawnPoisonPuddle(x: number, y: number, radius: number = 32, lifeMs: number = 3000) {
    let puddle = this.poisonPuddles.find(p => !p.active);
  if (!puddle) {
    puddle = { x, y, radius: radius, life: lifeMs, maxLife: lifeMs, active: true };
      this.poisonPuddles.push(puddle);
    } else {
      puddle.x = x;
      puddle.y = y;
      puddle.radius = radius;
    puddle.life = lifeMs;
    puddle.maxLife = lifeMs;
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
      // Emphasize stacking over flat damage: no direct damage, apply stacks
      this.applyPoison(enemy, 1);
          didDamage = true; // Still track if damage was dealt for visual feedback
        }
      }
      // Visual feedback if puddle is damaging
      if (didDamage && this.particleManager) {
        this.particleManager.spawn(puddle.x, puddle.y, 1, '#00FF00');
      }
    }
  }

  /** Returns walk flip interval in ms based on enemy speed (0.3–0.5s). Faster enemies flip more often. */
  private getWalkInterval(speed: number): number {
    // Normalize speed roughly in [0, 6] and map to interval [300, 500] ms
    const s = Math.max(0, Math.min(6, speed || 0));
    const t = s / 6; // 0..1
    const minMs = 300, maxMs = 500;
    return Math.round(maxMs - (maxMs - minMs) * t);
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
  const now = performance.now();
  // Psionic Weaver Lattice: draw a large pulsing slow zone around the player while active (behind enemies)
  try {
    const until = (window as any).__weaverLatticeActiveUntil || 0;
    if (until > now) {
      const px = this.player.x, py = this.player.y;
      // Cull if fully off-screen
      if (!(px < minX - 400 || px > maxX + 400 || py < minY - 400 || py > maxY + 400)) {
        const baseR = 320;
        const pulse = 1 + Math.sin(now * 0.008) * 0.05; // subtle 5% radius pulse
        const r = baseR * pulse;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        // Outer glow ring
        ctx.globalAlpha = 0.20;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#cc66ff';
        ctx.lineWidth = 6;
        ctx.shadowColor = '#cc66ff';
        ctx.shadowBlur = 28;
        ctx.stroke();
        // Inner faint fill for presence
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.96, 0, Math.PI * 2);
        ctx.fillStyle = '#8a2be2';
        ctx.shadowColor = '#8a2be2';
        ctx.shadowBlur = 16;
        ctx.fill();
        ctx.restore();
      }
    }
  } catch { /* ignore */ }
  // Draw Data Sigils below enemies (golden, glitchy magical)
  for (let i=0;i<this.dataSigils.length;i++){
    const s = this.dataSigils[i]; if (!s.active) continue;
    if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;
    ctx.save();
    const t = (performance.now() - s.created) / 1000;
    // Base golden rings with slight RGB offset for glitch shimmer
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.22;
    ctx.beginPath(); ctx.arc(s.x-1, s.y, s.radius, 0, Math.PI*2); ctx.strokeStyle = '#FFD280'; ctx.lineWidth = 2.5; ctx.shadowColor = '#FFD280'; ctx.shadowBlur = 10; ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.arc(s.x+1, s.y, s.radius*0.985, 0, Math.PI*2); ctx.strokeStyle = '#FFF2A8'; ctx.lineWidth = 2; ctx.shadowColor = '#FFF2A8'; ctx.shadowBlur = 8; ctx.stroke();
    ctx.globalAlpha = 0.14;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius*1.02, 0, Math.PI*2); ctx.strokeStyle = '#FFC94D'; ctx.lineWidth = 1.5; ctx.stroke();
    // Rotating glyph spokes (golden)
    ctx.globalAlpha = 0.36;
    const spokes = 6; const len = s.radius * 0.9;
    for (let k=0;k<spokes;k++){
      const ang = s.spin + (Math.PI*2*k/spokes);
      ctx.beginPath();
      ctx.moveTo(s.x + Math.cos(ang)* (s.radius*0.2), s.y + Math.sin(ang)*(s.radius*0.2));
      ctx.lineTo(s.x + Math.cos(ang)* len, s.y + Math.sin(ang)* len);
      ctx.strokeStyle = '#FFE066'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    // Pulse wave (brief expanding golden ring)
    const phase = Math.max(0, 1 - (s.nextPulseAt - performance.now())/420);
    ctx.globalAlpha = 0.28 * phase;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius*phase, 0, Math.PI*2); ctx.strokeStyle = '#FFEFA8'; ctx.lineWidth = 3; ctx.shadowColor = '#FFEFA8'; ctx.shadowBlur = 14; ctx.stroke();
    // Tiny sparkle crosses orbiting (non-expensive: 4 marks)
    ctx.globalAlpha = 0.32;
    const marks = 4;
    for (let m=0;m<marks;m++){
      const ang = s.spin*1.7 + m * (Math.PI*2/marks);
      const rad = s.radius * (0.35 + 0.5 * ((m%2)?1:0.85));
      const mx = s.x + Math.cos(ang)*rad;
      const my = s.y + Math.sin(ang)*rad;
      ctx.strokeStyle = '#FFF8C9'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(mx-3, my); ctx.lineTo(mx+3, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my-3); ctx.lineTo(mx, my+3); ctx.stroke();
    }
    ctx.restore();
  }
  // Draw Rogue Hacker zones (techno ring under enemies) — boosted visibility
  for (let i=0;i<this.hackerZones.length;i++){
    const z = this.hackerZones[i];
    if (!z.active) continue;
    const age = now - z.created;
    if (age > z.lifeMs) continue; // will be culled in update
    if (z.x < minX || z.x > maxX || z.y < minY || z.y > maxY) continue;
    const t = age / z.lifeMs;
    const pulse = 1 + Math.sin(now * 0.02 + i) * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    // Stronger ring and subtle fill so it stands out on bright backgrounds
    ctx.globalAlpha = 0.28 * (1 - t);
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFA500'; // orange virus ring
    ctx.lineWidth = 4;
    ctx.shadowColor = '#FFA500';
    ctx.shadowBlur = 16;
    ctx.stroke();
    // RGB glitch ring: slight channel offsets for brain‑fry vibe
    ctx.globalAlpha = 0.22 * (1 - t);
    const r = z.radius * (0.92 + 0.06 * Math.sin(now * 0.025 + i));
    ctx.lineWidth = 1.6;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(z.x - 1, z.y, r, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#2aff2a'; ctx.beginPath(); ctx.arc(z.x, z.y, r*0.985, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#2a66ff'; ctx.beginPath(); ctx.arc(z.x + 1, z.y, r, 0, Math.PI*2); ctx.stroke();
    // faint fill
    ctx.globalAlpha = 0.12 * (1 - t);
    ctx.beginPath(); ctx.arc(z.x, z.y, z.radius * 0.92, 0, Math.PI*2);
    ctx.fillStyle = '#FF7700';
    ctx.fill();
    // Hacker code glyphs + command text
    ctx.globalAlpha = 0.22 * (1 - t);
    const seed = (z.seed || 0);
    const glyphs = 12;
    const cmds = [
      'nmap -sV',
      'ssh -p 2222',
      'sqlmap --dump',
      'hydra -l admin',
      'curl -k -X POST',
      'nc -lvvp 4444',
      'base64 -d',
      'openssl rsautl',
      'grep -R \'token\'',
      'iptables -F'
    ];
    ctx.font = '10px monospace';
    for (let g=0; g<glyphs; g++){
      const ang = (now * 0.0012) + ((seed + g*53) % 628) * 0.01;
      const rad = z.radius * (0.28 + ((seed>> (g%7)) & 1) * 0.52);
      const gx = z.x + Math.cos(ang) * rad;
      const gy = z.y + Math.sin(ang) * rad;
      const text = cmds[(seed + g) % cmds.length];
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(ang + Math.PI/2);
      // Neon glow text
      ctx.shadowColor = '#FFD280';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#FFE6AA';
      ctx.fillText(text, -text.length*3, 0);
      ctx.restore();
    }
    // Spawn pulse: brief expanding bright ring + hack-link line from player
    if ((z.pulseUntil || 0) > now) {
      const left = Math.max(0, Math.min(1, (z.pulseUntil! - now) / 220));
      const r = z.radius * (1.0 + (1 - left) * 0.35);
      ctx.globalAlpha = 0.40 * left;
      ctx.beginPath();
      ctx.arc(z.x, z.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#FFD280';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#FFD280';
      ctx.shadowBlur = 10;
      ctx.stroke();
      // Hack-link line (very brief)
      ctx.globalAlpha = 0.18 * left;
      ctx.beginPath();
      ctx.moveTo(this.player.x, this.player.y);
      ctx.lineTo(z.x, z.y);
      ctx.strokeStyle = '#FFA500';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 6;
      ctx.stroke();
    }
    // Circuit spokes (low-cost): 6 short lines rotating slowly
    ctx.globalAlpha = 0.18 * (1 - t);
    const spokes = 6; const inner = z.radius * 0.25; const outer = z.radius * 0.85;
    for (let k=0;k<spokes;k++){
      const ang = (now * 0.002) + (Math.PI * 2 * k / spokes) + i * 0.37;
      ctx.beginPath();
      ctx.moveTo(z.x + Math.cos(ang) * inner, z.y + Math.sin(ang) * inner);
      ctx.lineTo(z.x + Math.cos(ang) * outer, z.y + Math.sin(ang) * outer);
      ctx.strokeStyle = '#FFAA55';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }
  // Rogue Hacker ultimate VFX (global): brief expanding RGB EMP ring + code burst
  try {
    const fx = (window as any).__rogueHackFX;
    if (fx) {
      const now = performance.now();
      const t = Math.min(1, Math.max(0, (now - fx.start) / fx.duration));
      const r = fx.radius * (0.8 + 0.6 * t);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      // Outer RGB split rings
      ctx.globalAlpha = 0.45 * (1 - t);
      ctx.lineWidth = 6;
      ctx.strokeStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(fx.x - 2, fx.y, r, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = '#2aff2a'; ctx.beginPath(); ctx.arc(fx.x, fx.y, r*0.985, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = '#2a66ff'; ctx.beginPath(); ctx.arc(fx.x + 2, fx.y, r, 0, Math.PI*2); ctx.stroke();
      // Inner glow disk
      const grad = ctx.createRadialGradient(fx.x, fx.y, Math.max(6, r*0.2), fx.x, fx.y, r);
      grad.addColorStop(0, 'rgba(255,200,120,0.35)');
      grad.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.globalAlpha = 0.35 * (1 - t);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI*2); ctx.fill();
      // Code burst spokes
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.font = 'bold 12px monospace';
      const cmds = ['nmap -sS','ssh -p 22','sqlmap','hydra','curl -X POST','nc -lvvp','base64 -d','openssl rsautl','grep token','iptables -F'];
      for (let k=0;k<14;k++){
        const ang = (now*0.006) + (Math.PI*2*k/14);
        const tx = fx.x + Math.cos(ang) * (r*0.7);
        const ty = fx.y + Math.sin(ang) * (r*0.7);
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang);
        ctx.shadowColor = '#FFD280'; ctx.shadowBlur = 12; ctx.fillStyle = '#FFE6AA';
        const text = cmds[k % cmds.length];
        ctx.fillText(text, -ctx.measureText(text).width/2, 0);
        ctx.restore();
      }
      ctx.restore();
      if (t >= 1) { (window as any).__rogueHackFX = undefined; }
    }
  } catch {}
  // Draw enemies (cached sprite images if enabled)
    if (this.usePreRenderedSprites) {
  for (let i = 0, len = this.activeEnemies.length; i < len; i++) {
        const enemy = this.activeEnemies[i];
    if (enemy.x < minX || enemy.x > maxX || enemy.y < minY || enemy.y > maxY) continue; // cull offscreen
        // Small shake offset if flagged
        const eAny: any = enemy as any;
        let shakeX = 0, shakeY = 0;
        if (eAny._shakeUntil && now < eAny._shakeUntil) {
          const amp = eAny._shakeAmp || 0.8;
          const phase = eAny._shakePhase || 0;
          const t = now * 0.03 + phase;
          shakeX = Math.sin(t) * amp;
          shakeY = Math.cos(t * 1.3) * (amp * 0.6);
        }
    const bundle = this.enemySprites[enemy.type];
    if (!bundle) continue;
  // Movement-based facing + walk-cycle flip: compose both for visible stepping
  const faceLeft = (eAny._facingX ?? ((this.player.x < enemy.x) ? -1 : 1)) < 0;
  const walkFlip = !!eAny._walkFlip;
  const flipLeft = ((faceLeft ? -1 : 1) * (walkFlip ? -1 : 1)) < 0;
  const baseImg = flipLeft ? (bundle.normalFlipped || bundle.normal) : bundle.normal;
  const size = baseImg.width;
  // Tiny per-phase offsets make walking visible even for symmetric sprites
  const stepOffsetX = (walkFlip ? -1 : 1) * Math.min(1.5, enemy.radius * 0.06);
  const stepOffsetY = (walkFlip ? -0.5 : 0.5);
  const drawX = enemy.x + shakeX + stepOffsetX - size/2;
  const drawY = enemy.y + shakeY + stepOffsetY - size/2;
  ctx.drawImage(baseImg, drawX, drawY, size, size);
        // Paralyzed indicator (Rogue Hacker): small "X" above enemy while paralysis is active
        {
          const anyE: any = enemy as any;
          const until = anyE._paralyzedUntil || 0;
          if (until > now) {
            const tLeft = Math.max(0, Math.min(1, (until - now) / 1500));
            const hx = enemy.x; const hy = enemy.y - enemy.radius - 8;
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = 0.65 + 0.25 * tLeft; // fade slightly as it ends
            ctx.strokeStyle = '#FFA500';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(hx - 6, hy - 4); ctx.lineTo(hx + 6, hy + 4);
            ctx.moveTo(hx + 6, hy - 4); ctx.lineTo(hx - 6, hy + 4);
            ctx.stroke();
            ctx.restore();
          }
        }
        // Void Sniper stacks indicator: dark purple glowing particles above target while DoT is active
        {
          const anyE: any = enemy as any;
          const vdot = anyE._voidSniperDot as { next: number; left: number; dmg: number; stacks?: number } | undefined;
          if (vdot && vdot.left > 0 && this.particleManager) {
            const stackCount = Math.max(1, Math.min(6, vdot.stacks || 1));
            // Emit a small cluster of purple orbs above the enemy, rate scales slightly with stacks
            const emit = 0.15 * stackCount; // particles per frame approx
            // Use a fractional accumulator on enemy to spread over time
            anyE._voidStackEmitAcc = (anyE._voidStackEmitAcc || 0) + emit;
            if (anyE._voidStackEmitAcc >= 1) {
              const toSpawn = Math.min(4, Math.floor(anyE._voidStackEmitAcc));
              anyE._voidStackEmitAcc -= toSpawn;
              for (let k = 0; k < toSpawn; k++) {
                const offY = enemy.radius + 10 + Math.random() * 6;
                const offX = (Math.random() - 0.5) * (enemy.radius * 0.8);
                const px = enemy.x + offX;
                const py = enemy.y - offY;
                this.particleManager.spawn(px, py, 1, '#7A2CFF', { sizeMin: 0.8, sizeMax: 1.6, lifeMs: 36 + Math.random() * 20, speedMin: 0.2, speedMax: 0.6 });
              }
            }
          }
        }
        // RGB glitch effect: intensified visibility with stronger ghosts, more slices, and brief jitter
        if ((eAny._rgbGlitchUntil || 0) > now) {
          const tLeft = Math.max(0, Math.min(1, (eAny._rgbGlitchUntil - now) / 220));
          const phase = (eAny._rgbGlitchPhase || 0);
          ctx.save();
          // Slight positional jitter during glitch window
          const jx = ((phase * 31) % 3) - 1; // -1..+1
          const jy = (((phase * 47) >> 1) % 3) - 1; // -1..+1
          // Color-bleed ghost copies with stronger offsets
          const ghostOffset = 2 + Math.round(6 * tLeft); // up to ~8 px
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.35 + 0.35 * tLeft;
          // Red-ish ghost (left)
          try { ctx.filter = 'hue-rotate(330deg) saturate(2.0) brightness(1.2)'; } catch {}
          ctx.drawImage(baseImg, drawX - ghostOffset + jx, drawY + jy, size, size);
          // Blue-ish ghost (right)
          try { ctx.filter = 'hue-rotate(210deg) saturate(2.0) brightness(1.2)'; } catch {}
          ctx.drawImage(baseImg, drawX + ghostOffset + jx, drawY + jy, size, size);
          // Green-ish mid ghost (optional center)
          try { ctx.filter = 'hue-rotate(120deg) saturate(1.8) brightness(1.15)'; } catch {}
          ctx.globalAlpha = 0.22 + 0.28 * tLeft;
          ctx.drawImage(baseImg, drawX + Math.sign(ghostOffset), drawY, size, size);
          // Reset filter
          try { ctx.filter = 'none'; } catch {}
          // Slice glitch: increased slices and stronger horizontal offsets
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          const sliceCount = 6 + (phase % 5); // 6..10 slices
          for (let s = 0; s < sliceCount; s++) {
            const rng = ((phase * 73856093) ^ (s * 19349663)) >>> 0;
            const sy = (rng % (size - 8));
            const sh = 4 + (rng % Math.min(22, size - sy));
            const baseOff = ((rng >> 5) % 25) - 12; // -12..+12 px
            const off = Math.max(-16, Math.min(16, Math.round(baseOff * (0.8 + 0.8 * tLeft))));
            const h = Math.min(sh, size - sy);
            try {
              ctx.drawImage(baseImg, 0, sy, size, h, drawX + off, drawY + sy, size, h);
            } catch {}
          }
          // Enhanced scanlines/tearing
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.18 + 0.22 * tLeft;
          ctx.strokeStyle = '#66ccff';
          ctx.lineWidth = 1;
          const lines = 3 + (phase % 4);
          for (let li = 0; li < lines; li++) {
            const y = drawY + ((phase * 13 + li * 11) % (size - 2)) + 1;
            ctx.beginPath(); ctx.moveTo(drawX, y); ctx.lineTo(drawX + size, y); ctx.stroke();
          }
          ctx.restore();
        }
        // Psionic mark aura (visible slow indicator)
        if ((eAny._psionicMarkUntil || 0) > now) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.35;
          ctx.shadowColor = '#cc66ff';
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(enemy.x + shakeX, enemy.y + shakeY, enemy.radius * 1.25, 0, Math.PI*2);
          ctx.strokeStyle = '#cc66ff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        // Status flash overlay: poison (green), sigil (magenta), or void sniper tick (unique dark void purple)
  if (eAny._poisonFlashUntil && now < eAny._poisonFlashUntil && !(eAny._rgbGlitchUntil && eAny._rgbGlitchUntil > now)) {
          const lastHit = (enemy as any)._lastHitByWeapon;
          // Compute short-lived intensity 0..1
          const flashLeft = Math.max(0, Math.min(1, (eAny._poisonFlashUntil - now) / 140));
          if (lastHit === WeaponType.VOID_SNIPER) {
            // Unique VOID tick: deep purple radial bloom + slender neon ring
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const cx = enemy.x + shakeX, cy = enemy.y + shakeY;
            const rOuter = enemy.radius * 1.18;
            const grad = ctx.createRadialGradient(cx, cy, Math.max(1, rOuter * 0.12), cx, cy, rOuter);
            grad.addColorStop(0, `rgba(26,0,42,${0.55 * flashLeft})`);     // very dark void core
            grad.addColorStop(0.55, `rgba(106,13,173,${0.22 * flashLeft})`); // royal purple mid
            grad.addColorStop(1, 'rgba(178,102,255,0)');                      // fade to transparent
            ctx.globalAlpha = 1; // alpha encoded in gradient stops
            ctx.fillStyle = grad;
            ctx.shadowColor = '#B266FF';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
            ctx.fill();
            // Neon ring accent
            ctx.globalAlpha = 0.32 * flashLeft;
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#6A0DAD';
            ctx.shadowColor = '#B266FF';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(cx, cy, enemy.radius * 1.28, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          } else {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.22;
            ctx.beginPath();
            ctx.arc(enemy.x + shakeX, enemy.y + shakeY, enemy.radius * 1.05, 0, Math.PI * 2);
            // If last hit was from Data Sigil use golden; Psionic Wave remains magenta; else green for poison
            const tint = (lastHit === WeaponType.DATA_SIGIL) ? '#FFD700' : (lastHit === WeaponType.PSIONIC_WAVE ? '#FF00FF' : '#00FF00');
            ctx.fillStyle = tint;
            ctx.shadowColor = tint;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();
          }
        }
        // HP bar (only if damaged and alive)
        if (enemy.hp < enemy.maxHp && enemy.hp > 0) {
          const hpBarWidth = enemy.radius * 2;
          const hpBarHeight = 4;
          const hpBarX = enemy.x + shakeX - enemy.radius;
          const hpBarY = enemy.y + shakeY - enemy.radius - 8;
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
        const eAny: any = enemy as any;
        let shakeX = 0, shakeY = 0;
        if (eAny._shakeUntil && now < eAny._shakeUntil) {
          const amp = eAny._shakeAmp || 0.8;
          const phase = eAny._shakePhase || 0;
          const t = now * 0.03 + phase;
          shakeX = Math.sin(t) * amp;
          shakeY = Math.cos(t * 1.3) * (amp * 0.6);
        }
  ctx.beginPath();
  ctx.arc(enemy.x + shakeX, enemy.y + shakeY, enemy.radius, 0, Math.PI * 2);
        ctx.fillStyle = enemy.hp > 0 ? '#f00' : '#222';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.closePath();
        // Status flash overlay: poison (green), sigil (magenta), void sniper (void purple)
  if (eAny._poisonFlashUntil && now < eAny._poisonFlashUntil && !(eAny._rgbGlitchUntil && eAny._rgbGlitchUntil > now)) {
          const lastHit = (enemy as any)._lastHitByWeapon;
          const flashLeft = Math.max(0, Math.min(1, (eAny._poisonFlashUntil - now) / 140));
          if (lastHit === WeaponType.VOID_SNIPER) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const cx = enemy.x + shakeX, cy = enemy.y + shakeY;
            const rOuter = enemy.radius * 1.18;
            const grad = ctx.createRadialGradient(cx, cy, Math.max(1, rOuter * 0.12), cx, cy, rOuter);
            grad.addColorStop(0, `rgba(26,0,42,${0.55 * flashLeft})`);
            grad.addColorStop(0.55, `rgba(106,13,173,${0.22 * flashLeft})`);
            grad.addColorStop(1, 'rgba(178,102,255,0)');
            ctx.globalAlpha = 1;
            ctx.fillStyle = grad;
            ctx.shadowColor = '#B266FF';
            ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(cx, cy, rOuter, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = 0.32 * flashLeft;
            ctx.lineWidth = 2; ctx.strokeStyle = '#6A0DAD';
            ctx.shadowColor = '#B266FF'; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(cx, cy, enemy.radius * 1.28, 0, Math.PI*2); ctx.stroke();
            ctx.restore();
          } else {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.22;
            ctx.beginPath();
            ctx.arc(enemy.x + shakeX, enemy.y + shakeY, enemy.radius * 1.05, 0, Math.PI * 2);
            const tint = (lastHit === WeaponType.DATA_SIGIL) ? '#FFD700' : (lastHit === WeaponType.PSIONIC_WAVE ? '#FF00FF' : '#00FF00');
            ctx.fillStyle = tint;
            ctx.shadowColor = tint;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
    /**
     * Draws a fast 5-pointed star at (x, y) with given radius and color.
     * @param ctx CanvasRenderingContext2D
     * @param x Center X
     * @param y Center Y
     * @param r Outer radius
     * @param color Fill color
     */
    function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
      ctx.save();
      ctx.beginPath();
      const spikes = 5, step = Math.PI / spikes;
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const angle = i * step - Math.PI / 2;
        ctx.lineTo(x + Math.cos(angle) * rad, y + Math.sin(angle) * rad);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();
    }
    for (let i = 0, len = this.gems.length; i < len; i++) {
      const gem = this.gems[i];
      if (!gem.active) continue;
      if (gem.x < minX || gem.x > maxX || gem.y < minY || gem.y > maxY) continue;
      drawStar(ctx, gem.x, gem.y, gem.size, gem.color);
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
  const nowFrame = performance.now(); // cache once per frame
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

    // Rogue Hacker: auto-cast a paralysis/DoT zone every 1.5s, but only one active zone at a time.
    try {
      const isHacker = (this.player as any)?.characterData?.id === 'rogue_hacker';
      if (isHacker) {
        const cooldownReady = nowFrame >= this.hackerAutoCooldownUntil;
        const anyActive = this.hasActiveHackerZone();
        if (cooldownReady && !anyActive) {
          // Choose a target: nearest active enemy; fallback to a point ahead of player; clamp to 600px
          let tx = this.player.x, ty = this.player.y;
          let bestD2 = Number.POSITIVE_INFINITY;
          for (let i = 0; i < this.enemies.length; i++) {
            const e = this.enemies[i];
            if (!e.active || e.hp <= 0) continue;
            const dx = e.x - this.player.x; const dy = e.y - this.player.y;
            const d2 = dx*dx + dy*dy;
            if (d2 < bestD2) { bestD2 = d2; tx = e.x; ty = e.y; }
          }
          // Enforce 600px max cast distance; only cast if a target exists within range
          const maxRange = 600;
          if (bestD2 <= maxRange * maxRange) {
            // Spawn exactly one zone; lifetime 2s (existing behavior)
            this.spawnHackerZone(tx, ty, 120, 2000);
            // Set next eligible time 1.5s later; next will only trigger once current expires
            this.hackerAutoCooldownUntil = nowFrame + 1500;
          }
        }
      }
    } catch { /* ignore */ }

  // Update enemies
    // Determine chase target. During Ghost cloak, enemies follow the snapshot at cloak start.
    let playerX = this.player.x;
    let playerY = this.player.y;
    if (this._ghostCloakFollow.active) {
      const nowT = performance.now();
      if (nowT <= this._ghostCloakFollow.until) {
        playerX = this._ghostCloakFollow.x;
        playerY = this._ghostCloakFollow.y;
      } else {
        // Safety: auto-clear if time elapsed without explicit end event
        this._ghostCloakFollow.active = false;
      }
    }
  // Psionic Weaver Lattice: compute slow zone radius if active
  const nowMs = nowFrame;
  const latticeUntil = (window as any).__weaverLatticeActiveUntil || 0;
  const latticeActive = latticeUntil > nowMs;
  const latticeR = latticeActive ? 320 : 0;
  const latticeR2 = latticeR * latticeR;
  // Lattice periodic damage: every 0.5s, deal 50% of Psionic Wave damage to enemies inside the zone
  if (latticeActive) {
    if (nowMs >= this.latticeNextTickMs) {
      // Determine current Psionic Wave level and base damage
      let lvl = 1;
      try {
        const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
        if (aw && typeof aw.get === 'function') {
          lvl = aw.get(WeaponType.PSIONIC_WAVE) || 1;
        }
      } catch {}
      const spec = WEAPON_SPECS[WeaponType.PSIONIC_WAVE];
      const baseDmg = (spec?.getLevelStats?.(lvl)?.damage as number) || spec?.damage || 0;
  const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const tickDamage = Math.max(1, Math.round(baseDmg * 0.50 * gdm));
      const px = this.player.x, py = this.player.y;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e.active || e.hp <= 0) continue;
        const dx = e.x - px; const dy = e.y - py;
        if (dx*dx + dy*dy <= latticeR2) {
          this.takeDamage(e, tickDamage);
          const eAny: any = e as any;
          eAny._poisonFlashUntil = nowMs + 120; // reuse flash channel for quick feedback
          (e as any)._lastHitByWeapon = WeaponType.PSIONIC_WAVE;
        }
      }
      this.latticeNextTickMs = nowMs + this.latticeTickIntervalMs;
    }
  } else {
    // Reset scheduler baseline so first tick fires promptly next activation
    this.latticeNextTickMs = nowMs + this.latticeTickIntervalMs;
  }
  // Rebuild active enemy cache while updating (single pass)
    this.activeEnemies.length = 0;
  // Hoist globals used inside the loop
  const rm = (window as any).__roomManager;
  const chaseCap = (this.player?.speed ?? 4) * this.enemyChaseCapRatio;
  // Update enemies
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
  // Note: Psionic slow marks are now applied only by direct PSIONIC_WAVE impacts (and their AoE)
  // to avoid perceived "random" slow auras on nearby enemies during lattice.
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
      // Rogue Hacker zones: apply one-time paralysis + schedule DoT on first contact per zone
      if (this.hackerZones.length) {
  const nowHz = nowFrame;
        for (let zi = 0; zi < this.hackerZones.length; zi++) {
          const z = this.hackerZones[zi];
          if (!z.active) continue;
          if (nowHz - z.created > z.lifeMs) continue; // expired; will be deactivated later
          if (z.hit.has(enemy.id)) continue;
          const dxz = enemy.x - z.x; const dyz = enemy.y - z.y;
          if (dxz*dxz + dyz*dyz <= (z.radius + enemy.radius) * (z.radius + enemy.radius)) {
            z.hit.add(enemy.id);
            const eAny: any = enemy as any;
            const until = nowHz + 1500; // 1.5s paralysis (fixed)
            eAny._paralyzedUntil = Math.max(eAny._paralyzedUntil || 0, until);
            // Scale DoT by HACKER_VIRUS level: nerfed at L1, ramps with level
            let lvl = 1;
            try {
              const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
              if (aw && typeof aw.get === 'function') {
                lvl = aw.get(WeaponType.HACKER_VIRUS) || 1;
              }
            } catch {}
            // 3 ticks over ~1.5s; per-tick scales with level (L1 total ≈51, L7 total ≈177), also with global damage
            const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
            const perTick = Math.max(8, Math.round((10 + lvl * 7) * gdm));
            eAny._hackerDot = { nextTick: nowHz + 500, ticksLeft: 3, perTick };
            // Trigger RGB glitch instead of green poison flash
            eAny._rgbGlitchUntil = nowHz + 260;
            eAny._rgbGlitchPhase = ((eAny._rgbGlitchPhase || 0) + 1) % 7;
            (enemy as any)._lastHitByWeapon = WeaponType.HACKER_VIRUS;
          }
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
        const stepX = knx * speed * dtSec;
        const stepY = kny * speed * dtSec;
        enemy.x += stepX;
        enemy.y += stepY;
  // Update facing from knockback horizontal motion
  const eAny: any = enemy as any;
        if (Math.abs(knx) > 0.0001) eAny._facingX = knx < 0 ? -1 : 1;
        // Walk cycle: toggle at interval while moving
        const mvMag = Math.hypot(stepX, stepY);
        if (mvMag > 0.01) {
          if (eAny._walkFlipIntervalMs == null) eAny._walkFlipIntervalMs = this.getWalkInterval(enemy.speed);
          eAny._walkFlipTimerMs = (eAny._walkFlipTimerMs || 0) + effectiveDelta;
          while (eAny._walkFlipTimerMs >= eAny._walkFlipIntervalMs) {
            eAny._walkFlip = !eAny._walkFlip;
            eAny._walkFlipTimerMs -= eAny._walkFlipIntervalMs;
          }
        }
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
        // Move toward player (with chase speed cap relative to player)
        if (dist > enemy.radius) { // Use radius to prevent jittering when close
          const inv = dist === 0 ? 0 : 1 / dist;
          const moveScale = (effectiveDelta / 16.6667); // scale like deltaFactor but using effective delta
          // Clamp chase speed to ~90% of player speed to reduce exponential-feel scaling
          const baseSpeed = enemy.speed > chaseCap ? chaseCap : enemy.speed;
          const effSpeed = this.getEffectiveEnemySpeed(enemy, baseSpeed);
          const mvx = dx * inv * effSpeed * moveScale;
          const mvy = dy * inv * effSpeed * moveScale;
          enemy.x += mvx;
          enemy.y += mvy;
          // Persist last horizontal movement direction for draw-time flip
          const eAny2: any = enemy as any;
          if (Math.abs(mvx) > 0.0001) eAny2._facingX = mvx < 0 ? -1 : 1;
          // Walk cycle: toggle based on speed-derived interval while moving
          const mvMag2 = Math.hypot(mvx, mvy);
          if (mvMag2 > 0.01) {
            if (eAny2._walkFlipIntervalMs == null) eAny2._walkFlipIntervalMs = this.getWalkInterval(enemy.speed);
            eAny2._walkFlipTimerMs = (eAny2._walkFlipTimerMs || 0) + effectiveDelta;
            while (eAny2._walkFlipTimerMs >= eAny2._walkFlipIntervalMs) {
              eAny2._walkFlip = !eAny2._walkFlip;
              eAny2._walkFlipTimerMs -= eAny2._walkFlipIntervalMs;
            }
          }
        }
      }
      // After position changes, clamp to walkable (prevents embedding in walls via knockback)
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
        // Poison contagion: on death with significant stacks, spread a portion to nearby enemies
        const eAny: any = enemy as any;
  const stacks = eAny._poisonStacks | 0;
  if (stacks >= 3) {
          const spreadRadius = 180;
          const addStacks = Math.min(5, Math.ceil(stacks * 0.5));
          for (let j = 0; j < this.enemies.length; j++) {
            const o = this.enemies[j];
            if (!o.active || o.hp <= 0 || o === enemy) continue;
            const dxs = o.x - enemy.x; const dys = o.y - enemy.y;
            if (dxs*dxs + dys*dys <= spreadRadius * spreadRadius) {
              this.applyPoison(o, addStacks);
            }
          }
        }
        // XP orb drop chance per enemy type (fewer total orbs to smooth pacing)
        let dropChance = 0.5;
        switch (enemy.type) {
          case 'small': dropChance = XP_DROP_CHANCE_SMALL; break;
          case 'medium': dropChance = XP_DROP_CHANCE_MEDIUM; break;
          case 'large': dropChance = XP_DROP_CHANCE_LARGE; break;
        }
        if (Math.random() < dropChance) {
          const baseTier = this.enemyXpBaseTier[enemy.type] || 1;
          // Gate high-tier upgrades: only elite ("large") enemies can reach tier 4; small/medium cap at tier 3
          const maxTier = (enemy.type === 'large') ? 4 : 3;
          this.spawnGem(enemy.x, enemy.y, baseTier, maxTier);
        }
  // Removed on-kill explosion effect for Mech Mortar (Titan Mech)
  this.killCount++;
        // Scavenger scrap stacks: increment when kill happened and last hit was Scrap-Saw
        if (enemy._lastHitByWeapon === WeaponType.SCRAP_SAW) {
          const pAny: any = this.player as any;
          pAny._scrapStacks = (pAny._scrapStacks || 0) + 1;
          // Cap at 3 stacks
          if (pAny._scrapStacks > 3) pAny._scrapStacks = 3;
          // Tiny UI ping (optional custom event)
          window.dispatchEvent(new CustomEvent('scrapStacks', { detail: { stacks: pAny._scrapStacks } }));
        }
        // Passive: AOE On Kill
        const playerAny: any = this.player as any;
        if (playerAny.hasAoeOnKill) {
          const gdm = playerAny.getGlobalDamageMultiplier?.() ?? (playerAny.globalDamageMultiplier ?? 1);
          const dmg = (this.player.bulletDamage || 10) * gdm * 0.4; // 40% scaled
          const areaMul = playerAny.getGlobalAreaMultiplier?.() ?? (playerAny.globalAreaMultiplier ?? 1);
          const radius = 70 * (areaMul || 1); // modest radius to avoid chain wipes
          const game: any = (window as any).__gameInstance || (window as any).gameInstance;
          if (game && game.explosionManager && typeof game.explosionManager.triggerExplosion === 'function') {
            game.explosionManager.triggerExplosion(enemy.x, enemy.y, dmg, undefined, radius, '#FFAA33');
          } else {
            // Fallback: simple immediate radial damage without visuals
            for (let i=0;i<this.enemies.length;i++) {
              const e2 = this.enemies[i];
              if (!e2.active || e2.hp <= 0) continue;
              const dx = e2.x - enemy.x; const dy = e2.y - enemy.y;
              if (dx*dx + dy*dy <= radius*radius) {
                this.takeDamage(e2, dmg * 0.5, false, true); // reduced if fallback path
              }
            }
          }
        }
        this.enemyPool.push(enemy);
      }
    }

    // Rogue Hacker DoT ticking (3x35 over 1.5s on affected enemies)
    {
  const now = nowFrame;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e: any = this.activeEnemies[i] as any;
        const dot = e._hackerDot;
        if (!dot || e.hp <= 0) continue;
        let safety = 3;
        while (dot.ticksLeft > 0 && now >= dot.nextTick && safety-- > 0) {
          dot.ticksLeft--;
          dot.nextTick += 500;
          this.takeDamage(e as Enemy, dot.perTick, false, false, WeaponType.HACKER_VIRUS);
          // RGB glitch flash for hacker DoT (no green poison flash)
          e._rgbGlitchUntil = now + 260;
          e._rgbGlitchPhase = ((e._rgbGlitchPhase || 0) + 1) % 7;
        }
        if (dot.ticksLeft <= 0) {
          e._hackerDot = undefined;
        }
      }
    }

    // Void Sniper DoT ticking (applied by Shadow Operative beam): 3 ticks over 3s by default
    {
  const now = nowFrame;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e: any = this.activeEnemies[i] as any;
        const vdot = e._voidSniperDot as { next: number; left: number; dmg: number } | undefined;
        if (!vdot || e.hp <= 0) continue;
        let guard = 4; // prevent spiraling
        while (vdot.left > 0 && now >= vdot.next && guard-- > 0) {
          vdot.left--;
          vdot.next += 1000; // default 1s cadence
          this.takeDamage(e as Enemy, vdot.dmg, false, false, WeaponType.VOID_SNIPER);
          // Visual feedback: purple flash reuse channel
          e._poisonFlashUntil = now + 120;
        }
        if (vdot.left <= 0) {
          e._voidSniperDot = undefined;
        }
      }
    }

    // Boss DoT ticking for Rogue Hacker and Void Sniper
  try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
      if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
        const bAny: any = boss as any;
        const now = nowFrame;
    // Tick generic boss DoTs (poison/burn) similar to enemies
    this.updateBossPoisons(now, boss);
    this.updateBossBurn(now, boss);
        // Hacker DoT on boss: nextTick/ticksLeft/perTick at 500ms cadence
        const hdot = bAny._hackerDot as { nextTick: number; ticksLeft: number; perTick: number } | undefined;
        if (hdot && hdot.ticksLeft > 0) {
          let guard = 4;
          while (hdot.ticksLeft > 0 && now >= hdot.nextTick && guard-- > 0) {
            hdot.ticksLeft--;
            hdot.nextTick += 500;
            this.takeBossDamage(boss, hdot.perTick, false, WeaponType.HACKER_VIRUS, boss.x, boss.y);
            // Amplified RGB glitch feedback channel on boss as well
            bAny._rgbGlitchUntil = now + 260;
            bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 1) % 7;
          }
          if (hdot.ticksLeft <= 0) bAny._hackerDot = undefined;
        }
        // Void Sniper DoT on boss: next/left/dmg at 1000ms cadence
        const vdotB = bAny._voidSniperDot as { next: number; left: number; dmg: number } | undefined;
        if (vdotB && vdotB.left > 0) {
          let guard2 = 4;
          while (vdotB.left > 0 && now >= vdotB.next && guard2-- > 0) {
            vdotB.left--;
            vdotB.next += 1000;
            this.takeBossDamage(boss, vdotB.dmg, false, WeaponType.VOID_SNIPER, boss.x, boss.y);
            // Use damage flash maintained inside takeBossDamage
          }
          if (vdotB.left <= 0) bAny._voidSniperDot = undefined;
        }
      }
    } catch { /* ignore boss dot tick errors */ }

    // Deactivate expired hacker zones
    {
  const now = nowFrame;
      for (let i = 0; i < this.hackerZones.length; i++) {
        const z = this.hackerZones[i];
        if (!z.active) continue;
        if (now - z.created > z.lifeMs) z.active = false;
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
    {
  const dtSec = deltaTime / 1000;
  const px = this.player.x;
  const py = this.player.y;
  // Pickup radius should feel as big as the character sprite
  const playerAny: any = this.player as any;
  const pickupR = Math.max(24, playerAny.size ? (playerAny.size * 0.5) + 6 : (this.player.radius + 10));
  const pickupR2 = pickupR * pickupR;
  const magnetR = Math.max(0, this.player.magnetRadius || 0);
  const magnetR2 = magnetR * magnetR;
      for (let i = 0, len = this.gems.length; i < len; i++) {
        const g = this.gems[i];
        if (!g.active) continue;
        // Apply light friction so any initial scatter settles quickly
        g.vx *= 0.9;
        g.vy *= 0.9;
        if (Math.abs(g.vx) < 0.01) g.vx = 0;
        if (Math.abs(g.vy) < 0.01) g.vy = 0;
        g.x += g.vx * dtSec;
        g.y += g.vy * dtSec;

        const dx = px - g.x;
        const dy = py - g.y;
        const d2 = dx*dx + dy*dy;

        // Local magnet: gently pull gems when inside magnet radius
        if (magnetR > 0 && d2 < magnetR2 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          // Ease-in style pull: stronger when closer; tuned for fixed 60fps but dt-aware
          const t = 1 - Math.min(1, d / magnetR); // 0 far .. 1 near
          const pull = (0.08 + t * 0.22); // fraction of distance per frame @60fps
          // Convert fraction to dt-aware factor (game runs fixed-timestep ~16.67ms)
          const frameFactor = pull * (deltaTime / 16.6667);
          g.x += dx * frameFactor;
          g.y += dy * frameFactor;
        }

        // Pickup when within generous player-sized radius
        if (d2 < pickupR2) {
          this.player.gainExp(g.value);
          g.active = false;
          if (this.particleManager) this.particleManager.spawn(g.x, g.y, 1, '#0ff');
          this.gemPool.push(g);
        }
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
  // Poison status updates
  this.updatePoisons();
  // Data Sigils updates
  this.updateDataSigils(deltaTime);
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
        case 'small': {
          const late = gameTime >= 180;
          enemy.hp = late ? 160 : 100;
          enemy.maxHp = enemy.hp;
          enemy.radius = 20;
          // Make smalls slower baseline; they should no longer outpace the player
          enemy.speed = (late ? 0.90 : 1.05) * 0.30 * this.enemySpeedScale; // ~0.167 early, ~0.167 late too (capped later by chase cap)
          enemy.damage = 4; // within 1-10
          break;
        }
        case 'medium': {
          const late = gameTime >= 180;
          enemy.hp = late ? 380 : 220;
          enemy.maxHp = enemy.hp;
          enemy.radius = 30;
          enemy.speed = 0.65 * 0.30 * this.enemySpeedScale; // ~0.121
          enemy.damage = 7; // within 1-10
          break;
        }
        case 'large': {
          const late = gameTime >= 180;
          enemy.hp = late ? 900 : 480;
          enemy.maxHp = enemy.hp;
          enemy.radius = 38;
          enemy.speed = 0.42 * 0.28 * this.enemySpeedScale; // ~0.073
          enemy.damage = 10; // cap at 10
          break;
        }
    }
  // Spawn placement with safe distance logic
  const minSafeDist = 520; // do not spawn closer than this to player
  const spawnDistance = 900; // base desired distance
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
    let finalX = spawnX, finalY = spawnY;
    if (rm && typeof rm.clampToWalkable === 'function') {
      const clamped = rm.clampToWalkable(spawnX, spawnY, enemy.radius || 20);
      finalX = clamped.x; finalY = clamped.y;
    }
    // Enforce min distance safety; if too close after clamping, push further along ray away from player
    const pdx = finalX - this.player.x;
    const pdy = finalY - this.player.y;
    const pdsq = pdx*pdx + pdy*pdy;
    if (pdsq < minSafeDist * minSafeDist) {
      const d = Math.sqrt(pdsq) || 1;
      const nx = pdx / d;
      const ny = pdy / d;
      finalX = this.player.x + nx * minSafeDist;
      finalY = this.player.y + ny * minSafeDist;
      if (rm && typeof rm.clampToWalkable === 'function') {
        const reclamped = rm.clampToWalkable(finalX, finalY, enemy.radius || 20);
        finalX = reclamped.x; finalY = reclamped.y;
      }
    }
    enemy.x = finalX;
    enemy.y = finalY;
  // Clear transient status on spawn
  const eAny: any = enemy as any;
  eAny._poisonStacks = 0; eAny._poisonExpire = 0; eAny._poisonNextTick = 0;
  eAny._burnStacks = 0; eAny._burnExpire = 0; eAny._burnNextTick = 0; eAny._burnTickDamage = 0;
    this.enemies.push(enemy);
  }

  /**
   * Spawn an XP gem at coordinates.
   *
   * Inputs:
   * - x, y: world coordinates
   * - baseTier: starting tier before random upgrades (1..5)
   * - maxTier: optional cap on final tier after upgrades (e.g., non-elites cap at 3)
   */
  private spawnGem(x: number, y: number, baseTier: number = 1, maxTier?: number) {
    let gem = this.gemPool.pop();
    if (!gem) {
      gem = { x: 0, y: 0, vx: 0, vy: 0, life: 0, lifeMs: 0, size: 0, value: 0, active: false, tier: 1, color: '#FFD700' } as any;
    }
    // Weighted upgrade chance influenced by adaptiveGemBonus
    let tier = baseTier;
    if (tier < 5) {
      const roll = Math.random();
      if (roll < (0.12 * GEM_UPGRADE_PROB_SCALE) + this.adaptiveGemBonus && tier < 2) tier = 2;
      if (roll < (0.05 * GEM_UPGRADE_PROB_SCALE) + this.adaptiveGemBonus*0.6 && tier < 3) tier = 3;
      if (roll < (0.015 * GEM_UPGRADE_PROB_SCALE) + this.adaptiveGemBonus*0.3 && tier < 4) tier = 4;
      if (roll < (0.003 * GEM_UPGRADE_PROB_SCALE) + this.adaptiveGemBonus*0.1 && tier < 5) tier = 5;
    }
    // Apply optional cap (used for non-elite enemy drops)
    if (typeof maxTier === 'number') {
      tier = Math.min(tier, Math.max(1, maxTier|0));
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

  // Build per-tier lists (tiers 1-3 only) of active gems for quick iteration
  const perTier: Record<number, Gem[]> = { 1: [], 2: [], 3: [] } as any;
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
  if (!g.active || g.tier > 3) continue;
      const arr = perTier[g.tier];
      if (arr) arr.push(g);
    }

    // Iterate tiers; stop after performing at most one merge this frame
  for (let t = 1; t <= 3; t++) {
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
  this.pressureBaseline = ENEMY_PRESSURE_BASE + minutes * ENEMY_PRESSURE_LINEAR + minutes * minutes * ENEMY_PRESSURE_QUADRATIC;
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
      if (minutes >= 3) {
        // After 3 minutes, bias heavily toward medium/large and reduce smalls
        if (roll > 0.65) type = 'large';
        else if (roll > 0.30) type = 'medium';
        else type = 'small';
      } else {
        if (roll > 0.85 + minutes * 0.005) type = 'large';
        else if (roll > 0.55 + minutes * 0.01) type = 'medium';
      }

  // Increase cost for large enemies to throttle spawn count; medium are mid-cost
  const cost = type === 'small' ? 1 : type === 'medium' ? 4 : 8;
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

