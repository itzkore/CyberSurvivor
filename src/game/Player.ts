import { keyState } from './keyState';
import { Bullet } from './Bullet';
import { Enemy } from './EnemyManager';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
import { SPEED_SCALE } from './Balance';
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
  /** Cached innate movement speed before passive modifiers (used so speed passives are additive, not overriding faster characters) */
  private baseMoveSpeed: number = 4.0;
  public hp: number = 100;
  public maxHp: number = 100;
  public strength: number = 5;
  public intelligence: number = 5;
  public agility: number = 5;
  public luck: number = 5;
  public defense: number = 5;
  public regen: number = 0; // HP regeneration per second
  private _regenRemainder: number = 0; // carry fractional regen between frames
  public shape: 'circle' | 'square' | 'triangle' = 'circle'; // Added shape property
  public color: string = '#00FFFF'; // Added color property
  private _exp: number = 0;
  public level: number = 1;
  public activeWeapons: Map<WeaponType, number> = new Map();
  public activePassives: { type: string, level: number }[] = [];
  public upgrades: string[] = []; // Tracks all upgrades

  // Weapon cooldown timers in milliseconds (time until next shot for each weapon)
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
  private abilityCooldown: number = 0; // ms until ability can be used again
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

  /** Alternating side toggle for Titan Mech's Mech Mortar barrels (-1 left, 1 right) */
  private mechMortarSide: number = -1;

  constructor(x: number, y: number, characterData?: any) {
    this.x = x;
    this.y = y;
    this.baseSpeed = this.speed;
  this.baseMoveSpeed = this.speed; // initialize innate base
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
  this.shootCooldowns.clear(); // Clear weapon cooldowns (ms timers)
    // Re-add only the character's starting weapon (preserve class identity)
    if (this.characterData) {
      if (this.characterData.id === 'psionic_weaver') {
        this.activeWeapons.set(WeaponType.PSIONIC_WAVE, 1);
      } else if (this.characterData.id === 'bio_engineer') {
        this.activeWeapons.set(WeaponType.BIO_TOXIN, 1);
      } else if (this.characterData.defaultWeapon !== undefined) {
        this.activeWeapons.set(this.characterData.defaultWeapon, 1);
      } else if (Array.isArray(this.characterData.weaponTypes) && this.characterData.weaponTypes.length > 0) {
        this.activeWeapons.set(this.characterData.weaponTypes[0], 1);
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
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        if (typeof window !== 'undefined' && (window as any).dispatchEvent) {
          window.dispatchEvent(new CustomEvent('levelup'));
        }
      }
    }
  }

  public getNextExp(): number {
    const n = this.level - 1;
    return 6 + n * 3 + Math.floor(n * n * 0.35);
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
    // Autoaim: pick absolute nearest target (boss no longer forced priority)
    const enemies = this.enemyProvider ? [...this.enemyProvider()] : [];
    // Optionally include active boss in distance comparison (without auto-priority)
    if (this.gameContext && typeof this.gameContext.bossManager?.getActiveBoss === 'function') {
      const boss = this.gameContext.bossManager.getActiveBoss();
      if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
        enemies.push(boss as any);
      }
    }
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
        // Resolve per-level scaling (salvo, spread, damage). Speed handled in BulletManager.
        const weaponLevel = this.activeWeapons.get(weaponType) ?? 1;
        let toShoot = spec.salvo;
        let spread = spec.spread;
        let bulletDamage = spec.damage;
        if (spec.getLevelStats) {
          const scaled = spec.getLevelStats(weaponLevel);
            if (scaled.salvo != null) toShoot = scaled.salvo;
            if (scaled.spread != null) spread = scaled.spread;
            if (scaled.damage != null) bulletDamage = scaled.damage;
        }

        // Staggered burst logic for Blaster (LASER): fire salvo shots sequentially with small gap instead of simultaneously
        if (weaponType === WeaponType.LASER && toShoot > 1) {
          const gapMs = 55; // delay between shots (~3 frames)
          for (let i = 0; i < toShoot; i++) {
            const delay = i * gapMs;
            if (delay === 0) {
              this.spawnSingleProjectile(bm, weaponType, bulletDamage, weaponLevel, baseAngle, i, toShoot, spread, target);
            } else {
              // Queue delayed shots on next frames using requestAnimationFrame timing fallback to performance.now
              const start = performance.now();
              const schedule = () => {
                if (performance.now() - start >= delay) {
                  this.spawnSingleProjectile(bm, weaponType, bulletDamage, weaponLevel, baseAngle, i, toShoot, spread, target);
                } else {
                  requestAnimationFrame(schedule);
                }
              };
              requestAnimationFrame(schedule);
            }
          }
          // Cooldown handled outside; early return to avoid simultaneous spawn loop below
          return;
        }

        // Special handling: Railgun uses charge then single beam; defer actual spawn
  if (weaponType === WeaponType.RAILGUN) {
          this.handleRailgunFire(baseAngle, target, spec, weaponLevel);
          return; // Skip normal projectile loop
        }

  for (let i = 0; i < toShoot; i++) {
          const angle = baseAngle + (i - (toShoot - 1) / 2) * spread;
          // For Runner Gun: spawn from left/right gun barrels instead of exact center
          let originX = this.x;
          let originY = this.y;
          if (weaponType === WeaponType.RUNNER_GUN) {
            const sideOffsetBase = 22; // pixel distance from center to each gun barrel
            // Perpendicular vector to firing direction
            const perpX = -Math.sin(baseAngle);
            const perpY =  Math.cos(baseAngle);
            // Index centered around 0: for 2-shot salvo -> -0.5, +0.5
            const centeredIndex = (i - (toShoot - 1) / 2);
            // Convert to sign (-1 or 1) to anchor fully at each side
            const sideSign = centeredIndex < 0 ? -1 : 1;
            originX += perpX * sideOffsetBase * sideSign;
            originY += perpY * sideOffsetBase * sideSign;
          } else if (weaponType === WeaponType.MECH_MORTAR && this.characterData?.id === 'titan_mech') {
            // Titan Mech dual heavy cannons: alternate each shot left/right
            // Determine perpendicular to firing direction
            const perpX = -Math.sin(baseAngle);
            const perpY =  Math.cos(baseAngle);
            const barrelOffset = 30; // distance from center to each cannon
            originX += perpX * barrelOffset * this.mechMortarSide;
            originY += perpY * barrelOffset * this.mechMortarSide;
            // Slight forward offset to place at muzzle tip
            originX += Math.cos(baseAngle) * 18;
            originY += Math.sin(baseAngle) * 18;
            // Flip for next shot
            this.mechMortarSide *= -1;
          }
          // Converging fire: if Runner Gun, recompute angle so each barrel aims exactly at target (covers middle)
          let finalAngle = angle;
          if (weaponType === WeaponType.RUNNER_GUN) {
            const tdx = target.x - originX;
            const tdy = target.y - originY;
            finalAngle = Math.atan2(tdy, tdx);
          } else if (weaponType === WeaponType.MECH_MORTAR && this.characterData?.id === 'titan_mech') {
            // Ensure each mortar shell aims from its barrel directly toward target center
            const tdx = target.x - originX;
            const tdy = target.y - originY;
            finalAngle = Math.atan2(tdy, tdx);
          }
          // Smart Rifle: inject artificial arc spread before homing correction so they visibly curve in
          if (weaponType === WeaponType.RAPID) {
            const arcSpread = 0.35; // radians total fan baseline
            const arcIndex = (i - (toShoot - 1) / 2);
            const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1,(toShoot-1)||1));
            bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, bulletDamage, weaponLevel);
          } else {
            bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, bulletDamage, weaponLevel);
          }
        }
        // Tiny screen shake for Desert Eagle impact feel
        if (weaponType === WeaponType.PISTOL) {
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2 } }));
        }
      } else {
        Logger.warn(`[Player.shootAt] No weapon spec found for weaponType: ${weaponType}`);
      }
    } else {
      Logger.warn('[Player.shootAt] No bulletManager in gameContext');
    }
  }

  /** Spawn one projectile for a (possibly staggered) multi-shot weapon. */
  private spawnSingleProjectile(bm: any, weaponType: WeaponType, bulletDamage: number, weaponLevel: number, baseAngle: number, index: number, total: number, spread: number, target: Enemy) {
    const angle = baseAngle + (index - (total - 1) / 2) * spread;
    let originX = this.x;
    let originY = this.y;
    if (weaponType === WeaponType.RUNNER_GUN) {
      const sideOffsetBase = 22; const perpX = -Math.sin(baseAngle); const perpY = Math.cos(baseAngle); const centeredIndex = (index - (total - 1) / 2); const sideSign = centeredIndex < 0 ? -1 : 1; originX += perpX * sideOffsetBase * sideSign; originY += perpY * sideOffsetBase * sideSign;
    } else if (weaponType === WeaponType.MECH_MORTAR && this.characterData?.id === 'titan_mech') {
      const perpX = -Math.sin(baseAngle); const perpY = Math.cos(baseAngle); const barrelOffset = 30; originX += perpX * barrelOffset * this.mechMortarSide; originY += perpY * barrelOffset * this.mechMortarSide; originX += Math.cos(baseAngle) * 18; originY += Math.sin(baseAngle) * 18; this.mechMortarSide *= -1;
    }
    let finalAngle = angle;
    if (weaponType === WeaponType.RUNNER_GUN || (weaponType === WeaponType.MECH_MORTAR && this.characterData?.id === 'titan_mech')) {
      const tdx = target.x - originX; const tdy = target.y - originY; finalAngle = Math.atan2(tdy, tdx);
    }
    if (weaponType === WeaponType.RAPID) {
      const arcSpread = 0.35; const arcIndex = (index - (total - 1) / 2); const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1,(total-1)||1));
      bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, bulletDamage, weaponLevel);
    } else {
      bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, bulletDamage, weaponLevel);
    }
  }

  /** Railgun charge + beam fire sequence */
  private handleRailgunFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    // Use a state flag on player to prevent re-entry during charge
    if ((this as any)._railgunCharging) return;
    (this as any)._railgunCharging = true;
  const chargeTimeMs = 800; // reverted to original charge time
    const startTime = performance.now();
    const originX = this.x;
    const originY = this.y - 10; // slight upward to eye line
  const particleInterval = 28; // higher spawn frequency
    let lastParticle = 0;
    const pm = this.gameContext?.particleManager;
    const beamEvents: Array<() => void> = [];

    const chargeStep = () => {
      const now = performance.now();
      const elapsed = now - startTime;
      // Suck-in small particles toward core
      if (pm && now - lastParticle > particleInterval) {
        lastParticle = now;
        for (let i = 0; i < 7; i++) { // denser particles per burst
          const ang = Math.random() * Math.PI * 2;
          const dist = 40 + Math.random() * 50; // spawn closer for compact core
          const px = originX + Math.cos(ang) * dist;
          const py = originY + Math.sin(ang) * dist;
          // Neon micro particle (cyan / magenta mix)
          const color = Math.random() < 0.5 ? '#00FFFF' : '#FF00FF';
          pm.spawn(px, py, 1, color, { sizeMin: 0.5, sizeMax: 1.1, life: 60, speedMin: 1.0, speedMax: 2.0 });
        }
      }
      // After spawning, pull existing active particles slightly toward core for vortex feel
      if (pm && pm['pool']) {
        const pool: any[] = pm['pool'];
        for (const p of pool) {
          if (!p.active) continue;
            const dx = originX - p.x;
            const dy = originY - p.y;
            const d = Math.hypot(dx, dy) || 1;
            const pull = 0.34; // stronger inward gravitational pull
            p.vx += (dx / d) * pull;
            p.vy += (dy / d) * pull;
        }
      }
      if (elapsed < chargeTimeMs) {
        requestAnimationFrame(chargeStep);
        return;
      }
      // Fire beam (single persistent beam hitbox for fixed duration)
      (this as any)._railgunCharging = false;
      const beamAngle = Math.atan2(target.y - originY, target.x - originX);
  const beamDurationMs = 160; // reverted to original duration
      const beamStart = performance.now();
      const range = spec.range || 900; // reverted to original range
  const beamDamageTotal = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) * 1.25; // original burst multiplier
      const dps = beamDamageTotal / (beamDurationMs / 1000);
      // Register beam effect object on game context for rendering & ticking
      const game: any = this.gameContext;
      if (!game._activeBeams) game._activeBeams = [];
      const beamObj = {
        type: 'railgun',
        x: originX,
        y: originY,
        angle: beamAngle,
        range,
        start: beamStart,
        duration: beamDurationMs,
        lastTick: beamStart,
        weaponLevel,
        dealDamage: (now:number) => {
          const enemies = game.enemyManager?.getEnemies() || [];
          const cosA = Math.cos(beamAngle);
          const sinA = Math.sin(beamAngle);
          const thickness = 9; // much thinner collision core for precision
          for (const e of enemies) {
            if (!e.active || e.hp <= 0) continue;
            const relX = e.x - originX;
            const relY = e.y - originY;
            const proj = relX * cosA + relY * sinA; // distance along beam
            if (proj < 0 || proj > range) continue;
            const ortho = Math.abs(-sinA * relX + cosA * relY);
            if (ortho <= thickness + e.radius) {
              // Apply tick damage once per frame segment
              const deltaSec = (now - beamObj.lastTick)/1000;
              const dmg = dps * deltaSec;
              game.enemyManager.takeDamage(e, dmg, false, false, WeaponType.RAILGUN, this.x, this.y, weaponLevel);
            }
          }
          beamObj.lastTick = now;
        }
      };
      game._activeBeams.push(beamObj);
      // Screen shake & flash
  window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 140, intensity: 4 } }));
    };
    requestAnimationFrame(chargeStep);
  }

  public update(delta: number) {
    // WHAT: Guard against missing navigator in test (Node) environment.
    // WHY: Prevent TypeError when running logic tests without a browser-like window.
    if (typeof window !== 'undefined' && window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Mobile')) return; // Touch handled elsewhere
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
      // Scale movement by frame delta (delta is ms in current loop design)
      const moveScale = (delta / 16.6667); // 1 at 60fps
      this.x += normX * this.speed * moveScale;
      this.y += normY * this.speed * moveScale;
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

    // --- HP Regeneration ---
    // Apply continuous regeneration (regen = HP per second). Supports fractional values smoothly.
    if (this.regen > 0 && this.hp < this.maxHp) {
      const heal = this.regen * (delta / 1000); // delta is ms
      this._regenRemainder += heal;
      // Apply in 0.25 HP slices to avoid many tiny floating ops; keep leftover remainder
      while (this._regenRemainder >= 0.25 && this.hp < this.maxHp) {
        const slice = Math.min(0.25, this._regenRemainder, this.maxHp - this.hp);
        this.hp += slice;
        this._regenRemainder -= slice;
      }
    } else if (this.regen <= 0) {
      this._regenRemainder = 0; // reset if no regen
    }
    // Update cooldowns and shoot for all active weapons
    let autoAimTarget = this.findNearestEnemy();
    if (autoAimTarget) {
  this.rotation = Math.atan2(autoAimTarget.y - this.y, autoAimTarget.x - this.x) - Math.PI / 2;
    }
    this.activeWeapons.forEach((level, weaponType) => {
      let cooldownMs = this.shootCooldowns.get(weaponType) ?? 0;
      if (cooldownMs > 0) {
        cooldownMs -= delta; // delta is ms now via variable timestep loop
        if (cooldownMs < 0) cooldownMs = 0;
        this.shootCooldowns.set(weaponType, cooldownMs);
      }
      if (cooldownMs <= 0) {
        // Kamikaze Drone: only one active at a time. If one exists, defer firing until it explodes.
        if (weaponType === WeaponType.HOMING) {
          const bm: any = (this.gameContext as any)?.bulletManager;
          if (bm && bm.bullets && bm.bullets.some((b: any) => b.active && b.weaponType === WeaponType.HOMING)) {
            return; // keep counting down cooldown; next shot will occur right after explosion
          }
        }
  // For Homing (Kamikaze Drone) we always want to spawn even with no enemies yet.
  const t = autoAimTarget || (weaponType === WeaponType.HOMING ? { x: this.x + 200, y: this.y } as any : null);
        if (t) {
          // Range gate: only fire if target is within weapon range * 1.1 (10% slack)
          const rgSpec = WEAPON_SPECS[weaponType as keyof typeof WEAPON_SPECS];
          let wr = rgSpec?.range ?? 0;
          const rgLevel = this.activeWeapons.get(weaponType) ?? 1;
          if (rgSpec?.getLevelStats) {
            const scaled = rgSpec.getLevelStats(rgLevel);
            if (scaled.range != null) wr = scaled.range;
          }
          if (wr > 0) {
            const dxT = (t.x ?? 0) - (this.x ?? 0);
            const dyT = (t.y ?? 0) - (this.y ?? 0);
            const distSq = dxT*dxT + dyT*dyT;
            const maxSq = (wr * 1.1) * (wr * 1.1);
            if (distSq > maxSq) return; // skip firing for this weapon this cycle
          }
          this.shootAt(t, weaponType);
          const cdSpec = WEAPON_SPECS[weaponType as keyof typeof WEAPON_SPECS];
          let baseCooldownFrames = cdSpec?.cooldown ?? 10; // original frame-based value
          const cdLevel = this.activeWeapons.get(weaponType) ?? 1;
          if (cdSpec?.getLevelStats) {
            const scaled = cdSpec.getLevelStats(cdLevel);
            if (scaled.cooldown != null) baseCooldownFrames = scaled.cooldown;
          }
          // Convert frames -> ms (assuming 60fps baseline) then divide by modifiers
          const baseMs = (baseCooldownFrames / 60) * 1000;
          const modMs = baseMs / (this.fireRateModifier * this.attackSpeed);
          const finalMs = Math.max(15, modMs); // clamp to a minimal 15ms
          this.shootCooldowns.set(weaponType, finalMs);
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
      this.abilityTicks += delta; // treat abilityTicks as ms now
      if (this.abilityTicks >= this.abilityDuration) {
        // end ability
        this.abilityActive = false;
        this.speed = this.baseSpeed;
      }
    }
    if (this.abilityCooldown > 0) {
      this.abilityCooldown -= delta;
      if (this.abilityCooldown < 0) this.abilityCooldown = 0;
    }
  }

  /**
   * Inflicts damage to the player, clamping HP to zero.
   * @param amount Amount of damage to apply
   */
  public takeDamage(amount: number) {
  // Invulnerability window (i-frames)
  const now = performance.now();
  const last = (this as any)._lastDamageTime || 0;
  const iframeMs = 800; // 0.8s of invulnerability
  if (now - last < iframeMs) return; // ignore if still invulnerable
  (this as any)._lastDamageTime = now;
  this.hp -= amount;
  if (this.hp < 0) this.hp = 0;
  // Flash effect marker
  (this as any)._damageFlashTime = now;
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
  if (data.stats.speed !== undefined) {
      // Apply scaling using shared constant and clamp
      const scaled = data.stats.speed * SPEED_SCALE;
      this.speed = Math.min(scaled, 8);
      this.baseMoveSpeed = this.speed;
  }
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
  // Cache baseSpeed AFTER scaling applied
  this.baseSpeed = this.speed;
  }

  /** Returns the innate (pre-passive) movement speed for additive passives */
  public getBaseMoveSpeed(): number { return this.baseMoveSpeed; }

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
  const prefix = (location.protocol === 'file:' ? './assets/player/' : '/assets/player/');
  const img = this.gameContext?.assetLoader?.getImage(prefix + assetKey + '.png') as HTMLImageElement | undefined;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      // Damage flash: add white overlay pulse for first 200ms after hit
      const flashTime = (this as any)._damageFlashTime || 0;
      const since = performance.now() - flashTime;
      const flashing = since < 200;
      if (this.isFlipped) {
        ctx.scale(-1, 1);
        ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
      } else {
        ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
      }
      if (flashing) {
        const alpha = 0.45 * (1 - since / 200) + 0.2; // fade out
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, this.size/2, 0, Math.PI*2);
        ctx.fill();
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

