import type { Bullet } from './Bullet';
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
  private enemySpatialGrid: SpatialGrid<Enemy>; // Spatial grid reference

  constructor(assetLoader: AssetLoader, enemySpatialGrid: SpatialGrid<Enemy>, particleManager: ParticleManager, enemyManager: EnemyManager) {
    this.assetLoader = assetLoader;
    this.enemySpatialGrid = enemySpatialGrid; // Assign spatial grid
    this.particleManager = particleManager; // Assign particle manager
    this.enemyManager = enemyManager; // Assign enemy manager
    this.preallocateBullets();
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

  // Store previous position for swept-sphere collision
  const prevX = b.x;
  const prevY = b.y;
  // Track last position for orientation (drone facing)
  (b as any).lastX = prevX;
  (b as any).lastY = prevY;

      // Smart Rifle homing logic (bee-like) executed before movement so velocity reflects latest steering
      if (b.weaponType === WeaponType.RAPID && b.active) {
        // Resolve current locked target if any
        let target: any = null;
        if (b.targetId) {
          // Fast path: search small spatial bucket around bullet for matching id
          const near = this.enemySpatialGrid.query(b.x, b.y, 400);
            for (let i2=0;i2<near.length;i2++){ const e=near[i2]; if ((e as any).id===b.targetId){ if(e.active && e.hp>0){ target=e; break;} }}
        }
        // Reacquire if no valid target (dead/out of range)
        if (!target) {
          b.targetId = undefined;
          const reacq = this.selectSmartRifleTarget(b.x, b.y, 900);
          if (reacq) { target = reacq; b.targetId = (reacq as any).id || (reacq as any)._gid || 'boss'; }
        }
        if (target) {
          // Desired direction toward target with small predictive bias
          const dx = target.x - b.x;
          const dy = target.y - b.y;
          const dist = Math.hypot(dx, dy) || 1;
          const ndx = dx / dist;
          const ndy = dy / dist;
          // Turn rate hint stored on bullet (set at spawn). Fallback default.
          const tr = (b as any).turnRate || 0.07;
          // Interpolate current velocity direction toward desired
          const curSpeed = Math.hypot(b.vx, b.vy) || 0.0001;
          const cvx = b.vx / curSpeed;
          const cvy = b.vy / curSpeed;
          const mix = Math.min(1, tr * (deltaTime / 16.6667));
          let ndirx = cvx + (ndx - cvx) * mix;
          let ndiry = cvy + (ndy - cvy) * mix;
          const ndLen = Math.hypot(ndirx, ndiry) || 1;
          ndirx /= ndLen; ndiry /= ndLen;
          // Slight acceleration over flight to ensure distant reach
          const accel = 1 + 0.12 * (deltaTime / 1000);
          const baseSpeed = b.speed || curSpeed;
          const targetSpeed = baseSpeed * accel;
          b.vx = ndirx * targetSpeed;
          b.vy = ndiry * targetSpeed;
          // Store updated nominal speed back
          b.speed = targetSpeed;
        }
      }
      // Kamikaze Drone phased logic
      if (b.weaponType === WeaponType.HOMING && b.active) {
        const now = performance.now();
  if (!b.phase) b.phase = 'ASCEND';
  const player = (window as any).player;
  if (b.phase === 'ASCEND') {
          // Faster, smoother ascent (shortened duration) with analytic easing (no incremental overshoot)
          const ASCEND_DURATION = 1800; // ms (was 3000)
          const phaseElapsed = now - (b.phaseStartTime || now);
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
          const maxOrbit = 170; // reduced max orbit radius (tighter circle)
          const ascendT = Math.min(1, phaseElapsed / ASCEND_DURATION);
          // Smooth easeInOut for radius (accelerate then decelerate) -> easeInOutCubic
          const easedRadius = ascendT < 0.5 ? 4 * ascendT * ascendT * ascendT : 1 - Math.pow(-2 * ascendT + 2, 3) / 2;
          b.orbitRadius = maxOrbit * easedRadius;
          // Angular speed smoothly decelerates (ease-out sine)
          const easedAng = Math.sin((ascendT * Math.PI) / 2); // 0->1
          const angStart = 2.6; // slightly faster initial spin
          const angEnd = 0.9;   // slow near apex
          const angSpeed = (angStart + (angEnd - angStart) * easedAng) * (deltaTime / 1000);
          b.orbitAngle = (b.orbitAngle || 0) + angSpeed;
          const orad = b.orbitRadius || 0;
          const ox = Math.cos(b.orbitAngle) * orad;
          const oy = Math.sin(b.orbitAngle) * orad * 0.55;
          b.x = anchorX + ox;
          b.y = anchorY + oy;
          // Smooth altitude easing (easeOutSine) from 0.35 -> 1.0
          const altEased = Math.sin((ascendT * Math.PI) / 2);
          b.altitudeScale = 0.35 + 0.65 * altEased;

          // Subtle trail accumulation during ascent for visual feedback
          if (!b.trail) b.trail = [];
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > 22) b.trail.splice(0, b.trail.length - 22);

          // Transition to HOVER at apex; defer targeting to HOVER phase
      if (ascendT >= 1) {
            b.phase = 'HOVER';
            b.phaseStartTime = performance.now();
            (b as any).hoverLastScan = 0;
            (b as any).hoverScanCount = 0;
          }
  } else if (b.phase === 'HOVER') {
          const HOVER_DURATION = 800; // ms
          const SCAN_INTERVAL = 160;  // ms
          const hoverElapsed = now - (b.phaseStartTime || now);
          // Update anchor to follow player while hovering so drone orbits moving player
          if (player) {
            (b as any).anchorX = player.x;
            (b as any).anchorY = player.y;
          }
          const anchorX = (b as any).anchorX;
          const anchorY = (b as any).anchorY;
          // Faster gentle spin + breathing radius to avoid static feel
          b.orbitAngle = (b.orbitAngle || 0) + 1.05 * (deltaTime / 1000);
          const baseRad = b.orbitRadius || 0;
          const breathe = 1 + 0.05 * Math.sin(now * 0.004 + (b as any)._hoverSeed || 0);
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
            const playerRef = (window as any).player;
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
          const MAX_DURATION = 1400; // absolute safety cutoff
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
          const tNorm = Math.min(1, phaseElapsed / 1400);
          // Desired direction normalized
          dxDive /= distDive; dyDive /= distDive;
          // Adaptive target speed: slower start, capped; gently ramps but also clamps by remaining distance to reduce overshoot
          const baseSpeed = 4.0; // slower base
          const maxSpeed = 11.0; // overall cap
          const ramp = 0.35 + 1.1 * tNorm; // linear ramp
          let desiredSpeed = Math.min(maxSpeed, baseSpeed * ramp);
          // Clamp by remaining distance so last frames decelerate automatically
          desiredSpeed = Math.min(desiredSpeed, Math.max(2.2, distDive / 14));
          // Smooth steering: blend current velocity direction toward desired direction
          const curSpeed = Math.hypot(b.vx || 0, b.vy || 0);
          let cvx = curSpeed > 0.001 ? b.vx / curSpeed : dxDive;
          let cvy = curSpeed > 0.001 ? b.vy / curSpeed : dyDive;
          const turnRate = 0.22 * (deltaTime / 16.6667); // higher = snappier turns
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
          // Trail (denser while accelerating)
          if (!b.trail) b.trail = [];
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > 36) b.trail.splice(0, b.trail.length - 36);
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
            window.dispatchEvent(new CustomEvent('droneExplosion', { detail: { x: b.x, y: b.y, damage: b.damage, radius: 160 } }));
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
          b.active = false;
          this.bulletPool.push(b);
          continue;
        }
      }

  let hitEnemy: Enemy | null = null;
  let intersectionPoint: { x: number, y: number } | null = null;

      // Use spatial grid to find potential enemies near the bullet
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
          intersectionPoint = this.lineCircleIntersect(prevX, prevY, b.x, b.y, enemy.x, enemy.y, b.radius + enemy.radius);
        } else {
          // For other bullets, use simple circle-circle collision
          const dx = b.x - enemy.x;
          const dy = b.y - enemy.y;
          const rs = b.radius + enemy.radius;
          if (dx*dx + dy*dy < rs*rs) intersectionPoint = { x: b.x, y: b.y };
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
            const isCritical = Math.random() < 0.15;
            const damage = isCritical ? b.damage * 2.0 : b.damage;
            this.enemyManager.takeDamage(enemy, damage, isCritical, false, b.weaponType, b.x, b.y, weaponLevel);
            if (this.particleManager) this.particleManager.spawn(enemy.x, enemy.y, 1, '#f00');
            // Piercing: if pierceRemaining > 0, decrement and continue; else deactivate
            if (b.pierceRemaining && b.pierceRemaining > 0) {
              b.pierceRemaining -= 1;
              intersectionPoint = null; // reset so we can find next enemy
              continue; // keep bullet alive
            } else {
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
              const isCritical = Math.random() < 0.15;
              const damage = isCritical ? b.damage * 2.0 : b.damage;
              // Reuse enemyManager damage pathway if compatible, else dispatch custom event
              if (this.enemyManager && (this.enemyManager as any).takeBossDamage) {
                (this.enemyManager as any).takeBossDamage(boss, damage, isCritical, b.x, b.y, weaponLevel);
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

      // If Mech Mortar and collision detected OR life expires, trigger explosion event and deactivate projectile
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

        // Dispatch explosion event (damage and particles handled by Game.ts) with radius
        window.dispatchEvent(new CustomEvent('mortarExplosion', {
          detail: {
            x: explosionX,
            y: explosionY,
            damage: b.damage,
            hitEnemy: hitEnemy, // Pass hit enemy for direct damage
            radius: b.explosionRadius ?? 100
          }
        }));
        this.bulletPool.push(b); // Return to pool
        continue; // Skip adding to activeBullets for this frame, as it's now inactive and exploded
      }

      // For BIO_TOXIN, spawn a poison puddle on expiry
      if (b.life <= 0 && b.weaponType === WeaponType.BIO_TOXIN) {
        this.enemyManager.spawnPoisonPuddle(b.x, b.y); // Use injected enemyManager
        b.active = false; // Mark as inactive to be returned to pool
        this.bulletPool.push(b);
        continue;
      }

  // Trail accumulation for weapons with trail visuals (added LASER for subtle trace)
  if ((b.weaponType === WeaponType.TRI_SHOT || b.weaponType === WeaponType.RAPID || b.weaponType === WeaponType.LASER) && b.active && b.projectileVisual && (b.projectileVisual as any).trailLength) {
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        const maxTrail = Math.min(14, (b.projectileVisual as any).trailLength || 10); // keep short
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
  }

  public draw(ctx: CanvasRenderingContext2D) {
    const camX = (window as any).__camX || 0;
    const camY = (window as any).__camY || 0;
    const viewW = (window as any).__designWidth || ctx.canvas.width;
    const viewH = (window as any).__designHeight || ctx.canvas.height;
    const pad = 64;
    const minX = camX - pad, maxX = camX + viewW + pad;
    const minY = camY - pad, maxY = camY + viewH + pad;
    for (const b of this.bullets) {
      if (!b.active) continue;
      if (b.x < minX || b.x > maxX || b.y < minY || b.y > maxY) continue;
      ctx.save();
  // Draw trail first (behind projectile) – Crossbow + Smart Rifle + Laser Blaster subtle trace
  if ((b.weaponType === WeaponType.TRI_SHOT || b.weaponType === WeaponType.RAPID || b.weaponType === WeaponType.LASER) && b.trail && b.trail.length > 1 && b.projectileVisual && (b.projectileVisual as any).trailColor) {
        const visual = b.projectileVisual as any;
        ctx.save();
        ctx.lineWidth = 1.5; // subtle
        const col = visual.trailColor as string;
        for (let i = 1; i < b.trail.length; i++) {
          const p0 = b.trail[i - 1];
          const p1 = b.trail[i];
          const t = i / b.trail.length;
          ctx.strokeStyle = col.replace(/rgba\(([^)]+)\)/, (m: string, inner: string) => {
            const parts = inner.split(',').map((s: string) => s.trim());
            if (parts.length === 4) {
              const alpha = parseFloat(parts[3]);
              return `rgba(${parts[0]},${parts[1]},${parts[2]},${(alpha * t).toFixed(3)})`;
            }
            return col;
          });
          ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
        ctx.restore();
      }
      let visual: any = b.projectileVisual ?? { type: 'bullet', color: '#0ff', size: b.radius, glowColor: '#0ff', glowRadius: 8 };

      // General bullet drawing logic (including what was Mech Mortar)
  if (visual?.type === 'bullet') {
        ctx.save(); // Ensure save/restore for bullet drawing
        if (visual.sprite) {
          // Use PNG sprite for bullet, rotated to match direction; lazy-load if absent
          let bulletImage = this.assetLoader.getImage(visual.sprite);
          if (!bulletImage) {
            // Kick off async load (fire and forget); will display from next frame
            this.assetLoader.loadImage(visual.sprite);
          } else {
            const size = (visual.size ?? b.radius) * 2;
            const drawX = b.x;
            const drawY = b.y;
            let angle = Math.atan2(b.vy, b.vx);
            if (typeof visual.rotationOffset === 'number') angle += visual.rotationOffset;
            ctx.save();
            ctx.translate(drawX, drawY);
            ctx.rotate(angle);
            // Subtle glow for laser blaster sprite
            if (b.weaponType === WeaponType.LASER) {
              ctx.shadowColor = visual.glowColor || visual.color || '#FF6A50';
              ctx.shadowBlur = Math.min(visual.glowRadius ?? 14, 18);
            }
            ctx.drawImage(bulletImage, -size / 2, -size / 2, size, size);
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

  public spawnBullet(x: number, y: number, targetX: number, targetY: number, weapon: WeaponType, damage: number, level: number = 1) {
    const spec = (WEAPON_SPECS as any)[weapon] ?? (WEAPON_SPECS as any)[WeaponType.PISTOL];
    const dx = targetX - x;
    const dy = targetY - y;
    const angle = Math.atan2(dy, dx);
  let speed = spec?.speed ?? 2; // Base projectile speed (can be overridden by per-level scaling)
    const projectileImageKey = spec?.projectile ?? 'bullet_cyan';
  // Removed earlier size inflation; rely on spec-defined projectileVisual size
  let projectileVisual = spec?.projectileVisual ?? { type: 'bullet', color: '#0ff', size: 6 };

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
  (b as any)._spawnTime = performance.now(); // record spawn timestamp for time-based visuals
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
    b.projectileVisual = projectileVisual;
    b.snakeTargets = undefined; // Clear previous snake targets    b.snakeBounceCount = undefined; // Clear previous bounce count
  // Reset pierce/trail state from any prior usage in pool
  b.pierceRemaining = undefined;
  b.trail = undefined;
  b.hitIds = b.hitIds ? (b.hitIds.length = 0, b.hitIds) : []; // clear or create hit list
  b.targetId = undefined;
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
    // Smart Rifle initial target lock (toughest enemy: highest maxHp (fallback hp); tie -> lowest current hp)
    if (weapon === WeaponType.RAPID) {
      const lock = this.selectSmartRifleTarget(targetX, targetY, 900);
      if (lock) {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && lock === boss) b.targetId = 'boss';
        else b.targetId = (lock as any).id || (lock as any)._gid;
      }
      (b as any).turnRate = (b as any).turnRate || 0.07;
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
      // Center over player if available
      const pl = (window as any).player;
      if (pl) { b.x = pl.x; b.y = pl.y; b.startX = pl.x; b.startY = pl.y; }
      // Neutralize initial velocity (we'll control manually)
      b.vx = 0; b.vy = 0;
      // Override lifetime/range so drone can finish full ascent & dive (at least 6s)
      b.life = 600; // legacy frames (~10s) safeguard
      b.lifeMs = 9000; // ms lifetime explicit
      b.maxDistanceSq = 999999999; // effectively disable range cap for drone
    }

    this.bullets.push(b);
  }
}
