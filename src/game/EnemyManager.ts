export type Enemy = { x: number; y: number; hp: number; maxHp: number; radius: number; speed: number; active: boolean; type: 'small' | 'medium' | 'large'; damage: number; _damageFlash?: number };

import { Player } from './Player';
import type { Bullet } from './Bullet';
import { ParticleManager } from './ParticleManager';
import type { Gem } from './Gem';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';

interface Wave {
  startTime: number; // in seconds
  enemyType: 'small' | 'medium' | 'large';
  count: number;
  spawnInterval: number; // in frames
  spawned: number;
  lastSpawnTime: number;
}

export class EnemyManager {
  private player: Player;
  private enemies: Enemy[] = [];
  private particleManager: ParticleManager | null = null;
  private gems: Gem[] = [];
  private assetLoader: AssetLoader | null = null;
  private waves: Wave[];

  // Poison puddle system
  private poisonPuddles: { x: number, y: number, radius: number, life: number, maxLife: number, active: boolean }[] = [];

  constructor(player: Player, particleManager?: ParticleManager, difficulty = 1, assetLoader?: AssetLoader) {
    this.player = player;
    this.particleManager = particleManager || null;
    this.assetLoader = assetLoader || null;
    const initial = Math.floor(20 * difficulty);
    for (let i = 0; i < initial; i++) {
      this.enemies.push({ x: -1000, y: -1000, hp: 0, maxHp: 0, radius: 18, speed: 0, active: false, type: 'small', damage: 0 });
    }
    // gem pool
    for (let i = 0; i < 50; i++) this.gems.push({ x: -9999, y: -9999, vx: 0, vy: 0, life: 0, size: 6, value: 1, active: false });

    this.waves = [
      { startTime: 0,    enemyType: 'small',  count: 20, spawnInterval: 60, spawned: 0, lastSpawnTime: 0 },
      { startTime: 30,   enemyType: 'small',  count: 30, spawnInterval: 45, spawned: 0, lastSpawnTime: 0 },
      { startTime: 60,   enemyType: 'medium', count: 15, spawnInterval: 90, spawned: 0, lastSpawnTime: 0 },
      { startTime: 90,   enemyType: 'small',  count: 50, spawnInterval: 30, spawned: 0, lastSpawnTime: 0 },
      { startTime: 120,  enemyType: 'medium', count: 25, spawnInterval: 75, spawned: 0, lastSpawnTime: 0 },
      { startTime: 150,  enemyType: 'large',  count: 10, spawnInterval: 120, spawned: 0, lastSpawnTime: 0 },
      { startTime: 180,  enemyType: 'small',  count: 100, spawnInterval: 20, spawned: 0, lastSpawnTime: 0 },
      { startTime: 210,  enemyType: 'medium', count: 40, spawnInterval: 60, spawned: 0, lastSpawnTime: 0 },
      { startTime: 240,  enemyType: 'large',  count: 20, spawnInterval: 90, spawned: 0, lastSpawnTime: 0 },
    ];
  }

  public getEnemies() {
    return this.enemies.filter(e => e.active);
  }

  public getGems() {
    return this.gems.filter(g => g.active);
  }

  private spawnPoisonPuddle(x: number, y: number) {
    let puddle = this.poisonPuddles.find(p => !p.active);
    if (!puddle) {
      puddle = { x, y, radius: 32, life: 180, maxLife: 180, active: true };
      this.poisonPuddles.push(puddle);
    } else {
      puddle.x = x;
      puddle.y = y;
      puddle.radius = 32;
      puddle.life = 180;
      puddle.maxLife = 180;
      puddle.active = true;
    }
  }

