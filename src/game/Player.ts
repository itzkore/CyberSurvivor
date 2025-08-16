import { keyState } from './keyState';
import { Bullet } from './Bullet';
import { Enemy } from './EnemyManager';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
import { Logger } from '../core/Logger';

/**
 * Player entity class. Handles movement, shooting, upgrades, and rendering.
 * @group Player
 */
export class Player {
  public x: number;
  public y: number;
  public radius: number = 8;
  /**
   * Movement speed of the player (units per tick)
   */
  public speed: number = 4.0; // Increased for better game feel
  public hp: number = 100;
  public maxHp: number = 100;
  public strength: number = 5;
  public intelligence: number = 5;
  public agility: number = 5;
  public luck: number = 5;
  public defense: number = 5;
  public regen: number = 0; // HP regeneration per second
  public shape: 'circle' | 'square' | 'triangle' = 'circle'; // Added shape property
  public color: string = '#00FFFF'; // Added color property
  private _exp: number = 0;
  public level: number = 1;
  public activeWeapons: Map<WeaponType, number> = new Map();
  public activePassives: { type: string, level: number }[] = [];
  public upgrades: string[] = []; // Tracks all upgrades

  private shootCooldowns: Map<WeaponType, number> = new Map();
  private enemyProvider: () => Enemy[] = () => [];

  // passive modifiers (may be set by passive upgrades)
  public fireRateModifier: number = 1;
  public bulletDamage: number = 10;
  public magnetRadius: number = 50; // Radius for gem collection
  public attackSpeed: number = 1; // Attack speed multiplier (1 = base)

  private gameContext: any; // Holds references to managers like bulletManager, assetLoader

  // Ability system (AAA-like): temporary speed boost
  private baseSpeed: number;
  private abilityCooldown: number = 0;
  private abilityTicks: number = 0;
  private abilityDuration: number = 180; // frames (~3s at 60fps)
  private abilityActive: boolean = false;

  // Animation properties (no longer used for player look, but kept for other potential animations)
  private currentFrame: number = 0;
  private frameTimer: number = 0;
  private animationSpeed: number = 8; // frames per second
  private animationFrames: number = 4; // total frames in animation

  public characterData?: any;
  public classWeaponType?: WeaponType; // Cache class weapon type
  constructor(x: number, y: number, characterData?: any) {
    this.x = x;
    this.y = y;
    this.baseSpeed = this.speed;
    if (characterData) {
      this.characterData = characterData;
      // Always apply full character data (stats, visuals, weapon)
      this.applyCharacterData(characterData);
      // Clear all weapons and add only the default weapon
      this.activeWeapons.clear();
      if (characterData.defaultWeapon !== undefined) {
        this.addWeapon(characterData.defaultWeapon);
      }
    }
    // Fallback: if no weapons present, add a default weapon (first in WeaponType enum)
    if (this.activeWeapons.size === 0) {
      const weaponTypes = Object.values(WeaponType).filter(v => typeof v === 'number') as WeaponType[];
      if (weaponTypes.length > 0) {
        this.addWeapon(weaponTypes[0]);
        Logger.warn('[Player] No default weapon found in characterData, fallback to first WeaponType.');
      }
    }
    window.addEventListener('chestPickedUp', this.handleChestPickup.bind(this));
  }

  get exp(): number {
    return this._exp;
  }

  set exp(value: number) {
    this._exp = value;
    this.levelUpIfNeeded();
  }

  private levelUpIfNeeded() {
    while (this._exp >= this.getNextExp()) {
      this._exp -= this.getNextExp();
      this.level++;
      window.dispatchEvent(new CustomEvent('levelup'));
    }
  }

  public getNextExp(): number {
    return 4 + (this.level - 1) * 3;
  }

  public gainExp(amount: number) {
    this.exp += amount;
  }

  public setEnemyProvider(provider: () => Enemy[]) {
    this.enemyProvider = provider;
  }

