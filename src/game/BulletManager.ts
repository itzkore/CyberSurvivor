import type { Bullet } from './Bullet';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';
import type { Enemy } from './EnemyManager'; // Import Enemy type
import { Logger } from '../core/Logger';

declare global {
  interface Window {
    enemyManager?: {
      getEnemies: () => Array<Enemy>; // Use Enemy type
    };
    player?: { x: number; y: number };
  }
}

export class BulletManager {
  public bullets: Bullet[] = [];
  private bulletPool: Bullet[] = []; // Dedicated pool for inactive bullets
  private assetLoader: AssetLoader;
  private readonly initialPoolSize: number = 200; // Pre-allocate a reasonable number of bullets

  constructor(assetLoader: AssetLoader) {
    this.assetLoader = assetLoader;
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
        // Ensure explosion properties are reset when returning to pool (removed Mech Mortar specific resets)
        // b._exploded = false;
        // b._explosionStartTime = undefined;
        // b._maxExplosionDuration = undefined;
        this.bulletPool.push(b); // Return to pool if inactive
        continue;
      }

      // --- Mech Mortar (Titan Mech) logic ---
      if (b.weaponType === WeaponType.MECH_MORTAR) {
        const prevX = b.x; // Store previous position for swept-sphere collision
        const prevY = b.y;

        // Move the projectile
        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        let hitEnemy: Enemy | null = null;
        let intersectionPoint: { x: number, y: number } | null = null;

        if (window.enemyManager && typeof window.enemyManager.getEnemies === 'function') {
          for (const enemy of window.enemyManager.getEnemies()) {
            intersectionPoint = this.lineCircleIntersect(prevX, prevY, b.x, b.y, enemy.x, enemy.y, b.radius + enemy.radius);
            if (intersectionPoint) {
              hitEnemy = enemy;
              // --- Knockback direction (corrected to push away from bullet) ---
              const dx = enemy.x - b.x; // Vector from bullet to enemy
              const dy = enemy.y - b.y; // Vector from bullet to enemy
              const dist = Math.hypot(dx, dy) || 1;
              const hitDirection = { x: dx / dist, y: dy / dist };
              // Pass weapon level if available (default 1)
              const weaponLevel = (b as any).level ?? 1;
              // Apply damage and knockback
              if (typeof (window.enemyManager as any).takeDamage === 'function') {
                (window.enemyManager as any).takeDamage(enemy, b.damage, false, false, b.weaponType, window.player?.x, window.player?.y, weaponLevel);
              }
              break; // Stop at first hit
            }
          }
        }

        // If collision detected OR life expires, trigger explosion event and deactivate projectile
        if (hitEnemy || b.life <= 0) {
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
           continue; // Skip adding to activeBullets for this frame, as it's now inactive and exploded
         }
         activeBullets.push(b); // Only push if it's still active (didn't explode/expire)
         continue;
       }
      // --- End Mech Mortar logic ---

      // General collision detection for all other weapons
      if (window.enemyManager && typeof window.enemyManager.getEnemies === 'function') {
        for (const enemy of window.enemyManager.getEnemies()) {
          if (!enemy.active || enemy.hp <= 0) continue; // Only check active, alive enemies

          const dx = b.x - enemy.x;
          const dy = b.y - enemy.y;
          const dist = Math.hypot(dx, dy);

          if (dist < b.radius + enemy.radius) {
            // Collision detected
            b.active = false; // Deactivate bullet on hit
            this.bulletPool.push(b); // Return to pool

            // Calculate hit direction from bullet to enemy for knockback (pushes enemy away from bullet)
            const hitDirection = { x: (enemy.x - b.x) / dist, y: (enemy.y - b.y) / dist };
            const weaponLevel = (b as any).level ?? 1; // Pass weapon level if available (default 1)

            if (typeof (window.enemyManager as any).takeDamage === 'function') {
              (window.enemyManager as any).takeDamage(enemy, b.damage, false, false, b.weaponType, window.player?.x, window.player?.y, weaponLevel);
            }
            break; // Stop at first hit for this bullet
          }
        }
      }

      // Basic movement for other weapons
      b.x += b.vx;
      b.y += b.vy;
      b.life--;
      if (b.life <= 0) {
        // For BIO_TOXIN, spawn a poison puddle on expiry
        if (b.weaponType === WeaponType.BIO_TOXIN) {
          if (window.enemyManager && typeof (window.enemyManager as any).spawnPoisonPuddle === 'function') {
            (window.enemyManager as any).spawnPoisonPuddle(b.x, b.y);
          }
        }
        b.active = false; // Mark as inactive to be returned to pool
        this.bulletPool.push(b);
        continue;
      }
      activeBullets.push(b); // Keep active bullets
    }
    this.bullets = activeBullets; // Update the active bullets list
  }

  public draw(ctx: CanvasRenderingContext2D) {
    for (const b of this.bullets) {
      if (!b.active) continue;
      ctx.save();
      let visual: any = b.projectileVisual ?? { type: 'bullet', color: '#0ff', size: b.radius, glowColor: '#0ff', glowRadius: 8 };

      // --- Mech Mortar drawing (REMOVED - now handled by general bullet drawing) ---
      // if (b.weaponType === WeaponType.MECH_MORTAR) { ... removed ... }

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

    Logger.debug(`[BulletManager.spawnBullet] Bullet spawned: x=${b.x}, y=${b.y}, vx=${b.vx}, vy=${b.vy}, weaponType=${weapon}, damage=${b.damage}, active=${b.active}`);
    this.bullets.push(b);
  }
}
