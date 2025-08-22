import { keyState } from './keyState';
import { Bullet } from './Bullet';
import { Enemy } from './EnemyManager';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
import { SPEED_SCALE, EXP_BASE, EXP_LINEAR, EXP_QUAD } from './Balance';
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
  /** Innate baseline max HP captured on character load (for additive passives) */
  private baseMaxHp: number = 100;
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
  /** Innate baseline bullet damage captured on character load */
  private baseBulletDamage: number = 10;
  /** Global multiplicative damage bonus from passives (1 = base) */
  public globalDamageMultiplier: number = 1;
  public magnetRadius: number = 50; // Radius for gem collection
  public attackSpeed: number = 1; // Attack speed multiplier (1 = base)
  // Plasma weapon heat (0..1)
  public plasmaHeat: number = 0;

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
  /** Last non-zero horizontal input direction (-1 left, +1 right). Drives sprite horizontal flip when moving. */
  private lastDirX: number = 1;
  /** Walk-cycle visual: toggles horizontal mirror every interval while moving. */
  private walkFlipTimerMs: number = 0;
  private walkFlipIntervalMs: number = 200; // 0.2s
  private walkFlip: boolean = false;

  public characterData?: any;
  public classWeaponType?: WeaponType; // Cache class weapon type
  // Scavenger Scrap meter (class-specific): fills on Scrap-Saw hits
  private scrapMeter: number = 0;
  private scrapMeterMax: number = 10;
  private lastScrapTriggerMs: number = 0;
  // Tech Warrior Tachyon meter (class-specific): fills on spear hits, max 5, triggers triple-spear volley
  private techMeter: number = 0;
  private techMeterMax: number = 5;
  private lastTechTriggerMs: number = 0;
  private techCharged: boolean = false;

  // Heavy Gunner: Overheat boost (hold Space)
  private gunnerHeatMs: number = 0; // current heat in ms (0..gunnerHeatMsMax)
  private gunnerHeatMsMax: number = 2000; // max boost duration = 2s
  private gunnerHeatCooldownMs: number = 10000; // full cool-down time = 10s
  private gunnerBoostActive: boolean = false; // true while boosting (Space held and not overheated)
  // Boost multipliers
  private gunnerBoostFireRate: number = 1.6;  // 60% faster fire rate
  private gunnerBoostDamage: number = 2.0;    // double damage while boosting
  private gunnerBoostRange: number = 1.4;     // +40% projectile reach
  private gunnerBoostSpread: number = 0.65;   // tighter spread while boosting (35% of base)
  private gunnerBaseRatePenalty: number = 0.7; // 30% slower when not boosting
  private gunnerBoostJitter: number = 0.06;   // small random aim jitter (radians) for minigun while boosting

  public getGunnerHeat() { return { value: this.gunnerHeatMs, max: this.gunnerHeatMsMax, active: this.gunnerBoostActive }; }

  // Cyber Runner: Dash (Shift) — dodge distance scales with level (200px at Lv1 → 400px at Lv50), 5s cooldown
  private runnerDashCooldownMsMax: number = 5000;
  private runnerDashCooldownMs: number = 0;
  private runnerDashPrevKey: boolean = false; // rising-edge detection for Shift
  private invulnerableUntilMs: number = 0; // generic i-frames end time (ms since performance.now)
  /** Afterimage trail entries for Cyber Runner dash */
  private runnerAfterimages: { x: number; y: number; rotation: number; flip: boolean; ageMs: number; lifeMs: number; alpha: number; }[] = [];
  public getRunnerDash() { return { value: this.runnerDashCooldownMsMax - this.runnerDashCooldownMs, max: this.runnerDashCooldownMsMax, ready: this.runnerDashCooldownMs <= 0 }; }

  // Data Sorcerer: Sigil Surge (Spacebar) — 15s cooldown, summon a large following sigil that pulses damage
  private sorcererSigilCdMaxMs: number = 15000;
  private sorcererSigilCdMs: number = 0;
  private sorcererSigilPrevKey: boolean = false;
  public getSorcererSigilMeter() { return { value: this.sorcererSigilCdMaxMs - this.sorcererSigilCdMs, max: this.sorcererSigilCdMaxMs, ready: this.sorcererSigilCdMs <= 0 }; }

  // Neural Nomad: Overmind Resonance (Spacebar) — 15s cooldown, 5s duration
  private overmindCdMaxMs: number = 15000;
  private overmindCdMs: number = 0;
  private overmindActiveMs: number = 0;
  private overmindActive: boolean = false;
  private overmindPrevKey: boolean = false;
  public getOvermindMeter() {
    return { value: this.overmindActive ? this.overmindActiveMs : (this.overmindCdMaxMs - this.overmindCdMs), max: this.overmindActive ? 5000 : this.overmindCdMaxMs, ready: this.overmindCdMs <= 0 && !this.overmindActive, active: this.overmindActive };
  }

  // Psionic Weaver: Lattice Weave (Spacebar) — 12s cooldown, 4s duration
  private latticeCdMaxMs: number = 12000;
  private latticeCdMs: number = 0;
  private latticeActiveMs: number = 0;
  private latticeActive: boolean = false;
  private latticePrevKey: boolean = false;
  public getWeaverLatticeMeter() {
    return { value: this.latticeActive ? this.latticeActiveMs : (this.latticeCdMaxMs - this.latticeCdMs), max: this.latticeActive ? 4000 : this.latticeCdMaxMs, ready: this.latticeCdMs <= 0 && !this.latticeActive, active: this.latticeActive };
  }

  // Ghost Operative: Phase Cloak (Spacebar) — 15s cooldown, 5s duration, speed boost
  private cloakCdMaxMs: number = 15000;
  private cloakCdMs: number = 0;
  private cloakActiveMs: number = 0;
  private cloakActive: boolean = false;
  private cloakPrevSpeed?: number;
  public getGhostCloakMeter() {
    return { value: this.cloakActive ? this.cloakActiveMs : (this.cloakCdMaxMs - this.cloakCdMs), max: this.cloakActive ? 5000 : this.cloakCdMaxMs, ready: this.cloakCdMs <= 0 && !this.cloakActive, active: this.cloakActive };
  }

  /**
   * Ghost Operative sniper charge meter. Mirrors the internal charge state used during steady aim.
   * Returns current value (ms), max (ms), textual state, and whether movement is blocking charge.
   */
  public getGhostSniperCharge() {
    const state = (this as any)._sniperState || 'idle';
    const start: number | undefined = (this as any)._sniperChargeStart;
    const max: number = (this as any)._sniperChargeMax || 1500;
    let value = 0;
    if (state === 'charging' && typeof start === 'number') {
      value = Math.max(0, Math.min((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start, max));
    }
    const moving = Math.hypot(this.vx || 0, this.vy || 0) > 0.01;
    return { value, max, state, moving };
  }

  /**
   * Shadow Operative (Void Sniper) charge meter. Shares the same internal fields as Ghost.
   * Returns current value (ms), max (ms), textual state, and whether movement is blocking charge.
   */
  public getVoidSniperCharge() {
    // Uses the same _sniper* fields since both snipers are mutually exclusive per class
    const state = (this as any)._sniperState || 'idle';
    const start: number | undefined = (this as any)._sniperChargeStart;
    const max: number = (this as any)._sniperChargeMax || 1500;
    let value = 0;
    if (state === 'charging' && typeof start === 'number') {
      value = Math.max(0, Math.min((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start, max));
    }
    const moving = Math.hypot(this.vx || 0, this.vy || 0) > 0.01;
    return { value, max, state, moving };
  }

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
      // Attempt class weapon fallback only once
      const isTest = typeof process !== 'undefined' && process.env && (process.env.VITEST || process.env.NODE_ENV === 'test');
      if (this.characterData && Array.isArray(this.characterData.weaponTypes) && this.characterData.weaponTypes.length > 0) {
        this.activeWeapons.set(this.characterData.weaponTypes[0], 1);
        if (!isTest) Logger.warn('[Player] Initialized using first class weapon as fallback.');
      } else {
        const enumValues = Object.values(WeaponType).filter(v => typeof v === 'number') as WeaponType[];
        if (enumValues.length > 0) {
          this.activeWeapons.set(enumValues[0], 1);
          if (!isTest) Logger.warn('[Player] Initialized using first WeaponType enum value as fallback.');
        }
      }
    }
    window.addEventListener('chestPickedUp', this.handleChestPickup.bind(this));
  } // <-- Close constructor here

  /**
   * Per-frame player update: handles movement, basic cooldowns, and firing.
   * @param deltaTime ms since last frame
   */
  public update(deltaTime: number) {
    const dt = Math.max(0, deltaTime | 0);
    // Movement (WASD/Arrows)
    let ax = 0, ay = 0;
  if (keyState['w'] || keyState['arrowup']) ay -= 1;
  if (keyState['s'] || keyState['arrowdown']) ay += 1;
  if (keyState['a'] || keyState['arrowleft']) ax -= 1;
  if (keyState['d'] || keyState['arrowright']) ax += 1;
    // Normalize
    if (ax !== 0 || ay !== 0) {
      const inv = 1 / Math.hypot(ax, ay);
      ax *= inv; ay *= inv;
    }
  // Update horizontal facing from input for movement-based flip (persist last non-zero dir)
  if (ax < -0.001) this.lastDirX = -1;
  else if (ax > 0.001) this.lastDirX = 1;
  this.isFlipped = this.lastDirX < 0;
    const moveScale = dt / 16.6667;
    this.vx = ax * this.speed;
    this.vy = ay * this.speed;
    this.x += this.vx * moveScale;
    this.y += this.vy * moveScale;
    // Walk-cycle flip while moving
    const moveMag = Math.hypot(this.vx, this.vy);
    if (moveMag > 0.01) {
      this.walkFlipTimerMs += dt;
      while (this.walkFlipTimerMs >= this.walkFlipIntervalMs) {
        this.walkFlip = !this.walkFlip;
        this.walkFlipTimerMs -= this.walkFlipIntervalMs;
      }
    } else {
      // Optional: pause flipping when idle; keep last pose
      this.walkFlipTimerMs = 0;
    }

    // Cooldowns decrement (weapon cooldowns are tracked in milliseconds)
    if (this.shootCooldowns.size) {
      for (const [k, v] of this.shootCooldowns) {
        const nv = v - dt;
        this.shootCooldowns.set(k, nv > 0 ? nv : 0);
      }
    }

    // Cyber Runner: dash cooldown tick + input edge detect (Shift)
    if (this.characterData?.id === 'cyber_runner') {
      if (this.runnerDashCooldownMs > 0) this.runnerDashCooldownMs = Math.max(0, this.runnerDashCooldownMs - dt);
      const shiftNow = !!keyState['shift'];
      if (shiftNow && !this.runnerDashPrevKey && this.runnerDashCooldownMs <= 0) {
        this.performRunnerDash?.();
      }
      this.runnerDashPrevKey = shiftNow;
      // Age and prune dash afterimages
      if (this.runnerAfterimages.length) {
        for (let i = 0; i < this.runnerAfterimages.length; i++) {
          const g = this.runnerAfterimages[i];
          g.ageMs += dt;
        }
        // remove expired in place
        let w = 0;
        for (let r = 0; r < this.runnerAfterimages.length; r++) {
          const g = this.runnerAfterimages[r];
          if (g.ageMs < g.lifeMs) this.runnerAfterimages[w++] = g;
        }
        this.runnerAfterimages.length = w;
      }
    }

    // Ability timers: decrement per-frame, clamp at 0; advance active durations
    // Data Sorcerer
    if (this.sorcererSigilCdMs > 0) this.sorcererSigilCdMs = Math.max(0, this.sorcererSigilCdMs - dt);
    // Neural Nomad (5s active window, 15s cooldown)
    if (this.overmindActive) {
      this.overmindActiveMs += dt;
      if (this.overmindActiveMs >= 5000) {
        this.overmindActive = false;
        this.overmindActiveMs = 0;
        this.overmindCdMs = this.overmindCdMaxMs; // start cooldown when effect ends
      }
    } else if (this.overmindCdMs > 0) {
      this.overmindCdMs = Math.max(0, this.overmindCdMs - dt);
    }
    // Psionic Weaver (4s active window, 12s cooldown)
    if (this.latticeActive) {
      this.latticeActiveMs += dt;
      if (this.latticeActiveMs >= 4000) {
        this.latticeActive = false;
        this.latticeActiveMs = 0;
        this.latticeCdMs = this.latticeCdMaxMs; // start cooldown when effect ends
      }
    } else if (this.latticeCdMs > 0) {
      this.latticeCdMs = Math.max(0, this.latticeCdMs - dt);
    }
    // Ghost Operative: cloak timers (5s active, 30s cooldown)
    if (this.characterData?.id === 'ghost_operative') {
      if (this.cloakActive) {
        this.cloakActiveMs += dt;
        if (this.cloakActiveMs >= 5000) {
          this.cloakActive = false;
          this.cloakActiveMs = 0;
          this.cloakCdMs = this.cloakCdMaxMs; // start cooldown when effect ends
          // Restore pre-cloak speed
          if (this.cloakPrevSpeed != null) { this.speed = this.cloakPrevSpeed; this.cloakPrevSpeed = undefined; }
          // Notify systems that cloak ended
          try { window.dispatchEvent(new CustomEvent('ghostCloakEnd')); } catch {}
        }
      } else if (this.cloakCdMs > 0) {
        this.cloakCdMs = Math.max(0, this.cloakCdMs - dt);
      }
    }
    // Heavy Gunner heat model: heats while boosting, cools over 10s when inactive
    if (this.characterData?.id === 'heavy_gunner') {
      if (this.gunnerBoostActive) {
        this.gunnerHeatMs = Math.min(this.gunnerHeatMsMax, this.gunnerHeatMs + dt);
        if (this.gunnerHeatMs >= this.gunnerHeatMsMax) {
          this.gunnerBoostActive = false; // overheated
        }
      } else if (this.gunnerHeatMs > 0) {
        const coolRate = this.gunnerHeatMsMax / Math.max(1, this.gunnerHeatCooldownMs); // ms cooled per ms
        this.gunnerHeatMs = Math.max(0, this.gunnerHeatMs - dt * coolRate * this.gunnerHeatMsMax);
      }
    }

    // Auto-aim target
    const target = this.findNearestEnemy();
    if (target) {
      // Face target
      this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
    }

    // Fire weapons when off cooldown
    if (target) {
      const isRogueHacker = this.characterData?.id === 'rogue_hacker';
      for (const [weaponType, level] of this.activeWeapons) {
        // Rogue Hacker: skip class weapon here (zones are auto-cast by EnemyManager); allow other weapons
        if (isRogueHacker && weaponType === WeaponType.HACKER_VIRUS) continue;
        if (!this.shootCooldowns.has(weaponType)) this.shootCooldowns.set(weaponType, 0);
        const cd = this.shootCooldowns.get(weaponType) || 0;
        if (cd <= 0) {
          // Compute effective cooldown
          const spec = WEAPON_SPECS[weaponType];
          const FRAME_MS = 1000 / 60;
          // Prefer cooldownMs if provided by spec or level stats; otherwise treat cooldown as frames
          let baseCdMs: number | undefined = undefined;
          let baseCdFrames: number | undefined = undefined;
          if (spec?.getLevelStats) {
            const scaled = spec.getLevelStats(level);
            if (scaled && typeof (scaled as any).cooldownMs === 'number') baseCdMs = (scaled as any).cooldownMs;
            else if (scaled && typeof (scaled as any).cooldown === 'number') baseCdFrames = (scaled as any).cooldown;
          }
          if (baseCdMs == null) {
            if (typeof (spec as any).cooldownMs === 'number') baseCdMs = (spec as any).cooldownMs;
            else baseCdFrames = (spec?.cooldown ?? 60);
          }
          // Apply attack speed modifiers; if in ms, adjust directly; if in frames, adjust frames then convert
          let effCd: number;
          const rateMul = Math.max(0.1, (this.attackSpeed || 1) * (this.fireRateModifier || 1));
          if (typeof baseCdMs === 'number') {
            effCd = baseCdMs / rateMul;
          } else {
            const effCdFrames = (baseCdFrames as number) / rateMul;
            effCd = effCdFrames * FRAME_MS;
          }
          // Gate: only fire if target is within base range (no extra +10%). If a weapon has no range, allow.
          let canFire = true;
          if (spec && typeof spec.range === 'number' && spec.range > 0) {
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.hypot(dx, dy);
            // Consider temporary range multipliers (e.g., Heavy Gunner boost)
            const isGunner = this.characterData?.id === 'heavy_gunner';
            const boostOn = isGunner && this.gunnerBoostActive;
            const rangeMul = boostOn ? this.gunnerBoostRange : 1;
            const effectiveRange = spec.range * rangeMul; // no additive buffer
            canFire = dist <= effectiveRange;
          }
          if (canFire) {
            this.shootAt(target, weaponType);
            this.shootCooldowns.set(weaponType, effCd);
          }
        }
      }
    }
  }

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
  // Reset class-specific meters
  this.scrapMeter = 0; this.lastScrapTriggerMs = 0;
  this.techMeter = 0; this.lastTechTriggerMs = 0; this.techCharged = false;
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
  return EXP_BASE + n * EXP_LINEAR + Math.floor(n * n * EXP_QUAD);
  }

  public gainExp(amount: number) {
    this.exp += amount;
  }

  public setEnemyProvider(provider: () => Enemy[]) {
    this.enemyProvider = provider;
  }

  /** Adds Scrap-Saw hit(s). Returns true when threshold reached and meter resets. */
  public addScrapHits(count: number = 1): boolean {
    this.scrapMeter = Math.max(0, Math.min(this.scrapMeterMax, this.scrapMeter + count));
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this.scrapMeter >= this.scrapMeterMax) {
      this.scrapMeter = 0;
      this.lastScrapTriggerMs = now;
      try { window.dispatchEvent(new CustomEvent('scrapMeter', { detail: { value: 0, max: this.scrapMeterMax } })); } catch {}
      return true;
    } else {
      try { window.dispatchEvent(new CustomEvent('scrapMeter', { detail: { value: this.scrapMeter, max: this.scrapMeterMax } })); } catch {}
    }
    return false;
  }

  public getScrapMeter(): { value: number; max: number } {
    return { value: this.scrapMeter, max: this.scrapMeterMax };
  }

  /** Adds Tech Warrior spear shot(s). Returns true when threshold reached and meter resets charged flag for next shot. */
  public addTechHits(count: number = 1): boolean {
    this.techMeter = Math.max(0, Math.min(this.techMeterMax, this.techMeter + count));
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (this.techMeter >= this.techMeterMax) {
      this.techMeter = 0;
      this.lastTechTriggerMs = now;
      this.techCharged = true; // do not fire now; next spear shot becomes charged
      try { window.dispatchEvent(new CustomEvent('techMeter', { detail: { value: 0, max: this.techMeterMax } })); } catch {}
      return true; // now charged
    } else {
      try { window.dispatchEvent(new CustomEvent('techMeter', { detail: { value: this.techMeter, max: this.techMeterMax } })); } catch {}
    }
    return false;
  }

  public getTechMeter(): { value: number; max: number } {
    return { value: this.techMeter, max: this.techMeterMax };
  }

  public addWeapon(type: WeaponType) {
  // Rogue Hacker: allow other weapons; the class weapon is managed as an auto-cast zone spawner
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
    // Rogue Hacker: suppress class weapon bullets (zones are auto-cast elsewhere)
    if (this.characterData?.id === 'rogue_hacker' && weaponType === WeaponType.HACKER_VIRUS) {
      return;
    }
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
        // Heavy Gunner: apply damage/spread boost pre-fire
        const isGunner = this.characterData?.id === 'heavy_gunner';
        const boostOn = isGunner && this.gunnerBoostActive;
        if (boostOn) {
          bulletDamage *= this.gunnerBoostDamage;
          spread *= this.gunnerBoostSpread;
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

  // Ghost Operative: heavyweight sniper — must be stationary; charge then instant hitscan beam with pierce
        if (weaponType === WeaponType.GHOST_SNIPER) {
          this.handleGhostSniperFire(baseAngle, target, spec, weaponLevel);
          return; // handled by beam path
        }
        // Shadow Operative: Void Sniper — same charge/aim, applies DoT only and purple beam visuals
        if (weaponType === WeaponType.VOID_SNIPER) {
          this.handleVoidSniperFire(baseAngle, target, spec, weaponLevel);
          return; // handled by beam path
        }
        // Rogue Hacker: weapon spawns paralysis/DoT zones only; no bullets
        if (weaponType === WeaponType.HACKER_VIRUS) {
          this.handleHackerZoneFire(baseAngle, target, spec, weaponLevel);
          return; // no projectile spawn
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
          // Heavy Gunner: add extra random jitter on minigun aim while boosting for a punchier spray feel
          if (boostOn && weaponType === WeaponType.GUNNER_MINIGUN) {
            const j = this.gunnerBoostJitter;
            // uniform in [-j, j]
            finalAngle += (Math.random() * 2 - 1) * j;
          }
          // Smart Rifle: inject artificial arc spread before homing correction so they visibly curve in
          if (weaponType === WeaponType.RAPID) {
            const arcSpread = 0.35; // radians total fan baseline
            const arcIndex = (i - (toShoot - 1) / 2);
            const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1,(toShoot-1)||1));
            {
              const b = bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, bulletDamage, weaponLevel);
              if (boostOn && b) {
                const rMul = this.gunnerBoostRange;
                if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rMul*rMul);
                if (b.life != null) b.life = Math.round(b.life * rMul);
              }
            }
          } else {
            // Tech Warrior: handle charged volley on the main fire path
            if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).techCharged) {
              const spreadAng = 12 * Math.PI / 180;
              const base = finalAngle;
              const lvl = weaponLevel;
              const dmgBase = (this.bulletDamage || bulletDamage) * 2.0;
              const angles = [base - spreadAng, base, base + spreadAng];
              for (let ai=0; ai<angles.length; ai++) {
                const a = angles[ai];
                const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.TACHYON_SPEAR, dmgBase, lvl);
                if (b) {
                  (b as any)._isVolley = true;
                  b.damage = dmgBase;
                  // Speed boost so volley uses the faster spear speed
                  const boost = 1.35; // ~35% faster than base Tachyon
                  b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
                  // Apply special dark-red visuals here (BulletManager can't see _isVolley at spawn time)
                  if (b.projectileVisual) {
                    const vis: any = { ...(b.projectileVisual as any) };
                    vis.color = '#8B0000';
                    vis.glowColor = '#B22222';
                    vis.glowRadius = Math.max(vis.glowRadius || 18, 22);
                    vis.trailColor = 'rgba(139,0,0,0.50)';
                    vis.trailLength = Math.max(vis.trailLength || 26, 34);
                    vis.thickness = Math.max(vis.thickness || 4, 6);
                    vis.length = Math.max(vis.length || 26, 34);
                    b.projectileVisual = vis;
                  }
                  b.radius = Math.max(b.radius || 6, 8);
                }
              }
              (this as any).techCharged = false;
              window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
            } else {
              {
                const b = bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, bulletDamage, weaponLevel);
                if (boostOn && b) {
                  const rMul = this.gunnerBoostRange;
                  if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rMul*rMul);
                  if (b.life != null) b.life = Math.round(b.life * rMul);
                  // Safety: if minigun, reassert 2x damage on the spawned bullet to ensure doubling sticks
                  if (weaponType === WeaponType.GUNNER_MINIGUN) {
                    b.damage = (b.damage ?? bulletDamage) * this.gunnerBoostDamage;
                  }
                }
              }
              // Increment Tech meter per non-special spear shot (Tachyon or Singularity)
              if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).addTechHits) {
                try { (this as any).addTechHits(1); } catch {}
              }
            }
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
    // Heavy Gunner: extra jitter on minigun while boosting
    if (this.characterData?.id === 'heavy_gunner' && this.gunnerBoostActive && weaponType === WeaponType.GUNNER_MINIGUN) {
      const j = this.gunnerBoostJitter;
      finalAngle += (Math.random() * 2 - 1) * j;
    }
  // Apply global damage multiplier (percent-based passive)
  const gdm = (this as any).globalDamageMultiplier || 1;
  bulletDamage *= gdm;
    if (weaponType === WeaponType.RAPID) {
      const arcSpread = 0.35; const arcIndex = (index - (total - 1) / 2); const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1,(total-1)||1));
      bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, bulletDamage, weaponLevel);
    } else {
      // Tech Warrior: if charged and firing a spear, emit a triple-spear volley instead, then consume charge
  if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).techCharged) {
        const spreadAng = 12 * Math.PI / 180;
        const base = finalAngle;
        const lvl = weaponLevel;
  const dmgBase = (this.bulletDamage || bulletDamage) * 2.0;
        const angles = [base - spreadAng, base, base + spreadAng];
        for (let ai=0; ai<angles.length; ai++) {
          const a = angles[ai];
          const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.TACHYON_SPEAR, dmgBase, lvl);
          if (b) {
            (b as any)._isVolley = true;
            b.damage = dmgBase;
            // Speed boost so volley uses the faster spear speed
            const boost = 1.35;
            b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
            // Apply special dark-red visuals here
            if (b.projectileVisual) {
              const vis: any = { ...(b.projectileVisual as any) };
              vis.color = '#8B0000';
              vis.glowColor = '#B22222';
              vis.glowRadius = Math.max(vis.glowRadius || 18, 22);
              vis.trailColor = 'rgba(139,0,0,0.50)';
              vis.trailLength = Math.max(vis.trailLength || 26, 34);
              vis.thickness = Math.max(vis.thickness || 4, 6);
              vis.length = Math.max(vis.length || 26, 34);
              b.projectileVisual = vis;
            }
            b.radius = Math.max(b.radius || 6, 8);
          }
        }
  (this as any).techCharged = false;
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
      } else {
  {
    const b = bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, bulletDamage, weaponLevel);
    if (this.characterData?.id === 'heavy_gunner' && this.gunnerBoostActive && b) {
      const rMul = this.gunnerBoostRange;
      if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rMul*rMul);
      if (b.life != null) b.life = Math.round(b.life * rMul);
      if (weaponType === WeaponType.GUNNER_MINIGUN) {
        b.damage = (b.damage ?? bulletDamage) * this.gunnerBoostDamage;
      }
    }
  }
      }
    }
  }

  /** Railgun charge + beam fire sequence */
  private handleRailgunFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    // Use a state flag on player to prevent re-entry during charge
    if ((this as any)._railgunCharging) return;
    (this as any)._railgunCharging = true;
  const chargeTimeMs = 1000; // single subtle reverse shockwave at 1s
    const startTime = performance.now();
    const originX = this.x;
    const originY = this.y - 10; // slight upward to eye line
  const ex = (this.gameContext as any)?.explosionManager;
  // Start a soft ground glow for the entire charge duration for visibility
  try { ex?.triggerChargeGlow(originX, originY + 8, 28, '#00FFE6', chargeTimeMs); } catch {}

    const chargeStep = () => {
      const now = performance.now();
      const elapsed = now - startTime;
  // No mid-charge visuals; keep it minimal
      if (elapsed < chargeTimeMs) {
        requestAnimationFrame(chargeStep);
        return;
      }
  // Fire beam (single persistent beam hitbox for fixed duration)
  // Emit one subtle reverse shockwave as the charge completes (slightly longer + clearer)
  try { ex?.triggerMortarImplosion(originX, originY + 6, 84, '#00FFE6', 0.28, 180); } catch {}
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

  /** Ghost Sniper: brief steady aim + instant hitscan beam that pierces with damage falloff. */
  private handleGhostSniperFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    // Prevent overlapping charges
    if ((this as any)._sniperCharging) return;
    // Only allow starting charge if not moving
    const moveMag = Math.hypot(this.vx || 0, this.vy || 0);
    if (moveMag > 0.01) {
      (this as any)._sniperState = 'blocked';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      return;
    }
    (this as any)._sniperCharging = true;
    (this as any)._sniperState = 'charging';
    const chargeTimeMs = 1500; // 1.5s steady-aim time
    (this as any)._sniperChargeStart = performance.now();
    (this as any)._sniperChargeMax = chargeTimeMs;
    const startTime = performance.now();
    const originX = this.x;
    const originY = this.y - 8; // slight eye-line offset
    const pm = this.gameContext?.particleManager;
    let lastParticle = 0;
    const particleInterval = 36;

    const chargeStep = () => {
      const now = performance.now();
      // Subtle muzzle shimmer while steady-aiming
      if (pm && now - lastParticle > particleInterval) {
        lastParticle = now;
        for (let i = 0; i < 3; i++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = 20 + Math.random() * 16;
          const px = originX + Math.cos(ang) * dist;
          const py = originY + Math.sin(ang) * dist;
          pm.spawn(px, py, 1, '#E0F7FF', { sizeMin: 0.6, sizeMax: 1.0, life: 40, speedMin: 0.6, speedMax: 1.2 });
        }
      }
      // Cancel charging if movement detected
      const mv = Math.hypot(this.vx || 0, this.vy || 0);
      if (mv > 0.01) {
        (this as any)._sniperCharging = false;
        (this as any)._sniperState = 'blocked';
        (this as any)._sniperChargeStart = undefined;
        (this as any)._sniperChargeMax = 0;
        return;
      }
      // Continue charging if time remains
      if (now - startTime < chargeTimeMs) {
        requestAnimationFrame(chargeStep);
        return;
      }
      // Fire instantaneous beam
      (this as any)._sniperCharging = false;
      (this as any)._sniperState = 'idle';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      const game: any = this.gameContext;
      if (!game) return;
      const beamAngle = Math.atan2(target.y - originY, target.x - originX);
      const range = spec.range || 1200;
      const baseDamage = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) || 100;
      const heavyMult = 1.6; // toned down for DPS balance
      let remaining = baseDamage * heavyMult;
      const falloff = 0.5; // -50% per pierce for stronger falloff
      const thickness = 6;  // tight precision line

      // Damage enemies along the line instantly
      const enemies = game.enemyManager?.getEnemies() || [];
      const cosA = Math.cos(beamAngle);
      const sinA = Math.sin(beamAngle);
      // Sort by distance along beam to apply falloff in order
      const candidates: Array<{e: Enemy, proj: number, ortho: number}> = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
        const relX = e.x - originX;
        const relY = e.y - originY;
        const proj = relX * cosA + relY * sinA;
        if (proj < 0 || proj > range) continue;
        const ortho = Math.abs(-sinA * relX + cosA * relY);
        if (ortho <= thickness + e.radius) {
          candidates.push({ e, proj, ortho });
        }
      }
      candidates.sort((a,b) => a.proj - b.proj);
      for (let i = 0; i < candidates.length && remaining > 0.5; i++) {
        const e = candidates[i].e;
        // Long-range sweet spot crit: extra sting if shot traveled far (> 600px)
  const distCrit = candidates[i].proj > 600 ? 1.25 : 1.0; // reduced long-shot bonus
        const dmg = remaining * distCrit;
        game.enemyManager.takeDamage(e, dmg, distCrit > 1.0, false, WeaponType.GHOST_SNIPER, originX, originY, weaponLevel);
        // bleed a bit of damage into damage history for HUD DPS
        if (game && game.dpsHistory) game.dpsHistory.push({ time: performance.now(), damage: dmg });
        remaining *= falloff;
      }

      // Optional: boss intersection
      try {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const relX = boss.x - originX;
          const relY = boss.y - originY;
          const proj = relX * cosA + relY * sinA;
          const ortho = Math.abs(-sinA * relX + cosA * relY);
          if (proj >= 0 && proj <= range && ortho <= (thickness + (boss.radius||160))) {
            const bossDmg = (baseDamage * heavyMult) * 0.7; // further reduced on boss for balance
            boss.hp -= bossDmg;
            window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount: bossDmg, isCritical: proj > 600, x: boss.x, y: boss.y } }));
          }
        }
      } catch {}

      // Recoil: nudge player backward a touch
      this.x -= Math.cos(beamAngle) * 8;
      this.y -= Math.sin(beamAngle) * 8;

      // Visual: short-lived sniper beam
      if (!game._activeBeams) game._activeBeams = [];
      const beamObj = {
        type: 'sniper',
        x: originX,
        y: originY,
        angle: beamAngle,
        range,
        start: performance.now(),
        duration: 1500, // 1.5s fade-out
        lastTick: performance.now(),
        weaponLevel,
        thickness: 10
      };
      game._activeBeams.push(beamObj);
      // Impact feel
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
    };
    requestAnimationFrame(chargeStep);
  }

  /** Void Sniper: identical to Ghost Sniper but applies DoT instead of instant damage. */
  private handleVoidSniperFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    // Reuse charging gate: must be stationary during 1.5s aim
    if ((this as any)._sniperCharging) return;
    const moveMag = Math.hypot(this.vx || 0, this.vy || 0);
    if (moveMag > 0.01) {
      (this as any)._sniperState = 'blocked';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      return;
    }
    (this as any)._sniperCharging = true;
    (this as any)._sniperState = 'charging';
    const chargeTimeMs = 1500;
    (this as any)._sniperChargeStart = performance.now();
    (this as any)._sniperChargeMax = chargeTimeMs;
    const startTime = performance.now();
    const originX = this.x;
    const originY = this.y - 8;
    const pm = this.gameContext?.particleManager;
    let lastParticle = 0;
    const particleInterval = 36;

    const chargeStep = () => {
      const now = performance.now();
      if (pm && now - lastParticle > particleInterval) {
        lastParticle = now;
        for (let i = 0; i < 3; i++) {
          const ang = Math.random() * Math.PI * 2;
          const dist = 20 + Math.random() * 16;
          const px = originX + Math.cos(ang) * dist;
          const py = originY + Math.sin(ang) * dist;
          pm.spawn(px, py, 1, '#B266FF', { sizeMin: 0.6, sizeMax: 1.0, life: 40, speedMin: 0.6, speedMax: 1.2 });
        }
      }
      const mv = Math.hypot(this.vx || 0, this.vy || 0);
      if (mv > 0.01) {
        (this as any)._sniperCharging = false;
        (this as any)._sniperState = 'blocked';
        (this as any)._sniperChargeStart = undefined;
        (this as any)._sniperChargeMax = 0;
        return;
      }
      if (now - startTime < chargeTimeMs) { requestAnimationFrame(chargeStep); return; }
      (this as any)._sniperCharging = false;
      (this as any)._sniperState = 'idle';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      const game: any = this.gameContext; if (!game) return;
      const beamAngle = Math.atan2(target.y - originY, target.x - originX);
      const range = spec.range || 1200;
  const ghostSpec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
  const baseDamageGhost = (ghostSpec.getLevelStats ? ghostSpec.getLevelStats(weaponLevel).damage : ghostSpec.damage) || 95;
      const perTick = 0.5 * baseDamageGhost; // half of ghost sniper dmg per tick at level 1 baseline; scaled via baseDamageGhost at level
      const ticks = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).ticks : 3) || 3;
      const tickIntervalMs = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).tickIntervalMs : 1000) || 1000;
      const thickness = 6;
      const enemies = game.enemyManager?.getEnemies() || [];
      const cosA = Math.cos(beamAngle);
      const sinA = Math.sin(beamAngle);
      const candidates: Array<{e: Enemy, proj: number}> = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
        const relX = e.x - originX; const relY = e.y - originY;
        const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > range) continue;
        const ortho = Math.abs(-sinA * relX + cosA * relY);
        if (ortho <= thickness + e.radius) candidates.push({ e, proj });
      }
      candidates.sort((a,b)=> a.proj - b.proj);
      // Schedule DoT on each hit enemy
      const nowBase = performance.now();
      for (let i = 0; i < candidates.length; i++) {
        const e = candidates[i].e as any;
        // Attach a simple voidDoT structure to enemy; merge stacks by resetting timer and max ticks
        const dot = e._voidSniperDot as { next:number; left:number; dmg:number } | undefined;
        if (!dot) {
          e._voidSniperDot = { next: nowBase + tickIntervalMs, left: ticks, dmg: perTick };
        } else {
          // Stacking: add per-tick damage; refresh next tick time; keep at least current max remaining ticks
          dot.left = Math.max(dot.left, ticks);
          dot.dmg = (dot.dmg || 0) + perTick;
          dot.next = nowBase + tickIntervalMs;
        }
        e._lastHitByWeapon = WeaponType.VOID_SNIPER as any;
      }
      // Recoil & visuals
      this.x -= Math.cos(beamAngle) * 8; this.y -= Math.sin(beamAngle) * 8;
      if (!game._activeBeams) game._activeBeams = [];
      const beamObj = { type: 'voidsniper', x: originX, y: originY, angle: beamAngle, range, start: performance.now(), duration: 1500, lastTick: performance.now(), weaponLevel, thickness: 10 };
      game._activeBeams.push(beamObj);
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
    };
    requestAnimationFrame(chargeStep);
  }

  /** Rogue Hacker: spawn a paralysis/DoT zone at target (or forward) instead of firing bullets. */
  private handleHackerZoneFire(baseAngle: number, target: Enemy | null, spec: any, weaponLevel: number) {
  // Single-cast: place zone directly on target enemy if present and within range, else in aim direction; clamp to 600px
  const range = 600; // hard cap requested
  const radius = 120;
  const lifeMs = 2000;
  // Default aim point is forward along aim vector clamped to range
  let zx = this.x + Math.cos(baseAngle) * range;
  let zy = this.y + Math.sin(baseAngle) * range;
  if (target && (target as any).active && target.hp > 0) {
    // Use target position only if within 600px; else clamp along direction to 600
    const dx = target.x - this.x; const dy = target.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d <= range) { zx = target.x; zy = target.y; }
    else { const s = range / d; zx = this.x + dx * s; zy = this.y + dy * s; }
  }
  try { window.dispatchEvent(new CustomEvent('spawnHackerZone', { detail: { x: zx, y: zy, radius, lifeMs } })); } catch {}
    // Small feedback pulse at cast point
    const pm = this.gameContext?.particleManager;
    if (pm) {
      for (let i = 0; i < 8; i++) {
        const ang = Math.random() * Math.PI * 2;
        pm.spawn(zx + Math.cos(ang)*6, zy + Math.sin(ang)*6, 1, '#FFA500', { sizeMin: 0.6, sizeMax: 1.2, life: 36, speedMin: 0.4, speedMax: 1.0 });
      }
    }
  }

  /**
   * Inflicts damage to the player, clamping HP to zero.
   * @param amount Amount of damage to apply
   */
  public takeDamage(amount: number) {
  // Invulnerability window (i-frames)
  const now = performance.now();
  // Dash/ability-based i-frames override
  if (this.invulnerableUntilMs && now < this.invulnerableUntilMs) return;
  const last = (this as any)._lastDamageTime || 0;
  const iframeMs = 800; // 0.8s of invulnerability
  if (now - last < iframeMs) return; // ignore if still invulnerable
  // Shield passive: chance to fully block
  const shieldChance = (this as any).shieldChance as number | undefined;
  if (shieldChance && Math.random() < shieldChance) {
    (this as any)._lastDamageTime = now; // still start i-frames to prevent burst hits
    (this as any)._shieldBlockFlashTime = now;
    window.dispatchEvent(new CustomEvent('shieldBlock', { detail: { x: this.x, y: this.y } }));
    return;
  }
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
  this.baseMaxHp = this.maxHp; // snapshot innate baseline
  if (data.stats.speed !== undefined) {
      // Apply scaling using shared constant and clamp
      const scaled = data.stats.speed * SPEED_SCALE;
      this.speed = Math.min(scaled, 8);
      this.baseMoveSpeed = this.speed;
  }
      if (data.stats.damage !== undefined) this.bulletDamage = data.stats.damage;
  this.baseBulletDamage = this.bulletDamage; // snapshot innate baseline
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

  /** Returns innate (pre-passive) movement speed */
  public getBaseMoveSpeed(): number { return this.baseMoveSpeed; }
  /** Returns innate (pre-passive) max HP */
  public getBaseMaxHp(): number { return this.baseMaxHp; }
  /** Returns innate (pre-passive) bullet damage */
  public getBaseBulletDamage(): number { return this.baseBulletDamage; }
  /** Returns global damage multiplier */
  public getGlobalDamageMultiplier(): number { return this.globalDamageMultiplier; }

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
      // Draw afterimages first (under main sprite)
      if (this.runnerAfterimages.length) {
        for (let i = 0; i < this.runnerAfterimages.length; i++) {
          const g = this.runnerAfterimages[i];
          const t = Math.min(1, g.ageMs / g.lifeMs);
          const fade = g.alpha * (1 - t);
          if (fade <= 0) continue;
          ctx.save();
          ctx.translate(g.x, g.y);
          ctx.rotate(g.rotation);
          if (g.flip) ctx.scale(-1, 1);
          ctx.globalAlpha = Math.max(0, Math.min(1, fade));
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
          ctx.restore();
        }
      }
      ctx.save();
      ctx.translate(this.x, this.y);
  // Align sprite artwork “front” with projectile aim. For our assets, use -90° so the sprite
  // points toward the shot direction (0 rad = right in math coords, sprites base-face up).
  const spriteFacingOffset = -Math.PI / 2; // adjust per-asset if needed
  ctx.rotate(this.rotation + spriteFacingOffset);
      // Damage flash: add white overlay pulse for first 200ms after hit
      const flashTime = (this as any)._damageFlashTime || 0;
      const since = performance.now() - flashTime;
      const flashing = since < 200;
      // Phase Cloak visual: fade sprite heavily while cloaked
      if (this.characterData?.id === 'ghost_operative' && this.cloakActive) {
        ctx.globalAlpha = 0.18;
      }
  // Compose facing flip (left/right) with walk-cycle flip
  const flipX = (this.isFlipped ? -1 : 1) * (this.walkFlip ? -1 : 1);
  if (flipX < 0) ctx.scale(-1, 1);
  ctx.drawImage(img, -this.size / 2, -this.size / 2, this.size, this.size);
      if (flashing) {
        const alpha = 0.45 * (1 - since / 200) + 0.2; // fade out
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, this.size/2, 0, Math.PI*2);
        ctx.fill();
      }
      // Shield block flash: cyan ring pulse (150ms)
      const shieldTime = (this as any)._shieldBlockFlashTime || 0;
      const shieldSince = performance.now() - shieldTime;
      if (shieldSince < 150) {
        const t = shieldSince / 150; // 0..1
        const ringAlpha = 0.7 * (1 - t);
        const ringRadius = (this.size/2) + 6 + 4 * (1 - t);
        ctx.globalAlpha = ringAlpha;
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 3 + 2 * (1 - t);
        const grad = ctx.createRadialGradient(0,0, ringRadius*0.2, 0,0, ringRadius);
        grad.addColorStop(0, '#00FFFF');
        grad.addColorStop(1, 'rgba(0,255,255,0)');
        ctx.strokeStyle = '#00FFFF';
        ctx.beginPath();
        ctx.arc(0,0, ringRadius, 0, Math.PI*2);
        ctx.stroke();
        ctx.fillStyle = grad;
        ctx.globalAlpha = ringAlpha * 0.35;
        ctx.beginPath();
        ctx.arc(0,0, ringRadius, 0, Math.PI*2);
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

// Extend Player with ability activation entrypoint used by Game input handler
export interface Player {
  activateAbility?: () => void;
  performRunnerDash?: () => void;
}

Player.prototype.activateAbility = function(this: Player & any) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const id = this.characterData?.id;
  switch (id) {
    case 'ghost_operative': {
      // Phase Cloak: 5s duration invis + immunity + speed boost; 30s cooldown
      if (!this.cloakActive && (this.cloakCdMs <= 0)) {
        this.cloakActive = true;
        this.cloakActiveMs = 0;
        // Speed boost (store and restore later)
        this.cloakPrevSpeed = this.speed;
        this.speed = this.speed * 1.4;
        // Damage immunity window aligns with cloak duration
        this.invulnerableUntilMs = now + 5000;
        // Notify systems that cloak started (lock enemies to current player position)
        try { window.dispatchEvent(new CustomEvent('ghostCloakStart', { detail: { x: this.x, y: this.y, durationMs: 5000 } })); } catch {}
        // Small feedback
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 70, intensity: 1.6 } })); } catch {}
      }
      break;
    }
    case 'psionic_weaver': {
      // Activate Lattice Weave: 4s duration slow/aura; 12s cooldown
      if (!this.latticeActive && (this.latticeCdMs <= 0)) {
        this.latticeActive = true;
        this.latticeActiveMs = 0;
        // Visuals/logic hooks read this global deadline
        try { (window as any).__weaverLatticeActiveUntil = now + 4000; } catch {}
        // Optional tiny feedback
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2 } })); } catch {}
      }
      break;
    }
    case 'neural_nomad': {
      // Overmind Resonance: 5s buff; 15s cooldown
      if (!this.overmindActive && (this.overmindCdMs <= 0)) {
        this.overmindActive = true;
        this.overmindActiveMs = 0;
  try { (window as any).__overmindActiveUntil = now + 5000; } catch {}
        // Optional: lightweight feedback
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 80, intensity: 2 } })); } catch {}
      }
      break;
    }
    case 'data_sorcerer': {
      // Sigil Surge: fire-and-forget; here we just start cooldown and emit a spawn hint
      if (this.sorcererSigilCdMs <= 0) {
        this.sorcererSigilCdMs = this.sorcererSigilCdMaxMs;
        // Reuse EnemyManager's plantDataSigil with follow=true so it trails the player and pulses a few times
        try {
          const detail = { x: this.x, y: this.y, radius: 140, pulseCount: 4, pulseDamage: 95, follow: true };
          window.dispatchEvent(new CustomEvent('plantDataSigil', { detail }));
        } catch {}
      }
      break;
    }
    case 'heavy_gunner': {
      // Basic toggle-on press; full hold logic could be added later
      if (!this.gunnerBoostActive) {
        this.gunnerBoostActive = true;
        this.gunnerHeatMs = Math.min(this.gunnerHeatMs + 250, this.gunnerHeatMsMax); // small upfront heat
      }
      break;
    }
    default:
      break;
  }
};

