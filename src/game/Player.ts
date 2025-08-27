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
  public size: number = 64; // Sprite draw size (computed from baseSpriteSize * characterScale)
  /** Base sprite diameter before per-character scaling */
  private baseSpriteSize: number = 64;
  /** Character visual/physical scale (1.0 = default). Used to scale sprite size and hurtbox radius. */
  private characterScale: number = 1.0;

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
  /** Global multiplicative area bonus from passives (1 = base). Used for AoE radii when applicable. */
  public globalAreaMultiplier: number = 1;
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
  private scrapMeterMax: number = 25;
  private lastScrapTriggerMs: number = 0;
  // Tech Warrior Tachyon meter (class-specific): fills on spear hits, max 5, triggers triple-spear volley
  private techMeter: number = 0;
  private techMeterMax: number = 5;
  private lastTechTriggerMs: number = 0;
  private techCharged: boolean = false;

  // Heavy Gunner: Overheat boost (hold Space)
  private gunnerHeatMs: number = 0; // current heat in ms (0..gunnerHeatMsMax)
  private gunnerHeatMsMax: number = 5000; // max boost duration = 5s (longer uptime)
  private gunnerHeatCooldownMs: number = 3500; // full cool-down time = 3.5s (faster recovery)
  private gunnerBoostActive: boolean = false; // true while boosting (Space held and not overheated)
  private gunnerOverheated: boolean = false;  // lockout when heat hits max
  private gunnerReengageT: number = 0.3;     // must cool below 30% to reengage after overheat
  /** Time actively boosting in the current hold (ms) — used to grant a brief heat-free startup window. */
  private gunnerBoostActiveMs: number = 0;
  /** Heat-free grace window at boost start (ms); allows short, powerful bursts with no heat cost. */
  private gunnerFreeStartMs: number = 800;
  // Boost multipliers
  private gunnerBoostFireRate: number = 2.4;  // 140% faster fire rate
  private gunnerBoostDamage: number = 2.2;    // +120% damage while boosting
  private gunnerBoostRange: number = 2.0;     // +100% projectile reach
  private gunnerBoostSpread: number = 0.35;   // even tighter spread while boosting (stabilized)
  private gunnerBaseRatePenalty: number = 0.7; // 30% slower when not boosting
  private gunnerBoostJitter: number = 0.012;  // steadier aim while boosting
  /** Minimum effective boost strength while held (0..1). Grants immediate potency before heat ramps. */
  private gunnerBoostFloorT: number = 0.5;

  public getGunnerHeat() { return { value: this.gunnerHeatMs, max: this.gunnerHeatMsMax, active: this.gunnerBoostActive, overheated: this.gunnerOverheated }; }

  /**
   * Heavy Gunner boost strength 0..1 based on current heat and whether boost is engaged.
   * Effects (dmg/fire rate/range/spread/jitter) scale linearly with this value.
   */
  private getGunnerBoostT(): number {
    if (this.characterData?.id !== 'heavy_gunner') return 0;
  if (!this.gunnerBoostActive) return 0;
  const heatT = Math.max(0, Math.min(1, this.gunnerHeatMs / this.gunnerHeatMsMax));
  // Apply a floor so boost feels immediate, then ramp to full with heat
  return Math.max(this.gunnerBoostFloorT, heatT);
  }

  // Cyber Runner: Dash (Shift) — dodge distance scales with level (200px at Lv1 → 400px at Lv50), 5s cooldown
  private runnerDashCooldownMsMax: number = 5000;
  private runnerDashCooldownMs: number = 0;
  private runnerDashPrevKey: boolean = false; // rising-edge detection for Shift
  private invulnerableUntilMs: number = 0; // generic i-frames end time (ms since performance.now)
  /** Afterimage trail entries for Cyber Runner dash */
  private runnerAfterimages: { x: number; y: number; rotation: number; flip: boolean; ageMs: number; lifeMs: number; alpha: number; }[] = [];
  private runnerDashActive: boolean = false;
  private runnerDashTimeMs: number = 0;
  private runnerDashDurationMs: number = 300; // dash duration
  private runnerDashStartX: number = 0;
  private runnerDashStartY: number = 0;
  private runnerDashEndX: number = 0;
  private runnerDashEndY: number = 0;
  private runnerDashEmitAccum: number = 0;
  public getRunnerDash() { return { value: this.runnerDashCooldownMsMax - this.runnerDashCooldownMs, max: this.runnerDashCooldownMsMax, ready: this.runnerDashCooldownMs <= 0 }; }

  // Cyber Runner: Blade Cyclone (Ctrl) — AOE spin attack with high damage, 6s cooldown
  private bladeCycloneCooldownMsMax: number = 6000;
  private bladeCycloneCooldownMs: number = 0;
  private bladeCyclonePrevKey: boolean = false; // rising-edge detection for Ctrl
  private bladeCycloneActive: boolean = false;
  private bladeCycloneTimeMs: number = 0;
  private bladeCycloneDurationMs: number = 400; // spin duration
  public getBladeCyclone() { return { value: this.bladeCycloneCooldownMsMax - this.bladeCycloneCooldownMs, max: this.bladeCycloneCooldownMsMax, ready: this.bladeCycloneCooldownMs <= 0, active: this.bladeCycloneActive }; }
  /** Accumulated sprite rotation while Blade Cyclone is active (radians) */
  private cycloneSpinAngle: number = 0;
  /** Rotation snapshot at the moment cyclone starts (radians) */
  private bladeCycloneStartRotation: number = 0;
  /** Smoothly blend back to base rotation after cyclone ends (ms remaining) */
  private bladeCycloneSettleMs: number = 0;
  /** Total settle duration for blending (ms) */
  private bladeCycloneSettleTotalMs: number = 160;
  /** Rotation at cyclone end used as blend start (radians) */
  private bladeCycloneEndRotation: number = 0;
  public getTechGlide(): { value: number; max: number; ready: boolean; active: boolean } {
    // Value counts up toward max while on cooldown (similar to Runner dash meter)
    return { value: this.techDashCooldownMsMax - this.techDashCooldownMs, max: this.techDashCooldownMsMax, ready: this.techDashCooldownMs <= 0 && !this.techDashActive, active: this.techDashActive };
  }

  // Tech Warrior: Glide Dash (Shift) — shorter, slower, smoother glide with brief i-frames, 6s cooldown
  private techDashCooldownMsMax: number = 6000;
  private techDashCooldownMs: number = 0;
  private techDashPrevKey: boolean = false;
  private techDashActive: boolean = false;
  private techDashTimeMs: number = 0;
  private techDashDurationMs: number = 360; // slower glide than Runner’s snap
  private techDashStartX: number = 0;
  private techDashStartY: number = 0;
  private techDashEndX: number = 0;
  private techDashEndY: number = 0;
  private techDashEmitAccum: number = 0;

  // Data Sorcerer: Sigil Surge (Spacebar) — 15s cooldown, summon a large following sigil that pulses damage
  private sorcererSigilCdMaxMs: number = 15000;
  private sorcererSigilCdMs: number = 0;
  private sorcererSigilPrevKey: boolean = false;
  public getSorcererSigilMeter() { return { value: this.sorcererSigilCdMaxMs - this.sorcererSigilCdMs, max: this.sorcererSigilCdMaxMs, ready: this.sorcererSigilCdMs <= 0 }; }

  // Neural Nomad: Overmind Overload (Spacebar) — 2s cooldown, instant burst
  private overmindCdMaxMs: number = 2000;
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
  // Shadow Operative: restore speed after Umbral Surge
  private shadowPrevSpeed?: number;
  public getGhostCloakMeter() {
    return { value: this.cloakActive ? this.cloakActiveMs : (this.cloakCdMaxMs - this.cloakCdMs), max: this.cloakActive ? 5000 : this.cloakCdMaxMs, ready: this.cloakCdMs <= 0 && !this.cloakActive, active: this.cloakActive };
  }

  // Rogue Hacker: System Hack (Spacebar) — 20s cooldown, instant burst
  private hackerHackCdMaxMs: number = 20000;
  private hackerHackCdMs: number = 0;
  public getHackerHackMeter() { return { value: this.hackerHackCdMaxMs - this.hackerHackCdMs, max: this.hackerHackCdMaxMs, ready: this.hackerHackCdMs <= 0 }; }

  // Bio Engineer: Outbreak! (Spacebar) — 15s cooldown, 5s duration; poison virality 100% in 300px
  private bioOutbreakCdMaxMs: number = 15000;
  private bioOutbreakCdMs: number = 0;
  private bioOutbreakActiveMs: number = 0;
  private bioOutbreakActive: boolean = false;
  private bioOutbreakPrevKey: boolean = false;
  public getBioOutbreakMeter() {
    return { value: this.bioOutbreakActive ? this.bioOutbreakActiveMs : (this.bioOutbreakCdMaxMs - this.bioOutbreakCdMs), max: this.bioOutbreakActive ? 5000 : this.bioOutbreakCdMaxMs, ready: this.bioOutbreakCdMs <= 0 && !this.bioOutbreakActive, active: this.bioOutbreakActive };
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
  /** Alternating side for Akimbo Deagle (-1 left, +1 right) */
  private akimboSide: number = -1;

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
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Tick class ability cooldowns/buffs
  this._preUpdate(now, dt);
    // Post-cyclone settle timer tick
    if (this.bladeCycloneSettleMs > 0) {
      this.bladeCycloneSettleMs = Math.max(0, this.bladeCycloneSettleMs - dt);
    }
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
      if (this.bladeCycloneCooldownMs > 0) this.bladeCycloneCooldownMs = Math.max(0, this.bladeCycloneCooldownMs - dt);

      const shiftNow = !!keyState['shift'];
      if (shiftNow && !this.runnerDashPrevKey && this.runnerDashCooldownMs <= 0) {
        (this as any).performRunnerDash?.();
      }
      this.runnerDashPrevKey = shiftNow;

      // Blade Cyclone: Spacebar for AOE spin attack (edge-trigger)
      const spaceNowRunner = !!(keyState[' '] || (keyState as any)['space'] || (keyState as any)['spacebar']);
      if (spaceNowRunner && !this.bladeCyclonePrevKey && this.bladeCycloneCooldownMs <= 0) {
        (this as any).performBladeCyclone?.();
      }
      this.bladeCyclonePrevKey = spaceNowRunner;
    }

    // Tech Warrior: glide dash (Shift) — slower, shorter, smoother
    if (this.characterData?.id === 'tech_warrior') {
      if (this.techDashCooldownMs > 0) this.techDashCooldownMs = Math.max(0, this.techDashCooldownMs - dt);
      const shiftNow = !!keyState['shift'];
      if (shiftNow && !this.techDashPrevKey && this.techDashCooldownMs <= 0 && !this.techDashActive) {
        this.performTechGlide?.();
      }
      this.techDashPrevKey = shiftNow;
  // Update active glide: ease along path, spawn subtle afterimages
      if (this.techDashActive) {
        this.techDashTimeMs += dt;
        const t = Math.max(0, Math.min(1, this.techDashTimeMs / this.techDashDurationMs));
        // easeInOutQuad
        const ease = t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
        this.x = this.techDashStartX + (this.techDashEndX - this.techDashStartX) * ease;
        this.y = this.techDashStartY + (this.techDashEndY - this.techDashStartY) * ease;
        // Emit afterimages at fixed cadence
        this.techDashEmitAccum += dt;
        const emitStep = 18; // ms
        while (this.techDashEmitAccum >= emitStep) {
          this.techDashEmitAccum -= emitStep;
          const flipNow = this.lastDirX < 0;
          const alpha = 0.35 * (1 - t) + 0.15;
          const lifeMs = 280;
          this.runnerAfterimages.push({ x: this.x, y: this.y, rotation: this.rotation - Math.PI/2, flip: flipNow, ageMs: 0, lifeMs, alpha });
          if (this.runnerAfterimages.length > 64) this.runnerAfterimages.splice(0, this.runnerAfterimages.length - 64);
        }
        if (this.techDashTimeMs >= this.techDashDurationMs) {
          this.techDashActive = false;
          this.techDashTimeMs = 0;
          this.techDashEmitAccum = 0;
          this.techDashCooldownMs = this.techDashCooldownMsMax;
        }
      }
    }

    // Cyber Runner: Dash update
    if (this.characterData?.id === 'cyber_runner' && this.runnerDashActive) {
      this.runnerDashTimeMs += dt;
      const t = Math.max(0, Math.min(1, this.runnerDashTimeMs / this.runnerDashDurationMs));

      // easeInOutQuad
      const ease = t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
      this.x = this.runnerDashStartX + (this.runnerDashEndX - this.runnerDashStartX) * ease;
      this.y = this.runnerDashStartY + (this.runnerDashEndY - this.runnerDashStartY) * ease;

      // Emit afterimages at fixed cadence
      this.runnerDashEmitAccum += dt;
      const emitStep = 16; // ms
      while (this.runnerDashEmitAccum >= emitStep) {
        this.runnerDashEmitAccum -= emitStep;
        const flipNow = this.lastDirX < 0;
        const alpha = 0.4 * (1 - t) + 0.2;
        const lifeMs = 300;
        this.runnerAfterimages.push({ x: this.x, y: this.y, rotation: this.rotation - Math.PI/2, flip: flipNow, ageMs: 0, lifeMs, alpha });
        if (this.runnerAfterimages.length > 64) this.runnerAfterimages.splice(0, this.runnerAfterimages.length - 64);
      }

      if (this.runnerDashTimeMs >= this.runnerDashDurationMs) {
        this.runnerDashActive = false;
        this.runnerDashTimeMs = 0;
        this.runnerDashEmitAccum = 0;
      }
    }

  // Cyber Runner: Blade Cyclone update
  if (this.characterData?.id === 'cyber_runner' && this.bladeCycloneActive) {
      this.bladeCycloneTimeMs += dt;
      const t = Math.max(0, Math.min(1, this.bladeCycloneTimeMs / this.bladeCycloneDurationMs));
  // Advance sprite spin; start fast then ease slightly (render-time only)
  const easeInOut = (p: number) => (p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p);
  const spinTurns = 1.75 + 1.25 * easeInOut(t); // ~1.75 -> 3.0 turns over the duration
  const totalRadians = spinTurns * Math.PI * 2;
  const perMs = totalRadians / Math.max(1, this.bladeCycloneDurationMs);
  this.cycloneSpinAngle += perMs * dt;

      // AOE damage every 100ms during cyclone
      if (Math.floor(this.bladeCycloneTimeMs / 100) !== Math.floor((this.bladeCycloneTimeMs - dt) / 100)) {
        (this as any).performBladeCycloneDamage();
      }

      // Spawn rotation particles (denser, align outer swirl to exact cyclone radius)
      const pm = this.gameContext?.particleManager;
      if (pm) {
        const cycloneRadiusVisual = (this as any).getBladeCycloneTipRadius?.() ?? 240;
        // Inner sparkle
        if (Math.random() < 0.8) {
          const a = Math.random() * Math.PI * 2;
          const r = 30 + Math.random() * Math.min(100, cycloneRadiusVisual * 0.3);
          pm.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1, '#00FFFF', { sizeMin: 0.9, sizeMax: 2.0, life: 34, speedMin: 0.8, speedMax: 2.2 });
        }
        // Outer swirl hints
  if (Math.random() < 0.45) {
          const a = Math.random() * Math.PI * 2;
          const jitter = -10 + Math.random() * 20; // +/- 10px around actual radius
          const R = cycloneRadiusVisual + jitter;
          pm.spawn(this.x + Math.cos(a) * R, this.y + Math.sin(a) * R, 1, 'rgba(0,255,255,0.6)', { sizeMin: 0.8, sizeMax: 1.6, life: 40, speedMin: 1.2, speedMax: 2.6 });
        }
      }

      // End cyclone
      if (this.bladeCycloneTimeMs >= this.bladeCycloneDurationMs) {
        this.bladeCycloneActive = false;
        this.bladeCycloneTimeMs = 0;
  // Begin smooth settle back to current base rotation over a short window
  this.bladeCycloneEndRotation = this.bladeCycloneStartRotation + this.cycloneSpinAngle;
  this.bladeCycloneSettleMs = this.bladeCycloneSettleTotalMs;
  this.cycloneSpinAngle = 0;
      }
    }

    // Age and prune afterimages for all classes
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
    // Rogue Hacker: cooldown tick
    if (this.characterData?.id === 'rogue_hacker' && this.hackerHackCdMs > 0) {
      this.hackerHackCdMs = Math.max(0, this.hackerHackCdMs - dt);
    }
    // Bio Engineer: Outbreak timers and input (Spacebar). 5s active, 15s cooldown.
    if (this.characterData?.id === 'bio_engineer') {
      if (this.bioOutbreakActive) {
        this.bioOutbreakActiveMs += dt;
        if (this.bioOutbreakActiveMs >= 5000) {
          this.bioOutbreakActive = false;
          this.bioOutbreakActiveMs = 0;
          this.bioOutbreakCdMs = this.bioOutbreakCdMaxMs; // start cooldown when effect ends
          try { (window as any).__bioOutbreakActiveUntil = 0; window.dispatchEvent(new CustomEvent('bioOutbreakEnd')); } catch {}
        }
      } else if (this.bioOutbreakCdMs > 0) {
        this.bioOutbreakCdMs = Math.max(0, this.bioOutbreakCdMs - dt);
      }
      const spaceNow = !!(keyState[' '] || (keyState as any)['space'] || (keyState as any)['spacebar']);
      if (spaceNow && !this.bioOutbreakPrevKey && this.bioOutbreakCdMs <= 0 && !this.bioOutbreakActive) {
        this.bioOutbreakActive = true;
        this.bioOutbreakActiveMs = 0;
        const areaMul = this.getGlobalAreaMultiplier?.() ?? (this.globalAreaMultiplier ?? 1);
        const radius = 300 * (areaMul || 1);
        const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        try {
          (window as any).__bioOutbreakActiveUntil = nowMs + 5000;
          window.dispatchEvent(new CustomEvent('bioOutbreakStart', { detail: { x: this.x, y: this.y, radius, durationMs: 5000 } }));
        } catch {}
      }
      this.bioOutbreakPrevKey = spaceNow;
    }
    // Passive HP regeneration (applies continuously; supports fractional accumulation)
    if ((this.regen || 0) > 0 && this.hp < this.maxHp) {
      const heal = (this.regen || 0) * (dt / 1000);
      this.hp = Math.min(this.maxHp, this.hp + heal);
    }
    // Heavy Gunner heat model (hold-to-boost):
    // - While Space is held and not overheated, heat ramps up linearly to max (~2s)
    // - At max heat, enter overheated lockout until cooled below reengage threshold
    // - When not held (or overheated), heat cools toward 0 over gunnerHeatCooldownMs
    if (this.characterData?.id === 'heavy_gunner') {
      const holdSpace = !!(keyState[' '] || (keyState as any)['space'] || (keyState as any)['spacebar']);
      const coolPerMs = this.gunnerHeatMsMax / Math.max(1, this.gunnerHeatCooldownMs); // ms of heat removed per 1ms
      if (this.gunnerOverheated) {
        this.gunnerBoostActive = false;
        if (this.gunnerHeatMs > 0) this.gunnerHeatMs = Math.max(0, this.gunnerHeatMs - dt * coolPerMs);
        if (this.gunnerHeatMs <= this.gunnerHeatMsMax * this.gunnerReengageT) this.gunnerOverheated = false;
      } else if (holdSpace) {
        this.gunnerBoostActive = true;
        // Track active hold time
        this.gunnerBoostActiveMs += dt;
        // Heat-free grace: only start accumulating heat after the grace window
        if (this.gunnerBoostActiveMs > this.gunnerFreeStartMs) {
          this.gunnerHeatMs = Math.min(this.gunnerHeatMsMax, this.gunnerHeatMs + dt);
        }
        if (this.gunnerHeatMs >= this.gunnerHeatMsMax) {
          this.gunnerOverheated = true;
          this.gunnerBoostActive = false;
        }
      } else {
        this.gunnerBoostActive = false;
        // Reset active hold timer when not boosting
        this.gunnerBoostActiveMs = 0;
        if (this.gunnerHeatMs > 0) this.gunnerHeatMs = Math.max(0, this.gunnerHeatMs - dt * coolPerMs);
      }
    }

    // Auto-aim target
    let target = this.findNearestEnemy();
    // Fallback: if no enemy is found, but a boss is active, target the boss so weapons still fire
    if (!target) {
      try {
        const boss = (this.gameContext as any)?.bossManager?.getActiveBoss?.();
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          target = boss as any;
        }
      } catch {}
    }
    if (target) {
      // Face target
      this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
    }

    // Immediate sniper charge start when stationary (Ghost/Shadow), independent of cooldown
    if (target) {
      const moveMagForSniper = Math.hypot(this.vx || 0, this.vy || 0);
      if (moveMagForSniper <= 0.01 && !(this as any)._sniperCharging) {
        if (this.activeWeapons.has(WeaponType.GHOST_SNIPER)) {
          // Ghost: allow pre-charging regardless of cooldown; will hold until ready
          const spec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
          const lvl = this.activeWeapons.get(WeaponType.GHOST_SNIPER) ?? 1;
          const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
          this.handleGhostSniperFire(baseAngle, target, spec, lvl);
        } else if (this.activeWeapons.has(WeaponType.VOID_SNIPER)) {
          // Shadow: start charging immediately when stationary; charge loop cycles while waiting for cooldown.
          const spec = WEAPON_SPECS[WeaponType.VOID_SNIPER];
          const lvl = this.activeWeapons.get(WeaponType.VOID_SNIPER) ?? 1;
          const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
          this.handleVoidSniperFire(baseAngle, target, spec, lvl);
        }
      }
    }

  // Fire weapons when off cooldown. Most weapons require a target; Scrap-Saw can self-swing.
  const isRogueHacker = this.characterData?.id === 'rogue_hacker';
  for (const [weaponType, level] of this.activeWeapons) {
        // Quantum Halo: persistent orbs are managed by BulletManager; never fire like a normal weapon
        if (weaponType === WeaponType.QUANTUM_HALO) continue;
        // Rogue Hacker: skip class weapon here (zones are auto-cast by EnemyManager); allow other weapons
        if (isRogueHacker && weaponType === WeaponType.HACKER_VIRUS) continue;
        if (!this.shootCooldowns.has(weaponType)) this.shootCooldowns.set(weaponType, 0);
        const cd = this.shootCooldowns.get(weaponType) || 0;
        // Sniper special-case: if a charge is in progress, don't attempt to fire or reset cooldown here
        if ((weaponType === WeaponType.GHOST_SNIPER || weaponType === WeaponType.VOID_SNIPER) && (this as any)._sniperCharging) {
          continue;
        }
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
          const rateSource = (this.getFireRateModifier?.() ?? this.fireRateModifier);
          const rateMul = Math.max(0.1, (this.attackSpeed || 1) * ((rateSource != null ? rateSource : 1)));
          // Heavy Gunner: minigun spins up while boosting — increase fire rate with heat
          let rateMulWithBoost = rateMul;
          if (this.characterData?.id === 'heavy_gunner' && weaponType === WeaponType.GUNNER_MINIGUN) {
            const t = this.getGunnerBoostT();
            rateMulWithBoost *= (1 + (this.gunnerBoostFireRate - 1) * t);
          }
          if (typeof baseCdMs === 'number') { effCd = baseCdMs / rateMulWithBoost; }
          else { const effCdFrames = (baseCdFrames as number) / rateMulWithBoost; effCd = effCdFrames * FRAME_MS; }
      // Gate: only fire if target is within base range (no extra +10%).
      // For all weapons: require a valid target — do not fire when no enemy/boss is in range.
          let canFire = true;
          if (!(target && spec && typeof spec.range === 'number' && spec.range > 0)) {
        canFire = !!target; // no range or no target -> require target
            }
            if (canFire && target && spec && typeof spec.range === 'number' && spec.range > 0) {
              const dx = target.x - this.x;
              const dy = target.y - this.y;
              const dist = Math.hypot(dx, dy);
              const isGunner = this.characterData?.id === 'heavy_gunner';
              let rangeMul = 1;
              if (isGunner && weaponType === WeaponType.GUNNER_MINIGUN) {
                const t = this.getGunnerBoostT();
                rangeMul = 1 + (this.gunnerBoostRange - 1) * t;
              }
              const effectiveRange = spec.range * rangeMul;
              canFire = dist <= effectiveRange;
            }
          // Determine final target for this weapon.
          // For other weapons: fire only if a valid target is available and in range.
          let fireTarget: Enemy | null = canFire ? target : null;
          if (fireTarget) {
            // Neural Nomad: fire to multiple nearest enemies per attack (2 at L1 → up to 5 at L7)
            if (this.characterData?.id === 'neural_nomad' && weaponType === WeaponType.NOMAD_NEURAL) {
              const enemies = this.enemyProvider ? [...this.enemyProvider()] : [];
              // Collect alive enemies and sort by distance
              const maxShots = Math.min(5, Math.max(2, 1 + Math.floor(level))); // L1~2:2, ... L5+:5
              const pairs: Array<{e: any, d2: number}> = [];
              for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i]; if (!e || !(e as any).active || e.hp <= 0) continue;
                const dx = e.x - this.x; const dy = e.y - this.y; const d2 = dx*dx + dy*dy;
                // within effective range
                if (spec && typeof spec.range === 'number' && d2 > (spec.range*spec.range)) continue;
                pairs.push({ e, d2 });
              }
              pairs.sort((a,b) => a.d2 - b.d2);
              const shots = Math.min(maxShots, pairs.length);
              for (let si = 0; si < shots; si++) {
                const e = pairs[si].e;
                const ang = Math.atan2(e.y - this.y, e.x - this.x);
                // Fire a single projectile at this enemy
                this.spawnSingleProjectile(this.gameContext.bulletManager, weaponType, (WEAPON_SPECS[weaponType].damage || this.bulletDamage), level, ang, 0, 1, 0, e as any);
              }
              this.shootCooldowns.set(weaponType, effCd);
              continue;
            }
            this.shootAt(fireTarget, weaponType);
            this.shootCooldowns.set(weaponType, effCd);
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
    // Reset passive-derived modifiers to innate baselines
    this.speed = this.baseMoveSpeed;
    this.fireRateModifier = 1;
    this.globalDamageMultiplier = 1;
  this.globalAreaMultiplier = 1;
    this.magnetRadius = 50;
    this.regen = 0;
    // Clear dynamic passive flags stored via indexer
    try {
      delete (this as any).shieldChance;
      delete (this as any).critBonus;
      delete (this as any).critMultiplier;
      delete (this as any).piercing;
      delete (this as any).hasAoeOnKill;
    } catch {}
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

  /** Adds a scrap hit from a specific enemy. Returns true on threshold (explosion). Enforces one contribution per enemy per meter round. */
  public addScrapHitFromEnemy(_enemyId: string): boolean {
    // Per-throw gating handled in BulletManager; here we just add one stack
    return this.addScrapHits(1);
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
    // If selecting an evolved weapon directly, and its base is owned, perform a swap
    try {
      // Find a base weapon that evolves into this 'type'
      let baseForEvolved: WeaponType | undefined;
      let requiredPassiveName: string | undefined;
      for (const k in WEAPON_SPECS) {
        const ws = (WEAPON_SPECS as any)[k];
        if (ws && ws.evolution && ws.evolution.evolvedWeaponType === type) {
          baseForEvolved = Number(k) as WeaponType;
          requiredPassiveName = ws.evolution.requiredPassive;
          break;
        }
      }
      if (baseForEvolved !== undefined && this.activeWeapons.has(baseForEvolved)) {
        // Verify passive >= 1 (eligible)
        const req = requiredPassiveName ? this.activePassives.find(p => p.type === requiredPassiveName) : undefined;
        if (!requiredPassiveName || (req && req.level >= 1)) {
          const baseWeaponSpec = WEAPON_SPECS[baseForEvolved];
          const evolvedWeaponSpec = WEAPON_SPECS[type];
          // Swap: remove base, add evolved level 1 (ignore max weapon count)
          this.activeWeapons.delete(baseForEvolved);
          this.shootCooldowns.delete(baseForEvolved);
          this.activeWeapons.set(type, 1);
          this.shootCooldowns.set(type, 0);
          this.upgrades.push(`Weapon Evolution: ${baseWeaponSpec?.name || String(baseForEvolved)} -> ${evolvedWeaponSpec?.name || String(type)}`);
          try { window.dispatchEvent(new CustomEvent('weaponEvolved', { detail: { baseWeaponType: baseForEvolved, evolvedWeaponType: type } })); } catch {}
          return;
        }
      }
    } catch {}
    // Enforce max weapon limit
    if (!this.activeWeapons.has(type) && this.activeWeapons.size >= 5) {
      // Already at max weapons, do not add new weapon
      return;
    }
    let currentLevel = this.activeWeapons.get(type) || 0;
    if (currentLevel < spec.maxLevel) {
      this.activeWeapons.set(type, currentLevel + 1);
      this.upgrades.push(`Weapon Upgrade: ${spec.name} Lv.${currentLevel + 1}`);
  // Do not auto-evolve on reach max; evolution is offered on next upgrade selection
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

  // Evolution eligibility: base weapon at max level and required passive at level >= 1
  if (passive && passive.level >= 1) {
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
      // Not eligible yet or missing passive level >=1; defer
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
      // Enforce max passive slots (cap at 5). Allow upgrades but block new unlocks beyond the cap.
      const MAX_PASSIVES = 5;
      if (this.activePassives.length >= MAX_PASSIVES) {
        Logger.info(`[Player.addPassive] Passive slots full (${MAX_PASSIVES}); cannot unlock '${type}'.`);
        // Optional: surface a UI toast/event without coupling to UI layers.
        try { window.dispatchEvent(new CustomEvent('upgradeNotice', { detail: { type: 'passive-cap', message: `Passive slots full (${MAX_PASSIVES}/5). Upgrade existing passives.` } })); } catch {}
        return;
      }
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
    // Global auto-aim: toggle between 'closest' and 'toughest'; add range-aware fallback for 'toughest'
    const aimMode: 'closest' | 'toughest' = ((this.gameContext as any)?.aimMode) || ((window as any).__aimMode) || 'closest';

    // Compute an effective maximum weapon range for target selection.
    // If any weapon has no defined range, treat as Infinity. Include dynamic range boost for Heavy Gunner's minigun.
    let maxRange = 0; // 0 -> no range info found yet
    try {
      if (this.activeWeapons && this.activeWeapons.size > 0) {
        for (const [w, _lvl] of this.activeWeapons) {
          const spec = (WEAPON_SPECS as any)[w];
          let r = (spec && typeof spec.range === 'number') ? spec.range : Infinity;
          if (this.characterData?.id === 'heavy_gunner' && w === WeaponType.GUNNER_MINIGUN) {
            const t = this.getGunnerBoostT();
            const rangeMul = 1 + (this.gunnerBoostRange - 1) * t;
            if (Number.isFinite(r)) r *= rangeMul; // only scale finite ranges
          }
          if (!Number.isFinite(r)) { maxRange = Infinity; break; }
          if (r > maxRange) maxRange = r;
        }
      } else {
        maxRange = Infinity; // no weapons -> don't constrain selection
      }
    } catch { maxRange = Infinity; }
    const maxRangeSq = Number.isFinite(maxRange) ? (maxRange * maxRange) : Infinity;

    // Prefer boss first only in 'toughest' mode and when within effective range
    if (aimMode === 'toughest') {
      try {
        const boss = (this.gameContext as any)?.bossManager?.getActiveBoss?.();
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const dxB = (boss.x ?? 0) - (this.x ?? 0);
          const dyB = (boss.y ?? 0) - (this.y ?? 0);
          const d2B = dxB * dxB + dyB * dyB;
          if (d2B <= maxRangeSq) return boss as any;
        }
      } catch {}
    }

    const enemies = this.enemyProvider ? [...this.enemyProvider()] : [];
    let pick: Enemy | null = null;

    if (aimMode === 'toughest') {
      // 1) Try toughest within range
      let bestHp = -1;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || !(e as any).active || e.hp <= 0) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx * dx + dy * dy;
        if (d2 > maxRangeSq) continue;
        const hpMax = (e as any).maxHp ?? e.hp;
        if (hpMax > bestHp) { bestHp = hpMax; pick = e; }
      }
      if (pick) return pick;
      // 2) Fallback: closest within range
      let bestD2 = Number.POSITIVE_INFINITY;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || !(e as any).active || e.hp <= 0) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx * dx + dy * dy;
        if (d2 <= maxRangeSq && d2 < bestD2) { bestD2 = d2; pick = e; }
      }
      if (pick) return pick;
      // 3) Last resort: closest overall
      bestD2 = Number.POSITIVE_INFINITY; pick = null;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || !(e as any).active || e.hp <= 0) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; pick = e; }
      }
    } else {
      // 'closest' mode: include boss as a candidate too so it can be targeted
      let bestD2 = Number.POSITIVE_INFINITY;
      // Consider boss (ACTIVE only)
      try {
        const boss = (this.gameContext as any)?.bossManager?.getActiveBoss?.();
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const dxB = (boss.x ?? 0) - (this.x ?? 0);
          const dyB = (boss.y ?? 0) - (this.y ?? 0);
          const d2B = dxB * dxB + dyB * dyB;
          bestD2 = d2B; pick = boss as any;
        }
      } catch {}
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || !(e as any).active || e.hp <= 0) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; pick = e; }
      }
    }
    return pick;
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
        if (isGunner && weaponType === WeaponType.GUNNER_MINIGUN) {
          const t = this.getGunnerBoostT();
          if (t > 0) {
            bulletDamage *= (1 + (this.gunnerBoostDamage - 1) * t);
            // Interpolate spread factor: 1 -> gunnerBoostSpread
            const spreadMul = 1 - (1 - this.gunnerBoostSpread) * t;
            spread *= spreadMul;
          }
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

        // Akimbo Deagle: quick staggered left-right shots for zig-zag feel (faster than mortar)
        if (weaponType === WeaponType.DUAL_PISTOLS && toShoot > 1) {
          const gapMs = 35; // tight stagger (~2 frames)
          for (let i = 0; i < toShoot; i++) {
            const delay = i * gapMs;
            if (delay === 0) {
              this.spawnSingleProjectile(bm, weaponType, bulletDamage, weaponLevel, baseAngle, i, toShoot, spread, target);
            } else {
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
          return; // avoid simultaneous spawn below
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
          } else if (weaponType === WeaponType.DUAL_PISTOLS) {
            // Akimbo Deagle: two barrels left/right simultaneously (no zig-zag across bursts)
            const sideOffsetBase = 18;
            const perpX = -Math.sin(baseAngle);
            const perpY =  Math.cos(baseAngle);
            const centeredIndex = (i - (toShoot - 1) / 2);
            const sideSign = centeredIndex < 0 ? -1 : 1;
            originX += perpX * sideOffsetBase * sideSign;
            originY += perpY * sideOffsetBase * sideSign;
            originX += Math.cos(baseAngle) * 10;
            originY += Math.sin(baseAngle) * 10;
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
          } else if (weaponType === WeaponType.DUAL_PISTOLS) {
            // Converging aim per barrel (like Runner Gun) for Akimbo
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
          if (isGunner && weaponType === WeaponType.GUNNER_MINIGUN) {
            const t = this.getGunnerBoostT();
            const j = this.gunnerBoostJitter * t;
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
              // Smart Rifle has no minigun-based range scaling; bullets are homing and short-range by design.
            }
          } else {
            // Tech Warrior: handle charged volley on the main fire path
            if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).techCharged) {
              const spreadAng = 12 * Math.PI / 180;
              const base = finalAngle;
              const lvl = weaponLevel;
              // Supercharge damage should scale with the Tachyon Spear's level-based damage, not flat player damage.
              const tachSpec: any = (WEAPON_SPECS as any)[WeaponType.TACHYON_SPEAR];
              const scaled = tachSpec?.getLevelStats ? tachSpec.getLevelStats(lvl) : { damage: bulletDamage };
              const baseDmgLeveled = (scaled?.damage != null ? scaled.damage : bulletDamage);
              const volleyMul = 2.0; // keep current x2 burst feel
              const dmgBase = Math.round(baseDmgLeveled * volleyMul * (this.globalDamageMultiplier || 1));
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
                if (isGunner && b && weaponType === WeaponType.GUNNER_MINIGUN) {
                  const t = this.getGunnerBoostT();
                  const rMul = 1 + (this.gunnerBoostRange - 1) * t;
                  if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rMul*rMul);
                  if (b.life != null) b.life = Math.round(b.life * rMul);
                  // Safety: if minigun, reassert 2x damage on the spawned bullet to ensure doubling sticks
                  const dmgMul = (1 + (this.gunnerBoostDamage - 1) * t);
                  b.damage = (b.damage ?? bulletDamage) * dmgMul;
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

  // === Shadow Operative: Umbral Surge state ===
  private shadowSurgeCdMaxMs: number = 20000; // 20s cooldown
  private shadowSurgeCdMs: number = 20000;
  private shadowSurgeUntil: number = 0;
  private isShadowSurgeActive(): boolean { return performance.now() < this.shadowSurgeUntil; }
  public getShadowSurgeMeter() {
    const now = performance.now();
    const active = now < this.shadowSurgeUntil;
    const remaining = active ? (this.shadowSurgeUntil - now) : 0;
    return { value: active ? remaining : (this.shadowSurgeCdMs), max: active ? 5000 : this.shadowSurgeCdMaxMs, ready: !active && this.shadowSurgeCdMs >= this.shadowSurgeCdMaxMs };
  }
  // Umbral Surge aura state
  private shadowTentaclePhase: number = 0; // ms accumulator
  private shadowTentacles?: Array<{ baseAngle: number; len: number; wobble: number; speed: number; width: number }>; // precomputed arms

  /** Spawn one projectile for a (possibly staggered) multi-shot weapon. */
  private spawnSingleProjectile(
    bm: any,
    weaponType: WeaponType,
    bulletDamage: number,
    weaponLevel: number,
    baseAngle: number,
    index: number,
    total: number,
    spread: number,
    target: Enemy
  ) {
    const angle = baseAngle + (index - (total - 1)) / 2 * spread;
    let originX = this.x;
    let originY = this.y;
    if (weaponType === WeaponType.RUNNER_GUN) {
      const sideOffsetBase = 22;
      const perpX = -Math.sin(baseAngle);
      const perpY = Math.cos(baseAngle);
      const centeredIndex = (index - (total - 1) / 2);
      const sideSign = centeredIndex < 0 ? -1 : 1;
      originX += perpX * sideOffsetBase * sideSign;
      originY += perpY * sideOffsetBase * sideSign;
    } else if (weaponType === WeaponType.DUAL_PISTOLS) {
      const sideOffset = 18;
      const perpX = -Math.sin(baseAngle);
      const perpY = Math.cos(baseAngle);
      originX += perpX * sideOffset * this.akimboSide;
      originY += perpY * sideOffset * this.akimboSide;
      originX += Math.cos(baseAngle) * 10;
      originY += Math.sin(baseAngle) * 10;
      this.akimboSide *= -1;
    } else if (weaponType === WeaponType.MECH_MORTAR && this.characterData?.id === 'titan_mech') {
      const perpX = -Math.sin(baseAngle);
      const perpY = Math.cos(baseAngle);
      const barrelOffset = 30;
      originX += perpX * barrelOffset * this.mechMortarSide;
      originY += perpY * barrelOffset * this.mechMortarSide;
      originX += Math.cos(baseAngle) * 18;
      originY += Math.sin(baseAngle) * 18;
      this.mechMortarSide *= -1;
    }
    let finalAngle = angle;
  if (weaponType === WeaponType.RUNNER_GUN || weaponType === WeaponType.DUAL_PISTOLS || (weaponType === WeaponType.MECH_MORTAR && this.characterData?.id === 'titan_mech')) {
      const tdx = target.x - originX;
      const tdy = target.y - originY;
      finalAngle = Math.atan2(tdy, tdx);
    }
    // Heavy Gunner: extra jitter on minigun while boosting, scales with heat t
    if (this.characterData?.id === 'heavy_gunner' && weaponType === WeaponType.GUNNER_MINIGUN) {
      const t = this.getGunnerBoostT();
      if (t > 0) {
        const j = this.gunnerBoostJitter * t;
        finalAngle += (Math.random() * 2 - 1) * j;
      }
    }
    // Apply global damage multiplier (percent-based passive)
  const gdm = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
    bulletDamage *= gdm;

    if (weaponType === WeaponType.RAPID) {
      const arcSpread = 0.35;
      const arcIndex = (index - (total - 1) / 2);
      const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1, (total - 1) || 1));
      bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, bulletDamage, weaponLevel);
      return;
    }

    // Tech Warrior: if charged and firing a spear, emit a triple-spear volley instead, then consume charge
    if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).techCharged) {
      const spreadAng = 12 * Math.PI / 180;
      const base = finalAngle;
      const lvl = weaponLevel;
      const dmgBase = (this.bulletDamage || bulletDamage) * 2.0;
      const angles = [base - spreadAng, base, base + spreadAng];
      for (let ai = 0; ai < angles.length; ai++) {
        const a = angles[ai];
        const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.TACHYON_SPEAR, dmgBase, lvl);
        if (b) {
          (b as any)._isVolley = true;
          b.damage = dmgBase;
          const boost = 1.35;
          b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
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
      return;
    }

    // Default single projectile spawn
    const b = bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, bulletDamage, weaponLevel);
    if (this.characterData?.id === 'heavy_gunner' && weaponType === WeaponType.GUNNER_MINIGUN && b) {
      const t = this.getGunnerBoostT();
      if (t > 0) {
        const rMul = 1 + (this.gunnerBoostRange - 1) * t;
        if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rMul * rMul);
        if (b.life != null) b.life = Math.round(b.life * rMul);
        const dmgMul = 1 + (this.gunnerBoostDamage - 1) * t;
        b.damage = (b.damage ?? bulletDamage) * dmgMul;
  // Add temporary piercing +2 during boost
  const addPierce = 2;
  if ((b as any).pierceRemaining == null) (b as any).pierceRemaining = 0;
  (b as any).pierceRemaining += addPierce;
      }
    }
  }

  /** Railgun charge + beam fire sequence */
  private handleRailgunFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    // Use a state flag on player to prevent re-entry during charge
    if ((this as any)._railgunCharging) return;
    (this as any)._railgunCharging = true;
  const chargeTimeMs = 1000; // single subtle reverse shockwave at 1s
  let startTime = performance.now();
  let chargedOnce = false;
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
  const gdmRG = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  const beamDamageTotal = ((spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) * 1.25) * gdmRG; // apply global damage passive
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

  /**
   * Beam (melter): fires a short-lived continuous beam that locks a single target and applies DPS each frame.
   * Visuals: tight white-hot core with faint amber, small impact bloom and occasional sparks.
   */
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
  let startTime = performance.now();
  let chargedOnce = false;
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
  // Continue charging if time remains; fire immediately upon completion
  if (now - startTime < chargeTimeMs) { requestAnimationFrame(chargeStep); return; }
      // Fire instantaneous beam
      (this as any)._sniperCharging = false;
      (this as any)._sniperState = 'idle';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      // Start weapon cooldown now (mirror loop logic)
      {
        const FRAME_MS = 1000 / 60;
        const specStats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : undefined;
        let baseCdMs: number | undefined = (specStats && typeof (specStats as any).cooldownMs === 'number') ? (specStats as any).cooldownMs : (typeof (spec as any).cooldownMs === 'number' ? (spec as any).cooldownMs : undefined);
        let baseCdFrames: number | undefined = baseCdMs == null ? (specStats && typeof (specStats as any).cooldown === 'number' ? (specStats as any).cooldown : (spec?.cooldown ?? 60)) : undefined;
  const rateSource2 = (this.getFireRateModifier?.() ?? this.fireRateModifier);
  const rateMul = Math.max(0.1, (this.attackSpeed || 1) * ((rateSource2 != null ? rateSource2 : 1)));
        const effCd = typeof baseCdMs === 'number' ? (baseCdMs / rateMul) : ((baseCdFrames as number) / rateMul) * FRAME_MS;
        this.shootCooldowns.set(WeaponType.GHOST_SNIPER, effCd);
      }
      const game: any = this.gameContext;
      if (!game) return;
      const beamAngle = Math.atan2(target.y - originY, target.x - originX);
      const range = spec.range || 1200;
  const baseDamage = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) || 100;
  const gdmSN = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
      const heavyMult = 1.6; // toned down for DPS balance
  let remaining = baseDamage * heavyMult * gdmSN;
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
            const bossDmg = (baseDamage * heavyMult * gdmSN) * 0.7; // include global damage passive
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
  // Shorter steady-aim; during Umbral Surge, near-instant aim
  const surge = this.isShadowSurgeActive();
  // Increase charge time by 50% (surge and normal)
  const chargeTimeMs = surge ? 375 : 1050;
  (this as any)._sniperChargeStart = performance.now();
  (this as any)._sniperChargeMax = chargeTimeMs;
  let startTime = performance.now();
  let chargedOnce = false;
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
  // Fire immediately when charge completes; bar is the shot caller
  const elapsed = now - startTime;
  if (elapsed < chargeTimeMs) { requestAnimationFrame(chargeStep); return; }
      (this as any)._sniperCharging = false;
      (this as any)._sniperState = 'idle';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      // Start weapon cooldown now (mirror loop logic)
      {
        const FRAME_MS = 1000 / 60;
        const specStats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : undefined;
        let baseCdMs: number | undefined = (specStats && typeof (specStats as any).cooldownMs === 'number') ? (specStats as any).cooldownMs : (typeof (spec as any).cooldownMs === 'number' ? (spec as any).cooldownMs : undefined);
        let baseCdFrames: number | undefined = baseCdMs == null ? (specStats && typeof (specStats as any).cooldown === 'number' ? (specStats as any).cooldown : (spec?.cooldown ?? 60)) : undefined;
  const rateSource3 = (this.getFireRateModifier?.() ?? this.fireRateModifier);
  const rateMul = Math.max(0.1, (this.attackSpeed || 1) * ((rateSource3 != null ? rateSource3 : 1)));
        const effCd = typeof baseCdMs === 'number' ? (baseCdMs / rateMul) : ((baseCdFrames as number) / rateMul) * FRAME_MS;
        this.shootCooldowns.set(WeaponType.VOID_SNIPER, effCd);
      }
      const game: any = this.gameContext; if (!game) return;
      const beamAngle = Math.atan2(target.y - originY, target.x - originX);
  const range = spec.range || 1200;
  const ghostSpec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
  const baseDamageGhost = (ghostSpec.getLevelStats ? ghostSpec.getLevelStats(weaponLevel).damage : ghostSpec.damage) || 95;
  // Slightly reduce per-tick damage to balance faster cadence overall; include global damage scaling
  const gdmVS = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  const perTick = 0.40 * baseDamageGhost * gdmVS;
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
        const dot = e._voidSniperDot as { next:number; left:number; dmg:number; stacks?: number } | undefined;
        if (!dot) {
          // New stack: create DoT state and apply an immediate tick so the enemy cannot "dodge" the first damage
          e._voidSniperDot = { next: nowBase + tickIntervalMs, left: ticks, dmg: perTick, stacks: 1 } as any;
          try {
            const gm: any = this.gameContext?.enemyManager;
            if (gm) {
              gm.takeDamage(e as Enemy, perTick, false, false, WeaponType.VOID_SNIPER);
            }
          } catch {}
          // Consume one tick immediately
          if (e._voidSniperDot.left > 0) e._voidSniperDot.left--;
        } else {
          // Stacking: add per-tick damage; refresh next tick time; keep at least current max remaining ticks
          dot.left = Math.max(dot.left, ticks);
          dot.dmg = (dot.dmg || 0) + perTick;
          dot.next = nowBase + tickIntervalMs;
          dot.stacks = (dot.stacks || 1) + 1;
          // Apply an immediate tick with the updated per-tick amount
          try {
            const gm: any = this.gameContext?.enemyManager;
            if (gm) {
              gm.takeDamage(e as Enemy, dot.dmg, false, false, WeaponType.VOID_SNIPER);
            }
          } catch {}
          if (dot.left > 0) dot.left--;
        }
        // Brief paralysis on impact (0.5s)
        e._paralyzedUntil = Math.max(e._paralyzedUntil || 0, nowBase + 500);
        e._lastHitByWeapon = WeaponType.VOID_SNIPER as any;
      }

      // Boss intersection: apply the same DoT to boss if the beam crosses it
      try {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
          const relX = boss.x - originX; const relY = boss.y - originY;
          const proj = relX * cosA + relY * sinA;
          const ortho = Math.abs(-sinA * relX + cosA * relY);
          if (proj >= 0 && proj <= range && ortho <= (thickness + (boss.radius || 160))) {
            const bAny: any = boss as any;
            const dotB = bAny._voidSniperDot as { next:number; left:number; dmg:number; stacks?: number } | undefined;
            if (!dotB) {
              bAny._voidSniperDot = { next: nowBase + tickIntervalMs, left: ticks, dmg: perTick, stacks: 1 };
              // Immediate first tick on boss via EnemyManager.takeBossDamage
              try { (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, perTick, false, false, weaponLevel); } catch {}
              if ((bAny._voidSniperDot as any).left > 0) (bAny._voidSniperDot as any).left--;
            } else {
              dotB.left = Math.max(dotB.left, ticks);
              dotB.dmg = (dotB.dmg || 0) + perTick;
              dotB.next = nowBase + tickIntervalMs;
              dotB.stacks = (dotB.stacks || 1) + 1;
              try { (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, dotB.dmg, false, false, weaponLevel); } catch {}
              if (dotB.left > 0) dotB.left--;
            }
            (boss as any)._lastHitByWeapon = WeaponType.VOID_SNIPER;
            // Subtle visual ping on boss
            try { this.gameContext?.particleManager?.spawn(boss.x, boss.y, 1, '#B266FF'); } catch {}
          }
        }
      } catch {}
      // Recoil & visuals
      this.x -= Math.cos(beamAngle) * 8; this.y -= Math.sin(beamAngle) * 8;
      if (!game._activeBeams) game._activeBeams = [];
      const beamObj = { type: 'voidsniper', x: originX, y: originY, angle: beamAngle, range, start: performance.now(), duration: 1500, lastTick: performance.now(), weaponLevel, thickness: 10 };
      game._activeBeams.push(beamObj);
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
    };
    requestAnimationFrame(chargeStep);
  }

  // Tick cooldowns and temporary buffs for class abilities
  private _preUpdate(now: number, dt: number) {
    // Shadow Operative cooldown tick
    if (this.characterData?.id === 'shadow_operative') {
      if (now < this.shadowSurgeUntil) {
        // Active window — advance aura phase
        this.shadowTentaclePhase += dt;
      } else {
        // Ended: restore speed once, then refill CD
        if (this.shadowPrevSpeed != null) {
          this.speed = this.shadowPrevSpeed;
          this.shadowPrevSpeed = undefined;
        }
        // Notify overlay listeners once per end
        if (this.shadowSurgeUntil !== 0) {
          try { window.dispatchEvent(new CustomEvent('shadowSurgeEnd')); } catch {}
        }
        // Clear aura data when surge ends
        if (this.shadowTentacles) this.shadowTentacles = undefined;
        this.shadowTentaclePhase = 0;
        this.shadowSurgeCdMs = Math.min(this.shadowSurgeCdMaxMs, this.shadowSurgeCdMs + dt);
      }
    }
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
    // Apply per-character visual/physical scale
    // Tech Warrior is 25% larger (sprite + hurtbox)
    this.characterScale = (data?.id === 'tech_warrior') ? 1.25 : 1.0;
    // Recompute sprite size from base
    this.size = Math.round(this.baseSpriteSize * this.characterScale);
    // Cache baseSpeed AFTER scaling applied
  this.baseSpeed = this.speed;
  }

  /** Returns per-character scale (1.0 = default). */
  public getCharacterScale(): number { return this.characterScale; }

  /** Returns innate (pre-passive) movement speed */
  public getBaseMoveSpeed(): number { return this.baseMoveSpeed; }
  /** Returns innate (pre-passive) max HP */
  public getBaseMaxHp(): number { return this.baseMaxHp; }
  /** Returns innate (pre-passive) bullet damage */
  public getBaseBulletDamage(): number { return this.baseBulletDamage; }
  /** Returns global damage multiplier */
  public getGlobalDamageMultiplier(): number { return this.globalDamageMultiplier; }
  /** Returns global area multiplier (AoE radius scale) */
  public getGlobalAreaMultiplier(): number { return this.globalAreaMultiplier; }
  /** Returns global fire-rate modifier (cooldown scale; >1 = faster) */
  public getFireRateModifier(): number { return this.fireRateModifier; }

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
      // Shadow Operative: draw tentacle aura under the main sprite when Umbral Surge is active
      if (this.characterData?.id === 'shadow_operative' && (typeof performance !== 'undefined' ? performance.now() : Date.now()) < this.shadowSurgeUntil && this.shadowTentacles?.length) {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const t = (this.shadowTentaclePhase || 0) / 1000;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < this.shadowTentacles.length; i++) {
          const arm = this.shadowTentacles[i];
          const ang = arm.baseAngle + Math.sin(t * arm.speed * Math.PI * 2 + i * 0.7) * arm.wobble;
          const segs = 8;
          const step = arm.len / segs;
          const cosA = Math.cos(ang), sinA = Math.sin(ang);
          let px = 0, py = 0;
          for (let s = 0; s < segs; s++) {
            const nx = px + cosA * step;
            const ny = py + sinA * step;
            const w = arm.width * (1 - s / segs);
            ctx.strokeStyle = 'rgba(60, 0, 90, 0.35)';
            ctx.lineWidth = Math.max(1, w);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(nx, ny);
            ctx.stroke();
            // inner glow
            ctx.strokeStyle = 'rgba(178, 102, 255, 0.25)';
            ctx.lineWidth = Math.max(0.5, w * 0.5);
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(nx, ny);
            ctx.stroke();
            px = nx; py = ny;
          }
          // tip wisp
          ctx.fillStyle = 'rgba(210, 160, 255, 0.18)';
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
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
  // Compute the rotation we actually apply to the sprite this frame
  let appliedRotation = this.rotation;
  if (this.characterData?.id === 'cyber_runner') {
    if (this.bladeCycloneActive) {
      appliedRotation = this.bladeCycloneStartRotation + this.cycloneSpinAngle;
    } else if (this.bladeCycloneSettleMs > 0) {
      const t = 1 - (this.bladeCycloneSettleMs / Math.max(1, this.bladeCycloneSettleTotalMs)); // 0..1
      // easeOutQuad
      const ease = 1 - (1 - t) * (1 - t);
      const start = this.bladeCycloneEndRotation;
      const end = this.rotation; // follow current aim/base rotation
      // Shortest angle interpolation to avoid wrap-around jerk
      const diff = ((end - start + Math.PI) % (2 * Math.PI)) - Math.PI;
      appliedRotation = start + diff * ease;
    }
  }
  ctx.rotate(appliedRotation + spriteFacingOffset);
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
      // Blade Cyclone visual: two tachyon-like swords orbiting while active (scaled to match hit radius)
      if (this.characterData?.id === 'cyber_runner' && this.bladeCycloneActive) {
  const now = performance.now();
  // Use the same accumulated spin to keep swords synced with the sprite spin
  const baseAngle = this.cycloneSpinAngle % (Math.PI * 2);
        // Visual radius equals cyclone damage radius (400px * area multiplier)
  const cycloneRadiusVisual = (this as any).getBladeCycloneTipRadius?.() ?? 240;
  // Choose orbit (pivot) and blade length so tip reaches the exact ring: radius + bladeLen = ring
  const bladeLen = Math.max(80, cycloneRadiusVisual * 0.5);
  const radius = Math.max(32, cycloneRadiusVisual - bladeLen);
        const bob = Math.sin(now / 90) * 2; // tiny bob to sell weight
        // Simple motion trail by drawing faded swords behind
        const trailCount = 2;
        const trailFade = 0.45;
        const drawSword = (ang: number, mirror: boolean) => {
          ctx.save();
          // Position sword around player in world space (ignore sprite rotation offset)
          ctx.rotate(- (appliedRotation + spriteFacingOffset)); // neutralize the sprite rotation we applied
          const px = Math.cos(ang) * radius;
          const py = Math.sin(ang) * radius + bob;
          ctx.translate(px, py);
          ctx.rotate(ang + Math.PI/2);
          if (mirror) ctx.scale(-1, 1);
          // Sword shape: thinner, longer neon cyan blade with white core
          const bladeW = 4.2; // slightly thinner
          // Glow
          ctx.globalCompositeOperation = 'lighter';
          ctx.shadowColor = 'rgba(0,255,255,0.65)';
          ctx.shadowBlur = 14;
          // Core (slightly shorter than blade for depth)
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillRect(-bladeW*0.22, -bladeLen*0.9, bladeW*0.44, bladeLen*0.8);
          // Cyan blade
          const grad = ctx.createLinearGradient(0, -bladeLen*0.5, 0, bladeLen*0.5);
          grad.addColorStop(0, 'rgba(200,255,255,0.85)');
          grad.addColorStop(1, 'rgba(0,255,255,0.55)');
          ctx.fillStyle = grad;
          // Blade from pivot (0) to tip (-bladeLen) so the tip lands on the ring
          ctx.fillRect(-bladeW/2, -bladeLen, bladeW, bladeLen);
          // Hilt
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#082b2e';
          ctx.fillRect(-10, 2, 20, 6);
          ctx.restore();
        };
        // Edge indicator ring at exact damage radius (subtle cyan glow)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(0,255,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
  ctx.arc(0, 0, cycloneRadiusVisual, 0, Math.PI * 2);
        ctx.stroke();
        // Rotating arc segments to suggest motion
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(0,255,255,0.5)';
        for (let i = 0; i < 3; i++) {
          const segStart = baseAngle + i * (2 * Math.PI / 3);
          ctx.beginPath();
          ctx.arc(0, 0, cycloneRadiusVisual, segStart, segStart + 0.35);
          ctx.stroke();
        }
        ctx.restore();
        // Trails (sub-angles behind the current angle)
        for (let i = trailCount; i >= 1; i--) {
          const a = baseAngle - i * 0.25;
          const alpha = Math.max(0, trailFade * (1 - i / (trailCount + 1)));
          ctx.save();
          ctx.globalAlpha *= alpha;
          drawSword(a, false);
          drawSword(a + Math.PI, true);
          ctx.restore();
        }
        // Current swords
        drawSword(baseAngle, false);
        drawSword(baseAngle + Math.PI, true);
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
  performTechGlide?: () => void;
  performBladeCycloneDamage?: () => void;
  getBladeCycloneTipRadius?: () => number;
}

Player.prototype.activateAbility = function(this: Player & any) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const id = this.characterData?.id;
  switch (id) {
    case 'rogue_hacker': {
      // System Hack: massive EMP-like hack that damages and disables nearby enemies instantly
      if (this.hackerHackCdMs <= 0) {
        this.hackerHackCdMs = this.hackerHackCdMaxMs;
        const lvl = this.activeWeapons.get(WeaponType.HACKER_VIRUS) ?? 1;
        const gdm = (this as any).globalDamageMultiplier || 1;
        // Scale damage moderately with level; wide radius; 2s paralysis baseline
        const radius = 360;
        const base = 70 + 28 * (Math.max(1, Math.min(7, lvl)) - 1); // 70 → 238
        const damage = Math.round(base * gdm);
        const paralyzeMs = 2000;
        const glitchMs = 520;
        try { window.dispatchEvent(new CustomEvent('rogueHackUltimate', { detail: { x: this.x, y: this.y, radius, damage, paralyzeMs, glitchMs } })); } catch {}
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 140, intensity: 3.2 } })); } catch {}
      }
      break;
    }
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
    case 'shadow_operative': {
      // Umbral Surge: 5s burst of speed and near-instant void shots; 20s cooldown
      if (this.shadowSurgeCdMs >= this.shadowSurgeCdMaxMs) {
        this.shadowSurgeCdMs = 0;
        this.shadowSurgeUntil = now + 5000;
  try { window.dispatchEvent(new CustomEvent('shadowSurgeStart', { detail: { durationMs: 5000 } })); } catch {}
        // Grant brief i-frames and speed buff
        this.invulnerableUntilMs = Math.max(this.invulnerableUntilMs || 0, now + 600);
  if (this.shadowPrevSpeed == null) this.shadowPrevSpeed = this.speed;
  this.speed = (this.shadowPrevSpeed || this.speed || 2.2) * 1.25; // small bump; restored after surge
        // Initialize aura tentacles
        this.shadowTentaclePhase = 0;
        const count = 7; // odd for organic distribution
        const twoPi = Math.PI * 2;
        const tentacles: Array<{ baseAngle: number; len: number; wobble: number; speed: number; width: number }> = new Array(count);
        for (let i = 0; i < count; i++) {
          const base = (i / count) * twoPi + (Math.random() * 0.5 - 0.25);
          const len = 36 + Math.random() * 18;
          const wobble = 0.4 + Math.random() * 0.6; // radians sway
          const speed = 1.2 + Math.random() * 1.2; // Hz-ish
          const width = 6 + Math.random() * 4;
          tentacles[i] = { baseAngle: base, len, wobble, speed, width };
        }
        this.shadowTentacles = tentacles;
        // Feedback VFX
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2.2 } })); } catch {}
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
      // Overmind Overload: fire a single, powerful thread overload burst; 2s cooldown
      if (this.overmindCdMs <= 0) {
        // Put ability on cooldown immediately (no sustained active window)
        this.overmindActive = false;
        this.overmindActiveMs = 0;
        this.overmindCdMs = this.overmindCdMaxMs;
        // Scale overload slightly by current Neural Threader level
        const lvl = this.activeWeapons.get(WeaponType.NOMAD_NEURAL) ?? 1;
  const multiplier = 1 + 0.50 * (Math.max(1, Math.min(7, lvl)) - 1); // 1.0 -> 4.0x (stronger one-shot)
        try { window.dispatchEvent(new CustomEvent('nomadOverload', { detail: { multiplier } })); } catch {}
        // Feedback FX: global teal shockwave + soft charge glow + modest shake
        try {
          window.dispatchEvent(new CustomEvent('overmindFX', { detail: { x: this.x, y: this.y, radius: 260 } }));
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
        } catch {}
      }
      break;
    }
    case 'data_sorcerer': {
      // Sigil Surge: fire-and-forget; here we just start cooldown and emit a spawn hint
      if (this.sorcererSigilCdMs <= 0) {
        this.sorcererSigilCdMs = this.sorcererSigilCdMaxMs;
        // Reuse EnemyManager's plantDataSigil with follow=true so it trails the player and pulses a few times
        try {
          // Pull scaling from Data Sigil weapon level so ability matches weapon progression
          const lvl = this.activeWeapons.get(WeaponType.DATA_SIGIL) ?? 1;
          const spec: any = (WEAPON_SPECS as any)[WeaponType.DATA_SIGIL];
          const stats = spec?.getLevelStats ? spec.getLevelStats(lvl) : undefined;
          // Make ability sigil significantly larger; still affected by level and global area multiplier
          const radius = ((stats?.sigilRadius ?? 140) * 1.8);
          // Ability lives longer and connects more: more pulses, slightly faster cadence, quick initial burst
          const basePulses = (stats?.pulseCount ?? 4);
          const pulseCount = Math.ceil(basePulses * 1.5);
          const pulseDamage = (stats?.pulseDamage ?? 95);
          const detail = { x: this.x, y: this.y, radius, pulseCount, pulseDamage, follow: true, pulseCadenceMs: 360, pulseDelayMs: 140 };
          window.dispatchEvent(new CustomEvent('plantDataSigil', { detail }));
        } catch {}
      }
      break;
    }
    case 'heavy_gunner': {
      // Basic toggle-on press; full hold logic could be added later
      if (!this.gunnerBoostActive) {
        this.gunnerBoostActive = true;
  // No initiation cost
      }
      break;
    }
    default:
      break;
  }
};

