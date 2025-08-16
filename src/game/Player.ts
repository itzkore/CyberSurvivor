import { keyState } from './keyState';
import { Bullet } from './Bullet';
import { Enemy } from './EnemyManager';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
import { Logger } from '../core/Logger';
import { AssetLoader } from './AssetLoader';

/**
 * Player entity class. Handles movement, shooting, upgrades, and rendering.
 * @group Player
 */
export class Player {
  /**
   * Whether the player sprite is currently flipped horizontally (for walk animation)
   */
  private isFlipped: boolean = false;
  /**
   * Timer for flipping animation (in frames)
   */
  private flipTimer: number = 0;
  public x: number;
  public y: number;
  public radius: number = 8;
  /**
   * Size of the player sprite (diameter in pixels)
   */
  public size: number = 64; // Match asset dimensions for visibility

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

  /**
   * Player velocity components (used for directional rendering)
   */
  public vx: number = 0;
  public vy: number = 0;

  /**
   * Rotation angle (radians) for player sprite rendering.
   */
  public rotation: number = 0;

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
      // Special case: Psionic Weaver always starts with PSIONIC_WAVE
      if (characterData.id === 'psionic_weaver') {
        this.activeWeapons.set(WeaponType.PSIONIC_WAVE, 1);
      } else if (characterData.id === 'bio_engineer') {
        this.activeWeapons.set(WeaponType.BIO_TOXIN, 1);
      } else if (characterData.defaultWeapon !== undefined) {
        this.activeWeapons.set(characterData.defaultWeapon, 1);
      }
    }
    /**
     * Fallback: if no weapons present, add the first weapon in characterData.weaponTypes (class weapon),
     * else fallback to first WeaponType enum value (PISTOL).
     */
    if (this.activeWeapons.size === 0) {
      if (this.characterData && Array.isArray(this.characterData.weaponTypes) && this.characterData.weaponTypes.length > 0) {
        this.activeWeapons.set(this.characterData.weaponTypes[0], 1); // Set to level 1
        Logger.warn('[Player] No defaultWeapon found, fallback to first class weapon.');
      } else {
        const weaponTypes = Object.values(WeaponType).filter(v => typeof v === 'number') as WeaponType[];
        if (weaponTypes.length > 0) {
          this.activeWeapons.set(weaponTypes[0], 1); // Set to level 1
          Logger.warn('[Player] No defaultWeapon or class weapon found, fallback to first WeaponType.');
        }
      }
    }
    window.addEventListener('chestPickedUp', this.handleChestPickup.bind(this));
  } // <-- Close constructor here

  /**
   * Handles chest pickup event, granting rewards or upgrades to the player.
   * @param event CustomEvent containing chest reward details
   */
  private handleChestPickup(event: Event): void {
    // Micro-optimized: check for CustomEvent and reward details
    /** @type {CustomEvent} */
    const customEvent = event as CustomEvent;
    const reward = customEvent.detail?.reward;
    if (reward) {
      // Example: reward could be exp, weapon, passive, or hp
      if (reward.exp) this.gainExp(reward.exp);
      if (reward.weaponType !== undefined) this.addWeapon(reward.weaponType);
      if (reward.passiveType) this.addPassive(reward.passiveType);
      if (reward.hp) this.hp = Math.min(this.hp + reward.hp, this.maxHp);
      // Add more reward types as needed
    }
    // Optionally log the chest pickup
    Logger.info(`[Player.handleChestPickup] Chest picked up. Reward: ${JSON.stringify(reward)}`);
  }

  /**
   * Resets the player's game-specific state for a new run.
   * This is called when the player already exists but a new game starts.
   */
  public resetState() {
    this.hp = this.maxHp; // Reset HP
    this._exp = 0; // Reset experience
    this.level = 1; // Reset level
    this.activeWeapons.clear(); // Clear all weapons
    this.activePassives = []; // Clear all passives
    this.upgrades = []; // Clear upgrade history
    this.shootCooldowns.clear(); // Clear weapon cooldowns

    // Re-add all weapons at level 1 for new run
    this.activeWeapons.clear();
    const allWeaponTypes = Object.values(WeaponType).filter(v => typeof v === 'number') as WeaponType[];
    for (const wt of allWeaponTypes) {
      this.activeWeapons.set(wt, 1);
    }
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
    if (!spec) return;
    // Enforce max weapon limit
    if (!this.activeWeapons.has(type) && this.activeWeapons.size >= 5) {
      // Already at max weapons, do not add new weapon
      return;
    }
    let currentLevel = this.activeWeapons.get(type) || 0;
    if (currentLevel < spec.maxLevel) {
      this.activeWeapons.set(type, currentLevel + 1);
      this.upgrades.push(`Weapon Upgrade: ${spec.name} Lv.${currentLevel + 1}`);
      // Check for evolution if max level is reached
      if (currentLevel + 1 === spec.maxLevel && spec.evolution) {
        this.tryEvolveWeapon(type, spec.evolution.evolvedWeaponType, spec.evolution.requiredPassive);
      }
    } else if (currentLevel === spec.maxLevel) {
      // Still check for evolution if it's at max level and hasn't evolved yet
      if (spec.evolution) {
        this.tryEvolveWeapon(type, spec.evolution.evolvedWeaponType, spec.evolution.requiredPassive);
      }
    }
    // Initialize cooldown if weapon is new
    if (!this.shootCooldowns.has(type)) {
      this.shootCooldowns.set(type, 0);
    }
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
      }
    } else {
      const newPassive = { type, level: 1 };
      this.activePassives.push(newPassive);
      applyPassive(this, passiveSpec.id, newPassive.level);
      this.upgrades.push(`Passive Unlock: ${type} Lv.1`);
      Logger.info(`Passive ${type} unlocked at Lv.1`);
    }
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
        return boss as any;
      }
    }
    const enemies = this.enemyProvider ? this.enemyProvider() : [];
    let nearest: Enemy | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const e of enemies) {
      if (!e || (e as any).active === false || (e.hp != null && e.hp <= 0)) {
        continue; // Only target active, alive enemies
      }
      const dx = (e.x ?? 0) - (this.x ?? 0);
      const dy = (e.y ?? 0) - (this.y ?? 0);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; nearest = e; }
    }
    if (nearest) {
    } else {
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
      // Animation frame only when moving (still relevant for other animations if any)
      this.frameTimer++;
      // Flip animation: toggle isFlipped every 0.2s (12 frames at 60fps)
      this.flipTimer++;
      if (this.flipTimer >= 12) {
        this.isFlipped = !this.isFlipped;
        this.flipTimer = 0;
      }
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
      this.flipTimer = 0;
      this.isFlipped = false;
      // Reset velocity
      this.vx = 0;
      this.vy = 0;
    }
    // Clamp position to world bounds
    if (this.gameContext?.worldH) {
      this.y = Math.max(this.radius, Math.min(this.y, this.gameContext.worldH - this.radius));
    }

    // Update cooldowns and shoot for all active weapons
    let autoAimTarget = this.findNearestEnemy();
    if (autoAimTarget) {
  this.rotation = Math.atan2(autoAimTarget.y - this.y, autoAimTarget.x - this.x) - Math.PI / 2;
    }
    this.activeWeapons.forEach((level, weaponType) => {
      let cooldown = this.shootCooldowns.get(weaponType) ?? 0;
      cooldown--;
      // Clamp cooldown to zero if negative
      if (cooldown < 0) cooldown = 0;
      this.shootCooldowns.set(weaponType, cooldown);

      if (cooldown <= 0) {
        const t = autoAimTarget;
        if (t) {
          this.shootAt(t, weaponType);
          const spec = WEAPON_SPECS[weaponType as keyof typeof WEAPON_SPECS];
          const baseCooldown = spec?.cooldown ?? 10;
          const newCooldown = Math.max(1, Math.floor(baseCooldown / (this.fireRateModifier * this.attackSpeed))); // cooldown reduced by attackSpeed
          this.shootCooldowns.set(weaponType, newCooldown);
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

  /**
   * Inflicts damage to the player, clamping HP to zero.
   * @param amount Amount of damage to apply
   */
  public takeDamage(amount: number) {
    this.hp -= amount;
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
      if (data.stats.damage !== undefined) this.bulletDamage = data.stats.damage;
      if (data.stats.strength !== undefined) this.strength = data.stats.strength;
      if (data.stats.intelligence !== undefined) this.intelligence = data.stats.intelligence;
      if (data.stats.agility !== undefined) this.agility = data.stats.agility;
      if (data.stats.luck !== undefined) this.luck = data.stats.luck;
      if (data.stats.defense !== undefined) this.defense = data.stats.defense;
    }
    if (data.shape !== undefined) this.shape = data.shape;
    if (data.color !== undefined) this.color = data.color;
    if (data.defaultWeapon !== undefined) {
      if (!this.activeWeapons.has(data.defaultWeapon)) {
        this.addWeapon(data.defaultWeapon);
      }
    }
  }

  /**
   * Draws the player character using a PNG sprite from /assets/player/{characterId}.png.
   * If the sprite is missing, the player is not rendered (invisible fallback).
   * Applies rotation and scaling for correct orientation.
   * @param ctx CanvasRenderingContext2D
   */
  public draw(ctx: CanvasRenderingContext2D): void {
  // Use characterData.sprite if present, else id, else fallback to 'cyber_runner'
  let assetKey = this.characterData?.sprite || this.characterData?.id || 'cyber_runner';
    // Debug: log assetKey and image path used for rendering
    const img = this.gameContext?.assetLoader?.getImage(`/assets/player/${assetKey}.png`) as HTMLImageElement | undefined;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      if (this.isFlipped) {
        ctx.scale(-1, 1);
        ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
      } else {
        ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
      }
      ctx.restore();
    }
  /**
   * Player entity for CyberSurvivor. Handles rendering and weapon logic.
   * @property position Player position
   * @property size Player size
   * @property characterData Character metadata
   * @method draw Renders player sprite or fallback
   */

  }
}