  public addWeapon(type: WeaponType) {
    const spec = WEAPON_SPECS[type];
    if (!spec) {
      Logger.warn(`Attempted to add unknown weapon type: ${type}`);
      return;
    }

    let currentLevel = this.activeWeapons.get(type) || 0;
    Logger.debug(`[addWeapon] Before: type=${type}, currentLevel=${currentLevel}, activeWeapons=${Array.from(this.activeWeapons.entries())}`);
    if (currentLevel < spec.maxLevel) {
      this.activeWeapons.set(type, currentLevel + 1);
      this.upgrades.push(`Weapon Upgrade: ${spec.name} Lv.${currentLevel + 1}`);
      Logger.info(`Weapon ${spec.name} leveled up to Lv.${currentLevel + 1}`);

      // Check for evolution if max level is reached
      if (currentLevel + 1 === spec.maxLevel && spec.evolution) {
        this.tryEvolveWeapon(type, spec.evolution.evolvedWeaponType, spec.evolution.requiredPassive);
      }
    } else if (currentLevel === spec.maxLevel) {
      Logger.debug(`Weapon ${spec.name} is already at max level.`);
      // Still check for evolution if it's at max level and hasn't evolved yet
      if (spec.evolution) {
        this.tryEvolveWeapon(type, spec.evolution.evolvedWeaponType, spec.evolution.requiredPassive);
      }
    } else {
      // This case should ideally not happen if logic is correct, but for safety
      Logger.warn(`Weapon ${spec.name} level (${currentLevel}) exceeds maxLevel (${spec.maxLevel}).`);
    }

    // Initialize cooldown if weapon is new
    if (!this.shootCooldowns.has(type)) {
      this.shootCooldowns.set(type, 0);
    }
    Logger.debug(`[addWeapon] After: type=${type}, newLevel=${this.activeWeapons.get(type)}, activeWeapons=${Array.from(this.activeWeapons.entries())}`);
  }

  private tryEvolveWeapon(baseWeaponType: WeaponType, evolvedWeaponType: WeaponType, requiredPassiveName: string): void {
    const baseWeaponSpec = WEAPON_SPECS[baseWeaponType];
    const evolvedWeaponSpec = WEAPON_SPECS[evolvedWeaponType];

    if (!baseWeaponSpec || !evolvedWeaponSpec) {
      Logger.error(`Evolution failed: Missing weapon spec for ${baseWeaponType} or ${evolvedWeaponType}`);
      return;
    }

    const passive = this.activePassives.find(p => p.type === requiredPassiveName);
    const requiredPassiveSpec = PASSIVE_SPECS.find(p => p.name === requiredPassiveName);

    if (passive && requiredPassiveSpec && passive.level >= requiredPassiveSpec.maxLevel) {
      // Conditions met for evolution
      Logger.info(`Evolving ${baseWeaponSpec.name} to ${evolvedWeaponSpec.name}!`);

      // Remove base weapon and add evolved weapon
      this.activeWeapons.delete(baseWeaponType);
      this.shootCooldowns.delete(baseWeaponType);

      // Add evolved weapon at level 1 (or specific starting level if needed)
      this.activeWeapons.set(evolvedWeaponType, 1);
      this.shootCooldowns.set(evolvedWeaponType, 0); // Reset cooldown for new weapon

      this.upgrades.push(`Weapon Evolution: ${baseWeaponSpec.name} -> ${evolvedWeaponSpec.name}`);

      // Optionally, remove the passive or reset its level if it's consumed by evolution
      // For now, we'll keep the passive, as is common in VS-likes.

      // Dispatch an event for UI to react to evolution
      window.dispatchEvent(new CustomEvent('weaponEvolved', { detail: { baseWeaponType, evolvedWeaponType } }));
    } else {
      Logger.debug(`Evolution conditions not met for ${baseWeaponSpec.name}. Requires ${requiredPassiveName} at max level.`);
    }
  }

  private hasPassiveMaxLevel(passiveName: string): boolean {
    const passive = this.activePassives.find(p => p.type === passiveName);
    const passiveSpec = PASSIVE_SPECS.find(p => p.name === passiveName);
    return !!(passive && passiveSpec && passive.level >= passiveSpec.maxLevel);
  }