// Returns the Blade Cyclone effective radius (match sword tips visually)
(Player as any).prototype.getBladeCycloneTipRadius = function(this: Player & any): number {
  const areaMul = this.getGlobalAreaMultiplier?.() ?? (this.globalAreaMultiplier ?? 1);
  // Authoritative cyclone radius (edge ring and damage), scaled by area multiplier
  const baseR = 200; // smaller: visual/damage edge in pixels at area=1
  return baseR * (areaMul || 1);
};

// Class-private helper: perform AOE damage tick for Blade Cyclone (single canonical definition)
(Player as any).prototype.performBladeCycloneDamage = function(this: Player & any) {
  if (this.characterData?.id !== 'cyber_runner') return;
  if (!this.bladeCycloneActive) return;

  const enemies = this.enemyProvider ? this.enemyProvider() : [];
  const cycloneRadius = (this.getBladeCycloneTipRadius?.() ?? 0) || 240; // fallback ~240px
  const lvl = Math.max(1, Math.round(this.level || 1));
  const gdm = this.getGlobalDamageMultiplier?.() ?? (this.globalDamageMultiplier ?? 1);

  // Damage: high base with modest level scaling
  const base = 40 + Math.floor((lvl - 1) * 1.2); // 40 @1 -> ~98 @50
  const damage = Math.round(base * (gdm || 1));
  // Micro knockback only, outward from hero (no pull)
  const baseKb = 6 + Math.floor((lvl - 1) * 0.15); // gentle push

  let hits = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.active || e.hp <= 0) continue;
    const dx = e.x - this.x;
    const dy = e.y - this.y;
    const distSq = dx*dx + dy*dy;
    if (distSq > cycloneRadius * cycloneRadius) continue;

    // Deal damage via EnemyManager for consistency
    const enemyMgr = this.gameContext?.enemyManager;
    if (enemyMgr && typeof enemyMgr.takeDamage === 'function') {
      const isCrit = Math.random() < (((this as any).critBonus || 0) + 0.1);
      enemyMgr.takeDamage(e, damage, isCrit, false, WeaponType.RUNNER_GUN, this.x, this.y, lvl);
    }

  // Outward micro knockback (safe for zero distance)
    const d = Math.sqrt(distSq) || 1;
    const normX = dx / d, normY = dy / d;
  const strength = baseKb * (0.8 + 0.4 * Math.random());
  e.x += normX * strength;
  e.y += normY * strength;

    // Hit spark
    const pm = this.gameContext?.particleManager;
    if (pm) pm.spawn(e.x, e.y, 1, '#00FFFF', { sizeMin: 1.0, sizeMax: 2.0, life: 26, speedMin: 1.2, speedMax: 2.2 });
    hits++;
  }

  if (hits > 0) {
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 80, intensity: Math.min(3, 1 + hits * 0.25) } })); } catch {}
  }
};

