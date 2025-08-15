import type { Bullet } from './Bullet';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';

declare global {
  interface Window {
    enemyManager?: {
      getEnemies: () => Array<{ x: number; y: number }>;
    };
    player?: { x: number; y: number };
  }
}

export class BulletManager {
  public bullets: Bullet[] = [];
  private assetLoader: AssetLoader;

  constructor(assetLoader: AssetLoader) {
    this.assetLoader = assetLoader;
  }

  public update() {
  for (const b of this.bullets) {
    if (!b.active) continue;

    // --- Mech Mortar (Titan Mech) logic ---
    if (b.weaponType === WeaponType.MECH_MORTAR) {
      if (!b["_exploded"]) {
        // Direct hit check (simple collision with enemy)
        let hitEnemy = null;
        if (window.enemyManager && typeof window.enemyManager.getEnemies === 'function') {
          for (const enemy of window.enemyManager.getEnemies()) {
            const dx = enemy.x - b.x;
            const dy = enemy.y - b.y;
            const dist = Math.hypot(dx, dy);
            if (dist < (b.radius + 8)) { // collision radius
              hitEnemy = enemy;
              // Simulate direct hit damage: call enemy.takeDamage if available
              // enemy.takeDamage(40); // direct hit damage
              break;
            }
          }
        }
        if (hitEnemy) {
          b["_exploded"] = true;
          b.life = 10; // show explosion for 10 frames
          b.vx = 0;
          b.vy = 0;
          b.x = hitEnemy.x;
          b.y = hitEnemy.y;
          // AOE damage
          if (window.enemyManager && typeof window.enemyManager.getEnemies === 'function') {
            for (const enemy of window.enemyManager.getEnemies()) {
              const dx = enemy.x - b.x;
              const dy = enemy.y - b.y;
              const dist = Math.hypot(dx, dy);
              if (dist < 40) { // AOE radius
                // Simulate AOE damage: call enemy.takeDamage if available
                // enemy.takeDamage(80); // explosion damage
              }
            }
          }
        } else {
          b.x += b.vx;
          b.y += b.vy;
          b.life--;
          // If projectile reaches end of life without hitting, explode at last position
          if (b.life <= 0) {
            b["_exploded"] = true;
            b.life = 10;
            b.vx = 0;
            b.vy = 0;
            // AOE damage at last position
            if (window.enemyManager && typeof window.enemyManager.getEnemies === 'function') {
              for (const enemy of window.enemyManager.getEnemies()) {
                const dx = enemy.x - b.x;
                const dy = enemy.y - b.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 40) {
                  // Simulate AOE damage: call enemy.takeDamage if available
                  // enemy.takeDamage(80);
                }
              }
            }
          }
        }
      } else {
        b.life--;
        if (b.life <= 0) b.active = false;
      }
      continue;
    }
    // --- End Mech Mortar logic ---

    // Basic movement for other weapons
    b.x += b.vx;
    b.y += b.vy;
    b.life--;
    if (b.life <= 0) { b.active = false; continue; }

    // Arcane Orb chain logic
    if (b.weaponType === WeaponType.SORCERER_ORB && b.projectileVisual?.type === 'bullet') {
      if (!b.snakeTargets) b.snakeTargets = [];
      if (b.snakeBounceCount === undefined) b.snakeBounceCount = 0;
      // ...existing code...
      continue;
    }
    // Non-sorcerer fallback: simple lifetime + movement already applied
  }
}


  public draw(ctx: CanvasRenderingContext2D) {
  for (const b of this.bullets) {
    if (!b.active) continue;
    ctx.save();
    const visual = b.projectileVisual;
    // --- Mech Mortar explosion flash ---
    if (b.weaponType === WeaponType.MECH_MORTAR && b["_exploded"]) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 40, 0, Math.PI * 2);
      ctx.fillStyle = '#FFA07A';
      ctx.shadowColor = '#FFA07A';
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.restore();
    } else if (visual?.type === 'bullet') {
      ctx.shadowColor = visual.glowColor ?? visual.color ?? '#FFD700';
      ctx.shadowBlur = visual.glowRadius ?? 10;
      ctx.beginPath();
      ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
      ctx.fillStyle = visual.color ?? '#FFD700';
      ctx.fill();
    } else if (visual?.type === 'plasma' || visual?.type === 'slime') {
      ctx.shadowColor = visual.glowColor ?? visual.color ?? '#0ff';
      ctx.shadowBlur = visual.glowRadius ?? 8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, visual.size ?? b.radius, 0, Math.PI * 2);
      ctx.fillStyle = visual.color ?? '#0ff';
      ctx.fill();
    } else {
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
    }
    ctx.restore();
  }
}

  public spawnBullet(x: number, y: number, targetX: number, targetY: number, weapon: WeaponType, damage: number) {
    const spec = (WEAPON_SPECS as any)[weapon] ?? (WEAPON_SPECS as any)[WeaponType.PISTOL];
    const dx = targetX - x;
    const dy = targetY - y;
    const angle = Math.atan2(dy, dx);
    const speed = (spec?.speed ?? 2);
    const projectileImageKey = spec?.projectile ?? 'bullet_cyan';
    const projectileVisual = spec?.projectileVisual ?? { type: 'bullet', color: '#0ff', size: 6 };

    let b = this.bullets.find((bb) => !bb.active);
    if (!b) {
      const newBullet: Bullet = { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius: 4, life: 90, active: true, damage, speed: speed, weaponType: weapon, projectileImageKey: projectileImageKey, projectileVisual } as Bullet;
      if (weapon === WeaponType.SORCERER_ORB) newBullet.snakeBounceCount = 0;
      this.bullets.push(newBullet);
    } else {
      b.x = x; b.y = y; b.vx = Math.cos(angle) * speed; b.vy = Math.sin(angle) * speed; b.life = 90; b.active = true; b.radius = 4; b.damage = damage; b.speed = speed; b.weaponType = weapon; b.projectileImageKey = projectileImageKey; b.projectileVisual = projectileVisual;
      if (weapon === WeaponType.SORCERER_ORB) b.snakeBounceCount = 0;
    }
  }
}
