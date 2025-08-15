import { keyState } from './keyState';
import { Bullet } from './Bullet';
import { Enemy } from './EnemyManager';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';

export class Player {
  public x: number;
  public y: number;
  public radius: number = 8;
  public speed: number = 3.0;
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
  constructor(x: number, y: number, characterData?: any) {
    this.x = x;
    this.y = y;
    this.baseSpeed = this.speed;
    if (characterData) {
      this.characterData = characterData;
      this.activeWeapons.clear();
      if (characterData.defaultWeapon !== undefined) {
        this.addWeapon(characterData.defaultWeapon);
      }
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
    if (this.activeWeapons.has(type)) {
      const currentLevel = this.activeWeapons.get(type)!;
      this.activeWeapons.set(type, currentLevel + 1);
      this.upgrades.push(`Weapon Upgrade: ${WeaponType[type]} Lv.${currentLevel + 1}`);
    } else {
      this.activeWeapons.set(type, 1);
      this.shootCooldowns.set(type, 0);
      // Do not track Pistol Lv.1 as an upgrade
      if (type !== WeaponType.PISTOL) {
        this.upgrades.push(`Weapon Unlock: ${WeaponType[type]} Lv.1`);
      }
    }
  }

  public addPassive(type: string) {
    const existing = this.activePassives.find(p => p.type === type);
    if (existing) {
      existing.level++;
      applyPassive(this, PASSIVE_SPECS.find(p => p.name === type)?.id ?? -1, existing.level);
      this.upgrades.push(`Passive Upgrade: ${type} Lv.${existing.level}`);
    } else {
      const newPassive = { type, level: 1 };
      this.activePassives.push(newPassive);
      applyPassive(this, PASSIVE_SPECS.find(p => p.name === type)?.id ?? -1, newPassive.level);
      this.upgrades.push(`Passive Unlock: ${type} Lv.1`);
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
        return boss as any; // Boss type compatible with Enemy for targeting
      }
    }
    const enemies = this.enemyProvider ? this.enemyProvider() : [];
    let nearest: Enemy | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (const e of enemies) {
      if (!e || (e as any).active === false || (e.hp != null && e.hp <= 0)) continue; // Only target active, alive enemies
      const dx = (e.x ?? 0) - (this.x ?? 0);
      const dy = (e.y ?? 0) - (this.y ?? 0);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; nearest = e; }
    }
    return nearest;
  }

  private shootAt(target: Enemy, weaponType: WeaponType) {
    if (!target) return;
    const bm: any = this.gameContext?.bulletManager ?? null;
    if (bm && typeof bm.spawnBullet === 'function') {
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
      }
    }
  }

  public update(delta: number) {
    if (window.navigator.userAgent.includes('Mobile')) return; // Touch handled elsewhere
    let dx = 0;
    let dy = 0;

    if (keyState['w']) dy -= 1;
    if (keyState['s']) dy += 1;
    if (keyState['a']) dx -= 1;
    if (keyState['d']) dx += 1;

    // Normalize diagonal movement
    if (dx !== 0 || dy !== 0) {
      const magnitude = Math.sqrt(dx * dx + dy * dy);
      this.x += (dx / magnitude) * this.speed;
      this.y += (dy / magnitude) * this.speed;

      // Animation frame only when moving (still relevant for other animations if any)
      this.frameTimer++;
      if (this.frameTimer >= (60 / this.animationSpeed)) { // Assuming 60 FPS
        this.currentFrame = (this.currentFrame + 1) % this.animationFrames;
      this.frameTimer = 0;
    }

    // Spawn a small number of particles at the player's feet
    if (this.gameContext?.particleManager) {
      this.gameContext.particleManager.spawn(this.x, this.y + this.radius / 2, 2, '#00FFFF'); // Cyan particles
    }
    } else {
      // If not moving, reset animation to first frame (idle)
      this.currentFrame = 0;
      this.frameTimer = 0;
    }

    // Update cooldowns and shoot for all active weapons
    this.activeWeapons.forEach((level, weaponType) => {
      let cooldown = this.shootCooldowns.get(weaponType) ?? 0;
      cooldown--;
      this.shootCooldowns.set(weaponType, cooldown);

      if (cooldown <= 0) {
        const t = this.findNearestEnemy();
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
}

