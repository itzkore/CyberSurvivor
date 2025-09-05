import type { Bullet } from './Bullet';
import { Player } from './Player';
import { WEAPON_SPECS } from './WeaponConfig';
import { getHealEfficiency } from './Balance';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';
import type { Enemy } from './EnemyManager'; // Import Enemy type
import { Logger } from '../core/Logger';
import { SpatialGrid } from '../physics/SpatialGrid'; // Import SpatialGrid
import { ParticleManager } from './ParticleManager'; // Import ParticleManager
import { EnemyManager } from './EnemyManager'; // Import EnemyManager

declare global {
  interface Window {
    player?: { x: number; y: number };
  }
}

export class BulletManager {
  public bullets: Bullet[] = [];
  private bulletPool: Bullet[] = []; // Dedicated pool for inactive bullets
  private assetLoader: AssetLoader;
  private readonly initialPoolSize: number = 200; // Pre-allocate a reasonable number of bullets
  private particleManager: ParticleManager; // Injected ParticleManager
  private enemyManager: EnemyManager; // Injected EnemyManager
  private player: Player; // direct player reference for stats (crit, piercing)
  private enemySpatialGrid: SpatialGrid<Enemy>; // Spatial grid reference
  // Monotonic id to tag bullets for scoping behaviors (like Neural Threads)
  private nextBulletId: number = 1;
  // Debug: enable extra logs for Quantum Halo orbit maintenance
  private debugHalo: boolean = false;
  // Guard to prevent recursive lattice secondary spawns from re-entering spawnBullet
  private suppressWeaverSecondary: boolean = false;
  // Guard to prevent Harmonic Echo from being scheduled by non-primary shots (e.g., lattice secondaries or echoes themselves)
  private suppressPsionicEcho: boolean = false;
  // Neural Threader threads (Nomad): lightweight state objects managed here
  private neuralThreads: Array<{
    anchors: Enemy[]; // ordered enemies forming the polyline
    createdAt: number;
    expireAt: number;
    nextPulseAt: number;
    pulseMs: number;
    baseDamage: number; // damage of bullet at spawn (per level)
    pulsePct: number; // percent of baseDamage applied per pulse to anchors
    maxAnchors: number; // base anchors from level
    active: boolean;
    color: string;
    beadPhase: number; // for bead animation between pulses (0..1)
  ownerId: number; // legacy: id of the spawning bullet; not used for strict isolation anymore
  ownerPlayerId?: number; // logical owner (player instance identity)
  weaponType?: WeaponType; // origin: Threader vs Nexus behavior
  detonateFrac?: number; // optional expiry burst multiplier (Nexus)
  }> = [];

  constructor(assetLoader: AssetLoader, enemySpatialGrid: SpatialGrid<Enemy>, particleManager: ParticleManager, enemyManager: EnemyManager, player: Player) {
    this.assetLoader = assetLoader;
    this.enemySpatialGrid = enemySpatialGrid; // Assign spatial grid
    this.particleManager = particleManager; // Assign particle manager
    this.enemyManager = enemyManager; // Assign enemy manager
    this.player = player;
    this.preallocateBullets();
    // Expose a simple toggle in runtime for Halo debugging without recompiling
    try {
      (window as any).setHaloDebug = (v: boolean) => { this.debugHalo = !!v; Logger.info('HaloDebug set', v); };
    } catch { /* ignore */ }
    // One-shot Overmind Overload: detonate all neural threads with amplified burst, then clear
    try {
      window.addEventListener('nomadOverload', ((ev: any) => {
        const mult = ev?.detail?.multiplier || 1.5;
        this.handleNomadOverload(mult);
      }) as EventListener);
    } catch { /* ignore */ }
  }

