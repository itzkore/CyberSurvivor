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
  private enemySpatialGrid: SpatialGrid<Enemy>; // Spatial grid for enemies
  private particleManager: ParticleManager; // Injected ParticleManager
  private enemyManager: EnemyManager; // Injected EnemyManager

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

  public update() {
    const activeBullets: Bullet[] = [];
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.active) {
        this.bulletPool.push(b); // Return to pool if inactive
        continue;
      }

      // Store previous position for swept-sphere collision
      const prevX = b.x;
      const prevY = b.y;

      // Move the projectile
      b.x += b.vx;
      b.y += b.vy;
      b.life--;

      let hitEnemy: Enemy | null = null;
      let intersectionPoint: { x: number, y: number } | null = null;

      // Use spatial grid to find potential enemies near the bullet
      const potentialEnemies = this.enemySpatialGrid.query(b.x, b.y, b.radius);
      for (const enemy of potentialEnemies) {
        if (!enemy.active || enemy.hp <= 0) continue; // Only check active, alive enemies

        // For Mech Mortar, use swept-sphere collision
        if (b.weaponType === WeaponType.MECH_MORTAR) {
          intersectionPoint = this.lineCircleIntersect(prevX, prevY, b.x, b.y, enemy.x, enemy.y, b.radius + enemy.radius);
        } else {
          // For other bullets, use simple circle-circle collision
          const dx = b.x - enemy.x;
          const dy = b.y - enemy.y;
          const dist = Math.hypot(dx, dy);
          if (dist < b.radius + enemy.radius) {
            intersectionPoint = { x: b.x, y: b.y }; // Approximate intersection point
          }
        }

        if (intersectionPoint) {
          hitEnemy = enemy;
          // Calculate hit direction from bullet to enemy for knockback (pushes enemy away from bullet)
          const dx = enemy.x - b.x; // Vector from bullet to enemy
          const dy = enemy.y - b.y; // Vector from bullet to enemy
          const dist = Math.hypot(dx, dy) || 1;
          const hitDirection = { x: dx / dist, y: dy / dist };
          const weaponLevel = (b as any).level ?? 1;

          // Apply damage and knockback (using injected enemyManager)
          this.enemyManager.takeDamage(enemy, b.damage, false, false, b.weaponType, window.player?.x, window.player?.y, weaponLevel);

          // Deactivate bullet immediately on hit (removed Mech Mortar exception)
          b.active = false;
          if (b.weaponType !== WeaponType.MECH_MORTAR) { // Mech Mortar handles its own explosion
            this.bulletPool.push(b); // Return to pool if not a Mech Mortar
          }
          this.particleManager.spawn(enemy.x, enemy.y, 1, '#f00'); // Use injected particleManager
          break; // Stop at first hit for this bullet
        }
      }

      // If Mech Mortar and collision detected OR life expires, trigger explosion event and deactivate projectile
      if (b.weaponType === WeaponType.MECH_MORTAR && (hitEnemy || b.life <= 0)) {
        b.active = false; // Immediately deactivate projectile
        b.vx = 0; // Stop movement
        b.vy = 0; // Stop movement

        // Explosion state: keep explosion timing independent from bullet lifecycle
        (b as any)._exploded = true;
        (b as any)._explosionStartTime = performance.now();
        (b as any)._maxExplosionDuration = 1000;
        b.life = 0;

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

      // If bullet is still active and not a Mech Mortar or Bio Toxin that expired, add to active list
      if (b.active) {
        activeBullets.push(b);
      }
    }
    this.bullets = activeBullets; // Update the active bullets list
  }

  public draw(ctx: CanvasRenderingContext2D) {
    for (const b of this.bullets) {
      if (!b.active) continue;
      ctx.save();
      let visual: any = b.projectileVisual ?? { type: 'bullet', color: '#0ff', size: b.radius, glowColor: '#0ff', glowRadius: 8 };

      // General bullet drawing logic (including what was Mech Mortar)
      if (visual?.type === 'bullet') {
        ctx.save(); // Ensure save/restore for bullet drawing
        if (visual.sprite) {
          // Use PNG sprite for bullet, rotated to match direction
          const bulletImage = this.assetLoader.getImage(visual.sprite);
          if (bulletImage) {
            const size = (visual.size ?? b.radius) * 2;
            const drawX = b.x;
            const drawY = b.y;
            // Calculate angle from velocity
            const angle = Math.atan2(b.vy, b.vx);
            ctx.save();
            ctx.translate(drawX, drawY);
            ctx.rotate(angle);
            ctx.drawImage(bulletImage, -size / 2, -size / 2, size, size);
            ctx.restore();
          }
        } else {
          // Fallback: draw colored circle
          ctx.shadowColor = visual.glowColor ?? visual.color ?? '#FFD700';
          ctx.shadowBlur = visual.glowRadius ?? 10;
          ctx.beginPath();
          ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
          ctx.fillStyle = visual.color ?? '#FFD700';
          ctx.fill();
        }
        ctx.restore(); // Restore after bullet drawing
      } else if (visual?.type === 'plasma' || visual?.type === 'slime') {
        ctx.save(); // Ensure save/restore for plasma/slime drawing
        ctx.shadowColor = visual.glowColor ?? visual.color ?? '#0ff';
        ctx.shadowBlur = visual.glowRadius ?? 8;
        ctx.beginPath();
        ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
        ctx.fillStyle = visual.color ?? '#0ff';
        ctx.fill();
        ctx.restore(); // Restore after plasma/slime drawing
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

  public spawnBullet(x: number, y: number, targetX: number, targetY: number, weapon: WeaponType, damage: number) {
    const spec = (WEAPON_SPECS as any)[weapon] ?? (WEAPON_SPECS as any)[WeaponType.PISTOL];
    const dx = targetX - x;
    const dy = targetY - y;
    const angle = Math.atan2(dy, dx);
    const speed = spec?.speed ?? 2;
    const projectileImageKey = spec?.projectile ?? 'bullet_cyan';
    // Removed Mech Mortar specific projectile visual override
    // Increase Desert Eagle bullet size by 5x for visual impact
    let projectileVisual = spec?.projectileVisual ?? { type: 'bullet', color: '#0ff', size: 6 };
    // Desert Eagle is WeaponType.PISTOL
    if (weapon === WeaponType.PISTOL) {
      projectileVisual = { ...projectileVisual, size: (projectileVisual.size ?? 6) * 5 };
    }

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
    b.radius = projectileVisual.size ?? 6; // Ensure radius matches the new visual size
    b.life = spec?.lifetime ?? 60; // Use weapon spec lifetime
    b.active = true;
    b.damage = spec?.damage ?? damage; // Use weapon spec damage, fallback to passed damage
    b.weaponType = weapon;
    b.projectileImageKey = projectileImageKey;
    b.projectileVisual = projectileVisual;
    b.snakeTargets = undefined; // Clear previous snake targets    b.snakeBounceCount = undefined; // Clear previous bounce count

    this.bullets.push(b);
  }
}