  public addPassive(type: string) {
    const existing = this.activePassives.find(p => p.type === type);
    const passiveSpec = PASSIVE_SPECS.find(p => p.name === type);

    Logger.debug(`[addPassive] Before: type=${type}, existingLevel=${existing?.level}, activePassives=${JSON.stringify(this.activePassives)}`);
    if (!passiveSpec) {
      Logger.warn(`Attempted to add unknown passive type: ${type}`);
      return;
    }

    if (existing) {
      if (existing.level < passiveSpec.maxLevel) {
        existing.level++;
        applyPassive(this, passiveSpec.id, existing.level);
        this.upgrades.push(`Passive Upgrade: ${type} Lv.${existing.level}`);
        Logger.info(`Passive ${type} leveled up to Lv.${existing.level}`);
      } else {
        Logger.debug(`Passive ${type} is already at max level.`);
      }
    } else {
      const newPassive = { type, level: 1 };
      this.activePassives.push(newPassive);
      applyPassive(this, passiveSpec.id, newPassive.level);
      this.upgrades.push(`Passive Unlock: ${type} Lv.1`);
      Logger.info(`Passive ${type} unlocked at Lv.1`);
    }
    Logger.debug(`[addPassive] After: type=${type}, activePassives=${JSON.stringify(this.activePassives)}`);
  }

  public setGameContext(ctx: any) {
    this.gameContext = ctx;
  }

  // Removed setPlayerLook as player look is now based on shape/color