  /** Broadphase helper: prefer spatial grid, fall back to EnemyManager when grid is empty or unavailable. */
  private queryEnemies(x: number, y: number, radius: number): Enemy[] {
    let result: Enemy[] | undefined;
    try { result = this.enemySpatialGrid?.query(x, y, radius) as unknown as Enemy[]; } catch {}
    if (result && result.length > 0) return result;
    // Fallback: scan active enemies from manager (used in headless/tests or if grid not yet rebuilt this frame)
    try {
      const enemies = (this.enemyManager && (this.enemyManager as any).getEnemies) ? (this.enemyManager as any).getEnemies() as Enemy[] : (this.enemyManager as any).enemies as Enemy[];
      if (!enemies) return result || [];
      const r2 = radius * radius; const out: Enemy[] = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i]; if (!e || !e.active) continue;
        const dx = e.x - x, dy = e.y - y; if (dx*dx + dy*dy <= r2) out.push(e);
      }
      return out;
    } catch { return result || []; }
  }

  /** Parse an rgba()/rgb()/#hex color into components. Returns null on failure. */
  private static parseColor(color: string): { r: number; g: number; b: number; a: number } | null {
    if (!color) return null;
    // rgba(r,g,b,a)
    const mRgba = color.match(/^rgba?\(([^)]+)\)$/i);
    if (mRgba) {
      const parts = mRgba[1].split(',').map(s => s.trim());
      if (parts.length >= 3) {
        const r = Math.max(0, Math.min(255, parseInt(parts[0], 10)));
        const g = Math.max(0, Math.min(255, parseInt(parts[1], 10)));
        const b = Math.max(0, Math.min(255, parseInt(parts[2], 10)));
        const a = parts.length >= 4 ? Math.max(0, Math.min(1, parseFloat(parts[3]))) : 1;
        if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && Number.isFinite(a)) return { r, g, b, a };
      }
    }
    // #rrggbb
    const mHex = color.match(/^#([0-9a-f]{6})$/i);
    if (mHex) {
      const n = parseInt(mHex[1], 16);
      const r = (n >> 16) & 0xff;
      const g = (n >> 8) & 0xff;
      const b = n & 0xff;
      return { r, g, b, a: 1 };
    }
    return null;
  }
  /**
   * Reset a pooled bullet to a neutral state so flags from one weapon path never leak into another.
   * This is critical for collisionless/orbit vs. melee sweep bullets sharing the same pool.
   */
  private resetPooledBullet(b: Bullet): void {
    // Basic kinematics & life
    b.vx = 0; b.vy = 0;
    b.life = 0; b.lifeMs = undefined;
    b.radius = b.radius || 0;
    b.active = false;
    // Common projectile state
    b.pierceRemaining = undefined;
    b.trail = undefined;
    if (b.hitIds) b.hitIds.length = 0; else b.hitIds = [];
    b.targetId = undefined;
    (b as any)._spawnTime = undefined;
    // Explosion/transient state
    (b as any)._exploded = false;
    (b as any)._explosionStartTime = undefined;
    (b as any)._maxExplosionDuration = undefined;
    // Drone/phased state
    b.phase = undefined;
    b.phaseStartTime = undefined;
    b.searchCooldownMs = undefined;
    b.altitudeScale = undefined;
    b.targetX = undefined; b.targetY = undefined;
    // Orbit state (Quantum Halo / Grinder)
    b.isOrbiting = false;
  (b as any).orbitKind = undefined; // 'HALO' | 'GRINDER' for strict separation
    b.orbitIndex = undefined;
    b.orbitCount = undefined;
    b.orbitAngle = undefined;
    b.orbitRadius = undefined;
    b.orbitRadiusBase = undefined;
    b.spinSpeed = undefined;
    b.angleOffset = undefined;
    b.lastPulseAngle = undefined;
    b.contactCooldownMap = undefined as any;
    // Melee sweep (Scrap-Saw) state
    (b as any).isMeleeSweep = false;
    (b as any).sweepStart = undefined;
    (b as any).sweepDurationMs = undefined;
    (b as any).baseAngle = undefined;
    (b as any).sweepDir = undefined;
    (b as any).arcDegrees = undefined;
    (b as any).reach = undefined;
    (b as any).thickness = undefined;
    (b as any)._hitOnce = undefined;
    (b as any).tetherCooldownMap = undefined;
    (b as any).displayAngle = undefined;
  // Scrap Lash specific runtime fields
  (b as any)._lashInit = undefined;
  (b as any)._lashPhase = undefined;
  (b as any)._lashHit = undefined;
  (b as any)._lashBaseSpeed = undefined;
  (b as any)._lashPierce = undefined;
  (b as any)._srcX = undefined;
  (b as any)._srcY = undefined;
  (b as any)._spin = undefined;
  // Per-throw scrap credit gating (Scrap Lash): clear so next throw can award again
  (b as any)._scrapCredited = undefined;
  (b as any).lastX = undefined;
  (b as any).lastY = undefined;
  // Generic cached speed/turn fields that could leak across pooled bullets
  (b as any).baseSpeed = undefined;
  (b as any)._baseSpeed = undefined;
  (b as any)._turnRate = undefined;
  (b as any)._curvePhase = undefined;
  (b as any).speed = undefined;
    // Misc
  b.projectileImageKey = undefined;
  // Clear visuals to avoid any chance of cross-weapon leakage (e.g., halo hue bleeding into saw)
  b.projectileVisual = undefined as any;
  // Clear any visual/identity lock used to hard-enforce weapon-specific rendering
  (b as any).visualLock = undefined;
  }

  /** Ensure Resonant Web orbit strands exist & reflect current player weapon state. */
  private ensureResonantWebStrands(deltaTime: number) {
    const player: any = this.player; if (!player || !player.activeWeapons) return;
    const level = player.activeWeapons.get(WeaponType.RESONANT_WEB); if (!level) return;
    const spec: any = (WEAPON_SPECS as any)[WeaponType.RESONANT_WEB]; if (!spec) return;
    const scaled = spec.getLevelStats ? spec.getLevelStats(level) : { damage: 24 } as any;
  // Default to 4 strands to form a readable web polygon
  let needed = 4;
    if (!Number.isFinite(needed) || needed <= 0) needed = 4;
    const current = this.bullets.filter(b => b && b.active && b.isOrbiting === true && b.weaponType === WeaponType.RESONANT_WEB && (b as any).orbitKind === 'WEB');
  if (current.length !== needed) {
      if (current.length < needed) {
        const missing = needed - current.length;
        for (let add = 0; add < missing; add++) {
          const idx = current.length + add;
          const bFromPool = this.bulletPool.pop();
          const b: Bullet = bFromPool || {
            x: player.x,
            y: player.y,
            vx: 0,
            vy: 0,
            radius: spec?.projectileVisual?.size || 10,
            life: 0,
            active: false,
            damage: scaled.damage || 24,
            weaponType: WeaponType.RESONANT_WEB
          } as Bullet;
          if (bFromPool) this.resetPooledBullet(b);
          b.x = player.x; b.y = player.y; b.vx = 0; b.vy = 0;
          b.damage = scaled.damage || 24;
          b.weaponType = WeaponType.RESONANT_WEB;
          b.active = true; b.isOrbiting = true; (b as any).orbitKind = 'WEB';
          (b as any).level = level;
          (b as any).visualLock = 'WEB';
          b.orbitIndex = idx; b.orbitCount = needed;
          b.orbitRadiusBase = (spec?.getLevelStats ? (spec.getLevelStats(level) as any).orbitRadius : undefined) || 120;
          b.angleOffset = (Math.PI * 2 * idx) / Math.max(1, needed);
          b.orbitAngle = b.angleOffset;
          b.projectileVisual = { ...(spec.projectileVisual || {}), size: (spec?.projectileVisual?.size || 10) } as any;
          b.contactCooldownMap = {};
          this.bullets.push(b);
        }
      } else {
        const webs = current.slice().sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0));
        for (let i = webs.length - 1; i >= needed; i--) { webs[i].active = false; this.bulletPool.push(webs[i]); }
      }
      // Normalize indices & offsets so strands are evenly distributed
      const websNow = this.bullets.filter(b => b.active && b.isOrbiting && b.weaponType === WeaponType.RESONANT_WEB && (b as any).orbitKind === 'WEB').sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0));
      for (let i = 0; i < websNow.length; i++) {
        const wb = websNow[i];
        wb.orbitIndex = i; wb.orbitCount = websNow.length;
        wb.angleOffset = (Math.PI * 2 * i) / Math.max(1, websNow.length);
        wb.orbitAngle = (wb.orbitAngle != null) ? wb.orbitAngle : wb.angleOffset;
        wb.spinSpeed = undefined; // clear legacy
      }
    }
    // Update damage and base orbit radius every tick to follow changes
    for (const wb of this.bullets) {
      if (wb.active && wb.isOrbiting && wb.weaponType === WeaponType.RESONANT_WEB && (wb as any).orbitKind === 'WEB') {
        wb.damage = scaled.damage || wb.damage;
        wb.orbitRadiusBase = wb.orbitRadiusBase != null ? wb.orbitRadiusBase : 120;
        (wb as any).level = level;
      }
    }
  }

  /** Ensure Sorcerer Orb exists and mirrors current player level; it orbits and periodically fires a beam hit. */
  private ensureSorcererOrbs(deltaTime: number) {
    const player: any = this.player; if (!player || !player.activeWeapons) return;
    const level = player.activeWeapons.get(WeaponType.SORCERER_ORB); if (!level) return;
    const spec: any = (WEAPON_SPECS as any)[WeaponType.SORCERER_ORB]; if (!spec) return;
    const scaled = spec.getLevelStats ? spec.getLevelStats(level) : {} as any;
    // One primary orb (can expand later)
    const needed = 1;
    const current = this.bullets.filter(b => b && b.active && b.isOrbiting === true && b.weaponType === WeaponType.SORCERER_ORB && (b as any).orbitKind === 'SORC_ORB');
    if (current.length !== needed) {
      if (current.length < needed) {
        const missing = needed - current.length;
        for (let add = 0; add < missing; add++) {
          const bFromPool = this.bulletPool.pop();
          const b: Bullet = bFromPool || {
            x: player.x,
            y: player.y,
            vx: 0,
            vy: 0,
            radius: spec?.projectileVisual?.size || 10,
            life: 0,
            active: false,
            damage: scaled.damage || spec.damage || 20,
            weaponType: WeaponType.SORCERER_ORB
          } as Bullet;
          if (bFromPool) this.resetPooledBullet(b);
          b.x = player.x; b.y = player.y; b.vx = 0; b.vy = 0;
          b.damage = scaled.damage || spec.damage || 20;
          b.weaponType = WeaponType.SORCERER_ORB;
          b.active = true; b.isOrbiting = true; (b as any).orbitKind = 'SORC_ORB';
          (b as any).level = level; (b as any).visualLock = 'SORC_ORB';
          b.orbitIndex = 0; b.orbitCount = 1;
          b.orbitRadiusBase = (scaled as any).orbitRadius || 140;
          b.angleOffset = 0;
          b.orbitAngle = Math.random() * Math.PI * 2;
          b.projectileVisual = { ...(spec.projectileVisual || {}), size: (spec?.projectileVisual?.size || 10) } as any;
          b.contactCooldownMap = {};
          // Beam cadence cache (convert frames cooldown to ms if needed)
          const cdFrames = (scaled as any).cooldown ?? spec.cooldown ?? 54;
          (b as any)._beamIntervalMs = (spec.cooldownMs != null ? spec.cooldownMs : Math.round(Math.max(1, cdFrames) * (1000/60)));
          (b as any)._nextBeamAt = performance.now() + (b.orbitIndex || 0) * 120; // slight stagger if multiple later
          this.bullets.push(b);
        }
      } else {
        const orbs = current.slice();
        for (let i = orbs.length - 1; i >= needed; i--) { orbs[i].active = false; this.bulletPool.push(orbs[i]); }
      }
    }
    // Keep stats fresh
    for (const ob of this.bullets) {
      if (ob.active && ob.isOrbiting && ob.weaponType === WeaponType.SORCERER_ORB && (ob as any).orbitKind === 'SORC_ORB') {
        ob.damage = scaled.damage || ob.damage;
        ob.orbitRadiusBase = (scaled as any).orbitRadius || ob.orbitRadiusBase || 140;
        (ob as any).level = level;
      }
    }
  }


  /** Ensure Quantum Halo orbit bullets exist & reflect current player weapon level.
   *  Avoids full deactivation/rebuild to prevent visible resets/flicker when counts change.
   */
  private ensureQuantumHaloOrbs(deltaTime:number){
    const player: any = this.player; if (!player || !player.activeWeapons) return;
    const level = player.activeWeapons.get(WeaponType.QUANTUM_HALO); if (!level) return;
    const spec: any = (WEAPON_SPECS as any)[WeaponType.QUANTUM_HALO]; if (!spec) return;
    const scaled = spec.getLevelStats ? spec.getLevelStats(level) : {};
                // Robust: in case scaled.orbCount is missing, default to a minimum of 2 orbs for a proper ring
         let needed = Math.max(2, Number((scaled as any).orbCount)); // Ensure at least 2 orbs
                if (!Number.isFinite(needed) || needed <= 0) needed = 2;
  // Only consider HALO-tagged orbit bullets; grinder uses a separate tag and branch
  const current = this.bullets.filter(b => b && b.active && b.isOrbiting === true && b.weaponType === WeaponType.QUANTUM_HALO && (b as any).orbitKind === 'HALO');
    if (current.length !== needed) {
      if (current.length < needed) {
        // Grow: add the missing orbs without touching existing ones
        const missing = needed - current.length;
        for (let add = 0; add < missing; add++) {
          const idx = current.length + add;
          const bFromPool = this.bulletPool.pop();
          const b: Bullet = bFromPool || {
            x: player.x,
            y: player.y,
            vx: 0,
            vy: 0,
            radius: spec?.projectileVisual?.size || 18,
            life: 0,
            active: false,
            damage: scaled.damage || 22,
            weaponType: WeaponType.QUANTUM_HALO
          } as Bullet;
          if (bFromPool) this.resetPooledBullet(b);
          b.x = player.x; b.y = player.y; b.vx = 0; b.vy = 0;
          b.damage = scaled.damage || 22;
          b.weaponType = WeaponType.QUANTUM_HALO;
          b.active = true; b.isOrbiting = true; (b as any).orbitKind = 'HALO';
          (b as any).level = level;
          // Lock identity for draw: this orb must render as HALO visuals regardless of pool history
          (b as any).visualLock = 'HALO';
          b.orbitIndex = idx; b.orbitCount = needed;
          b.orbitRadiusBase = scaled.orbitRadius || 90;
          b.angleOffset = (Math.PI * 2 * idx) / Math.max(1, needed);
          b.orbitAngle = b.angleOffset;
          b.projectileVisual = { ...(spec.projectileVisual || {}), size: (spec?.projectileVisual?.size || 12) } as any;
          b.contactCooldownMap = {};
          this.bullets.push(b);
        }
      } else {
        // Shrink: deactivate extras from the tail to preserve earlier indices
        const halos = current.slice().sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0));
        for (let i = halos.length - 1; i >= needed; i--) {
          halos[i].active = false; this.bulletPool.push(halos[i]);
        }
      }
      // Normalize indices & offsets so orbs are evenly distributed after any add/remove
      const halosNow = this.bullets.filter(b => b.active && b.isOrbiting && b.weaponType === WeaponType.QUANTUM_HALO && (b as any).orbitKind === 'HALO').sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0));
      for (let i = 0; i < halosNow.length; i++) {
        const hb = halosNow[i];
        hb.orbitIndex = i; hb.orbitCount = halosNow.length;
        hb.angleOffset = (Math.PI * 2 * i) / Math.max(1, halosNow.length);
        // Preserve current angular position relative to new offset if possible
        hb.orbitAngle = (hb.orbitAngle != null) ? hb.orbitAngle : hb.angleOffset;
        // Clear legacy spin speed so per-tick update uses scaled value only
        hb.spinSpeed = undefined;
      }
    }
  // Update damage and base orbit radius every tick to follow level-up changes (spin uses scaled inside update)
    for (const hb of this.bullets) {
      if (hb.active && hb.isOrbiting && hb.weaponType === WeaponType.QUANTUM_HALO && (hb as any).orbitKind === 'HALO') {
    hb.damage = scaled.damage || hb.damage;
        hb.orbitRadiusBase = scaled.orbitRadius || hb.orbitRadiusBase;
        (hb as any).level = level;
      }
    }
  }

  /**
   * Helper function to check for line-circle intersection (swept-sphere collision).
   * @param x1 Line start X
   * @param y1 Line start Y
   * @param x2 Line end X
   * @param y2 Line end Y
   * @param cx Circle center X
   * @param cy Circle center Y
   * @param r Circle radius
   * @returns The intersection point {x, y} if collision occurs, otherwise null.
   */
  private lineCircleIntersect(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, r: number): { x: number, y: number } | null {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const fx = x1 - cx;
    const fy = y1 - cy;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = (fx * fx + fy * fy) - r * r;

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      return null; // No intersection
    }

    // Solve for t (intersection points along the line segment)
    const t0 = (-b - Math.sqrt(discriminant)) / (2 * a);
    const t1 = (-b + Math.sqrt(discriminant)) / (2 * a);

    // Find the smallest t value that is between 0 and 1
    let t = Infinity;
    if (t0 >= 0 && t0 <= 1) t = Math.min(t, t0);
    if (t1 >= 0 && t1 <= 1) t = Math.min(t, t1);

    if (t === Infinity) {
      return null; // No intersection within segment
    }

    return { x: x1 + t * dx, y: y1 + t * dy };
  }

  private preallocateBullets(): void {
    for (let i = 0; i < this.initialPoolSize; i++) {
      this.bulletPool.push({
        x: 0, y: 0, vx: 0, vy: 0, radius: 0, life: 0, active: false, damage: 0, weaponType: WeaponType.PISTOL
      });
    }
  }

  public reset(): void {
    this.bullets = [];
    this.bulletPool = [];
    this.preallocateBullets();
  }

  public update(deltaTime: number) {
  // Maintain Quantum Halo orbit bullets (persistent) before normal update advances
  try { this.ensureQuantumHaloOrbs(deltaTime); } catch(e){ /* ignore to avoid breaking main loop */ }
  // Maintain Resonant Web orbit strands (persistent)
  try { this.ensureResonantWebStrands(deltaTime); } catch(e){ /* ignore to avoid breaking main loop */ }
  // Maintain Sorcerer Orb (persistent orbit + periodic beam)
  try { this.ensureSorcererOrbs(deltaTime); } catch(e){ /* ignore to avoid breaking main loop */ }
  // Update any active Grinder (evolved scavenger) orbit sessions: store as bullets with isOrbiting=true and a finite duration
  // They reuse the Quantum Halo path but expire by endTime.
    const activeBullets: Bullet[] = [];
  // Precompute friendly hazard "safe zone" around player (halo / grinder / saw sweep) once per tick.
  // Plasma will ignore collisions while within this radius to prevent friendly interference.
  let friendlySafeR2 = 0;
  try {
    const p: any = this.player;
    if (p) {
      // Quantum Halo orbit radius
      const haloLvl = p.activeWeapons?.get(WeaponType.QUANTUM_HALO) || 0;
      if (haloLvl > 0) {
        const haloSpec: any = (WEAPON_SPECS as any)[WeaponType.QUANTUM_HALO];
        const haloStats = haloSpec?.getLevelStats ? haloSpec.getLevelStats(haloLvl) : {};
        const r = (haloStats?.orbitRadius ?? 90) + 18; // small margin outside the ring
        const r2 = r * r; if (r2 > friendlySafeR2) friendlySafeR2 = r2;
      }
      // Resonant Web orbit radius
      const webLvl = p.activeWeapons?.get(WeaponType.RESONANT_WEB) || 0;
      if (webLvl > 0) {
        const webSpec: any = (WEAPON_SPECS as any)[WeaponType.RESONANT_WEB];
        const webStats = webSpec?.getLevelStats ? webSpec.getLevelStats(webLvl) : {};
        const r = (webStats?.orbitRadius ?? 120) + 18;
        const r2 = r * r; if (r2 > friendlySafeR2) friendlySafeR2 = r2;
      }
      // Active Industrial Grinder orbit radius (only when actually orbiting)
      let grinderActive = false; let grinderR = 0;
      for (let ii = 0; ii < this.bullets.length; ii++) {
        const bb = this.bullets[ii];
        if (bb.active && (bb as any).isOrbiting && bb.weaponType === WeaponType.INDUSTRIAL_GRINDER) { grinderActive = true; break; }
      }
      if (grinderActive) {
        const grSpec: any = (WEAPON_SPECS as any)[WeaponType.INDUSTRIAL_GRINDER];
        const grLvl = p.activeWeapons?.get(WeaponType.INDUSTRIAL_GRINDER) || 1;
        const grStats = grSpec?.getLevelStats ? grSpec.getLevelStats(grLvl) : {};
        grinderR = (grStats?.orbitRadius ?? 140) + 18;
        const r2 = grinderR * grinderR; if (r2 > friendlySafeR2) friendlySafeR2 = r2;
      }
    }
  } catch { /* non-fatal */ }
    // Passive cleanup: decay Resonance stacks if timer elapsed (cheap scan around player)
    try {
      const nowR = performance.now();
      const px = this.player ? this.player.x : ((window as any).player?.x || 0);
      const py = this.player ? this.player.y : ((window as any).player?.y || 0);
  const near = this.queryEnemies(px, py, 900);
      for (let i = 0; i < near.length; i++) {
        const e: any = near[i];
        if (!e.active) continue;
        if (e._resonanceStacks && e._resonanceExpire && nowR > e._resonanceExpire) {
          e._resonanceStacks = 0; e._resonanceExpire = 0;
        }
      }
    } catch { /* ignore */ }
  // Bump a global frame id used by per-bullet once-per-frame guards
  (window as any).__frameId = ((window as any).__frameId || 0) + 1;
  const camX = (window as any).__camX || 0;
  const camY = (window as any).__camY || 0;
  const viewW = (window as any).__designWidth || 1920;
  const viewH = (window as any).__designHeight || 1080;
  const pad = 256; // retain bullets slightly offscreen
  const minX = camX - pad, maxX = camX + viewW + pad;
  const minY = camY - pad, maxY = camY + viewH + pad;
  for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
  if (!b.active) { this.bulletPool.push(b); continue; }

      // Quantum Halo orbit handling: isolated branch
      if (b.isOrbiting && b.weaponType === WeaponType.QUANTUM_HALO) {
  // Reassert HALO orbit identity in case pooled flags leaked (but do not resurrect deactivated extras)
  if ((b as any).orbitKind !== 'HALO') (b as any).orbitKind = 'HALO';
  const specHalo: any = (WEAPON_SPECS as any)[WeaponType.QUANTUM_HALO];
  const level = (b as any).level || 1;
  const scaled = specHalo?.getLevelStats ? specHalo.getLevelStats(level) : {};
  const playerRef = this.player;
  // Stabilize rotation: derive from level stats only, and step by real time so it's independent of fixed-step count
  const spinBase = (scaled.spinSpeed || 1);
  const haloNow = performance.now();
  const lastT = (b as any)._lastOrbitTimeMs ?? haloNow;
  const dtMs = Math.min(Math.max(0, haloNow - lastT), 34); // clamp to avoid spikes
  (b as any)._lastOrbitTimeMs = haloNow;
  const spin = spinBase * (dtMs / 1000);
  // Ensure we only rotate each orb once per frame
  const fid = (window as any).__frameId || 0;
  if ((b as any)._lastHaloFrameId === fid) { activeBullets.push(b); continue; }
  (b as any)._lastHaloFrameId = fid;
        b.orbitAngle = (b.orbitAngle || (b.angleOffset||0)) + spin;
        if (b.orbitAngle > Math.PI*2) {
          b.orbitAngle -= Math.PI*2;
          if (b.orbitIndex === 0 && scaled.pulseDamage > 0) {
            window.dispatchEvent(new CustomEvent('quantumHaloPulse', { detail: { x: playerRef.x, y: playerRef.y, damage: scaled.pulseDamage, radius: scaled.orbitRadius + 40 } }));
          }
        }
  const radius = (b.orbitRadiusBase != null ? b.orbitRadiusBase : (scaled.orbitRadius || 90));
        const angleTotal = b.orbitAngle;
        b.x = playerRef.x + Math.cos(angleTotal) * radius;
        b.y = playerRef.y + Math.sin(angleTotal) * radius;
        b.radius = (specHalo?.projectileVisual?.size || 12);
        // Dynamic hue for halo
        const hue = (performance.now()*0.05 + (b.orbitIndex||0)*70) % 360;
        if (!b.projectileVisual) b.projectileVisual = { type:'plasma', size: b.radius } as any;
        (b.projectileVisual as any)._dynamicHue = hue;
  // Ensure halo visual is locked regardless of any prior sprite on the pooled object
  (b as any).visualLock = 'HALO';
        b.lifeMs = 9999999; // persistent
        // Contact damage with per-enemy cooldown
  const potential = this.queryEnemies(b.x, b.y, Math.max(28, b.radius + 8));
        if (!b.contactCooldownMap) b.contactCooldownMap = {};
        const nowT = performance.now();
        for (let ei=0; ei<potential.length; ei++){
          const e = potential[ei]; if (!e.active || e.hp<=0) continue;
          const dxE = e.x - b.x; const dyE = e.y - b.y; const rs = (e.radius||16) + (b.radius*0.55);
          if (dxE*dxE + dyE*dyE <= rs*rs){
            const eid = (e as any).id || (e as any)._gid || 'e'+ei;
            const nextOk = b.contactCooldownMap[eid] || 0;
            if (nowT >= nextOk){
              const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.10); }
              const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
              const baseDmg = (b.damage||scaled.damage||20);
              const dmgBase = baseDmg * (isCrit?critMult:1);
              this.enemyManager.takeDamage(e, dmgBase, isCrit, false, b.weaponType, b.x, b.y, level);
              b.contactCooldownMap[eid] = nowT + 1000; // halo: 1s per-enemy
              if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, '#7DFFEA');
            }
          }
        }
        // Boss contact
        {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const dxB = boss.x - b.x; const dyB = boss.y - b.y;
            const rsB = (boss.radius || 160) + (b.radius * 0.55);
            if (dxB*dxB + dyB*dyB <= rsB*rsB) {
              const key = 'boss';
              const nextOkB = b.contactCooldownMap[key] || 0;
              if (nowT >= nextOkB) {
                const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.10); }
                const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
                const baseDmg = (b.damage||scaled.damage||20);
                const dmgBase = baseDmg * (isCrit?critMult:1);
                if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                  (this.enemyManager as any).takeBossDamage(boss, dmgBase, isCrit, b.weaponType, b.x, b.y, level);
                } else {
                  // Fallback path
                  boss.hp -= dmgBase;
                  window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage: dmgBase, crit: isCrit, x: b.x, y: b.y } }));
                }
                b.contactCooldownMap[key] = nowT + 1000;
                if (this.particleManager) this.particleManager.spawn(boss.x, boss.y, 1, '#7DFFEA');
              }
            }
          }
        }
        activeBullets.push(b);
        continue;
      }

      // Resonant Web orbit handling: isolated branch
      if (b.isOrbiting && b.weaponType === WeaponType.RESONANT_WEB) {
        const specWeb: any = (WEAPON_SPECS as any)[WeaponType.RESONANT_WEB];
        const level = (b as any).level || 1;
        const scaled = specWeb?.getLevelStats ? specWeb.getLevelStats(level) : {};
        const playerRef = this.player;
        // Moderate rotation speed, step by real time
        const spinBase = 2.6;
        const nowMs = performance.now();
        const lastT = (b as any)._lastOrbitTimeMs ?? nowMs;
        const dtMs = Math.min(Math.max(0, nowMs - lastT), 34);
        (b as any)._lastOrbitTimeMs = nowMs;
        const spin = spinBase * (dtMs / 1000);
        // Guard once-per-frame
        const fid = (window as any).__frameId || 0;
        if ((b as any)._lastWebFrameId === fid) { activeBullets.push(b); continue; }
        (b as any)._lastWebFrameId = fid;
        b.orbitAngle = (b.orbitAngle || (b.angleOffset||0)) + spin;
        if (b.orbitAngle > Math.PI*2) {
          b.orbitAngle -= Math.PI*2;
          // Pulse on index 0 wrap: radial AoE that amplifies marked targets
          if (b.orbitIndex === 0) {
            try {
              const px = playerRef.x, py = playerRef.y;
              const baseR = (b.orbitRadiusBase != null ? b.orbitRadiusBase : (scaled.orbitRadius || 120)) + 60;
              const near = this.queryEnemies(px, py, baseR + 40);
              const baseDmg = Math.max(1, Math.round((scaled.damage || b.damage || 24) * 1.15));
              const nowP = performance.now();
              for (let ei = 0; ei < near.length; ei++) {
                const e: any = near[ei]; if (!e.active || e.hp <= 0) continue;
                const dx = e.x - px, dy = e.y - py; const d2 = dx*dx + dy*dy; const r2 = baseR * baseR;
                if (d2 <= r2) {
                  const marked = (e._psionicMarkUntil || 0) > nowP;
                  const dmg = Math.round(baseDmg * (marked ? 1.6 : 1.0));
                  this.enemyManager.takeDamage(e, dmg, false, false, WeaponType.RESONANT_WEB, e.x, e.y, level, true);
                  // Refresh mark slightly to sustain synergy
                  e._psionicMarkUntil = Math.max(e._psionicMarkUntil || 0, nowP + 1000);
                  if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, '#FF99FF');
                }
              }
              // Also damage treasures within pulse radius (no mark amplification)
              try {
                const emAny: any = this.enemyManager as any;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number;y:number;active:boolean;hp:number;radius:number }>;
                  for (let ti = 0; ti < treasures.length; ti++) {
                    const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dxT = (t.x ?? 0) - px; const dyT = (t.y ?? 0) - py; const d2T = dxT*dxT + dyT*dyT; const r2T = baseR * baseR;
                    if (d2T <= r2T && typeof emAny.damageTreasure === 'function') {
                      emAny.damageTreasure(t, baseDmg);
                    }
                  }
                }
              } catch { /* ignore treasure pulse errors */ }
              // Boss pulse
              const bossMgr: any = (window as any).__bossManager;
              const boss = bossMgr && bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : null;
              if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
                const dxB = boss.x - px, dyB = boss.y - py; const d2B = dxB*dxB + dyB*dyB; const r2B = baseR * baseR;
                if (d2B <= r2B) {
                  const anyB: any = boss as any;
                  const marked = (anyB._psionicMarkUntil || 0) > nowP;
                  const dmg = Math.round(baseDmg * (marked ? 1.6 : 1.0));
                  if ((this.enemyManager as any).takeBossDamage) (this.enemyManager as any).takeBossDamage(boss, dmg, false, WeaponType.RESONANT_WEB, px, py, level, true);
                  else boss.hp -= dmg;
                  anyB._psionicMarkUntil = Math.max(anyB._psionicMarkUntil || 0, nowP + 1000);
                  if (this.particleManager) this.particleManager.spawn(boss.x, boss.y, 1, '#FF99FF');
                }
              }
              // Optional: shake subtly
              try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 60, intensity: 1 } })); } catch {}
            } catch { /* ignore pulse errors */ }
          }
        }
        const radius = (b.orbitRadiusBase != null ? b.orbitRadiusBase : (scaled.orbitRadius || 120));
        const angleTotal = b.orbitAngle;
        b.x = playerRef.x + Math.cos(angleTotal) * radius;
        b.y = playerRef.y + Math.sin(angleTotal) * radius;
        b.radius = (specWeb?.projectileVisual?.size || 10);
        // Lattice tint for web orb visual
        try {
          const meter: any = (this.player as any)?.getWeaverLatticeMeter?.();
          const latticeOn = !!(meter && meter.active);
          const base = { color: '#FF66FF', glowColor: '#FF99FF', glowRadius: 28 };
          const lat = { color: '#6B1FB3', glowColor: '#B37DFF', glowRadius: 34 };
          const use = latticeOn ? lat : base;
          if (!b.projectileVisual) b.projectileVisual = { type:'plasma', size: b.radius, ...use } as any;
          else { (b.projectileVisual as any).color = use.color; (b.projectileVisual as any).glowColor = use.glowColor; (b.projectileVisual as any).glowRadius = use.glowRadius; }
        } catch { if (!b.projectileVisual) b.projectileVisual = { type:'plasma', size: b.radius, color: '#FF66FF', glowColor: '#FF99FF', glowRadius: 28 } as any; }
        (b as any).visualLock = 'WEB';
        b.lifeMs = 9999999;
        // Strand auto-cast: fire Level 7 Psionic Wave periodically, staggered by strand index
        try {
          const websNow = this.bullets.filter(x => x.active && x.isOrbiting && x.weaponType === WeaponType.RESONANT_WEB && (x as any).orbitKind === 'WEB');
          const count = Math.max(1, websNow.length || (b.orbitCount || 1));
          const webSpec: any = (WEAPON_SPECS as any)[WeaponType.RESONANT_WEB];
          const intervalMsBase = (webSpec?.cooldownMs || 2600);
          let intervalPerOrb = Math.max(300, Math.floor(intervalMsBase / count));
          // Lattice: triple fire rate for the duration
          try { const meter: any = (this.player as any)?.getWeaverLatticeMeter?.(); if (meter && meter.active) { intervalPerOrb = Math.max(120, Math.floor(intervalPerOrb / 3)); } } catch {}
          const nowC = performance.now();
          if ((b as any)._nextWeaverShotAt == null) {
            // Stagger initial shots by index
            (b as any)._nextWeaverShotAt = nowC + ((b.orbitIndex || 0) * Math.floor(intervalPerOrb / count));
          }
          if (nowC >= (b as any)._nextWeaverShotAt) {
            // Gate: only fire if an enemy or boss is within 800px of the player
            let hasEnemyNearPlayer = false;
            try {
              const pxG = playerRef?.x ?? b.x; const pyG = playerRef?.y ?? b.y;
              const nearGate = this.queryEnemies(pxG, pyG, 800) as any[];
              for (let gi = 0; gi < nearGate.length; gi++) { const ge: any = nearGate[gi]; if (ge.active && ge.hp > 0) { hasEnemyNearPlayer = true; break; } }
              // Also consider boss proximity
              if (!hasEnemyNearPlayer) {
                const bossMgr: any = (window as any).__bossManager;
                const boss = bossMgr && bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : null;
                if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
                  const dxB = boss.x - pxG; const dyB = boss.y - pyG; if (dxB*dxB + dyB*dyB <= 800*800) hasEnemyNearPlayer = true;
                }
              }
              // Consider treasures near the player as valid fire gate as well
              if (!hasEnemyNearPlayer) {
                const emAny: any = this.enemyManager as any;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const ts = emAny.getTreasures() as Array<{ x:number;y:number;active:boolean;hp:number }>;
                  for (let ti = 0; ti < ts.length; ti++) {
                    const t = ts[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dxT = (t.x ?? 0) - pxG; const dyT = (t.y ?? 0) - pyG;
                    if (dxT*dxT + dyT*dyT <= 800*800) { hasEnemyNearPlayer = true; break; }
                  }
                }
              }
            } catch { /* ignore gate errors; default false keeps safety */ }
            if (!hasEnemyNearPlayer) {
              // No enemy near the player: delay the next check a bit for responsiveness
              (b as any)._nextWeaverShotAt = nowC + Math.max(250, Math.min(400, Math.floor(intervalPerOrb / 2)));
              // Skip firing this tick
              activeBullets.push(b);
              continue;
            }
            (b as any)._nextWeaverShotAt = nowC + intervalPerOrb;
            // Choose target: prefer psionic-marked (enemy or boss), else nearest (enemy or boss) in range, else shoot outward
            let tx = 0, ty = 0;
            let found = false;
            const searchR = 1200;
            const near = this.queryEnemies(b.x, b.y, searchR) as any[];
            let bestMarked: any = null; let bestMarkedD2 = Infinity;
            let best: any = null; let bestD2 = Infinity;
            const nowM = performance.now();
            for (let iN = 0; iN < near.length; iN++) {
              const e: any = near[iN]; if (!e.active || e.hp <= 0) continue;
              const dx = e.x - b.x, dy = e.y - b.y; const d2 = dx*dx + dy*dy; if (d2 < 24*24) continue; // skip too-close
              if ((e._psionicMarkUntil || 0) > nowM) { if (d2 < bestMarkedD2) { bestMarkedD2 = d2; bestMarked = e; } }
              if (d2 < bestD2) { bestD2 = d2; best = e; }
            }
            // Add boss as candidate target
            let bossCand: any = null; let bossD2 = Infinity; let bossMarked = false;
            try {
              const bossMgr: any = (window as any).__bossManager;
              const boss = bossMgr && bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : null;
              if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
                const dxB = boss.x - b.x; const dyB = boss.y - b.y; const d2B = dxB*dxB + dyB*dyB;
                if (d2B <= searchR*searchR) { bossCand = boss; bossD2 = d2B; bossMarked = ((boss as any)._psionicMarkUntil || 0) > nowM; }
              }
            } catch { /* ignore */ }
            // Add treasures as candidate targets (prefer nearest when no marked target)
            let bestTreasure: any = null; let bestTreasureD2 = Infinity;
            try {
              const emAny: any = this.enemyManager as any;
              if (emAny && typeof emAny.getTreasures === 'function') {
                const treasures = emAny.getTreasures() as Array<{ x:number;y:number;active:boolean;hp:number }>;
                for (let ti = 0; ti < treasures.length; ti++) {
                  const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                  const dxT = (t.x ?? 0) - b.x; const dyT = (t.y ?? 0) - b.y; const d2T = dxT*dxT + dyT*dyT;
                  if (d2T < bestTreasureD2 && d2T <= searchR*searchR) { bestTreasureD2 = d2T; bestTreasure = t; }
                }
              }
            } catch { /* ignore */ }
            let target: any = bestMarked || best;
            // Prefer marked boss over unmarked enemy and over farther marked enemy
            if (bossCand) {
              if (bossMarked) {
                if (!bestMarked || bossD2 < bestMarkedD2) target = bossCand;
              } else if (!bestMarked) {
                if (!best || bossD2 < bestD2) target = bossCand;
              }
            }
            // If we still have no marked target, prefer nearest treasure over unmarked enemy when closer
            if (!bestMarked) {
              if (!target || (bestTreasure && bestTreasureD2 < (bestD2 || Infinity))) target = bestTreasure || target;
            }
            if (target) {
              tx = target.x; ty = target.y; found = true;
            } else {
              const ang = b.orbitAngle || 0;
              const len = 360;
              tx = b.x + Math.cos(ang) * len;
              ty = b.y + Math.sin(ang) * len;
            }
            // Suppress Weaver lattice and harmonic echo for these autonomous shots
            const prevSec = this.suppressWeaverSecondary;
            const prevEcho = this.suppressPsionicEcho;
            this.suppressWeaverSecondary = true;
            this.suppressPsionicEcho = true;
            try {
              // Use level 7 stats for the spawned wave regardless of player weaver level
              const lvl = 7;
              const wave = this.spawnBullet(b.x, b.y, tx, ty, WeaponType.PSIONIC_WAVE, 0, lvl);
              if (wave) {
                // Tag for potential future tuning; allow normal ricochet behavior for L7 waves
                (wave as any)._webWave = true;
              }
              if (wave && wave.projectileVisual) {
                // Minor visual trim for readability
                const vis: any = { ...(wave.projectileVisual as any) };
                if (vis.thickness != null) vis.thickness = Math.max(8, Math.round(vis.thickness * 0.9));
                vis.glowRadius = Math.max((vis.glowRadius || 24) * 0.9, 18);
                // Lattice tint for wave
                try { const meter2: any = (this.player as any)?.getWeaverLatticeMeter?.(); if (meter2 && meter2.active) { vis.color = '#6B1FB3'; vis.glowColor = '#B37DFF'; vis.glowRadius = Math.max(vis.glowRadius, 26); } } catch {}
                wave.projectileVisual = vis;
              }
            } finally {
              this.suppressWeaverSecondary = prevSec;
              this.suppressPsionicEcho = prevEcho;
            }
          }
        } catch { /* ignore firing errors */ }
  // No direct contact collisions for Resonant Web orbs: they avoid all collision and only apply pulses/auto-casts
        activeBullets.push(b);
        continue;
      }

      // Sorcerer Orb orbit handling: isolated branch
      if (b.isOrbiting && b.weaponType === WeaponType.SORCERER_ORB) {
        const specOrb: any = (WEAPON_SPECS as any)[WeaponType.SORCERER_ORB];
        const level = (b as any).level || 1;
        const scaled = specOrb?.getLevelStats ? specOrb.getLevelStats(level) : {};
        const playerRef = this.player;
        // Gentle rotation speed
        const nowMs = performance.now();
        const lastT = (b as any)._lastOrbitTimeMs ?? nowMs;
        const dtMs = Math.min(Math.max(0, nowMs - lastT), 34);
        (b as any)._lastOrbitTimeMs = nowMs;
        const spin = 1.8 * (dtMs / 1000);
        const fid = (window as any).__frameId || 0;
        if ((b as any)._lastOrbFrameId !== fid) {
          (b as any)._lastOrbFrameId = fid;
          b.orbitAngle = (b.orbitAngle || (b.angleOffset||0)) + spin;
        }
        const radius = (b.orbitRadiusBase != null ? b.orbitRadiusBase : ((scaled as any).orbitRadius || 140));
        const angleTotal = b.orbitAngle || 0;
        b.x = playerRef.x + Math.cos(angleTotal) * radius;
        b.y = playerRef.y + Math.sin(angleTotal) * radius;
        b.radius = (specOrb?.projectileVisual?.size || 10);
        // Visual identity lock
        if (!b.projectileVisual) b.projectileVisual = { type:'plasma', size: b.radius, color:'#AA77FF', glowColor:'#D6C2FF', glowRadius:20 } as any;
        (b as any).visualLock = 'SORC_ORB';
        b.lifeMs = 9999999;
        // Periodic beam: pick a target (marked/nearest enemy, or boss, or treasure) and apply instant damage along a thin line
        try {
          const interval = (b as any)._beamIntervalMs || 900;
          if ((b as any)._nextBeamAt == null) (b as any)._nextBeamAt = nowMs + interval;
          if (nowMs >= (b as any)._nextBeamAt) {
            (b as any)._nextBeamAt = nowMs + interval;
            const searchR = 1000;
            let target: any = null; let bestD2 = Infinity;
            const near = this.queryEnemies(b.x, b.y, searchR) as any[];
            for (let iN = 0; iN < near.length; iN++) {
              const e: any = near[iN]; if (!e.active || e.hp <= 0) continue;
              const dx = e.x - b.x, dy = e.y - b.y; const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; target = e; }
            }
            // Consider boss
            let boss: any = null; let bossD2 = Infinity;
            try { const bossMgr: any = (window as any).__bossManager; const bb = bossMgr?.getActiveBoss?.(); if (bb && bb.active && bb.hp > 0 && bb.state === 'ACTIVE') { const dxB = bb.x - b.x, dyB = bb.y - b.y; const d2B = dxB*dxB + dyB*dyB; if (d2B < bossD2 && d2B <= searchR*searchR) { boss = bb; bossD2 = d2B; } } } catch {}
            if (boss && bossD2 < bestD2) target = boss;
            // Consider treasures
            if (!target) {
              try {
                const emAny: any = this.enemyManager as any;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number;y:number;active:boolean;hp:number }>;
                  for (let ti = 0; ti < treasures.length; ti++) {
                    const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dxT = (t.x ?? 0) - b.x; const dyT = (t.y ?? 0) - b.y; const d2T = dxT*dxT + dyT*dyT;
                    if (d2T < bestD2 && d2T <= searchR*searchR) { bestD2 = d2T; target = t; }
                  }
                }
              } catch { /* ignore */ }
            }
            if (target) {
              const tx = target.x, ty = target.y;
              const angle = Math.atan2(ty - b.y, tx - b.x);
              // Thin arcane beam; apply a single packet of damage on intersect
              const len = 480; const thickness = 8;
              const endX = b.x + Math.cos(angle) * len; const endY = b.y + Math.sin(angle) * len;
              // Enemies along path
              const cosA = Math.cos(angle), sinA = Math.sin(angle);
              const dBase = Math.max(1, Math.round((b.damage || 20)));
              const lvl = (b as any).level || 1;
              const enemies = this.queryEnemies(b.x, b.y, Math.min(searchR, len + 80));
              for (let ei = 0; ei < enemies.length; ei++) {
                const e = enemies[ei]; if (!e.active || e.hp <= 0) continue;
                const relX = e.x - b.x; const relY = e.y - b.y;
                const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > len) continue;
                const ortho = Math.abs(-sinA * relX + cosA * relY);
                if (ortho <= thickness + (e.radius || 14)) {
                  this.enemyManager.takeDamage(e, dBase, false, false, WeaponType.SORCERER_ORB, b.x, b.y, lvl);
                }
              }
              // Boss hit
              if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
                const relX = boss.x - b.x; const relY = boss.y - b.y;
                const proj = relX * cosA + relY * sinA;
                if (proj >= 0 && proj <= len) {
                  const ortho = Math.abs(-sinA * relX + cosA * relY);
                  if (ortho <= thickness + (boss.radius || 160)) {
                    if ((this.enemyManager as any).takeBossDamage) (this.enemyManager as any).takeBossDamage(boss, dBase, false, WeaponType.SORCERER_ORB, b.x, b.y, lvl);
                    else boss.hp -= dBase;
                  }
                }
              }
              // Treasure hits
              try {
                const emAny: any = this.enemyManager as any;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number;y:number;radius:number;active:boolean;hp:number }>;
                  for (let ti = 0; ti < treasures.length; ti++) {
                    const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const relX = t.x - b.x; const relY = t.y - b.y;
                    const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > len) continue;
                    const ortho = Math.abs(-sinA * relX + cosA * relY);
                    if (ortho <= thickness + (t.radius || 22) && typeof emAny.damageTreasure === 'function') {
                      emAny.damageTreasure(t, dBase);
                    }
                  }
                }
              } catch { /* ignore treasure beam errors */ }
            }
          }
        } catch { /* ignore beam errors */ }
        activeBullets.push(b);
        continue;
      }

      // Industrial Grinder orbit handling: isolated branch
      if (b.isOrbiting && b.weaponType === WeaponType.INDUSTRIAL_GRINDER) {
        const specGrind: any = (WEAPON_SPECS as any)[WeaponType.INDUSTRIAL_GRINDER];
        const level = (b as any).level || 1;
        const scaled = specGrind?.getLevelStats ? specGrind.getLevelStats(level) : {};
        const playerRef = this.player;
        const spin = 4.2 * (deltaTime/1000);
        b.orbitAngle = (b.orbitAngle || 0) + spin;
        // Expire grinder after duration
        const nowT = performance.now();
        if ((b as any).endTime && nowT >= (b as any).endTime) { b.active = false; this.bulletPool.push(b); continue; }
        const radius = (scaled.orbitRadius || 140);
        b.x = playerRef.x + Math.cos(b.orbitAngle) * radius;
        b.y = playerRef.y + Math.sin(b.orbitAngle) * radius;
        b.radius = 14;
        if (!b.projectileVisual) b.projectileVisual = { type:'bullet', sprite: 'bullet_grinder', size: b.radius } as any;
        b.lifeMs = Math.max(1, (((b as any).endTime||0) - nowT));
        // Contact damage with faster per-enemy cooldown
  const potential = this.queryEnemies(b.x, b.y, Math.max(28, b.radius + 8));
        if (!b.contactCooldownMap) b.contactCooldownMap = {};
        for (let ei=0; ei<potential.length; ei++){
          const e = potential[ei]; if (!e.active || e.hp<=0) continue;
          const dxE = e.x - b.x; const dyE = e.y - b.y; const rs = (e.radius||16) + (b.radius*0.55);
          if (dxE*dxE + dyE*dyE <= rs*rs){
            const eid = (e as any).id || (e as any)._gid || 'e'+ei;
            const nextOk = b.contactCooldownMap[eid] || 0;
            if (nowT >= nextOk){
              const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.10); }
              const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
              const baseDmg = (specGrind?.getLevelStats ? specGrind.getLevelStats(level).damage : (b.damage||20));
              const dmgBase = baseDmg * (isCrit?critMult:1);
              this.enemyManager.takeDamage(e, dmgBase, isCrit, false, b.weaponType, b.x, b.y, level);
              b.contactCooldownMap[eid] = nowT + 160; // grinder: ~6 ticks/sec per target
              if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, '#7DFFEA');
            }
          }
        }
        // Boss contact for grinder
        {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const dxB = boss.x - b.x; const dyB = boss.y - b.y;
            const rsB = (boss.radius || 160) + (b.radius * 0.55);
            if (dxB*dxB + dyB*dyB <= rsB*rsB) {
              const key = 'boss';
              const nextOkB = b.contactCooldownMap[key] || 0;
              if (nowT >= nextOkB) {
                const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.10); }
                const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
                const baseDmg = (specGrind?.getLevelStats ? specGrind.getLevelStats(level).damage : (b.damage||20));
                const dmgBase = baseDmg * (isCrit?critMult:1);
                if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                  (this.enemyManager as any).takeBossDamage(boss, dmgBase, isCrit, b.weaponType, b.x, b.y, level);
                } else {
                  // Fallback
                  boss.hp -= dmgBase;
                  window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage: dmgBase, crit: isCrit, x: b.x, y: b.y } }));
                }
                b.contactCooldownMap[key] = nowT + 160;
                if (this.particleManager) this.particleManager.spawn(boss.x, boss.y, 1, '#7DFFEA');
              }
            }
          }
        }
        activeBullets.push(b);
        continue;
      }

      // Scrap Lash: returning boomerang blade (Scavenger replacement)
      if (b.active && b.weaponType === WeaponType.SCRAP_LASH) {
        // Initialize return parameters on first tick
        if ((b as any)._lashInit !== true) {
          (b as any)._lashInit = true;
          // Remember launch origin to compute turn-back distance; if player exists, prefer player position
          const pl = this.player;
          (b as any)._srcX = pl ? pl.x : (b.startX ?? b.x);
          (b as any)._srcY = pl ? pl.y : (b.startY ?? b.y);
          // Allow pierces from spec level
          // Infinite pierce: do not limit by spec; trajectory will never change due to hits
          (b as any)._lashPierce = Number.POSITIVE_INFINITY;
          // Slight spin visual via displayAngle
          (b as any)._spin = 0;
          // Capture a per-shot base speed and normalize current velocity to it to avoid speed ratcheting
          try {
            const lvl = ((b as any).level || 1);
            let baseSpeed = Math.hypot(b.vx, b.vy) || 8;
            const specL: any = (WEAPON_SPECS as any)[WeaponType.SCRAP_LASH];
            if (specL && specL.getLevelStats) {
              const scaled = specL.getLevelStats(lvl);
              if (scaled && typeof scaled.speed === 'number') baseSpeed = scaled.speed;
            }
            (b as any)._lashBaseSpeed = baseSpeed;
            const m = Math.hypot(b.vx, b.vy) || 1;
            b.vx = (b.vx / m) * baseSpeed;
            b.vy = (b.vy / m) * baseSpeed;
          } catch { /* ignore */ }
        }
        // Update spin
        (b as any)._spin = ((b as any)._spin || 0) + (deltaTime * 0.02);
        (b as any).displayAngle = (b as any)._spin;
        // Flight and turn-back logic: return only after hitting max distance
        const pl = this.player;
        if ((b as any)._lashPhase == null) (b as any)._lashPhase = 'OUT';
        if ((b as any)._lashPhase === 'OUT' && b.maxDistanceSq !== undefined && b.startX !== undefined && b.startY !== undefined) {
          const dxR = b.x - b.startX; const dyR = b.y - b.startY;
          if ((dxR*dxR + dyR*dyR) >= b.maxDistanceSq) (b as any)._lashPhase = 'RETURN';
        }
        if ((b as any)._lashPhase === 'RETURN' && pl) {
          const dx = pl.x - b.x; const dy = pl.y - b.y; const dist = Math.hypot(dx, dy) || 1;
          // Return at half the base throw speed
          const base = (b as any)._lashBaseSpeed ?? (Math.hypot(b.vx, b.vy) || 8);
          const speed = base * 0.5;
          b.vx = (dx / dist) * speed;
          b.vy = (dy / dist) * speed;
          if (dist < Math.max(22, (b.radius||12) * 1.1)) {
            // Kill on hero touch: despawn and do NOT relaunch
            // Reset per-throw scrap credit map so next throw starts fresh
            (b as any)._scrapCredited = undefined;
            b.active = false;
            this.bulletPool.push(b);
            continue;
          }
        }
  // Integrate position (custom branch bypasses generic integrator)
  // Keep last position for relaunch angle fallback
  (b as any).lastX = b.x; (b as any).lastY = b.y;
  b.x += b.vx;
  b.y += b.vy;
  // No time/distance expiry for Lash; return/catch handles end-of-life
  // Contact damage with limited pierce and armor shred debuff
  const near = this.queryEnemies(b.x, b.y, Math.max(28, b.radius + 8));
    // Resolve boss once to avoid double-processing in generic loop
    let bossRef: any = null;
    try {
      const bm: any = (window as any).__bossManager;
      bossRef = bm && bm.getBoss ? bm.getBoss() : null;
    } catch { /* ignore */ }
        for (let ei = 0; ei < near.length; ei++) {
          const e = near[ei]; if (!e.active || e.hp <= 0) continue;
          // Skip boss here; handled in explicit boss block below to avoid double damage/credit
          if (bossRef && e === bossRef) continue;
          const rs = (e.radius||16) + (b.radius||10);
          const dx = e.x - b.x; const dy = e.y - b.y;
          if (dx*dx + dy*dy <= rs*rs) {
            // Avoid multi-hit per frame via simple per-id gate
            // Resolve a stable enemy id for per-throw/per-enemy gating
            let eid = (e as any).id || (e as any)._gid;
            if (!eid) {
              // Assign a persistent scrap id on first sight if enemy lacks id/_gid
              if (!(e as any)._scrapId) {
                const seqProp = '_scrapSeq';
                if ((this as any)[seqProp] == null) (this as any)[seqProp] = 1;
                (e as any)._scrapId = 'sc' + ((this as any)[seqProp]++);
              }
              eid = (e as any)._scrapId;
            }
      if (!(b as any)._lashHit) (b as any)._lashHit = Object.create(null);
      const nowHit = performance.now();
      const nextOk = (b as any)._lashHit[eid] || 0;
      if (nowHit < nextOk) continue;
      (b as any)._lashHit[eid] = nowHit + 500; // 0.5s per-target cooldown
            const p:any = this.player; const critChance=Math.min(0.6,(((p?.agility||0)*0.5+(p?.luck||0)*0.7)/100 + 0.08));
            const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
            const dmg = (b.damage||28) * (isCrit?critMult:1);
            this.enemyManager.takeDamage(e, dmg, isCrit, false, b.weaponType, b.x, b.y, (b as any).level||1);
            // Increment scrap meter and trigger class explosion on threshold
            // Constraints:
            // - Per shot: only 1 stack per enemy (covers both outbound and return hits)
            // - Per enemy lifetime: max 2 stacks total (enforced in Player.addScrapHitFromEnemy)
            if (p) {
              if (!(b as any)._scrapCredited) (b as any)._scrapCredited = Object.create(null);
              if ((b as any)._scrapCredited[eid] !== 1) {
                (b as any)._scrapCredited[eid] = 1;
                const trig = (p as any).addScrapHitFromEnemy ? (p as any).addScrapHitFromEnemy(eid) : ((p as any).addScrapHits ? (p as any).addScrapHits(1) : false);
              if (trig) {
                // Mirror Scrap-Saw explosion behavior: big blast centered on player + heal
                const pl: any = this.player;
                const reach2 = 120; // SCRAP_SAW range was 140, using fallback value
                const radius2 = Math.max(220, Math.round(reach2 * 1.6));
                const gdm = (p.getGlobalDamageMultiplier?.() ?? (p.globalDamageMultiplier ?? 1));
                const dmgRef = Math.round((b.damage || 20) * 1.25 * (gdm || 1));
                try { window.dispatchEvent(new CustomEvent('scrapExplosion', { detail: { x: pl.x, y: pl.y, damage: dmgRef, radius: radius2, color: '#FFAA33' } })); } catch {}
                // Heal player by 5 HP (scaled by global heal efficiency) and clamp to max
                try {
                  const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
                  const eff = getHealEfficiency(timeSec);
                  const amt = 5 * eff;
                  p.hp = Math.min(p.maxHp || p.hp, p.hp + amt);
                } catch { p.hp = Math.min(p.hp + 5, p.maxHp || p.hp); }
              }
              }
            }
            // Pierce handling: infinite penetration, do not alter velocity or path on hit
          }
        }
        // Boss contact: allow Scrap Lash to hit boss with per-contact cooldown
        try {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const dxB = boss.x - b.x; const dyB = boss.y - b.y;
            const rsB = (boss.radius || 160) + (b.radius || 10);
            if (dxB*dxB + dyB*dyB <= rsB*rsB) {
              const key = 'boss';
              if (!(b as any).contactCooldownMap) (b as any).contactCooldownMap = Object.create(null);
              const nextOk = (b as any).contactCooldownMap[key] || 0;
              const nowB = performance.now();
              if (nowB >= nextOk) {
                const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.08); }
                const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
                const dmg = (b.damage||28) * (isCrit?critMult:1);
                if ((this.enemyManager as any).takeBossDamage) (this.enemyManager as any).takeBossDamage(boss, dmg, isCrit, WeaponType.SCRAP_LASH, b.x, b.y, (b as any).level||1);
                else boss.hp -= dmg;
                (b as any).contactCooldownMap[key] = nowB + 500; // 0.5s per-boss hit cooldown
                if (this.particleManager) this.particleManager.spawn(boss.x, boss.y, 1, '#F6E27F');
                // Lash also contributes to scrap meter on boss hit
                const pAny: any = this.player;
                if (pAny) {
                  if (!(b as any)._scrapCredited) (b as any)._scrapCredited = Object.create(null);
                  const bossKeyCred = 'boss';
                  if ((b as any)._scrapCredited[bossKeyCred] !== 1) {
                    (b as any)._scrapCredited[bossKeyCred] = 1;
                    const trig2 = pAny.addScrapHitFromEnemy ? pAny.addScrapHitFromEnemy('boss') : (pAny.addScrapHits ? pAny.addScrapHits(1) : false);
                  if (trig2) {
                    const pl2: any = this.player;
                    const reach2 = 120; // SCRAP_SAW range was 140, using fallback value
                    const radius2 = Math.max(220, Math.round(reach2 * 1.6));
                    const gdm2 = (pAny.getGlobalDamageMultiplier?.() ?? (pAny.globalDamageMultiplier ?? 1));
                    const dmgRef2 = Math.round((b.damage || 20) * 1.25 * (gdm2 || 1));
                    try { window.dispatchEvent(new CustomEvent('scrapExplosion', { detail: { x: pl2.x, y: pl2.y, damage: dmgRef2, radius: radius2, color: '#FFAA33' } })); } catch {}
                    try {
                      const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
                      const eff = getHealEfficiency(timeSec);
                      const amt = 5 * eff;
                      pAny.hp = Math.min(pAny.maxHp || pAny.hp, pAny.hp + amt);
                    } catch { pAny.hp = Math.min(pAny.hp + 5, pAny.maxHp || pAny.hp); }
                  }
                  }
                }
              }
            }
          }
        } catch { /* ignore */ }
        activeBullets.push(b);
        continue;
      }

  // Store previous position for swept-sphere collision
  const prevX = b.x;
  const prevY = b.y;
  // Record last position for systems that need it (e.g., drone facing, lash relaunch angle)
  (b as any).lastX = prevX;
  (b as any).lastY = prevY;

      // Smart Rifle homing logic – stabilized (reduced "wild" steering, no piercing)
      if (b.weaponType === WeaponType.RAPID && b.active) {
        // Boss priority: if a boss is active & alive, always (re)lock to boss, even mid-flight
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0 && b.targetId !== 'boss') {
          b.targetId = 'boss';
        }
        // Resolve current locked target if any
        let target: any = null;
        if (b.targetId) {
          if (b.targetId === 'boss') {
            if (boss && boss.active && boss.hp > 0) target = boss;
          } else {
            const near = this.queryEnemies(b.x, b.y, 400);
            for (let i2 = 0; i2 < near.length; i2++) {
              const e = near[i2];
              const eid = (e as any).id || (e as any)._gid;
              if (eid === b.targetId && e.active && e.hp > 0) { target = e; break; }
            }
          }
        }
        // Reacquire if no valid target
        if (!target) {
          b.targetId = undefined;
          const reacq = this.selectSmartRifleTarget(b.x, b.y, 900);
          if (reacq) {
            const isBoss = (boss && reacq === boss);
            b.targetId = isBoss ? 'boss' : ((reacq as any).id || (reacq as any)._gid);
            target = reacq;
          }
        }
        if (target) {
          // Angular steering clamp instead of direction lerp to avoid oscillation
          const dx = target.x - b.x;
          const dy = target.y - b.y;
          const desiredAng = Math.atan2(dy, dx);
          const curAng = Math.atan2(b.vy, b.vx);
          let diff = desiredAng - curAng;
          // Wrap to [-PI, PI]
          diff = (diff + Math.PI) % (Math.PI * 2) - Math.PI;
          const turnRate = (b as any).turnRate || 0.09; // radians per 16.67ms frame baseline
          const maxTurn = turnRate * (deltaTime / 16.6667);
          if (diff > maxTurn) diff = maxTurn; else if (diff < -maxTurn) diff = -maxTurn;
          const newAng = curAng + diff;
          // Acceleration curve: exponential ramp for quick lock-on chase
          const curSpeed = Math.hypot(b.vx, b.vy) || 0.0001;
          const spawnT = (b as any)._spawnTime || performance.now();
          const aliveMs = Math.max(0, performance.now() - spawnT);
          // Base speed remembered from initial spawn
          if ((b as any).baseSpeed == null) (b as any).baseSpeed = curSpeed;
          const baseSpeed = (b as any).baseSpeed;
          // Exponential ramp: approaches +150% quickly (~0.8s to 63%, ~2s near max)
          const maxBoost = 1.5; // +150%
          const k = 0.004; // growth rate
          const rampT = 1 - Math.exp(-k * aliveMs);
          const targetSpeed = baseSpeed * (1 + maxBoost * rampT);
          // Faster convergence toward target speed
          let newSpeed = curSpeed + (targetSpeed - curSpeed) * Math.min(1, (deltaTime / 80));
          const maxSpeed = baseSpeed * 2.2; // hard cap
          if (newSpeed > maxSpeed) newSpeed = maxSpeed;
          b.vx = Math.cos(newAng) * newSpeed;
          b.vy = Math.sin(newAng) * newSpeed;
          b.speed = newSpeed; // cache
        }
      }
      // Basic Pistol: subtle curving toward nearby forward targets (gentle seeking) with optional wobble
      if (b.weaponType === WeaponType.PISTOL && b.active) {
        const nowT = performance.now();
        const seekEvery = 80; // ms
        const nextAt = (b as any)._seekNextAt || 0;
        // Ensure base turn rate cached
        if ((b as any)._turnRate == null) (b as any)._turnRate = 0.06; // radians per 16.67ms baseline
        if (nowT >= nextAt) {
          (b as any)._seekNextAt = nowT + seekEvery;
          // Acquire a forward target within short range
          const searchRadius = 260;
          const vx = b.vx, vy = b.vy; const sp = Math.hypot(vx, vy) || 0.0001;
          const fx = vx / sp, fy = vy / sp;
          const cand = this.queryEnemies(b.x, b.y, searchRadius);
          let best: any = null; let bestScore = -Infinity;
          for (let ci = 0; ci < cand.length; ci++) {
            const e = cand[ci]; if (!e.active || e.hp <= 0) continue;
            const dx = e.x - b.x; const dy = e.y - b.y; const d2 = dx*dx + dy*dy; if (d2 < 12*12) continue; // skip self-collocated
            const dist = Math.sqrt(d2);
            const dot = (dx*fx + dy*fy) / (dist || 1);
            if (dot <= 0.2) continue; // only consider mostly forward
            // Score: forwardness weighted, closer is better
            const score = dot * 1.2 + (1 / Math.max(24, dist));
            if (score > bestScore) { bestScore = score; best = e; }
          }
          if (best) {
            const dx = best.x - b.x; const dy = best.y - b.y;
            const desired = Math.atan2(dy, dx);
            const cur = Math.atan2(b.vy, b.vx);
            let diff = desired - cur; diff = (diff + Math.PI) % (Math.PI*2) - Math.PI;
            const maxTurn = (b as any)._turnRate * (deltaTime / 16.6667);
            if (diff > maxTurn) diff = maxTurn; else if (diff < -maxTurn) diff = -maxTurn;
            const ang = cur + diff;
            const speed = Math.hypot(b.vx, b.vy) || 0.0001;
            b.vx = Math.cos(ang) * speed;
            b.vy = Math.sin(ang) * speed;
          } else {
            // Light wobble when no clear forward target, for more interesting flight
            const phase = ((b as any)._curvePhase = (((b as any)._curvePhase||0) + 0.06 * (deltaTime/16.6667)));
            const wobble = Math.sin(phase) * 0.01; // ~0.57°
            const cur = Math.atan2(b.vy, b.vx);
            const speed = Math.hypot(b.vx, b.vy) || 0.0001;
            const ang = cur + wobble;
            b.vx = Math.cos(ang) * speed;
            b.vy = Math.sin(ang) * speed;
          }
        }
      }
      // Plasma phased logic (charge -> travel); fragment bullets skip charge
      if (b.weaponType === WeaponType.PLASMA && b.active) {
        if ((b as any).isPlasmaFragment) {
          // Simple acceleration + faint wobble
          const curSpd = Math.hypot(b.vx, b.vy) || 0.0001;
          const target = 13.5;
          const ns = curSpd + (target - curSpd) * 0.08 * (deltaTime/16.6667);
          b.vx = b.vx / curSpd * ns;
          b.vy = b.vy / curSpd * ns;
        } else {
          const spec: any = (WEAPON_SPECS as any)[WeaponType.PLASMA];
          if (!b.phase) { b.phase = 'CHARGING'; (b as any)._spawnTime = (b as any)._spawnTime || performance.now(); }
          if (b.phase === 'CHARGING') {
            const chargeTime = spec?.chargeTimeMs || 450;
            const spawnT = (b as any)._spawnTime || performance.now();
            const elapsed = performance.now() - spawnT;
            const t = Math.min(1, elapsed / chargeTime);
            (b as any).chargeT = t;
            // Latch to player + forward offset (live follow). Offset grows slightly with charge for visual feedback.
            const pl: any = this.player;
            if (pl) {
              const ang = (b as any)._initialAngle || Math.atan2(b.vy||0.0001,b.vx||0.0001);
              const baseOff = 34;
              const extra = 10 * t;
              b.x = pl.x + Math.cos(ang) * (baseOff + extra);
              b.y = pl.y + Math.sin(ang) * (baseOff + extra);
            }
            // Visual growth encoded via projectileVisual size (read in draw)
            if (t >= 1) {
              b.phase = 'TRAVEL';
              // Mark travel start to support short arming window (ignores early collisions near player/hazards)
              (b as any)._travelStartTime = performance.now();
              (b as any)._travelStartX = b.x; (b as any)._travelStartY = b.y;
              // Apply full-charge heat
              try { const p:any = this.player; const add=spec?.heatPerFullCharge||0.42; p.plasmaHeat = Math.min(1,(p.plasmaHeat||0)+add); } catch {}
              window.dispatchEvent(new CustomEvent('plasmaPulse',{ detail:{ x:b.x, y:b.y, radius:(b.projectileVisual as any)?.size*1.9 } }));
              // Normalize velocity to base speed if minimal
              const baseSpd = spec?.speed || 7.5;
              const mv = Math.hypot(b.vx,b.vy)||1;
              b.vx = b.vx/mv * baseSpd;
              b.vy = b.vy/mv * baseSpd;
            } else {
              // Incremental heat (minor) only once at start
              if (!(b as any)._heatAppliedInitial) { try { const p:any=this.player; const add=spec?.heatPerShot||0.25; p.plasmaHeat=Math.min(1,(p.plasmaHeat||0)+add*0.25); } catch {}; (b as any)._heatAppliedInitial=true; }
              activeBullets.push(b); // hold in place
              continue; // skip movement/collision while charging
            }
          } else if (b.phase === 'TRAVEL') {
            // Mild acceleration toward configured speed (no extra multiplier)
            const cur = Math.hypot(b.vx,b.vy)||0.0001;
            const spec: any = (WEAPON_SPECS as any)[WeaponType.PLASMA];
            const target = (spec?.speed != null ? spec.speed : 7.5);
            const ns = cur + (target - cur) * 0.06 * (deltaTime/16.6667);
            b.vx = b.vx/cur * ns;
            b.vy = b.vy/cur * ns;
          }
        }
      }
      // Tachyon/Singularity spear: realistic spear travel physics (ease-in + slight drag; slowdown on pierce)
      if ((b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR) && b.active) {
        // Cache base speed from spec once
        const spec: any = (WEAPON_SPECS as any)[b.weaponType];
        if ((b as any)._baseSpeed == null) (b as any)._baseSpeed = spec?.speed || Math.hypot(b.vx, b.vy) || 12;
        const base = (b as any)._baseSpeed;
        const cur = Math.hypot(b.vx, b.vy) || 0.0001;
        // Ease-in acceleration toward base speed early in flight
        const tMs = performance.now() - ((b as any)._spawnTime || performance.now());
        const accelPhase = Math.min(1, tMs / 180); // first 180ms
        const accel = 0.18 * (deltaTime / 16.6667) * (0.4 + 0.6 * accelPhase); // ramping accel
        let target = base * (1 + 0.04 * Math.sin(tMs * 0.01)); // tiny jitter for life
        let ns = cur + (target - cur) * accel;
        // Air drag: mild reduction to avoid infinite straight-line with huge speed
        const drag = 0.004 * (deltaTime / 16.6667);
        ns *= (1 - drag);
        b.vx = (b.vx / cur) * ns;
        b.vy = (b.vy / cur) * ns;
        // Record speed for potential hit-based slowdown hook
        (b as any)._lastSpeed = ns;
      }
    // Kamikaze Drone phased logic
  if (b.weaponType === WeaponType.HOMING && b.active) {
    const now = performance.now();
  if (!b.phase) b.phase = 'ASCEND';
  const player = this.player;
  if (b.phase === 'ASCEND') {
          // Absolutely no collisions during takeoff: zero hit radius and mark disabled
          (b as any).collisionDisabled = true;
          b.radius = 0;
          // Smooth ascent — at least ~3s visible takeoff before any dive
          const ASCEND_DURATION = 3000; // ms
          const phaseElapsed = now - (b.phaseStartTime || now);
          // Initial tether window anchors directly over the player to avoid instant lateral pop
          const TETHER_MS = 120;
          // Establish / update anchor (player position) so orbit stays around moving player even if reference lost later
          if (player) {
            (b as any).anchorX = player.x;
            (b as any).anchorY = player.y;
          }
          if ((b as any).anchorX === undefined) {
            (b as any).anchorX = player ? player.x : b.x;
            (b as any).anchorY = player ? player.y : b.y;
          } else if (player) { // update anchor to current player position
            (b as any).anchorX = player.x;
            (b as any).anchorY = player.y;
          }
          const anchorX = (b as any).anchorX;
          const anchorY = (b as any).anchorY;
          if (phaseElapsed < TETHER_MS) {
            // Hard lock to player center; no lateral displacement yet
            b.orbitRadius = 0;
            // Prefer exact original spawn center if recorded to avoid micro jitter when player moves on same frame
            const scx = (b as any).spawnCenterX;
            const scy = (b as any).spawnCenterY;
            b.x = (scx != null ? scx : anchorX);
            b.y = (scy != null ? scy : anchorY);
            // Gentle altitude ramp so it "pops" in smoothly
            const tLock = phaseElapsed / TETHER_MS;
            b.altitudeScale = 0.22 + 0.26 * tLock; // 0.22 -> ~0.48
            // Slight pre-spin so later easing picks up smoothly
            b.orbitAngle = (b.orbitAngle || 0) + 1.6 * (deltaTime / 1000);
          } else {
            const maxOrbit = 280; // much bigger takeoff circle for smoother, less-glitchy turns
            // Rebase time so easing starts after tether (continuity at 0)
            const ascendT = Math.min(1, (phaseElapsed - TETHER_MS) / (ASCEND_DURATION - TETHER_MS));
            // Smooth easeInOut for radius (accelerate then decelerate) -> easeInOutCubic
            const easedRadius = ascendT < 0.5 ? 4 * ascendT * ascendT * ascendT : 1 - Math.pow(-2 * ascendT + 2, 3) / 2;
            b.orbitRadius = maxOrbit * easedRadius;
            // Angular speed smoothly decelerates (ease-out sine)
            const easedAng = Math.sin((ascendT * Math.PI) / 2); // 0->1
            const angStart = 1.15; // slower start to keep linear speed reasonable at larger radius
            const angEnd = 0.65;   // soft turns
            const angSpeed = (angStart + (angEnd - angStart) * easedAng) * (deltaTime / 1000);
            b.orbitAngle = (b.orbitAngle || 0) + angSpeed;
            const orad = b.orbitRadius || 0;
            const ox = Math.cos(b.orbitAngle) * orad;
            const oy = Math.sin(b.orbitAngle) * orad * 0.55;
            b.x = anchorX + ox;
            b.y = anchorY + oy;
            // Smooth altitude easing (easeOutSine) from ~0.48 -> 1.0
            const altEased = Math.sin((ascendT * Math.PI) / 2);
            b.altitudeScale = 0.48 + 0.52 * altEased;
          }

          // Trail disabled for Quantum Halo (no accumulation)

      // Transition to HOVER at apex; defer targeting to HOVER phase
      // Use 1 when still in tether (ascendT undefined there) only when overall phaseElapsed exceeds ASCEND_DURATION
    const ascendComplete = phaseElapsed >= ASCEND_DURATION && b.phase === 'ASCEND';
    if (ascendComplete) {
            b.phase = 'HOVER';
            b.phaseStartTime = performance.now();
            (b as any).hoverLastScan = 0;
            (b as any).hoverScanCount = 0;
          }
  } else if (b.phase === 'HOVER') {
          // Still collisionless while hovering pre-dive
          (b as any).collisionDisabled = true;
          b.radius = 0;
          const HOVER_DURATION = 520; // visual pacing only; no forced dive
          const SCAN_INTERVAL = 120;  // ms — snappier acquisition
          const hoverElapsed = now - (b.phaseStartTime || now);
          // Update anchor to follow player while hovering so drone orbits moving player
          if (player) {
            (b as any).anchorX = player.x;
            (b as any).anchorY = player.y;
          }
          const anchorX = (b as any).anchorX;
          const anchorY = (b as any).anchorY;
          // Faster gentle spin + breathing radius to avoid static feel
          b.orbitAngle = (b.orbitAngle || 0) + 1.0 * (deltaTime / 1000);
          const baseRad = b.orbitRadius || 0;
          const seed = (b as any)._hoverSeed || 0;
          const breathe = 1 + 0.05 * Math.sin(now * 0.005 + seed);
          const oradH = baseRad * breathe;
          const ox = Math.cos(b.orbitAngle) * oradH;
          const oy = Math.sin(b.orbitAngle) * oradH * 0.55;
          b.x = anchorX + ox;
          b.y = anchorY + oy;
          b.altitudeScale = 1;
          // Face tangential direction (rotate with orbit path) for visual feedback
          const tangentAng = Math.atan2(Math.cos(b.orbitAngle) * 0.55, -Math.sin(b.orbitAngle)); // derivative of param ellipse
          (b as any).facingAng = tangentAng;
          if (((b as any).hoverLastScan || 0) + SCAN_INTERVAL <= now) {
            (b as any).hoverLastScan = now;
            (b as any).hoverScanCount++;
            let bestCluster: { x: number; y: number; count: number; enemy?: any } | null = null;
            let fallbackSingle: any = null;
            let fallbackDist = Infinity;
            if (player) {
              const candidates = this.queryEnemies(player.x, player.y, 1400);
              if (candidates.length > 0) (b as any).seenEnemy = true; // flag that at least one enemy existed during hover
              for (let ei = 0; ei < candidates.length; ei++) {
                const e = candidates[ei];
                if (!e.active || e.hp <= 0) continue;
                const ex = e.x, ey = e.y;
                const pdx = ex - player.x; const pdy = ey - player.y; const pd2 = pdx*pdx + pdy*pdy;
                if (pd2 < fallbackDist) { fallbackDist = pd2; fallbackSingle = e; }
                let count = 0;
                for (let ej = 0; ej < candidates.length; ej++) {
                  const f = candidates[ej];
                  if (!f.active || f.hp <= 0) continue;
                  const dxC = f.x - ex; const dyC = f.y - ey;
                  if (dxC*dxC + dyC*dyC <= 200*200) count++;
                }
                if (count >= 3 && (!bestCluster || count > bestCluster.count)) bestCluster = { x: ex, y: ey, count, enemy: e };
              }
            }
            // Require at least one scan AND a found enemy before allowing dive
            // Enforce minimum 3s takeoff time since spawn
            const minTakeoffMs = 3000;
            const sinceSpawn = now - (((b as any).spawnTime || (b as any).phaseStartTime || now));
            if ((b as any).hoverScanCount >= 1 && (bestCluster || fallbackSingle) && sinceSpawn >= minTakeoffMs) {
              b.phase = 'DIVE';
              b.phaseStartTime = performance.now();
              // Defer actual coordinate lock until first DIVE update for freshest target
              (b as any)._pendingDiveAcquire = true;
              if (bestCluster && bestCluster.enemy) (b as any)._pendingClusterEnemyId = (bestCluster.enemy as any).id || (bestCluster.enemy as any)._gid;
              if (fallbackSingle) (b as any)._pendingFallbackEnemyId = (fallbackSingle as any).id || (fallbackSingle as any)._gid;
            }
          }
          // Do not force a dive; remain hovering until an enemy is detected. Keeps drones from being wasted.
  } else if (b.phase === 'DIVE') {
          // Stay collisionless in air; only explode at destination (or timeout)
          (b as any).collisionDisabled = true;
          if (!b.radius || b.radius < 8) b.radius = 12; // radius for visuals only
          if ((b as any)._pendingDiveAcquire) {
            delete (b as any)._pendingDiveAcquire;
            const playerRef = this.player;
            const cx = playerRef ? playerRef.x : b.x;
            const cy = playerRef ? playerRef.y : b.y;
            const clusterId = (b as any)._pendingClusterEnemyId;
            const fallbackId = (b as any)._pendingFallbackEnemyId;
            let targetEnemy: any = null;
            const nearby = this.queryEnemies(cx, cy, 1400);
            let nearest: any = null; let nearestD2 = Infinity;
            for (let i2=0;i2<nearby.length;i2++) {
              const e = nearby[i2]; if (!e.active || e.hp<=0) continue;
              const eid = (e as any).id || (e as any)._gid;
              const dxp = e.x - cx; const dyp = e.y - cy; const d2p = dxp*dxp + dyp*dyp;
              if (d2p < nearestD2) { nearestD2 = d2p; nearest = e; }
              if (clusterId && eid===clusterId) targetEnemy = e;
            }
            if (!targetEnemy && fallbackId) {
              for (let i3=0;i3<nearby.length;i3++){ const e=nearby[i3]; const eid=(e as any).id || (e as any)._gid; if (eid===fallbackId && e.active && e.hp>0){ targetEnemy=e; break; }}
            }
            if (!targetEnemy) targetEnemy = nearest;
            if (targetEnemy) { b.targetX = targetEnemy.x; b.targetY = targetEnemy.y; (b as any).lockedTargetId = (targetEnemy as any).id || (targetEnemy as any)._gid; }
            if (b.targetX == null || b.targetY == null) {
              const diveOut = Math.min((b.orbitRadius || 0) + 160, 300);
              const anchorX3 = (b as any).anchorX ?? b.x; const anchorY3 = (b as any).anchorY ?? b.y;
              b.targetX = anchorX3 + Math.cos(b.orbitAngle || 0) * diveOut;
              b.targetY = anchorY3 + Math.sin(b.orbitAngle || 0) * diveOut * 0.55;
            }
            // Minimum distance check
            const minD2 = 64*64;
            let dxm = (b.targetX as number) - b.x; let dym = (b.targetY as number) - b.y; let d2m = dxm*dxm + dym*dym;
            if (d2m < minD2) {
              const ang = Math.atan2(dym, dxm) || (b.orbitAngle || 0);
              const extend = 140;
              b.targetX = b.x + Math.cos(ang) * extend;
              b.targetY = b.y + Math.sin(ang) * extend * 0.55;
            }
            // Seed initial velocity along current tangential facing to keep direction continuity
            const fa = (b as any).facingAng;
            if (typeof fa === 'number') {
              const seedSpeed = Math.max(2.2, Math.min(4.0, (b.orbitRadius || 120) / 60));
              b.vx = Math.cos(fa) * seedSpeed;
              b.vy = Math.sin(fa) * seedSpeed;
            } else {
              // Fallback: use orbit tangent
              const tangent = (b.orbitAngle || 0) + Math.PI * 0.5;
              const seedSpeed = 3.0;
              b.vx = Math.cos(tangent) * seedSpeed;
              b.vy = Math.sin(tangent) * seedSpeed;
            }
          }
          // Dive phase: slower, precise homing pursuit with adaptive speed toward locked/moving target.
          const phaseElapsed = now - (b.phaseStartTime || now);
          const MAX_DURATION = 2200; // absolute safety cutoff (longer pursuit)
          // If we have a locked enemy id, update targetX/Y to its current position (live tracking)
          const lockedId = (b as any).lockedTargetId;
          if (lockedId) {
            const nearby = this.queryEnemies(b.x, b.y, 1200);
            for (let i2=0;i2<nearby.length;i2++) {
              const e = nearby[i2];
              const eid = (e as any).id || (e as any)._gid;
              if (eid === lockedId && e.active && e.hp > 0) { b.targetX = e.x; b.targetY = e.y; break; }
            }
          }
          const tx = b.targetX ?? b.x;
          const ty = b.targetY ?? b.y;
          let dxDive = tx - b.x;
          let dyDive = ty - b.y;
          const distDive = Math.hypot(dxDive, dyDive) || 1;
          const tNorm = Math.min(1, phaseElapsed / 1400);
          // Desired direction normalized
          dxDive /= distDive; dyDive /= distDive;
          // Adaptive target speed: slower start, capped; gently ramps but also clamps by remaining distance to reduce overshoot
          const baseSpeed = 3.8; // quicker start
          const maxSpeed = 12.0; // higher cap for long dives
          const ramp = 0.30 + 1.05 * tNorm; // brisk ramp
          let desiredSpeed = Math.min(maxSpeed, baseSpeed * ramp);
          // Clamp by remaining distance so last frames decelerate automatically
          desiredSpeed = Math.min(desiredSpeed, Math.max(2.0, distDive / 16));
          // Smooth steering: blend current velocity direction toward desired direction
          const curSpeed = Math.hypot(b.vx || 0, b.vy || 0);
          let cvx = curSpeed > 0.001 ? b.vx / curSpeed : dxDive;
          let cvy = curSpeed > 0.001 ? b.vy / curSpeed : dyDive;
          // Soft turns: lower blend + explicit heading clamp
          const turnRate = 0.10 * (deltaTime / 16.6667);
          cvx = cvx + (dxDive - cvx) * Math.min(1, turnRate);
          cvy = cvy + (dyDive - cvy) * Math.min(1, turnRate);
          const nrm = Math.hypot(cvx, cvy) || 1;
          cvx /= nrm; cvy /= nrm;
          // Heading clamp (soft turns): limit angular change per second (ramped early to avoid abrupt flips)
          const prevHeading = (curSpeed > 0.001) ? Math.atan2(b.vy, b.vx) : Math.atan2(dyDive, dxDive);
          const desiredHeading = Math.atan2(cvy, cvx);
          let dTheta = desiredHeading - prevHeading;
          while (dTheta > Math.PI) dTheta -= Math.PI * 2;
          while (dTheta < -Math.PI) dTheta += Math.PI * 2;
          const BASE_TURN = 1.0;
          const turnRamp = 0.55 + 0.45 * Math.min(1, phaseElapsed / 280); // slower at start, reaches BASE_TURN quickly
          const maxStep = BASE_TURN * turnRamp * (deltaTime / 1000);
          if (dTheta > maxStep) dTheta = maxStep; else if (dTheta < -maxStep) dTheta = -maxStep;
          const newHeading = prevHeading + dTheta;
          b.vx = Math.cos(newHeading) * desiredSpeed;
          b.vy = Math.sin(newHeading) * desiredSpeed;
          b.x += b.vx;
          b.y += b.vy;
          (b as any).facingAng = Math.atan2(b.vy, b.vx);
          // Shrink more gradually; reaches minimum only very near impact for precision feel
          b.altitudeScale = Math.max(0.12, 1 - 0.88 * tNorm * tNorm);
          // Trail disabled for Quantum Halo (no accumulation)
          // Impact condition: near target OR elapsed > cutoff
          const remaining = Math.hypot((tx - b.x), (ty - b.y));
          // Explode only on reaching the destination (no mid-air enemy collisions)
          let impact = remaining < 22; // slightly larger for feel
          if (impact || phaseElapsed > MAX_DURATION) {
            // Dispatch base radius (110) – ExplosionManager will upscale to achieve ~300% area
            // Fire event for visuals, and directly apply via ExplosionManager if available
            try { window.dispatchEvent(new CustomEvent('droneExplosion', { detail: { x: b.x, y: b.y, damage: b.damage, radius: 110 } })); } catch {}
            try { (this.player as any)?.gameContext?.explosionManager?.triggerDroneExplosion?.(b.x, b.y, b.damage, 110, '#00BFFF'); } catch {}
            b.active = false;
            this.bulletPool.push(b);
            continue;
          }
        }
        // Update facing angle during ASCEND using tangential direction if not yet set this frame
        if (b.phase === 'ASCEND') {
          const lastX = (b as any).lastX;
          const lastY = (b as any).lastY;
          const dxm = b.x - lastX;
          const dym = b.y - lastY;
          if (dxm*dxm + dym*dym > 0.0001) (b as any).facingAng = Math.atan2(dym, dxm);
  }
  // Add drone bullet to active list and skip generic collision (explodes only at target)
  activeBullets.push(b);
  continue;
      }

      // Move projectile after steering update
      // Position advancement (skip for ascend orbit where we directly set x/y)
      if (!(b.weaponType === WeaponType.HOMING && b.phase === 'ASCEND')) {
        // Gradual acceleration for Mech Mortar to feel heavier then ramp up
        if (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) {
          const spawnT = (b as any)._spawnTime || 0;
          const elapsed = performance.now() - spawnT;
          // Acceleration phase first 700ms: scale speed from 70% -> 115%
          const accelPhase = 700;
          const t = Math.min(1, elapsed / accelPhase);
          const speedScale = 0.7 + t * 0.45; // 0.7 -> 1.15
          const baseSpeed = (b.weaponType === WeaponType.SIEGE_HOWITZER ? (WEAPON_SPECS as any)[WeaponType.SIEGE_HOWITZER]?.speed : (WEAPON_SPECS as any)[WeaponType.MECH_MORTAR]?.speed) || 7;
          const curSpeed = baseSpeed * speedScale;
          const ang = Math.atan2(b.vy, b.vx);
          b.vx = Math.cos(ang) * curSpeed;
          b.vy = Math.sin(ang) * curSpeed;
        }
        b.x += b.vx;
        b.y += b.vy;
      }
  if (b.lifeMs === undefined) b.lifeMs = b.life * 16.6667; // migrate frames->ms
  b.lifeMs -= deltaTime;

      // Hard distance cap (independent of frame-based life) for consistent range feel
      if (b.maxDistanceSq !== undefined && b.startX !== undefined && b.startY !== undefined) {
        const dxRange = b.x - b.startX;
        const dyRange = b.y - b.startY;
        if ((dxRange * dxRange + dyRange * dyRange) >= b.maxDistanceSq) {
          // For Mech Mortar, trigger explosion on range expiration (same as collision / life expiry)
          if (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) {
            b.active = false;
            b.vx = 0; b.vy = 0;
            (b as any)._exploded = true;
            (b as any)._explosionStartTime = performance.now();
            (b as any)._maxExplosionDuration = 1000;
            b.lifeMs = 0;
            let exRadius = (b as any).explosionRadius;
            if (exRadius == null) {
              try {
                const spec = (WEAPON_SPECS as any)[b.weaponType === WeaponType.SIEGE_HOWITZER ? WeaponType.SIEGE_HOWITZER : WeaponType.MECH_MORTAR];
                if (spec?.explosionRadius) exRadius = spec.explosionRadius;
              } catch {}
            }
            if (exRadius == null) exRadius = 200;
            // Pre-implosion then main explosion (delay keeps visual sequence consistent)
            try { window.dispatchEvent(new CustomEvent('mortarImplosion', { detail: { x: b.x, y: b.y, radius: exRadius * 0.55, color: (b.weaponType === WeaponType.SIEGE_HOWITZER ? '#B22222' : '#FFE66D'), delay: 90 } })); } catch {}
            try { window.dispatchEvent(new CustomEvent('mortarExplosion', { detail: { x: b.x, y: b.y, damage: b.damage, hitEnemy: false, radius: exRadius, delay: 90 } })); } catch {}
            try { (this.player as any)?.gameContext?.explosionManager?.triggerTitanMortarExplosion?.(b.x, b.y, b.damage, exRadius, (b.weaponType === WeaponType.SIEGE_HOWITZER ? '#B22222' : '#FFE66D')); } catch {}
            this.bulletPool.push(b);
            continue;
          } else {
            // On general range expiration, BIO_TOXIN/LIVING_SLUDGE should also drop a puddle
            if ((b.weaponType === WeaponType.BIO_TOXIN || b.weaponType === WeaponType.LIVING_SLUDGE)) {
              try {
                const lvl = (b as any).level || 1;
                const baseR = 28, baseMs = 2600;
                let radius: number = (b as any).puddleRadius;
                let lifeMs: number = (b as any).puddleLifeMs;
                if (radius == null) {
                  radius = baseR + (lvl - 1) * 3;
                  try { const mul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1); radius *= (mul || 1); } catch { /* ignore */ }
                }
                if (lifeMs == null) lifeMs = baseMs + (lvl - 1) * 200;
                const isSludge = (b.weaponType === WeaponType.LIVING_SLUDGE);
                const potency = isSludge ? Math.max(0, Math.round((lvl - 1) * 0.6)) : 0;
                this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs, isSludge ? { isSludge: true, potency } : undefined);
              } catch { /* ignore spawn errors */ }
            }
            b.active = false;
            this.bulletPool.push(b);
            continue;
          }
        }
      }

  let hitEnemy: Enemy | null = null;
  let intersectionPoint: { x: number, y: number } | null = null;
  // Track boss/treasure impact for heavy shells so they don't pass through
  let hitBoss = false;
  let hitTreasure = false;

  // Use spatial grid to find potential enemies near the bullet
  // Query potential enemies near the bullet's current position
  const potentialEnemies = this.queryEnemies(b.x, b.y, b.radius);
  // Plasma friendly arming zone + minimal arming time/distance:
  // While within the friendly hazard radius around the player OR within a small
  // fixed arming distance/time from travel start, skip enemy collision checks.
  if (b.weaponType === WeaponType.PLASMA && !(b as any).isPlasmaFragment) {
        const px = (this.player?.x || 0); const py = (this.player?.y || 0);
        const dxp = b.x - px; const dyp = b.y - py;
        const dist2FromPlayer = dxp*dxp + dyp*dyp;
        const MIN_ARM_DIST = 96; // px
        const MIN_ARM_DIST2 = MIN_ARM_DIST * MIN_ARM_DIST;
        const nowT = performance.now();
        const travelStart = (b as any)._travelStartTime || 0;
        const ARM_MS = 120; // ~0.12s
        const withinFriendly = (friendlySafeR2 > 0) && (dist2FromPlayer <= friendlySafeR2);
        const withinMinDist = dist2FromPlayer <= MIN_ARM_DIST2;
        const withinMinTime = travelStart > 0 && (nowT - travelStart) <= ARM_MS;
        if (withinFriendly || withinMinDist || withinMinTime) {
          // Defer collision for this frame, keep traveling
          activeBullets.push(b);
          continue;
        }
  }
  for (const enemy of potentialEnemies) {
        if (!enemy.active || enemy.hp <= 0) continue; // Only check active, alive enemies

        // Smart Rifle (RAPID): ignore all collisions except its locked targetId
        if (b.weaponType === WeaponType.RAPID) {
          const eid = (enemy as any).id || (enemy as any)._gid;
            if (b.targetId && eid !== b.targetId) {
              continue; // skip non-designated enemies
            }
            // If no targetId yet (should rarely happen), skip collisions entirely until lock acquired
            if (!b.targetId) continue;
        }

    // For Mech Mortar and Siege Howitzer, use swept-sphere collision with NO arming delay (immediate close-range hits)
          if (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) {
            intersectionPoint = this.lineCircleIntersect(prevX, prevY, b.x, b.y, enemy.x, enemy.y, b.radius + enemy.radius);
        } else {
          // For PSIONIC_WAVE, use a swept-segment vs circle test with effective beam thickness
    if (b.weaponType === WeaponType.PSIONIC_WAVE) {
            const thickness = Math.max(8, (((b.projectileVisual as any)?.thickness) || 12));
            const effR = (enemy.radius || 16) + thickness * 0.5; // half-thickness as beam radius
            intersectionPoint = this.lineCircleIntersect(prevX, prevY, b.x, b.y, enemy.x, enemy.y, effR);
          } else {
            // Other bullets: simple circle-circle collision
            const dx = b.x - enemy.x;
            const dy = b.y - enemy.y;
            const rs = b.radius + enemy.radius;
            if (dx*dx + dy*dy < rs*rs) intersectionPoint = { x: b.x, y: b.y };
          }
        }

  // (moved below) Mortar/Howitzer boss/treasure sweep is handled after the enemy loop so it still happens when no enemies are nearby.

  if (intersectionPoint) {
          // Prevent double-hit on same enemy in a single frame (swept path could overlap)
          const enemyId = (enemy as any).id || (enemy as any)._gid || undefined;
          if (enemyId && b.hitIds && b.hitIds.indexOf(enemyId) !== -1) {
            intersectionPoint = null; // Already hit this enemy; ignore
          } else {
            hitEnemy = enemy;
            if (enemyId && b.hitIds) b.hitIds.push(enemyId);
            const weaponLevel = (b as any).level ?? 1;
            // Crit calculation now derives from player passive values if present
            const p: any = this.player;
            let critChance = 0.15; // default baseline
            if (p) {
              const agi = p.agility || 0;
              const luck = p.luck || 0;
              const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5); // percent
              const playerBonus = p.critBonus ? p.critBonus * 100 : 0; // convert 0..0.5 to percent
              const bulletBonus = (b as any).critBonus ? ((b as any).critBonus * 100) : 0;
              const totalPct = Math.min(100, basePct + playerBonus + bulletBonus);
              critChance = totalPct / 100; // normalize
            }
            const critMult = p?.critMultiplier ?? 2.0;
            const isCritical = Math.random() < critChance;
            // Bio Toxin: no direct impact damage; act as a zero-damage puddle spawner only
            if (b.weaponType !== WeaponType.BIO_TOXIN) {
              let outDamage = isCritical ? b.damage * critMult : b.damage;
              // Resonance stacks for Psionic Wave: +10% per stack, max 6; on reaching 6, stun 250ms and consume
              if (b.weaponType === WeaponType.PSIONIC_WAVE) {
                const anyE: any = enemy as any;
                const nowS = performance.now();
                let stacks = Math.min(6, ((anyE._resonanceStacks | 0) + 1));
                anyE._resonanceStacks = stacks;
                anyE._resonanceExpire = nowS + 4000; // 4s decay timer refresh
                const bonus = 1 + (Math.min(6, stacks) * 0.10);
                outDamage *= bonus;
                if (stacks >= 6) {
                  // Apply a brief stun and consume stacks
                  anyE._paralyzedUntil = Math.max(anyE._paralyzedUntil || 0, nowS + 250);
                  anyE._resonanceStacks = 0;
                }
              }
              this.enemyManager.takeDamage(enemy, outDamage, isCritical, false, b.weaponType, b.x, b.y, weaponLevel);
              // Tech Warrior charged volley: per-bullet lifesteal on hit
              try {
                if ((b as any)._isVolley) {
                  const frac = (b as any)._lifestealFrac || 0;
                  if (frac > 0 && outDamage > 0) {
                    const p: any = this.player;
                    const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
                    const eff = getHealEfficiency(timeSec);
                    const heal = outDamage * frac * eff;
                    p.hp = Math.min(p.maxHp || p.hp, p.hp + heal);
                  }
                }
              } catch { /* ignore */ }
              if (this.particleManager) this.particleManager.spawn(enemy.x, enemy.y, 1, '#f00');
            }
            // Oracle Array: apply brief paralysis and schedule a short stacking DoT on direct hits
            if (b.weaponType === WeaponType.ORACLE_ARRAY) {
              try {
                const anyE: any = enemy as any;
                const nowP = performance.now();
                // Brief paralysis on impact (0.35s)
                anyE._paralyzedUntil = Math.max(anyE._paralyzedUntil || 0, nowP + 350);
                // Paralyzing DoT: 3 ticks at 500ms default; stacks additively to per-tick damage and refresh next tick/remaining
                // Base Oracle DoT scaling on the projectile's actual damage (respects per-lane scaling)
                const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
                const perTick = Math.max(1, Math.round(((b.damage || 20) * 0.22) * gdm));
                const od = anyE._oracleDot as { next:number; left:number; dmg:number } | undefined;
                if (!od) {
                  anyE._oracleDot = { next: nowP + 500, left: 3, dmg: perTick };
                } else {
                  // Refresh duration and add to per-tick amount
                  od.left = Math.max(od.left, 3);
                  od.dmg = (od.dmg || 0) + perTick;
                  od.next = nowP + 500;
                }
                (enemy as any)._lastHitByWeapon = WeaponType.ORACLE_ARRAY;
              } catch { /* ignore oracle dot schedule errors */ }
            }

            // Virus: spawn a paralysis/DoT zone at impact point, except for Rogue Hacker (auto-casts zones separately)
            if (b.weaponType === WeaponType.HACKER_VIRUS) {
              const isRogue = (this.player as any)?.characterData?.id === 'rogue_hacker';
              if (!isRogue) {
                try {
                  window.dispatchEvent(new CustomEvent('spawnHackerZone', { detail: { x: enemy.x, y: enemy.y, radius: 120, lifeMs: 2000 } }));
                } catch {}
              }
            }
            // Glyph Compiler: apply a light paralyzing DoT on direct hits (lighter than Oracle)
            if (b.weaponType === WeaponType.GLYPH_COMPILER) {
              try {
                const anyE: any = enemy as any;
                const nowP = performance.now();
                // Very brief paralysis (0.2s) for impact feel
                anyE._paralyzedUntil = Math.max(anyE._paralyzedUntil || 0, nowP + 200);
                // Light DoT: 2 ticks at 500ms; scales with level via scaled damage
                const lvl = (b as any).level || 1;
                const spec: any = (WEAPON_SPECS as any)[WeaponType.GLYPH_COMPILER];
                const scaled = spec?.getLevelStats ? spec.getLevelStats(lvl) : { damage: b.damage };
                const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
                const perTick = Math.max(1, Math.round((scaled.damage || b.damage || 14) * 0.12 * gdm));
                const gdot = anyE._glyphDot as { next:number; left:number; dmg:number } | undefined;
                if (!gdot) {
                  anyE._glyphDot = { next: nowP + 500, left: 2, dmg: perTick };
                } else {
                  gdot.left = Math.max(gdot.left, 2);
                  gdot.dmg = (gdot.dmg || 0) + perTick;
                  gdot.next = nowP + 500;
                }
                (enemy as any)._lastHitByWeapon = WeaponType.GLYPH_COMPILER;
              } catch { /* ignore glyph dot schedule errors */ }
            }

            // Neural Threader: only anchor the directly hit enemy if it currently has a debuff; no auto-append
            if (b.weaponType === WeaponType.NOMAD_NEURAL) {
              try {
                const now = performance.now();
                const anyHit: any = enemy as any;
                // Apply a short primer debuff DoT on direct hit so first hit can seed a debuff state
                this.enemyManager.applyNeuralDebuff(enemy);
                const debuffed = (anyHit._poisonStacks && anyHit._poisonStacks > 0)
                  || (anyHit._burnStacks && anyHit._burnStacks > 0)
                  || ((anyHit._psionicMarkUntil || 0) > now)
                  || ((anyHit._paralyzedUntil || 0) > now)
                  || ((anyHit._armorShredExpire || 0) > now)
                  || ((anyHit._rgbGlitchUntil || 0) > now)
                  || ((anyHit._neuralDebuffUntil || 0) > now);
                if (!debuffed) {
                  // Do not start or extend a thread if the enemy has no debuff
                  // Leave pierce as-is so bullet can find a valid, debuffed target next
                } else {
                  const spec: any = (WEAPON_SPECS as any)[WeaponType.NOMAD_NEURAL];
                  const stats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : { anchors: 2, threadLifeMs: 3000, pulseIntervalMs: 500, pulsePct: 0.6 };
                  const overmindUntil = (window as any).__overmindActiveUntil || 0;
                  const capacityBonus = (overmindUntil > now ? 1 : 0);
                  const maxAnchors = (stats.anchors || 2);
                  // Find nearest existing thread belonging to this player with capacity
                  let nearest: any = null; let bestD2 = Infinity;
                  for (let iT = 0; iT < this.neuralThreads.length; iT++) {
                    const t = this.neuralThreads[iT];
                    if (!t.active) continue;
                    if (t.expireAt <= now) continue;
                    if (t.ownerPlayerId != null && t.ownerPlayerId !== (this.player as any)._instanceId) continue;
                    const cap = t.maxAnchors + capacityBonus;
                    if (t.anchors.length >= cap) continue;
                    const last = t.anchors.length > 0 ? t.anchors[t.anchors.length - 1] : null;
                    const lx = last ? last.x : enemy.x; const ly = last ? last.y : enemy.y;
                    const dxT = enemy.x - lx; const dyT = enemy.y - ly; const d2 = dxT*dxT + dyT*dyT;
                    if (d2 < bestD2) { bestD2 = d2; nearest = t; }
                  }
                  let thread = nearest;
                  if (!thread) {
                    // Create a new thread only when we have a valid debuffed hit to anchor
                    const color = '#26ffe9';
                    const ownerPid = (this.player as any)._instanceId ?? 1;
                    thread = { anchors: [], createdAt: now, expireAt: now + (stats.threadLifeMs || 3000), nextPulseAt: now + (stats.pulseIntervalMs || 500), pulseMs: (stats.pulseIntervalMs || 500), baseDamage: b.damage || 20, pulsePct: (stats.pulsePct || 0.6), maxAnchors: maxAnchors, active: true, color, beadPhase: 0, ownerId: (b as any)._id, ownerPlayerId: ownerPid, weaponType: WeaponType.NOMAD_NEURAL } as any;
                    this.neuralThreads.push(thread);
                  }
                  if (thread.anchors.indexOf(enemy) === -1) {
                    thread.anchors.push(enemy);
                  }
                  // Maintain pierce budget only while we can still add anchors
                  const hasRoom = thread.anchors.length < (thread.maxAnchors + capacityBonus);
                  if (hasRoom) b.pierceRemaining = 999; else b.pierceRemaining = 0;
                }
              } catch { /* ignore */ }
            }
            // Psionic Wave: apply brief psionic mark (slow + bonus damage window) to hit enemy only
            if (b.weaponType === WeaponType.PSIONIC_WAVE) {
              const nowMs = performance.now();
              // Mark direct hit
              const anyE: any = enemy as any;
              anyE._psionicMarkUntil = Math.max(anyE._psionicMarkUntil||0, nowMs + 1400);
            }
            // Psionic Wave ricochet: at L1 gain 1 bounce, +1 per level
            if (b.weaponType === WeaponType.PSIONIC_WAVE && (b as any).bouncesRemaining && (b as any).bouncesRemaining > 0) {
              const searchRadius = 560;
              const candidates = this.queryEnemies(b.x, b.y, searchRadius);
              let best: any = null; let bestD2 = Infinity;
              for (let ci = 0; ci < candidates.length; ci++) {
                const c = candidates[ci];
                if (!c.active || c.hp <= 0) continue;
                const cid = (c as any).id || (c as any)._gid;
                if (b.hitIds && cid && b.hitIds.indexOf(cid) !== -1) continue;
                const dxC = c.x - b.x; const dyC = c.y - b.y; const d2C = dxC*dxC + dyC*dyC;
                if (d2C < bestD2) { best = c; bestD2 = d2C; }
              }
              if (best) {
                const curSpeed = Math.hypot(b.vx, b.vy) || ((WEAPON_SPECS as any)[WeaponType.PSIONIC_WAVE]?.speed || 9.1);
                const dxN = best.x - b.x; const dyN = best.y - b.y; const distN = Math.hypot(dxN, dyN) || 1;
                b.vx = dxN / distN * curSpeed;
                b.vy = dyN / distN * curSpeed;
                (b as any).bouncesRemaining -= 1;
                intersectionPoint = null;
                continue;
              }
            }
            // Neural Nexus: evolved mesh — always anchor on hit and autosnap nearby primed enemies
            if (b.weaponType === WeaponType.NEURAL_NEXUS) {
              try {
                const now = performance.now();
                const spec: any = (WEAPON_SPECS as any)[WeaponType.NEURAL_NEXUS];
                const stats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : { anchors: 10, threadLifeMs: 5200, pulseIntervalMs: 380, pulsePct: 1.2, detonateFrac: 3.0 } as any;
                const maxAnchors = stats.anchors || 10;
                // Find nearest existing Nexus thread for this player with capacity
                let nearest: any = null; let bestD2 = Infinity;
                for (let iT = 0; iT < this.neuralThreads.length; iT++) {
                  const t = this.neuralThreads[iT];
                  if (!t.active) continue;
                  if (t.expireAt <= now) continue;
                  if (t.weaponType !== WeaponType.NEURAL_NEXUS) continue;
                  if (t.ownerPlayerId != null && t.ownerPlayerId !== (this.player as any)._instanceId) continue;
                  if (t.anchors.length >= t.maxAnchors) continue;
                  const last = t.anchors.length > 0 ? t.anchors[t.anchors.length - 1] : null;
                  const lx = last ? last.x : enemy.x; const ly = last ? last.y : enemy.y;
                  const dxT = enemy.x - lx; const dyT = enemy.y - ly; const d2 = dxT*dxT + dyT*dyT;
                  if (d2 < bestD2) { bestD2 = d2; nearest = t; }
                }
                let thread = nearest;
                if (!thread) {
                  const color = '#9ffcf6';
                  const ownerPid = (this.player as any)._instanceId ?? 1;
                  thread = { anchors: [], createdAt: now, expireAt: now + (stats.threadLifeMs || 5200), nextPulseAt: now + (stats.pulseIntervalMs || 380), pulseMs: (stats.pulseIntervalMs || 380), baseDamage: b.damage || 24, pulsePct: (stats.pulsePct || 1.2), maxAnchors: maxAnchors, active: true, color, beadPhase: 0, ownerId: (b as any)._id, ownerPlayerId: ownerPid, weaponType: WeaponType.NEURAL_NEXUS, detonateFrac: (stats.detonateFrac || 3.0) } as any;
                  this.neuralThreads.push(thread);
                }
                if (thread.anchors.indexOf(enemy) === -1) thread.anchors.push(enemy);
                // Autosnap primed neighbors near the hit (up to capacity), 1-2 per hit
                const sx = enemy.x, sy = enemy.y;
                const radius = 260;
                const candidates = this.queryEnemies(sx, sy, radius);
                let addedCount = 0;
                for (let ci = 0; ci < candidates.length && thread.anchors.length < thread.maxAnchors; ci++) {
                  const e = candidates[ci] as any; if (!e.active || e.hp <= 0) continue;
                  if (thread.anchors.indexOf(e) !== -1) continue;
                  const primed = (e._poisonStacks && e._poisonStacks > 0)
                    || (e._burnStacks && e._burnStacks > 0)
                    || ((e._psionicMarkUntil || 0) > now)
                    || ((e._paralyzedUntil || 0) > now)
                    || ((e._armorShredExpire || 0) > now)
                    || ((e._rgbGlitchUntil || 0) > now)
                    || ((e._neuralDebuffUntil || 0) > now);
                  if (!primed) continue;
                  thread.anchors.push(e);
                  addedCount++;
                  if (addedCount >= 2) break;
                }
                // Maintain pierce while capacity remains
                b.pierceRemaining = (thread.anchors.length < thread.maxAnchors) ? 999 : 0;
              } catch { /* ignore */ }
            }
            // Plasma detonation on first impact (no piercing). Determine over/charged multipliers here.
      if (b.weaponType === WeaponType.PLASMA) {
              const spec: any = (WEAPON_SPECS as any)[WeaponType.PLASMA];
              const p:any = this.player;
              const over = (p?.plasmaHeat||0) >= (spec?.overheatThreshold||0.85);
              const chargeT = (b as any).chargeT || 0;
              let dmgBase = b.damage;
              if (chargeT >= 1) dmgBase *= (spec?.chargedMultiplier||1.8);
              if (over) dmgBase *= (spec?.overchargedMultiplier||2.2);
        // Determine explosion radius by level (fallback to spec/base)
        const lvl = (b as any).level || 1;
        const scaled = spec?.getLevelStats ? spec.getLevelStats(lvl) : undefined;
        const baseRadius = (b as any).explosionRadius ?? (scaled?.explosionRadius) ?? spec?.explosionRadius ?? 120;
              if (over) {
                p.plasmaHeat = Math.max(0, p.plasmaHeat * 0.6); // cooldown after overcharged
    window.dispatchEvent(new CustomEvent('plasmaIonField', { detail: { x: b.x, y: b.y, damage: dmgBase, radius: baseRadius } }));
              } else {
        // Preserve explicit 0 fragments (no fallback)
        const frags = (spec && Object.prototype.hasOwnProperty.call(spec,'fragmentCount')) ? (spec.fragmentCount||0) : 3;
  window.dispatchEvent(new CustomEvent('plasmaDetonation', { detail: { x: b.x, y: b.y, damage: dmgBase, fragments: frags, radius: baseRadius } }));
              }
              b.active = false; this.bulletPool.push(b); break; // consume plasma core
            }
            // Piercing: Smart Rifle (RAPID) intentionally NEVER pierces; always expire on first hit
            if (b.weaponType === WeaponType.RAPID) {
              b.pierceRemaining = 0; // safety
              b.active = false;
              this.bulletPool.push(b);
              break;
            }
            if (b.weaponType === WeaponType.RICOCHET && (b as any).bouncesRemaining && (b as any).bouncesRemaining > 0) {
              // Attempt to find a new target different from already hit enemies
              const searchRadius = 520; // generous search radius
              const candidates = this.queryEnemies(b.x, b.y, searchRadius);
              let best: any = null; let bestD2 = Infinity;
              for (let ci = 0; ci < candidates.length; ci++) {
                const c = candidates[ci];
                if (!c.active || c.hp <= 0) continue;
                const cid = (c as any).id || (c as any)._gid;
                if (b.hitIds && cid && b.hitIds.indexOf(cid) !== -1) continue; // already hit
                const dxC = c.x - b.x; const dyC = c.y - b.y; const d2C = dxC*dxC + dyC*dyC;
                if (d2C < bestD2) { best = c; bestD2 = d2C; }
              }
              if (best) {
                // Redirect velocity toward new target; preserve speed magnitude
                const curSpeed = Math.hypot(b.vx, b.vy) || ((WEAPON_SPECS as any)[WeaponType.RICOCHET]?.speed || 7);
                const dxN = best.x - b.x; const dyN = best.y - b.y; const distN = Math.hypot(dxN, dyN) || 1;
                b.vx = dxN / distN * curSpeed;
                b.vy = dyN / distN * curSpeed;
                (b as any).bouncesRemaining -= 1;
                intersectionPoint = null; // allow subsequent collision detection
                continue; // keep bullet alive for next enemy
              }
              // If no candidate found, fall through to normal expire
            }
            // Serpent Chain evolved ricochet: bounce toward new target, ramp damage, and create finisher burst at chain end
            if (b.weaponType === WeaponType.SERPENT_CHAIN && (b as any).bouncesRemaining && (b as any).bouncesRemaining > 0) {
              const searchRadius = 560;
              const candidates = this.queryEnemies(b.x, b.y, searchRadius);
              let best: any = null; let bestD2 = Infinity;
              for (let ci = 0; ci < candidates.length; ci++) {
                const c = candidates[ci];
                if (!c.active || c.hp <= 0) continue;
                const cid = (c as any).id || (c as any)._gid;
                if (b.hitIds && cid && b.hitIds.indexOf(cid) !== -1) continue;
                const dxC = c.x - b.x; const dyC = c.y - b.y; const d2C = dxC*dxC + dyC*dyC;
                if (d2C < bestD2) { best = c; bestD2 = d2C; }
              }
              if (best) {
                const curSpeed = Math.hypot(b.vx, b.vy) || ((WEAPON_SPECS as any)[WeaponType.SERPENT_CHAIN]?.speed || 8.2);
                const dxN = best.x - b.x; const dyN = best.y - b.y; const distN = Math.hypot(dxN, dyN) || 1;
                b.vx = dxN / distN * curSpeed;
                b.vy = dyN / distN * curSpeed;
                (b as any).bouncesRemaining -= 1;
                // Ramp damage per bounce
                try {
                  const base = (b as any)._serpBaseDamage || b.damage; const ramp = Math.max(0, (b as any)._serpRamp || 0);
                  (b as any)._serpHits = ((b as any)._serpHits|0) + 1;
                  const mul = 1 + ramp * ((b as any)._serpHits);
                  b.damage = Math.max(1, Math.round(base * mul));
                } catch { /* ignore */ }
                intersectionPoint = null;
                continue;
              }
            }
            if (b.pierceRemaining && b.pierceRemaining > 0) {
              // Fortress stance: within close radius around the player, do not consume pierce (no collision limit)
              let skippedPierce = false;
              try {
                const pAny: any = this.player as any;
                if (pAny && pAny.characterData?.id === 'titan_mech' && pAny.fortressActive) {
                  const closeR = 220; // close-range bubble
                  const dxP = b.x - pAny.x; const dyP = b.y - pAny.y;
                  if (dxP*dxP + dyP*dyP <= closeR*closeR) {
                    skippedPierce = true;
                  }
                }
              } catch { /* ignore */ }
              if (!skippedPierce) {
                b.pierceRemaining -= 1;
              }
              // Spear realism: lose some speed when piercing a target
              if (b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR) {
                const cur = Math.hypot(b.vx, b.vy) || 0.0001;
                const slow = 0.88; // retain 88% speed after each pierce
                b.vx = b.vx / cur * (cur * slow);
                b.vy = b.vy / cur * (cur * slow);
              }
              intersectionPoint = null;
              continue;
            } else {
              // If Serpent Chain has ended its bounce chain, create a soft coiling burst at the last target
              if (b.weaponType === WeaponType.SERPENT_CHAIN && !(b as any)._serpDidFinisher) {
                try {
                  const base = (b as any)._serpBaseDamage || b.damage;
                  const frac = (b as any)._serpFinisher != null ? (b as any)._serpFinisher : 1.20;
                  const burstDmg = Math.max(1, Math.round(base * frac));
                  const radius = 120; // modest AoE; visual-only shockwave handles application via ExplosionManager
                  window.dispatchEvent(new CustomEvent('serpentBurst', { detail: { x: b.x, y: b.y, damage: burstDmg, radius } }));
                  (b as any)._serpDidFinisher = true;
                } catch { /* ignore */ }
              }
              // On final hit (no pierce left), allow BIO_TOXIN to spawn a poison puddle at impact
        if (b.weaponType === WeaponType.BIO_TOXIN || b.weaponType === WeaponType.LIVING_SLUDGE) {
                try {
                  const lvl = (b as any).level || 1;
                  const baseR = 28, baseMs = 2600;
                  // Prefer precomputed puddle params, else derive now
                  let radius: number = (b as any).puddleRadius;
                  let lifeMs: number = (b as any).puddleLifeMs;
                  if (radius == null) {
                    radius = baseR + (lvl - 1) * 3;
                    // Apply global area multiplier if available
                    try {
                      const mul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
                      radius *= (mul || 1);
                    } catch { /* ignore */ }
                  }
                  if (lifeMs == null) {
                    lifeMs = baseMs + (lvl - 1) * 200;
                  }
          const isSludge = (b.weaponType === WeaponType.LIVING_SLUDGE);
          const potency = isSludge ? Math.max(0, Math.round((lvl - 1) * 0.6)) : 0;
          this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs, isSludge ? { isSludge: true, potency } : undefined);
                } catch {}
              }
              // Plant Data Sigil on impact
              if (b.weaponType === WeaponType.DATA_SIGIL) {
                try {
                  const lvl = (b as any).level || 1;
                  const spec: any = (WEAPON_SPECS as any)[WeaponType.DATA_SIGIL];
                  const stats = spec?.getLevelStats ? spec.getLevelStats(lvl) : {};
                  window.dispatchEvent(new CustomEvent('plantDataSigil', { detail: { x: b.x, y: b.y, level: lvl, radius: stats?.sigilRadius || 120, pulseCount: stats?.pulseCount || 3, pulseDamage: stats?.pulseDamage || 90 } }));
                  // Golden sparks on creation
                  try { this.particleManager?.spawn(b.x, b.y, 10, '#FFD700', { sizeMin: 1, sizeMax: 3, lifeMs: 420, speedMin: 1.2, speedMax: 3.0 }); } catch {}
                } catch {}
              }
              b.active = false;
              if (b.weaponType !== WeaponType.MECH_MORTAR) {
                this.bulletPool.push(b);
              }
              break;
            }
          }
        }
      }

      // After enemy loop: for Mech Mortar / Siege Howitzer, attempt swept collision with boss and treasures even if no enemies were near
      if (!intersectionPoint && (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER)) {
        // Boss swept collision
        try {
          const bm: any = (window as any).__bossManager;
          const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const effR = (boss.radius || 160) + Math.max(2, b.radius || 6);
            // Primary: swept test across the segment this frame
            const pt = this.lineCircleIntersect(prevX, prevY, b.x, b.y, boss.x, boss.y, effR);
            if (pt) { intersectionPoint = pt; hitBoss = true; }
            else {
              // Fallback: if the projectile starts/ends entirely inside the radius, register an immediate overlap hit
              const dxB = b.x - boss.x; const dyB = b.y - boss.y;
              if ((dxB * dxB + dyB * dyB) <= effR * effR) { intersectionPoint = { x: b.x, y: b.y }; hitBoss = true; }
            }
          }
        } catch { /* ignore boss check errors */ }
        // Treasure swept collision
        if (!intersectionPoint) {
          try {
            const emAny: any = this.enemyManager as any;
            if (typeof emAny.getTreasures === 'function') {
              const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
              for (let ti = 0; ti < treasures.length; ti++) {
                const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                const effR = (t.radius || 18) + Math.max(2, b.radius || 6);
                // Primary: swept test across the segment this frame
                const pt = this.lineCircleIntersect(prevX, prevY, b.x, b.y, t.x, t.y, effR);
                if (pt) { intersectionPoint = pt; hitTreasure = true; break; }
                // Fallback: direct overlap inside radius
                const dxT = b.x - t.x; const dyT = b.y - t.y;
                if ((dxT * dxT + dyT * dyT) <= effR * effR) { intersectionPoint = { x: b.x, y: b.y }; hitTreasure = true; break; }
              }
            }
          } catch { /* ignore treasure check errors */ }
        }
      }
      // Boss collision parity for PSIONIC_WAVE: swept segment vs boss circle, apply mark and damage
      if (b.weaponType === WeaponType.PSIONIC_WAVE && (!hitEnemy)) {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const thickness = Math.max(8, (((b.projectileVisual as any)?.thickness) || 12));
          const effR = (boss.radius || 160) + thickness * 0.5;
          const pt = this.lineCircleIntersect(prevX, prevY, b.x, b.y, boss.x, boss.y, effR);
          if (pt) {
            // Prevent repeated hits on boss by reusing hitIds with a special key
            const bossKey = 'boss';
            if (b.hitIds && b.hitIds.indexOf(bossKey) !== -1) {
              // Already hit boss with this projectile; skip
            } else {
              if (b.hitIds) b.hitIds.push(bossKey);
            const p: any = this.player;
            let critChance = 0.15;
            if (p) {
              const agi = p.agility || 0; const luck = p.luck || 0;
              const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
              const bonus = p.critBonus ? p.critBonus * 100 : 0;
              critChance = Math.min(100, basePct + bonus) / 100;
            }
            const critMult = p?.critMultiplier ?? 2.0;
            const isCritical = Math.random() < critChance;
            let damage = isCritical ? b.damage * critMult : b.damage;
            if (b.weaponType === WeaponType.PSIONIC_WAVE) {
              const bAny: any = boss as any;
              const nowS = performance.now();
              let stacks = Math.min(6, ((bAny._resonanceStacks | 0) + 1));
              bAny._resonanceStacks = stacks;
              bAny._resonanceExpire = nowS + 4000;
              damage *= (1 + Math.min(6, stacks) * 0.10);
              if (stacks >= 6) {
                bAny._paralyzedUntil = Math.max(bAny._paralyzedUntil || 0, nowS + 250);
                bAny._resonanceStacks = 0;
              }
            }
            if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
              (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.weaponType, b.x, b.y, (b as any).level ?? 1);
            } else {
              boss.hp -= damage;
              window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage, crit: isCritical, x: b.x, y: b.y } }));
            }
            // Tech Warrior charged volley lifesteal on boss hits as well
            try {
              if ((b as any)._isVolley) {
                const frac = (b as any)._lifestealFrac || 0;
                if (frac > 0 && damage > 0) {
                  const p: any = this.player;
                  const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
                  const eff = getHealEfficiency(timeSec);
                  const heal = damage * frac * eff;
                  p.hp = Math.min(p.maxHp || p.hp, p.hp + heal);
                }
              }
            } catch { /* ignore */ }
            // Apply psionic mark to boss (slow + bonus window)
            const bAny: any = boss as any;
            const nowMs = performance.now();
            bAny._psionicMarkUntil = Math.max(bAny._psionicMarkUntil || 0, nowMs + 1400);
              // Consume a bounce if available, mirroring enemy handling
              if ((b as any).bouncesRemaining && (b as any).bouncesRemaining > 0) {
                (b as any).bouncesRemaining -= 1;
              }
            }
          }
        }
      }

      // Boss swept-collision parity for Tachyon/Singularity Spear during travel
      if ((b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR) && b.active && (!hitEnemy)) {
        try {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && (bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : (bossMgr.getBoss ? bossMgr.getBoss() : null));
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const effR = (boss.radius || 160) + Math.max(2, b.radius || 6);
            const pt = this.lineCircleIntersect(prevX, prevY, b.x, b.y, boss.x, boss.y, effR);
            if (pt) {
              // Prevent repeated boss hits per projectile
              const bossKey = 'boss';
              if (!b.hitIds || b.hitIds.indexOf(bossKey) === -1) {
                if (b.hitIds) b.hitIds.push(bossKey);
                const weaponLevel = (b as any).level ?? 1;
                const p: any = this.player;
                let critChance = 0.15;
                if (p) {
                  const agi = p.agility || 0; const luck = p.luck || 0;
                  const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
                  const bonus = p.critBonus ? p.critBonus * 100 : 0;
                  critChance = Math.min(100, basePct + bonus) / 100;
                }
                const critMult = p?.critMultiplier ?? 2.0;
                const isCritical = Math.random() < critChance;
                const damage = isCritical ? b.damage * critMult : b.damage;
                if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                  (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.weaponType, b.x, b.y, weaponLevel);
                } else {
                  boss.hp -= damage;
                  window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage, crit: isCritical, x: b.x, y: b.y } }));
                }
                // Consume pierce and slow spear like on enemy hits
                if (b.pierceRemaining && b.pierceRemaining > 0) {
                  b.pierceRemaining -= 1;
                  const cur = Math.hypot(b.vx, b.vy) || 0.0001;
                  const slow = 0.88;
                  b.vx = b.vx / cur * (cur * slow);
                  b.vy = b.vy / cur * (cur * slow);
                } else {
                  b.active = false;
                  this.bulletPool.push(b);
                }
              }
            }
          }
        } catch { /* ignore boss spear checks */ }
      }

  // NOMAD_NEURAL / NEURAL_NEXUS: boss direct hit should deal damage and enable threads to anchor to boss
  if ((b.weaponType === WeaponType.NOMAD_NEURAL || b.weaponType === WeaponType.NEURAL_NEXUS) && b.active && (!hitEnemy)) {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const dxB = boss.x - b.x; const dyB = boss.y - b.y; const rsB = (boss.radius || 160) + Math.max(2, b.radius * 0.75);
          if (dxB*dxB + dyB*dyB <= rsB*rsB) {
            // Prevent repeated hits with same projectile
            const bossKey = 'boss';
            if (!b.hitIds || b.hitIds.indexOf(bossKey) === -1) {
              if (b.hitIds) b.hitIds.push(bossKey);
              const weaponLevel = (b as any).level ?? 1;
              const p: any = this.player;
              let critChance = 0.15;
              if (p) {
                const agi = p.agility || 0; const luck = p.luck || 0;
                const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
                const bonus = p.critBonus ? p.critBonus * 100 : 0;
                critChance = Math.min(100, basePct + bonus) / 100;
              }
              const critMult = p?.critMultiplier ?? 2.0;
              const isCritical = Math.random() < critChance;
              const damage = isCritical ? b.damage * critMult : b.damage;
              if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.weaponType, b.x, b.y, weaponLevel);
              } else {
                boss.hp -= damage;
                window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage, crit: isCritical, x: b.x, y: b.y } }));
              }
              // Apply primer debuff so threads can latch and add boss as an anchor if a thread exists and has room
              try { (this.enemyManager as any).applyBossNeuralDebuff?.(boss); } catch {}
              try {
                const now = performance.now();
                const isNexus = b.weaponType === WeaponType.NEURAL_NEXUS;
                const specBase: any = (WEAPON_SPECS as any)[isNexus ? WeaponType.NEURAL_NEXUS : WeaponType.NOMAD_NEURAL];
                const stats = specBase?.getLevelStats ? specBase.getLevelStats(weaponLevel) : { anchors: (isNexus?10:2) } as any;
                const overmindUntil = (window as any).__overmindActiveUntil || 0;
                let nearest: any = null; let bestD2 = Infinity;
                for (let iT = 0; iT < this.neuralThreads.length; iT++) {
                  const t = this.neuralThreads[iT];
                  if (!t.active) continue;
                  if (t.expireAt <= now) continue;
                  if (t.ownerPlayerId != null && t.ownerPlayerId !== (this.player as any)._instanceId) continue;
                  if ((t.weaponType || WeaponType.NOMAD_NEURAL) !== (isNexus ? WeaponType.NEURAL_NEXUS : WeaponType.NOMAD_NEURAL)) continue;
                  const cap = t.maxAnchors + (!isNexus && overmindUntil > now ? 1 : 0);
                  if (t.anchors.length >= cap) continue;
                  const last = t.anchors.length > 0 ? t.anchors[t.anchors.length - 1] : null;
                  const lx = last ? last.x : boss.x; const ly = last ? last.y : boss.y;
                  const dxT = boss.x - lx; const dyT = boss.y - ly; const d2 = dxT*dxT + dyT*dyT;
                  if (d2 < bestD2) { bestD2 = d2; nearest = t; }
                }
                if (nearest) {
                  if (nearest.anchors.indexOf(boss) === -1) nearest.anchors.push(boss as any);
                } else {
                  // Create a new thread starting at the boss
                  const color = isNexus ? '#9ffcf6' : '#26ffe9';
                  const ownerPid = (this.player as any)._instanceId ?? 1;
                  const baseDamage = b.damage || 20;
                  const pulsePct = (stats?.pulsePct != null ? stats.pulsePct : (isNexus?1.2:0.6));
                  const pulseMs = (stats?.pulseIntervalMs != null ? stats.pulseIntervalMs : (isNexus?380:500));
                  const threadLifeMs = (stats?.threadLifeMs != null ? stats.threadLifeMs : (isNexus?5200:3000));
                  const maxAnchors = (stats?.anchors != null ? stats.anchors : (isNexus?10:2));
                  const t = { anchors: [boss as any], createdAt: now, expireAt: now + threadLifeMs, nextPulseAt: now + pulseMs, pulseMs, baseDamage, pulsePct, maxAnchors, active: true, color, beadPhase: 0, ownerId: (b as any)._id, ownerPlayerId: ownerPid, weaponType: (isNexus?WeaponType.NEURAL_NEXUS:WeaponType.NOMAD_NEURAL), detonateFrac: stats?.detonateFrac } as any;
                  this.neuralThreads.push(t);
                }
              } catch {}
              // Consume one pierce if present; otherwise expire
              if (typeof b.pierceRemaining === 'number' && b.pierceRemaining > 0) {
                b.pierceRemaining = b.pierceRemaining - 1;
                if (b.pierceRemaining <= 0) { b.active = false; this.bulletPool.push(b); }
              } else {
                b.active = false; this.bulletPool.push(b);
              }
            }
          }
        }
      }

      // ORACLE_ARRAY: boss direct hit parity — apply damage, brief paralysis, and schedule Oracle DoT
      if (b.weaponType === WeaponType.ORACLE_ARRAY && b.active && (!hitEnemy)) {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const dxB = boss.x - b.x; const dyB = boss.y - b.y; const rsB = (boss.radius || 160) + Math.max(2, b.radius * 0.75);
          if (dxB*dxB + dyB*dyB <= rsB*rsB) {
            const bossKey = 'boss';
            if (!b.hitIds || b.hitIds.indexOf(bossKey) === -1) {
              if (b.hitIds) b.hitIds.push(bossKey);
              const weaponLevel = (b as any).level ?? 1;
              const p: any = this.player;
              let critChance = 0.15;
              if (p) {
                const agi = p.agility || 0; const luck = p.luck || 0;
                const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
                const bonus = p.critBonus ? p.critBonus * 100 : 0;
                critChance = Math.min(100, basePct + bonus) / 100;
              }
              const critMult = p?.critMultiplier ?? 2.0;
              const isCritical = Math.random() < critChance;
              const damage = isCritical ? b.damage * critMult : b.damage;
              if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.weaponType, b.x, b.y, weaponLevel);
              } else {
                boss.hp -= damage;
                window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage, crit: isCritical, x: b.x, y: b.y } }));
              }
              // Apply brief paralysis and schedule Oracle DoT on boss
              try {
                const bAny: any = boss as any;
                const nowP = performance.now();
                bAny._paralyzedUntil = Math.max(bAny._paralyzedUntil || 0, nowP + 300);
                const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
                const perTick = Math.max(1, Math.round(((b.damage || 20) * 0.22) * gdm));
                const odB = bAny._oracleDot as { next: number; left: number; dmg: number } | undefined;
                if (!odB) {
                  bAny._oracleDot = { next: nowP + 500, left: 3, dmg: perTick };
                } else {
                  odB.left = Math.max(odB.left, 3);
                  odB.dmg = (odB.dmg || 0) + perTick;
                  odB.next = nowP + 500;
                }
                bAny._lastHitByWeapon = WeaponType.ORACLE_ARRAY;
              } catch { /* ignore boss oracle dot errors */ }
              // Consume pierce or expire
              if (typeof b.pierceRemaining === 'number' && b.pierceRemaining > 0) {
                b.pierceRemaining = b.pierceRemaining - 1;
                if (b.pierceRemaining <= 0) { b.active = false; this.bulletPool.push(b); }
              } else { b.active = false; this.bulletPool.push(b); }
            }
          }
        }
      }

      // GLYPH_COMPILER: boss direct hit parity — brief paralysis and light DoT
      if (b.weaponType === WeaponType.GLYPH_COMPILER && b.active && (!hitEnemy)) {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const dxB = boss.x - b.x; const dyB = boss.y - b.y; const rsB = (boss.radius || 160) + Math.max(2, b.radius * 0.75);
          if (dxB*dxB + dyB*dyB <= rsB*rsB) {
            const bossKey = 'boss';
            if (!b.hitIds || b.hitIds.indexOf(bossKey) === -1) {
              if (b.hitIds) b.hitIds.push(bossKey);
              const weaponLevel = (b as any).level ?? 1;
              const p: any = this.player;
              let critChance = 0.15;
              if (p) {
                const agi = p.agility || 0; const luck = p.luck || 0;
                const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
                const bonus = p.critBonus ? p.critBonus * 100 : 0;
                critChance = Math.min(100, basePct + bonus) / 100;
              }
              const critMult = p?.critMultiplier ?? 2.0;
              const isCritical = Math.random() < critChance;
              const damage = isCritical ? b.damage * critMult : b.damage;
              if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.weaponType, b.x, b.y, weaponLevel);
              } else {
                boss.hp -= damage;
                window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage, crit: isCritical, x: b.x, y: b.y } }));
              }
              // Schedule light glyph DoT and brief paralysis on boss
              try {
                const bAny: any = boss as any; const nowP = performance.now();
                bAny._paralyzedUntil = Math.max(bAny._paralyzedUntil || 0, nowP + 160);
                const lvl = (b as any).level || 1;
                const spec: any = (WEAPON_SPECS as any)[WeaponType.GLYPH_COMPILER];
                const scaled = spec?.getLevelStats ? spec.getLevelStats(lvl) : { damage: b.damage };
                const gdm = (this.player as any)?.getGlobalDamageMultiplier?.() ?? ((this.player as any)?.globalDamageMultiplier ?? 1);
                const perTick = Math.max(1, Math.round((scaled.damage || b.damage || 14) * 0.12 * gdm));
                const gdotB = bAny._glyphDot as { next: number; left: number; dmg: number } | undefined;
                if (!gdotB) bAny._glyphDot = { next: nowP + 500, left: 2, dmg: perTick };
                else { gdotB.left = Math.max(gdotB.left, 2); gdotB.dmg = (gdotB.dmg || 0) + perTick; gdotB.next = nowP + 500; }
                bAny._lastHitByWeapon = WeaponType.GLYPH_COMPILER;
              } catch {}
              // Consume pierce or expire
              if (typeof b.pierceRemaining === 'number' && b.pierceRemaining > 0) {
                b.pierceRemaining = b.pierceRemaining - 1;
                if (b.pierceRemaining <= 0) { b.active = false; this.bulletPool.push(b); }
              } else { b.active = false; this.bulletPool.push(b); }
            }
          }
        }
      }

      // Separate boss collision check for Smart Rifle (boss not in enemy spatial grid)
      if (b.weaponType === WeaponType.RAPID && b.active && (!hitEnemy)) {
        if (b.targetId === 'boss') {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const dxB = b.x - boss.x;
            const dyB = b.y - boss.y;
            const rsB = (b.radius || 4) + (boss.radius || 160);
            if (dxB*dxB + dyB*dyB < rsB*rsB) {
              const weaponLevel = (b as any).level ?? 1;
              const p: any = this.player;
              let critChance = 0.15;
              if (p) {
                const agi = p.agility || 0;
                const luck = p.luck || 0;
                const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
                const bonus = p.critBonus ? p.critBonus * 100 : 0;
                critChance = Math.min(100, basePct + bonus) / 100;
              }
              const critMult = p?.critMultiplier ?? 2.0;
              const isCritical = Math.random() < critChance;
              const damage = isCritical ? b.damage * critMult : b.damage;
              // Special-case BIO_TOXIN/LIVING_SLUDGE: spawn a poison puddle on boss impact instead of normal damage handling
              const wt: any = (b as any).weaponType;
              if (wt === WeaponType.BIO_TOXIN || wt === WeaponType.LIVING_SLUDGE) {
                try {
                  const lvl = (b as any).level || 1;
                  const baseR = 28, baseMs = 2600;
                  // Prefer precomputed puddle params, else derive now (mirror other BIO_TOXIN paths)
                  let radius: number = (b as any).puddleRadius;
                  let lifeMs: number = (b as any).puddleLifeMs;
                  if (radius == null) {
                    radius = baseR + (lvl - 1) * 3;
                    try {
                      const mul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
                      radius *= (mul || 1);
                    } catch { /* ignore */ }
                  }
                  if (lifeMs == null) {
                    lifeMs = baseMs + (lvl - 1) * 200;
                  }
                  const isSludge = (wt === WeaponType.LIVING_SLUDGE);
                  const potency = isSludge ? Math.max(0, Math.round((lvl - 1) * 0.6)) : 0;
                  this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs, isSludge ? { isSludge: true, potency } : undefined);
                  // Trigger built-in boss damage pathway with a tiny proc to register a hit and apply poison via EnemyManager
                  try { (this.enemyManager as any).takeBossDamage?.(boss, 1, false, WeaponType.BIO_TOXIN, b.x, b.y, lvl); } catch { /* ignore */ }
                  if (this.particleManager) this.particleManager.spawn(boss.x, b.y, 1, '#66FF6A');
                } catch { /* ignore puddle spawn failures */ }
                b.active = false;
                this.bulletPool.push(b);
                continue; // handled
              } else {
                // Reuse enemyManager damage pathway if compatible, else dispatch custom event
                if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                  (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.weaponType, b.x, b.y, weaponLevel);
                } else {
                  boss.hp -= damage;
                  window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage, crit: isCritical, x: b.x, y: b.y } }));
                }
                if (this.particleManager) this.particleManager.spawn(boss.x, boss.y, 1, '#ff8080');
                b.active = false;
                this.bulletPool.push(b);
                continue; // proceed next bullet
              }
            }
          }
        }
      }

  // BIO_TOXIN / LIVING_SLUDGE: if bullet intersects the boss, drop a puddle at impact, register a tiny hit to seed poison, and deactivate
    if ((b.weaponType === WeaponType.BIO_TOXIN || b.weaponType === WeaponType.LIVING_SLUDGE) && b.active) {
      try {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && (bossMgr.getActiveBoss ? bossMgr.getActiveBoss() : bossMgr.getBoss ? bossMgr.getBoss() : null);
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const dxB = b.x - boss.x;
          const dyB = b.y - boss.y;
          const rsB = (boss.radius || 160) + (b.radius || 4);
          if (dxB*dxB + dyB*dyB <= rsB*rsB) {
            // Spawn puddle using precomputed params if available
            const lvl = (b as any).level || 1;
            const baseR = 28, baseMs = 2600;
            let radius: number = (b as any).puddleRadius;
            let lifeMs: number = (b as any).puddleLifeMs;
            if (radius == null) {
              radius = baseR + (lvl - 1) * 3;
              try {
                const mul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
                radius *= (mul || 1);
              } catch { /* ignore */ }
            }
            if (lifeMs == null) {
              lifeMs = baseMs + (lvl - 1) * 200;
            }
            const isSludge = (b.weaponType === WeaponType.LIVING_SLUDGE);
            const potency = isSludge ? Math.max(0, Math.round((lvl - 1) * 0.6)) : 0;
            this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs, isSludge ? { isSludge: true, potency } : undefined);
            // Register a tiny boss hit to trigger EnemyManager's BIO_TOXIN hook (applies poison stacks)
            try { (this.enemyManager as any).takeBossDamage?.(boss, 1, false, WeaponType.BIO_TOXIN, b.x, b.y, lvl); } catch { /* ignore */ }
            // Deactivate bullet after impact
            b.active = false;
            this.bulletPool.push(b);
            continue;
          }
        }
      } catch { /* ignore boss check */ }
    }

    // If Mech Mortar and collision detected with enemy/boss/treasure OR life expires, trigger explosion sequence (with optional implosion) and deactivate projectile
  if ((b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) && (hitEnemy || hitBoss || hitTreasure || (b.lifeMs !== undefined && b.lifeMs <= 0))) {
        b.active = false; // Immediately deactivate projectile
        b.vx = 0; // Stop movement
        b.vy = 0; // Stop movement

        // Explosion state: keep explosion timing independent from bullet lifecycle
        (b as any)._exploded = true;
        (b as any)._explosionStartTime = performance.now();
        (b as any)._maxExplosionDuration = 1000;
  b.lifeMs = 0;

        // Determine explosion point
        const explosionX = intersectionPoint ? intersectionPoint.x : b.x;
        const explosionY = intersectionPoint ? intersectionPoint.y : b.y;

        // Explosion radius: prefer spec.explosionRadius if present
        let exRadius = b.explosionRadius;
        if (exRadius == null) {
          try {
            const spec = (WEAPON_SPECS as any)[b.weaponType === WeaponType.SIEGE_HOWITZER ? WeaponType.SIEGE_HOWITZER : WeaponType.MECH_MORTAR];
            if (spec?.explosionRadius) exRadius = spec.explosionRadius; 
          } catch { /* ignore */ }
        }
        if (exRadius == null) exRadius = 200;
  // Optional brief implosion visual before main explosion: dispatch a pre-explosion event (purely visual)
  window.dispatchEvent(new CustomEvent('mortarImplosion', { detail: { x: explosionX, y: explosionY, radius: exRadius * 0.55, color: (b.weaponType === WeaponType.SIEGE_HOWITZER ? '#B22222' : '#FFE66D'), delay: 90 } }));
  // In headless tests, performance.now is frozen to __headlessNowMs, and there is no Game loop.
  // Proactively apply the explosion damage immediately to ensure boss/treasure hits are registered.
  try {
    const isHeadless = typeof (window as any).__headlessNowMs === 'number';
    if (isHeadless) {
      (this.player as any)?.gameContext?.explosionManager?.triggerTitanMortarExplosion?.(
        explosionX,
        explosionY,
        b.damage,
        exRadius,
        (b.weaponType === WeaponType.SIEGE_HOWITZER ? '#B22222' : '#FFE66D')
      );
    }
  } catch { /* ignore headless direct explosion errors */ }
  // Main explosion (damage and particles handled by Game.ts) with radius
  window.dispatchEvent(new CustomEvent('mortarExplosion', { detail: { x: explosionX, y: explosionY, damage: b.damage, hitEnemy: (hitEnemy || hitBoss || hitTreasure), radius: exRadius, delay: 90 } }));
        this.bulletPool.push(b); // Return to pool
        continue; // Skip adding to activeBullets for this frame, as it's now inactive and exploded
      }

  // For BIO_TOXIN, spawn a poison puddle on expiry (ms-based)
    if ((b.weaponType === WeaponType.BIO_TOXIN || b.weaponType === WeaponType.LIVING_SLUDGE) && b.lifeMs !== undefined && b.lifeMs <= 0) {
        try {
          const lvl = (b as any).level || 1;
          const baseR = 28, baseMs = 2600;
          let radius: number = (b as any).puddleRadius;
          let lifeMs: number = (b as any).puddleLifeMs;
          if (radius == null) {
            radius = baseR + (lvl - 1) * 3;
            try { const mul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1); radius *= (mul || 1); } catch { /* ignore */ }
          }
          if (lifeMs == null) lifeMs = baseMs + (lvl - 1) * 200;
      const isSludge = (b.weaponType === WeaponType.LIVING_SLUDGE);
      const potency = isSludge ? Math.max(0, Math.round((lvl - 1) * 0.6)) : 0;
      this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs, isSludge ? { isSludge: true, potency } : undefined);
        } catch { this.enemyManager.spawnPoisonPuddle(b.x, b.y); }
        b.active = false; // Mark as inactive to be returned to pool
        this.bulletPool.push(b);
        continue;
      }
      // Plant Data Sigil on expiry if it didn't hit anything
      if (b.weaponType === WeaponType.DATA_SIGIL && b.lifeMs !== undefined && b.lifeMs <= 0) {
        try {
          const lvl = (b as any).level || 1;
          const spec: any = (WEAPON_SPECS as any)[WeaponType.DATA_SIGIL];
          const stats = spec?.getLevelStats ? spec.getLevelStats(lvl) : {};
          window.dispatchEvent(new CustomEvent('plantDataSigil', { detail: { x: b.x, y: b.y, level: lvl, radius: stats?.sigilRadius || 120, pulseCount: stats?.pulseCount || 3, pulseDamage: stats?.pulseDamage || 90 } }));
        } catch {}
        b.active = false; this.bulletPool.push(b); continue;
      }
      // Singularity Spear: on expiry, trigger a quick implosion then a shockwave explosion
      if (b.lifeMs !== undefined && b.lifeMs <= 0 && b.weaponType === WeaponType.SINGULARITY_SPEAR) {
        // Visual/audio via centralized Game listeners
        const base = b.damage || 50;
        try {
          window.dispatchEvent(new CustomEvent('mortarImplosion', { detail: { x: b.x, y: b.y, radius: 90, color: '#DCC6FF', delay: 60 } }));
          window.dispatchEvent(new CustomEvent('droneExplosion', { detail: { x: b.x, y: b.y, damage: Math.round(base * 1.25), radius: 140 } }));
        } catch {}
        b.active = false; this.bulletPool.push(b); continue;
      }

  // Trail accumulation for weapons with trail visuals (added LASER for subtle trace)
  if ((b.weaponType === WeaponType.TRI_SHOT || b.weaponType === WeaponType.RAPID || b.weaponType === WeaponType.LASER || b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER || b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR || b.weaponType === WeaponType.RUNNER_GUN || b.weaponType === WeaponType.RUNNER_OVERDRIVE || b.weaponType === WeaponType.SERPENT_CHAIN) && b.active && b.projectileVisual && (b.projectileVisual as any).trailLength) {
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        const baseMax = (b.projectileVisual as any).trailLength || 10;
  const maxTrail = (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) ? Math.min(48, baseMax) : Math.min(14, baseMax); // heavy shells keep longer plume
        if (b.trail.length > maxTrail) b.trail.splice(0, b.trail.length - maxTrail);
      }

      // If bullet is still active and within extended frustum, keep it
      if (b.active) {
        if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) {
          // If BIO_TOXIN/LIVING_SLUDGE leave bounds, still drop a puddle at last position
          if ((b.weaponType === WeaponType.BIO_TOXIN || b.weaponType === WeaponType.LIVING_SLUDGE)) {
            try {
              const lvl = (b as any).level || 1;
              const baseR = 28, baseMs = 2600;
              let radius: number = (b as any).puddleRadius;
              let lifeMs: number = (b as any).puddleLifeMs;
              if (radius == null) {
                radius = baseR + (lvl - 1) * 3;
                try { const mul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1); radius *= (mul || 1); } catch { /* ignore */ }
              }
              if (lifeMs == null) lifeMs = baseMs + (lvl - 1) * 200;
              const isSludge = (b.weaponType === WeaponType.LIVING_SLUDGE);
              const potency = isSludge ? Math.max(0, Math.round((lvl - 1) * 0.6)) : 0;
              this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs, isSludge ? { isSludge: true, potency } : undefined);
            } catch { /* ignore spawn errors */ }
          }
          b.active = false;
          this.bulletPool.push(b);
          continue;
        }
        activeBullets.push(b);
      }
    }
  this.bullets = activeBullets; // Update the active bullets list
  // Update Neural Threader threads: pulses, autosnap, cleanup
  this.updateNeuralThreads(deltaTime);
  }

  public draw(ctx: CanvasRenderingContext2D) {
    const camX = (window as any).__camX || 0;
    const camY = (window as any).__camY || 0;
    const viewW = (window as any).__designWidth || ctx.canvas.width;
    const viewH = (window as any).__designHeight || ctx.canvas.height;
    const pad = 64;
    const minX = camX - pad, maxX = camX + viewW + pad;
    const minY = camY - pad, maxY = camY + viewH + pad;
  // Frame-level VFX quality toggle
  const avgMs = (window as any).__avgFrameMs || 16;
  const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;

  // Draw Neural Threader threads beneath bullets for layering clarity
  this.drawNeuralThreads(ctx);
  // Draw Resonant Web connecting strands beneath projectiles for clarity
  try {
    const webs = this.bullets.filter(b => b.active && b.isOrbiting && b.weaponType === WeaponType.RESONANT_WEB && (b as any).orbitKind === 'WEB');
    if (webs.length >= 2) {
      // Lattice-active tint
      let lineColOuter = 'rgba(255,153,255,0.45)';
      let lineColInner = 'rgba(255,153,255,0.25)';
      try {
        const meter: any = (this.player as any)?.getWeaverLatticeMeter?.();
        if (meter && meter.active) {
          lineColOuter = 'rgba(107,31,179,0.65)'; // #6B1FB3
          lineColInner = 'rgba(179,125,255,0.45)'; // #B37DFF
        }
      } catch { /* ignore */ }
      // Build sorted ring by orbitIndex
      const ring = webs.slice().sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0));
      ctx.save();
      ctx.shadowColor = lineColOuter.replace('0.45','1.0');
      ctx.shadowBlur = 14;
      ctx.strokeStyle = lineColOuter;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ring[0].x, ring[0].y);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i].x, ring[i].y);
      // close loop
      ctx.lineTo(ring[0].x, ring[0].y);
      ctx.stroke();
      // Subtle inner filament
      ctx.shadowBlur = 6;
      ctx.strokeStyle = lineColInner;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  } catch { /* ignore */ }
  for (const b of this.bullets) {
      if (!b.active) continue;
      if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;
      ctx.save();
  // Draw trail first (behind projectile) – add neon variant for Runner Gun
  if ((b.weaponType === WeaponType.TRI_SHOT || b.weaponType === WeaponType.RAPID || b.weaponType === WeaponType.LASER || b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER || b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR || b.weaponType === WeaponType.RUNNER_GUN || b.weaponType === WeaponType.RUNNER_OVERDRIVE || b.weaponType === WeaponType.SERPENT_CHAIN) && b.trail && b.trail.length > 1 && b.projectileVisual && (b.projectileVisual as any).trailColor) {
        const visual = b.projectileVisual as any;
        ctx.save();
  // Thicker, softer trail for mortar; subtle neon for Runner Gun
  ctx.lineWidth = ((b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) ? 3.2 : 1.5);
  const col = visual.trailColor as string;
  const neonTrail = !vfxLow && (b.weaponType === WeaponType.RUNNER_GUN);
  const prevComp = ctx.globalCompositeOperation;
  if (neonTrail) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = (visual.glowColor as string) || '#66F2FF';
    ctx.shadowBlur = Math.max(visual.glowRadius || 0, 6);
    ctx.lineWidth = 1.8;
  }
        // Efficient alpha fade: parse color once, then modulate globalAlpha per segment
        const rgba = BulletManager.parseColor(col);
        if (rgba) {
          ctx.strokeStyle = `rgb(${rgba.r},${rgba.g},${rgba.b})`;
        } else {
          ctx.strokeStyle = col;
        }
        const total = b.trail.length;
        const step = vfxLow ? 2 : 1; // stride under load
        const baseAlpha = rgba ? rgba.a : 1;
        for (let i = 1; i < total; i += step) {
          const p0 = b.trail[i - 1];
          const p1 = b.trail[i];
          const t = i / total;
          const fadeT = (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER) ? Math.sqrt(t) : t;
          ctx.globalAlpha = Math.max(0, Math.min(1, (baseAlpha * fadeT)));
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (neonTrail) { ctx.globalCompositeOperation = prevComp; }
  if (!vfxLow && (b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.SIEGE_HOWITZER)) {
          // Add faint expanding smoke puffs along path (simple circles)
          const every = 6; // fewer puffs
          for (let i = 0; i < b.trail.length; i += every) {
            const pt = b.trail[i];
            const age = (b.trail.length - i) / b.trail.length; // 0..1
            const alpha = 0.18 * age;
            const rad = 6 + 18 * age;
            ctx.beginPath();
            ctx.fillStyle = `rgba(120,100,60,${alpha.toFixed(3)})`;
            ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
      // Clone visual per draw to avoid cross-bullet mutation leaks
      let visual: any = b.projectileVisual ? { ...(b.projectileVisual as any) } : { type: 'bullet', color: '#0ff', size: b.radius, glowColor: '#0ff', glowRadius: 8 };
      // Enforce visual identity locks first
      const vLock = (b as any).visualLock;
      if (vLock === 'GRINDER' || (b.weaponType === WeaponType.INDUSTRIAL_GRINDER && (b as any).isOrbiting)) {
        // Ensure grinder uses its sprite if available
        const grSpec: any = (WEAPON_SPECS as any)[WeaponType.INDUSTRIAL_GRINDER];
        const fallback = (grSpec?.projectileVisual || {}) as any;
        const forcedSize = Math.max(fallback.size ?? 0, visual?.size ?? 0, b.radius ?? 0);
        visual = { ...fallback, type: 'bullet', size: forcedSize || 18 };
      }
  if ((vLock !== 'SAW' && vLock !== 'GRINDER') && (vLock === 'HALO' || b.weaponType === WeaponType.QUANTUM_HALO) && visual) {
        const hue = (visual._dynamicHue||0);
        visual.color = `hsl(${hue},100%,82%)`;
        visual.glowColor = `hsl(${(hue+45)%360},100%,65%)`;
        visual.glowRadius = 55;
      }

      // Visual tether for evolved grinder: draw a glowing line from player to blade
      if (b.weaponType === WeaponType.INDUSTRIAL_GRINDER && (b as any).isOrbiting) {
        const pl = this.player;
        // Ensure player exists and keep within view bounds to avoid offscreen overdraw
        if (pl && b.x >= minX && b.x <= maxX && b.y >= minY && b.y <= maxY) {
          const dx = b.x - pl.x;
          const dy = b.y - pl.y;
          const d2 = dx*dx + dy*dy;
          if (d2 > 1) {
            const len = Math.sqrt(d2);
            // Saw visual color from spec (warm amber), fallback to projectile glow
            const col = (visual && (visual.glowColor || visual.color)) || '#FFD770';
            ctx.save();
            // Soft outer glow
            ctx.shadowColor = col;
            ctx.shadowBlur = Math.min(visual?.glowRadius ?? 14, 18);
            // Slight width scaling with distance so long reaches look a bit thicker
            const lw = Math.min(5, 1.5 + len * 0.004);
            // Mid-bright gradient (fades at ends)
            const grad = ctx.createLinearGradient(pl.x, pl.y, b.x, b.y);
            grad.addColorStop(0.0, 'rgba(255,215,112,0.00)');
            grad.addColorStop(0.2, 'rgba(255,215,112,0.65)');
            grad.addColorStop(0.8, 'rgba(255,215,112,0.65)');
            grad.addColorStop(1.0, 'rgba(255,215,112,0.00)');
            ctx.strokeStyle = grad;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(pl.x, pl.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // General bullet drawing logic (including what was Mech Mortar)
  if (visual?.type === 'bullet') {
        ctx.save(); // Ensure save/restore for bullet drawing
        if (visual.sprite) {
          // Force-tint cyan runner sprite if used for Overdrive, to ensure dark red visuals
          if (b.weaponType === WeaponType.RUNNER_OVERDRIVE) {
            visual = { ...visual };
            visual.color = '#8B0000';
            visual.glowColor = visual.glowColor || '#B22222';
            (visual as any).trailColor = (visual as any).trailColor || 'rgba(139,0,0,0.70)';
            (visual as any).trailLength = Math.max(((visual as any).trailLength || 0), 20);
          }
          // Use PNG sprite for bullet, rotated to match direction; lazy-load if absent
          // Resolve manifest key to path if needed
          let spritePath = visual.sprite as string;
          if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(spritePath)) {
            const manifestPath = this.assetLoader.getAsset(spritePath);
            if (manifestPath) spritePath = manifestPath;
          }
          let bulletImage = this.assetLoader.getImage(spritePath);
          if (!bulletImage) {
            // Kick off async load (fire and forget); will display from next frame
            this.assetLoader.loadImage(spritePath);
            // Fallback for Industrial Grinder while asset is missing: reuse sawblade if available
            if (b.weaponType === WeaponType.INDUSTRIAL_GRINDER) {
              const fallbackPath = AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png');
              bulletImage = this.assetLoader.getImage(fallbackPath);
              if (!bulletImage) this.assetLoader.loadImage(fallbackPath);
            }
          } else {
            const size = (visual.size ?? b.radius) * 2;
            const drawX = b.x;
            const drawY = b.y;
            let angle = Math.atan2(b.vy, b.vx);
            if ((!b.vx && !b.vy)) {
              if (b.isOrbiting && (b.orbitAngle != null)) angle = b.orbitAngle;
              // Melee sweep orientation
              if ((b as any).displayAngle != null) angle = (b as any).displayAngle;
            }
            if (typeof visual.rotationOffset === 'number') angle += visual.rotationOffset;
            ctx.save();
            ctx.translate(drawX, drawY);
            ctx.rotate(angle);
            // Subtle glow for laser blaster sprite
            if (b.weaponType === WeaponType.LASER) {
              ctx.shadowColor = visual.glowColor || visual.color || '#FF6A50';
              ctx.shadowBlur = Math.min(visual.glowRadius ?? 14, 18);
            }
            // If artwork contains a visible outer frame, crop 1px inset to avoid halo
            if (spritePath && /bullet_sawblade\.png$/.test(spritePath)) {
              // Draw using source rect inset by 1px
              const sw = bulletImage.width - 2;
              const sh = bulletImage.height - 2;
              ctx.drawImage(bulletImage, 1, 1, sw, sh, -size/2, -size/2, size, size);
            } else {
              ctx.drawImage(bulletImage, -size / 2, -size / 2, size, size);
            }
            ctx.restore();
          }
        }
        if (!visual.sprite) {
          // Extra faint directional beam segment for Laser Blaster to hint original laser feel
          if (!vfxLow && b.weaponType === WeaponType.LASER) {
            const len = 26; // a bit longer than sprite diameter
            const thick = 2;
            const ang = Math.atan2(b.vy, b.vx);
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(ang);
            const grd = ctx.createLinearGradient(-len*0.5, 0, len*0.5, 0);
            const col = visual.color || '#FF3020';
            grd.addColorStop(0, 'rgba(255,80,60,0)');
            grd.addColorStop(0.35, col + '');
            grd.addColorStop(0.65, col + '');
            grd.addColorStop(1, 'rgba(255,80,60,0)');
            ctx.globalAlpha = 0.55; // subtle
            ctx.beginPath();
            ctx.roundRect(-len*0.5, -thick*0.5, len, thick, thick*0.5);
            ctx.fillStyle = grd;
            ctx.fill();
            ctx.restore();
          }
      // Fallback for bullet visuals without sprite: draw a capsule-shaped bullet, not an orb
          // Compute orientation
          let ang = Math.atan2(b.vy, b.vx);
          if ((!b.vx && !b.vy)) {
            if (b.isOrbiting && (b.orbitAngle != null)) ang = b.orbitAngle;
            if ((b as any).displayAngle != null) ang = (b as any).displayAngle;
          }
          if (typeof (visual as any).rotationOffset === 'number') ang += (visual as any).rotationOffset;
          const r = (visual.size ?? b.radius) as number; // base radius
          // Body length tuned for clarity; add slight dynamic squish for "gummy" feel
          const tNow = performance.now();
          const wob = vfxLow ? 1 : (1 + Math.sin((tNow + (b as any)._id * 37) * 0.012) * 0.06);
          const bodyLen = Math.max(8, r * 2.4 * wob);
          const bodyWidth = Math.max(3, r * 0.9 / wob);
          const tipLen = Math.max(3, r * 0.9);
          // Glow
          if (!vfxLow) {
            ctx.shadowColor = visual.glowColor ?? visual.color ?? '#FFD700';
            ctx.shadowBlur = visual.glowRadius ?? 10;
          }
          // Draw capsule body
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.rotate(ang);
          ctx.beginPath();
          // Rounded rectangle body (capsule)
          const halfL = bodyLen * 0.5;
          const halfW = bodyWidth * 0.5;
          // Use roundRect if available; otherwise approximate with arcs
          if ((ctx as any).roundRect) {
            ctx.roundRect(-halfL, -halfW, bodyLen, bodyWidth, Math.min(halfW, 6));
          } else {
            ctx.moveTo(-halfL, -halfW);
            ctx.lineTo(halfL, -halfW);
            ctx.arc(halfL, 0, halfW, -Math.PI/2, Math.PI/2);
            ctx.lineTo(-halfL, halfW);
            ctx.arc(-halfL, 0, halfW, Math.PI/2, -Math.PI/2);
          }
          ctx.fillStyle = visual.color ?? '#FFD700';
          ctx.fill();
          // Draw a simple pointed tip
          ctx.beginPath();
          ctx.moveTo(halfL, 0);
          ctx.lineTo(halfL + tipLen, -halfW * 0.85);
          ctx.lineTo(halfL + tipLen, halfW * 0.85);
          ctx.closePath();
          ctx.fill();
          // Subtle inner highlight for depth (skip in low FX)
          if (!vfxLow) {
            const grad = ctx.createLinearGradient(-halfL, 0, halfL + tipLen, 0);
            grad.addColorStop(0, 'rgba(255,255,255,0.00)');
            grad.addColorStop(0.45, 'rgba(255,255,255,0.15)');
            grad.addColorStop(0.9, 'rgba(255,255,255,0.00)');
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = grad;
            if ((ctx as any).roundRect) {
              ctx.beginPath();
              ctx.roundRect(-halfL * 0.6, -halfW * 0.5, bodyLen * 0.8, bodyWidth * 0.55, Math.min(halfW * 0.5, 4));
              ctx.fill();
            }
          }
          ctx.restore();
        }
        ctx.restore(); // Restore after bullet drawing
        // Optional faint slime trail for slime-type visuals rendered as bullets (positions only; drawn in slime branch)
        if (visual && (visual as any).type === 'slime') {
          if (!b.trail) b.trail = [];
          b.trail.push({ x: b.x, y: b.y });
          const maxTrail = 10;
          if (b.trail.length > maxTrail) b.trail.splice(0, b.trail.length - maxTrail);
        }

        // Smart Rifle special orbiting mini-orbs (purely cosmetic)
        if (b.weaponType === WeaponType.RAPID) {
          const tNow = performance.now();
          const t0 = (b as any)._spawnTime || tNow;
          const dt = (tNow - t0) * 0.001; // seconds since spawn
          const orbCount = vfxLow ? 1 : 3; // reduce under load
          const baseRadius = (visual.size ?? b.radius) * 1.2; // orbit distance from center
          const spin = 2.4; // revolutions per second (angular speed scalar)
          // Precompute alpha pulsation once
          const pulse = vfxLow ? 0.6 : (0.55 + 0.45 * Math.sin(dt * 6.0));
          for (let oi = 0; oi < orbCount; oi++) {
            // Phase offset per orb
            const phase = (oi / orbCount) * Math.PI * 2;
            const ang = phase + dt * Math.PI * 2 * spin;
            const ox = b.x + Math.cos(ang) * baseRadius;
            const oy = b.y + Math.sin(ang) * baseRadius;
            ctx.save();
            if (!vfxLow) {
              ctx.shadowColor = visual.glowColor || visual.color || '#88e0ff';
              ctx.shadowBlur = 6;
            }
            ctx.beginPath();
            const orbSize = (visual.size ?? b.radius) * (vfxLow ? 0.28 : 0.35);
            ctx.arc(ox, oy, orbSize, 0, Math.PI * 2);
            // Slight color shift per orb for variety
            const hueShift = (oi * 40) % 360;
            // If original color is rgba use it, else synthesize hsla
            let fillStyle = visual.color;
            if (!fillStyle || /^#/.test(fillStyle)) {
              fillStyle = `hsla(${hueShift},85%,60%,${pulse.toFixed(3)})`;
            } else if (/rgba?\(/.test(fillStyle)) {
              // Inject dynamic alpha into existing rgba (...)
              fillStyle = fillStyle.replace(/rgba?\(([^)]+)\)/, (m: string, inner: string) => {
                const parts = inner.split(',').map((s: string) => s.trim());
                if (parts.length === 4) {
                  parts[3] = pulse.toFixed(3);
                  return `rgba(${parts.join(',')})`;
                } else if (parts.length === 3) {
                  return `rgba(${parts.join(',')},${pulse.toFixed(3)})`;
                }
                return m;
              });
            }
            ctx.fillStyle = fillStyle || (vfxLow ? 'rgba(180,255,255,0.5)' : 'rgba(180,255,255,0.6)');
            ctx.fill();
            ctx.restore();
          }
        }
  } else if (visual?.type === 'drone') {
        // Kamikaze drone sprite (spins slowly)
        ctx.save();
  const img = visual.sprite ? this.assetLoader.getImage(visual.sprite) : this.assetLoader.getImage('/assets/projectiles/bullet_drone.png');
  const baseSize = (visual.size ?? b.radius) * 2;
  const scale = b.altitudeScale != null ? b.altitudeScale : 1;
  // Stronger visual differentiation: very small at low altitudeScale, large at peak ascent
  // scale 0.0 -> 0.35x, 1.0 -> 1.8x base size
  const sizeFactor = 0.35 + 1.45 * Math.min(1, Math.max(0, scale));
  const size = baseSize * sizeFactor; // grows during ascent, shrinks during dive
        const ang = (performance.now() * 0.0008) % (Math.PI*2); // gentle spin
        ctx.translate(b.x, b.y);
  // Orientation: face travel direction if available, else slow idle spin
  const faceAng = (b as any).facingAng;
  if (faceAng != null) ctx.rotate(faceAng);
  else ctx.rotate(ang);
        if (img) {
          if (!vfxLow) { ctx.shadowColor = visual.glowColor || visual.color || '#00BFFF'; ctx.shadowBlur = visual.glowRadius ?? 10; }
          ctx.drawImage(img, -size/2, -size/2, size, size);
        } else {
          if (!vfxLow) { ctx.shadowColor = visual.glowColor || visual.color || '#00BFFF'; ctx.shadowBlur = visual.glowRadius ?? 10; }
          ctx.beginPath();
          ctx.arc(0, 0, visual.size ?? b.radius, 0, Math.PI*2);
          ctx.fillStyle = visual.color || '#00BFFF';
          ctx.fill();
        }
        // Faint vertical line to ground hint (altitude) while ascending
  if (!vfxLow && b.phase === 'ASCEND' && scale < 0.98) {
          ctx.save();
          ctx.rotate(-ang); // reset rotation for line
          ctx.globalAlpha = 0.25 * (1 - scale);
          ctx.strokeStyle = visual.color || '#00BFFF';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, size * 0.6);
          ctx.lineTo(0, size * (1.6 + (1 - scale) * 1.2));
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      } else if (visual?.type === 'slime') {
        // Organic slime blob: wobbly amoeba with stretch along velocity, inner bubbles, and droplet trail
        ctx.save();
        const now = performance.now();
        const avgMs = (window as any).__avgFrameMs || 16;
        const vfxLow = (avgMs > 55) || !!(window as any).__vfxLowMode;
        const size = Math.max(visual.size ?? b.radius, 6);
        const vx = b.vx || 0, vy = b.vy || 0;
        const spd = Math.hypot(vx, vy) || 0.0001;
        const ang = Math.atan2(vy, vx);
        // Wobble phase seeded per-bullet
        const seed = ((b as any)._slimeSeed ?? ((b as any)._slimeSeed = Math.random() * 1000));
        const phase = (now * 0.006 + seed) % (Math.PI * 2);
        // Stretch scales with speed (capped)
        const stretch = Math.min(0.35, spd * 0.03);
        const sx = 1 + stretch;
        const sy = 1 - stretch * 0.6;
        // Build blob path with radial noise
        ctx.translate(b.x, b.y);
        ctx.rotate(ang);
        ctx.scale(sx, sy);
        const pts = vfxLow ? 10 : 14;
        const r = size;
        ctx.beginPath();
        for (let i = 0; i < pts; i++) {
          const t = (i / pts) * Math.PI * 2;
          // Two-layer sine noise for bumpy edge; tiny breathing with phase
          const n1 = Math.sin(t * 3 + phase) * 0.14;
          const n2 = Math.sin(t * 6 - phase * 0.8) * 0.08;
          const rr = r * (1 + n1 + n2);
          const x = Math.cos(t) * rr;
          const y = Math.sin(t) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        // Fill with radial gradient for gooey depth
        const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r * 1.05);
        const baseCol = visual.color || '#66FF6A';
        const glowCol = visual.glowColor || baseCol;
        g.addColorStop(0, baseCol);
        g.addColorStop(0.65, baseCol);
        g.addColorStop(1, (glowCol.startsWith('rgba') || glowCol.startsWith('hsla')) ? glowCol : (glowCol + 'CC'));
        ctx.shadowColor = visual.glowColor ?? baseCol;
        ctx.shadowBlur = Math.max(visual.glowRadius ?? 10, vfxLow ? 6 : 12);
        ctx.fillStyle = g;
        ctx.fill();
        // Sheen: faint elliptical highlight near front
        ctx.save();
        ctx.rotate(-ang); // back to world orientation for placing sheen relative to screen
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        const sheenW = r * 0.9, sheenH = r * 0.45;
        ctx.ellipse(r * 0.25, -r * 0.15, sheenW * 0.45, sheenH * 0.45, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.restore();
        // Inner bubbles drifting
        const bubbles = vfxLow ? 2 : 4;
        for (let i = 0; i < bubbles; i++) {
          const bt = phase + i * 1.37;
          const br = r * (0.25 + 0.35 * ((i + 1) / (bubbles + 1)));
          const bx = Math.cos(bt) * br * 0.6;
          const by = Math.sin(bt * 1.2) * br * 0.4;
          ctx.beginPath();
          ctx.arc(bx, by, Math.max(1.5, r * 0.10 * (0.7 + 0.3 * Math.sin(bt * 2))), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fill();
        }
        ctx.restore();
        // Droplet trail: draw small fading blobs along stored positions
        if (b.trail && b.trail.length > 1) {
          const maxDraw = Math.min(b.trail.length - 1, vfxLow ? 4 : 7);
          for (let ti = 1; ti <= maxDraw; ti++) {
            const p = b.trail[b.trail.length - 1 - ti];
            const a = Math.max(0, 1 - ti / (maxDraw + 1));
            const droplet = size * (0.35 + 0.12 * (1 - a));
            ctx.save();
            ctx.globalAlpha = 0.55 * a;
            ctx.shadowColor = visual.glowColor || baseCol;
            ctx.shadowBlur = (visual.glowRadius ?? 10) * 0.6;
            ctx.beginPath();
            ctx.arc(p.x, p.y, droplet, 0, Math.PI * 2);
            ctx.fillStyle = baseCol;
            ctx.fill();
            ctx.restore();
          }
        }
      } else if (visual?.type === 'plasma') {
        ctx.save();
        ctx.shadowColor = visual.glowColor ?? visual.color ?? '#0ff';
        ctx.shadowBlur = visual.glowRadius ?? 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
        ctx.fillStyle = visual.color ?? '#0ff';
        ctx.fill();
        ctx.restore();
      } else if (visual?.type === 'laser') {
        // Laser: oriented line segment (length) with thickness, slight glow
        const len = visual.length ?? 20;
        const thick = visual.thickness ?? 3;
        // Derive angle from velocity; fallback 0
        let ang = Math.atan2(b.vy, b.vx);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(ang);
        ctx.shadowColor = visual.glowColor || visual.color || '#FF3A24';
        ctx.shadowBlur = visual.glowRadius ?? 12;
        const halfLen = len * 0.5;
        const grd = ctx.createLinearGradient(-halfLen, 0, halfLen, 0);
        const col = visual.color || '#FF3A24';
        grd.addColorStop(0, 'rgba(255,90,60,0.0)');
        grd.addColorStop(0.2, col);
        grd.addColorStop(0.8, col);
        grd.addColorStop(1, 'rgba(255,90,60,0.0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.roundRect(-halfLen, -thick*0.5, len, thick, thick*0.5);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.save(); // Ensure save/restore for default drawing
        const bulletImage = this.assetLoader.getImage(b.projectileImageKey ?? 'bullet_cyan');
        if (bulletImage) {
          const drawX = b.x - (visual.size ?? b.radius);
          const drawY = b.y - (visual.size ?? b.radius);
          ctx.drawImage(bulletImage, drawX, drawY, (visual.size ?? b.radius) * 2, (visual.size ?? b.radius) * 2);
        } else {
          ctx.shadowColor = visual.glowColor ?? visual.color ?? '#0ff';
          ctx.shadowBlur = visual.glowRadius ?? 8;
          ctx.beginPath();
          ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
          ctx.fillStyle = visual.color ?? '#0ff';
          ctx.fill();
        }
        ctx.restore(); // Restore after default drawing
      }
      ctx.restore(); // This restore is for the initial ctx.save() at the start of the loop
    }
  }

  /** Tick Neural Threader/Nexus threads: apply periodic damage and manage lifecycle. */
  private updateNeuralThreads(deltaMs: number) {
    const now = performance.now();
    if (!this.neuralThreads || this.neuralThreads.length === 0) return;
    const overmindUntil = (window as any).__overmindActiveUntil || 0;
    for (let i = 0; i < this.neuralThreads.length; i++) {
      const t = this.neuralThreads[i];
      if (!t.active) continue;
      // Cull dead anchors and expired
      t.anchors = t.anchors.filter(e => e && e.active && e.hp > 0);
      const isNexus = (t.weaponType === WeaponType.NEURAL_NEXUS);
      // Expiry handling: for Nexus, detonate on expiry; for Threader, just deactivate
      if (t.anchors.length === 0) { t.active = false; continue; }
      if (now >= t.expireAt) {
        if (isNexus) {
          // Detonation burst on all anchors, plus heavier segment splash
          const burst = Math.max(1, Math.round(t.baseDamage * t.pulsePct * (t.detonateFrac || 3.0) * 0.7));
          for (let ai = 0; ai < t.anchors.length; ai++) {
            const e: any = t.anchors[ai]; if (!e || !e.active || e.hp <= 0) continue;
            if ((e as any).isBoss) (this.enemyManager as any).takeBossDamage?.(e, burst, false, WeaponType.NEURAL_NEXUS, e.x, e.y, undefined, true);
            else this.enemyManager.takeDamage(e, burst, false, false, WeaponType.NEURAL_NEXUS, undefined, undefined, undefined, true);
            if (this.particleManager) this.particleManager.spawn(e.x, e.y, 4, '#9ffcf6');
          }
          for (let ai = 0; ai < t.anchors.length - 1; ai++) {
            const a = t.anchors[ai], bA = t.anchors[ai+1];
            const mx = (a.x + bA.x) * 0.5, my = (a.y + bA.y) * 0.5;
            const near = this.queryEnemies(mx, my, 120);
            for (let ni = 0; ni < near.length; ni++) {
              const e = near[ni]; if (!e.active || e.hp <= 0) continue;
              if (t.anchors.indexOf(e) !== -1) continue;
              this.enemyManager.takeDamage(e, Math.max(1, Math.round(burst * 0.38)), false, false, WeaponType.NEURAL_NEXUS, undefined, undefined, undefined, true);
              const anyE: any = e as any; anyE._rgbGlitchUntil = Math.max(anyE._rgbGlitchUntil||0, now + 220); anyE._rgbGlitchPhase = (anyE._rgbGlitchPhase||0) + 1;
            }
          }
          try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 110, intensity: 2 } })); } catch {}
        }
        t.active = false; continue;
      }
      // Autosnap: during Overmind for Threader, or always-on for Nexus (limited by capacity)
      const allowNexusAutosnap = isNexus;
      if ((overmindUntil > now && t.anchors.length < t.maxAnchors + 1) || (allowNexusAutosnap && t.anchors.length < t.maxAnchors)) {
        // Search around mid-point of last segment for a close enemy not already in anchors
        const last = t.anchors[t.anchors.length - 1];
        const sx = last.x, sy = last.y;
  const candidates = this.queryEnemies(sx, sy, isNexus ? 280 : 240);
        // Pass 1: prefer psionic-marked enemies
        let added = false;
        for (let ci = 0; ci < candidates.length; ci++) {
          const e = candidates[ci]; if (!e.active || e.hp <= 0) continue;
          if (t.anchors.indexOf(e) !== -1) continue;
          const anyE: any = e as any;
          const primed = (anyE._poisonStacks && anyE._poisonStacks > 0)
            || (anyE._burnStacks && anyE._burnStacks > 0)
            || ((anyE._psionicMarkUntil || 0) > now)
            || ((anyE._paralyzedUntil || 0) > now)
            || ((anyE._armorShredExpire || 0) > now)
            || ((anyE._rgbGlitchUntil || 0) > now)
            || ((anyE._neuralDebuffUntil || 0) > now);
          if (!primed) continue;
          t.anchors.push(e); added = true; break;
        }
        // Pass 2: fallback to nearest if none marked
        if (!added) {
          let best: Enemy | null = null; let bestD2 = Infinity;
          for (let ci = 0; ci < candidates.length; ci++) {
            const e = candidates[ci]; if (!e.active || e.hp <= 0) continue;
            if (t.anchors.indexOf(e) !== -1) continue;
            const dx = e.x - sx, dy = e.y - sy; const d2 = dx*dx + dy*dy;
            if (d2 < bestD2) { best = e; bestD2 = d2; }
          }
          if (best) t.anchors.push(best);
        }
      }
      // Pulse damage on cadence
      if (now >= t.nextPulseAt) {
        t.nextPulseAt = now + t.pulseMs;
        // Damage anchors
  // Reduce Nexus tick damage by ~30% (global Nexus tuning)
  const perPulse = Math.max(1, Math.round(t.baseDamage * t.pulsePct * (isNexus ? 0.7 : 1)));
        for (let ai = 0; ai < t.anchors.length; ai++) {
          const e: any = t.anchors[ai]; if (!e || !e.active || e.hp <= 0) continue;
          const wType = isNexus ? WeaponType.NEURAL_NEXUS : WeaponType.NOMAD_NEURAL;
          if ((e as any).isBoss) {
            (this.enemyManager as any).takeBossDamage?.(e, perPulse, false, wType, e.x, e.y, undefined, true);
            if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, isNexus ? '#9ffcf6' : '#26ffe9');
          } else {
            this.enemyManager.takeDamage(e, perPulse, false, false, wType, undefined, undefined, undefined, true);
            if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, isNexus ? '#9ffcf6' : '#26ffe9');
          }
        }
        // Light arc zap to enemies near each segment for readability/aoe feel
        for (let ai = 0; ai < t.anchors.length - 1; ai++) {
          const a: any = t.anchors[ai], bA: any = t.anchors[ai+1];
          const mx = (a.x + bA.x) * 0.5, my = (a.y + bA.y) * 0.5;
          const near = this.queryEnemies(mx, my, isNexus ? 100 : 80);
          for (let ni = 0; ni < near.length; ni++) {
            const e = near[ni]; if (!e.active || e.hp <= 0) continue;
            if (t.anchors.indexOf(e) !== -1) continue;
            // tiny chip (stronger for Nexus)
            const frac = isNexus ? 0.26 : 0.18;
            this.enemyManager.takeDamage(e, Math.max(1, Math.round(perPulse * frac)), false, false, isNexus ? WeaponType.NEURAL_NEXUS : WeaponType.NOMAD_NEURAL, undefined, undefined, undefined, true);
          }
        }
        // Reset bead animation
        t.beadPhase = 0;
      } else {
        // progress beads
        const remain = t.nextPulseAt - now;
        t.beadPhase = 1 - Math.max(0, Math.min(1, remain / t.pulseMs));
      }
    }
    // Optionally compact array occasionally (avoid frequent splices)
    if (now % 5 < 1) {
      for (let i = this.neuralThreads.length - 1; i >= 0; i--) if (!this.neuralThreads[i].active) this.neuralThreads.splice(i, 1);
    }
  }

  /** Draw Neural Threader threads: glowing lines with traveling beads. */
  private drawNeuralThreads(ctx: CanvasRenderingContext2D) {
    if (!this.neuralThreads || this.neuralThreads.length === 0) return;
    ctx.save();
    for (let i = 0; i < this.neuralThreads.length; i++) {
      const t = this.neuralThreads[i]; if (!t.active) continue;
      // If we only have a single anchor, draw a small pulsing node to indicate the thread is waiting for another anchor
      if (t.anchors.length === 1) {
        const a = t.anchors[0];
        ctx.save();
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = t.color;
        const r = 3 + Math.sin(performance.now()*0.008)*1.5;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (t.anchors.length < 2) continue;
      // Build polyline path
      ctx.save();
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(t.anchors[0].x, t.anchors[0].y);
      for (let ai = 1; ai < t.anchors.length; ai++) ctx.lineTo(t.anchors[ai].x, t.anchors[ai].y);
      ctx.stroke();
      // Draw beads traveling along segments
      const beadCount = Math.min(2, t.anchors.length - 1);
      for (let bi = 0; bi < beadCount; bi++) {
        const seg = Math.min(t.anchors.length - 2, bi);
        const a = t.anchors[seg], b = t.anchors[seg+1];
        const px = a.x + (b.x - a.x) * t.beadPhase;
        const py = a.y + (b.y - a.y) * t.beadPhase;
        ctx.beginPath();
        ctx.fillStyle = '#9ffcf6';
        ctx.arc(px, py, 4, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /**
   * Nomad Overload: Immediately detonate all active neural threads for a burst of damage.
   * Each anchor takes a burst equal to baseDamage * pulsePct * 2.5 * multiplier.
   * Nearby enemies along segments take a reduced fraction. Threads are then deactivated.
   */
  private handleNomadOverload(multiplier: number) {
    try {
      if (!this.neuralThreads || this.neuralThreads.length === 0) return;
      for (let i = 0; i < this.neuralThreads.length; i++) {
        const t = this.neuralThreads[i];
        if (!t.active || !t.anchors || t.anchors.length === 0) continue;
  let burst = Math.max(1, Math.round(t.baseDamage * t.pulsePct * 5.0 * (multiplier || 1))); // doubled overall
  if (t.weaponType === WeaponType.NEURAL_NEXUS) burst = Math.max(1, Math.round(burst * 0.7));
        const wType = (t.weaponType === WeaponType.NEURAL_NEXUS) ? WeaponType.NEURAL_NEXUS : WeaponType.NOMAD_NEURAL;
        // Damage anchors heavily
        for (let ai = 0; ai < t.anchors.length; ai++) {
          const e: any = t.anchors[ai]; if (!e || !e.active || e.hp <= 0) continue;
          if ((e as any).isBoss) (this.enemyManager as any).takeBossDamage?.(e, burst, false, wType, e.x, e.y, undefined, true);
          else this.enemyManager.takeDamage(e, burst, false, false, wType, undefined, undefined, undefined, true);
          if (this.particleManager) this.particleManager.spawn(e.x, e.y, 4, '#9ffcf6');
          // Flag RGB glitch effect
          const anyE: any = e as any; anyE._rgbGlitchUntil = Math.max(anyE._rgbGlitchUntil||0, performance.now() + 220); anyE._rgbGlitchPhase = (anyE._rgbGlitchPhase||0) + 1;
        }
        // Splash along segments
        for (let ai = 0; ai < t.anchors.length - 1; ai++) {
          const a = t.anchors[ai], b = t.anchors[ai+1];
          const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
          const near = this.queryEnemies(mx, my, (t.weaponType === WeaponType.NEURAL_NEXUS) ? 120 : 110);
          for (let ni = 0; ni < near.length; ni++) {
            const e = near[ni]; if (!e.active || e.hp <= 0) continue;
            if (t.anchors.indexOf(e) !== -1) continue;
            const frac = (t.weaponType === WeaponType.NEURAL_NEXUS) ? 0.38 : 0.33;
            this.enemyManager.takeDamage(e, Math.max(1, Math.round(burst * frac)), false, false, wType, undefined, undefined, undefined, true);
            const anyE: any = e as any; anyE._rgbGlitchUntil = Math.max(anyE._rgbGlitchUntil||0, performance.now() + 180); anyE._rgbGlitchPhase = (anyE._rgbGlitchPhase||0) + 1;
          }
        }
        // Visual zap flash
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2 } })); } catch {}
        t.active = false; // consume the thread
      }
    } catch { /* ignore */ }
  }

  /**
   * Smart Rifle targeting rules (priority order):
   * 1. If a boss is active & alive, ALWAYS target the boss (ignores distance & other enemies).
   * 2. Otherwise pick the "toughest" enemy within searchRadius:
   *    - Highest maxHp (fallback to current hp if max missing)
   *    - Tie-break: among equals, choose the one with the lowest current hp to help finish it
   * @param cx Center X for search (usually current bullet position / aim point)
   * @param cy Center Y for search
   * @param searchRadius Radius to scan for normal enemies when no boss is present
   * @returns Target entity or null
   */
  private selectSmartRifleTarget(cx: number, cy: number, searchRadius: number): any | null {
    // Absolute boss priority
    const bossMgr: any = (window as any).__bossManager;
    const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
    if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
      return boss; // unconditional priority
    }

    let best: any = null;
    let bestMaxHp = -1;
    let bestHpTieBreaker = Infinity; // lower is better when maxHp ties

    const enemies = this.enemySpatialGrid.query(cx, cy, searchRadius);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.active || e.hp <= 0) continue;
      const eMax = (e as any).maxHp != null ? (e as any).maxHp : e.hp;
      if (eMax > bestMaxHp) {
        best = e; bestMaxHp = eMax; bestHpTieBreaker = e.hp;
      } else if (eMax === bestMaxHp && e.hp < bestHpTieBreaker) {
        best = e; bestHpTieBreaker = e.hp;
      }
    }
    return best;
  }

  public spawnBullet(x: number, y: number, targetX: number, targetY: number, weapon: WeaponType, damage: number, level: number = 1): Bullet | undefined {
    // Resonant Web is a persistent orbit system; do not spawn a standard projectile
    if (weapon === WeaponType.RESONANT_WEB) {
      // Ensure strands are created on demand this tick
      try { this.ensureResonantWebStrands(0); } catch {}
      return undefined;
    }
    // Sorcerer Orb is a persistent orbit system; do not spawn a standard projectile
    if (weapon === WeaponType.SORCERER_ORB) {
      try { this.ensureSorcererOrbs(0); } catch {}
      return undefined;
    }
    // Cap concurrent hovering drones (ASCEND/HOVER) based on weapon level
    if (weapon === WeaponType.HOMING) {
      const lvl = Math.max(1, Math.min(7, Math.floor(level || 1)));
      // Level mapping: L1-3 -> 2, L4-6 -> 3, L7 -> 4
      const cap = (lvl >= 7) ? 4 : (lvl >= 4 ? 3 : 2);
      let hovering = 0;
      const arr = this.bullets;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (!b || !b.active) continue;
        if (b.weaponType !== WeaponType.HOMING) continue;
        const ph = (b as any).phase;
        if (ph === 'ASCEND' || ph === 'HOVER') { hovering++; if (hovering >= cap) return undefined; }
      }
    }
    // One-at-a-time rule for Scrap Lash: if an active Lash exists, don't spawn another
    if (weapon === WeaponType.SCRAP_LASH) {
      for (let i = 0; i < this.bullets.length; i++) {
        const bb = this.bullets[i];
        if (bb && bb.active && bb.weaponType === WeaponType.SCRAP_LASH) return undefined;
      }
      // Do not fire Lash if no enemy is nearby
      try {
        const px = this.player ? this.player.x : x;
        const py = this.player ? this.player.y : y;
        const near = this.enemySpatialGrid.query(px, py, 900);
        let found = false;
        for (let i = 0; i < near.length; i++) { const e = near[i]; if (e.active && e.hp > 0) { found = true; break; } }
        if (!found) return undefined;
      } catch { /* if grid unavailable, allow spawn */ }
    }
  const spec = (WEAPON_SPECS as any)[weapon] ?? (WEAPON_SPECS as any)[WeaponType.PISTOL];
    const dx = targetX - x;
    const dy = targetY - y;
    const angle = Math.atan2(dy, dx);
  let speed = spec?.speed ?? 2; // Base projectile speed (can be overridden by per-level scaling)
    const projectileImageKey = spec?.projectile ?? 'bullet_cyan';
  // Clone visual spec per spawn to avoid mutating shared objects (prevents red tint leaking to later shots)
  let projectileVisual = spec?.projectileVisual ? { ...(spec.projectileVisual as any) } : { type: 'bullet', color: '#0ff', size: 6 };

  let b: Bullet | undefined = this.bulletPool.pop(); // Try to get from pool
  if (b) this.resetPooledBullet(b);

    if (!b) {
      // If pool is empty, create a new one (should be rare if initialPoolSize is sufficient)
      b = { x: 0, y: 0, vx: 0, vy: 0, radius: 0, life: 0, active: false, damage: 0, weaponType: WeaponType.PISTOL } as Bullet;
    }

  // Reset and initialize bullet properties
    b.x = x;
    b.y = y;
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
    // For Scrap Lash, cache a per-shot base speed to avoid ratcheting when returning/relaunching
    if (weapon === WeaponType.SCRAP_LASH) {
      (b as any)._lashBaseSpeed = speed;
      const m = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / m) * (b as any)._lashBaseSpeed;
      b.vy = (b.vy / m) * (b as any)._lashBaseSpeed;
    }
  // Assign unique id for this spawn (used to scope Neural Threads per-shot)
  (b as any)._id = this.nextBulletId++;
  (b as any)._spawnTime = performance.now(); // record spawn timestamp for time-based visuals
  // Clear pooled explosion / lifetime state
  (b as any)._exploded = false;
  (b as any)._explosionStartTime = undefined;
  (b as any)._maxExplosionDuration = undefined;
  // Clear any prior volley flags or runtime speed boost carried from pool
  (b as any)._isVolley = undefined;
  (b as any).volleySpeedBoost = undefined;
  b.lifeMs = undefined as any; // will be recalculated in update
  b.radius = projectileVisual.size ?? 6; // Ensure radius matches the new visual size
    // Derive life from weapon range if available: life (frames) = range / speed.
    // Clamp to avoid extremely long-lived projectiles; fallback to 60 if insufficient data.
  let appliedDamage = spec?.damage ?? damage;
    let appliedCooldown = spec?.cooldown ?? 10;
    // Apply per-level scaling if function present
    if (spec?.getLevelStats) {
      const scaled = spec.getLevelStats(level);
  if (scaled.damage != null) appliedDamage = scaled.damage;
      if (scaled.cooldown != null) appliedCooldown = scaled.cooldown;
      if (scaled.speed != null) speed = scaled.speed; // per-level projectile speed
      if (scaled.projectileSize != null) {
        // Clone to avoid mutating shared spec reference for future bullets
        projectileVisual = { ...projectileVisual, size: scaled.projectileSize };
      }
      if ((scaled as any).turnRate != null) (b as any).turnRate = (scaled as any).turnRate;
      // Propagate beam/laser length & thickness scaling into the visual if present
      if ((scaled as any).length != null) {
        projectileVisual = { ...projectileVisual, length: (scaled as any).length } as any;
      }
      if ((scaled as any).thickness != null) {
        projectileVisual = { ...projectileVisual, thickness: (scaled as any).thickness } as any;
      }
      // Psionic Wave: add innate pierce from scaling table
      if (weapon === WeaponType.PSIONIC_WAVE && (scaled as any).pierce != null) {
        const basePierce = b.pierceRemaining != null ? b.pierceRemaining : 0;
        b.pierceRemaining = basePierce + (scaled as any).pierce;
      }
      // Propagate scaled explosion radius if provided by the weapon at this level
      if ((scaled as any).explosionRadius != null) {
        (b as any).explosionRadius = (scaled as any).explosionRadius;
      }
      // Ensure initial velocity matches the finalized per-level speed to keep range consistent
      if (weapon !== WeaponType.SCRAP_LASH && typeof speed === 'number' && speed > 0) {
        const m0 = Math.hypot(b.vx, b.vy) || 1;
        if (Math.abs(m0 - speed) > 1e-3) {
          b.vx = (b.vx / m0) * speed;
          b.vy = (b.vy / m0) * speed;
        }
      }
    }

    // Slight pellet radius bump for Shotgun to reduce near-miss feel on clustered targets
    if (weapon === WeaponType.SHOTGUN) {
      b.radius = Math.max(b.radius || 0, 9);
    }

  // Range & lifetime derivation (gentler compression of very large ranges)
  // Compute using the finalized current speed magnitude to keep distance consistent even if angle/velocity changed above.
  if (spec && typeof spec.range === 'number') {
      const baseRange = spec.range;
      let scaledRange = baseRange;
      // Only compress if above thresholds so short-range weapons keep identity
      if (baseRange > 900) {
        scaledRange = 900 + (baseRange - 900) * 0.85; // retain 85% beyond 900
      } else if (baseRange > 600) {
        scaledRange = 600 + (baseRange - 600) * 0.9; // retain 90% 600-900
      } else if (baseRange > 300) {
        scaledRange = 300 + (baseRange - 300) * 0.95; // retain 95% 300-600
      }
      // Fortress stance: extend projectile range while braced (Titan Mech)
      try {
        const pAny: any = this.player as any;
        if (pAny && pAny.getGlobalRangeMultiplier) {
          const rm = pAny.getGlobalRangeMultiplier();
          if (rm && rm !== 1) scaledRange *= rm;
        }
      } catch { /* ignore */ }
  // Removed former global +30% range boost (scaledRange *= 1.3) to tighten overall projectile ranges
  const curSpeedForLife = Math.max(0.0001, Math.hypot(b.vx, b.vy));
  const rawLife = scaledRange / curSpeedForLife;
      b.life = Math.min(Math.max(Math.round(rawLife), 8), 624); // 480 * 1.3 proportional cap
      b.startX = x;
      b.startY = y;
      b.maxDistanceSq = scaledRange * scaledRange;
    } else {
      b.life = spec?.lifetime ?? 60;
    }
    b.active = true;
  b.damage = appliedDamage; // leveled damage
    b.weaponType = weapon;
  (b as any).level = level; // persist level on the bullet for per-shot logic
    // Persist per-level base speed for Scrap Lash so the return phase and rethrows never scale from prior speed
    if (weapon === WeaponType.SCRAP_LASH) {
      const specL: any = (WEAPON_SPECS as any)[WeaponType.SCRAP_LASH];
      try {
        const scaled = specL?.getLevelStats ? specL.getLevelStats(level) : undefined;
        const lashSpeed = (scaled && typeof scaled.speed === 'number')
          ? scaled.speed
          : ((specL?.speed ?? Math.hypot(b.vx, b.vy)) || 8);
        (b as any)._lashBaseSpeed = lashSpeed;
        // Normalize initial velocity strictly to lashSpeed to avoid inheriting any prior pooled magnitude
        const m = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / m) * lashSpeed;
        b.vy = (b.vy / m) * lashSpeed;
      } catch { /* ignore */ }
    }
    b.projectileImageKey = projectileImageKey;
    // If Heavy Gunner boost is active, tint bullets slightly more red
    try {
      const p: any = this.player as any;
      if (p?.characterData?.id === 'heavy_gunner' && p.gunnerBoostActive && projectileVisual) {
        const vis: any = { ...projectileVisual };
        // shift toward red without losing bullet identity
        if (!vis.color || typeof vis.color !== 'string') vis.color = '#ff9a66';
        vis.color = '#ff6b4a';
        vis.glowColor = '#ff3b2a';
        vis.glowRadius = Math.max(vis.glowRadius || 6, 8);
        vis.trailColor = 'rgba(255,80,50,0.20)';
        vis.trailLength = Math.max(vis.trailLength || 6, 8);
        projectileVisual = vis;
      }
    } catch { /* ignore */ }
  // Ensure a very subtle trail on small bullets if none present (skip if pistol defines its own)
  if (projectileVisual && !(projectileVisual as any).trailColor) {
      const isPistol = weapon === WeaponType.PISTOL;
      (projectileVisual as any).trailColor = isPistol ? 'rgba(180,255,255,0.18)' : 'rgba(255,255,255,0.10)';
      (projectileVisual as any).trailLength = Math.max((projectileVisual as any).trailLength || 0, isPistol ? 12 : 6);
    }
    b.projectileVisual = projectileVisual;
  // Psionic Wave harmonic echo: every 3rd primary cast only (skip during secondary lanes or echo itself)
  if (weapon === WeaponType.PSIONIC_WAVE && !this.suppressWeaverSecondary && !this.suppressPsionicEcho) {
      try {
        const key = '__psionicEchoCounter';
        const gp: any = (window as any);
        gp[key] = (gp[key] || 0) + 1;
        if (gp[key] >= 3) {
          gp[key] = 0; // reset
          const delay = 150;
          const srcX = x, srcY = y, tX = targetX, tY = targetY, lvl = level;
          const baseD = Math.round((damage || appliedDamage) * 0.60);
          const start = performance.now();
          const schedule = () => {
            if (performance.now() - start >= delay) {
        // Prevent echo from spawning more echoes or lattice secondaries
        const prevEcho = this.suppressPsionicEcho;
        const prevSec = this.suppressWeaverSecondary;
        this.suppressPsionicEcho = true;
        this.suppressWeaverSecondary = true;
        const echo = this.spawnBullet(srcX, srcY, tX, tY, WeaponType.PSIONIC_WAVE, baseD, lvl);
        this.suppressWeaverSecondary = prevSec;
        this.suppressPsionicEcho = prevEcho;
              if (echo && echo.projectileVisual) {
                const vis: any = { ...(echo.projectileVisual as any) };
                if (vis.thickness != null) vis.thickness = Math.max(6, Math.round(vis.thickness * 0.75));
                vis.glowRadius = Math.max((vis.glowRadius||20) * 0.75, 16);
                echo.projectileVisual = vis;
              }
            } else {
              requestAnimationFrame(schedule);
            }
          };
          requestAnimationFrame(schedule);
        }
      } catch { /* ignore */ }
    }
  if ((spec as any).explosionRadius) (b as any).explosionRadius = (spec as any).explosionRadius;
    b.snakeTargets = undefined; // Clear previous snake targets    b.snakeBounceCount = undefined; // Clear previous bounce count
  // Reset pierce/trail state from any prior usage in pool
  b.pierceRemaining = undefined;
  b.trail = undefined;
  b.hitIds = b.hitIds ? (b.hitIds.length = 0, b.hitIds) : []; // clear or create hit list
  b.targetId = undefined;
    if (weapon === WeaponType.PLASMA) {
      b.phase = 'CHARGING';
      (b as any).chargeT = 0;
      // Zero velocity during charge; direction stored in vx/vy after travel begins
      // Keep initial direction so we can offset orb along aim while charging
      (b as any)._initialAngle = angle;
      b.vx = Math.cos(angle) * 0.0001; // tiny epsilon to preserve angle
      b.vy = Math.sin(angle) * 0.0001;
  // Override position to player's current live position (anchor) ignoring provided x,y to prevent fixed remote spawn
  if (this.player) { b.x = this.player.x; b.y = this.player.y; b.startX = this.player.x; b.startY = this.player.y; }
      try { const spec:any = (WEAPON_SPECS as any)[WeaponType.PLASMA]; const p:any=this.player; const add=spec?.heatPerShot||0.25; p.plasmaHeat = Math.min(1,(p.plasmaHeat||0)+add); } catch {}
    }
    // Ricochet bounce initialization (level-scaled)
    if (weapon === WeaponType.RICOCHET) {
      let bounceCount = 3;
      if (spec?.getLevelStats) {
        const scaled = spec.getLevelStats(level);
        if ((scaled as any).bounces != null) bounceCount = (scaled as any).bounces;
      }
      (b as any).bouncesRemaining = bounceCount;
    }
    // Serpent Chain: initialize bounce count, ramp, and finisher parameters
    if (weapon === WeaponType.SERPENT_CHAIN) {
      try {
        const scaled: any = spec?.getLevelStats ? spec.getLevelStats(level) : {};
        (b as any).bouncesRemaining = (scaled?.bounces != null) ? scaled.bounces : 9;
        (b as any)._serpRamp = (scaled?.ramp != null) ? scaled.ramp : 0.10;
        (b as any)._serpFinisher = (scaled?.finisherFrac != null) ? scaled.finisherFrac : 1.20;
        (b as any)._serpBaseDamage = b.damage;
        (b as any)._serpHits = 0;
        (b as any)._serpDidFinisher = false;
      } catch {
        (b as any).bouncesRemaining = 9; (b as any)._serpRamp = 0.10; (b as any)._serpFinisher = 1.20; (b as any)._serpBaseDamage = b.damage; (b as any)._serpHits = 0; (b as any)._serpDidFinisher = false;
      }
    }
    // Psionic Wave: add level-based ricochet bounces (L1=1, +1 per level)
    if (weapon === WeaponType.PSIONIC_WAVE) {
      try {
        const scaled = spec?.getLevelStats ? spec.getLevelStats(level) : {} as any;
        const base = (scaled as any).bounces;
        if (base != null) (b as any).bouncesRemaining = base;
        else (b as any).bouncesRemaining = Math.max(0, level);
      } catch { (b as any).bouncesRemaining = Math.max(0, level); }
    }
    // Give Triple Crossbow a single pierce (hit 2 targets total)
    if (weapon === WeaponType.TRI_SHOT) {
      // Level-based pierce (scaled.pierce already represents remaining extra targets after first)
      if (spec?.getLevelStats) {
        const scaled = spec.getLevelStats(level);
        if ((scaled as any).pierce != null) b.pierceRemaining = (scaled as any).pierce;
        else b.pierceRemaining = 1;
      } else b.pierceRemaining = 1;
      if (!b.projectileVisual) b.projectileVisual = { type: 'bullet', color: '#FFFFFF', size: b.radius };
      // Ensure a subtle trail if not defined
      if (!(b.projectileVisual as any).trailColor) {
        (b.projectileVisual as any).trailColor = 'rgba(255,210,110,0.35)';
        (b.projectileVisual as any).trailLength = 22;
      }
    }
    // Basic Pistol: set level-based pierce from spec
    if (weapon === WeaponType.PISTOL) {
      try {
        const scaled = spec?.getLevelStats ? spec.getLevelStats(level) : {} as any;
        const basePierce = (scaled as any).pierce ?? 0;
        if (basePierce > 0) b.pierceRemaining = (b.pierceRemaining || 0) + basePierce;
  } catch { /* ignore */ }
  finally { this.suppressWeaverSecondary = false; }
    }
    // Passive-based piercing fallback (disabled for Smart Rifle)
    {
      const passivePierceLevel: number | undefined = (this.player as any)?.piercing;
      if (weapon !== WeaponType.RAPID && passivePierceLevel && passivePierceLevel > 0) {
        const basePierce = b.pierceRemaining != null ? b.pierceRemaining : 0;
        b.pierceRemaining = basePierce + passivePierceLevel;
      }
    }
    // Smart Rifle initial target lock (toughest enemy: highest maxHp (fallback hp); tie -> lowest current hp)
    if (weapon === WeaponType.RAPID) {
      // Ensure no piercing is ever applied
      b.pierceRemaining = 0;
      const lock = this.selectSmartRifleTarget(targetX, targetY, 900);
      if (lock) {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && lock === boss) b.targetId = 'boss';
        else b.targetId = (lock as any).id || (lock as any)._gid;
      }
      (b as any).turnRate = (b as any).turnRate || 0.07;
    }
    // Neural Threader: allow multiple pierces to gather anchors; no hard bounces
    if (weapon === WeaponType.NOMAD_NEURAL) {
      try {
        const specNom: any = (WEAPON_SPECS as any)[WeaponType.NOMAD_NEURAL];
        const scaled = specNom?.getLevelStats ? specNom.getLevelStats(level) : { anchors: 2 };
        // Allow at least anchors hits; Overmind may add +1 temporarily during pulses
        b.pierceRemaining = Math.max(0, (scaled.anchors || 2) - 1);
        // Make sure the visual reads teal/cyan distinctly
        if (b.projectileVisual) {
          const vis: any = { ...b.projectileVisual };
          vis.color = '#26ffe9';
          vis.glowColor = '#26ffe9';
          vis.glowRadius = Math.max(vis.glowRadius || 8, 10);
          vis.trailColor = 'rgba(38,255,233,0.25)';
          vis.trailLength = Math.max((vis.trailLength || 10), 14);
          b.projectileVisual = vis;
        }
      } catch { /* ignore */ }
    }
    // Neural Nexus (evolved): allow multiple pierces to gather anchors; brighter visuals
    if (weapon === WeaponType.NEURAL_NEXUS) {
      try {
        const specNex: any = (WEAPON_SPECS as any)[WeaponType.NEURAL_NEXUS];
        const scaled = specNex?.getLevelStats ? specNex.getLevelStats(level) : { anchors: 10 };
        // Allow at least anchors hits; no temporary Overmind bonus on projectile itself
        b.pierceRemaining = Math.max(0, (scaled.anchors || 10) - 1);
        // Golden-cyan glow for evolved state
        if (b.projectileVisual) {
          const vis: any = { ...b.projectileVisual };
          vis.color = '#9ffcf6';
          vis.glowColor = '#ffe873';
          vis.glowRadius = Math.max(vis.glowRadius || 10, 14);
          vis.trailColor = 'rgba(159,252,246,0.30)';
          vis.trailLength = Math.max((vis.trailLength || 14), 18);
          b.projectileVisual = vis;
        }
      } catch { /* ignore */ }
    }
  // Bio Toxin: precompute puddle radius and lifetime based on level and area multiplier, and force no-impact behavior
    if (weapon === WeaponType.BIO_TOXIN || weapon === WeaponType.LIVING_SLUDGE) {
      try {
        const lvl = level || (b as any).level || 1;
        const baseR = 28, baseMs = 2600;
        const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
        (b as any).level = lvl;
        (b as any).puddleRadius = (baseR + (lvl - 1) * 3) * (areaMul || 1);
        (b as any).puddleLifeMs = baseMs + (lvl - 1) * 200;
    // Ensure Bio Toxin projectiles never deal direct impact damage nor pierce
    b.damage = 0;
    b.pierceRemaining = 0;
        // Visuals: slimy/gummy look for both, sludge brighter
        if (b.projectileVisual) {
          const vis: any = { ...b.projectileVisual };
          vis.type = 'slime';
          vis.size = Math.max(vis.size || 0, weapon === WeaponType.LIVING_SLUDGE ? 11 : 9);
          // Consistent bio neon palette (toxic green)
          if (weapon === WeaponType.LIVING_SLUDGE) {
            vis.color = '#7CFF5E'; vis.glowColor = '#B6FF00'; vis.glowRadius = Math.max(vis.glowRadius||0, 16);
          } else {
            vis.color = '#77FF66'; vis.glowColor = '#B6FF00'; vis.glowRadius = Math.max(vis.glowRadius||0, 12);
          }
          b.projectileVisual = vis;
        }
        // Seed wobble uniqueness
        (b as any)._slimeSeed = Math.random() * 1000;
        // Spawn a tiny splat particle burst on cast
        try { this.particleManager?.spawn(b.x, b.y, 6, '#B6FF00', { sizeMin: 0.8, sizeMax: 2.2, lifeMs: 340, speedMin: 0.6, speedMax: 2.0 }); } catch {}
      } catch { /* ignore */ }
    }
  // Psionic Wave: during Weaver Lattice, emit symmetric faint secondary waves to form a fuller weave pattern
  if (weapon === WeaponType.PSIONIC_WAVE && !this.suppressWeaverSecondary) {
      try {
        const until = (window as any).__weaverLatticeActiveUntil || 0;
        if (until > performance.now()) {
    // Adaptive emission based on frame time
    const avgMs = (window as any).__avgFrameMs || 16;
    const highLoad = avgMs > 40; const severeLoad = avgMs > 55;
      // prevent nested secondary emissions and echo scheduling inside secondaries
      const prevSec = this.suppressWeaverSecondary;
      const prevEcho = this.suppressPsionicEcho;
      this.suppressWeaverSecondary = true;
      this.suppressPsionicEcho = true;
          const baseAngle = Math.atan2(targetY - y, targetX - x);
          const len = 320; // a bit longer for epic feel
      const angleOffset = severeLoad ? 0.12 : highLoad ? 0.15 : 0.18; // reduce fan under load
      const lateral = severeLoad ? 18 : highLoad ? 24 : 30;       // inner lanes
    const lanesOuter = severeLoad ? 0 : highLoad ? 1 : 2; // reduce outer pair count under load
          // Left lane
          {
            const ox = x + Math.cos(baseAngle + Math.PI/2) * -lateral;
            const oy = y + Math.sin(baseAngle + Math.PI/2) * -lateral;
            const a2 = baseAngle - angleOffset;
            const tx = ox + Math.cos(a2) * len;
            const ty = oy + Math.sin(a2) * len;
            const bL = this.spawnBullet(ox, oy, tx, ty, weapon, Math.round(damage * 0.6), level);
            if (bL) {
              const vis: any = bL.projectileVisual || {};
              if (vis) {
                if (vis.thickness != null) vis.thickness = Math.max(severeLoad?4:6, Math.round((vis.thickness) * (severeLoad?0.65: highLoad?0.75:0.8)));
                vis.glowRadius = Math.max(severeLoad?10:14, (vis.glowRadius || 24) * (severeLoad?0.6: highLoad?0.7:0.8));
                if (vis.thickness == null) vis.thickness = 10; // ensure non-zero thickness for collision
                bL.projectileVisual = vis;
              }
              bL.weaponType = WeaponType.PSIONIC_WAVE; // keep type for collision rules
            }
          }
          // Right lane
          {
            const ox = x + Math.cos(baseAngle + Math.PI/2) * lateral;
            const oy = y + Math.sin(baseAngle + Math.PI/2) * lateral;
            const a2 = baseAngle + angleOffset;
            const tx = ox + Math.cos(a2) * len;
            const ty = oy + Math.sin(a2) * len;
            const bR = this.spawnBullet(ox, oy, tx, ty, weapon, Math.round(damage * 0.6), level);
            if (bR) {
              const vis: any = bR.projectileVisual || {};
              if (vis) {
                if (vis.thickness != null) vis.thickness = Math.max(severeLoad?4:6, Math.round((vis.thickness) * (severeLoad?0.65: highLoad?0.75:0.8)));
                vis.glowRadius = Math.max(severeLoad?10:14, (vis.glowRadius || 24) * (severeLoad?0.6: highLoad?0.7:0.8));
                if (vis.thickness == null) vis.thickness = 10;
                bR.projectileVisual = vis;
              }
              bR.weaponType = WeaponType.PSIONIC_WAVE;
            }
          }
          // Outer lanes (gated by load)
          const lateralOuter = lateral + 38;
          const angleOuter = angleOffset * 1.25;
          if (lanesOuter >= 1) {
            // Left outer lane
            {
            const ox = x + Math.cos(baseAngle + Math.PI/2) * -lateralOuter;
            const oy = y + Math.sin(baseAngle + Math.PI/2) * -lateralOuter;
            const a2 = baseAngle - angleOuter;
            const tx = ox + Math.cos(a2) * (len + 40);
            const ty = oy + Math.sin(a2) * (len + 40);
            const bL2 = this.spawnBullet(ox, oy, tx, ty, weapon, Math.round(damage * 0.45), level);
            if (bL2) {
              const vis: any = bL2.projectileVisual || {};
              if (vis) {
                if (vis.thickness != null) vis.thickness = Math.max(severeLoad?3:5, Math.round((vis.thickness) * (severeLoad?0.55: highLoad?0.65:0.75)));
                vis.glowRadius = Math.max(severeLoad?8:12, (vis.glowRadius || 24) * (severeLoad?0.5: highLoad?0.6:0.75));
                if (vis.thickness == null) vis.thickness = 9;
                bL2.projectileVisual = vis;
              }
              bL2.weaponType = WeaponType.PSIONIC_WAVE;
            }
            }
          }
          if (lanesOuter >= 2) {
            // Right outer lane
            {
            const ox = x + Math.cos(baseAngle + Math.PI/2) * lateralOuter;
            const oy = y + Math.sin(baseAngle + Math.PI/2) * lateralOuter;
            const a2 = baseAngle + angleOuter;
            const tx = ox + Math.cos(a2) * (len + 40);
            const ty = oy + Math.sin(a2) * (len + 40);
            const bR2 = this.spawnBullet(ox, oy, tx, ty, weapon, Math.round(damage * 0.45), level);
            if (bR2) {
              const vis: any = bR2.projectileVisual || {};
              if (vis) {
                if (vis.thickness != null) vis.thickness = Math.max(severeLoad?3:5, Math.round((vis.thickness) * (severeLoad?0.55: highLoad?0.65:0.75)));
                vis.glowRadius = Math.max(severeLoad?8:12, (vis.glowRadius || 24) * (severeLoad?0.5: highLoad?0.6:0.75));
                if (vis.thickness == null) vis.thickness = 9;
                bR2.projectileVisual = vis;
              }
              bR2.weaponType = WeaponType.PSIONIC_WAVE;
            }
            }
          }
          // restore guards
          this.suppressWeaverSecondary = prevSec;
          this.suppressPsionicEcho = prevEcho;
        }
      } catch { /* ignore */ }
    }
    // Kamikaze Drone special phased behavior
    if (weapon === WeaponType.HOMING) {
      b.phase = 'ASCEND';
      b.phaseStartTime = performance.now();
  (b as any).spawnTime = b.phaseStartTime; // track total sequence timing
      b.orbitAngle = Math.random() * Math.PI * 2;
      b.orbitRadius = 0; // start at player center then expand outward
      b.altitudeScale = 0.18; // small but readable on spawn
      b.searchCooldownMs = 250; // search cluster every 250ms
  (b as any)._hoverSeed = Math.random() * Math.PI * 2; // personalize hover breathing
      // Center over player if available
      const pl = this.player;
  if (pl) { b.x = pl.x; b.y = pl.y; b.startX = pl.x; b.startY = pl.y; (b as any).spawnCenterX = pl.x; (b as any).spawnCenterY = pl.y; }
      // Neutralize initial velocity (we'll control manually)
      b.vx = 0; b.vy = 0;
      // Override lifetime/range so drone can finish full ascent & dive (at least 6s)
  b.life = 3600; // legacy frames (~60s) generous hover budget
  b.lifeMs = 60000; // ms lifetime explicit to support long idle hovers
      b.maxDistanceSq = 999999999; // effectively disable range cap for drone
    }
    // Tachyon/Singularity Spear special setup: heavy pierce, laser trail visuals
    if (weapon === WeaponType.TACHYON_SPEAR || weapon === WeaponType.SINGULARITY_SPEAR) {
      // Generous pierce to feel like a dash-lance
      b.pierceRemaining = 999;
      // Ensure laser visuals have a visible wake
      const vis: any = b.projectileVisual || {};
  if (!vis.trailColor) vis.trailColor = (weapon === WeaponType.SINGULARITY_SPEAR) ? 'rgba(201,166,255,0.45)' : 'rgba(0,200,255,0.45)';
      if (!vis.trailLength) vis.trailLength = 34;
      // If this is a charged volley spear, tint to glowing dark red (per-bullet clone)
      if ((b as any)._isVolley) {
        // Charged volley: brighter cyan tip with stronger glow
        vis.color = '#33E0FF';
        vis.glowColor = '#99F0FF';
        vis.glowRadius = Math.max(vis.glowRadius || 18, 24);
        vis.trailColor = 'rgba(51,224,255,0.55)';
      }
      b.projectileVisual = vis;
      // Slightly increase collision radius to help fast spear connect
      b.radius = Math.max(b.radius || 6, (vis.thickness || 4) * 0.75);
    }
    // Evolution: Industrial Grinder – spawn as orbiting bullet with finite duration
    if (weapon === WeaponType.INDUSTRIAL_GRINDER) {
      const spec: any = (WEAPON_SPECS as any)[WeaponType.INDUSTRIAL_GRINDER];
      const scaled = spec?.getLevelStats ? spec.getLevelStats(level) : {};
  b.isOrbiting = true; (b as any).orbitKind = 'GRINDER'; (b as any).level = level; b.orbitIndex = 0; b.orbitCount = 1; b.orbitAngle = Math.random()*Math.PI*2; b.spinSpeed = 4.2;
  (b as any).visualLock = 'GRINDER';
      (b as any).endTime = performance.now() + (scaled.durationMs || 1200);
      b.contactCooldownMap = {};
      // Position initially at radius
      b.x = this.player.x + Math.cos(b.orbitAngle||0) * (scaled.orbitRadius || 140);
      b.y = this.player.y + Math.sin(b.orbitAngle||0) * (scaled.orbitRadius || 140);
      b.lifeMs = scaled.durationMs || 1200;
      b.damage = scaled.damage || b.damage;
    }

    this.bullets.push(b);
  // Tech Warrior meter increment is handled in Player.shoot path to avoid double counting
    return b;
  }
}