// (Removed older duplicate performRunnerDash that teleported instantly and incorrectly hosted cyclone damage definition.)

// Class-private helper: perform Tech Warrior glide dash with easing and brief i-frames
(Player as any).prototype.performTechGlide = function(this: Player & any) {
  if (this.characterData?.id !== 'tech_warrior') return;
  if (this.techDashCooldownMs > 0 || this.techDashActive) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Parameters: shorter distance, slower duration
  const baseDistance = 240; // shorter than Runner
  const durationMs = this.techDashDurationMs; // 360ms by default
  // Direction: follow current move input; if idle, do nothing
  const mvMag = Math.hypot(this.vx || 0, this.vy || 0);
  if (mvMag < 0.01) return;
  const ang = Math.atan2(this.vy, this.vx);
  const dx = Math.cos(ang), dy = Math.sin(ang);
  this.techDashStartX = this.x; this.techDashStartY = this.y;
  this.techDashEndX = this.x + dx * baseDistance;
  this.techDashEndY = this.y + dy * baseDistance;
  this.techDashTimeMs = 0;
  this.techDashActive = true;
  this.techDashEmitAccum = 0;
  // Brief i-frames (slightly shorter than full duration for counterplay)
  this.invulnerableUntilMs = Math.max(this.invulnerableUntilMs || 0, now + Math.min(durationMs - 40, 300));
  // Gentle feedback
  try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 70, intensity: 1.6 } })); } catch {}
};