  private findNearestEnemy(): Enemy | null {
    // Autoaim: prioritize boss if present and alive
    let boss = null;
    if (this.gameContext && typeof this.gameContext.bossManager?.getActiveBoss === 'function') {
      boss = this.gameContext.bossManager.getActiveBoss();
      if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
        Logger.debug(`[findNearestEnemy] Boss found: x=${boss.x}, y=${boss.y}, hp=${boss.hp}, active=${boss.active}, state=${boss.state}`);
        return boss as any;
      }
    }
    const enemies = this.enemyProvider ? this.enemyProvider() : [];
    Logger.debug(`[findNearestEnemy] Candidates: ${enemies.length}`);
    let nearest: Enemy | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const e of enemies) {
      Logger.debug(`[findNearestEnemy] Checking enemy: x=${e.x}, y=${e.y}, hp=${e.hp}, active=${e.active}, state=${(e as any).state}`);
      if (!e || (e as any).active === false || (e.hp != null && e.hp <= 0)) {
        Logger.debug(`[findNearestEnemy] Skipped: inactive or dead`);
        continue; // Only target active, alive enemies
      }
      const dx = (e.x ?? 0) - (this.x ?? 0);
      const dy = (e.y ?? 0) - (this.y ?? 0);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; nearest = e; }
    }
    if (nearest) {
      Logger.debug(`[findNearestEnemy] Nearest: x=${nearest.x}, y=${nearest.y}, hp=${nearest.hp}, active=${nearest.active}`);
    } else {
      Logger.debug(`[findNearestEnemy] No valid enemy found`);
    }
    return nearest;
  }

  private shootAt(target: Enemy, weaponType: WeaponType) {
    if (this.gameContext?.bulletManager) {
      const bm = this.gameContext.bulletManager;
      const spec = WEAPON_SPECS[weaponType as keyof typeof WEAPON_SPECS];
      if (spec) {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const baseAngle = Math.atan2(dy, dx);

        // Use weapon-specific stats, not class stats
        const speed = spec.speed;
        const toShoot = spec.salvo;
        const spread = spec.spread;
        // Only use class stats for class default weapon, otherwise use base bulletDamage
        let bulletDamage = this.bulletDamage;
        if (this.characterData && weaponType !== this.characterData.defaultWeapon) {
          bulletDamage = 10; // Use base damage for non-class weapons (or set per weapon if needed)
        }

        Logger.debug(`[Player.shootAt] Spawning ${toShoot} bullets with weapon ${weaponType}, damage: ${bulletDamage}`);
        for (let i = 0; i < toShoot; i++) {
          const angle = baseAngle + (i - (toShoot - 1) / 2) * spread;
          bm.spawnBullet(this.x, this.y, this.x + Math.cos(angle) * 100, this.y + Math.sin(angle) * 100, weaponType, bulletDamage);
        }
      } else {
        Logger.warn(`[Player.shootAt] No weapon spec found for weaponType: ${weaponType}`);
      }
    } else {
      Logger.warn('[Player.shootAt] No bulletManager in gameContext');
    }
  }

  public update(delta: number) {
    if (window.navigator.userAgent.includes('Mobile')) return; // Touch handled elsewhere
    // Movement (micro-optimized)
    let dx = 0, dy = 0;
    if (keyState['arrowup'] || keyState['w']) dy -= 1;
    if (keyState['arrowdown'] || keyState['s']) dy += 1;
    if (keyState['arrowleft'] || keyState['a']) dx -= 1;
    if (keyState['arrowright'] || keyState['d']) dx += 1;
    if (dx !== 0 || dy !== 0) {
      // Precompute magnitude and reuse vector
      const mag = Math.sqrt(dx * dx + dy * dy);
      const normX = dx / mag;
      const normY = dy / mag;
      this.x += normX * this.speed;
      this.y += normY * this.speed;

      // Clamp player position to world boundaries
      if (this.gameContext) {
        this.x = Math.max(this.radius, Math.min(this.x, this.gameContext.worldW - this.radius));
        this.y = Math.max(this.radius, Math.min(this.y, this.gameContext.worldH - this.radius));
      }

      // Animation frame only when moving (still relevant for other animations if any)
      this.frameTimer++;
      if (this.frameTimer >= (60 / this.animationSpeed)) { // Assuming 60 FPS
        this.currentFrame = (this.currentFrame + 1) % this.animationFrames;
        this.frameTimer = 0;
      }

      // Spawn a small number of particles at the player's feet
      if (this.gameContext?.particleManager) {
        // Only spawn a particle every 8 frames for minimal effect
        if (this.frameTimer % 8 === 0) {
          this.gameContext.particleManager.spawn(this.x, this.y + this.radius / 2, 1, '#00FFFF');
        }
      }
    } else {
      // If not moving, reset animation to first frame (idle)
      this.currentFrame = 0;
      this.frameTimer = 0;
    }

    // Update cooldowns and shoot for all active weapons
    // Debug: Log active weapons and cooldowns
    Logger.debug(`[Player.update] ActiveWeapons: ${Array.from(this.activeWeapons.entries()).map(([wt, lvl]) => wt + ':' + lvl).join(', ')}`);
    this.activeWeapons.forEach((level, weaponType) => {
      let cooldown = this.shootCooldowns.get(weaponType) ?? 0;
      Logger.debug(`[Player.update] Weapon ${weaponType} Cooldown: ${cooldown}`);
      cooldown--;
      // Clamp cooldown to zero if negative
      if (cooldown < 0) cooldown = 0;
      this.shootCooldowns.set(weaponType, cooldown);

      if (cooldown <= 0) {
        const t = this.findNearestEnemy();
        Logger.debug(`[Player.update] Nearest Enemy: ${t ? (t.x + ',' + t.y) : 'None'}`);
        if (t) {
          Logger.debug(`[Player.update] Shooting at enemy with weapon ${weaponType}`);
          this.shootAt(t, weaponType);
          const spec = WEAPON_SPECS[weaponType as keyof typeof WEAPON_SPECS];
          const baseCooldown = spec?.cooldown ?? 10;
          const newCooldown = Math.max(1, Math.floor(baseCooldown / (this.fireRateModifier * this.attackSpeed))); // cooldown reduced by attackSpeed
          this.shootCooldowns.set(weaponType, newCooldown);
          Logger.debug(`[Player.update] Weapon ${weaponType} shot, new cooldown: ${newCooldown}`);
        }
      }
    });

    // Gem collection (magnet effect)
    const gems = (this.gameContext as any)?.enemyManager?.getGems() ?? [];
    for (const g of gems) {
      if (!g.active) continue;
      const dx = g.x - this.x;
      const dy = g.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && dist < this.magnetRadius) { // Add check for dist > 0
        // Move gem towards player
        g.x -= (dx / dist) * 1.5; // Move speed of gem (negated for pull)
        g.y -= (dy / dist) * 1.5; // Move speed of gem (negated for pull)
      }
    }

    // Ability cooldown/duration handling
    if (this.abilityActive) {
      this.abilityTicks++;
      if (this.abilityTicks >= this.abilityDuration) {
        // end ability
        this.abilityActive = false;
        this.speed = this.baseSpeed;
      }
    }
    if (this.abilityCooldown > 0) {
      this.abilityCooldown--;
    }
  }

  public takeDamage(amount: number) {
    this.hp -= amount;
    // Ensure HP doesn't go below 0
    if (this.hp < 0) this.hp = 0;
  }

  /**
   * Applies character data to the player instance.
   * Supports both flat properties and nested stats objects.
   */
  public applyCharacterData(data: any) {
    if (!data) return;
    if (data.defaultWeapon !== undefined) {
      this.classWeaponType = data.defaultWeapon;
    }
    if (data.stats) {
      if (data.stats.hp !== undefined) this.hp = data.stats.hp;
      if (data.stats.maxHp !== undefined) this.maxHp = data.stats.maxHp;
      if (data.stats.speed !== undefined) this.speed = data.stats.speed;
      if (data.stats.damage !== undefined) this.bulletDamage = data.stats.damage; // Map character damage to bulletDamage
      // Add other stats as needed
      if (data.stats.strength !== undefined) this.strength = data.stats.strength;
      if (data.stats.intelligence !== undefined) this.intelligence = data.stats.intelligence;
      if (data.stats.agility !== undefined) this.agility = data.stats.agility;
      if (data.stats.luck !== undefined) this.luck = data.stats.luck;
      if (data.stats.defense !== undefined) this.defense = data.stats.defense;
    }
    if (data.shape !== undefined) this.shape = data.shape;
    if (data.color !== undefined) this.color = data.color;
    // Set starting weapon to character's defaultWeapon, but do not clear other weapons (allow upgrades to add more)
    if (data.defaultWeapon !== undefined) {
      if (!this.activeWeapons.has(data.defaultWeapon)) {
        this.addWeapon(data.defaultWeapon);
      }
    }
  }

  public draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.beginPath();
    if (this.shape === 'circle') {
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    } else if (this.shape === 'square') {
      ctx.fillRect(this.x - this.radius, this.y - this.radius, this.radius * 2, this.radius * 2);
    } else if (this.shape === 'triangle') {
      ctx.moveTo(this.x, this.y - this.radius);
      ctx.lineTo(this.x + this.radius, this.y + this.radius);
      ctx.lineTo(this.x - this.radius, this.y + this.radius);
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }

  // Optional: trigger current active ability/weapon (if implemented in WEAPON_SPECS)
  public activateAbility() {
    // Simple speed boost ability: increase speed for a short duration
    if (this.abilityCooldown > 0 || this.abilityActive) return;
    this.abilityActive = true;
    this.speed = this.baseSpeed * 1.5; // boost by 50%
    this.abilityTicks = 0;
    // set cooldown end after duration
    this.abilityCooldown = this.abilityDuration + 60; // add a small cooldown after
  }

  private handleChestPickup(): void {
    Logger.info('Chest picked up! Attempting to evolve a weapon...');
    let evolved = false;
    for (const [weaponType, level] of this.activeWeapons.entries()) {
      const spec = WEAPON_SPECS[weaponType];
      if (spec && level === spec.maxLevel && spec.evolution) {
        const passive = this.activePassives.find(p => p.type === spec.evolution!.requiredPassive);
        const requiredPassiveSpec = PASSIVE_SPECS.find(p => p.name === spec.evolution!.requiredPassive);

        if (passive && requiredPassiveSpec && passive.level >= requiredPassiveSpec.maxLevel) {
          this.tryEvolveWeapon(weaponType, spec.evolution.evolvedWeaponType, spec.evolution.requiredPassive);
          evolved = true;
          break; // Only evolve one weapon per chest
        }
      }
    }

    if (!evolved) {
      Logger.info('No weapon could be evolved from chest. Offering a reroll or high-value passive instead.');
      // Optionally, dispatch an event to UpgradePanel to force a reroll or offer a special passive
      window.dispatchEvent(new CustomEvent('forceUpgradeOption', { detail: { type: 'reroll' } }));
    }
  }
}