  private updatePoisonPuddles() {
    for (const puddle of this.poisonPuddles) {
      if (!puddle.active) continue;
      puddle.life--;
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
          enemy.hp -= 2.5; // Stronger poison damage per frame
          enemy._damageFlash = 8;
          didDamage = true;
        }
      }
      // Visual feedback if puddle is damaging
      if (didDamage && this.particleManager) {
        this.particleManager.spawn(puddle.x, puddle.y, 2, '#00FF00');
      }
    }
  }

  public update(bullets: Bullet[] = [], gameTime: number = 0) {
    // Wave-based spawning
    this.waves.forEach(wave => {
      if (gameTime >= wave.startTime && wave.spawned < wave.count) {
        if (gameTime - wave.lastSpawnTime > wave.spawnInterval / 60) {
          this.spawnEnemy(wave.enemyType, gameTime);
          wave.spawned++;
          wave.lastSpawnTime = gameTime;
        }
      }
    });

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0) {
        enemy.x += (dx / dist) * enemy.speed;
        enemy.y += (dy / dist) * enemy.speed;
      }

      // Player-enemy collision (enemy hits player)
      const playerDist = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y);
      if (playerDist < enemy.radius + this.player.radius) {
        this.player.takeDamage(enemy.damage); // Player takes damage from enemy contact
      }

      // Bullet collisions
      for (const b of bullets) {
        if (!b.active) continue;
        const ddx = b.x - enemy.x;
        const ddy = b.y - enemy.y;
        const d = Math.hypot(ddx, ddy);
        if (d < enemy.radius + b.radius) {
          enemy.hp -= b.damage; // Use bullet damage
          enemy._damageFlash = 8; // Enemy flash effect
          // Poison puddle logic for Bio Toxin
          if (b.weaponType === 14) { // WeaponType.BIO_TOXIN
            this.spawnPoisonPuddle(b.x, b.y);
          }
          // Arcane Orb piercing: track hit enemies for snake logic
          if (b.weaponType === 12 && b.projectileVisual?.type === 'bullet') {
            if (!b.snakeTargets) b.snakeTargets = [];
            b.snakeTargets.push(enemy);
            b.snakeRetarget = { x: enemy.x, y: enemy.y };
            // Ricochet chain logic handled in BulletManager
          } else {
            if (!(b as any).piercing) {
              b.active = false;
            }
          }
        }
      }
      if (enemy.hp <= 0) {
        // drop gem
        this.spawnGem(enemy.x, enemy.y, 1);
        if (this.particleManager) this.particleManager.spawn(enemy.x, enemy.y, 10, '#ff0');
        enemy.active = false;
        enemy.x = -1000; enemy.y = -1000;
      }
    }

    // update gems
    for (const g of this.gems) {
      if (!g.active) continue;
  // Magnet effect: gently float toward player everywhere
  const ddx = this.player.x - g.x;
  const ddy = this.player.y - g.y;
  const dist = Math.hypot(ddx, ddy);
  const pullStrength = 0.7; // Lower = slower
  g.vx = (ddx / (dist || 1)) * pullStrength;
  g.vy = (ddy / (dist || 1)) * pullStrength;
  // Update position
  g.x += g.vx;
  g.y += g.vy;
      // Extend gem life so they last longer
      g.life--;
      if (g.life <= -300) { // Give extra time before expiring
        g.active = false;
        g.x = -9999; g.y = -9999;
      }
      // Pickup if near player
      if (dist < 18) {
        this.player.gainExp(g.value);
        g.active = false;
        if (this.particleManager) this.particleManager.spawn(g.x, g.y, 8, '#0ff');
      }
    }

    // Poison puddle update (ensure this runs every frame)
    this.updatePoisonPuddles();
  }

  private spawnGem(x: number, y: number, value = 1) {
    const slot = this.gems.find(g => !g.active);
    const initialLife = 1200; // Make gems last much longer
    if (!slot) {
      this.gems.push({ x, y, vx: 0, vy: 0, life: initialLife, size:6, value, active: true });
      return;
    }
    slot.x = x; slot.y = y; slot.vx = 0; slot.vy = 0; slot.life = initialLife; slot.size = 6; slot.value = value; slot.active = true;
  }

  private spawnEnemy(enemyType: 'small' | 'medium' | 'large', gameTime: number) {
    let slot = this.enemies.find(e => !e.active);
    if (!slot) {
      const newEnemy: Enemy = { x: -1000, y: -1000, hp: 0, maxHp: 0, radius: 18, speed: 0, active: false, type: 'small', damage: 0 };
      this.enemies.push(newEnemy);
      slot = newEnemy;
    }
    // Spawn near the player but farther away for a more epic feel
    const angle = Math.random() * Math.PI * 2;
    const difficulty = 1 + Math.floor(gameTime / 30);
    // Increase spawn radii to reduce early encounters
    const minDist = 600 + (difficulty - 1) * 40;
    const maxDist = 1200 + (difficulty - 1) * 60;
    const dist = minDist + Math.random() * (maxDist - minDist);
    const x = this.player.x + Math.cos(angle) * dist;
    const y = this.player.y + Math.sin(angle) * dist;

    slot!.x = x;
    slot!.y = y;
    slot!.type = enemyType;
    slot!.radius = (enemyType === 'small' ? 12 : enemyType === 'medium' ? 18 : 24);
    slot!.hp = (enemyType === 'small' ? 20 : enemyType === 'medium' ? 40 : 80) + Math.floor((difficulty - 1) * 5);
    slot!.maxHp = slot!.hp;
    slot!.speed = (enemyType === 'small' ? 1.5 : enemyType === 'medium' ? 1.0 : 0.8) + (difficulty - 1) * 0.1;
    slot!.active = true;
    slot!.damage = (enemyType === 'small' ? 5 : enemyType === 'medium' ? 10 : 15); // Damage enemy deals to player
  }

  public draw(ctx: CanvasRenderingContext2D) {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      ctx.save();

      // Use AssetLoader for enemy visuals if available
      const enemyImage = this.assetLoader?.getImage(`enemy_${enemy.type}`);
      if (enemyImage) {
        const drawX = enemy.x - enemy.radius; // Center the image
        const drawY = enemy.y - enemy.radius; // Center the image
        ctx.drawImage(enemyImage, drawX, drawY, enemy.radius * 2, enemy.radius * 2);
      } else {
        // Fallback to simple circle with neon glow
        ctx.shadowColor = '#f0f';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#f0f';
        ctx.fill();
      }
      ctx.restore();

      // HP bar above enemy
      const pct = Math.max(0, enemy.hp) / enemy.maxHp;
      ctx.save();
      // Damage flash and shake effect
      if (enemy._damageFlash && enemy._damageFlash > 0) {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(enemy._damageFlash * 2);
        ctx.translate((Math.random()-0.5)*4, (Math.random()-0.5)*4);
      }
      ctx.fillStyle = '#222';
      ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 12, enemy.radius * 2, 6);
      ctx.fillStyle = '#f00';
      ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 12, enemy.radius * 2 * pct, 6);
      ctx.restore();
    }

    for (const g of this.gems) {
      if (!g.active) continue;
      ctx.save();
      // Use AssetLoader for gem visuals if available
      const gemImage = this.assetLoader?.getImage('gem'); // Assuming a 'gem' asset
      if (gemImage) {
        const drawX = g.x - g.size; // Center the image
        const drawY = g.y - g.size; // Center the image
        ctx.drawImage(gemImage, drawX, drawY, g.size * 2, g.size * 2);
      } else {
        // Fallback to simple circle
        ctx.shadowColor = '#0ff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
        ctx.fillStyle = '#0ff';
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw poison puddles
    for (const puddle of this.poisonPuddles) {
      if (!puddle.active) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0.18, puddle.life / puddle.maxLife);
      ctx.beginPath();
      ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,255,0,0.4)';
      ctx.fill();
      ctx.restore();
    }
  }

  public getAliveCount(): number {
    if (!this.enemies || !Array.isArray(this.enemies)) return 0;
    return this.enemies.filter((e: any) => e && (e as any).active !== false && ((e as any).hp == null || (e as any).hp > 0)).length;
  }
}

