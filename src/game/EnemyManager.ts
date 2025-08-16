export type Enemy = { x: number; y: number; hp: number; maxHp: number; radius: number; speed: number; active: boolean; type: 'small' | 'medium' | 'large'; damage: number; _damageFlash?: number; _lastDamageTime?: number; id: string;
  _lastHitByWeapon?: WeaponType; // Track the last weapon type that hit this enemy
  knockbackVx?: number; // Knockback velocity X
  knockbackVy?: number; // Knockback velocity Y
  knockbackTimer?: number; // Frames remaining for knockback
};

export type Chest = { x: number; y: number; radius: number; active: boolean; }; // New Chest type

import { Player } from './Player';
import type { Bullet } from './Bullet';
import { ParticleManager } from './ParticleManager';
import type { Gem } from './Gem';
import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';
import { Logger } from '../core/Logger';
import { WEAPON_SPECS } from './WeaponConfig';

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
  private enemyPool: Enemy[] = []; // Explicit enemy pool
  private particleManager: ParticleManager | null = null;
  private gems: Gem[] = [];
  private gemPool: Gem[] = []; // Explicit gem pool
  private chests: Chest[] = []; // Active chests
  private chestPool: Chest[] = []; // Chest pool
  private assetLoader: AssetLoader | null = null;
  private waves: Wave[];

  // Poison puddle system
  private poisonPuddles: { x: number, y: number, radius: number, life: number, maxLife: number, active: boolean }[] = [];

  /**
   * EnemyManager constructor
   * @param player Player instance
   * @param particleManager ParticleManager instance
   * @param assetLoader AssetLoader instance
   * @param difficulty Difficulty multiplier
   */
  constructor(player: Player, particleManager?: ParticleManager, assetLoader?: AssetLoader, difficulty: number = 1) {
    this.player = player;
    this.particleManager = particleManager || null;
    this.assetLoader = assetLoader || null;
    this.preallocateEnemies(difficulty);
    this.preallocateGems();
    this.preallocateChests();
    this.waves = [
      { startTime: 0,    enemyType: 'small',  count: 20, spawnInterval: 60, spawned: 0, lastSpawnTime: 0, spawnPattern: 'normal' },
      { startTime: 30,   enemyType: 'small',  count: 30, spawnInterval: 45, spawned: 0, lastSpawnTime: 0, spawnPattern: 'normal' },
      { startTime: 60,   enemyType: 'medium', count: 15, spawnInterval: 90, spawned: 0, lastSpawnTime: 0, spawnPattern: 'ring' },
      { startTime: 90,   enemyType: 'small',  count: 50, spawnInterval: 30, spawned: 0, lastSpawnTime: 0, spawnPattern: 'normal' },
      { startTime: 120,  enemyType: 'medium', count: 25, spawnInterval: 75, spawned: 0, lastSpawnTime: 0, spawnPattern: 'cone' },
      { startTime: 150,  enemyType: 'large',  count: 10, spawnInterval: 120, spawned: 0, lastSpawnTime: 0, spawnPattern: 'normal' },
      { startTime: 180,  enemyType: 'small',  count: 100, spawnInterval: 20, spawned: 0, lastSpawnTime: 0, spawnPattern: 'surge' },
      { startTime: 210,  enemyType: 'medium', count: 40, spawnInterval: 60, spawned: 0, lastSpawnTime: 0, spawnPattern: 'normal' },
      { startTime: 240,  enemyType: 'large',  count: 20, spawnInterval: 90, spawned: 0, lastSpawnTime: 0, spawnPattern: 'ring' },
    ];
    // Listen for spawnChest event from BossManager
    window.addEventListener('spawnChest', (e: Event) => {
      const customEvent = e as CustomEvent;
      this.spawnChest(customEvent.detail.x, customEvent.detail.y);
    });
  }

  private preallocateEnemies(difficulty: number): void {
    const initial = Math.floor(20 * difficulty * 2); // Increased initial pool size
    for (let i = 0; i < initial; i++) {
      this.enemyPool.push({ x: 0, y: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, active: false, type: 'small', damage: 0, id: '', _lastHitByWeapon: undefined }); // Initialize with empty ID and last hit
    }
  }

  private preallocateGems(): void {
    for (let i = 0; i < 100; i++) { // Increased gem pool size
      this.gemPool.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, value: 0, active: false });
    }
  }

  private preallocateChests(): void {
    for (let i = 0; i < 10; i++) { // Pre-allocate a small number of chests
      this.chestPool.push({ x: 0, y: 0, radius: 16, active: false });
    }
  }

  public getEnemies() {
    return this.enemies.filter(e => e.active);
  }

  public getGems() {
    return this.gems.filter(g => g.active);
  }

  public getChests() {
    return this.chests.filter(c => c.active);
  }

  /**
   * Applies damage to an enemy and handles related effects.
   * Also applies knockback based on weapon spec and level.
   * @param enemy The enemy to apply damage to.
   * @param amount The amount of damage to apply.
   * @param isCritical Whether the damage is critical (defaults to false).
   * @param ignoreActiveCheck If true, damage is applied even if enemy is inactive or has 0 HP (for AoE effects).
   * @param sourceWeaponType The weapon type that caused the damage.
   * @param hitDirection Optional: normalized {x, y} direction vector from projectile/player to enemy
   * @param weaponLevel Optional: weapon level for scaling knockback
   */
  public takeDamage(enemy: Enemy, amount: number, isCritical: boolean = false, ignoreActiveCheck: boolean = false, sourceWeaponType?: WeaponType, playerX?: number, playerY?: number, weaponLevel?: number): void {
    if (!ignoreActiveCheck && (!enemy.active || enemy.hp <= 0)) return; // Only damage active, alive enemies unless ignored

    enemy.hp -= amount;
    enemy._damageFlash = 8; // Visual feedback for damage
    if (sourceWeaponType !== undefined) {
      enemy._lastHitByWeapon = sourceWeaponType;
      // --- Knockback logic ---
      /**
       * hitDirection must be a normalized vector FROM source (bullet/player) TO enemy.
       * Knockback should push enemy AWAY from source, so use (enemy.x - source.x).
       */
      const spec = WEAPON_SPECS[sourceWeaponType];
      if (spec && spec.knockback && playerX !== undefined && playerY !== undefined) {
        let knockback = spec.knockback;
        if (weaponLevel && weaponLevel > 1) {
          knockback *= 1 + (weaponLevel - 1) * 0.25; // 25% more per level
        }
        // Calculate direction from player to enemy
        const dx = enemy.x - playerX;
        const dy = enemy.y - playerY;
        const dist = Math.hypot(dx, dy) || 1;
        const hitDirection = { x: dx / dist, y: dy / dist };

        enemy.knockbackVx = hitDirection.x * knockback;
        enemy.knockbackVy = hitDirection.y * knockback;
        enemy.knockbackTimer = 8; // Knockback lasts for 8 frames (~133ms)
      }
    }
    window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount: amount, isCritical: isCritical } }));
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
    // Draw entities relative to the already translated camera context
    for (let i = 0, len = this.enemies.length; i < len; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
      ctx.fillStyle = enemy.hp > 0 ? '#f00' : '#222';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.closePath();
      // Draw HP bar
      const hpBarWidth = enemy.radius * 2;
      const hpBarHeight = 4;
      const hpBarX = enemy.x - enemy.radius;
      const hpBarY = enemy.y - enemy.radius - 10; // 10 pixels above enemy

      // Background for HP bar
      ctx.fillStyle = '#333';
      ctx.fillRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);

      // Current HP
      const currentHpWidth = (enemy.hp / enemy.maxHp) * hpBarWidth;
      ctx.fillStyle = '#0F0'; // Green color for HP
      ctx.fillRect(hpBarX, hpBarY, currentHpWidth, hpBarHeight);

      // Border for HP bar
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);
    }
    for (let i = 0, len = this.gems.length; i < len; i++) {
      const gem = this.gems[i];
      if (!gem.active) continue;
      ctx.beginPath();
      ctx.arc(gem.x, gem.y, gem.size, 0, Math.PI * 2); // Use gem.x, gem.y directly
      ctx.fillStyle = '#ff0';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#888';
      ctx.stroke();
      ctx.closePath();
    }
    for (let i = 0, len = this.chests.length; i < len; i++) {
      const chest = this.chests[i];
      if (!chest.active) continue;
      ctx.beginPath();
      ctx.arc(chest.x, chest.y, chest.radius, 0, Math.PI * 2); // Use chest.x, chest.y directly
      ctx.fillStyle = '#00f';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.closePath();
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
    // Wave-based spawning
    for (let w = 0; w < this.waves.length; w++) {
      const wave = this.waves[w];
      if (gameTime >= wave.startTime && wave.spawned < wave.count) {
        if ((gameTime * 1000) - wave.lastSpawnTime > wave.spawnInterval) {
          this.spawnEnemy(wave.enemyType, gameTime, wave.spawnPattern);
          wave.spawned++;
          wave.lastSpawnTime = gameTime * 1000;
        }
      }
    }

    // Update enemies
    const playerX = this.player.x;
    const playerY = this.player.y;
    for (let i = 0, len = this.enemies.length; i < len; i++) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;
      // Calculate distance to player for movement and collision
      const dx = playerX - enemy.x;
      const dy = playerY - enemy.y;
      const dist = Math.hypot(dx, dy);
      // Apply knockback velocity if active
      if (enemy.knockbackTimer && enemy.knockbackTimer > 0) {
        enemy.x += enemy.knockbackVx ?? 0;
        enemy.y += enemy.knockbackVy ?? 0;
        // Decay knockback velocity
        enemy.knockbackVx = (enemy.knockbackVx ?? 0) * 0.7;
        enemy.knockbackVy = (enemy.knockbackVy ?? 0) * 0.7;
        enemy.knockbackTimer--;
      } else {
        enemy.knockbackVx = 0;
        enemy.knockbackVy = 0;
        enemy.knockbackTimer = 0;
        // Move toward player
        if (dist > enemy.radius) { // Use radius to prevent jittering when close
          enemy.x += (dx / dist) * enemy.speed;
          enemy.y += (dy / dist) * enemy.speed;
        }
      }
      // Player-enemy collision
      if (dist < enemy.radius + this.player.radius) {
        this.player.takeDamage(enemy.damage);
      }
      // Bullet collisions
      for (let b = 0; b < bullets.length; b++) {
        const bullet = bullets[b];
        if (!bullet.active) continue;
        const ddx = bullet.x - enemy.x;
        const ddy = bullet.y - enemy.y;
        const d = Math.hypot(ddx, ddy);
        if (d < enemy.radius + bullet.radius) {
          const hitDirection = d > 0 ? { x: ddx / d, y: ddy / d } : { x: 0, y: 0 };
          const weaponLevel = (bullet as any).level ?? 1;
          const isCritical = Math.random() < 0.15;
          const criticalMultiplier = isCritical ? 2.0 : 1.0;
          const damageAmount = bullet.damage * criticalMultiplier;
          this.takeDamage(enemy, damageAmount, isCritical, false, bullet.weaponType as WeaponType, this.player.x, this.player.y, weaponLevel); // Apply bullet damage and knockback
          // Deactivate bullet immediately on hit (removed Mech Mortar exception)
          bullet.active = false;
          if (this.particleManager) this.particleManager.spawn(enemy.x, enemy.y, 1, '#f00');
        }
      }
      // Death handling
      if (enemy.hp <= 0 && enemy.active) {
        enemy.active = false;
        this.spawnGem(enemy.x, enemy.y, 1);
        // Dispatch enemy death explosion event only if killed by a mortar
        if (enemy._lastHitByWeapon === WeaponType.MECH_MORTAR) {
          window.dispatchEvent(new CustomEvent('enemyDeathExplosion', {
            detail: {
              x: enemy.x,
              y: enemy.y,
              damage: enemy.damage * 2, // Increased damage for enemy death explosion
              radius: 150, // Larger radius for enemy death explosion
              color: '#FF4500' // Orange-red color for death explosion
            }
          }));
        }
        this.enemyPool.push(enemy);
      }
    }
    // update gems
    for (let i = 0, len = this.gems.length; i < len; i++) {
      const g = this.gems[i];
      if (!g.active) continue;

      // Magnet effect: gently float toward player everywhere
      const ddx = this.player.x - g.x;
      const ddy = this.player.y - g.y;
      const dist = Math.hypot(ddx, ddy);
      const pullStrength = 0.7; // Lower = slower
      g.vx = (ddx / (dist || 1)) * pullStrength;
      g.vy = (ddy / (dist || 1)) * pullStrength;
      // Update position
      g.x += g.vx * (deltaTime / 1000); // Use deltaTime
      g.y += g.vy * (deltaTime / 1000); // Use deltaTime
      // Extend gem life so they last longer
      g.life--;
      if (g.life <= -300) { // Give extra time before expiring
        g.active = false;
        this.gemPool.push(g); // Return to pool
      }
      // Pickup if near player
      if (dist < 18) {
        this.player.gainExp(g.value);
        g.active = false;
        if (this.particleManager) this.particleManager.spawn(g.x, g.y, 1, '#0ff');
        this.gemPool.push(g); // Return to pool
      }
    }
    this.gems = this.gems.filter(g => g.active);

    // Update chests
    this.updateChests(deltaTime);

    // Poison puddle update (ensure this runs every frame)
    this.updatePoisonPuddles();
  }

  private spawnEnemy(type: 'small' | 'medium' | 'large', gameTime: number, pattern: 'normal' | 'ring' | 'cone' | 'surge' = 'normal') {
    let enemy = this.enemyPool.pop();
    if (!enemy) {
      enemy = { x: 0, y: 0, hp: 0, maxHp: 0, radius: 0, speed: 0, active: false, type: 'small', damage: 0, id: '', _lastHitByWeapon: undefined };
    }
    enemy.active = true;
    enemy.type = type;
    enemy.id = `enemy-${Date.now()}-${Math.random().toFixed(4)}`; // Assign unique ID
    enemy._damageFlash = 0;
    switch (type) {
      case 'small':
        enemy.hp = 50; // Increased HP for small enemies
        enemy.maxHp = 50;
        enemy.radius = 12;
        enemy.speed = 1.5 * 0.4; // Further reduced speed (40% of original)
        enemy.damage = 5;
        break;
      case 'medium':
        enemy.hp = 150; // Increased HP for medium enemies
        enemy.maxHp = 150;
        enemy.radius = 18;
        enemy.speed = 1 * 0.4; // Further reduced speed (40% of original)
        enemy.damage = 10;
        break;
      case 'large':
        enemy.hp = 400; // Increased HP for large enemies
        enemy.maxHp = 400;
        enemy.radius = 24;
        enemy.speed = 0.7 * 0.4; // Further reduced speed (40% of original)
        enemy.damage = 20;
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
    enemy.x = spawnX;
    enemy.y = spawnY;
    this.enemies.push(enemy);
  }

  private spawnGem(x: number, y: number, value = 1) {
    let gem = this.gemPool.pop(); // Try to get from pool
    if (!gem) {
      // If pool is empty, create a new one
      gem = { x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, value: 0, active: false };
    }

    // Reset and initialize gem properties
    gem.x = x;
    gem.y = y;
    gem.vx = (Math.random() - 0.5) * 2; // Initial random velocity
    gem.vy = (Math.random() - 0.5) * 2;
    gem.life = 1200; // Make gems last much longer
    gem.size = 6;
    gem.value = value;
    gem.active = true;
    this.gems.push(gem);
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
    this.chests = this.chests.filter(c => c.active);
  }
}