// Class-private helper: perform Cyber Runner dash with afterimages and i-frames
(Player as any).prototype.performRunnerDash = function(this: Player & any) {
  if (this.characterData?.id !== 'cyber_runner') return;
  // Cooldown gate
  if (this.runnerDashCooldownMs > 0) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Dash parameters
  // Distance scales linearly with character level: 0.5x at Lv1 up to 1.0x at Lv50 (clamped at 50+)
  const baseDistance = 400; // current full range at cap
  const lvl = Math.max(1, Math.round(this.level || 1));
  const t = Math.min(1, (lvl - 1) / (50 - 1)); // 0 at Lv1, 1 at Lv50
  const scale = 0.5 + 0.5 * t; // 0.5..1.0
  const distance = Math.round(baseDistance * scale); // px
  const durationMs = 280; // i-frames window
  // Direction: REQUIRE current movement input; dash follows move direction, not aim
  const mvMag = Math.hypot(this.vx || 0, this.vy || 0);
  if (mvMag < 0.01) {
    // Not moving: do not consume cooldown; provide tiny feedback tap
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 60, intensity: 1 } })); } catch {}
    return;
  }
  let ang = Math.atan2(this.vy, this.vx);
  // Start position snapshot
  const sx = this.x, sy = this.y;
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const ex = sx + dx * distance;
  const ey = sy + dy * distance;
  // Spawn afterimages along the path (under main sprite)
  const steps = 10;
  const lifeMs = 300;
  const flipNow = this.lastDirX < 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = sx + dx * distance * t;
    const py = sy + dy * distance * t;
    // Fade more at the tail
    const alpha = 0.5 * (1 - (i - 1) / steps) + 0.2;
  this.runnerAfterimages.push({ x: px, y: py, rotation: ang - Math.PI/2, flip: flipNow, ageMs: 0, lifeMs, alpha });
  }
  if (this.runnerAfterimages.length > 64) this.runnerAfterimages.splice(0, this.runnerAfterimages.length - 64);
  // Optional particles for dash wake
  const pm = this.gameContext?.particleManager;
  if (pm) {
    const burst = 18;
    for (let i = 0; i < burst; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 6 + Math.random() * 12;
      pm.spawn(sx + Math.cos(a) * r, sy + Math.sin(a) * r, 1, '#00FFFF', { sizeMin: 0.8, sizeMax: 1.6, life: 36, speedMin: 1.0, speedMax: 2.2 });
    }
  }
  // Teleport to end instantly for a snappy dodge
  this.x = ex; this.y = ey;
  // I-frames
  this.invulnerableUntilMs = now + durationMs;
  // Start cooldown
  this.runnerDashCooldownMs = this.runnerDashCooldownMsMax;
  // Haptic: slight screen shake
  try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2 } })); } catch {}
};

