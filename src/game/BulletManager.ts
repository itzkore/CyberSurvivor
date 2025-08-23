import type { Bullet } from './Bullet';
import { Player } from './Player';
import { WEAPON_SPECS } from './WeaponConfig';
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
  // Guard to prevent recursive lattice secondary spawns from re-entering spawnBullet
  private suppressWeaverSecondary: boolean = false;
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
    ownerId: number; // id of the spawning bullet to keep threads isolated
  }> = [];

  constructor(assetLoader: AssetLoader, enemySpatialGrid: SpatialGrid<Enemy>, particleManager: ParticleManager, enemyManager: EnemyManager, player: Player) {
    this.assetLoader = assetLoader;
    this.enemySpatialGrid = enemySpatialGrid; // Assign spatial grid
    this.particleManager = particleManager; // Assign particle manager
    this.enemyManager = enemyManager; // Assign enemy manager
    this.player = player;
    this.preallocateBullets();
    // One-shot Overmind Overload: detonate all neural threads with amplified burst, then clear
    try {
      window.addEventListener('nomadOverload', ((ev: any) => {
        const mult = ev?.detail?.multiplier || 1.5;
        this.handleNomadOverload(mult);
      }) as EventListener);
    } catch { /* ignore */ }
  }
  /** Spawn a radial shrapnel burst for Scrap-Saw. Uses simple small bullets with short/medium range.
   *  Optional range/speed let callers align with the triggering explosion/sweep radius.
   */
  private spawnShrapnelBurst(cx: number, cy: number, count: number, damage: number, range: number = 220, speed: number = 9.5) {
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.2 - 0.1;
      const tx = cx + Math.cos(ang) * 40;
      const ty = cy + Math.sin(ang) * 40;
      const b: Bullet = this.bulletPool.pop() || { x: cx, y: cy, vx: 0, vy: 0, radius: 4, life: 0, active: false, damage, weaponType: WeaponType.SCRAP_SAW } as Bullet;
      b.x = cx; b.y = cy;
      const dx = tx - cx, dy = ty - cy; const d = Math.hypot(dx, dy) || 1; b.vx = (dx/d) * speed; b.vy = (dy/d) * speed;
      b.radius = 4; b.active = true; b.weaponType = WeaponType.SCRAP_SAW; b.damage = damage;
      b.life = Math.ceil((range / speed)); // frames approximation, converted later
      b.lifeMs = (range / (speed * 60)) * 1000; // ms life for consistency
      b.projectileVisual = { type: 'bullet', color: '#C0C0C0', size: 4, glowColor: '#FFE28A', glowRadius: 6 } as any;
      this.bullets.push(b);
    }
  }

  /** Public: spawn Scrap shrapnel with explicit radius/speed tuning. */
  public spawnScrapShrapnel(cx: number, cy: number, count: number, damage: number, range: number, speed: number = 9.5) {
    this.spawnShrapnelBurst(cx, cy, count, damage, range, speed);
  }

  /** Ensure Quantum Halo orbit bullets exist & reflect current player weapon level. */
  private ensureQuantumHaloOrbs(deltaTime:number){
    const player: any = this.player; if (!player || !player.activeWeapons) return;
    const level = player.activeWeapons.get(WeaponType.QUANTUM_HALO); if (!level) return;
    const spec: any = (WEAPON_SPECS as any)[WeaponType.QUANTUM_HALO]; if (!spec) return;
    const scaled = spec.getLevelStats ? spec.getLevelStats(level) : {};
                const needed = scaled.orbCount || 1; // Ensure we have the correct number of orbs
    const current = this.bullets.filter(b => b.active && b.isOrbiting && b.weaponType === WeaponType.QUANTUM_HALO);
    if (current.length !== needed) {
      // Deactivate extras
      if (current.length > needed) {
        let removed = 0; 
        for (let i = 0; i < current.length && removed < current.length - needed; i++) { 
          current[i].active = false; 
          removed++; 
        }
      } else {
        // Spawn missing
        for (let i = current.length; i < needed; i++) {
          const b: Bullet = this.bulletPool.pop() || { 
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
          b.x = player.x; 
          b.y = player.y; 
          b.vx = 0; 
          b.vy = 0; 
          b.damage = scaled.damage || 22; 
          b.weaponType = WeaponType.QUANTUM_HALO; 
          b.active = true; 
          b.isOrbiting = true; 
          (b as any).level = level;
          b.orbitIndex = i; 
          b.orbitCount = needed; 
          b.orbitRadiusBase = scaled.orbitRadius || 90; 
          b.spinSpeed = scaled.spinSpeed || 1; 
          b.angleOffset = (Math.PI * 2 * i) / needed; 
          b.orbitAngle = b.angleOffset; 
          b.projectileVisual = { ...(spec.projectileVisual || {}), size: (spec?.projectileVisual?.size || 12) }; 
          b.contactCooldownMap = {};
          this.bullets.push(b);
        }
      }
      // Reassign indices & offsets to all halo bullets for even distribution
      const halos = this.bullets.filter(b => b.active && b.isOrbiting && b.weaponType === WeaponType.QUANTUM_HALO);
      halos.sort((a, b) => (a.orbitIndex || 0) - (b.orbitIndex || 0));
      for (let i = 0; i < halos.length; i++) { 
        const hb = halos[i]; 
        hb.orbitIndex = i; 
        hb.orbitCount = halos.length; 
        hb.angleOffset = (Math.PI * 2 * i) / halos.length; 
        hb.orbitAngle = hb.angleOffset; 
      }
    } else {
      // Update damage/spin if level changed (level kept in b.level)
      for (const hb of current) { 
        hb.damage = scaled.damage || hb.damage; 
        hb.spinSpeed = scaled.spinSpeed || hb.spinSpeed; 
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
  // Update any active Grinder (evolved scavenger) orbit sessions: store as bullets with isOrbiting=true and a finite duration
  // They reuse the Quantum Halo path but expire by endTime.
    const activeBullets: Bullet[] = [];
  const camX = (window as any).__camX || 0;
  const camY = (window as any).__camY || 0;
  const viewW = (window as any).__designWidth || 1920;
  const viewH = (window as any).__designHeight || 1080;
  const pad = 256; // retain bullets slightly offscreen
  const minX = camX - pad, maxX = camX + viewW + pad;
  const minY = camY - pad, maxY = camY + viewH + pad;
  for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.active) {
        this.bulletPool.push(b); // Return to pool if inactive
        continue;
      }

      // Quantum Halo / Grinder orbit handling: position bound to player each frame; no standard movement or life decay
      if (b.isOrbiting && (b.weaponType === WeaponType.QUANTUM_HALO || b.weaponType === WeaponType.INDUSTRIAL_GRINDER)) {
  const spec: any = (WEAPON_SPECS as any)[WeaponType.QUANTUM_HALO];
  const isGrinder = b.weaponType === WeaponType.INDUSTRIAL_GRINDER;
  const grinderSpec: any = isGrinder ? (WEAPON_SPECS as any)[WeaponType.INDUSTRIAL_GRINDER] : null;
  const level = (b as any).level || 1;
  const scaled = isGrinder ? (grinderSpec?.getLevelStats ? grinderSpec.getLevelStats(level) : {}) : (spec?.getLevelStats ? spec.getLevelStats(level) : {});
  const playerRef = this.player;
  // Unified clockwise rotation (canvas Y axis down -> positive angle is clockwise on screen)
  const spinBase = isGrinder ? 4.2 : (b.spinSpeed || scaled.spinSpeed || 1);
  const spin = spinBase * (deltaTime/1000);
  b.orbitAngle = (b.orbitAngle || (b.angleOffset||0)) + spin;
        // Expire grinder after duration
        if (isGrinder) {
          const nowT = performance.now();
          if ((b as any).endTime && nowT >= (b as any).endTime) { b.active = false; this.bulletPool.push(b); continue; }
        }
        // Wrap angle and detect full rotation for pulse
        if (b.orbitAngle > Math.PI*2) {
          b.orbitAngle -= Math.PI*2;
          // Pulse only once per full ring (index 0 triggers)
          if (!isGrinder && b.orbitIndex === 0 && scaled.pulseDamage > 0) {
            window.dispatchEvent(new CustomEvent('quantumHaloPulse', { detail: { x: playerRef.x, y: playerRef.y, damage: scaled.pulseDamage, radius: scaled.orbitRadius + 40 } }));
          }
        }
  const radius = (isGrinder ? (scaled.orbitRadius || 140) : (scaled.orbitRadius || 90)); // uniform radius (no breathing)
  const angleTotal = b.orbitAngle; // already includes offset
  b.x = playerRef.x + Math.cos(angleTotal) * radius;
  b.y = playerRef.y + Math.sin(angleTotal) * radius;
  // Fixed size (no shimmer)
  const sizeBase = isGrinder ? 14 : (spec?.projectileVisual?.size || 12);
  b.radius = sizeBase;
  // Dynamic hue (assign to projectileVisual for render gradient)
  const hue = (performance.now()*0.05 + (b.orbitIndex||0)*70) % 360;
  if (!b.projectileVisual) b.projectileVisual = { type:'plasma', size: b.radius } as any;
  (b.projectileVisual as any)._dynamicHue = hue;
  // Trail disabled for Quantum Halo (no accumulation)
        b.lifeMs = isGrinder ? Math.max(1, (((b as any).endTime||0) - performance.now())) : 9999999; // keep alive or finite
        // Collision pass (contact damage with per-enemy cooldown)
  // Query small area (precise hit window)
  const potential = this.enemySpatialGrid.query(b.x, b.y, Math.max(28, b.radius + 8));
        if (!b.contactCooldownMap) b.contactCooldownMap = {};
        const nowT = performance.now();
        for (let ei=0; ei<potential.length; ei++){
          const e = potential[ei]; if (!e.active || e.hp<=0) continue;
          const dxE = e.x - b.x; const dyE = e.y - b.y; const rs = (e.radius||16) + (b.radius*0.55); // smaller effective area
          if (dxE*dxE + dyE*dyE <= rs*rs){
            const eid = (e as any).id || (e as any)._gid || 'e'+ei;
            const nextOk = b.contactCooldownMap[eid] || 0;
            if (nowT >= nextOk){
              const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.10); }
              const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
              const baseDmg = isGrinder ? ((grinderSpec?.getLevelStats ? grinderSpec.getLevelStats(level).damage : (b.damage||20))) : (b.damage||scaled.damage||20);
              const dmgBase = baseDmg * (isCrit?critMult:1);
              // Apply damage; EnemyManager will derive knockback from weapon spec
              this.enemyManager.takeDamage(e, dmgBase, isCrit, false, b.weaponType, b.x, b.y, level);
              b.contactCooldownMap[eid] = nowT + (isGrinder ? 160 : 1000); // grinder multi-ticks fast; halo 1s per-enemy
              if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, '#7DFFEA');
            }
          }
        }
        // Boss contact: explicit check (boss not in enemy spatial grid). Uses same cooldown as enemies, with key 'boss'.
        {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
          if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
            const dxB = boss.x - b.x; const dyB = boss.y - b.y;
            const rsB = (boss.radius || 160) + (b.radius * 0.55);
            if (dxB*dxB + dyB*dyB <= rsB*rsB) {
              const key = 'boss';
              const nextOkB = b.contactCooldownMap[key] || 0;
              if (nowT >= nextOkB) {
                const p:any = this.player; let critChance=0.10; if (p){ const agi=p.agility||0; const luck=p.luck||0; critChance=Math.min(0.6,(agi*0.5+luck*0.7)/100 + 0.10); }
                const isCrit = Math.random() < critChance; const critMult = (p?.critMultiplier)||2.0;
                const baseDmg = isGrinder ? ((grinderSpec?.getLevelStats ? grinderSpec.getLevelStats(level).damage : (b.damage||20))) : (b.damage||scaled.damage||20);
                const dmgBase = baseDmg * (isCrit?critMult:1);
                if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                  (this.enemyManager as any).takeBossDamage(boss, dmgBase, isCrit, b.weaponType, b.x, b.y, level);
                } else {
                  boss.hp -= dmgBase;
                  window.dispatchEvent(new CustomEvent('bossHit', { detail: { damage: dmgBase, crit: isCrit, x: b.x, y: b.y } }));
                }
                b.contactCooldownMap[key] = nowT + (isGrinder ? 160 : 1000);
                if (this.particleManager) this.particleManager.spawn(boss.x, boss.y, 1, '#7DFFEA');
              }
            }
          }
        }
        activeBullets.push(b);
        continue; // skip generic processing
      }

  // Melee sweep (Scrap-Saw): ring-arc hitbox at blade distance + tether contact (half damage)
  if ((b as any).isMeleeSweep && b.weaponType === WeaponType.SCRAP_SAW) {
        const pl = this.player;
        const start = (b as any).sweepStart || performance.now();
        const dur = (b as any).sweepDurationMs || 200;
        const t = Math.min(1, (performance.now() - start) / dur);
        const arcRad = ((b as any).arcDegrees || 140) * Math.PI / 180;
        // Sweep from -arc/2 to +arc/2 relative to facing
        const baseAng = (b as any).baseAngle != null ? (b as any).baseAngle : Math.atan2(pl.vy || 0.0001, pl.vx || 1);
        const dir = (b as any).sweepDir || 1; // 1 or -1 alternating
        const curOffset = (t * arcRad - arcRad/2) * dir;
  const centerAng = baseAng + curOffset;
  (b as any).displayAngle = centerAng; // for sprite orientation
        // Position blade tip at reach distance; use as visual center, collision uses sector test
        const reach = (b as any).reach || (WEAPON_SPECS as any)[WeaponType.SCRAP_SAW]?.range || 120;
        const bladeThickness = (b as any).thickness || Math.max(18, Math.min(36, reach * 0.22)); // radial thickness around blade ring
        const angleBandScale = 0.5; // widen from 0.35 -> 0.5 for better feel
        b.x = pl.x + Math.cos(centerAng) * reach;
        b.y = pl.y + Math.sin(centerAng) * reach;
        // Collision: query nearby and sector test
        const potential = this.enemySpatialGrid.query(pl.x, pl.y, reach + 40);
        const nowT = performance.now();
        // One-hit-per-enemy per sweep: shared set for blade+tether
        if (!(b as any)._hitOnce) (b as any)._hitOnce = Object.create(null);
        const halfArc = arcRad/2;
        for (let i2=0;i2<potential.length;i2++){
          const e = potential[i2]; if (!e.active || e.hp<=0) continue;
          const dx = e.x - pl.x; const dy = e.y - pl.y;
          const dist = Math.hypot(dx, dy);
          if (dist > reach + (e.radius||16) + bladeThickness) continue;
          let ang = Math.atan2(dy, dx) - baseAng; // relative to facing
          // wrap to [-PI, PI]
          ang = (ang + Math.PI) % (Math.PI*2) - Math.PI;
          const withinAngle = Math.abs(ang - curOffset) <= halfArc * angleBandScale;
          const withinRing = Math.abs(dist - reach) <= (bladeThickness + (e.radius||16));
          const eid = (e as any).id || (e as any)._gid || 'e'+i2;
          // Skip if already hit by this sweep (blade or tether)
          if ((b as any)._hitOnce[eid]) continue;
          // Primary blade contact: ring-arc at blade distance
          if (withinAngle && withinRing) {
            const level = (b as any).level || 1; const critMult = (this.player as any).critMultiplier || 2.0; const isCrit = Math.random() < (((this.player as any).critBonus||0)+0.08);
            const dmg = (b.damage||32) * (isCrit ? critMult : 1);
            this.enemyManager.takeDamage(e, dmg, isCrit, false, WeaponType.SCRAP_SAW, pl.x, pl.y, level);
            // Mark as hit for this sweep
            (b as any)._hitOnce[eid] = 1;
            // Increment scrap meter per enemy hit; trigger secondary explosion at 10
            const triggered = (this.player as any).addScrapHits ? (this.player as any).addScrapHits(1) : false;
            if (triggered) {
              // Reworked Scrap ability: big explosion around player and heal 5 HP
              const reach2 = (b as any).reach || (WEAPON_SPECS as any)[WeaponType.SCRAP_SAW]?.range || 120;
              const radius2 = Math.max(200, Math.round(reach2 * 1.5));
              const dmgRef = b.damage || 20;
              try {
                window.dispatchEvent(new CustomEvent('scrapExplosion', { detail: { x: pl.x, y: pl.y, damage: Math.round(dmgRef*1.0), radius: radius2, color: '#FFAA33' } }));
              } catch {}
              // Heal player by 5 HP (clamped to max)
              (this.player as any).hp = Math.min((this.player as any).hp + 5, (this.player as any).maxHp || (this.player as any).hp);
            }
          }
          // Tether contact: segment from player to blade, half damage, separate cooldown
          // Compute shortest distance from enemy center to segment (pl -> blade)
          const ex = e.x, ey = e.y;
          const x1 = pl.x, y1 = pl.y, x2 = b.x, y2 = b.y;
          const vx = x2 - x1, vy = y2 - y1;
          const segLen2 = vx*vx + vy*vy || 1;
          const tSeg = Math.max(0, Math.min(1, ((ex - x1)*vx + (ey - y1)*vy) / segLen2));
          const cx = x1 + vx * tSeg, cy = y1 + vy * tSeg;
          const dSeg = Math.hypot(ex - cx, ey - cy);
          const tetherWidth = 10; // collision thickness for tether line
          if (dSeg <= tetherWidth + (e.radius||16)) {
            // Skip if already hit by this sweep
            if ((b as any)._hitOnce[eid]) continue;
            const level = (b as any).level || 1; const critMult = (this.player as any).critMultiplier || 2.0; const isCrit = Math.random() < (((this.player as any).critBonus||0)+0.08);
            const base = (b.damage||32) * 0.5; // 50% damage on tether contact
            const dmg = base * (isCrit ? critMult : 1);
            this.enemyManager.takeDamage(e, dmg, isCrit, false, WeaponType.SCRAP_SAW, pl.x, pl.y, level);
            (b as any)._hitOnce[eid] = 1; // mark as hit for this sweep
            const triggered = (this.player as any).addScrapHits ? (this.player as any).addScrapHits(1) : false;
            if (triggered) {
              const reach2 = (b as any).reach || (WEAPON_SPECS as any)[WeaponType.SCRAP_SAW]?.range || 120;
              const radius2 = Math.max(200, Math.round(reach2 * 1.5));
              const dmgRef = b.damage || 20;
              try {
                window.dispatchEvent(new CustomEvent('scrapExplosion', { detail: { x: pl.x, y: pl.y, damage: Math.round(dmgRef*1.0), radius: radius2, color: '#FFAA33' } }));
              } catch {}
              (this.player as any).hp = Math.min((this.player as any).hp + 5, (this.player as any).maxHp || (this.player as any).hp);
            }
          }
        }
        // End sweep
        if (t >= 1) {
          // End sweep; no extra shrapnel burst on completion in rework
          b.active = false; this.bulletPool.push(b);
        }
        activeBullets.push(b); continue;
      }

  // Store previous position for swept-sphere collision
  const prevX = b.x;
  const prevY = b.y;
  // Track last position for orientation (drone facing)
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
          if (b.targetId === 'boss' && boss && boss.active && boss.hp > 0) {
            target = boss; // direct boss reference (not in spatial grid)
          } else {
            const near = this.enemySpatialGrid.query(b.x, b.y, 400);
            for (let i2 = 0; i2 < near.length; i2++) {
              const e = near[i2];
              if (((e as any).id === b.targetId) && e.active && e.hp > 0) { target = e; break; }
            }
          }
        }
        // Reacquire if no valid target
        if (!target) {
          b.targetId = undefined;
          const reacq = this.selectSmartRifleTarget(b.x, b.y, 900);
          if (reacq) { target = reacq; b.targetId = (reacq as any).id || (reacq as any)._gid || 'boss'; }
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
          const cand = this.enemySpatialGrid.query(b.x, b.y, searchRadius);
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
          // Slower, smoother ascent with analytic easing (no incremental overshoot)
          const ASCEND_DURATION = 2600; // ms
          const phaseElapsed = now - (b.phaseStartTime || now);
          // Initial tether window ensures the drone appears exactly on top of the player for a brief moment
          // so the spawn feels correctly centered instead of instantly offsetting into an orbit arc.
          const TETHER_MS = 180; // a touch longer for readability
          // Establish / update anchor (player position) so orbit stays around moving player even if reference lost later
          // Establish / update anchor (player position) so orbit stays around moving player even if reference lost later
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
            b.altitudeScale = 0.18 + 0.17 * tLock; // 0.18 -> 0.35
            // Slight pre-spin so later easing picks up smoothly
            b.orbitAngle = (b.orbitAngle || 0) + 1.2 * (deltaTime / 1000);
          } else {
            const maxOrbit = 190; // slightly larger circle, reads better at slower pace
            // Rebase time so easing starts after tether (continuity at 0)
            const ascendT = Math.min(1, (phaseElapsed - TETHER_MS) / (ASCEND_DURATION - TETHER_MS));
            // Smooth easeInOut for radius (accelerate then decelerate) -> easeInOutCubic
            const easedRadius = ascendT < 0.5 ? 4 * ascendT * ascendT * ascendT : 1 - Math.pow(-2 * ascendT + 2, 3) / 2;
            b.orbitRadius = maxOrbit * easedRadius;
            // Angular speed smoothly decelerates (ease-out sine)
            const easedAng = Math.sin((ascendT * Math.PI) / 2); // 0->1
            const angStart = 1.8; // calmer initial spin
            const angEnd = 0.6;   // slower near apex
            const angSpeed = (angStart + (angEnd - angStart) * easedAng) * (deltaTime / 1000);
            b.orbitAngle = (b.orbitAngle || 0) + angSpeed;
            const orad = b.orbitRadius || 0;
            const ox = Math.cos(b.orbitAngle) * orad;
            const oy = Math.sin(b.orbitAngle) * orad * 0.55;
            b.x = anchorX + ox;
            b.y = anchorY + oy;
            // Smooth altitude easing (easeOutSine) from 0.35 -> 1.0 (shifted to start at 0.35 after tether)
            const altEased = Math.sin((ascendT * Math.PI) / 2);
            b.altitudeScale = 0.35 + 0.65 * altEased;
          }

          // Trail disabled for Quantum Halo (no accumulation)

      // Transition to HOVER at apex; defer targeting to HOVER phase
      // Use 1 when still in tether (ascendT undefined there) only when overall phaseElapsed exceeds ASCEND_DURATION
      const ascendComplete = phaseElapsed >= ASCEND_DURATION;
    if (ascendComplete) {
            b.phase = 'HOVER';
            b.phaseStartTime = performance.now();
            (b as any).hoverLastScan = 0;
            (b as any).hoverScanCount = 0;
          }
  } else if (b.phase === 'HOVER') {
          const HOVER_DURATION = 1200; // ms – linger a bit for anticipation
          const SCAN_INTERVAL = 220;  // ms – slower, more deliberate scans
          const hoverElapsed = now - (b.phaseStartTime || now);
          // Update anchor to follow player while hovering so drone orbits moving player
          if (player) {
            (b as any).anchorX = player.x;
            (b as any).anchorY = player.y;
          }
          const anchorX = (b as any).anchorX;
          const anchorY = (b as any).anchorY;
          // Faster gentle spin + breathing radius to avoid static feel
          b.orbitAngle = (b.orbitAngle || 0) + 0.75 * (deltaTime / 1000);
          const baseRad = b.orbitRadius || 0;
          const seed = (b as any)._hoverSeed || 0;
          const breathe = 1 + 0.08 * Math.sin(now * 0.004 + seed);
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
              const candidates = this.enemySpatialGrid.query(player.x, player.y, 1000);
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
                  if (dxC*dxC + dyC*dyC <= 160*160) count++;
                }
                if (count >= 3 && (!bestCluster || count > bestCluster.count)) bestCluster = { x: ex, y: ey, count, enemy: e };
              }
            }
            // Require at least one scan before allowing dive, even if duration elapsed
            if ((b as any).hoverScanCount >= 1 && (bestCluster || fallbackSingle || (hoverElapsed >= HOVER_DURATION && (b as any).seenEnemy))) {
              b.phase = 'DIVE';
              b.phaseStartTime = performance.now();
              // Defer actual coordinate lock until first DIVE update for freshest target
              (b as any)._pendingDiveAcquire = true;
              if (bestCluster && bestCluster.enemy) (b as any)._pendingClusterEnemyId = (bestCluster.enemy as any).id || (bestCluster.enemy as any)._gid;
              if (fallbackSingle) (b as any)._pendingFallbackEnemyId = (fallbackSingle as any).id || (fallbackSingle as any)._gid;
            }
          }
          if (hoverElapsed >= HOVER_DURATION && b.phase !== 'DIVE') {
            const EXTENDED_WAIT = 5000; // allow up to 5s hover if no enemies yet
            if (!(b as any).seenEnemy && hoverElapsed < EXTENDED_WAIT) {
              // Keep hovering; skip forced dive until enemy appears or timeout
            } else {
              b.phase = 'DIVE';
              b.phaseStartTime = performance.now();
              (b as any)._pendingDiveAcquire = true; // late lock on dive start
            }
          }
  } else if (b.phase === 'DIVE') {
          if ((b as any)._pendingDiveAcquire) {
            delete (b as any)._pendingDiveAcquire;
            const playerRef = this.player;
            const cx = playerRef ? playerRef.x : b.x;
            const cy = playerRef ? playerRef.y : b.y;
            const clusterId = (b as any)._pendingClusterEnemyId;
            const fallbackId = (b as any)._pendingFallbackEnemyId;
            let targetEnemy: any = null;
            const nearby = this.enemySpatialGrid.query(cx, cy, 1000);
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
              const diveOut = Math.min((b.orbitRadius || 0) + 140, 260);
              const anchorX3 = (b as any).anchorX ?? b.x; const anchorY3 = (b as any).anchorY ?? b.y;
              b.targetX = anchorX3 + Math.cos(b.orbitAngle || 0) * diveOut;
              b.targetY = anchorY3 + Math.sin(b.orbitAngle || 0) * diveOut * 0.55;
            }
            // Minimum distance check
            const minD2 = 110*110;
            let dxm = (b.targetX as number) - b.x; let dym = (b.targetY as number) - b.y; let d2m = dxm*dxm + dym*dym;
            if (d2m < minD2) {
              const ang = Math.atan2(dym, dxm) || (b.orbitAngle || 0);
              const extend = 120;
              b.targetX = b.x + Math.cos(ang) * extend;
              b.targetY = b.y + Math.sin(ang) * extend * 0.55;
            }
            b.vx = 0; b.vy = 0; // reset velocity for precise homing start
          }
          // Dive phase: slower, precise homing pursuit with adaptive speed toward locked/moving target.
          const phaseElapsed = now - (b.phaseStartTime || now);
          const MAX_DURATION = 1800; // absolute safety cutoff (slower pursuit)
          // If we have a locked enemy id, update targetX/Y to its current position (live tracking)
          const lockedId = (b as any).lockedTargetId;
          if (lockedId) {
            const nearby = this.enemySpatialGrid.query(b.x, b.y, 800);
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
          const tNorm = Math.min(1, phaseElapsed / 1600);
          // Desired direction normalized
          dxDive /= distDive; dyDive /= distDive;
          // Adaptive target speed: slower start, capped; gently ramps but also clamps by remaining distance to reduce overshoot
          const baseSpeed = 3.2; // slower base
          const maxSpeed = 9.5;  // overall cap
          const ramp = 0.28 + 0.9 * tNorm; // gentler ramp
          let desiredSpeed = Math.min(maxSpeed, baseSpeed * ramp);
          // Clamp by remaining distance so last frames decelerate automatically
          desiredSpeed = Math.min(desiredSpeed, Math.max(2.0, distDive / 16));
          // Smooth steering: blend current velocity direction toward desired direction
          const curSpeed = Math.hypot(b.vx || 0, b.vy || 0);
          let cvx = curSpeed > 0.001 ? b.vx / curSpeed : dxDive;
          let cvy = curSpeed > 0.001 ? b.vy / curSpeed : dyDive;
          const turnRate = 0.18 * (deltaTime / 16.6667); // lower = smoother turns
          cvx = cvx + (dxDive - cvx) * Math.min(1, turnRate);
          cvy = cvy + (dyDive - cvy) * Math.min(1, turnRate);
          const nrm = Math.hypot(cvx, cvy) || 1;
          cvx /= nrm; cvy /= nrm;
          b.vx = cvx * desiredSpeed;
          b.vy = cvy * desiredSpeed;
          b.x += b.vx;
          b.y += b.vy;
          (b as any).facingAng = Math.atan2(b.vy, b.vx);
          // Shrink more gradually; reaches minimum only very near impact for precision feel
          b.altitudeScale = Math.max(0.10, 1 - 0.90 * tNorm * tNorm);
          // Trail disabled for Quantum Halo (no accumulation)
          // Impact condition: near target OR elapsed > cutoff
          const remaining = Math.hypot((tx - b.x), (ty - b.y));
          // Collision check (explicit) – explode if near locked target or any enemy intersecting
          let impact = remaining < 18; // tighter radius for precision
          if (!impact) {
            const hitCandidates = this.enemySpatialGrid.query(b.x, b.y, 48);
            for (let hi=0;hi<hitCandidates.length && !impact;hi++) {
              const e = hitCandidates[hi];
              if (!e.active || e.hp <= 0) continue;
              const dxE = e.x - b.x; const dyE = e.y - b.y; const rs = (e.radius || 18) + (b.radius || 12) * (b.altitudeScale ? 0.6 : 1);
              if (dxE*dxE + dyE*dyE <= rs*rs) impact = true;
            }
          }
          if (impact || phaseElapsed > MAX_DURATION) {
            // Dispatch base radius (110) – ExplosionManager will upscale to achieve ~300% area
            window.dispatchEvent(new CustomEvent('droneExplosion', { detail: { x: b.x, y: b.y, damage: b.damage, radius: 110 } }));
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
        if (b.weaponType === WeaponType.MECH_MORTAR) {
          const spawnT = (b as any)._spawnTime || 0;
          const elapsed = performance.now() - spawnT;
          // Acceleration phase first 700ms: scale speed from 70% -> 115%
          const accelPhase = 700;
          const t = Math.min(1, elapsed / accelPhase);
          const speedScale = 0.7 + t * 0.45; // 0.7 -> 1.15
          const baseSpeed = (WEAPON_SPECS as any)[WeaponType.MECH_MORTAR]?.speed || 7;
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
          if (b.weaponType === WeaponType.MECH_MORTAR) {
            b.active = false;
            b.vx = 0; b.vy = 0;
            (b as any)._exploded = true;
            (b as any)._explosionStartTime = performance.now();
            (b as any)._maxExplosionDuration = 1000;
            b.lifeMs = 0;
            let exRadius = (b as any).explosionRadius;
            if (exRadius == null) {
              try { const spec = (WEAPON_SPECS as any)[WeaponType.MECH_MORTAR]; if (spec?.explosionRadius) exRadius = spec.explosionRadius; } catch {}
            }
            if (exRadius == null) exRadius = 200;
            // Pre-implosion then main explosion (delay keeps visual sequence consistent)
            window.dispatchEvent(new CustomEvent('mortarImplosion', { detail: { x: b.x, y: b.y, radius: exRadius * 0.55, color: '#FFE66D', delay: 90 } }));
            window.dispatchEvent(new CustomEvent('mortarExplosion', { detail: { x: b.x, y: b.y, damage: b.damage, hitEnemy: false, radius: exRadius, delay: 90 } }));
            this.bulletPool.push(b);
            continue;
          } else {
            b.active = false;
            this.bulletPool.push(b);
            continue;
          }
        }
      }

  let hitEnemy: Enemy | null = null;
  let intersectionPoint: { x: number, y: number } | null = null;

      // Use spatial grid to find potential enemies near the bullet
  // Query potential enemies near the bullet's current position
  const potentialEnemies = this.enemySpatialGrid.query(b.x, b.y, b.radius);
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

        // For Mech Mortar, use swept-sphere collision
          if (b.weaponType === WeaponType.MECH_MORTAR) {
            // Introduce arming distance/time so mortar can't explode immediately after firing (prevents early desync)
            const ARM_TIME_MS = 160; // ~0.16s safety
            const spawnT = (b as any)._spawnTime || 0;
            const armed = performance.now() - spawnT >= ARM_TIME_MS;
            if (armed) {
              intersectionPoint = this.lineCircleIntersect(prevX, prevY, b.x, b.y, enemy.x, enemy.y, b.radius + enemy.radius);
            } else {
              intersectionPoint = null;
            }
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
              const bonus = p.critBonus ? p.critBonus * 100 : 0; // convert 0..0.5 to percent
              critChance = Math.min(100, basePct + bonus) / 100; // normalize
            }
            const critMult = p?.critMultiplier ?? 2.0;
            const isCritical = Math.random() < critChance;
            const damage = isCritical ? b.damage * critMult : b.damage;
            this.enemyManager.takeDamage(enemy, damage, isCritical, false, b.weaponType, b.x, b.y, weaponLevel);
            if (this.particleManager) this.particleManager.spawn(enemy.x, enemy.y, 1, '#f00');
            // Virus: spawn a paralysis/DoT zone at impact point, except for Rogue Hacker (auto-casts zones separately)
            if (b.weaponType === WeaponType.HACKER_VIRUS) {
              const isRogue = (this.player as any)?.characterData?.id === 'rogue_hacker';
              if (!isRogue) {
                try {
                  window.dispatchEvent(new CustomEvent('spawnHackerZone', { detail: { x: enemy.x, y: enemy.y, radius: 120, lifeMs: 2000 } }));
                } catch {}
              }
            }
            // Neural Threader: on impact, anchor enemy into a thread polyline (pierces through until anchor limit)
            if (b.weaponType === WeaponType.NOMAD_NEURAL) {
              try {
                const spec: any = (WEAPON_SPECS as any)[WeaponType.NOMAD_NEURAL];
                const stats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : { anchors: 2, threadLifeMs: 3000, pulseIntervalMs: 500, pulsePct: 0.6 };
                // Find existing active thread for recent hits to append, else create a new one
                let thread = this.neuralThreads.find(t => t.active && (t.expireAt - performance.now()) > 0 && t.ownerId === (b as any)._id);
                const now = performance.now();
                const overmindUntil = (window as any).__overmindActiveUntil || 0;
                const color = '#26ffe9';
                if (!thread) {
                  thread = { anchors: [], createdAt: now, expireAt: now + (stats.threadLifeMs || 3000), nextPulseAt: now + (stats.pulseIntervalMs || 500), pulseMs: (stats.pulseIntervalMs || 500), baseDamage: b.damage || 20, pulsePct: (stats.pulsePct || 0.6), maxAnchors: (stats.anchors || 2), active: true, color, beadPhase: 0, ownerId: (b as any)._id };
                  this.neuralThreads.push(thread);
                }
                // Append if not already in anchors
                if (thread.anchors.indexOf(enemy) === -1) {
                  thread.anchors.push(enemy);
                }
                // Maintain pierce budget: consume but keep bullet alive while we can add anchors
                const hasRoom = thread.anchors.length < thread.maxAnchors + (overmindUntil > now ? 1 : 0);
                b.pierceRemaining = hasRoom ? 999 : 0; // bypass normal pierce while capacity remains
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
              const candidates = this.enemySpatialGrid.query(b.x, b.y, searchRadius);
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
            // Plasma detonation on first impact (no piercing). Determine over/charged multipliers here.
      if (b.weaponType === WeaponType.PLASMA) {
              const spec: any = (WEAPON_SPECS as any)[WeaponType.PLASMA];
              const p:any = this.player;
              const over = (p?.plasmaHeat||0) >= (spec?.overheatThreshold||0.85);
              const chargeT = (b as any).chargeT || 0;
              let dmgBase = b.damage;
              if (chargeT >= 1) dmgBase *= (spec?.chargedMultiplier||1.8);
              if (over) dmgBase *= (spec?.overchargedMultiplier||2.2);
              if (over) {
                p.plasmaHeat = Math.max(0, p.plasmaHeat * 0.6); // cooldown after overcharged
                window.dispatchEvent(new CustomEvent('plasmaIonField', { detail: { x: b.x, y: b.y, damage: dmgBase, radius: 120 } }));
              } else {
        // Preserve explicit 0 fragments (no fallback)
        const frags = (spec && Object.prototype.hasOwnProperty.call(spec,'fragmentCount')) ? (spec.fragmentCount||0) : 3;
        window.dispatchEvent(new CustomEvent('plasmaDetonation', { detail: { x: b.x, y: b.y, damage: dmgBase, fragments: frags, radius: 120 } }));
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
              const candidates = this.enemySpatialGrid.query(b.x, b.y, searchRadius);
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
            if (b.pierceRemaining && b.pierceRemaining > 0) {
              b.pierceRemaining -= 1;
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
              // On final hit (no pierce left), allow BIO_TOXIN to spawn a poison puddle at impact
              if (b.weaponType === WeaponType.BIO_TOXIN) {
                try {
                  const lvl = (b as any).level || 1;
                  const baseR = 28, baseMs = 2600;
                  const radius = baseR + (lvl - 1) * 3;
                  const lifeMs = baseMs + (lvl - 1) * 200;
                  this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs);
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

    // If Mech Mortar and collision detected OR life expires, trigger explosion sequence (with optional implosion) and deactivate projectile
  if (b.weaponType === WeaponType.MECH_MORTAR && (hitEnemy || (b.lifeMs !== undefined && b.lifeMs <= 0))) {
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
          try { const spec = (WEAPON_SPECS as any)[WeaponType.MECH_MORTAR]; if (spec?.explosionRadius) exRadius = spec.explosionRadius; } catch { /* ignore */ }
        }
        if (exRadius == null) exRadius = 200;
  // Optional brief implosion visual before main explosion: dispatch a pre-explosion event (purely visual)
  window.dispatchEvent(new CustomEvent('mortarImplosion', { detail: { x: explosionX, y: explosionY, radius: exRadius * 0.55, color: '#FFE66D', delay: 90 } }));
  // Main explosion (damage and particles handled by Game.ts) with radius
  window.dispatchEvent(new CustomEvent('mortarExplosion', { detail: { x: explosionX, y: explosionY, damage: b.damage, hitEnemy: hitEnemy, radius: exRadius, delay: 90 } }));
        this.bulletPool.push(b); // Return to pool
        continue; // Skip adding to activeBullets for this frame, as it's now inactive and exploded
      }

  // For BIO_TOXIN, spawn a poison puddle on expiry (ms-based)
      if (b.weaponType === WeaponType.BIO_TOXIN && b.lifeMs !== undefined && b.lifeMs <= 0) {
        try {
          const lvl = (b as any).level || 1;
          const baseR = 28, baseMs = 2600;
          const radius = baseR + (lvl - 1) * 3;
          const lifeMs = baseMs + (lvl - 1) * 200;
          this.enemyManager.spawnPoisonPuddle(b.x, b.y, radius, lifeMs);
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
  if ((b.weaponType === WeaponType.TRI_SHOT || b.weaponType === WeaponType.RAPID || b.weaponType === WeaponType.LASER || b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR) && b.active && b.projectileVisual && (b.projectileVisual as any).trailLength) {
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        const baseMax = (b.projectileVisual as any).trailLength || 10;
        const maxTrail = b.weaponType === WeaponType.MECH_MORTAR ? Math.min(48, baseMax) : Math.min(14, baseMax); // mortar keeps longer plume
        if (b.trail.length > maxTrail) b.trail.splice(0, b.trail.length - maxTrail);
      }

      // If bullet is still active and within extended frustum, keep it
      if (b.active) {
        if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) {
          // If lifetime left but out of bounds, deactivate silently to save work
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
  // Draw Neural Threader threads beneath bullets for layering clarity
  this.drawNeuralThreads(ctx);
  for (const b of this.bullets) {
      if (!b.active) continue;
      if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;
      ctx.save();
  // Draw trail first (behind projectile) – Crossbow + Smart Rifle + Laser Blaster subtle trace
  if ((b.weaponType === WeaponType.TRI_SHOT || b.weaponType === WeaponType.RAPID || b.weaponType === WeaponType.LASER || b.weaponType === WeaponType.MECH_MORTAR || b.weaponType === WeaponType.TACHYON_SPEAR || b.weaponType === WeaponType.SINGULARITY_SPEAR) && b.trail && b.trail.length > 1 && b.projectileVisual && (b.projectileVisual as any).trailColor) {
        const visual = b.projectileVisual as any;
        ctx.save();
  // Thicker, softer trail for mortar vs others
  ctx.lineWidth = (b.weaponType === WeaponType.MECH_MORTAR ? 3.2 : 1.5);
  const col = visual.trailColor as string;
        for (let i = 1; i < b.trail.length; i++) {
          const p0 = b.trail[i - 1];
          const p1 = b.trail[i];
          const t = i / b.trail.length;
      ctx.strokeStyle = col.replace(/rgba\(([^)]+)\)/, (m: string, inner: string) => {
            const parts = inner.split(',').map((s: string) => s.trim());
            if (parts.length === 4) {
        const alpha = parseFloat(parts[3]);
        // Mortar trail lingers more (sqrt fade) for heavy shell feel
        const fadeT = b.weaponType === WeaponType.MECH_MORTAR ? Math.sqrt(t) : t;
        return `rgba(${parts[0]},${parts[1]},${parts[2]},${(alpha * fadeT).toFixed(3)})`;
            }
            return col;
          });
          ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        if (b.weaponType === WeaponType.MECH_MORTAR) {
          // Add faint expanding smoke puffs along path (simple circles)
          const every = 4;
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
      let visual: any = b.projectileVisual ?? { type: 'bullet', color: '#0ff', size: b.radius, glowColor: '#0ff', glowRadius: 8 };
      if (b.weaponType === WeaponType.QUANTUM_HALO && visual) {
        const hue = (visual._dynamicHue||0);
        visual.color = `hsl(${hue},100%,82%)`;
        visual.glowColor = `hsl(${(hue+45)%360},100%,65%)`;
        visual.glowRadius = 55;
      }

      // Visual tether for Scavenger sawblade and evolved grinder: draw a glowing line from player to blade
      if ((b.weaponType === WeaponType.SCRAP_SAW && (b as any).isMeleeSweep) || (b.weaponType === WeaponType.INDUSTRIAL_GRINDER && (b as any).isOrbiting)) {
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
        if (b.weaponType === WeaponType.LASER) {
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
          // Fallback: draw colored circle
          ctx.shadowColor = visual.glowColor ?? visual.color ?? '#FFD700';
          ctx.shadowBlur = visual.glowRadius ?? 10;
          ctx.beginPath();
          ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
          ctx.fillStyle = visual.color ?? '#FFD700';
          ctx.fill();
        }
        ctx.restore(); // Restore after bullet drawing

        // Smart Rifle special orbiting mini-orbs (purely cosmetic)
        if (b.weaponType === WeaponType.RAPID) {
          const tNow = performance.now();
          const t0 = (b as any)._spawnTime || tNow;
          const dt = (tNow - t0) * 0.001; // seconds since spawn
          const orbCount = 3; // small tri-orbit for clarity
          const baseRadius = (visual.size ?? b.radius) * 1.2; // orbit distance from center
          const spin = 2.4; // revolutions per second (angular speed scalar)
          // Precompute alpha pulsation once
          const pulse = 0.55 + 0.45 * Math.sin(dt * 6.0);
          for (let oi = 0; oi < orbCount; oi++) {
            // Phase offset per orb
            const phase = (oi / orbCount) * Math.PI * 2;
            const ang = phase + dt * Math.PI * 2 * spin;
            const ox = b.x + Math.cos(ang) * baseRadius;
            const oy = b.y + Math.sin(ang) * baseRadius;
            ctx.save();
            ctx.shadowColor = visual.glowColor || visual.color || '#88e0ff';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            const orbSize = (visual.size ?? b.radius) * 0.35;
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
            ctx.fillStyle = fillStyle || 'rgba(180,255,255,0.6)';
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
          ctx.shadowColor = visual.glowColor || visual.color || '#00BFFF';
          ctx.shadowBlur = visual.glowRadius ?? 10;
          ctx.drawImage(img, -size/2, -size/2, size, size);
        } else {
          ctx.shadowColor = visual.glowColor || visual.color || '#00BFFF';
          ctx.shadowBlur = visual.glowRadius ?? 10;
          ctx.beginPath();
          ctx.arc(0, 0, visual.size ?? b.radius, 0, Math.PI*2);
          ctx.fillStyle = visual.color || '#00BFFF';
          ctx.fill();
        }
        // Faint vertical line to ground hint (altitude) while ascending
        if (b.phase === 'ASCEND' && scale < 0.98) {
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
      } else if (visual?.type === 'plasma' || visual?.type === 'slime') {
        ctx.save(); // Ensure save/restore for plasma/slime drawing
        ctx.shadowColor = visual.glowColor ?? visual.color ?? '#0ff';
        ctx.shadowBlur = visual.glowRadius ?? 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
        ctx.fillStyle = visual.color ?? '#0ff';
        ctx.fill();
        ctx.restore(); // Restore after plasma/slime drawing
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

  /** Tick Neural Threader threads: apply periodic damage and manage lifecycle. */
  private updateNeuralThreads(deltaMs: number) {
    const now = performance.now();
    if (!this.neuralThreads || this.neuralThreads.length === 0) return;
    const overmindUntil = (window as any).__overmindActiveUntil || 0;
    for (let i = 0; i < this.neuralThreads.length; i++) {
      const t = this.neuralThreads[i];
      if (!t.active) continue;
      // Cull dead anchors and expired
  t.anchors = t.anchors.filter(e => e && e.active && e.hp > 0);
  // Keep threads alive with a single anchor so they can grow on subsequent hits or autosnap
  if (t.anchors.length === 0 || now >= t.expireAt) {
        t.active = false; continue;
      }
      // Autosnap: during Overmind, attempt to add one nearby enemy up to +1 capacity
      if (overmindUntil > now && t.anchors.length < t.maxAnchors + 1) {
        // Search around mid-point of last segment for a close enemy not already in anchors
        const last = t.anchors[t.anchors.length - 1];
        const sx = last.x, sy = last.y;
        const candidates = this.enemySpatialGrid.query(sx, sy, 240);
        let best: Enemy | null = null; let bestD2 = Infinity;
        for (let ci = 0; ci < candidates.length; ci++) {
          const e = candidates[ci]; if (!e.active || e.hp <= 0) continue;
          if (t.anchors.indexOf(e) !== -1) continue;
          const dx = e.x - sx, dy = e.y - sy; const d2 = dx*dx + dy*dy;
          if (d2 < bestD2) { best = e; bestD2 = d2; }
        }
        if (best) t.anchors.push(best);
      }
      // Pulse damage on cadence
      if (now >= t.nextPulseAt) {
        t.nextPulseAt = now + t.pulseMs;
        // Damage anchors
        const perPulse = Math.max(1, Math.round(t.baseDamage * t.pulsePct));
        for (let ai = 0; ai < t.anchors.length; ai++) {
          const e = t.anchors[ai]; if (!e.active || e.hp <= 0) continue;
          this.enemyManager.takeDamage(e, perPulse, false, false, WeaponType.NOMAD_NEURAL);
          if (this.particleManager) this.particleManager.spawn(e.x, e.y, 1, '#26ffe9');
        }
        // Light arc zap to enemies near each segment for readability/aoe feel
        for (let ai = 0; ai < t.anchors.length - 1; ai++) {
          const a = t.anchors[ai], b = t.anchors[ai+1];
          const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
          const near = this.enemySpatialGrid.query(mx, my, 80);
          for (let ni = 0; ni < near.length; ni++) {
            const e = near[ni]; if (!e.active || e.hp <= 0) continue;
            if (t.anchors.indexOf(e) !== -1) continue;
            // tiny chip
            this.enemyManager.takeDamage(e, Math.max(1, Math.round(perPulse * 0.18)), false, false, WeaponType.NOMAD_NEURAL);
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
        const burst = Math.max(1, Math.round(t.baseDamage * t.pulsePct * 5.0 * (multiplier || 1))); // doubled overall
        // Damage anchors heavily
        for (let ai = 0; ai < t.anchors.length; ai++) {
          const e = t.anchors[ai]; if (!e.active || e.hp <= 0) continue;
          this.enemyManager.takeDamage(e, burst, false, false, WeaponType.NOMAD_NEURAL);
          if (this.particleManager) this.particleManager.spawn(e.x, e.y, 2, '#9ffcf6');
          // Flag RGB glitch effect
          const anyE: any = e as any; anyE._rgbGlitchUntil = Math.max(anyE._rgbGlitchUntil||0, performance.now() + 220); anyE._rgbGlitchPhase = (anyE._rgbGlitchPhase||0) + 1;
        }
        // Splash along segments
        for (let ai = 0; ai < t.anchors.length - 1; ai++) {
          const a = t.anchors[ai], b = t.anchors[ai+1];
          const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
          const near = this.enemySpatialGrid.query(mx, my, 110);
          for (let ni = 0; ni < near.length; ni++) {
            const e = near[ni]; if (!e.active || e.hp <= 0) continue;
            if (t.anchors.indexOf(e) !== -1) continue;
            this.enemyManager.takeDamage(e, Math.max(1, Math.round(burst * 0.33)), false, false, WeaponType.NOMAD_NEURAL);
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
    const spec = (WEAPON_SPECS as any)[weapon] ?? (WEAPON_SPECS as any)[WeaponType.PISTOL];
    const dx = targetX - x;
    const dy = targetY - y;
    const angle = Math.atan2(dy, dx);
  let speed = spec?.speed ?? 2; // Base projectile speed (can be overridden by per-level scaling)
    const projectileImageKey = spec?.projectile ?? 'bullet_cyan';
  // Clone visual spec per spawn to avoid mutating shared objects (prevents red tint leaking to later shots)
  let projectileVisual = spec?.projectileVisual ? { ...(spec.projectileVisual as any) } : { type: 'bullet', color: '#0ff', size: 6 };

    let b: Bullet | undefined = this.bulletPool.pop(); // Try to get from pool

    if (!b) {
      // If pool is empty, create a new one (should be rare if initialPoolSize is sufficient)
      b = { x: 0, y: 0, vx: 0, vy: 0, radius: 0, life: 0, active: false, damage: 0, weaponType: WeaponType.PISTOL } as Bullet;
    }

  // Reset and initialize bullet properties
    b.x = x;
    b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
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
      // Propagate scaled explosion radius if provided by the weapon at this level
      if ((scaled as any).explosionRadius != null) {
        (b as any).explosionRadius = (scaled as any).explosionRadius;
      }
    }

    // Range & lifetime derivation (gentler compression of very large ranges)
    if (spec && typeof spec.range === 'number' && speed > 0) {
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
  // Removed former global +30% range boost (scaledRange *= 1.3) to tighten overall projectile ranges
      const rawLife = scaledRange / speed;
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
    // Psionic Wave: during Weaver Lattice, emit symmetric faint secondary waves to form a fuller weave pattern
  if (weapon === WeaponType.PSIONIC_WAVE && !this.suppressWeaverSecondary) {
      try {
        const until = (window as any).__weaverLatticeActiveUntil || 0;
        if (until > performance.now()) {
      this.suppressWeaverSecondary = true; // prevent nested secondary emissions
          const baseAngle = Math.atan2(targetY - y, targetX - x);
          const len = 320; // a bit longer for epic feel
          const angleOffset = 0.18; // fixed gentle fan
          const lateral = 30;       // inner lanes
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
                if (vis.thickness != null) vis.thickness = Math.max(6, Math.round(vis.thickness * 0.8));
                vis.glowRadius = Math.max(14, (vis.glowRadius || 24) * 0.8);
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
                if (vis.thickness != null) vis.thickness = Math.max(6, Math.round(vis.thickness * 0.8));
                vis.glowRadius = Math.max(14, (vis.glowRadius || 24) * 0.8);
                if (vis.thickness == null) vis.thickness = 10;
                bR.projectileVisual = vis;
              }
              bR.weaponType = WeaponType.PSIONIC_WAVE;
            }
          }
          // Outer pair for more epic lattice
          const lateralOuter = lateral + 38;
          const angleOuter = angleOffset * 1.25;
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
                if (vis.thickness != null) vis.thickness = Math.max(5, Math.round((vis.thickness) * 0.75));
                vis.glowRadius = Math.max(12, (vis.glowRadius || 24) * 0.75);
                if (vis.thickness == null) vis.thickness = 9;
                bL2.projectileVisual = vis;
              }
              bL2.weaponType = WeaponType.PSIONIC_WAVE;
            }
          }
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
                if (vis.thickness != null) vis.thickness = Math.max(5, Math.round((vis.thickness) * 0.75));
                vis.glowRadius = Math.max(12, (vis.glowRadius || 24) * 0.75);
                if (vis.thickness == null) vis.thickness = 9;
                bR2.projectileVisual = vis;
              }
              bR2.weaponType = WeaponType.PSIONIC_WAVE;
            }
          }
          this.suppressWeaverSecondary = false;
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
      b.altitudeScale = 0.12; // start very small so growth is obvious
      b.searchCooldownMs = 250; // search cluster every 250ms
  (b as any)._hoverSeed = Math.random() * Math.PI * 2; // personalize hover breathing
      // Center over player if available
      const pl = this.player;
  if (pl) { b.x = pl.x; b.y = pl.y; b.startX = pl.x; b.startY = pl.y; (b as any).spawnCenterX = pl.x; (b as any).spawnCenterY = pl.y; }
      // Neutralize initial velocity (we'll control manually)
      b.vx = 0; b.vy = 0;
      // Override lifetime/range so drone can finish full ascent & dive (at least 6s)
      b.life = 600; // legacy frames (~10s) safeguard
      b.lifeMs = 9000; // ms lifetime explicit
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
    // Melee: Scrap-Saw sweep spawns a transient sweep bullet bound to player
    if (weapon === WeaponType.SCRAP_SAW) {
      const spec: any = (WEAPON_SPECS as any)[WeaponType.SCRAP_SAW];
      const scaled = spec?.getLevelStats ? spec.getLevelStats(level) : {};
      (b as any).isMeleeSweep = true;
      (b as any).sweepStart = performance.now();
      (b as any).sweepDurationMs = scaled.sweepDurationMs || 200;
  // Reset per-swing contact cooldowns so each sweep can hit a target at most once
  b.contactCooldownMap = Object.create(null);
  (b as any).tetherCooldownMap = Object.create(null);
      (b as any).arcDegrees = scaled.arcDegrees || 140;
      (b as any).reach = spec.range || 120;
      (b as any).baseAngle = Math.atan2(targetY - y, targetX - x);
      (b as any).level = level;
      (b as any).sweepDir = (((this as any)._lastScrapDir = -(((this as any)._lastScrapDir)||-1))) as number; // alternate -1/1
      // At end of sweep, we may spawn shrapnel burst elsewhere (handled in Player cooldown or separate hook). Keep bullet minimal.
    }

    // Evolution: Industrial Grinder – spawn as orbiting bullet with finite duration
    if (weapon === WeaponType.INDUSTRIAL_GRINDER) {
      const spec: any = (WEAPON_SPECS as any)[WeaponType.INDUSTRIAL_GRINDER];
      const scaled = spec?.getLevelStats ? spec.getLevelStats(level) : {};
      b.isOrbiting = true; (b as any).level = level; b.orbitIndex = 0; b.orbitCount = 1; b.orbitAngle = Math.random()*Math.PI*2; b.spinSpeed = 4.2;
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