// Class-private helper: activate Blade Cyclone (single consolidated definition)
(Player as any).prototype.performBladeCyclone = function(this: Player & any) {
  if (this.characterData?.id !== 'cyber_runner') return;
  if (this.bladeCycloneCooldownMs > 0) return;

  this.bladeCycloneActive = true;
  this.bladeCycloneTimeMs = 0;
  this.bladeCycloneCooldownMs = this.bladeCycloneCooldownMsMax;
  // Anchor draw spin to current facing
  this.bladeCycloneStartRotation = this.rotation || 0;
  this.cycloneSpinAngle = 0;

  // Brief i-frames and strong feedback
  try { this.invulnerableUntilMs = Math.max(this.invulnerableUntilMs || 0, performance.now() + 400); } catch {}
  try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 160, intensity: 3.5 } })); } catch {}

  // Initial particle burst
  const pm = this.gameContext?.particleManager;
  if (pm) {
    const burst = 14;
    for (let i = 0; i < burst; i++) {
      const a = (i / burst) * Math.PI * 2;
      const r = 18 + Math.random() * 20;
      pm.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1, '#FFAA33', { sizeMin: 1.4, sizeMax: 2.8, life: 48, speedMin: 1.2, speedMax: 2.6 });
    }
  }
};

// Class-private helper: activate Cyber Runner dash
(Player as any).prototype.performRunnerDash = function(this: Player & any) {
  if (this.characterData?.id !== 'cyber_runner') return;

  // Calculate dash distance based on level
  const lvl = Math.max(1, Math.round(this.level || 1));
  const baseDistance = 200;
  const distance = baseDistance + Math.floor((lvl - 1) * 4); // +4px per level, 600px at Lv50

  // Direction based on movement input or facing direction
  let dirX = 0, dirY = 0;
  if (keyState['w'] || keyState['arrowup']) dirY -= 1;
  if (keyState['s'] || keyState['arrowdown']) dirY += 1;
  if (keyState['a'] || keyState['arrowleft']) dirX -= 1;
  if (keyState['d'] || keyState['arrowright']) dirX += 1;

  // If no input, dash in facing direction
  if (dirX === 0 && dirY === 0) {
    dirX = Math.cos(this.rotation);
    dirY = Math.sin(this.rotation);
  } else {
    // Normalize diagonal movement
    const len = Math.hypot(dirX, dirY);
    if (len > 0) {
      dirX /= len;
      dirY /= len;
    }
  }

  // Set dash target position
  const startX = this.x;
  const startY = this.y;
  const endX = startX + dirX * distance;
  const endY = startY + dirY * distance;

  // Start dash
  this.runnerDashActive = true;
  this.runnerDashTimeMs = 0;
  this.runnerDashStartX = startX;
  this.runnerDashStartY = startY;
  this.runnerDashEndX = endX;
  this.runnerDashEndY = endY;
  this.runnerDashCooldownMs = this.runnerDashCooldownMsMax;

  // Invulnerability during dash
  this.invulnerableUntilMs = performance.now() + 300; // 300ms i-frames

  // Screen shake effect
  try {
    window.dispatchEvent(new CustomEvent('screenShake', { detail: { intensity: 0.4, durationMs: 300 } }));
  } catch {}

  // Sound effect
  try {
    const soundManager = (this.gameContext as any)?.soundManager;
    if (soundManager?.play) {
      soundManager.play('dash', 0.8);
    }
  } catch {}
};

// (Removed duplicate older performBladeCycloneDamage implementation)

