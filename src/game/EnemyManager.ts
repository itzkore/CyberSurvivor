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
export type SpecialItem = { x: number; y: number; radius: number; active: boolean; type: 'HEAL' | 'MAGNET' | 'NUKE'; ttlMs: number };
export type SpecialTreasure = { x: number; y: number; radius: number; active: boolean; hp: number; maxHp: number; seed: number };

import { Player } from './Player';
import type { Bullet } from './Bullet';
import { ParticleManager } from './ParticleManager';
import type { Gem } from './Gem';
import { GEM_TIERS, getGemTierSpec } from './Gem';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';
import { Logger } from '../core/Logger';
import { WEAPON_SPECS } from './WeaponConfig';
import { BlackSunZoneManager } from './BlackSunZone';
import { SpatialGrid } from '../physics/SpatialGrid'; // Import SpatialGrid
import { ENEMY_PRESSURE_BASE, ENEMY_PRESSURE_LINEAR, ENEMY_PRESSURE_QUADRATIC, XP_ENEMY_BASE_TIERS, GEM_UPGRADE_PROB_SCALE, XP_DROP_CHANCE_SMALL, XP_DROP_CHANCE_MEDIUM, XP_DROP_CHANCE_LARGE, GEM_TTL_MS, getHealEfficiency } from './Balance';

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
  // Cached list of active gems (reuse underlying this.gems array after compaction)
  private activeGems: Gem[] = [];
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
  private specialItems: SpecialItem[] = []; // Active special items (heal/magnet/nuke)
  private specialItemPool: SpecialItem[] = []; // Pool for special items
  private treasures: SpecialTreasure[] = []; // Destructible treasures that drop a random special item
  private treasurePool: SpecialTreasure[] = []; // Pool for treasures
  private assetLoader: AssetLoader | null = null;
  private waves: Wave[]; // legacy static waves (will phase out)
  private dynamicWaveAccumulator: number = 0; // ms accumulator for dynamic spawner
  private pressureBaseline: number = 100; // grows over time
  private adaptiveGemBonus: number = 0; // multiplicative bonus for higher tier chance
  private bulletSpatialGrid: SpatialGrid<Bullet>; // Spatial grid for bullets
  private enemySpatialGrid: SpatialGrid<Enemy>; // Spatial grid for enemies (optimization for zone queries)
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
  // Random special item/treasure spawns (real games)
  private nextSpecialSpawnAtMs: number = 0;
  private specialSpawnMinMs: number = 45000; // 45s ..
  private specialSpawnMaxMs: number = 80000; // ..80s between spawns
  private maxActiveSpecialItems: number = 3;
  private maxActiveTreasures: number = 2;
  // Knockback configuration
  private knockbackDecayTauMs: number = 220; // exponential decay time constant (larger = longer slide)
  private readonly knockbackBaseMs: number = 140;
  private readonly knockbackMaxVelocity: number = 4200; // clamp to avoid extreme stacking
  private readonly knockbackStackScale: number = 0.55; // scaling when stacking onto existing velocity
  private readonly knockbackMinPerFrame: number = 4; // legacy per-frame minimum (converted to px/sec later)
  // Minimal knockback used for Bio Engineer poison DoT ticks to avoid pushing enemies around
  private readonly knockbackBioTickPerFrame: number = 0.2;
  // LOD
  private lodToggle: boolean = false; // flip each update to stagger LOD skips
  private readonly lodFarDistSq: number = 1600*1600; // >1600px from player qualifies as far
  private readonly lodSkipRatio: number = 0.5; // skip every other frame for far enemies
  private killCount: number = 0; // total enemies killed this run
  // Ghost cloak follow: locked target position while cloak is active
  private _ghostCloakFollow: { active: boolean; x: number; y: number; until: number } = { active: false, x: 0, y: 0, until: 0 };
  // Data Sigils: planted glyphs that pulse AoE damage
  private dataSigils: { x:number; y:number; radius:number; pulsesLeft:number; pulseDamage:number; nextPulseAt:number; active:boolean; spin:number; created:number; follow?: boolean; cadenceMs?: number }[] = [];
  // Black Sun seeds (Shadow Operative evolve): dim void orbs that slow/tick, then collapse
  private blackSunSeeds: { x:number; y:number; created:number; active:boolean; fuseMs:number; pullRadius:number; pullStrength:number; collapseRadius:number; slowPct:number; tickIntervalMs:number; tickNext:number; ticksLeft:number; tickDmg:number; collapseDmg:number }[] = [];
  // Dedicated Black Sun zone manager (replaces legacy blackSunSeeds lifecycle)
  private blackSunZones: BlackSunZoneManager;
  // Shadow Surge window (for synergy buffs)
  private shadowSurgeUntilMs: number = 0;

  // Rogue Hacker paralysis/DoT zones (spawned under enemies on virus impact)
  // pulseUntil: draw a stronger spawn pulse/line for first ~220ms to improve visibility
  // stamp: unique per-zone id for O(1) per-enemy contact memoization (replaces Set<string> allocations)
  private hackerZones: { x:number; y:number; radius:number; created:number; lifeMs:number; active:boolean; stamp:number; pulseUntil?: number; seed?: number; nextProcAt?: number }[] = [];
  // Cached sprites for Rogue Hacker zone rings to avoid heavy per-frame vector drawing
  private hackerZoneSpriteCache: Map<string, HTMLCanvasElement> = new Map();
  private getHackerZoneSprite(radius: number, evolved: boolean): HTMLCanvasElement {
    const key = `${Math.round(radius)}|${evolved ? 1 : 0}`;
    const cached = this.hackerZoneSpriteCache.get(key);
    if (cached) return cached;
    const r = Math.max(20, Math.round(radius));
    const size = r * 2 + 16; // padding for glow
    const cnv = document.createElement('canvas');
    cnv.width = size; cnv.height = size;
    const ctx = cnv.getContext('2d');
    if (!ctx) { this.hackerZoneSpriteCache.set(key, cnv); return cnv; }
    const cx = size >> 1, cy = size >> 1;
    // Colors (backdoor = dark neon red palette)
    let colRing = '#FF9A1F', colGlow = '#FF9A1F', colFill = '#FF7700';
    if (evolved) { colRing = '#FF1133'; colGlow = '#FF3355'; colFill = '#550011'; }
    // Outer ring with glow (primary identity)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 6;
    ctx.strokeStyle = colRing;
    ctx.shadowColor = colGlow;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // Restore richer base look: layered techno rings and nodes (static, cheap; only for non‑evolved)
    if (!evolved) {
      // Inner thin ring
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = '#FFD891';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Segmented dash ring
      ctx.save();
      ctx.globalAlpha = 0.26;
      ctx.strokeStyle = '#FFA844';
      ctx.lineWidth = 2.0;
      const segs = 24;
      const rr = r * 0.92;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2 + 0.02;
        const a1 = a0 + (Math.PI * 2) / segs * 0.55; // 55% dash, 45% gap
        ctx.beginPath(); ctx.arc(cx, cy, rr, a0, a1); ctx.stroke();
      }
      ctx.restore();

      // Small node dots around inner ring
      ctx.save();
      ctx.globalAlpha = 0.85;
      const nodes = 8; const rn = r * 0.64;
      for (let i = 0; i < nodes; i++) {
        const a = (i / nodes) * Math.PI * 2;
        const nx = cx + Math.cos(a) * rn;
        const ny = cy + Math.sin(a) * rn;
        ctx.fillStyle = '#FFE6AA';
        ctx.shadowColor = '#FFD280';
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(nx, ny, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else {
      // Evolved: extra-good neon design — layered segmented arcs, inner glow rings, and highlight nodes
      // Inner bright ring
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = '#FF3355';
      ctx.lineWidth = 2.0;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.84, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();

      // Dual segmented arcs
      ctx.save();
      const rr1 = r * 0.94, rr2 = r * 0.74;
      const segsHi = 28;
      ctx.globalAlpha = 0.32; ctx.strokeStyle = '#FF3355'; ctx.lineWidth = 2.2;
      for (let i = 0; i < segsHi; i++) {
        const a0 = (i / segsHi) * Math.PI * 2 + 0.01;
        const a1 = a0 + (Math.PI * 2) / segsHi * 0.60;
        ctx.beginPath(); ctx.arc(cx, cy, rr1, a0, a1); ctx.stroke();
      }
      ctx.globalAlpha = 0.26; ctx.strokeStyle = '#FF6680'; ctx.lineWidth = 1.8;
      for (let i = 0; i < segsHi; i++) {
        const a0 = (i / segsHi) * Math.PI * 2 + 0.04;
        const a1 = a0 + (Math.PI * 2) / segsHi * 0.46;
        ctx.beginPath(); ctx.arc(cx, cy, rr2, a0, a1); ctx.stroke();
      }
      ctx.restore();

      // Hex-style short chords (suggests circuitry)
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#FF99AA';
      ctx.lineWidth = 1.4;
      const hex = 6; const rHex = r * 0.60; const chord = r * 0.10;
      for (let i = 0; i < hex; i++) {
        const a = (i / hex) * Math.PI * 2;
        const nx = cx + Math.cos(a) * rHex;
        const ny = cy + Math.sin(a) * rHex;
        const tx = nx + Math.cos(a + Math.PI / 2) * chord;
        const ty = ny + Math.sin(a + Math.PI / 2) * chord;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(tx, ty); ctx.stroke();
      }
      ctx.restore();

      // Rim highlight nodes
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#FFB3C0';
      ctx.shadowColor = '#FF3355'; ctx.shadowBlur = 8;
      const rimNodes = 10; const rn2 = r * 0.98;
      for (let i = 0; i < rimNodes; i++) {
        const a = (i / rimNodes) * Math.PI * 2 + 0.07;
        const nx = cx + Math.cos(a) * rn2;
        const ny = cy + Math.sin(a) * rn2;
        ctx.beginPath(); ctx.arc(nx, ny, 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // Soft inner fill as very faint ring to sell presence
    ctx.save();
    ctx.globalAlpha = evolved ? 0.20 : 0.24;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 0.95);
    grad.addColorStop(0, `${colFill}10`);
    grad.addColorStop(1, `${colFill}00`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.96, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this.hackerZoneSpriteCache.set(key, cnv);
    return cnv;
  }
  // Rogue Hacker auto-cast state: gate next cast until previous zone has expired and cooldown passed
  private hackerAutoCooldownUntil: number = 0;
  // Monotonic counter for Rogue Hacker zone stamps
  private hackerZoneStampCounter: number = 1;
  // Evolved Hacker: deferred chain spawns schedule
  private pendingHackerZoneSpawns: { x:number; y:number; radius:number; lifeMs:number; at:number }[] = [];
  // Spawn freeze window (e.g., on boss spawn). When now < spawnFreezeUntilMs, dynamic spawner is paused.
  private spawnFreezeUntilMs: number = 0;

  // Poison puddle system
    private poisonPuddles: { x: number, y: number, radius: number, life: number, maxLife: number, active: boolean, vx?: number, vy?: number, isSludge?: boolean, potency?: number }[] = [];
  /** Maximum radius cap for merged sludge puddles (absolute, world units). */
  private readonly maxSludgeRadiusCap: number = 1100;
  // Bio Engineer Outbreak! state
  private bioOutbreakUntil: number = 0;
  private bioOutbreakRadius: number = 0;
  private bioOutbreakLastTickMs: number = 0;
  // Poison (Bio Engineer) status: stacking DoT with movement slow and contagion

  // Cached sprites for psionic mark aura to avoid per-enemy shadowBlur cost
  private psionicGlowCache: Map<number, HTMLCanvasElement> = new Map();
  /** Returns a cached pre-rendered glow sprite for the given radius (quantized). */
  private getPsionicGlowSprite(radius: number): HTMLCanvasElement {
    const step = 4; // quantize to reduce cache cardinality
    const rQ = Math.max(6, Math.round(radius / step) * step);
    const cached = this.psionicGlowCache.get(rQ);
    if (cached) return cached;
    // Build offscreen sprite with baked ring + soft aura (no per-frame shadowBlur)
    const margin = Math.ceil(Math.max(6, rQ * 0.18));
    const size = (rQ + margin) * 2;
    const cnv = document.createElement('canvas');
    cnv.width = size; cnv.height = size;
    const ctx = cnv.getContext('2d');
    if (!ctx) { this.psionicGlowCache.set(rQ, cnv); return cnv; }
    const cx = size / 2, cy = size / 2;
    // Outer soft aura using radial gradient (baked, cheap to draw)
  const grad = ctx.createRadialGradient(cx, cy, Math.max(1, rQ * 0.70), cx, cy, rQ + margin - 1);
  grad.addColorStop(0.0, 'rgba(204,102,255,0.06)');
  grad.addColorStop(0.55, 'rgba(170, 80,255,0.04)');
  grad.addColorStop(1.0, 'rgba(170, 80,255,0.00)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, rQ + margin - 1, 0, Math.PI * 2); ctx.fill();
    // Core neon ring (two strokes with slight variance for punch)
    ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = '#cc66ff';
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(cx, cy, rQ, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.12; ctx.lineWidth = 2.0; ctx.beginPath(); ctx.arc(cx, cy, rQ * 0.96, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1.0;
    this.psionicGlowCache.set(rQ, cnv);
    return cnv;
  }
  private readonly poisonTickIntervalMs: number = 500; // damage application cadence
  private readonly poisonDurationMs: number = 4000; // duration refreshed per stack add
  private readonly poisonDpsPerStack: number = 6.4; // per-stack DPS baseline (100% buff)
  /** Scheduler for puddle -> treasure corrosion ticks (aligned to poison tick cadence). */
  private puddleTreasureNextTickMs: number = 0;
  private readonly poisonMaxStacks: number = 10; // base cap; can be increased dynamically when evolved
  private readonly poisonSlowPerStack: number = 0.01; // 1% slow per stack
  private readonly poisonSlowCap: number = 0.20; // max 20% slow
  /** Current poison max stacks; increase when evolved to Living Sludge for higher ceiling. */
  private getPoisonMaxStacks(): number {
    try {
  // Living Sludge grants infinite poison stacking
  if (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) return Infinity;
    } catch { /* ignore */ }
    return this.poisonMaxStacks;
  }
  // Burn (Blaster) status: applied per enemy; stacking DoT (up to 3 stacks), 2s duration refreshed per stack add
  // We'll store transient fields directly on Enemy object via symbol-like keys to avoid changing type globally.
  private readonly burnTickIntervalMs: number = 500; // 4 ticks over 2s
  private readonly burnDurationMs: number = 2000; // total duration per stack refresh
  // Pre-rendered enemy sprites (normal / flash) keyed by type + pre-tinted RGB ghost variants for glitch effect
  private enemySprites: Record<string, {
    normal: HTMLCanvasElement;
    flash: HTMLCanvasElement;
    normalFlipped?: HTMLCanvasElement;
    flashFlipped?: HTMLCanvasElement;
    redGhost?: HTMLCanvasElement;
    greenGhost?: HTMLCanvasElement;
    blueGhost?: HTMLCanvasElement;
    redGhostFlipped?: HTMLCanvasElement;
    greenGhostFlipped?: HTMLCanvasElement;
    blueGhostFlipped?: HTMLCanvasElement;
  }> = Object.create(null);
  private sharedEnemyImageLoaded = false; // indicates enemy_default.png processed
  private usePreRenderedSprites: boolean = true;
  // Weaver Lattice tick scheduler
  private latticeTickIntervalMs: number = 500; // 0.5s
  private latticeNextTickMs: number = 0;
  // Boss-specific status trackers (stored on boss object via dynamic fields but we tick from here)
  private _bossLastVoidTickMs: number = 0;
  private _bossLastHackerTickMs: number = 0;

  // XP orb rendering cache (pre-rendered sprites by tier)
  private gemSprites: Map<number, HTMLCanvasElement> = new Map();
  // Gem merge throttling / buffers
  private gemMergeNextCheckMs: number = 0;
  private gemTierBuf1: Gem[] = [];
  private gemTierBuf2: Gem[] = [];
  private gemTierBuf3: Gem[] = [];

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
    this.enemySpatialGrid = new SpatialGrid<Enemy>(150); // Cell size 150 for enemy spatial queries
    this.particleManager = particleManager || null;
    this.assetLoader = assetLoader || null;
    this.preallocateEnemies(difficulty);
    this.preallocateGems();
  this.preallocateChests();
  this.preallocateSpecialItems();
  this.preallocateTreasures();
  this.waves = []; // legacy disabled; dynamic system takes over
    // Initialize Black Sun dedicated zone manager
    this.blackSunZones = new BlackSunZoneManager(this, this.player);
    // Freeze spawns and clear enemies on boss spawn (15s calm before the storm)
    window.addEventListener('bossSpawn', () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.spawnFreezeUntilMs = now + 15000; // 15 seconds
      this.clearAllEnemies();
      // Reset dynamic accumulator so we don't burst-spawn when freeze ends
      this.dynamicWaveAccumulator = 0;
    });
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
    // Listen for explicit spawns of special items and treasures
    window.addEventListener('spawnSpecialItem', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      this.spawnSpecialItem(d.x ?? this.player.x, d.y ?? this.player.y, d.type as SpecialItem['type'] | undefined);
    });
    window.addEventListener('spawnTreasure', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      this.spawnTreasure(d.x ?? this.player.x + 40, d.y ?? this.player.y + 40, d.hp ?? 200);
    });
    // Listen for Bio Engineer Outbreak events (force contagion radius around player)
    window.addEventListener('bioOutbreakStart', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      this.bioOutbreakUntil = nowMs + (d.durationMs || 5000);
      this.bioOutbreakRadius = d.radius || 300;
      this.bioOutbreakLastTickMs = 0;
    });
    window.addEventListener('bioOutbreakEnd', () => {
      this.bioOutbreakUntil = 0;
      this.bioOutbreakRadius = 0;
      this.bioOutbreakLastTickMs = 0;
    });
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
      this.plantDataSigil(d.x, d.y, radius, d.pulseCount || 3, d.pulseDamage || 90, !!d.follow, d.pulseCadenceMs, d.pulseDelayMs);
    });
    // Shadow Surge events (for Black Sun synergy)
    window.addEventListener('shadowSurgeStart', (e: Event) => {
      try { const d = (e as CustomEvent).detail || {}; this.shadowSurgeUntilMs = (typeof performance!== 'undefined' ? performance.now() : Date.now()) + (d.durationMs || 5000); } catch { this.shadowSurgeUntilMs = (typeof performance!== 'undefined' ? performance.now() : Date.now()) + 5000; }
    });
    window.addEventListener('shadowSurgeEnd', () => { this.shadowSurgeUntilMs = 0; });
    // Quantum Halo: light AoE pulse when the ring completes a full rotation (high levels only)
    window.addEventListener('quantumHaloPulse', (e: Event) => {
      try {
        const d = (e as CustomEvent).detail || {};
        const x = (typeof d.x === 'number') ? d.x : this.player.x;
        const y = (typeof d.y === 'number') ? d.y : this.player.y;
        const radius = Math.max(40, Math.min(600, (d.radius || 140)));
        const r2 = radius * radius;
        const base = (typeof d.damage === 'number' ? d.damage : 60);
        const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
        const dmg = Math.max(1, Math.round(base * gdm));
        // Query nearby enemies via spatial grid for performance
        const candidates = this.enemySpatialGrid ? this.enemySpatialGrid.query(x, y, radius) : this.enemies;
        for (let i = 0; i < candidates.length; i++) {
          const en = candidates[i];
          if (!en.active || en.hp <= 0) continue;
          const dx = en.x - x; const dy = en.y - y;
          if (dx > radius || dx < -radius || dy > radius || dy < -radius) continue;
          if (dx*dx + dy*dy <= r2) {
            this.takeDamage(en, dmg, false, false, WeaponType.QUANTUM_HALO, x, y, undefined, true);
            const anyE: any = en as any; // brief teal flash
            anyE._poisonFlashUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 70;
          }
        }
        // Also damage treasures within pulse radius
        try {
          const emAny: any = this as any;
          if (typeof emAny.getTreasures === 'function') {
            const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
            for (let ti = 0; ti < treasures.length; ti++) {
              const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
              const dxT = t.x - x; const dyT = t.y - y;
              if (dxT > radius || dxT < -radius || dyT > radius || dyT < -radius) continue;
              if (dxT*dxT + dyT*dyT <= r2 && typeof emAny.damageTreasure === 'function') {
                emAny.damageTreasure(t, dmg);
              }
            }
          }
        } catch { /* ignore treasure pulse errors */ }
        // Boss parity
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const dxB = boss.x - x; const dyB = boss.y - y;
            if (!(dxB > radius || dxB < -radius || dyB > radius || dyB < -radius)) {
              if (dxB*dxB + dyB*dyB <= r2) {
                this.takeBossDamage(boss, dmg, false, WeaponType.QUANTUM_HALO, x, y, undefined, true);
              }
            }
          }
        } catch { /* ignore */ }
        // Subtle FX burst at center
        try { this.particleManager?.spawn(x, y, 8, '#7DFFEA', { sizeMin: 1, sizeMax: 2, lifeMs: 300, speedMin: 1.0, speedMax: 2.2 }); } catch {}
      } catch { /* ignore */ }
    });
    window.addEventListener('bossDefeated', () => { // trigger new timed vacuum logic
      this.startTimedVacuum();
    });
    // Revive cinematic: freeze all enemies and spawns for 5s, then detonate on-screen at the end
    window.addEventListener('playerRevived', (e: Event) => {
      try {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const freezeMs = 5000;
        const until = now + freezeMs;
        // Freeze dynamic spawns during the window
        this.spawnFreezeUntilMs = Math.max(this.spawnFreezeUntilMs, until);
        // Paralyze all active enemies
        for (let i = 0; i < this.activeEnemies.length; i++) {
          const en: any = this.activeEnemies[i];
          if (!en.active || en.hp <= 0) continue;
          en._paralyzedUntil = Math.max(en._paralyzedUntil || 0, until);
        }
        // Freeze boss as well
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const anyB: any = boss as any;
            anyB._paralyzedUntil = Math.max(anyB._paralyzedUntil || 0, until);
          }
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    });
    // Detonate: kill all enemies currently on screen (viewport-based), include boss if present
    window.addEventListener('reviveDetonate', () => {
      try {
        const camX = (window as any).__camX || 0;
        const camY = (window as any).__camY || 0;
        const vw = (window as any).__designWidth || (this as any).designWidth || 1280;
        const vh = (window as any).__designHeight || (this as any).designHeight || 720;
        const minX = camX, maxX = camX + vw, minY = camY, maxY = camY + vh;
        const nukeDmg = 9999999;
        // Kill regular enemies in view
        for (let i = 0; i < this.enemies.length; i++) {
          const e = this.enemies[i]; if (!e.active) continue;
          if (e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY) {
            this.takeDamage(e, nukeDmg, false, false, undefined);
          }
        }
        // Kill boss if in view
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            if (boss.x >= minX && boss.x <= maxX && boss.y >= minY && boss.y <= maxY) {
              // Route through standard boss damage to ensure death side-effects
              this.takeBossDamage(boss, nukeDmg, false, undefined, (this.player as any)?.x ?? boss.x, (this.player as any)?.y ?? boss.y);
            }
          }
        } catch { /* ignore */ }
        // FX burst + shake
        try {
          this.particleManager?.spawn(this.player.x, this.player.y, 26, '#FFFFFF', { sizeMin: 2, sizeMax: 5, lifeMs: 520, speedMin: 2.5, speedMax: 6 });
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 360, intensity: 12 } }));
        } catch { /* ignore */ }
      } catch { /* ignore */ }
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
          this.takeDamage(e1, d.damage, false, false, WeaponType.HACKER_VIRUS, undefined, undefined, undefined, true);
          const anyE: any = e1 as any;
          anyE._paralyzedUntil = Math.max(anyE._paralyzedUntil || 0, now + d.paralyzeMs);
          anyE._rgbGlitchUntil = now + Math.max(260, d.glitchMs|0);
          anyE._rgbGlitchPhase = ((anyE._rgbGlitchPhase || 0) + 2) % 7;
        }
      }
      // Apply to treasures in radius
      try {
        const emAny: any = this as any;
        if (typeof emAny.getTreasures === 'function') {
          const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
          for (let ti = 0; ti < treasures.length; ti++) {
            const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
            const dxT = t.x - d.x, dyT = t.y - d.y;
            if (dxT*dxT + dyT*dyT <= r2 && typeof emAny.damageTreasure === 'function') {
              emAny.damageTreasure(t, d.damage);
            }
          }
        }
      } catch { /* ignore treasure ultimate errors */ }
      // Apply to boss as well
      try {
        const bm: any = (window as any).__bossManager;
        const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const bdx = boss.x - d.x, bdy = boss.y - d.y;
          if (bdx*bdx + bdy*bdy <= r2) {
            this.takeBossDamage(boss, d.damage, false, WeaponType.HACKER_VIRUS, d.x, d.y, undefined, true);
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
  // Schedule first special spawn for real games
  try { this.scheduleNextSpecialSpawn(); } catch {}
    // On game start, scatter a few treasures well away from the player to encourage exploration
    window.addEventListener('startGame', () => {
      try {
        const count = 3;
        for (let i = 0; i < count; i++) {
          const pos = this.pickSpecialSpawnPoint();
          this.spawnTreasure(pos.x, pos.y, 220);
        }
      } catch { /* ignore */ }
    });
    // Sandbox: Spawn/Clear dummy targets for testing
    window.addEventListener('sandboxSpawnDummy', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const count = Math.max(1, Math.min(12, d.count || 1));
      const radius = Math.max(10, Math.min(80, d.radius || 32));
      const hp = Math.max(1, d.hp || 1500);
      const spacing = Math.max(radius * 3, 90);
      const baseAngle = 0; // in front of player
      for (let i = 0; i < count; i++) {
        const ang = baseAngle;
        const dist = 240 + i * spacing;
        const x = this.player.x + Math.cos(ang) * dist;
        const y = this.player.y + Math.sin(ang) * dist;
        this.spawnDummyEnemy(x, y, radius, hp);
      }
    });
    window.addEventListener('sandboxClearDummies', () => {
      for (let i = 0; i < this.enemies.length; i++) {
        const e: any = this.enemies[i];
        if (e && e.active && e._isDummy) {
          e.active = false;
          this.enemyPool.push(e);
        }
      }
      // Compact active list on next update naturally
    });
    // Scatter XP gems within the current viewport
    window.addEventListener('sandboxScatterGems', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const count = Math.max(1, Math.min(200, d.count || 30));
      const camX = (window as any).__camX || 0;
      const camY = (window as any).__camY || 0;
      const vw = (window as any).__designWidth || 1280;
      const vh = (window as any).__designHeight || 720;
      for (let i = 0; i < count; i++) {
        const x = camX + Math.random() * vw;
        const y = camY + Math.random() * vh;
        this.spawnGem(x, y, 1);
      }
    });
    // Clear XP gems within the current viewport
    window.addEventListener('sandboxClearGemsInView', () => {
      const camX = (window as any).__camX || 0;
      const camY = (window as any).__camY || 0;
      const vw = (window as any).__designWidth || 1280;
      const vh = (window as any).__designHeight || 720;
      const minX = camX, maxX = camX + vw, minY = camY, maxY = camY + vh;
      for (let i = 0; i < this.gems.length; i++) {
        const g = this.gems[i]; if (!g.active) continue;
        if (g.x >= minX && g.x <= maxX && g.y >= minY && g.y <= maxY) { g.active = false; this.gemPool.push(g); }
      }
    });
    // Spawn regular enemies within the current viewport (for NUKE tests)
    window.addEventListener('sandboxSpawnViewEnemies', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const count = Math.max(1, Math.min(100, d.count || 10));
      const radius = Math.max(10, Math.min(80, d.radius || 28));
      const hp = Math.max(1, d.hp || 1500);
      const camX = (window as any).__camX || 0;
      const camY = (window as any).__camY || 0;
      const vw = (window as any).__designWidth || 1280;
      const vh = (window as any).__designHeight || 720;
      for (let i = 0; i < count; i++) {
        const x = camX + Math.random() * vw;
        const y = camY + Math.random() * vh;
        this.spawnDummyEnemy(x, y, radius, hp);
      }
    });
    // Spawn one of each enemy type near the player (Sandbox convenience)
    window.addEventListener('sandboxSpawnAllTypes', () => {
      const px = this.player.x, py = this.player.y;
      const dist = 320; // place slightly away from player
      // small (up), medium (right), large (down)
      this.spawnEnemyAt(px, py - dist, { type: 'small' });
      this.spawnEnemyAt(px + dist, py, { type: 'medium' });
      this.spawnEnemyAt(px, py + dist, { type: 'large' });
    });
    // Clear enemies within the current viewport
    window.addEventListener('sandboxClearViewEnemies', () => {
      const camX = (window as any).__camX || 0;
      const camY = (window as any).__camY || 0;
      const vw = (window as any).__designWidth || 1280;
      const vh = (window as any).__designHeight || 720;
      const minX = camX, maxX = camX + vw, minY = camY, maxY = camY + vh;
      for (let i = 0; i < this.enemies.length; i++) {
        const e: any = this.enemies[i]; if (!e.active) continue;
        if (e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY) { e.active = false; this.enemyPool.push(e); }
      }
    });
  }
  /** Plant a Data Sigil at position with radius and a limited number of pulses. */
  private plantDataSigil(x:number, y:number, radius:number, pulseCount:number, pulseDamage:number, follow:boolean=false, cadenceMs?: number, initialDelayMs?: number){
    let sig = this.dataSigils.find(s => !s.active);
    const now = performance.now();
    if (!sig) {
      sig = { x, y, radius, pulsesLeft: pulseCount, pulseDamage, nextPulseAt: now + (initialDelayMs ?? 220), active: true, spin: Math.random()*Math.PI*2, created: now, follow, cadenceMs };
      this.dataSigils.push(sig);
    } else {
      sig.x = x; sig.y = y; sig.radius = radius; sig.pulsesLeft = pulseCount; sig.pulseDamage = pulseDamage; sig.nextPulseAt = now + (initialDelayMs ?? 220); sig.active = true; sig.spin = Math.random()*Math.PI*2; sig.created = now; sig.follow = follow; sig.cadenceMs = cadenceMs;
    }
  // Golden spark burst on plant
  try { this.particleManager?.spawn(x, y, 12, '#33E6FF', { sizeMin: 1, sizeMax: 3, lifeMs: 420, speedMin: 1.2, speedMax: 3.2 }); } catch {}
  }

  /** Update Data Sigils: emit pulses on cadence and apply AoE damage. */
  private updateDataSigils(deltaMs: number): void {
    if (!this.dataSigils.length) return;
    const now = performance.now();
    const p: any = this.player as any;
    const gdm = p?.getGlobalDamageMultiplier?.() ?? (p?.globalDamageMultiplier ?? 1);
    const areaMul = p?.getGlobalAreaMultiplier?.() ?? (p?.globalAreaMultiplier ?? 1);
    // Precompute spatial query helper
    const query = (x: number, y: number, r: number) => (this.enemySpatialGrid ? this.enemySpatialGrid.query(x, y, r) : this.enemies);
    for (let i = 0; i < this.dataSigils.length; i++) {
      const s = this.dataSigils[i];
      if (!s.active) continue;
      // Follow player if requested
      if (s.follow) {
        s.x = this.player.x;
        s.y = this.player.y;
      }
      // Spin animation advance (scaled by delta)
      s.spin += (deltaMs / 1000) * 2.2; // ~2.2 rad/sec
      const cadence = Math.max(140, (s.cadenceMs ?? 420));
      if (now >= s.nextPulseAt && s.pulsesLeft > 0) {
        s.pulsesLeft--;
        s.nextPulseAt = now + cadence;
        // Effective damage and radius with multipliers
        const radius = Math.max(12, s.radius * (areaMul || 1));
        const r2 = radius * radius;
        const dmg = Math.max(1, Math.round((s.pulseDamage || 0) * (gdm || 1)));
        const x = s.x, y = s.y;
        // Prefer spatial grid query for nearby enemies
        const candidates = query(x, y, radius + 32);
      for (let j = 0; j < candidates.length; j++) {
          const e = candidates[j];
          if (!e.active || e.hp <= 0) continue;
          const dx = e.x - x; const dy = e.y - y;
          if (dx > radius || dx < -radius || dy > radius || dy < -radius) continue;
          if (dx*dx + dy*dy <= r2) {
        this.takeDamage(e, dmg, false, false, WeaponType.DATA_SIGIL, x, y, undefined, true);
            (e as any)._lastHitByWeapon = WeaponType.DATA_SIGIL;
          }
        }
        // Boss parity: apply pulse damage within radius
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
            const dxB = boss.x - x; const dyB = boss.y - y;
            if (!(dxB > radius || dxB < -radius || dyB > radius || dyB < -radius)) {
              if (dxB*dxB + dyB*dyB <= r2) this.takeBossDamage(boss, dmg, false, WeaponType.DATA_SIGIL, x, y, undefined, true);
            }
          }
        } catch { /* ignore */ }
        // Treasure parity: apply pulse damage within radius
        try {
          const emAny: any = this as any;
          if (typeof emAny.getTreasures === 'function') {
            const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
            for (let ti = 0; ti < treasures.length; ti++) {
              const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
              const dxT = t.x - x; const dyT = t.y - y;
              if (dxT > radius || dxT < -radius || dyT > radius || dyT < -radius) continue;
              if (dxT*dxT + dyT*dyT <= r2 && typeof emAny.damageTreasure === 'function') {
                emAny.damageTreasure(t, dmg);
              }
            }
          }
        } catch { /* ignore treasure pulse errors */ }
        // Treasure parity: apply pulse damage within radius
        try {
          const emAny: any = this as any;
          if (typeof emAny.getTreasures === 'function') {
            const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
            for (let ti = 0; ti < treasures.length; ti++) {
              const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
              const dxT = t.x - x; const dyT = t.y - y;
              if (dxT > radius || dxT < -radius || dyT > radius || dyT < -radius) continue;
              if (dxT*dxT + dyT*dyT <= r2 && typeof emAny.damageTreasure === 'function') {
                emAny.damageTreasure(t, dmg);
              }
            }
          }
        } catch { /* ignore treasure pulse errors */ }
        // Visual micro-shockwave via ExplosionManager if available
        try {
          const game: any = (window as any).__gameInstance || (window as any).__game;
          const ex = game && game.explosionManager;
          if (ex && typeof ex.triggerShockwave === 'function') {
            ex.triggerShockwave(x, y, 0, Math.max(8, Math.min(radius, 120)), '#FFEFA8');
          }
        } catch { /* ignore */ }
      }
      // Deactivate when exhausted
      if (s.pulsesLeft <= 0) {
        // Finale: massive knockback shockwave at the end of the sigil's life
        try {
          const game: any = (window as any).__gameInstance || (window as any).__game;
          const ex = game && game.explosionManager;
          // Damage is scaled off last pulse; radius scales with sigil radius
          const finaleDmg = Math.max(1, Math.round((s.pulseDamage || 0) * 1.25));
          const finaleR = Math.max(80, Math.min(360, Math.round((s.radius || 120) * 1.15)));
          if (ex && typeof ex.triggerShockwave === 'function') {
            ex.triggerShockwave(s.x, s.y, finaleDmg, finaleR, '#FFEFAA');
          }
          // Apply manual AoE damage with weapon context for enemy knockback
          const r2 = finaleR * finaleR;
          for (let j = 0; j < this.enemies.length; j++) {
            const e = this.enemies[j]; if (!e.active) continue;
            const dx = e.x - s.x, dy = e.y - s.y; const d2 = dx*dx + dy*dy;
            if (d2 <= r2) {
              this.takeDamage(e, finaleDmg, false, false, WeaponType.DATA_SIGIL, s.x, s.y, undefined, true);
              // Extra outward impulse to sell the "massive knockback"
              const d = Math.max(1, Math.sqrt(d2));
              const nx = dx / d, ny = dy / d;
              const boost = 2200; // tuned impulse
              const existingRadial = ((e as any).knockbackVx || 0) * nx + ((e as any).knockbackVy || 0) * ny;
              const added = boost * (existingRadial > 0 ? this.knockbackStackScale : 1);
              const newMag = Math.min(this.knockbackMaxVelocity, Math.max(existingRadial, 0) + added);
              (e as any).knockbackVx = nx * newMag; (e as any).knockbackVy = ny * newMag;
              (e as any).knockbackTimer = Math.max((e as any).knockbackTimer || 0, this.knockbackBaseMs + 90);
            }
          }
          // Boss also takes finale damage (rely on visual knockback minimalism for bosses)
          try {
            const bm: any = (window as any).__bossManager;
            const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
            if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
              const dxB = boss.x - s.x, dyB = boss.y - s.y; if (dxB*dxB + dyB*dyB <= r2) this.takeBossDamage(boss, finaleDmg, false, WeaponType.DATA_SIGIL, s.x, s.y, undefined, true);
            }
          } catch { /* ignore */ }
        } catch { /* ignore */ }
        s.active = false;
      }
    }
    // Compact array to keep active set dense
    // (We keep full array because draw uses index for animation variance, but prune inactive tails.)
    // No full filter to avoid allocations; manual in-place compaction is cheap.
    let w = 0;
    for (let r = 0; r < this.dataSigils.length; r++) {
      const s = this.dataSigils[r];
      if (s.active) this.dataSigils[w++] = s;
    }
    this.dataSigils.length = w + (this.dataSigils.length - w); // keep length unchanged to preserve pools
  }

  // Black Sun lifecycle temporarily stubbed for parser isolation
  public spawnBlackSunSeed(x: number, y: number, params: { fuseMs:number; pullRadius:number; pullStrength:number; collapseRadius:number; slowPct:number; tickIntervalMs:number; ticks:number; tickDmg:number; collapseDmg:number }): void {
    // Route to dedicated zone manager; legacy array no longer used
    this.blackSunZones.spawn(x, y, {
      fuseMs: params.fuseMs,
      pullRadius: params.pullRadius,
      pullStrength: params.pullStrength,
      collapseRadius: params.collapseRadius,
      slowPct: params.slowPct,
      tickIntervalMs: params.tickIntervalMs,
      ticks: params.ticks,
      tickDmg: params.tickDmg,
      collapseDmg: params.collapseDmg,
    });
  }
  // Legacy updateBlackSunSeeds is superseded by BlackSunZoneManager; retained as no-op for compatibility
  private updateBlackSunSeeds(_deltaMs: number): void { return; }

  /** Spawn a Rogue Hacker zone at x,y with radius; lasts lifeMs. */
  private spawnHackerZone(x:number, y:number, radius:number, lifeMs:number){
    // Reuse inactive or push new
    let z = this.hackerZones.find(z=>!z.active);
    const now = performance.now();
    if (!z){
  z = { x, y, radius, created: now, lifeMs, active: true, stamp: (this.hackerZoneStampCounter++), pulseUntil: now + 220, seed: Math.floor(now % 100000), nextProcAt: now };
      this.hackerZones.push(z);
    } else {
  z.x = x; z.y = y; z.radius = radius; z.created = now; z.lifeMs = lifeMs; z.active = true; z.stamp = (this.hackerZoneStampCounter++); z.pulseUntil = now + 220; z.seed = Math.floor(now % 100000); z.nextProcAt = now;
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
    // Evolved Bio (Living Sludge): guarantee a slimy minimum 20% slow while poisoned or standing in sludge
    try {
      const hasSludge = (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true;
      if (hasSludge) {
        const nowSlim = performance.now();
        if ((eAny._poisonStacks > 0) || ((eAny._inSludgeUntil || 0) > nowSlim)) {
          slow = Math.max(slow, 0.20);
        }
      }
    } catch { /* ignore */ }
    // Psionic mark slow: flat 28% while active (buffed)
    const now = performance.now();
    if (eAny._psionicMarkUntil && eAny._psionicMarkUntil > now) slow = Math.max(slow, 0.28);
    // Black Sun slow: apply while inside a seed
    if (eAny._blackSunSlowUntil && eAny._blackSunSlowUntil > now) {
      const pct = Math.max(0, Math.min(0.97, eAny._blackSunSlowPct || 0));
      slow = Math.max(slow, pct);
    }
    // Weaver Lattice slow: 70% slow to all enemies currently within lattice radius around player
    try {
      const until = (window as any).__weaverLatticeActiveUntil || 0;
      if (until > now) {
        const dx = e.x - this.player.x; const dy = e.y - this.player.y;
  const r = 352; // match draw/update radius (buffed)
        if (dx*dx + dy*dy <= r*r) slow = Math.max(slow, 0.70);
      }
    } catch {}
    // Slow Aura passive: apply additional slow within radius
    try {
      const p: any = this.player as any;
      const lvl = p?.slowAuraLevel | 0;
      if (lvl > 0) {
        const baseR = p.slowAuraBaseRadius ?? 352; // match PassiveConfig (60% buff)
        const addR = p.slowAuraRadiusPerLevel ?? 48;
        const strength = p.slowAuraStrength ?? (0.16 + lvl * 0.07);
        // Scale with global Area passive so aura grows with Area Up
        const areaMul = (typeof p.getGlobalAreaMultiplier === 'function') ? p.getGlobalAreaMultiplier() : (p.globalAreaMultiplier || 1);
        const r = (baseR + addR * lvl) * (areaMul || 1);
        const dx = e.x - this.player.x; const dy = e.y - this.player.y;
        if (dx*dx + dy*dy <= r*r) {
          slow = Math.max(slow, Math.min(0.85, Math.max(0, strength)));
        }
      }
    } catch { /* ignore */ }
    return baseSpeed * (1 - slow);
  }

  /** Pre-render circle enemies (normal + flash variant) to cut per-frame path & stroke cost. */
  private preRenderEnemySprites() {
    const defs: Array<{type: Enemy['type']; radius: number; color: string; flashColor: string}> = [
      { type: 'small', radius: 20, color: '#f00', flashColor: '#ff8080' },
      { type: 'medium', radius: 28, color: '#d40000', flashColor: '#ff9090' },
      { type: 'large', radius: 36, color: '#b00000', flashColor: '#ff9999' }
    ];
    // Helper: build a tinted single-channel ghost canvas (simulate RGB split) once per type
    const makeGhost = (base: HTMLCanvasElement, tint: 'red'|'green'|'blue'): HTMLCanvasElement => {
      const cv = document.createElement('canvas');
      cv.width = base.width; cv.height = base.height;
      const cctx = cv.getContext('2d')!;
      // Draw base
      cctx.drawImage(base, 0, 0);
      // Overlay a solid tint using multiply to avoid per-frame ctx.filter cost
      cctx.globalCompositeOperation = 'multiply';
      cctx.fillStyle = tint === 'red' ? 'rgba(255,0,0,0.85)'
                       : tint === 'green' ? 'rgba(0,255,0,0.85)'
                       : 'rgba(0,128,255,0.85)';
      cctx.fillRect(0,0,cv.width,cv.height);
      cctx.globalCompositeOperation = 'destination-in';
      // Mask to preserve original alpha
      cctx.drawImage(base, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
      return cv;
    };
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
      // Build pre-tinted RGB ghost canvases (reduce per-frame filter changes)
      const redGhost = makeGhost(normal, 'red');
      const greenGhost = makeGhost(normal, 'green');
      const blueGhost = makeGhost(normal, 'blue');
      // Circles are horizontally symmetric; reuse same canvas for flipped to simplify draw path
      this.enemySprites[d.type] = { normal, flash, normalFlipped: normal, flashFlipped: flash,
        redGhost, greenGhost, blueGhost,
        redGhostFlipped: redGhost, greenGhostFlipped: greenGhost, blueGhostFlipped: blueGhost } as any;
    }
  }

  /** Load single enemy_default.png and create scaled canvases per size category. */
  private loadSharedEnemyImage() {
    const path = AssetLoader.normalizePath('/assets/enemies/enemy_default.png');
    const img = new Image();
    img.onload = () => {
      const defs: Array<{type: Enemy['type']; radius: number}> = [
        { type: 'small', radius: 20 },
        { type: 'medium', radius: 28 },
        { type: 'large', radius: 36 }
      ];
      // Helper for ghosts
      const makeGhost = (base: HTMLCanvasElement, tint: 'red'|'green'|'blue'): HTMLCanvasElement => {
        const cv = document.createElement('canvas');
        cv.width = base.width; cv.height = base.height;
        const cctx = cv.getContext('2d')!;
        cctx.drawImage(base, 0, 0);
        cctx.globalCompositeOperation = 'multiply';
        cctx.fillStyle = tint === 'red' ? 'rgba(255,0,0,0.85)'
                         : tint === 'green' ? 'rgba(0,255,0,0.85)'
                         : 'rgba(0,128,255,0.85)';
        cctx.fillRect(0,0,cv.width,cv.height);
        cctx.globalCompositeOperation = 'destination-in';
        cctx.drawImage(base, 0, 0);
        cctx.globalCompositeOperation = 'source-over';
        return cv;
      };
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
  // Use a consistent warm flash tint for all sizes (no cyan tint on large)
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
        // RGB ghosts
        const redGhost = makeGhost(normal, 'red');
        const greenGhost = makeGhost(normal, 'green');
        const blueGhost = makeGhost(normal, 'blue');
        const redGhostFlipped = makeGhost(normalFlipped, 'red');
        const greenGhostFlipped = makeGhost(normalFlipped, 'green');
        const blueGhostFlipped = makeGhost(normalFlipped, 'blue');
        this.enemySprites[d.type] = { normal, flash, normalFlipped, flashFlipped,
          redGhost, greenGhost, blueGhost, redGhostFlipped, greenGhostFlipped, blueGhostFlipped } as any; // overwrite circle fallback
      }
      this.sharedEnemyImageLoaded = true;
      // Try to override the 'small' type with enemy_spider.png if present
      try {
        const spiderPath = AssetLoader.normalizePath('/assets/enemies/enemy_spider.png');
        const simg = new Image();
        simg.onload = () => {
          const radius = 20; // match 'small' enemy radius
          const size = radius * 2;
          // Normal
          const normal = document.createElement('canvas');
          normal.width = size; normal.height = size;
          const nctx2 = normal.getContext('2d')!;
          nctx2.imageSmoothingEnabled = true;
          nctx2.drawImage(simg, 0, 0, size, size);
          // Flash variant
          const flash = document.createElement('canvas');
          flash.width = size; flash.height = size;
          const fctx2 = flash.getContext('2d')!;
          fctx2.drawImage(simg, 0, 0, size, size);
          fctx2.globalCompositeOperation = 'lighter';
          fctx2.fillStyle = 'rgba(255,128,128,0.6)';
          fctx2.fillRect(0,0,size,size);
          fctx2.globalCompositeOperation = 'source-over';
          // Flipped variants
          const normalFlipped = document.createElement('canvas');
          normalFlipped.width = size; normalFlipped.height = size;
          const fn2 = normalFlipped.getContext('2d')!;
          fn2.translate(size,0); fn2.scale(-1,1); fn2.drawImage(normal,0,0);
          const flashFlipped = document.createElement('canvas');
          flashFlipped.width = size; flashFlipped.height = size;
          const ff2 = flashFlipped.getContext('2d')!;
          ff2.translate(size,0); ff2.scale(-1,1); ff2.drawImage(flash,0,0);
          // RGB ghosts
          const redGhost = makeGhost(normal, 'red');
          const greenGhost = makeGhost(normal, 'green');
          const blueGhost = makeGhost(normal, 'blue');
          const redGhostFlipped = makeGhost(normalFlipped, 'red');
          const greenGhostFlipped = makeGhost(normalFlipped, 'green');
          const blueGhostFlipped = makeGhost(normalFlipped, 'blue');
          this.enemySprites['small'] = { normal, flash, normalFlipped, flashFlipped, redGhost, greenGhost, blueGhost, redGhostFlipped, greenGhostFlipped, blueGhostFlipped } as any;
        };
        simg.onerror = () => { /* keep default 'small' */ };
        simg.src = spiderPath;
      } catch { /* ignore */ }
    // Try to override the 'large' type with enemy_eye.png if present
      try {
        const eyePath = AssetLoader.normalizePath('/assets/enemies/enemy_eye.png');
        const eimg = new Image();
        eimg.onload = () => {
          const radius = 36; // match 'large' enemy radius
          const size = radius * 2;
          // Normal
          const normal = document.createElement('canvas');
          normal.width = size; normal.height = size;
          const nctx2 = normal.getContext('2d')!;
          nctx2.imageSmoothingEnabled = true;
          nctx2.drawImage(eimg, 0, 0, size, size);
          // Flash variant (cooler tint for large)
          const flash = document.createElement('canvas');
          flash.width = size; flash.height = size;
          const fctx2 = flash.getContext('2d')!;
          fctx2.drawImage(eimg, 0, 0, size, size);
      fctx2.globalCompositeOperation = 'lighter';
      // Warm flash to match other enemies (disable cyan effect)
      fctx2.fillStyle = 'rgba(255,128,128,0.6)';
          fctx2.fillRect(0,0,size,size);
          fctx2.globalCompositeOperation = 'source-over';
          // Flipped variants
          const normalFlipped = document.createElement('canvas');
          normalFlipped.width = size; normalFlipped.height = size;
          const fn2 = normalFlipped.getContext('2d')!;
          fn2.translate(size,0); fn2.scale(-1,1); fn2.drawImage(normal,0,0);
          const flashFlipped = document.createElement('canvas');
          flashFlipped.width = size; flashFlipped.height = size;
          const ff2 = flashFlipped.getContext('2d')!;
          ff2.translate(size,0); ff2.scale(-1,1); ff2.drawImage(flash,0,0);
          // RGB ghosts using helper from above scope
          const makeGhost = (base: HTMLCanvasElement, tint: 'red'|'green'|'blue'): HTMLCanvasElement => {
            const cv = document.createElement('canvas');
            cv.width = base.width; cv.height = base.height;
            const cctx = cv.getContext('2d')!;
            cctx.drawImage(base, 0, 0);
            cctx.globalCompositeOperation = 'multiply';
            cctx.fillStyle = tint === 'red' ? 'rgba(255,0,0,0.85)'
                             : tint === 'green' ? 'rgba(0,255,0,0.85)'
                             : 'rgba(0,128,255,0.85)';
            cctx.fillRect(0,0,cv.width,cv.height);
            cctx.globalCompositeOperation = 'destination-in';
            cctx.drawImage(base, 0, 0);
            cctx.globalCompositeOperation = 'source-over';
            return cv;
          };
          const redGhost = makeGhost(normal, 'red');
          const greenGhost = makeGhost(normal, 'green');
          const blueGhost = makeGhost(normal, 'blue');
          const redGhostFlipped = makeGhost(normalFlipped, 'red');
          const greenGhostFlipped = makeGhost(normalFlipped, 'green');
          const blueGhostFlipped = makeGhost(normalFlipped, 'blue');
          this.enemySprites['large'] = { normal, flash, normalFlipped, flashFlipped, redGhost, greenGhost, blueGhost, redGhostFlipped, greenGhostFlipped, blueGhostFlipped } as any;
        };
        eimg.onerror = () => { /* keep default 'large' */ };
        eimg.src = eyePath;
      } catch { /* ignore */ }
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
      this.gemPool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, value: 0, active: false, tier: 1, color: '#33E6FF' });
    }
  }

  private preallocateChests(): void {
    for (let i = 0; i < 10; i++) { // Pre-allocate a small number of chests
      this.chestPool.push({ x: 0, y: 0, radius: 16, active: false });
    }
  }

  private preallocateSpecialItems(): void {
    for (let i = 0; i < 24; i++) {
      this.specialItemPool.push({ x: 0, y: 0, radius: 14, active: false, type: 'HEAL', ttlMs: 0 });
    }
  }

  private preallocateTreasures(): void {
    for (let i = 0; i < 8; i++) {
      this.treasurePool.push({ x: 0, y: 0, radius: 22, active: false, hp: 0, maxHp: 0, seed: 0 });
    }
  }

  public getEnemies() {
  return this.activeEnemies;
  }

  /**
   * Query nearby enemies efficiently using the internal spatial grid.
   * Returns only active enemies within the given radius.
   */
  public queryEnemies(x: number, y: number, radius: number): Enemy[] {
    const candidates = this.enemySpatialGrid.query(x, y, radius);
    const out: Enemy[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      if (e && e.active && e.hp > 0) out.push(e);
    }
    return out;
  }

  /** Apply a short Neural Threader primer debuff (light DoT) to enable tether linking on subsequent hits. */
  public applyNeuralDebuff(enemy: Enemy) {
    if (!enemy || !enemy.active || enemy.hp <= 0) return;
    const now = performance.now();
    const eAny: any = enemy as any;
    // Duration ~2s, 3 ticks at 500ms cadence
    const lvl = (() => { try { return (this.player as any)?.activeWeapons?.get(WeaponType.NOMAD_NEURAL) || 1; } catch { return 1; } })();
    const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
    const perTick = Math.max(2, Math.round((6 + lvl * 4) * gdm));
    eAny._neuralDebuffUntil = now + 2000;
    eAny._neuralDot = { next: now + 500, left: 3, dmg: perTick };
  }

  public getGems() {
    // Prefer cached activeGems to avoid per-frame filter allocations from UI (HUD/minimap)
    if (this.activeGems && this.activeGems.length) return this.activeGems;
    // Fallback for early frames
    const out: Gem[] = [];
    for (let i = 0; i < this.gems.length; i++) { const g = this.gems[i]; if (g.active) out.push(g); }
    return out;
  }

  /** Zero-allocation getter for currently active gems (rebuilt inside update). */
  public getActiveGems(): Gem[] { return this.activeGems; }

  /** Begin 5s timed vacuum after boss kill */
  private startTimedVacuum() {
    if (this.pendingVacuum) return;
    this.pendingVacuum = true;
    this.vacuumElapsedMs = 0;
  }

  public getChests() {
    return this.chests.filter(c => c.active);
  }
  public getSpecialItems() { return this.specialItems.filter(i => i.active); }
  public getTreasures() { return this.treasures.filter(t => t.active); }

  /** Schedule the next random special spawn window. */
  private scheduleNextSpecialSpawn() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const span = this.specialSpawnMinMs + Math.random() * (this.specialSpawnMaxMs - this.specialSpawnMinMs);
    this.nextSpecialSpawnAtMs = now + span;
  }

  /** Pick a reasonable spawn point far from player, clamped to walkable if available. */
  private pickSpecialSpawnPoint(): { x: number; y: number } {
    const px = this.player.x, py = this.player.y;
    let sx = px, sy = py;
    try {
      const rm: any = (window as any).__roomManager;
      // Prefer far, unvisited room center if structure exists
      if (rm && typeof rm.getFarthestRoom === 'function') {
        const far = rm.getFarthestRoom(px, py, true);
        if (far) { sx = far.x + far.w/2; sy = far.y + far.h/2; }
        else {
          // Fallback: random ring 1200..1800 away
          const ang = Math.random() * Math.PI * 2;
          const dist = 1200 + Math.random() * 600;
          sx = px + Math.cos(ang) * dist; sy = py + Math.sin(ang) * dist;
        }
        // Clamp to walkable interior if available
        if (typeof rm.clampToWalkable === 'function') {
          const c = rm.clampToWalkable(sx, sy, 18);
          sx = c.x; sy = c.y;
        }
      } else {
        // Open world: random ring 1200..1800 away
        const ang = Math.random() * Math.PI * 2;
        const dist = 1200 + Math.random() * 600;
        sx = px + Math.cos(ang) * dist; sy = py + Math.sin(ang) * dist;
      }
    } catch { /* ignore, use px/py fallback */ }
    // Ensure not too close; if so, push outward along ray
    const dx = sx - px, dy = sy - py;
    const d2 = dx*dx + dy*dy; const minD = 800;
    if (d2 < minD*minD) {
      const d = Math.sqrt(d2) || 1; const nx = dx/d, ny = dy/d;
      sx = px + nx * minD; sy = py + ny * minD;
    }
    return { x: sx, y: sy };
  }

  /** Try to spawn a random treasure or special item in non-sandbox modes on schedule. */
  private tryScheduledSpecialSpawns(nowMs: number) {
    // Only in real gameplay (SHOWDOWN/DUNGEON)
    const gm = (window as any).__gameInstance?.gameMode;
    if (gm === 'SANDBOX') return;
    if (!this.nextSpecialSpawnAtMs) this.scheduleNextSpecialSpawn();
    if (nowMs < this.nextSpecialSpawnAtMs) return;
    // Capacity checks
    const activeItems = this.getSpecialItems().length;
    const activeTreasures = this.getTreasures().length;
    if (activeItems >= this.maxActiveSpecialItems && activeTreasures >= this.maxActiveTreasures) {
      this.scheduleNextSpecialSpawn();
      return;
    }
    // Choose spawn type: 60% direct item, 40% treasure (if capacity allows)
    const roll = Math.random();
    const canItem = activeItems < this.maxActiveSpecialItems;
    const canTreasure = activeTreasures < this.maxActiveTreasures;
    const spawnTreasure = canTreasure && (!canItem ? true : roll >= 0.60);
    const pos = this.pickSpecialSpawnPoint();
    if (spawnTreasure) {
      // Scaled HP mildly over time could be added later; keep flat for now
      this.spawnTreasure(pos.x, pos.y, 220);
    } else if (canItem) {
      // Random type; slight bias toward MAGNET for fun: H:30%, M:40%, N:30%
      const r = Math.random();
      const t = (r < 0.30) ? 'HEAL' : (r < 0.70) ? 'MAGNET' : 'NUKE';
      this.spawnSpecialItem(pos.x, pos.y, t as SpecialItem['type']);
    }
    this.scheduleNextSpecialSpawn();
  }

  /**
   * Applies damage & (optional) knockback. Knockback direction now derives from precise source coordinates (e.g., bullet impact),
   * eliminating previous randomness that used the moving player's position.
   * @param sourceX X of damage source (bullet / player). Required for directional knockback.
   * @param sourceY Y of damage source (bullet / player).
   */
  public takeDamage(
    enemy: Enemy,
    amount: number,
    isCritical: boolean = false,
    ignoreActiveCheck: boolean = false,
    sourceWeaponType?: WeaponType,
    sourceX?: number,
    sourceY?: number,
    weaponLevel?: number,
    isIndirect?: boolean // AoE, DoT, zones, shockwaves, stomps, chain pulses, etc.
  ): void {
    if (!ignoreActiveCheck && (!enemy.active || enemy.hp <= 0)) return; // Only damage active, alive enemies unless ignored

    // Armor shred debuff reduces incoming damage slightly when active
    const anyE: any = enemy as any;
    if (anyE._armorShredExpire && performance.now() < anyE._armorShredExpire) {
      // Shred reduces effective armor, so damage increases; apply 12% bonus while active
      amount *= 1.12;
    }
    // Rogue Hacker evolved vulnerability: amplify all incoming damage while inside zone (and a short linger)
    try {
      const now = performance.now();
      const until = anyE._hackerVulnUntil || 0;
      const linger = anyE._hackerVulnLingerMs || 0;
      if (until > 0) {
        const active = now <= until;
        const recent = !active && linger > 0 && now <= (until + linger);
        if (active || recent) {
          const frac = Math.max(0, Math.min(1, Number(anyE._hackerVulnFrac || 0)));
          if (frac > 0) amount *= (1 + frac);
        }
      }
    } catch { /* ignore */ }
    enemy.hp -= amount;
  // Global lifesteal passive: heal player for a fraction of damage dealt
    try {
      const p: any = this.player as any;
      const ls = p?.lifestealFrac || 0;
      if (ls > 0 && amount > 0) {
        const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
        const eff = getHealEfficiency(timeSec);
    // AoE and any non-direct damage contributes only 25% to lifesteal
    // Heuristic: explicit isIndirect flag wins; otherwise treat missing weapon type as indirect (typical for explosions/burn ticks)
    const indirect = !!isIndirect || sourceWeaponType === undefined;
    const contribScale = indirect ? 0.25 : 1.0;
    const heal = amount * contribScale * ls * eff;
        if (heal > 0) p.hp = Math.min(p.maxHp || p.hp, p.hp + heal);
      }
    } catch { /* ignore heal errors */ }
    // Side-effect: apply burn on Blaster direct damage (initial hit only, not DoT ticks)
  if (sourceWeaponType === WeaponType.LASER && amount > 0) {
      this.applyBurn(enemy, amount * 0.10); // store per-tick damage reference (10% bullet damage per tick)
    }
  if (sourceWeaponType !== undefined) {
      enemy._lastHitByWeapon = sourceWeaponType;
  // Bio Toxin no longer applies direct impact damage; stacks are applied via puddles/outbreak only
  // Apply armor shred on Scrap Lash hits: short 0.6s window
  if (sourceWeaponType === WeaponType.SCRAP_LASH && amount > 0) {
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
  // Do not apply knockback to Sandbox dummy targets. Suppress for Void/Black Sun sources entirely,
  // also for beam-style weapons (Railgun, Ghost Sniper), and whenever the target is inside any active Black Sun zone
  // or within the short-lived spawn suppression ring.
  let suppressKb = sourceWeaponType === WeaponType.VOID_SNIPER
    || sourceWeaponType === WeaponType.BLACK_SUN
    || sourceWeaponType === WeaponType.RAILGUN
    || sourceWeaponType === WeaponType.GHOST_SNIPER
    || sourceWeaponType === WeaponType.GUNNER_LAVA_MINIGUN; // continuous micro-beam should not push
  if (!suppressKb) {
    try { if (this.blackSunZones?.isPointWithinAny(enemy.x, enemy.y, 0)) suppressKb = true; } catch {}
  }
  // Hard block any knockback assignment for a brief moment in the spawn suppression ring
  if (!suppressKb) {
    try { if (this.blackSunZones?.shouldSuppressKnockbackAt?.(enemy.x, enemy.y)) suppressKb = true; } catch {}
  }
  // Respect per-enemy suppression window set at seed spawn
  if (!suppressKb) {
    try { const eAnyKb: any = enemy as any; if (eAnyKb._kbSuppressUntil && performance.now() < eAnyKb._kbSuppressUntil) suppressKb = true; } catch {}
  }
  // If enemy is currently under Black Sun slow influence, suppress knockback entirely
  if (!suppressKb) {
    try { const now = performance.now(); const eAnySl: any = enemy as any; if (eAnySl._blackSunSlowUntil && now < eAnySl._blackSunSlowUntil) suppressKb = true; } catch {}
  }
  if (spec && !(enemy as any)._isDummy) {
      if (suppressKb) {
        const eClear: any = enemy as any; eClear.knockbackTimer = 0; eClear.knockbackVx = 0; eClear.knockbackVy = 0;
      } else {
        // Choose knockback origin per weapon type
        const isBioTick = sourceWeaponType === WeaponType.BIO_TOXIN; // DoT ticks only; direct impact is zeroed elsewhere
        let sx: number; let sy: number;
        if (typeof sourceX === 'number' && typeof sourceY === 'number') {
          // Use precise impact origin when available (projectile or melee contact point)
          sx = sourceX; sy = sourceY;
        } else {
          // Fallback to player position
          sx = this.player.x; sy = this.player.y;
        }
        // spec.knockback historically represented px per 60fps frame
        let perFrame = spec.knockback ?? this.knockbackMinPerFrame;
        if (isBioTick) {
          // Bio DoT: force a tiny knockback, ignore min clamp and level scaling
          perFrame = this.knockbackBioTickPerFrame;
        } else {
          // Preserve legacy minimum and level scaling for impulse-based weapons
          if (perFrame < this.knockbackMinPerFrame) perFrame = this.knockbackMinPerFrame;
          if (weaponLevel && weaponLevel > 1) perFrame *= 1 + (weaponLevel - 1) * 0.25; // simple linear scaling
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
  // Strongly dampen beams to avoid runaway stacking; apply extra damping for Bio ticks
  const beamDampen = isBioTick ? 0.08 : 0.3;
  // Apply spawn-time knockback resistance (0..0.8) scaled over run time
  const kbResist = (enemy as any)?._kbResist || 0;
  let impulse = baseForcePerSec * massScale * beamDampen * Math.max(0, 1 - kbResist);
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
    weaponLevel?: number,
    isIndirect?: boolean // AoE/DoT contributions scaled for lifesteal
  ): void {
    if (!boss || boss.hp <= 0 || boss.state !== 'ACTIVE') return;
    // Armor shred increases damage taken while active (mirror enemy logic)
    const bAny: any = boss as any;
    if (bAny._armorShredExpire && performance.now() < bAny._armorShredExpire) {
      amount *= 1.12;
    }
    boss.hp -= amount;
  // Apply global lifesteal on boss damage as well
    try {
      const p: any = this.player as any;
      const ls = p?.lifestealFrac || 0;
      if (ls > 0 && amount > 0) {
        const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
        const eff = getHealEfficiency(timeSec);
    const indirect = !!isIndirect || sourceWeaponType === undefined;
    const contribScale = indirect ? 0.25 : 1.0;
    const heal = amount * contribScale * ls * eff;
        if (heal > 0) p.hp = Math.min(p.maxHp || p.hp, p.hp + heal);
      }
    } catch { /* ignore heal errors */ }
    boss._damageFlash = Math.max(10, (boss._damageFlash || 0));
    // Side-effects based on source weapon (limited for boss to avoid runaway)
  if (sourceWeaponType !== undefined) {
      bAny._lastHitByWeapon = sourceWeaponType;
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
      // --- Boss knockback parity (minimal on Bio poison ticks) ---
  const spec = WEAPON_SPECS[sourceWeaponType];
  let suppressKb = sourceWeaponType === WeaponType.VOID_SNIPER
    || sourceWeaponType === WeaponType.BLACK_SUN
    || sourceWeaponType === WeaponType.RAILGUN
    || sourceWeaponType === WeaponType.GHOST_SNIPER
    || sourceWeaponType === WeaponType.GUNNER_LAVA_MINIGUN; // continuous micro-beam should not push
  if (!suppressKb) {
    try { if (this.blackSunZones?.isPointWithinAny(boss.x, boss.y, 0)) suppressKb = true; } catch {}
  }
  if (!suppressKb) {
    try { if (this.blackSunZones?.shouldSuppressKnockbackAt?.(boss.x, boss.y)) suppressKb = true; } catch {}
  }
  // Respect boss-specific suppression window
  if (!suppressKb) {
    try { if ((bAny as any)._kbSuppressUntil && performance.now() < (bAny as any)._kbSuppressUntil) suppressKb = true; } catch {}
  }
  if (spec) {
      if (suppressKb) {
        bAny.knockbackTimer = 0; bAny.knockbackVx = 0; bAny.knockbackVy = 0;
      } else {
        const isBioTick = sourceWeaponType === WeaponType.BIO_TOXIN;
        // choose origin
        let sx: number; let sy: number;
        if (typeof sourceX === 'number' && typeof sourceY === 'number') { sx = sourceX; sy = sourceY; }
        else { sx = this.player.x; sy = this.player.y; }
        // per-frame knockback
        let perFrame = spec.knockback ?? this.knockbackMinPerFrame;
        if (isBioTick) {
          perFrame = this.knockbackBioTickPerFrame;
        } else {
          if (perFrame < this.knockbackMinPerFrame) perFrame = this.knockbackMinPerFrame;
          if (weaponLevel && weaponLevel > 1) perFrame *= 1 + (weaponLevel - 1) * 0.25;
        }
        const baseForcePerSec = perFrame * 60;
        let dx = boss.x - sx, dy = boss.y - sy; let dist = Math.hypot(dx, dy); if (dist < 0.0001){ dx=1; dy=0; dist=1; }
        const nx = dx/dist, ny = dy/dist;
        const massScale = 24 / Math.max(12, (boss.radius || 48));
        const dampen = isBioTick ? 0.08 : 0.3;
        let impulse = baseForcePerSec * massScale * dampen;
        let existingRadial = 0;
        if (bAny.knockbackTimer && bAny.knockbackTimer > 0 && (bAny.knockbackVx || bAny.knockbackVy)) {
          existingRadial = (bAny.knockbackVx || 0) * nx + (bAny.knockbackVy || 0) * ny;
          if (existingRadial < 0) existingRadial = 0;
        }
        const added = impulse * (existingRadial > 0 ? this.knockbackStackScale : 1);
        let newMag = existingRadial + added;
        if (newMag > this.knockbackMaxVelocity) newMag = this.knockbackMaxVelocity;
        bAny.knockbackVx = nx * newMag; bAny.knockbackVy = ny * newMag;
        const bonus = Math.min(180, (impulse / 2200) * 90);
        bAny.knockbackTimer = Math.max(bAny.knockbackTimer || 0, this.knockbackBaseMs + bonus);
      }
    }
  }
    // Emit particle + DPS event
    try { this.particleManager?.spawn(boss.x, boss.y, 1, isCritical ? '#ffcccc' : '#ffd280'); } catch {}
    try { window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount, isCritical, x: boss.x, y: boss.y } })); } catch {}
  }

  /**
   * Spectral Executioner: Resolve a specter mark with an on‑target AoE pulse (no beam),
   * then optionally chain smaller pulses to nearby still‑marked targets. Clears marks as it resolves.
   * reason is 'expire' when the timer runs out or 'death' when the target dies while marked.
   */
  private executeSpecterExecution(primary: Enemy, reason: 'expire' | 'death'): void {
    if (!primary) return;
    const now = performance.now();
    const pAny: any = primary as any;
    // Guard: only once per mark
    if (!pAny._specterMarkUntil && !pAny._specterMarkFrom) return;
    // Capture stored origin (unused for AoE, kept for potential directional effects)
    const origin = (pAny._specterMarkFrom as { x: number; y: number; time: number } | undefined) || { x: this.player.x, y: this.player.y, time: now };
    // Clear mark on the primary before dealing damage to avoid double triggers
    pAny._specterMarkUntil = 0;
    pAny._specterMarkFrom = undefined;

    // Compute execution damage anchored to Ghost Sniper L7 baseline with heavy multiplier and global damage
    const gsSpec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
    const gsL7 = gsSpec?.getLevelStats ? gsSpec.getLevelStats(7) : { damage: (gsSpec?.damage ?? 220) } as any;
    const baseShot = (gsL7?.damage as number) || 220;
    const heavyMult = 1.6;
    const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
    const base = baseShot * heavyMult * gdm;
    const execSpec: any = (WEAPON_SPECS as any)[WeaponType.SPECTRAL_EXECUTIONER];
    const stats = execSpec?.getLevelStats ? execSpec.getLevelStats(1) : { execMult: 2.2, chainCount: 2, chainMult: 0.6 };
    const execMult = Math.max(0.1, stats.execMult || 2.2);
    const chainCount = Math.max(0, stats.chainCount || 0);
    const chainMult = Math.max(0, Math.min(1, stats.chainMult || 0.6));
  const execDamage = Math.max(1, Math.round(base * execMult));
  const chainDamage = Math.max(1, Math.round(execDamage * chainMult));
  const noRepeatMs = Math.max(600, Math.round((stats.markMs || 1200) * 1.5));

    // On‑target AoE pulse for primary mark (no beam)
    try {
      const game: any = (window as any).__gameInstance || (window as any).gameInstance;
      const ex = game && game.explosionManager;
      if (ex && typeof ex.triggerShockwave === 'function') {
        // Radius +50% for a bigger pop; color in gold palette
        ex.triggerShockwave(primary.x, primary.y, execDamage, 165, '#FFD199');
      } else {
  // Fallback: direct damage if explosion manager is unavailable (treat as AoE/indirect for lifesteal)
  this.takeDamage(primary, execDamage, false, false, WeaponType.SPECTRAL_EXECUTIONER, origin.x, origin.y, undefined, true);
      }
      // Light particles for feedback
      this.particleManager?.spawn(primary.x, primary.y, 4, '#FFE6AA', { sizeMin: 1, sizeMax: 2, lifeMs: 240, speedMin: 0.7, speedMax: 1.4 });
    } catch { /* ignore AoE errors */ }
    // Set per-target no-repeat window to avoid re-marking/executing same target immediately
    try { (pAny as any)._specterNoRepeatUntil = now + noRepeatMs; } catch {}

    // Chain to nearby marked targets
    if (chainCount > 0 && chainDamage > 0) {
      // Build candidate list: active, alive, still-marked enemies excluding primary
      const candidates: Enemy[] = [];
      const nowMs = now;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e = this.activeEnemies[i];
        if (!e.active || e === primary || e.hp <= 0) continue;
        const a: any = e as any;
        if ((a._specterMarkUntil || 0) > nowMs) candidates.push(e);
      }
      // Sort by distance from primary
      candidates.sort((a, b) => {
        const da = (a.x - primary.x) * (a.x - primary.x) + (a.y - primary.y) * (a.y - primary.y);
        const db = (b.x - primary.x) * (b.x - primary.x) + (b.y - primary.y) * (b.y - primary.y);
        return da - db;
      });
      // Limit by radius to avoid full-screen chains
      const chainRadius = 380;
      const r2 = chainRadius * chainRadius;
      let chained = 0;
      for (let i = 0; i < candidates.length && chained < chainCount; i++) {
        const e = candidates[i];
        const dx = e.x - primary.x, dy = e.y - primary.y;
        if (dx * dx + dy * dy > r2) continue;
        const a: any = e as any;
        // Clear the mark immediately to prevent re-entry
        a._specterMarkUntil = 0; a._specterMarkFrom = undefined;
        // On-target AoE pulse for each chained mark
        try {
          const game: any = (window as any).__gameInstance || (window as any).gameInstance;
          const ex = game && game.explosionManager;
          if (ex && typeof ex.triggerShockwave === 'function') {
            ex.triggerShockwave(e.x, e.y, chainDamage, 135, '#FFE8B3');
          } else {
            this.takeDamage(e, chainDamage, false, false, WeaponType.SPECTRAL_EXECUTIONER, primary.x, primary.y, undefined, true);
          }
          this.particleManager?.spawn(e.x, e.y, 3, '#FFE6AA', { sizeMin: 0.8, sizeMax: 1.6, lifeMs: 200, speedMin: 0.6, speedMax: 1.1 });
        } catch { /* ignore */ }
        try { (e as any)._specterNoRepeatUntil = now + noRepeatMs; } catch {}
        chained++;
      }
    }
  }

  /** Boss parity: execute Spectral Executioner mark on the boss (no chain). */
  private executeBossSpecterExecution(reason: 'expire' | 'death'): void {
    try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
      if (!boss || !boss.active || boss.hp <= 0 || boss.state !== 'ACTIVE') return;
      const bAny: any = boss as any;
  const until = bAny._specterMarkUntil || 0;
  if (!(until > 0)) return; // no mark present
  const now = performance.now();
  if (now < until) return; // mark not yet expired; keep it active
      // Consume mark
      const origin = (bAny._specterMarkFrom as { x:number;y:number;time:number } | undefined) || { x: this.player.x, y: this.player.y, time: performance.now() };
      bAny._specterMarkUntil = 0; bAny._specterMarkFrom = undefined;
      // Damage like primary execute
      const gsSpec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
      const gsL7 = gsSpec?.getLevelStats ? gsSpec.getLevelStats(7) : { damage: (gsSpec?.damage ?? 220) } as any;
      const baseShot = (gsL7?.damage as number) || 220;
      const heavyMult = 1.6;
      const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const base = baseShot * heavyMult * gdm;
      const execSpec: any = (WEAPON_SPECS as any)[WeaponType.SPECTRAL_EXECUTIONER];
      const stats = execSpec?.getLevelStats ? execSpec.getLevelStats(1) : { execMult: 2.2 };
  const execDamage = Math.max(1, Math.round(base * Math.max(0.1, stats.execMult || 2.2)));
  const noRepeatMs = Math.max(600, Math.round(((stats as any).markMs || 1200) * 1.5));

      // On‑target AoE pulse on boss (no chain)
      try {
        const game: any = (window as any).__gameInstance || (window as any).gameInstance;
        const ex = game && game.explosionManager;
        if (ex && typeof ex.triggerShockwave === 'function') {
          ex.triggerShockwave(boss.x, boss.y, execDamage, 180, '#FFD199');
        } else {
          this.takeBossDamage(boss, execDamage, false, WeaponType.SPECTRAL_EXECUTIONER, origin.x, origin.y, undefined, true);
        }
        this.particleManager?.spawn(boss.x, boss.y, 5, '#FFE6AA', { sizeMin: 1, sizeMax: 2.2, lifeMs: 240, speedMin: 0.8, speedMax: 1.4 });
      } catch { /* ignore AoE errors */ }
      try { (bAny as any)._specterNoRepeatUntil = performance.now() + noRepeatMs; } catch {}
    } catch { /* ignore */ }
  }

  /** Apply or refresh poison on boss (unlimited stacking on boss). */
  private applyBossPoison(boss: any, stacks: number = 1) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const b: any = boss as any;
    if (!b._poisonStacks) {
      b._poisonStacks = 0;
      b._poisonNextTick = now + this.poisonTickIntervalMs;
      b._poisonExpire = now + this.poisonDurationMs;
    }
    // Unlimited stacking for boss: do not clamp by getPoisonMaxStacks()
    const add = Math.max(0, (stacks as number) | 0);
    b._poisonStacks = ((b._poisonStacks as number) | 0) + add;
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
      // Scale like enemies: consider evolved Living Sludge level when present and add evolved multiplier
      let level = 1;
      try {
        const ls = this.player?.activeWeapons?.get(WeaponType.LIVING_SLUDGE);
        const bt = this.player?.activeWeapons?.get(WeaponType.BIO_TOXIN);
        level = (ls ?? bt ?? 1);
      } catch {}
      // Steepen level curve for "massive damage potential" when evolved
      const hasSludge = (() => { try { return (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true; } catch { return false; } })();
      const baseLevelMul = 1 + Math.max(0, (level - 1)) * (hasSludge ? 0.55 : 0.35);
      // Additional evolved baseline multiplier
      const evolvedMul = hasSludge ? 1.35 : 1.0;
      // In-sludge contact amp for ticks while boss stands in sludge
      const inSludgeAmp = (b as any)._inSludgeUntil && now < (b as any)._inSludgeUntil ? 1.20 : 1.0;
      const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const dps = this.poisonDpsPerStack * baseLevelMul * evolvedMul * inSludgeAmp * dmgMul * stacks;
  const perTick = dps * (this.poisonTickIntervalMs / 1000);
      this.takeBossDamage(boss, perTick, false, WeaponType.BIO_TOXIN, boss.x, boss.y, undefined, true);
  // Progressive toxicity on boss: each tick adds +1 stack (up to cap)
  this.applyBossPoison(boss, 1);
      // Visual: reuse green flash channel
      b._poisonFlashUntil = now + 120;
      // Slimy FX: tiny neon-green droplets on evolved poison ticks
      try {
        const hasSludgeFX = (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true;
        if (hasSludgeFX && this.particleManager) {
          this.particleManager.spawn(boss.x, boss.y, 2, '#66FF6A', { sizeMin: 0.8, sizeMax: 1.6, lifeMs: 260, speedMin: 0.6, speedMax: 1.6 });
        }
      } catch { /* ignore */ }
    }
  }

  /** Apply or refresh a burn stack on boss.
   * Laser Blaster burn policy: cap stacks at 3 and keep per-tick damage minimal.
   * We compute a small per-stack baseline and clamp total tick damage to baseline*stacks,
   * avoiding accumulation from rapid hits.
   */
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
    // Minimal per-stack baseline (scales lightly with Laser level and global damage)
    let laserLevel = 1; try { laserLevel = this.player?.activeWeapons?.get(WeaponType.LASER) ?? 1; } catch {}
    const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
    const perStackBase = Math.max(1, Math.round((3 + 1.0 * Math.max(0, laserLevel - 1)) * dmgMul));
    const stacks = b._burnStacks | 0;
    // Clamp total per-tick damage to baseline * stacks (no accumulation from repeated hits)
    b._burnTickDamage = perStackBase * stacks;
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
    // Apply damage without tagging as LASER to avoid reapplying/refreshing burn from its own tick
    this.takeBossDamage(boss, b._burnTickDamage, false, undefined, boss.x, boss.y);
      }
    }
  }

  /** Apply Neural Threader primer debuff to the boss (short DoT + debuff window). */
  public applyBossNeuralDebuff(boss: any) {
    if (!boss || !boss.active || boss.hp <= 0) return;
    const now = performance.now();
    const bAny: any = boss as any;
    const lvl = (() => { try { return (this.player as any)?.activeWeapons?.get(WeaponType.NOMAD_NEURAL) || 1; } catch { return 1; } })();
    const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
    const perTick = Math.max(2, Math.round((6 + lvl * 4) * gdm));
    bAny._neuralDebuffUntil = now + 2000;
    bAny._neuralDot = { next: now + 500, left: 3, dmg: perTick };
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
  e._poisonStacks = Math.min(this.getPoisonMaxStacks(), (e._poisonStacks || 0) + stacks);
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
      // Scale DoT primarily via weapon level with stronger curve when evolved.
      const perStackBase = this.poisonDpsPerStack;
      let level = 1;
      try {
        const ls = this.player?.activeWeapons?.get(WeaponType.LIVING_SLUDGE);
        const bt = this.player?.activeWeapons?.get(WeaponType.BIO_TOXIN);
        level = (ls ?? bt ?? 1);
      } catch {}
      const hasSludge = (() => { try { return (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true; } catch { return false; } })();
      const baseLevelMul = 1 + Math.max(0, (level - 1)) * (hasSludge ? 0.55 : 0.35);
      const evolvedMul = hasSludge ? 1.35 : 1.0;
      const inSludgeAmp = (e as any)._inSludgeUntil && now < (e as any)._inSludgeUntil ? 1.20 : 1.0;
      const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const dps = perStackBase * baseLevelMul * evolvedMul * inSludgeAmp * dmgMul * stacks;
          const perTick = dps * (this.poisonTickIntervalMs / 1000);
          this.takeDamage(e as Enemy, perTick, false, false, WeaponType.BIO_TOXIN, undefined, undefined, undefined, true);
          // Progressive toxicity: each tick increases stacks by +1 (up to cap)
          this.applyPoison(e as Enemy, 1);
          // Slimy FX: tiny neon-green droplets on evolved poison ticks
          try {
            const hasSludgeFX = (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true;
            if (hasSludgeFX && this.particleManager) {
              this.particleManager.spawn(e.x, e.y, 2, '#66FF6A', { sizeMin: 0.8, sizeMax: 1.6, lifeMs: 240, speedMin: 0.6, speedMax: 1.6 });
            }
          } catch { /* ignore */ }
          // Visual feedback: brief green flash + micro-shake
          e._poisonFlashUntil = now + 120;
          if (!e._shakePhase) e._shakePhase = Math.random() * 10;
          e._shakeAmp = Math.min(2.2, 0.12 * stacks + 0.6);
          e._shakeUntil = now + 120;
        }
      }
    }
    // Outbreak contagion: once per poison tick interval, grant +1 poison stack to all enemies within radius of player
    if (this.bioOutbreakUntil > now && this.bioOutbreakRadius > 0) {
      if (now - (this.bioOutbreakLastTickMs || 0) >= this.poisonTickIntervalMs) {
        this.bioOutbreakLastTickMs = now;
        const px = this.player.x, py = this.player.y;
        const r2 = this.bioOutbreakRadius * this.bioOutbreakRadius;
        for (let j = 0; j < this.activeEnemies.length; j++) {
          const o = this.activeEnemies[j];
          if (!o.active || o.hp <= 0) continue;
          const dx = o.x - px, dy = o.y - py;
          if (dx*dx + dy*dy <= r2) {
            this.applyPoison(o, 1);
          }
        }
        // Affect boss too if within radius
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
            const dxB = boss.x - px, dyB = boss.y - py;
            if (dxB*dxB + dyB*dyB <= r2) this.applyBossPoison(boss, 1);
          }
        } catch { /* ignore */ }
      }
    }
  }

  /** Apply or refresh a burn stack (max 3).
   * Laser Blaster burn policy: cap stacks at 3 and keep per-tick damage minimal.
   * Compute a small per-stack baseline and set per-tick damage = baseline*stacks (no accumulation).
   */
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
    // Minimal per-stack baseline (scales lightly with Laser level and global damage)
    let laserLevel = 1; try { laserLevel = this.player?.activeWeapons?.get(WeaponType.LASER) ?? 1; } catch {}
    const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
    const perStackBase = Math.max(1, Math.round((3 + 1.0 * Math.max(0, laserLevel - 1)) * dmgMul));
    const stacks = eAny._burnStacks | 0;
    eAny._burnTickDamage = perStackBase * stacks;
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
      // Apply damage without tagging as LASER to avoid reapplying/refreshing burn from its own tick
      this.takeDamage(e as Enemy, e._burnTickDamage, false, false, undefined);
          // Optionally spawn a tiny ember particle (future enhancement)
        }
      }
    }
  }

  public spawnPoisonPuddle(x: number, y: number, radius: number = 32, lifeMs: number = 3000, options?: { isSludge?: boolean, potency?: number }) {
    let puddle = this.poisonPuddles.find(p => !p.active);
  if (!puddle) {
    puddle = { x, y, radius: radius, life: lifeMs, maxLife: lifeMs, active: true, vx: 0, vy: 0, isSludge: !!(options?.isSludge), potency: options?.potency ?? 0 };
      this.poisonPuddles.push(puddle);
    } else {
      puddle.x = x;
      puddle.y = y;
      puddle.radius = radius;
    puddle.life = lifeMs;
    puddle.maxLife = lifeMs;
      puddle.active = true;
      puddle.vx = 0; puddle.vy = 0;
      puddle.isSludge = !!(options?.isSludge);
      puddle.potency = options?.potency ?? 0;
    }
  }

  private updatePoisonPuddles(deltaMs: number) {
    const now = performance.now();
    // Corrosion tick cadence for treasures aligns with poison ticks
    const doTreasureTick = now >= this.puddleTreasureNextTickMs;
    if (doTreasureTick) this.puddleTreasureNextTickMs = now + this.poisonTickIntervalMs;
    // Precompute per-tick corrosion values once
    let perTickTreasureNormal = 0, perTickTreasureSludge = 0;
    if (doTreasureTick) {
      try {
        const lvlLS = this.player?.activeWeapons?.get(WeaponType.LIVING_SLUDGE);
        const lvlBT = this.player?.activeWeapons?.get(WeaponType.BIO_TOXIN);
        const level = (lvlLS ?? lvlBT ?? 1);
        const hasSludge = (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true;
        const baseLevelMul = 1 + Math.max(0, (level - 1)) * (hasSludge ? 0.55 : 0.35);
        const evolvedMul = hasSludge ? 1.35 : 1.0;
        const dmgMul = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
        const perTickBase = this.poisonDpsPerStack * baseLevelMul * evolvedMul * dmgMul * (this.poisonTickIntervalMs / 1000);
        perTickTreasureNormal = perTickBase * 1; // treat as 1-stack equivalent
        perTickTreasureSludge = perTickBase * 2;  // sludge acts like 2 stacks
      } catch {
        perTickTreasureNormal = Math.max(1, Math.round(this.poisonDpsPerStack * (this.poisonTickIntervalMs / 1000)));
        perTickTreasureSludge = perTickTreasureNormal * 2;
      }
    }
    // Flow pass for sludge
    for (const puddle of this.poisonPuddles) {
      if (!puddle.active) continue;
      if (puddle.isSludge) {
        let tx: number | null = null, ty: number | null = null;
        let bestD2 = Infinity;
        for (let i = 0; i < this.activeEnemies.length; i++) {
          const e = this.activeEnemies[i]; if (!e.active || e.hp <= 0) continue;
          const dx = e.x - puddle.x; const dy = e.y - puddle.y; const d2 = dx*dx + dy*dy;
          if (d2 < bestD2) { bestD2 = d2; tx = e.x; ty = e.y; }
        }
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
            const dxB = boss.x - puddle.x; const dyB = boss.y - puddle.y; const d2B = dxB*dxB + dyB*dyB;
            if (d2B < bestD2) { bestD2 = d2B; tx = boss.x; ty = boss.y; }
          }
        } catch { /* ignore */ }
        if (tx != null && ty != null && bestD2 > 9) {
          const dist = Math.sqrt(bestD2) || 1;
          const dirX = (tx - puddle.x) / dist;
          const dirY = (ty - puddle.y) / dist;
          const basePxPerMs = 1.2 / 16.67; // ~0.072 px/ms
          const pot = Math.max(0, puddle.potency || 0);
          // Evolved sludge puddles were moving too fast — apply a 0.4x speed cut for sludge
          let speed = basePxPerMs * (1 + pot * 0.18);
          if (puddle.isSludge) speed *= 0.4;
          const step = speed * deltaMs;
          puddle.x += dirX * step;
          puddle.y += dirY * step;
        }
      }
    }
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
          // Seed poison if not present; otherwise, refresh duration while standing in the puddle
          const eAny: any = enemy as any;
          const stacksToApply = puddle.isSludge ? 2 : 1;
          if (!eAny._poisonStacks || eAny._poisonStacks <= 0) this.applyPoison(enemy, stacksToApply);
          else { eAny._poisonExpire = now + this.poisonDurationMs; if (puddle.isSludge) this.applyPoison(enemy, 1); }
          if (puddle.isSludge) eAny._inSludgeUntil = Math.max(eAny._inSludgeUntil || 0, now + 220);
          didDamage = true; // Still track if damage was dealt for visual feedback
        }
      }
      // Boss can also be affected by puddles
      try {
        const bm: any = (window as any).__bossManager;
        const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const dxB = boss.x - puddle.x; const dyB = boss.y - puddle.y;
          const rBoss = (boss.radius || 160);
          if (dxB*dxB + dyB*dyB <= (puddle.radius + rBoss) * (puddle.radius + rBoss)) {
            const bAny: any = boss as any;
            const stacksToApply = puddle.isSludge ? 2 : 1;
            if (!bAny._poisonStacks || bAny._poisonStacks <= 0) this.applyBossPoison(boss, stacksToApply);
            else { bAny._poisonExpire = now + this.poisonDurationMs; if (puddle.isSludge) this.applyBossPoison(boss, 1); }
            if (puddle.isSludge) bAny._inSludgeUntil = Math.max(bAny._inSludgeUntil || 0, now + 220);
            didDamage = true;
          }
        }
      } catch { /* ignore */ }
      // Treasure corrosion parity: tick damage to treasures overlapping this puddle
      if (doTreasureTick) {
        try {
          const emAny: any = this as any;
          if (typeof emAny.getTreasures === 'function') {
            const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
            if (treasures && treasures.length) {
              const rP = puddle.radius; const rP2 = rP * rP;
              const dmg = puddle.isSludge ? perTickTreasureSludge : perTickTreasureNormal;
              if (dmg > 0) {
                for (let ti = 0; ti < treasures.length; ti++) {
                  const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                  const dxT = t.x - puddle.x; const dyT = t.y - puddle.y; const rr = rP + (t.radius || 0);
                  if (dxT*dxT + dyT*dyT <= rr * rr && typeof emAny.damageTreasure === 'function') {
                    emAny.damageTreasure(t, dmg);
                    didDamage = true;
                  }
                }
              }
            }
          }
        } catch { /* ignore treasure corrosion */ }
      }
      // Visual feedback if puddle is damaging
      if (didDamage && this.particleManager) {
        this.particleManager.spawn(puddle.x, puddle.y, 1, puddle.isSludge ? '#66FF6A' : '#00FF00');
      }
    }
  // Merge pass: allow more merges under good performance for exciting chain reactions
  // Make growth easier: raise merge budget across perf tiers
  let mergesLeft = (this.avgFrameMs > 40) ? 8 : (this.avgFrameMs > 28) ? 14 : (this.avgFrameMs > 18) ? 20 : 28;
    for (let i = 0; i < this.poisonPuddles.length && mergesLeft > 0; i++) {
      const a = this.poisonPuddles[i]; if (!a.active || !a.isSludge) continue;
      for (let j = i + 1; j < this.poisonPuddles.length && mergesLeft > 0; j++) {
        const b = this.poisonPuddles[j]; if (!b.active || !b.isSludge) continue;
        const dx = b.x - a.x; const dy = b.y - a.y; const d2 = dx*dx + dy*dy;
        const minDist = a.radius + b.radius;
        if (d2 <= minDist * minDist) {
          const areaA = a.radius * a.radius; const areaB = b.radius * b.radius;
          // Growth model (easier): absorb a larger fraction of the secondary puddle's area, with gentler damping near cap.
          const cap = this.maxSludgeRadiusCap;
          const capArea = cap * cap;
          const near = Math.min(0.9999, areaA / Math.max(1, capArea));
          const potA = Math.max(0, a.potency || 0);
          const potB = Math.max(0, b.potency || 0);
          const potSum = potA + potB;
          // Base absorb fraction increased (0.25), potency boosts more, and near-cap damping is less punitive
          const baseFrac = 0.25;
          const potBoost = Math.min(0.14, 0.012 * potSum);
          const nearDampen = Math.max(0.50, 1 - near * 0.45); // less punitive near cap
          const absorbFrac = Math.max(0.12, Math.min(0.55, (baseFrac + potBoost) * nearDampen));
          const gained = areaB * absorbFrac;
          const newArea = Math.min(capArea, areaA + gained);
          const newR = Math.sqrt(newArea);
          a.x = (a.x * areaA + b.x * areaB) / (areaA + areaB);
          a.y = (a.y * areaA + b.y * areaB) / (areaA + areaB);
          // Hard cap at 800 radius (absolute). Keep consuming other puddles but clamp size at cap.
          a.radius = Math.min(newR, cap);
          a.life = Math.max(a.life, b.life);
          a.maxLife = Math.max(a.maxLife, b.maxLife);
      a.potency = (a.potency || 0) + (b.potency || 0) + 1;
          b.active = false;
          mergesLeft--;
        }
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
  // Adaptive per-frame budget for costly overlays (psionic glows)
  const frameMsBudget = this.avgFrameMs || 16;
  const vfxLow = frameMsBudget > 28 || !!(window as any).__vfxLowMode;
  const psionicGlowBudgetMax = vfxLow ? (frameMsBudget > 40 ? 4 : 10) : (frameMsBudget > 28 ? 12 : frameMsBudget > 18 ? 24 : Number.POSITIVE_INFINITY);
  let psionicGlowBudget = psionicGlowBudgetMax;
  // Sandbox low-FX detection
  const __gm = (window as any).__gameInstance?.gameMode;
  const __sandbox = __gm === 'SANDBOX';
  const forceLow = !!((window as any).__sandboxForceLowFX);
  const lowFX = __sandbox && (forceLow || this.avgFrameMs > 18);
  // In SANDBOX, render a spawn pad at a fixed world position for item tests (degraded in low-FX)
  try {
    if (__sandbox) {
      const gp: any = (window as any);
      const pad = gp.__sandboxPad as {x:number;y:number}|undefined;
      const padX = pad?.x ?? (this.player.x);
      const padY = pad?.y ?? (this.player.y - 140); // fallback on first frames
      if (!(padX < minX || padX > maxX || padY < minY || padY > maxY)) {
        ctx.save();
  if (!lowFX && !vfxLow) {
          ctx.globalCompositeOperation = 'screen';
          const r = 22 + Math.sin(now * 0.006) * 2;
          // Outer glow ring
          ctx.globalAlpha = 0.25;
          ctx.beginPath(); ctx.arc(padX, padY, r * 1.25, 0, Math.PI * 2);
          ctx.strokeStyle = '#5EEBFF'; ctx.lineWidth = 3; ctx.shadowColor = '#5EEBFF'; ctx.shadowBlur = 12; ctx.stroke();
          // Inner disk
          ctx.globalAlpha = 0.18;
          const grad = ctx.createRadialGradient(padX, padY, 4, padX, padY, r);
          grad.addColorStop(0, 'rgba(0,180,220,0.55)');
          grad.addColorStop(1, 'rgba(0,180,220,0)');
          ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(padX, padY, r, 0, Math.PI * 2); ctx.fill();
          // Label
          ctx.globalAlpha = 0.9; ctx.shadowBlur = 6; ctx.shadowColor = '#5EEBFF';
          ctx.fillStyle = '#CFFFFF'; ctx.font = '10px Orbitron, sans-serif';
          ctx.textAlign = 'center'; ctx.fillText('ITEM PAD', padX, padY - r - 8);
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#5EEBFF';
          ctx.beginPath(); ctx.arc(padX, padY, 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }
  } catch {}
  // Psionic Weaver Lattice: draw a large pulsing slow zone around the player while active (behind enemies)
  try {
    const until = (window as any).__weaverLatticeActiveUntil || 0;
  // Bio Boost visual: neon green speed aura + streaks while active (Shift ability for Bio Engineer)
  try {
    const bbUntil = (window as any).__bioBoostActiveUntil || 0;
    const nowB = performance.now();
    if (bbUntil > nowB) {
      const px = this.player.x, py = this.player.y;
      if (!(px < minX - 300 || px > maxX + 300 || py < minY - 300 || py > maxY + 300)) {
        const tLeft = Math.max(0, Math.min(1, (bbUntil - nowB) / 2000));
        const pulse = 1 + Math.sin(nowB * 0.015) * 0.08;
        const baseR = 56;
        const r = baseR * (0.9 + 0.2 * tLeft) * pulse;
        ctx.save();
        ctx.globalCompositeOperation = vfxLow ? 'source-over' : 'screen';
        // Outer aura ring
        ctx.globalAlpha = vfxLow ? 0.18 : 0.28;
        if (!vfxLow) { ctx.shadowColor = '#73FF00'; ctx.shadowBlur = 18; }
        ctx.strokeStyle = '#B6FF00';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
        // Inner glow disk
        if (!vfxLow) {
          const grad = ctx.createRadialGradient(px, py, 6, px, py, r * 0.9);
          grad.addColorStop(0, 'rgba(182,255,0,0.22)');
          grad.addColorStop(1, 'rgba(182,255,0,0)');
          ctx.globalAlpha = 0.22;
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(px, py, r * 0.92, 0, Math.PI * 2); ctx.fill();
        }
        // Speed streaks along velocity
        const vx = this.player.vx || 0; const vy = this.player.vy || 0;
        const spd = Math.hypot(vx, vy);
        if (spd > 0.01) {
          const ang = Math.atan2(vy, vx) + Math.PI; // tail behind motion
          const streaks = 6;
          const len = Math.min(180, 60 + spd * 12);
          for (let s = 0; s < streaks; s++) {
            const offA = ang + ((s - (streaks - 1) / 2) * 0.12);
            const x0 = px + Math.cos(offA) * (r * 0.5);
            const y0 = py + Math.sin(offA) * (r * 0.5);
            const x1 = x0 + Math.cos(offA) * len;
            const y1 = y0 + Math.sin(offA) * len;
            ctx.globalAlpha = (vfxLow ? 0.12 : 0.20) * (1 - s / streaks);
            ctx.strokeStyle = s % 2 === 0 ? '#ADFF2F' : '#73FF00';
            ctx.lineWidth = 2 - (s * 0.12);
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          }
        }
        ctx.restore();
      }
    }
  } catch { /* ignore */ }
  // Bio Outbreak visual: radioactive biohazard styling (layered glow ring + hazard stripes + trefoil arcs + floating spores)
  try {
    const now2 = performance.now();
    if (this.bioOutbreakUntil > now2 && this.bioOutbreakRadius > 0) {
      const px = this.player.x, py = this.player.y;
      if (!(px < minX - 400 || px > maxX + 400 || py < minY - 400 || py > maxY + 400)) {
        const pulse = 1 + Math.sin(now2 * 0.009) * 0.06;
        const r = this.bioOutbreakRadius * pulse;
        ctx.save();
        ctx.globalCompositeOperation = vfxLow ? 'source-over' : 'screen';
        // Outer neon glow ring (toxic green -> yellow)
        ctx.globalAlpha = vfxLow ? 0.14 : 0.22;
        if (!vfxLow) { ctx.shadowColor = '#8CFF3B'; ctx.shadowBlur = 24; }
        ctx.lineWidth = vfxLow ? 2 : 4;
        ctx.strokeStyle = '#B6FF00';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.stroke();

        // Hazard stripe ring: alternating arc dashes around the circle
        ctx.shadowBlur = 0;
        const segs = vfxLow ? 16 : 24; // fewer segments under load
        const baseA = (now2 * 0.002) % (Math.PI * 2);
        for (let s = 0; s < segs; s++) {
          // Alternate bright lime and yellow-green
          const on = (s & 1) === 0;
          ctx.strokeStyle = on ? '#73FF00' : '#ADFF2F';
          ctx.globalAlpha = on ? (vfxLow ? 0.18 : 0.26) : (vfxLow ? 0.10 : 0.16);
          ctx.lineWidth = on ? (vfxLow ? 2 : 3) : 1.5;
          const a0 = baseA + (s / segs) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2) / segs * 0.66; // leave gaps
          ctx.beginPath();
          ctx.arc(px, py, r * 0.98, a0, a1);
          ctx.stroke();
        }

        // Trefoil biohazard arcs rotating slowly
        const triRInner = r * 0.46;
        const triROuter = r * 0.76;
        const triW = 5;
        const triBase = now2 * 0.0015; // slow rotation
        ctx.lineWidth = triW;
        ctx.shadowBlur = vfxLow ? 0 : 14;
        ctx.shadowColor = '#73FF00';
        for (let k = 0; k < 3; k++) {
          const ang = triBase + k * (Math.PI * 2 / 3);
          const a0 = ang - 0.85;
          const a1 = ang + 0.85;
          ctx.globalAlpha = vfxLow ? 0.12 : 0.20;
          ctx.strokeStyle = '#66FF66';
          ctx.beginPath();
          ctx.arc(px, py, (triRInner + triROuter) * 0.5, a0, a1);
          ctx.stroke();
        }

        // Floating spores along the ring (tiny glowing motes drifting clockwise)
        ctx.shadowBlur = 10;
        const moteCount = vfxLow ? 8 : 14;
        const motSpeed = 0.0007; // radians/ms
        for (let m = 0; m < moteCount; m++) {
          const ang = baseA + now2 * motSpeed + (m * (Math.PI * 2 / moteCount));
          const rr = r * (0.97 + ((m & 1) ? -0.015 : 0.015));
          const mx = px + Math.cos(ang) * rr;
          const my = py + Math.sin(ang) * rr;
          ctx.globalAlpha = (vfxLow ? 0.14 : 0.22) + (vfxLow ? 0.06 : 0.10) * ((m & 1) ^ 1);
          ctx.fillStyle = (m % 3 === 0) ? '#C8FF00' : '#66FF88';
          ctx.beginPath();
          ctx.arc(mx, my, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  } catch {}
    if (until > now) {
      const px = this.player.x, py = this.player.y;
      // Cull if fully off-screen
      if (!(px < minX - 400 || px > maxX + 400 || py < minY - 400 || py > maxY + 400)) {
        const baseR = 320;
        const pulse = 1 + Math.sin(now * 0.008) * 0.05; // subtle 5% radius pulse
        const r = baseR * pulse;
        ctx.save();
  ctx.globalCompositeOperation = vfxLow ? 'source-over' : 'screen';
        // Outer glow ring
  ctx.globalAlpha = vfxLow ? 0.12 : 0.20;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.strokeStyle = '#cc66ff';
        ctx.lineWidth = 6;
  if (!vfxLow) { ctx.shadowColor = '#cc66ff'; ctx.shadowBlur = 28; }
        ctx.stroke();
        // Inner faint fill for presence
  ctx.globalAlpha = vfxLow ? 0.05 : 0.08;
        ctx.beginPath();
        ctx.arc(px, py, r * 0.96, 0, Math.PI * 2);
        ctx.fillStyle = '#8a2be2';
  if (!vfxLow) { ctx.shadowColor = '#8a2be2'; ctx.shadowBlur = 16; }
        ctx.fill();
        ctx.restore();
      }
    }
  } catch { /* ignore */ }
  // Draw Black Sun zones via dedicated manager (replaces legacy seed draw)
  try { this.blackSunZones.draw(ctx); } catch {}
  // Draw Data Sigils below enemies (divine golden laser-tech look)
  for (let i=0;i<this.dataSigils.length;i++){
    const s = this.dataSigils[i]; if (!s.active) continue;
    if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;
    ctx.save();
    const t = (performance.now() - s.created) / 1000;
    // Base rings: layered divine gold with additive blend
    ctx.globalCompositeOperation = 'screen';
    // Outer soft halo
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius * 1.04, 0, Math.PI*2); ctx.strokeStyle = '#FFF6C2'; ctx.lineWidth = 4; ctx.shadowColor = '#FFF6C2'; ctx.shadowBlur = 18; ctx.stroke();
    // Main ring
    ctx.globalAlpha = 0.22;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI*2); ctx.strokeStyle = '#FFEFA8'; ctx.lineWidth = 3; ctx.shadowColor = '#FFE066'; ctx.shadowBlur = 14; ctx.stroke();
    // Inner glow ring
    ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.radius * 0.94, 0, Math.PI*2); ctx.strokeStyle = '#FFD977'; ctx.lineWidth = 2; ctx.shadowColor = '#FFD977'; ctx.shadowBlur = 8; ctx.stroke();
    // Laser spokes: crisp beams emanating from inner ring
    ctx.globalAlpha = 0.34;
    const spokes = 8; const inner = s.radius * 0.22; const len = s.radius * 0.96;
    for (let k=0;k<spokes;k++){
      const ang = s.spin + (Math.PI*2*k/spokes);
      const sx = s.x + Math.cos(ang) * inner; const sy = s.y + Math.sin(ang) * inner;
      const ex = s.x + Math.cos(ang) * len;   const ey = s.y + Math.sin(ang) * len;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.strokeStyle = '#FFF2B3'; ctx.lineWidth = 2; ctx.shadowColor = '#FFEFA8'; ctx.shadowBlur = 10; ctx.stroke();
    }
    // Rotating rune arcs along the perimeter (techy feel)
    ctx.globalAlpha = 0.26;
    const arcCount = 5;
    for (let a=0;a<arcCount;a++){
      const base = s.spin * 0.8 + a * (Math.PI * 2 / arcCount);
      const sweep = Math.PI * 0.18;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.radius * 0.85, base, base + sweep);
      ctx.strokeStyle = '#FFF8D1'; ctx.lineWidth = 2; ctx.stroke();
    }
    // Pulse wave: expanding ring synced to nextPulseAt
    const phase = Math.max(0, 1 - (s.nextPulseAt - performance.now())/((s as any).cadenceMs ?? 420));
    ctx.globalAlpha = 0.28 * phase;
    ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(6, s.radius * phase), 0, Math.PI*2); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.shadowColor = '#FFEFA8'; ctx.shadowBlur = 16; ctx.stroke();
    // Floating crosses: minimal count for performance
    ctx.globalAlpha = 0.28;
    const marks = 4;
    for (let m=0;m<marks;m++){
      const ang = s.spin*1.4 + m * (Math.PI*2/marks);
      const rad = s.radius * (0.42 + 0.46 * ((m%2)?1:0.85));
      const mx = s.x + Math.cos(ang)*rad; const my = s.y + Math.sin(ang)*rad;
      ctx.strokeStyle = '#FFFCE6'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(mx-3, my); ctx.lineTo(mx+3, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my-3); ctx.lineTo(mx, my+3); ctx.stroke();
    }
    ctx.restore();
  }
  // Draw Rogue Hacker zones (techno ring under enemies) — optimized sprite path
  const isBackdoor = (() => { try { const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined; return !!(aw && aw.has(WeaponType.HACKER_BACKDOOR)); } catch { return false; } })();
  const lowFxZones = (this.avgFrameMs || 16) > 28 || !!(window as any).__vfxLowMode;
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
    // precompute palette
    const colPulse = isBackdoor ? '#FF5577' : '#FFD891';
    const colLink = isBackdoor ? '#FF3355' : '#FFA500';
    const colText = isBackdoor ? '#FFD0DC' : '#FFF0C2';
    const colSpoke = isBackdoor ? '#FF5577' : '#FFAA55';
    // cached sprite draw
    const sprite = this.getHackerZoneSprite(z.radius, isBackdoor);
    const baseSize = sprite.width;
    const targetSize = z.radius * 2 * pulse + 16;
    const s = Math.max(0.5, targetSize / baseSize);
    ctx.globalAlpha = 0.9 * (1 - t);
    ctx.translate(z.x, z.y);
    ctx.scale(s, s);
    ctx.drawImage(sprite, -baseSize/2, -baseSize/2);
    ctx.setTransform(1,0,0,1,0,0);
    // subtle inner line
  if (!lowFxZones) {
      ctx.globalAlpha = 0.12 * (1 - t);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.radius * 0.75, 0, Math.PI*2);
      ctx.strokeStyle = isBackdoor ? '#FF3355' : '#FFD891'; ctx.stroke();
    }
    // Hacker code glyphs + command text (adaptive; skip when under load)
  if (!lowFxZones) {
      ctx.globalAlpha = 0.24 * (1 - t);
      const seed = (z.seed || 0);
      const frameMs = this.avgFrameMs || 16;
      const glyphs = frameMs > 40 ? 2 : frameMs > 28 ? 4 : 8;
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
        const text = frameMs > 40 ? '' : cmds[(seed + g) % cmds.length];
        ctx.save();
        ctx.translate(gx, gy);
        ctx.rotate(ang + Math.PI/2);
        ctx.shadowColor = colPulse;
        ctx.shadowBlur = 10;
        ctx.fillStyle = colText;
        if (text) ctx.fillText(text, -text.length*3, 0);
        ctx.restore();
      }
    }
    // Spawn pulse: brief expanding bright ring + hack-link line from player
    if ((z.pulseUntil || 0) > now) {
      const left = Math.max(0, Math.min(1, (z.pulseUntil! - now) / 220));
      const rr = z.radius * (1.0 + (1 - left) * 0.35);
      ctx.globalAlpha = 0.46 * left;
      ctx.beginPath(); ctx.arc(z.x, z.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = colPulse; ctx.lineWidth = 3; ctx.shadowColor = colPulse; ctx.shadowBlur = 12; ctx.stroke();
      // Hack-link line (very brief)
      ctx.globalAlpha = 0.22 * left;
      ctx.beginPath(); ctx.moveTo(this.player.x, this.player.y); ctx.lineTo(z.x, z.y);
      ctx.strokeStyle = colLink; ctx.lineWidth = 2.5; ctx.shadowBlur = 6; ctx.stroke();
      // Code burst rays
  if (!lowFxZones) {
        ctx.globalAlpha = 0.16 * left;
        const rays = 8;
        for (let m=0;m<rays;m++){
          const ang = ((z.seed || 0)*0.017 + m) * (Math.PI*2/rays) + now*0.0015;
          ctx.beginPath();
          ctx.moveTo(z.x + Math.cos(ang) * (z.radius*0.3), z.y + Math.sin(ang) * (z.radius*0.3));
          ctx.lineTo(z.x + Math.cos(ang) * rr, z.y + Math.sin(ang) * rr);
          ctx.strokeStyle = colSpoke; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
    }
    // Circuit spokes (low-cost)
  if (!lowFxZones) {
      ctx.globalAlpha = 0.18 * (1 - t);
      const spokes = 6; const inner = z.radius * 0.25; const outer = z.radius * 0.85;
      for (let k=0;k<spokes;k++){
        const ang = (now * 0.002) + (Math.PI * 2 * k / spokes) + i * 0.37;
        ctx.beginPath();
        ctx.moveTo(z.x + Math.cos(ang) * inner, z.y + Math.sin(ang) * inner);
        ctx.lineTo(z.x + Math.cos(ang) * outer, z.y + Math.sin(ang) * outer);
        ctx.strokeStyle = colSpoke; ctx.lineWidth = 2.0; ctx.stroke();
      }
    }
    // Vulnerability tint overlay (subtle) when evolved spec is present
    if (isBackdoor) {
      ctx.globalAlpha = 0.08 * (1 - t);
      ctx.beginPath(); ctx.arc(z.x, z.y, z.radius*0.86, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255, 0, 64, 0.8)';
      ctx.fill();
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
      // If evolved Backdoor is owned, switch to dark neon red mono-ring aesthetic
      let evolved = false;
      try { const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined; evolved = !!(aw && aw.has(WeaponType.HACKER_BACKDOOR)); } catch {}
      if (evolved) {
        ctx.strokeStyle = '#FF1333'; ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI*2); ctx.stroke();
      } else {
        ctx.strokeStyle = '#ff2a2a'; ctx.beginPath(); ctx.arc(fx.x - 2, fx.y, r, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = '#2aff2a'; ctx.beginPath(); ctx.arc(fx.x, fx.y, r*0.985, 0, Math.PI*2); ctx.stroke();
        ctx.strokeStyle = '#2a66ff'; ctx.beginPath(); ctx.arc(fx.x + 2, fx.y, r, 0, Math.PI*2); ctx.stroke();
      }
      // Inner glow disk
      const grad = ctx.createRadialGradient(fx.x, fx.y, Math.max(6, r*0.2), fx.x, fx.y, r);
      if (evolved) {
        grad.addColorStop(0, 'rgba(255,32,64,0.35)');
        grad.addColorStop(1, 'rgba(255,32,64,0)');
      } else {
        grad.addColorStop(0, 'rgba(255,200,120,0.35)');
        grad.addColorStop(1, 'rgba(255,200,120,0)');
      }
      ctx.globalAlpha = 0.35 * (1 - t);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(fx.x, fx.y, r, 0, Math.PI*2); ctx.fill();
      // Code burst spokes (reduce count under load)
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.font = 'bold 12px monospace';
      const cmds = ['nmap -sS','ssh -p 22','sqlmap','hydra','curl -X POST','nc -lvvp','base64 -d','openssl rsautl','grep token','iptables -F'];
      const frameMs2 = this.avgFrameMs || 16;
      const spokeCount = frameMs2 > 40 ? 6 : frameMs2 > 28 ? 10 : 14;
      for (let k=0;k<spokeCount;k++){
        const ang = (now*0.006) + (Math.PI*2*k/14);
        const tx = fx.x + Math.cos(ang) * (r*0.7);
        const ty = fx.y + Math.sin(ang) * (r*0.7);
        ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang);
        if (evolved) { ctx.shadowColor = '#FF3355'; ctx.shadowBlur = 12; ctx.fillStyle = '#FFB3C0'; }
        else { ctx.shadowColor = '#FFD280'; ctx.shadowBlur = 12; ctx.fillStyle = '#FFE6AA'; }
        const text = cmds[k % cmds.length];
        ctx.fillText(text, -ctx.measureText(text).width/2, 0);
        ctx.restore();
      }
      ctx.restore();
      if (t >= 1) { (window as any).__rogueHackFX = undefined; }
    }
  } catch {}
  // Draw enemies (cached sprite images if enabled)
    // Compute heavy FX budget per frame: start at 32 and scale down under load
    const frameMsForBudget = this.avgFrameMs || 16;
    // Count visible enemies once to scale budgets accurately
    let visibleEnemies = 0;
    for (let i = 0, len = this.activeEnemies.length; i < len; i++) {
      const e = this.activeEnemies[i];
      if (e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY) visibleEnemies++;
    }
    // Global low-FX detection (not just SANDBOX) and load guard
  const sandboxLow = !!((window as any).__gameInstance?.gameMode === 'SANDBOX' && (window as any).__sandboxForceLowFX);
  const globalLow = !!((window as any).__lowFX);
  const underLoad = this.avgFrameMs > 18; // adaptive threshold used elsewhere
  const fxLow = sandboxLow || globalLow || underLoad;
    // Heavy FX slice budget scales down under load; zero when lowFX
  let heavyBudget = fxLow
      ? 0
      : (frameMsForBudget > 55 ? 8 : frameMsForBudget > 40 ? 16 : 32);
  // Cap to a fraction of visible enemies to avoid worst-case storms
  heavyBudget = Math.min(heavyBudget, Math.ceil(visibleEnemies * 0.25));
    // Per-frame budget for RGB glitch ghost overlays (expensive overdraw)
  let glitchBudget = fxLow ? 0 : (frameMsForBudget > 55 ? 4 : frameMsForBudget > 40 ? 8 : 12);
  glitchBudget = Math.min(glitchBudget, Math.ceil(visibleEnemies * 0.15));
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
        // RGB glitch effect: use cached-tint ghosts; cap heavy work per frame (globally gated)
  if (glitchBudget > 0 && !fxLow && (eAny._rgbGlitchUntil || 0) > now) {
          glitchBudget--;
          const tLeft = Math.max(0, Math.min(1, (eAny._rgbGlitchUntil - now) / 220));
          const phase = (eAny._rgbGlitchPhase || 0);
          ctx.save();
          const jx = ((phase * 31) % 3) - 1; // -1..+1
          const jy = (((phase * 47) >> 1) % 3) - 1; // -1..+1
          const ghostOffset = 2 + Math.round(6 * tLeft);
          ctx.globalCompositeOperation = 'lighter';
          // Use pre-tinted ghosts instead of ctx.filter
          const rGhost = flipLeft ? (bundle.redGhostFlipped || bundle.redGhost) : bundle.redGhost;
          const gGhost = flipLeft ? (bundle.greenGhostFlipped || bundle.greenGhost) : bundle.greenGhost;
          const bGhost = flipLeft ? (bundle.blueGhostFlipped || bundle.blueGhost) : bundle.blueGhost;
          // Red left, Blue right, faint Green center
          // Slightly reduce alpha when frame time is high (less overdraw cost)
          const alphaScale = frameMsForBudget > 40 ? 0.8 : 1;
          ctx.globalAlpha = (0.35 + 0.35 * tLeft) * alphaScale;
          if (rGhost) ctx.drawImage(rGhost, drawX - ghostOffset + jx, drawY + jy, size, size);
          if (bGhost) ctx.drawImage(bGhost, drawX + ghostOffset + jx, drawY + jy, size, size);
          ctx.globalAlpha = (0.22 + 0.28 * tLeft) * alphaScale;
          if (gGhost) ctx.drawImage(gGhost, drawX + Math.sign(ghostOffset), drawY, size, size);
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          // Heavy slices only while budget remains; otherwise draw a single shifted copy
          const doHeavy = heavyBudget > 0;
          if (doHeavy) {
            heavyBudget--;
            const sliceBase = frameMsForBudget > 40 ? 4 : 6; // reduce under load
            const sliceVar = frameMsForBudget > 40 ? 2 : 4;
            const sliceCount = sliceBase + (phase % sliceVar); // 4..10
            for (let s = 0; s < sliceCount; s++) {
              const rng = ((phase * 73856093) ^ (s * 19349663)) >>> 0;
              const sy = (rng % (size - 8));
              const sh = 4 + (rng % Math.min(22, size - sy));
              const baseOff = ((rng >> 5) % 25) - 12; // -12..+12 px
              const off = Math.max(-12, Math.min(12, Math.round(baseOff * (0.7 + 0.7 * tLeft))));
              const h = Math.min(sh, size - sy);
              try { ctx.drawImage(baseImg, 0, sy, size, h, drawX + off, drawY + sy, size, h); } catch {}
            }
            // Scanlines reduced under load
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.16 + 0.18 * tLeft;
            ctx.strokeStyle = '#66ccff';
            ctx.lineWidth = 1;
            const lines = frameMsForBudget > 40 ? 2 : 3 + (phase % 2);
            for (let li = 0; li < lines; li++) {
              const y = drawY + ((phase * 13 + li * 11) % (size - 2)) + 1;
              ctx.beginPath(); ctx.moveTo(drawX, y); ctx.lineTo(drawX + size, y); ctx.stroke();
            }
          } else {
            // Lightweight fallback: one shifted blit for a tearing hint
            const off = ((phase * 13) % 9) - 4; // -4..4
            const sy = ((phase * 23) % (size - 10)) | 0;
            const h = Math.min(8, size - sy);
            try { ctx.drawImage(baseImg, 0, sy, size, h, drawX + off, drawY + sy, size, h); } catch {}
          }
          ctx.restore();
        }
        // Psionic mark aura (visible slow indicator) — optimized using cached sprite + load-based budget
        if ((eAny._psionicMarkUntil || 0) > now && psionicGlowBudget > 0) {
          psionicGlowBudget--;
          const baseR = enemy.radius * 1.15; // slightly smaller than before
          const sprite = this.getPsionicGlowSprite(baseR);
          const alphaScale = frameMsBudget > 40 ? 0.45 : frameMsBudget > 28 ? 0.6 : frameMsBudget > 18 ? 0.75 : 0.9;
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.22 * alphaScale; // toned down visibility
          const dx = (enemy.x + shakeX) - (sprite.width >> 1);
          const dy = (enemy.y + shakeY) - (sprite.height >> 1);
          try { ctx.drawImage(sprite, dx, dy); } catch {}
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
            const tint = (lastHit === WeaponType.DATA_SIGIL) ? '#33E6FF' : (lastHit === WeaponType.PSIONIC_WAVE ? '#FF00FF' : '#00FF00');
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
            const tint = (lastHit === WeaponType.DATA_SIGIL) ? '#33E6FF' : (lastHit === WeaponType.PSIONIC_WAVE ? '#FF00FF' : '#00FF00');
            ctx.fillStyle = tint;
            ctx.shadowColor = tint;
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.restore();
          }
        }
      }
    }
    // Lazy-build a crisp sprite for a given tier color and nominal radius (no fuzzy yellow glow)
    const getGemSprite = (tier: number, color: string, baseR: number): HTMLCanvasElement => {
      const key = (tier|0);
      const existing = this.gemSprites.get(key);
      if (existing) return existing;
      const r = Math.max(3, Math.round(baseR));
      const margin = Math.ceil(r * 0.4); // tighter margin since we removed outer glow
      const size = (r + margin) * 2;
      const cnv = document.createElement('canvas'); cnv.width = size; cnv.height = size;
      const c = cnv.getContext('2d');
      if (!c) { this.gemSprites.set(key, cnv); return cnv; }
      const cx = size >> 1, cy = size >> 1;
      // Core star shape (crisp, no shadowBlur or golden gradient)
      c.globalAlpha = 1;
      c.fillStyle = color;
      const spikes = 5, step = Math.PI / spikes;
      c.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const angle = i * step - Math.PI / 2;
        c.lineTo(cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad);
      }
      c.closePath(); c.fill();
      // Thin outline to improve contrast on bright backgrounds
      try {
        c.strokeStyle = 'rgba(255,255,255,0.75)';
        c.lineWidth = Math.max(1, Math.round(r * 0.08));
        c.stroke();
      } catch {}
      this.gemSprites.set(key, cnv);
      return cnv;
    };
    // XP Gems — add last-10s stutter (alpha flicker + tiny jitter/pulse)
  const nowMsG = performance.now();
    for (let i = 0, len = this.gems.length; i < len; i++) {
      const gem = this.gems[i];
      if (!gem.active) continue;
      if (gem.x < minX || gem.x > maxX || gem.y < minY || gem.y > maxY) continue;
  let gx = gem.x, gy = gem.y;
  let r = gem.size;
      let alpha = 1;
      const lifeAbs = (gem as any).lifeMs as number | undefined;
      if (typeof lifeAbs === 'number') {
        const rem = lifeAbs - nowMsG;
        if (rem <= 10000) {
          const prog = Math.max(0, 1 - (rem / 10000)); // 0..1 (near expiry)
          // Simple deterministic jitter that intensifies as expiry nears
          const jit = 0.5 + prog * 1.0; // 0.5..1.5 px
          const phaseA = (Math.floor(nowMsG / 60) + i) & 1;
          const phaseB = (Math.floor(nowMsG / 80) + i) & 1;
          gx += phaseA === 0 ? jit : -jit;
          gy += phaseB === 0 ? jit : -jit;
          // Pulse radius slightly
          r *= 1 + 0.06 * prog;
          // Alpha flicker (stutter): ~8 Hz
          alpha = (Math.floor(nowMsG / 120) & 1) === 0 ? 1 : 0.45;
        }
      }
  // Draw pre-rendered sprite
  ctx.globalAlpha = alpha;
  const sprite = getGemSprite(gem.tier, gem.color, r);
  try { ctx.drawImage(sprite, Math.round(gx - sprite.width / 2), Math.round(gy - sprite.height / 2)); } catch {}
    }
    ctx.globalAlpha = 1;
    for (let i = 0, len = this.chests.length; i < len; i++) {
      const chest = this.chests[i]; if (!chest.active) continue; if (chest.x < minX || chest.x > maxX || chest.y < minY || chest.y > maxY) continue;
      ctx.fillStyle = '#00f';
      ctx.beginPath();
      ctx.arc(chest.x, chest.y, chest.radius, 0, Math.PI*2);
      ctx.fill();
    }
    // Draw special treasures (distinctive crystal with HP bar)
    for (let i = 0; i < this.treasures.length; i++) {
      const t = this.treasures[i]; if (!t.active) continue; if (t.x < minX || t.x > maxX || t.y < minY || t.y > maxY) continue;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const pulse = 0.9 + 0.1 * Math.sin((now + t.seed) * 0.008);
      const r = t.radius * pulse;
      // Hex crystal body
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        const vx = t.x + Math.cos(a) * r;
        const vy = t.y + Math.sin(a) * r;
        if (k === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fillStyle = '#66CCFF';
      ctx.shadowColor = '#66CCFF';
      ctx.shadowBlur = 16;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#E6F7FF';
      ctx.stroke();
      // HP bar
      const pct = Math.max(0, Math.min(1, t.hp / t.maxHp));
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#222';
      ctx.fillRect(t.x - 20, t.y - r - 10, 40, 5);
      ctx.fillStyle = '#0F0';
      ctx.fillRect(t.x - 20, t.y - r - 10, 40 * pct, 5);
      ctx.restore();
    }
    // Draw special items with distinctive icons
    for (let i = 0; i < this.specialItems.length; i++) {
      const it = this.specialItems[i]; if (!it.active) continue; if (it.x < minX || it.x > maxX || it.y < minY || it.y > maxY) continue;
      const type = it.type;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      if (type === 'HEAL') {
        // Red cross with cyan glowing lightning bolt overlay
        // Soft cyan glow backdrop
        ctx.globalAlpha = 0.22;
        ctx.beginPath(); ctx.arc(it.x, it.y, it.radius * 1.15, 0, Math.PI * 2);
        ctx.fillStyle = '#33E6FF'; ctx.shadowColor = '#33E6FF'; ctx.shadowBlur = 16; ctx.fill();
        // Red cross
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        ctx.fillStyle = '#FF2A2A';
        const arm = Math.max(6, it.radius * 0.55);
        const thick = Math.max(5, it.radius * 0.40);
        ctx.fillRect(it.x - thick * 0.5, it.y - arm, thick, arm * 2);
        ctx.fillRect(it.x - arm, it.y - thick * 0.5, arm * 2, thick);
        // Cyan lightning bolt (simple zig-zag)
        ctx.strokeStyle = '#66F9FF'; ctx.lineWidth = 3; ctx.shadowColor = '#66F9FF'; ctx.shadowBlur = 10; ctx.globalAlpha = 0.95;
        ctx.beginPath();
        const b = it.radius * 0.95; // bolt extent
        ctx.moveTo(it.x + b * 0.15, it.y - b * 0.65);
        ctx.lineTo(it.x - b * 0.10, it.y - b * 0.10);
        ctx.lineTo(it.x + b * 0.05, it.y - b * 0.10);
        ctx.lineTo(it.x - b * 0.20, it.y + b * 0.60);
        ctx.stroke();
      } else if (type === 'MAGNET') {
        // Classic horseshoe magnet with white poles
        ctx.globalAlpha = 0.95;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Red U-shape
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.radius, Math.PI * 0.2, Math.PI * 1.8);
        ctx.strokeStyle = '#FF3344'; ctx.shadowColor = '#FF8899'; ctx.shadowBlur = 12; ctx.lineWidth = Math.max(8, it.radius * 0.6); ctx.stroke();
        // White pole tips
        ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(6, it.radius * 0.38);
        ctx.beginPath(); ctx.arc(it.x, it.y, it.radius, Math.PI * 0.18, Math.PI * 0.34); ctx.stroke();
        ctx.beginPath(); ctx.arc(it.x, it.y, it.radius, Math.PI * 1.66, Math.PI * 1.82); ctx.stroke();
      } else {
        // NUKE: skull icon
        // Soft glow
        ctx.globalAlpha = 0.22; ctx.beginPath(); ctx.arc(it.x, it.y, it.radius * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF'; ctx.shadowColor = '#CFE9FF'; ctx.shadowBlur = 14; ctx.fill();
        // Skull head
        ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(it.x, it.y - it.radius * 0.15, it.radius * 0.85, 0, Math.PI * 2); ctx.fill();
        // Jaw
        ctx.fillRect(it.x - it.radius * 0.45, it.y + it.radius * 0.35, it.radius * 0.9, it.radius * 0.35);
        // Eyes
        ctx.fillStyle = '#111';
        ctx.beginPath(); ctx.arc(it.x - it.radius * 0.35, it.y - it.radius * 0.20, it.radius * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(it.x + it.radius * 0.35, it.y - it.radius * 0.20, it.radius * 0.22, 0, Math.PI * 2); ctx.fill();
        // Nose (inverted triangle)
        ctx.beginPath();
        ctx.moveTo(it.x, it.y - it.radius * 0.02);
        ctx.lineTo(it.x - it.radius * 0.10, it.y + it.radius * 0.18);
        ctx.lineTo(it.x + it.radius * 0.10, it.y + it.radius * 0.18);
        ctx.closePath(); ctx.fill();
        // Teeth bars
        ctx.fillStyle = '#DDD';
        const tY = it.y + it.radius * 0.38; const tW = it.radius * 0.10; const tH = it.radius * 0.22;
        for (let k = -2; k <= 2; k++) {
          ctx.fillRect(it.x + k * (tW * 1.2) - tW * 0.5, tY, tW, tH);
        }
      }
      ctx.restore();
    }
    // Draw poison puddles
    for (let i = 0; i < this.poisonPuddles.length; i++) {
      const puddle = this.poisonPuddles[i];
      if (!puddle.active) continue;
      ctx.save();
      const alpha = Math.max(0, Math.min(1, puddle.life / puddle.maxLife));
      if (puddle.isSludge) {
        // Living Sludge: neon green slimy gradient with wobble and bright rim
        const wob = 1.0 + Math.sin((performance.now() + i * 120) * 0.004) * 0.06;
        const r = puddle.radius * wob;
        ctx.globalAlpha = alpha * 0.48;
        const grad = ctx.createRadialGradient(puddle.x, puddle.y, r * 0.30, puddle.x, puddle.y, r);
        grad.addColorStop(0.0, 'rgba(102,255,106,0.55)');
        grad.addColorStop(1.0, 'rgba(0,160,0,0.00)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(puddle.x, puddle.y, r, 0, Math.PI * 2);
        ctx.fill();
        // Rim
        ctx.globalAlpha = alpha * 0.60;
        ctx.strokeStyle = 'rgba(90,240,95,0.65)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(puddle.x, puddle.y, r * 0.98, 0, Math.PI * 2);
        ctx.stroke();
        // Boiling overlay: bubbles + ripples (adaptive under load)
        try {
          const nowB = performance.now();
          const frameMs = this.avgFrameMs || 16;
          const budget = frameMs > 40 ? 0 : (frameMs > 28 ? 1 : 2);
          // Bubbles
          const baseCount = Math.min(6, Math.max(2, Math.floor(r / 28)));
          const count = Math.max(0, baseCount - (budget === 0 ? 2 : budget === 1 ? 1 : 0));
          ctx.globalCompositeOperation = 'screen';
          for (let b = 0; b < count; b++) {
            // Stable pseudo-random per puddle/index using sin hash
            const seed = (i * 131 + b * 977) >>> 0;
            const t = (nowB * 0.001 + (seed % 1000) * 0.001) % 1;
            const ang = ((seed % 628) / 100) + nowB * 0.0007;
            const rad = r * (0.15 + 0.65 * ((seed >> 3) % 100) / 100);
            const bx = puddle.x + Math.cos(ang) * rad * 0.6;
            // Rise from bottom to top
            const by = puddle.y + (0.45 - t) * r * 0.9;
            const br = (2 + ((seed >> 5) % 3)) * (1 + 0.15 * Math.sin(nowB * 0.02 + b));
            ctx.globalAlpha = 0.25 * alpha;
            ctx.fillStyle = 'rgba(200,255,200,0.18)';
            ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.32 * alpha;
            ctx.strokeStyle = 'rgba(190,255,190,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(bx, by, br * (1 + 0.15 * Math.sin(nowB * 0.03 + seed)), 0, Math.PI * 2); ctx.stroke();
          }
          // Ripples: one expanding ring every ~700ms
          const phase = ((nowB + i * 137) % 700) / 700;
          const rr = r * (0.20 + 0.75 * phase);
          ctx.globalAlpha = 0.16 * alpha * (1 - phase);
          ctx.strokeStyle = 'rgba(160,255,160,0.55)';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(puddle.x, puddle.y + r * 0.12, rr, 0, Math.PI * 2); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        } catch { /* ignore */ }
      } else {
        ctx.globalAlpha = alpha * 0.60;
        ctx.beginPath();
        ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#00FF00';
        ctx.shadowColor = '#00FF00';
        ctx.shadowBlur = 15;
        ctx.fill();
        // Light boiling for regular poison (cheaper)
        try {
          const nowB = performance.now();
          const frameMs = this.avgFrameMs || 16;
          if (frameMs <= 28) {
            const r = puddle.radius;
            const bubbles = Math.max(1, Math.min(3, Math.floor(r / 36)));
            ctx.globalCompositeOperation = 'screen';
            for (let b = 0; b < bubbles; b++) {
              const t = ((nowB * 0.0015) + (i * 0.17) + b * 0.31) % 1;
              const ang = nowB * 0.0009 + b;
              const bx = puddle.x + Math.cos(ang) * r * 0.4;
              const by = puddle.y + (0.5 - t) * r * 0.8;
              const br = 1.6 + (b % 2);
              ctx.globalAlpha = 0.18 * alpha; ctx.fillStyle = 'rgba(180,255,180,0.15)';
              ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';
          }
        } catch { /* ignore */ }
      }
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
  
  // Clear and rebuild enemy spatial grid for optimized zone queries
  this.enemySpatialGrid.clear();
  for (let i = 0; i < this.activeEnemies.length; i++) {
    this.enemySpatialGrid.insert(this.activeEnemies[i]);
  }
  // --- Adaptive frame time tracking ---
  // Use a fast EMA to smooth deltaTime (weight 0.1 new value)
  this.avgFrameMs = this.avgFrameMs * 0.9 + deltaTime * 0.1;
  const highLoad = this.avgFrameMs > 40; // ~25 FPS
  const severeLoad = this.avgFrameMs > 55; // <18 FPS
  // Expose to global so other managers (e.g., BulletManager) can adapt emissions
  try { (window as any).__avgFrameMs = this.avgFrameMs; } catch {}
  // Stretch spawn interval under load (caps enemy growth pressure when Electron throttles)
  const targetInterval = severeLoad ? 600 : highLoad ? 450 : 300;
  // Ease toward target to avoid abrupt shifts
  this.spawnIntervalDynamic += (targetInterval - this.spawnIntervalDynamic) * 0.15;
  // Wave-based spawning
    // Dynamic spawning (every 300ms) – disabled in Sandbox mode
    const gm = (window as any).__gameInstance?.gameMode;
    const isSandbox = gm === 'SANDBOX';
    if (!isSandbox) {
      // Skip dynamic spawns while a freeze window is active
      const nowMs = nowFrame;
      if (nowMs < this.spawnFreezeUntilMs) {
        // Drain any accumulated budget to avoid post-freeze burst
        this.dynamicWaveAccumulator = 0;
      } else {
      this.dynamicWaveAccumulator += deltaTime;
      if (this.dynamicWaveAccumulator >= this.spawnIntervalDynamic) {
        this.dynamicWaveAccumulator -= this.spawnIntervalDynamic;
        this.runDynamicSpawner(gameTime);
      }
      }
  }

  // Timed special spawns (items/treasures) in real games
  this.tryScheduledSpecialSpawns(nowFrame);

  // Rogue Hacker: auto-cast a paralysis/DoT zone on cadence, but only one active zone at a time.
    try {
      const isHacker = (this.player as any)?.characterData?.id === 'rogue_hacker';
      if (isHacker) {
        const cooldownReady = nowFrame >= this.hackerAutoCooldownUntil;
        const anyActive = this.hasActiveHackerZone();
        if (cooldownReady && !anyActive) {
          // OPTIMIZATION: Use activeEnemies list instead of all enemies, and limit search distance
          let tx = this.player.x, ty = this.player.y;
          let bestD2 = Number.POSITIVE_INFINITY;
          const maxRange = 600;
          const maxRangeSq = maxRange * maxRange;

          // Search through active enemies only (much smaller list than all enemies)
          for (let i = 0; i < this.activeEnemies.length; i++) {
            const e = this.activeEnemies[i];
            if (!e.active || e.hp <= 0) continue;
            const dx = e.x - this.player.x;
            const dy = e.y - this.player.y;
            const d2 = dx*dx + dy*dy;
            // Early exit if enemy is too far
            if (d2 > maxRangeSq) continue;
            if (d2 < bestD2) {
              bestD2 = d2;
              tx = e.x;
              ty = e.y;
            }
          }

          // Only spawn zone if we found a valid target within range
          if (bestD2 <= maxRangeSq) {
            // Pull evolved spec, if present, to widen zone and extend life
            let r = 120, life = 2000, cdMs = 1500;
            try {
              const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
              const evolved = !!(aw && aw.has(WeaponType.HACKER_BACKDOOR));
              if (evolved) {
                const spec: any = (WEAPON_SPECS as any)[WeaponType.HACKER_BACKDOOR];
                const s = spec?.getLevelStats ? spec.getLevelStats(1) : undefined;
                if (s) { r = s.zoneRadius||r; life = s.zoneLifeMs||life; cdMs = Math.max(900, Math.round((s.dotTickMs||500) * 3)); }
              }
            } catch { /* ignore */ }
            // Scale with global Area multiplier
            try { const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1); r *= (areaMul||1); } catch {}
            this.spawnHackerZone(tx, ty, r, life);
            this.hackerAutoCooldownUntil = nowFrame + cdMs;
          }
        }
      }
    } catch { /* ignore */ }

  // Evolved Rogue Hacker pending chain spawns
  try {
    if (this.pendingHackerZoneSpawns.length) {
      const now = nowFrame;
      let w = 0;
      for (let i=0; i<this.pendingHackerZoneSpawns.length; i++){
        const p = this.pendingHackerZoneSpawns[i];
        if (!p) continue;
        if (now >= p.at) {
          this.spawnHackerZone(p.x, p.y, p.radius, p.lifeMs);
        } else {
          this.pendingHackerZoneSpawns[w++] = p;
        }
      }
      this.pendingHackerZoneSpawns.length = w;
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
  const latticeR = latticeActive ? 352 : 0;
  const latticeR2 = latticeR * latticeR;
  // Lattice periodic damage: every ~0.5s (adaptive), deal 50% of Psionic Wave damage to enemies inside the zone
  if (latticeActive) {
    // Adaptive tick cadence to ease under load
    const tickInterval = severeLoad ? 700 : highLoad ? 600 : this.latticeTickIntervalMs;
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
      // Use spatial grid to query candidates near the player instead of scanning everything
      const candidates = this.enemySpatialGrid.query(px, py, latticeR + 32);
      for (let i = 0; i < candidates.length; i++) {
        const e = candidates[i];
        if (!e.active || e.hp <= 0) continue;
        const dx = e.x - px; const dy = e.y - py;
        if (dx*dx + dy*dy <= latticeR2) {
          this.takeDamage(e, tickDamage);
          const eAny: any = e as any;
          eAny._poisonFlashUntil = nowMs + 120; // reuse flash channel for quick feedback
          (e as any)._lastHitByWeapon = WeaponType.PSIONIC_WAVE;
        }
      }
      // Boss parity for lattice periodic tick
      try {
        const bm: any = (window as any).__bossManager;
        const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const dxB = boss.x - px; const dyB = boss.y - py; const rB = (boss.radius || 160);
          if (dxB*dxB + dyB*dyB <= (latticeR + rB) * (latticeR + rB)) {
            this.takeBossDamage(boss, tickDamage);
          }
        }
      } catch { /* ignore boss lattice errors */ }
      // Treasure parity for lattice periodic tick
      try {
        const emAny: any = this as any;
        if (typeof emAny.getTreasures === 'function') {
          const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
          for (let ti = 0; ti < treasures.length; ti++) {
            const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
            const dxT = t.x - px; const dyT = t.y - py; const rT = (t.radius || 0);
            if (dxT*dxT + dyT*dyT <= (latticeR + rT) * (latticeR + rT) && typeof emAny.damageTreasure === 'function') {
              emAny.damageTreasure(t, tickDamage);
            }
          }
        }
      } catch { /* ignore treasure lattice errors */ }
      this.latticeNextTickMs = nowMs + tickInterval;
    }
  } else {
    // Reset scheduler baseline so first tick fires promptly next activation
    const tickInterval = severeLoad ? 700 : highLoad ? 600 : this.latticeTickIntervalMs;
    this.latticeNextTickMs = nowMs + tickInterval;
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
  // Hacker zones contact handled in a dedicated pass below for better cache behavior
      // Apply knockback velocity if active
  // If enemy is under Black Sun pull, suppress any knockback so pull dominates
  let suppressKbByBlackSun = false;
  if (enemy.knockbackTimer && enemy.knockbackTimer > 0) {
    try { if (this.blackSunZones?.isPointWithinAny(enemy.x, enemy.y, 0)) suppressKbByBlackSun = true; } catch {}
  }
  const nowKb = performance.now();
  const suppressWindow = (enemy as any)._kbSuppressUntil && (nowKb < (enemy as any)._kbSuppressUntil);
  // Additionally suppress during short-lived spawn ring to remove the first-frame outward bump
  let suppressBySpawnRing = false;
  try { if (this.blackSunZones?.shouldSuppressKnockbackAt?.(enemy.x, enemy.y)) suppressBySpawnRing = true; } catch {}
  // Additionally, if Black Sun slow is active, suppress movement knockback
  let suppressBySlow = false;
  try { const now = performance.now(); const eAny3: any = enemy as any; if (eAny3._blackSunSlowUntil && now < eAny3._blackSunSlowUntil) suppressBySlow = true; } catch {}
  if (enemy.knockbackTimer && enemy.knockbackTimer > 0 && !suppressKbByBlackSun && !suppressWindow && !suppressBySpawnRing && !suppressBySlow) {
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
        // Clear any residual knockback when suppression is active so enemies don't "pop" after window
        if (suppressKbByBlackSun || suppressWindow || suppressBySpawnRing || suppressBySlow) {
          enemy.knockbackVx = 0;
          enemy.knockbackVy = 0;
          enemy.knockbackTimer = 0;
        }
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
      // Spectral Executioner: if a specter mark expired on a still-alive target, trigger execution now
      {
        const anyE: any = enemy as any;
        const until = anyE._specterMarkUntil || 0;
        if (until > 0 && nowFrame >= until && enemy.hp > 0) {
          // Fire execution from stored origin (falls back to player location if missing)
          try { this.executeSpecterExecution(enemy, 'expire'); } catch { /* ignore */ }
        }
      }
      // Boss parity: also trigger boss mark expiry executes (checked once per loop cheaply)
      try {
        this.executeBossSpecterExecution('expire');
      } catch { /* ignore */ }
      // Player-enemy collision (do not apply for Sandbox dummies)
      if (dist < enemy.radius + this.player.radius) {
        const isDummy = (enemy as any)._isDummy === true;
        if (!isDummy) {
        // Hit cooldown: enemies can damage player at most once per second
        const now = performance.now();
        const lastHit = (enemy as any)._lastPlayerHitTime || 0;
        if (now - lastHit >= 1000) {
          (enemy as any)._lastPlayerHitTime = now;
          // Compute damage with special rule: basic (small) enemies deal 2× damage, then clamp into 1..10
          let baseDmg = enemy.damage || 1;
          if (enemy.type === 'small') baseDmg *= 2;
          const dmg = Math.min(10, Math.max(1, Math.round(baseDmg)));
          // Skip damage during revive cinematic
          const reviving = !!(window as any).__reviveCinematicActive;
          if (!reviving) this.player.takeDamage(dmg);
          // Skip knockback while reviving (player is unhittable/immovable during revive)
          if (!reviving) {
            // Apply small knockback to player away from enemy
            const kdx = (this.player.x - enemy.x);
            const kdy = (this.player.y - enemy.y);
            const kd = Math.hypot(kdx, kdy) || 1;
            const kb = 24 * (this.player.getKnockbackMultiplier ? this.player.getKnockbackMultiplier() : 1); // respect player KB resistance
            this.player.x += (kdx / kd) * kb;
            this.player.y += (kdy / kd) * kb;
          }
        }
        }
      }
  // Bullet collisions handled centrally in BulletManager.update now (removed duplicate per-enemy pass)
      // Death handling
      if (enemy.hp <= 0 && enemy.active) {
        // Spectral Executioner: if the dying enemy is marked, trigger death execution + chain before pooling
        try {
          const eAny: any = enemy as any;
          if (eAny._specterMarkUntil || eAny._specterMarkFrom) {
            this.executeSpecterExecution(enemy, 'death');
          }
        } catch { /* ignore */ }
        const isDummy = (enemy as any)._isDummy === true;
        enemy.active = false;
        // Skip on dummy targets
  if (!isDummy) {
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
          // Evolved Rogue Hacker: chain new zones on kill if victim was inside a hacker zone
          try {
            const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
            if (aw && aw.has(WeaponType.HACKER_BACKDOOR)) {
              // Check if within any active hacker zone at the moment of death
              let inZone = false;
              let baseRadius = 120, lifeMs = 2000, chainCount = 0, chainRadius = 0, chainDelayMs = 0;
              try {
                const spec: any = (WEAPON_SPECS as any)[WeaponType.HACKER_BACKDOOR];
                const s = spec?.getLevelStats ? spec.getLevelStats(1) : undefined;
                if (s) { baseRadius = s.zoneRadius||120; lifeMs = s.zoneLifeMs||2000; chainCount = s.chainCount|0; chainRadius = s.chainRadius|0; chainDelayMs = s.chainDelayMs|0; }
              } catch {}
              for (let zi=0; zi<this.hackerZones.length; zi++){
                const z = this.hackerZones[zi]; if (!z.active) continue;
                const dx = enemy.x - z.x, dy = enemy.y - z.y; const rr = z.radius + (enemy.radius||0);
                if (dx*dx + dy*dy <= rr*rr) { inZone = true; break; }
              }
              if (inZone && chainCount > 0) {
                // Find up to N nearest enemies to seed new zones on
                const nearby = this.enemySpatialGrid.query(enemy.x, enemy.y, Math.max(chainRadius, 200));
                const cands: {e: Enemy; d2:number}[] = [];
                for (let j=0; j<nearby.length; j++){
                  const e2 = nearby[j]; if (!e2.active || e2.hp <= 0 || e2 === enemy) continue;
                  const dx2 = e2.x - enemy.x, dy2 = e2.y - enemy.y; const d2 = dx2*dx2 + dy2*dy2;
                  if (chainRadius <= 0 || d2 <= chainRadius*chainRadius) cands.push({ e: e2, d2 });
                }
                cands.sort((a,b)=>a.d2-b.d2);
                const nowC = performance.now();
                for (let k=0; k<Math.min(chainCount, cands.length); k++){
                  const host = cands[k].e;
                  this.pendingHackerZoneSpawns.push({ x: host.x, y: host.y, radius: baseRadius, lifeMs, at: nowC + chainDelayMs + k*40 });
                }
              }
            }
          } catch { /* ignore */ }
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
        }
        // Passive: AOE On Kill
        const playerAny: any = this.player as any;
        if (playerAny.hasAoeOnKill && !isDummy) {
          const gdm = playerAny.getGlobalDamageMultiplier?.() ?? (playerAny.globalDamageMultiplier ?? 1);
          const frac = playerAny.aoeOnKillDamageFrac ?? 0.4;
          const dmg = (this.player.bulletDamage || 10) * gdm * frac;
          const areaMul = playerAny.getGlobalAreaMultiplier?.() ?? (playerAny.globalAreaMultiplier ?? 1);
          const baseR = playerAny.aoeOnKillRadiusBase ?? 70;
          const radius = baseR * (areaMul || 1); // modest radius to avoid chain wipes
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

    // Rogue Hacker zones: apply one-time paralysis + schedule DoT on first contact per zone
    if (this.hackerZones.length) {
      const nowHz = nowFrame;
      // Precompute weapon level and damage multiplier once
      let lvl = 1;
      let evolved = false;
  let tracePulseMs = 0;
  let tracePulseFrac = 0;
  let vulnFrac = 0;
  let vulnLingerMs = 0;
  let paralyzeMsOverride: number | undefined = undefined;
      let dotTicksOverride: number | undefined = undefined;
      let dotTickMsOverride: number | undefined = undefined;
  // Sustained DPS parameters
  let sustainDps = 0;
  let sustainTickMs = 0;
      try {
        const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
        if (aw && typeof aw.get === 'function') {
          if (aw.has(WeaponType.HACKER_BACKDOOR)) { evolved = true; }
          lvl = aw.get(WeaponType.HACKER_VIRUS) || aw.get(WeaponType.HACKER_BACKDOOR) || 1;
        }
      } catch {}
      const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
      const perTickBase = Math.max(8, Math.round((10 + lvl * 7) * gdm));
      // If evolved, fetch spec-derived overrides once
      if (evolved) {
        try {
          const spec: any = (WEAPON_SPECS as any)[WeaponType.HACKER_BACKDOOR];
          const s = spec?.getLevelStats ? spec.getLevelStats(1) : undefined;
          if (s) {
            paralyzeMsOverride = s.paralyzeMs|0;
            dotTicksOverride = s.dotTicks|0;
            dotTickMsOverride = s.dotTickMs|0;
            tracePulseMs = s.tracePulseMs|0;
            tracePulseFrac = Number(s.tracePulseFrac||0) || 0;
            vulnFrac = Number(s.vulnFrac||0) || 0;
            vulnLingerMs = Number(s.vulnLingerMs||0) || 0;
            sustainDps = Math.max(0, Number(s.sustainDps||0) || 0);
            sustainTickMs = Math.max(60, Number(s.sustainTickMs||0) || 0);
          }
        } catch { /* ignore */ }
      }
      // Process only active zones and only if within lifetime
      for (let zi = 0; zi < this.hackerZones.length; zi++) {
        const z = this.hackerZones[zi];
        if (!z.active) continue;
        if (nowHz - z.created > z.lifeMs) continue;
  const rEff = z.radius; // enemy radius will be added per-enemy
        const stamp = z.stamp;
        // OPTIMIZATION: Use spatial grid to query only nearby enemies instead of iterating all activeEnemies
        const nearbyEnemies = this.enemySpatialGrid.query(z.x, z.y, rEff + 50); // +50 for safety margin
        for (let i = 0; i < nearbyEnemies.length; i++) {
          const e = nearbyEnemies[i];
          if (!e.active || e.hp <= 0) continue;
          const anyE: any = e as any;
          // Skip if this enemy already processed for this zone
          if (anyE._lastHackerStamp === stamp) continue;
          const dx = e.x - z.x; const dy = e.y - z.y;
          // Quick circle-circle with sum radii: (r+re)^2
          const rr = rEff + (e.radius || 0);
          if (dx*dx + dy*dy <= rr * rr) {
            anyE._lastHackerStamp = stamp;
            // Apply paralysis and schedule DoT
            const parMs = (paralyzeMsOverride ?? 1500);
            const tickMs = (dotTickMsOverride ?? 500);
            const ticks = (dotTicksOverride ?? 3);
            anyE._paralyzedUntil = Math.max(anyE._paralyzedUntil || 0, nowHz + parMs);
            anyE._hackerDot = { nextTick: nowHz + tickMs, ticksLeft: ticks, perTick: perTickBase, cadenceMs: tickMs } as any;
            anyE._rgbGlitchUntil = nowHz + 260;
            anyE._rgbGlitchPhase = ((anyE._rgbGlitchPhase || 0) + 1) % 7;
            // Evolved: apply vulnerability while in zone (and linger briefly after exit)
            if (vulnFrac > 0) {
              anyE._hackerVulnUntil = Math.max(anyE._hackerVulnUntil || 0, nowHz + Math.max(tickMs, 180));
              anyE._hackerVulnFrac = vulnFrac;
              anyE._hackerVulnLingerMs = Math.max(0, vulnLingerMs|0);
            }
            (e as any)._lastHitByWeapon = WeaponType.HACKER_VIRUS;
          }
        }
        // Boss parity: zones also affect boss within radius
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
            const bAny: any = boss as any;
            if (bAny._lastHackerStamp !== stamp) {
              const dxB = boss.x - z.x; const dyB = boss.y - z.y;
              const rBoss = (boss.radius || 160);
              if (dxB*dxB + dyB*dyB <= (rEff + rBoss) * (rEff + rBoss)) {
                bAny._lastHackerStamp = stamp;
                const parMsB = (paralyzeMsOverride ?? 1200);
                const tickMsB = (dotTickMsOverride ?? 500);
                const ticksB = (dotTicksOverride ?? 3);
                bAny._paralyzedUntil = Math.max(bAny._paralyzedUntil || 0, nowHz + parMsB);
                bAny._hackerDot = { nextTick: nowHz + tickMsB, ticksLeft: ticksB, perTick: perTickBase, cadenceMs: tickMsB } as any;
                bAny._rgbGlitchUntil = nowHz + 260;
                bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 1) % 7;
                // Tag last-hit for FX routing
                bAny._lastHitByWeapon = WeaponType.HACKER_VIRUS;
                if (vulnFrac > 0) {
                  bAny._hackerVulnUntil = Math.max(bAny._hackerVulnUntil || 0, nowHz + Math.max(tickMsB, 180));
                  bAny._hackerVulnFrac = vulnFrac;
                  bAny._hackerVulnLingerMs = Math.max(0, vulnLingerMs|0);
                }
              }
            }
          }
        } catch { /* ignore boss zone errors */ }

        // Sustained DPS tick while inside zone (evolved only)
        if (evolved && sustainDps > 0 && sustainTickMs > 0) {
          const zAny: any = z as any;
          if (!zAny._nextSustainAt) zAny._nextSustainAt = nowHz + sustainTickMs;
          let guard = 5; // prevent spiral on long frames
          while (guard-- > 0 && nowHz >= zAny._nextSustainAt) {
            zAny._nextSustainAt += sustainTickMs;
            const perTick = (sustainDps * (sustainTickMs / 1000)) * gdm;
            const nearby = this.enemySpatialGrid.query(z.x, z.y, rEff + 50);
            for (let i = 0; i < nearby.length; i++) {
              const e = nearby[i]; if (!e.active || e.hp <= 0) continue;
              const dx = e.x - z.x; const dy = e.y - z.y;
              const rr = rEff + (e.radius || 0);
              if (dx*dx + dy*dy <= rr * rr) {
                this.takeDamage(e, perTick, false, false, WeaponType.HACKER_VIRUS, z.x, z.y, undefined, true);
              }
            }
            // Boss sustain tick
            try {
              const bm: any = (window as any).__bossManager;
              const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
              if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
                const dxB = boss.x - z.x; const dyB = boss.y - z.y; const rBoss = (boss.radius || 160);
                if (dxB*dxB + dyB*dyB <= (rEff + rBoss) * (rEff + rBoss)) {
                  this.takeBossDamage(boss, perTick, false, WeaponType.HACKER_VIRUS, z.x, z.y, undefined, true);
                }
              }
            } catch { /* ignore */ }
            // Treasure sustain tick
            try {
              const emAny: any = this as any;
              if (typeof emAny.getTreasures === 'function') {
                const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
                for (let ti = 0; ti < treasures.length; ti++) {
                  const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                  const dxT = t.x - z.x, dyT = t.y - z.y; const rT = (t.radius || 0);
                  if (dxT*dxT + dyT*dyT <= (rEff + rT) * (rEff + rT) && typeof emAny.damageTreasure === 'function') {
                    emAny.damageTreasure(t, perTick);
                  }
                }
              }
            } catch { /* ignore treasure sustain errors */ }
          }
        }
      }
    }

    // Rogue Hacker DoT ticking (base 3 ticks over ~1.5s; evolved may override cadence/ticks)
    {
  const now = nowFrame;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e: any = this.activeEnemies[i] as any;
  const dot = e._hackerDot as { nextTick:number; ticksLeft:number; perTick:number; cadenceMs?: number } | undefined;
        if (!dot || e.hp <= 0) continue;
        let safety = 3;
        while (dot.ticksLeft > 0 && now >= dot.nextTick && safety-- > 0) {
          dot.ticksLeft--;
          // Preserve original spacing if not overridden (dot was created with the right cadence)
          dot.nextTick += Math.max(60, (dot.cadenceMs ?? 500));
          this.takeDamage(e as Enemy, dot.perTick, false, false, WeaponType.HACKER_VIRUS, undefined, undefined, undefined, true);
          // RGB glitch flash for hacker DoT (no green poison flash)
          e._rgbGlitchUntil = now + 260;
          e._rgbGlitchPhase = ((e._rgbGlitchPhase || 0) + 1) % 7;
        }
        if (dot.ticksLeft <= 0) {
          e._hackerDot = undefined;
        }
      }
    }

    // Neural Threader primer DoT ticking (enables tether linking via debuff presence)
    {
      const now = nowFrame;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e: any = this.activeEnemies[i] as any;
        const ndot = e._neuralDot as { next: number; left: number; dmg: number } | undefined;
        if (!ndot || e.hp <= 0) continue;
        let guard = 4;
        while (ndot.left > 0 && now >= ndot.next && guard-- > 0) {
          ndot.left--;
          ndot.next += 500;
          this.takeDamage(e as Enemy, ndot.dmg, false, false, WeaponType.NOMAD_NEURAL, undefined, undefined, undefined, true);
          // teal flash channel reuse
          e._rgbGlitchUntil = now + 200;
          e._rgbGlitchPhase = ((e._rgbGlitchPhase || 0) + 1) % 7;
        }
        if (ndot.left <= 0 || (e._neuralDebuffUntil || 0) < now) {
          e._neuralDot = undefined;
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
          this.takeDamage(e as Enemy, vdot.dmg, false, false, WeaponType.VOID_SNIPER, undefined, undefined, undefined, true);
          // Visual feedback: purple flash reuse channel
          e._poisonFlashUntil = now + 120;
        }
        if (vdot.left <= 0) {
          e._voidSniperDot = undefined;
        }
      }
    }

    // Oracle Array DoT ticking (paralyzing DoT applied on hit): 3 ticks at 500ms; stacks add to per-tick damage
    {
      const now = nowFrame;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e: any = this.activeEnemies[i] as any;
        const odot = e._oracleDot as { next: number; left: number; dmg: number } | undefined;
        if (!odot || e.hp <= 0) continue;
        let guard = 4;
        while (odot.left > 0 && now >= odot.next && guard-- > 0) {
          odot.left--;
          odot.next += 500;
          this.takeDamage(e as Enemy, odot.dmg, false, false, WeaponType.ORACLE_ARRAY, undefined, undefined, undefined, true);
          // Soft golden glitch flash
          e._rgbGlitchUntil = now + 160; e._rgbGlitchPhase = ((e._rgbGlitchPhase || 0) + 1) % 7;
        }
        if (odot.left <= 0) e._oracleDot = undefined;
      }
    }

    // Glyph Compiler light DoT ticking (2 ticks at 500ms; stacks add to per-tick damage)
    {
      const now = nowFrame;
      for (let i = 0; i < this.activeEnemies.length; i++) {
        const e: any = this.activeEnemies[i] as any;
        const gdot = e._glyphDot as { next: number; left: number; dmg: number } | undefined;
        if (!gdot || e.hp <= 0) continue;
        let guard = 3;
        while (gdot.left > 0 && now >= gdot.next && guard-- > 0) {
          gdot.left--;
          gdot.next += 500;
          this.takeDamage(e as Enemy, gdot.dmg, false, false, WeaponType.GLYPH_COMPILER, undefined, undefined, undefined, true);
          e._rgbGlitchUntil = now + 120; e._rgbGlitchPhase = ((e._rgbGlitchPhase || 0) + 1) % 7;
        }
        if (gdot.left <= 0) e._glyphDot = undefined;
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
          // Neural Threader primer DoT on boss
          const ndot = bAny._neuralDot as { next: number; left: number; dmg: number } | undefined;
          if (ndot) {
            let guard = 4;
            while (ndot.left > 0 && now >= ndot.next && guard-- > 0) {
              ndot.left--;
              ndot.next += 500;
              this.takeBossDamage(boss, ndot.dmg, false, WeaponType.NOMAD_NEURAL, boss.x, boss.y, undefined, true);
              bAny._rgbGlitchUntil = now + 200; bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 1) % 7;
            }
            if (ndot.left <= 0 || (bAny._neuralDebuffUntil || 0) < now) {
              bAny._neuralDot = undefined;
            }
          }
        // Hacker DoT on boss: nextTick/ticksLeft/perTick at 500ms cadence
        const hdot = bAny._hackerDot as { nextTick: number; ticksLeft: number; perTick: number } | undefined;
        if (hdot && hdot.ticksLeft > 0) {
          let guard = 4;
          while (hdot.ticksLeft > 0 && now >= hdot.nextTick && guard-- > 0) {
            hdot.ticksLeft--;
            hdot.nextTick += 500;
            this.takeBossDamage(boss, hdot.perTick, false, WeaponType.HACKER_VIRUS, boss.x, boss.y, undefined, true);
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
            this.takeBossDamage(boss, vdotB.dmg, false, WeaponType.VOID_SNIPER, boss.x, boss.y, undefined, true);
            // Use damage flash maintained inside takeBossDamage
          }
          if (vdotB.left <= 0) bAny._voidSniperDot = undefined;
        }

        // Oracle Array DoT on boss: next/left/dmg at 500ms cadence
        const odotB = bAny._oracleDot as { next: number; left: number; dmg: number } | undefined;
        if (odotB && odotB.left > 0) {
          let g3 = 4;
          while (odotB.left > 0 && now >= odotB.next && g3-- > 0) {
            odotB.left--;
            odotB.next += 500;
            this.takeBossDamage(boss, odotB.dmg, false, WeaponType.ORACLE_ARRAY, boss.x, boss.y, undefined, true);
            bAny._rgbGlitchUntil = now + 160; bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 1) % 7;
          }
          if (odotB.left <= 0) bAny._oracleDot = undefined;
        }

        // Glyph Compiler DoT on boss: 2 ticks at 500ms cadence
        const gdotB = bAny._glyphDot as { next: number; left: number; dmg: number } | undefined;
        if (gdotB && gdotB.left > 0) {
          let g4 = 3;
          while (gdotB.left > 0 && now >= gdotB.next && g4-- > 0) {
            gdotB.left--;
            gdotB.next += 500;
            this.takeBossDamage(boss, gdotB.dmg, false, WeaponType.GLYPH_COMPILER, boss.x, boss.y, undefined, true);
            bAny._rgbGlitchUntil = now + 120; bAny._rgbGlitchPhase = ((bAny._rgbGlitchPhase || 0) + 1) % 7;
          }
          if (gdotB.left <= 0) bAny._glyphDot = undefined;
        }
      }
    } catch { /* ignore boss dot tick errors */ }

    // Deactivate expired hacker zones (and schedule evolved chain spawns and trace pulses)
    {
      const now = nowFrame;
      // Evolved spec lookup (if present)
      let evolved = false;
      let chainCount = 0, chainRadius = 0, chainDelayMs = 0, tracePulseMs = 0, tracePulseFrac = 0;
      try {
        const aw = (this.player as any)?.activeWeapons as Map<number, number> | undefined;
        evolved = !!(aw && aw.has(WeaponType.HACKER_BACKDOOR));
        if (evolved) {
          const spec: any = (WEAPON_SPECS as any)[WeaponType.HACKER_BACKDOOR];
          const s = spec?.getLevelStats ? spec.getLevelStats(1) : undefined;
          if (s) {
            chainCount = s.chainCount|0; chainRadius = s.chainRadius|0; chainDelayMs = s.chainDelayMs|0; tracePulseMs = s.tracePulseMs|0; tracePulseFrac = Number(s.tracePulseFrac||0) || 0;
          }
        }
      } catch {}
      for (let i = 0; i < this.hackerZones.length; i++) {
        const z = this.hackerZones[i];
        if (!z.active) continue;
        const age = now - z.created;
        // Periodic trace pulse while active (bonus damage to enemies in-zone)
        if (evolved && tracePulseMs > 0) {
          if (!(z as any)._nextTraceAt) (z as any)._nextTraceAt = z.created + tracePulseMs;
          if (now >= (z as any)._nextTraceAt) {
            (z as any)._nextTraceAt += tracePulseMs;
            const bonus = Math.max(1, Math.round((10 + ((this.player as any)?.level||1) * 5) * ((this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1)) * tracePulseFrac));
            // Query enemies within zone and apply small bonus damage
            const nearby = this.enemySpatialGrid.query(z.x, z.y, z.radius + 50);
            for (let j=0;j<nearby.length;j++){
              const e = nearby[j]; if (!e.active || e.hp <= 0) continue;
              const dx = e.x - z.x, dy = e.y - z.y; if (dx*dx + dy*dy > (z.radius + e.radius)*(z.radius + e.radius)) continue;
              this.takeDamage(e, bonus, false, false, WeaponType.HACKER_VIRUS);
            }
          }
        }
        if (age > z.lifeMs) {
          z.active = false;
          // On natural expiry, no chain. Chains only occur on kills inside zone; hook is elsewhere.
        }
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
      const nowMs = performance.now();
      for (let i = 0, len = this.gems.length; i < len; i++) {
        const g = this.gems[i];
        if (!g.active) continue;
        // TTL expiry (lifeMs stores absolute timestamp)
        if (g.lifeMs && nowMs >= (g.lifeMs as number)) { g.active = false; this.gemPool.push(g); continue; }
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
          // Ease-in style pull: stronger when closer; sqrt-free approximation via squared distances
          const t = 1 - Math.min(1, d2 / magnetR2); // 0 far .. 1 near
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
  // Point activeGems to compacted storage (no allocations)
  this.activeGems = this.gems;
    }
    this.handleGemMerging();

    // Update chests
    this.updateChests(deltaTime);
  // Update treasures (bullet collision + death -> drop special)
  this.updateTreasures(deltaTime, bullets);
  // Update special items (magnet drift + pickup + TTL)
  this.updateSpecialItems(deltaTime);

  // Poison puddle update (ensure this runs every frame; now ms-based)
  this.updatePoisonPuddles(deltaTime);
  // Burn status updates
  this.updateBurns();
  // Poison status updates
  this.updatePoisons();
  // Data Sigils updates
  this.updateDataSigils(deltaTime);
  // Update Black Sun zones (pull/slow/tick/collapse)
  try { this.blackSunZones.update(deltaTime); } catch {}
}
  /** Clear all currently active enemies immediately (used on boss spawn). */
  private clearAllEnemies() {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (e && e.active) {
        e.active = false;
        this.enemyPool.push(e);
      }
    }
    // Active cache rebuilt next update
  }
  /** Total enemies killed this run. */
  public getKillCount() { return this.killCount; }

  /**
   * Spawn a basic enemy of the given type at world coordinates.
   * For Sandbox/testing use. HP can be overridden; other stats derive from type defaults.
   */
  public spawnEnemyAt(x: number, y: number, opts: { type: Enemy['type']; hp?: number }): Enemy {
    let e = this.enemyPool.pop() as Enemy | undefined;
    if (!e) e = { x: 0, y: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, active: false, type: 'small', damage: 0, id: '' } as Enemy;
    const enemy = e as Enemy;
    const type = opts.type;
    enemy.type = type;
    // Defaults match spawnEnemy type presets (early game values)
    if (type === 'small') { enemy.radius = 20; enemy.speed = 0.30 * this.enemySpeedScale; enemy.damage = 4; enemy.hp = opts.hp ?? 100; }
    else if (type === 'medium') { enemy.radius = 30; enemy.speed = 0.65 * 0.30 * this.enemySpeedScale; enemy.damage = 7; enemy.hp = opts.hp ?? 220; }
    else { enemy.radius = 38; enemy.speed = 0.42 * 0.28 * this.enemySpeedScale; enemy.damage = 10; enemy.hp = opts.hp ?? 480; }
    enemy.maxHp = enemy.hp; enemy.active = true; enemy.x = x; enemy.y = y; enemy.id = 'sb-' + Math.floor(Math.random() * 1e9);
    // Clear status flags likely present on pooled instance
    const anyE: any = enemy as any; anyE._isDummy = false; anyE._poisonStacks = 0; anyE._burnStacks = 0; anyE._poisonExpire = 0; anyE._burnExpire = 0; anyE._burnTickDamage = 0;
    this.enemies.push(enemy);
    return enemy;
  }

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
    // Emphasize HP/damage/knockback resistance growth over time; keep speed mostly flat
    {
      const minutes = Math.max(0, gameTime / 60);
      // HP grows strongly into late game; tuned to ~6x at 10m
      const hpMul = 1 + 0.20 * minutes + 0.03 * minutes * minutes;
      // Damage grows modestly; tuned to ~2.6x at 10m
      const dmgMul = 1 + 0.06 * minutes + 0.01 * minutes * minutes;
      // Knockback resistance ramps up; cap to avoid complete immunity
      const kbResist = Math.min(0.75, 0.05 * minutes + 0.008 * minutes * minutes);
      enemy.hp = Math.max(1, Math.round(enemy.hp * hpMul));
      enemy.maxHp = enemy.hp;
      enemy.damage = Math.max(1, Math.round(enemy.damage * dmgMul));
      (enemy as any)._kbResist = kbResist;
      // Keep speed conservative: optional tiny uptick late, capped
      const speedMul = 1 + Math.min(0.12, 0.01 * minutes);
      enemy.speed *= speedMul;
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
  // Ensure kb resist exists on newly spawned enemies even if gameTime was 0
  if ((eAny as any)._kbResist === undefined) (eAny as any)._kbResist = 0;
    this.enemies.push(enemy);
    this.enemySpatialGrid.insert(enemy); // Add to spatial grid for optimized zone queries
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
      gem = { x: 0, y: 0, vx: 0, vy: 0, life: 0, lifeMs: 0, size: 0, value: 0, active: false, tier: 1, color: '#33E6FF' } as any;
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
  gg.lifeMs = (GEM_TTL_MS|0) > 0 ? (performance.now() + (GEM_TTL_MS|0)) : undefined; // absolute expiry timestamp (ms)
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

  /** Spawn a special item at x,y; type optional -> random. */
  private spawnSpecialItem(x: number, y: number, type?: SpecialItem['type']) {
    let it = this.specialItemPool.pop();
    if (!it) it = { x: 0, y: 0, radius: 14, active: false, type: 'HEAL', ttlMs: 0 };
    it.x = x; it.y = y; it.radius = 14; it.active = true; it.type = type || (Math.random() < 0.34 ? 'HEAL' : Math.random() < 0.5 ? 'MAGNET' : 'NUKE');
    it.ttlMs = performance.now() + 30000; // 30s lifetime
    this.specialItems.push(it);
  }

  /** Spawn a destructible treasure that drops a random special item. */
  private spawnTreasure(x: number, y: number, hp: number = 200) {
    let t = this.treasurePool.pop();
    if (!t) t = { x: 0, y: 0, radius: 22, active: false, hp: 0, maxHp: 0, seed: 0 };
    t.x = x; t.y = y; t.radius = 22; t.active = true; t.hp = hp; t.maxHp = hp; t.seed = Math.floor(Math.random()*1e6);
    this.treasures.push(t);
  }

  /**
   * Public API: Apply damage to a treasure object and handle destruction side-effects.
   * Used by systems that deal non-bullet damage (e.g., AoE pulses) so we don't rely solely on bullet overlap.
   */
  public damageTreasure(t: SpecialTreasure, amount: number): void {
    if (!t || !t.active || amount <= 0) return;
    t.hp -= amount;
    if (this.particleManager) this.particleManager.spawn(t.x, t.y, 1, '#B3E5FF');
    if (t.hp <= 0) {
      t.active = false;
      this.treasurePool.push(t);
      // Drop random special item at treasure location (mirror updateTreasures behavior)
      const roll = Math.random();
      const type: SpecialItem['type'] = roll < 0.34 ? 'HEAL' : roll < 0.67 ? 'MAGNET' : 'NUKE';
      this.spawnSpecialItem(t.x, t.y, type);
      try { this.particleManager?.spawn(t.x, t.y, 10, '#66CCFF', { sizeMin: 1, sizeMax: 3, lifeMs: 420, speedMin: 1.5, speedMax: 3.5 }); } catch {}
    }
  }

  /** Update treasures: take bullet damage; on destroy, drop a random special item. */
  private updateTreasures(deltaTime: number, bullets: Bullet[]) {
    // Clamp to walkable and handle bullet collisions
    const rm = (window as any).__roomManager;
    for (let i = 0; i < this.treasures.length; i++) {
      const t = this.treasures[i]; if (!t.active) continue;
      if (rm && typeof rm.clampToWalkable === 'function') {
        const c = rm.clampToWalkable(t.x, t.y, t.radius);
        t.x = c.x; t.y = c.y;
      }
      // Bullet collisions (simple loop; low counts typical). Use squared distances.
      for (let b = 0; b < bullets.length; b++) {
        const bullet = bullets[b]; if (!bullet.active) continue;
        // Allow Resonant Web orbiting orbs to pass through treasures without being destroyed or dealing contact damage
        if ((bullet as any).isOrbiting && (bullet as any).weaponType === WeaponType.RESONANT_WEB) {
          // Explicitly skip WEB orbiters; their damage comes from pulses/auto-casts, not contact
          continue;
        }
        // Also allow Quantum Halo orbs to pass through treasures; they use orbit contact and periodic pulses
        if ((bullet as any).isOrbiting && (bullet as any).weaponType === WeaponType.QUANTUM_HALO) {
          continue;
        }
        const dx = bullet.x - t.x; const dy = bullet.y - t.y;
        const rr = (t.radius + bullet.radius); if (dx*dx + dy*dy > rr*rr) continue;
        // Hit!
        t.hp -= bullet.damage;
        bullet.active = false;
        if (this.particleManager) this.particleManager.spawn(t.x, t.y, 1, '#B3E5FF');
        if (t.hp <= 0) {
          t.active = false; this.treasurePool.push(t);
          // Drop random special item at treasure location
          const roll = Math.random();
          const type: SpecialItem['type'] = roll < 0.34 ? 'HEAL' : roll < 0.67 ? 'MAGNET' : 'NUKE';
          this.spawnSpecialItem(t.x, t.y, type);
          // Small burst
          try { this.particleManager?.spawn(t.x, t.y, 10, '#66CCFF', { sizeMin: 1, sizeMax: 3, lifeMs: 420, speedMin: 1.5, speedMax: 3.5 }); } catch {}
          break;
        }
      }
    }
    // Compact active list
    {
      let w = 0; for (let r = 0; r < this.treasures.length; r++) { const t = this.treasures[r]; if (t.active) this.treasures[w++] = t; }
      this.treasures.length = w;
    }
  }

  /** Update items: magnet drift to player, pickup handling, TTL expiry. */
  private updateSpecialItems(deltaTime: number) {
    const px = this.player.x, py = this.player.y;
    const magnetR = Math.max(0, this.player.magnetRadius || 0);
    const magnetR2 = magnetR * magnetR;
    const pickupR = Math.max(28, this.player.radius + 10);
    const now = performance.now();
    for (let i = 0; i < this.specialItems.length; i++) {
      const it = this.specialItems[i]; if (!it.active) continue;
      // TTL
      if (it.ttlMs && now >= it.ttlMs) { it.active = false; this.specialItemPool.push(it); continue; }
      // Gentle magnet
      const dx = px - it.x; const dy = py - it.y; const d2 = dx*dx + dy*dy;
      if (magnetR > 0 && d2 < magnetR2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const t = 1 - Math.min(1, d / magnetR);
        const pull = (0.06 + t * 0.20);
        const frameFactor = pull * (deltaTime / 16.6667);
        it.x += dx * frameFactor; it.y += dy * frameFactor;
      }
      // Pickup
      if (d2 < pickupR * pickupR) {
        this.applySpecialItemEffect(it.type);
        it.active = false; this.specialItemPool.push(it);
      }
    }
    // Compact
    {
      let w = 0; for (let r = 0; r < this.specialItems.length; r++) { const it = this.specialItems[r]; if (it.active) this.specialItems[w++] = it; }
      this.specialItems.length = w;
    }
  }

  /** Apply special item effects. */
  private applySpecialItemEffect(type: SpecialItem['type']) {
    if (type === 'HEAL') {
  const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
  const eff = getHealEfficiency(timeSec);
  const amount = Math.max(1, Math.round(this.player.maxHp * 0.10 * eff));
  this.player.hp = Math.min(this.player.maxHp, this.player.hp + amount);
      try { this.particleManager?.spawn(this.player.x, this.player.y, 8, '#66FF99', { sizeMin: 1, sizeMax: 3, lifeMs: 380, speedMin: 1.2, speedMax: 2.2 }); } catch {}
    } else if (type === 'MAGNET') {
      // Instantly collect all active XP orbs (gems) on the board
      let collected = 0;
      for (let i = 0; i < this.gems.length; i++) {
        const g = this.gems[i]; if (!g.active) continue;
        this.player.gainExp(g.value); g.active = false; this.gemPool.push(g); collected++;
      }
      // Small pulse FX + mild screenshake
      try {
        this.particleManager?.spawn(this.player.x, this.player.y, 12, '#66F9FF', { sizeMin: 1, sizeMax: 2.5, lifeMs: 320, speedMin: 1.5, speedMax: 3 });
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
      } catch {}
    } else if (type === 'NUKE') {
      // Destroy enemies only within current viewport
      const camX = (window as any).__camX || 0;
      const camY = (window as any).__camY || 0;
      const vw = (window as any).__designWidth || (this as any).designWidth || 1280;
      const vh = (window as any).__designHeight || (this as any).designHeight || 720;
      const minX = camX, maxX = camX + vw, minY = camY, maxY = camY + vh;
      const nukeDmg = 99999;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i]; if (!e.active) continue;
        if (e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY) {
          this.takeDamage(e, nukeDmg);
        }
      }
      try {
        const bm: any = (window as any).__bossManager;
        const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : null;
        // Don’t auto-damage boss via nuke; viewport-only enemy clear per request
      } catch {}
      // Big FX burst
      try {
  this.particleManager?.spawn(this.player.x, this.player.y, 16, '#33E6FF', { sizeMin: 2, sizeMax: 4, lifeMs: 520, speedMin: 2, speedMax: 5 });
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 280, intensity: 10 } }));
      } catch {}
    }
  }

  // Merge lower tier gems into higher if enough cluster
  private handleGemMerging(): void {
    // Throttle: don’t check every frame. Base 66ms, stretch under load; skip when few gems.
    const now = performance.now();
    const totalGems = this.gems.length;
    if (totalGems < 24) return; // too few to bother
    const baseDelay = 66;
    const perfStretch = Math.min(3, (this.avgFrameMs || 16) / 16);
    const delay = baseDelay * perfStretch;
    if (now < this.gemMergeNextCheckMs) return;
    this.gemMergeNextCheckMs = now + delay;

    // We require merges to be spatially local: a cluster of N same-tier gems within a small radius.
    // Parameters (tunable):
    const clusterRadius = 120; // px radius defining a "small area" for merging
    const clusterRadiusSq = clusterRadius * clusterRadius;

    // Build per-tier lists (tiers 1-3 only) using reusable buffers
    const list1 = this.gemTierBuf1; list1.length = 0;
    const list2 = this.gemTierBuf2; list2.length = 0;
    const list3 = this.gemTierBuf3; list3.length = 0;
    for (let i = 0; i < this.gems.length; i++) {
      const g = this.gems[i];
      if (!g.active) continue;
      if (g.tier === 1) list1.push(g);
      else if (g.tier === 2) list2.push(g);
      else if (g.tier === 3) list3.push(g);
    }

    // Iterate tiers; stop after performing at most one merge this check
    for (let t = 1; t <= 3; t++) {
      const list = t === 1 ? list1 : t === 2 ? list2 : list3;
      if (!list.length) continue;
      const spec = getGemTierSpec(t);
      if (list.length < spec.merge) continue; // not enough of this tier globally

      // Attempt to find a local cluster: for each candidate gem, count neighbors within clusterRadius
      const needed = spec.merge;
      for (let i = 0; i < list.length; i++) {
        const g0 = list[i]; if (!g0.active) continue;
        let count = 1; // include g0
        // Reuse list as a scratch cluster container rather than allocating
        const cStart = list.length; // mark start index of temp push
        let sumX = g0.x, sumY = g0.y;
        for (let j = 0; j < list.length && count < needed; j++) {
          if (i === j) continue;
          const gj = list[j]; if (!gj.active) continue;
          const dx = gj.x - g0.x; const dy = gj.y - g0.y;
          if (dx*dx + dy*dy <= clusterRadiusSq) {
            list.push(gj); // temp store
            sumX += gj.x; sumY += gj.y; count++;
          }
        }
        if (count === needed) {
          const cx = sumX / count; const cy = sumY / count;
          // Build real group array once
          const group: Gem[] = new Array(count);
          group[0] = g0;
          for (let k = 1; k < count; k++) group[k] = list[cStart + (k-1)];
          // Truncate temp entries
          list.length = cStart;
          this.gemMergeAnims.push({ group, tier: t, x: cx, y: cy, t: 0, dur: 480 });
          return;
        }
        // No cluster: truncate any temp entries
        list.length = cStart;
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

  /** Spawn a stationary Sandbox dummy as an enemy-like target. */
  private spawnDummyEnemy(x: number, y: number, radius: number, hp: number) {
    let e = this.enemyPool.pop() as Enemy | undefined;
    if (!e) e = { x: 0, y: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, active: false, type: 'small', damage: 0, id: '' } as Enemy;
    const enemy = e as Enemy;
    const anyE: any = enemy as any;
    // Classify type by radius so Sandbox can spawn all archetypes easily
    const type: Enemy['type'] = (radius >= 34) ? 'large' : (radius >= 24) ? 'medium' : 'small';
    enemy.type = type;
    enemy.x = x; enemy.y = y; enemy.radius = radius; enemy.active = true;
    enemy.hp = hp; enemy.maxHp = hp; enemy.speed = 0; enemy.damage = 0; enemy.id = 'dummy-' + Math.floor(Math.random()*1e9);
    anyE._isDummy = true; // mark for special handling
    // Clear statuses
    anyE._poisonStacks = 0; anyE._burnStacks = 0; anyE._poisonExpire = 0; anyE._burnExpire = 0; anyE._burnTickDamage = 0;
    this.enemies.push(enemy);
  }
}

