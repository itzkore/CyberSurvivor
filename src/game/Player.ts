import { keyState } from './keyState';
import { Bullet } from './Bullet';
import { Enemy } from './EnemyManager';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { computeGhostRangeBonus } from './operatives/ghost_operative/RangePassive';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
import { SPEED_SCALE, EXP_BASE, EXP_LINEAR, EXP_QUAD, getHealEfficiency } from './Balance';
import { Logger } from '../core/Logger';
import { AssetLoader } from './AssetLoader';
import { GhostProtocolAbility } from './operatives/rogue_hacker/abilities/ghostprotocol_shift';
import type { BaseAbilityManager } from './operatives/BaseAbilityManager';
import { AbilityManagerFactory } from './operatives/AbilityManagerFactory';
// import { getOperativeHooks } from './operatives/hooks'; // Removed - not needed

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
  /** Fortress scale tween (0..1). Lerps visual growth so size change is clearly visible. */
  private fortressScaleT: number = 0;
  /** Accumulator for periodic Fortress stomps (fires every ~1000ms while active). */
  private fortressStompAccMs: number = 0;
  /** Gate an immediate stomp on activation. */
  private fortressDidInitialStomp: boolean = false;

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

  // Ability manager for operative-specific functionality
  private abilityManager: BaseAbilityManager | null = null;

  // passive modifiers (may be set by passive upgrades)
  public fireRateModifier: number = 1;
  public bulletDamage: number = 10;
  /** Innate baseline bullet damage captured on character load */
  private baseBulletDamage: number = 10;
  /** Global multiplicative damage bonus from passives (1 = base) */
  public globalDamageMultiplier: number = 1;
  /** Global multiplicative area bonus from passives (1 = base). Used for AoE radii when applicable. */
  public globalAreaMultiplier: number = 1;
  public magnetRadius: number = 60; // QoL: +20% base gem pickup radius for smoother flow
  public attackSpeed: number = 1; // Attack speed multiplier (1 = base)
  // Plasma weapon heat (0..1)
  public plasmaHeat: number = 0;
  /** Knockback resistance: 0 = none, 1 = immune. Requested +100% => default to 1.0 */
  public knockbackResistance: number = 1.0;

  /** Returns a multiplicative knockback factor [0..1] after applying resistance. */
  public getKnockbackMultiplier(): number {
    const r = typeof this.knockbackResistance === 'number' ? this.knockbackResistance : 0;
    return Math.max(0, Math.min(1, 1 - r));
  }

  /**
   * Apply a small global buff to non-class weapons to keep parity with class weapon power.
   * Class weapons remain unchanged. Returns the adjusted damage value.
   */
  private applyNonClassWeaponBuff(spec: any, damage: number): number {
    try {
      const isClass = !!(spec && spec.isClassWeapon === true);
      // Global balance: nerf class weapons by 40%, lightly buff non-class by 15%
      // This function now applies BOTH sides so callers get a single adjustment step.
      if (isClass) return damage * 0.6;
      const mul = 1.15; // +15% damage for non-class weapons
      return damage * mul;
    } catch { return damage; }
  }

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
  // Temporary movement slow (e.g., Elite Suppressor pulse)
  public movementSlowUntil?: number;
  public movementSlowFrac?: number; // 0..1 fraction of speed retained (e.g., 0.75 keeps 75%)
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

  /**
   * Heavy Gunner power shaping function (0..1.15). Grows faster near max heat and adds a small edge surge.
   * Used for damage/fire rate/range; jitter/spread continue to use linear t for control.
   */
  private getGunnerPowerT(): number {
    if (this.characterData?.id !== 'heavy_gunner') return 0;
    if (!this.gunnerBoostActive) return 0;
    const heatT = Math.max(0, Math.min(1, this.gunnerHeatMs / this.gunnerHeatMsMax));
    const base = Math.max(this.gunnerBoostFloorT, heatT);
    const shaped = Math.pow(base, 1.6);
    const edge = heatT > 0.9 ? (heatT - 0.9) / 0.1 : 0; // 0..1 near overheat
    return Math.min(1.15, shaped + 0.15 * edge);
  }

  // Cyber Runner: Dash (Shift) — dodge distance scales with level (200px at Lv1 → 400px at Lv50), 5s cooldown
  private runnerDashCooldownMsMax: number = 5000;
  private runnerDashCooldownMs: number = 0;
  private runnerDashPrevKey: boolean = false; // rising-edge detection for Shift
  private invulnerableUntilMs: number = 0; // generic i-frames end time (ms since performance.now)
  /** Afterimage trail entries for Cyber Runner dash */
  private runnerAfterimages: { x: number; y: number; rotation: number; flip: boolean; ageMs: number; lifeMs: number; alpha: number; }[] = [];
  /** Pool of reusable afterimage objects to reduce GC churn */
  private runnerAfterimagesPool: { x: number; y: number; rotation: number; flip: boolean; ageMs: number; lifeMs: number; alpha: number; }[] = [];
  private runnerDashActive: boolean = false;
  private runnerDashTimeMs: number = 0;
  private runnerDashDurationMs: number = 300; // dash duration
  private runnerDashStartX: number = 0;
  private runnerDashStartY: number = 0;
  private runnerDashEndX: number = 0;
  private runnerDashEndY: number = 0;
  private runnerDashEmitAccum: number = 0;
  /** Cyber Runner: Overdrive surge window end time (ms since performance.now). While active, evolved Runner shots gain crit and speed. */
  private runnerOverdriveSurgeUntil: number = 0;

  // Cyber Runner: Blade Cyclone (Ctrl) — AOE spin attack with high damage, 6s cooldown
  private bladeCycloneCooldownMsMax: number = 6000;
  private bladeCycloneCooldownMs: number = 0;
  private bladeCyclonePrevKey: boolean = false; // rising-edge detection for Ctrl
  private bladeCycloneActive: boolean = false;
  private bladeCycloneTimeMs: number = 0;
  private bladeCycloneDurationMs: number = 600; // longer duration, slower spin
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
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'tech_warrior') {
      const meters = this.abilityManager.getAbilityMeters();
      return meters.tech_glide || { value: 0, max: 1, ready: false, active: false };
    }
    // Fallback to legacy implementation
    return { value: this.techDashCooldownMsMax - this.techDashCooldownMs, max: this.techDashCooldownMsMax, ready: this.techDashCooldownMs <= 0 && !this.techDashActive, active: this.techDashActive };
  }

  public getTechAnchor(): { value: number; max: number; ready: boolean; active: boolean } {
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'tech_warrior') {
      const meters = this.abilityManager.getAbilityMeters();
      return meters.tech_anchor || { value: 0, max: 1, ready: false, active: false };
    }
    // No legacy implementation for anchor (was removed by copilot)
    return { value: 0, max: 1, ready: false, active: false };
  }

  public getRunnerBoomerang(): { value: number; max: number; ready: boolean; active: boolean } {
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'cyber_runner') {
      const meters = this.abilityManager.getAbilityMeters();
      return meters.runner_vector_boomerang || { value: 0, max: 1, ready: false, active: false };
    }
    // No legacy implementation
    return { value: 0, max: 1, ready: false, active: false };
  }

  public getRunnerDash(): { value: number; max: number; ready: boolean; active: boolean } {
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'cyber_runner') {
      const meters = this.abilityManager.getAbilityMeters();
      return meters.runner_dash || { value: 0, max: 1, ready: false, active: false };
    }
    // Fallback to legacy implementation if available
    return { value: this.runnerDashCooldownMsMax - this.runnerDashCooldownMs, max: this.runnerDashCooldownMsMax, ready: this.runnerDashCooldownMs <= 0, active: this.runnerDashActive || false };
  }

  public getRunnerOverdrive(): { value: number; max: number; ready: boolean; active: boolean } {
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'cyber_runner') {
      const meters = this.abilityManager.getAbilityMeters();
      return meters.runner_overdrive || { value: 0, max: 1, ready: false, active: false };
    }
    // Fallback to legacy implementation
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const until = this.runnerOverdriveSurgeUntil || 0;
    return { value: until > now ? until - now : 0, max: 1500, ready: true, active: until > now };
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
  /** Cached per-glide impact damage (scaled from Tachyon Spear and capped at Singularity Spear). */
  private techDashImpactDamage: number = 0;
  /** Cached per-glide hit radius (px), scaled by Area. */
  private techDashHitRadius: number = 0;
  /** Per-glide set of enemy ids already hit to prevent multi-hits within one glide. */
  private techDashHitIds: Set<string> = new Set();
  /** Boss hit gate for the current glide. */
  private techDashBossHit: boolean = false;
  /** Forward unit vector for the current glide (used for cone/front checks). */
  private techDashDirX: number = 0;
  private techDashDirY: number = 0;
  /** Cached Tachyon Spear level for knockback scaling during this glide. */
  private techDashWeaponLevel: number = 1;

  // Rogue Hacker: Ghost Protocol (Shift) — intangibility + aura; separate from System Hack (Space)
  private ghostProtocol?: GhostProtocolAbility;
  private ghostPrevShift: boolean = false;
  public getGhostProtocolMeter() {
    const anyThis: any = this as any;
    const gp = this.ghostProtocol;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const readyAt = (gp && typeof gp.cooldownReadyAt === 'number') ? gp.cooldownReadyAt : (anyThis._ghostProtocolCdUntil || 0);
    const ready = now >= (readyAt || 0);
    const active = !!(gp && gp.isActive);
    const dur = gp ? gp.durationMs : 3000;
    const cd = gp ? gp.cooldownMs : 14000;
    // When active, show elapsed toward duration; else show cooldown progress
    const value = active ? (dur - gp!.timeLeftMs) : (ready ? cd : Math.max(0, cd - Math.max(0, (readyAt || 0) - now)));
    const max = active ? dur : cd;
    return { value, max, ready: !active && ready, active };
  }

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

  // Psionic Weaver: Lattice Weave (Spacebar) — cooldown/duration scale with PSIONIC_WAVE and cap at RESONANT_WEB
  private latticeCdMaxMs: number = 12000;
  private latticeCdMs: number = 0;
  private latticeActiveMs: number = 0;
  private latticeActiveMsMax: number = 4000; // dynamic (4–6000ms)
  private latticeActive: boolean = false;
  private latticePrevKey: boolean = false;
  public getWeaverLatticeMeter() {
    const maxActive = this.latticeActiveMsMax || 4000;
    return { value: this.latticeActive ? this.latticeActiveMs : (this.latticeCdMaxMs - this.latticeCdMs), max: this.latticeActive ? maxActive : this.latticeCdMaxMs, ready: this.latticeCdMs <= 0 && !this.latticeActive, active: this.latticeActive };
  }
  // Titan Mech: Fortress Stance (Shift) — 14s cooldown, 4s duration
  public getFortressMeter() {
    const anyThis: any = this as any;
    const active = !!anyThis.fortressActive;
    const cdMax = anyThis.fortressCdMaxMs || 14000;
    const durMax = anyThis.fortressActiveMsMax || 4000;
    const value = active ? (anyThis.fortressActiveMs || 0) : (cdMax - (anyThis.fortressCdMs || 0));
    const max = active ? durMax : cdMax;
    const ready = !active && ((anyThis.fortressCdMs || 0) <= 0);
    return { value, max, ready, active };
  }

  // Ghost Operative: Phase Cloak (Spacebar) — scales with GHOST_SNIPER and caps at SPECTRAL_EXECUTIONER
  private cloakCdMaxMs: number = 15000; // dynamic (11–16s band)
  private cloakCdMs: number = 0;
  private cloakActiveMs: number = 0;
  private cloakActiveMsMax: number = 5000; // dynamic (5–6500ms)
  private cloakActive: boolean = false;
  private cloakPrevSpeed?: number;
  // Shadow Operative: restore speed after Umbral Surge
  private shadowPrevSpeed?: number;
  public getGhostCloakMeter() {
  const activeMax = this.cloakActiveMsMax || 5000;
  return { value: this.cloakActive ? this.cloakActiveMs : (this.cloakCdMaxMs - this.cloakCdMs), max: this.cloakActive ? activeMax : this.cloakCdMaxMs, ready: this.cloakCdMs <= 0 && !this.cloakActive, active: this.cloakActive };
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
  // Bio Engineer: BIO Boost (Shift) — 12s cooldown, 4s duration; x2 fire rate and massive speed boost
  private bioBoostCdMaxMs: number = 12000;
  private bioBoostCdMs: number = 0;
  private bioBoostActiveMs: number = 0;
  private bioBoostActive: boolean = false;
  private bioBoostPrevShift: boolean = false;
  private bioBoostSpeedMul: number = 2.2; // massive movement speed boost
  private bioBoostFireRateMul: number = 2.0; // double fire rate
  public getBioBoostMeter() {
    return { value: this.bioBoostActive ? this.bioBoostActiveMs : (this.bioBoostCdMaxMs - this.bioBoostCdMs), max: this.bioBoostActive ? 4000 : this.bioBoostCdMaxMs, ready: this.bioBoostCdMs <= 0 && !this.bioBoostActive, active: this.bioBoostActive };
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
  /** Alternating side for Runner Gun when firing a single shot per trigger (-1 left, +1 right) */
  private runnerSide: number = -1;

  constructor(x: number, y: number, characterData?: any) {
    this.x = x;
    this.y = y;
    this.baseSpeed = this.speed;
  this.baseMoveSpeed = this.speed; // initialize innate base
    
    if (characterData) {
      this.characterData = characterData;
      // Initialize ability manager for this operative
      this.abilityManager = AbilityManagerFactory.createManager(characterData.id);
      if (this.abilityManager) {
        this.abilityManager.init(this);
      }
      
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
  // Global revive cinematic lockout: disable all player input/actions while active
  const reviving = !!(window as any).__reviveCinematicActive;
  // Optional local guard: small grace if needed after revive to avoid queued inputs
  const localReviveLockUntil: number = (this as any)._reviveInputLockUntil || 0;
  const inputLocked = reviving || (now < localReviveLockUntil);
  
  // Update ability manager if available
  if (this.abilityManager) {
    this.abilityManager.update(dt, keyState, inputLocked);
  }
  
  // Tick class ability cooldowns/buffs
  this._preUpdate(now, dt);
    // Post-cyclone settle timer tick
    if (this.bladeCycloneSettleMs > 0) {
      this.bladeCycloneSettleMs = Math.max(0, this.bladeCycloneSettleMs - dt);
    }
    // Movement (WASD/Arrows) — blocked while reviving or operative lock (e.g., Ghost ult charge)
    let ax = 0, ay = 0;
    const inputMoveLocked = !!((this as any)._inputMoveLocked);
    if (!inputLocked && !inputMoveLocked) {
    if (keyState['w'] || keyState['arrowup']) ay -= 1;
    if (keyState['s'] || keyState['arrowdown']) ay += 1;
    if (keyState['a'] || keyState['arrowleft']) ax -= 1;
    if (keyState['d'] || keyState['arrowright']) ax += 1;
  }
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
  // Apply temporary BIO Boost speed multiplier if active (Bio Engineer only)
  const speedMul = (this.characterData?.id === 'bio_engineer' && this.bioBoostActive) ? this.bioBoostSpeedMul : 1;
  let moveMul = speedMul;
  // Fortress stance: reduce movement while braced to emphasize anchoring
  if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) moveMul *= 0.55;
  // Elite Suppressor pulse: brief slow if tagged
  try {
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if ((this.movementSlowUntil || 0) > nowMs) {
      const frac = Math.max(0.2, Math.min(1, this.movementSlowFrac || 0.75));
      moveMul *= frac;
    } else {
      this.movementSlowUntil = 0; this.movementSlowFrac = 0;
    }
  } catch { /* ignore */ }
  this.vx = (inputLocked || inputMoveLocked) ? 0 : ax * this.speed * moveMul;
  this.vy = (inputLocked || inputMoveLocked) ? 0 : ay * this.speed * moveMul;
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
  if (!reviving && this.shootCooldowns.size) {
      for (const [k, v] of this.shootCooldowns) {
        const nv = v - dt;
        this.shootCooldowns.set(k, nv > 0 ? nv : 0);
      }
    }

  // Cyber Runner: dash cooldown tick + input edge detect (Shift)
  if (!inputLocked && this.characterData?.id === 'cyber_runner') {
      // If an ability manager exists for Runner, it owns dash input/cooldown. Keep Blade Cyclone here.
      const hasManager = !!this.abilityManager;
      if (!hasManager) {
        if (this.runnerDashCooldownMs > 0) this.runnerDashCooldownMs = Math.max(0, this.runnerDashCooldownMs - dt);
        const shiftNow = !!keyState['shift'];
        if (shiftNow && !this.runnerDashPrevKey && this.runnerDashCooldownMs <= 0) {
          (this as any).performRunnerDash?.();
        }
        this.runnerDashPrevKey = shiftNow;
      }

      // Blade Cyclone: Spacebar for AOE spin attack (edge-trigger)
      if (this.bladeCycloneCooldownMs > 0) this.bladeCycloneCooldownMs = Math.max(0, this.bladeCycloneCooldownMs - dt);
      const spaceNowRunner = !!(keyState[' '] || (keyState as any)['space'] || (keyState as any)['spacebar']);
      if (spaceNowRunner && !this.bladeCyclonePrevKey && this.bladeCycloneCooldownMs <= 0) {
        (this as any).performBladeCyclone?.();
      }
      this.bladeCyclonePrevKey = spaceNowRunner;
    }

    // Tech Warrior: glide dash (Shift) — delegate to ability manager if available
  if (!inputLocked && this.characterData?.id === 'tech_warrior') {
      if (this.abilityManager) {
        // Let ability manager handle shift key press
        const shiftNow = !!keyState['shift'];
        if (shiftNow && !this.techDashPrevKey) {
          this.abilityManager.handleKeyPress('shift', keyState);
        }
        this.techDashPrevKey = shiftNow;
      } else {
        // Fallback to legacy implementation
        if (this.techDashCooldownMs > 0) this.techDashCooldownMs = Math.max(0, this.techDashCooldownMs - dt);
        const shiftNow = !!keyState['shift'];
        if (shiftNow && !this.techDashPrevKey && this.techDashCooldownMs <= 0 && !this.techDashActive) {
          this.performTechGlide?.();
        }
        this.techDashPrevKey = shiftNow;
      }
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
          // During each emission step, also perform a cheap collision sweep for glide impact
          try {
            const em: any = (this.gameContext as any)?.enemyManager;
            if (em && typeof em.queryEnemies === 'function') {
              const r = this.techDashHitRadius || 0;
              if (r > 0 && (this.techDashImpactDamage || 0) > 0) {
                const cand = em.queryEnemies(this.x, this.y, r + 16) as any[];
                if (cand && cand.length) {
                  const dirX = this.techDashDirX || 0, dirY = this.techDashDirY || 0;
                  const idSet = this.techDashHitIds;
                  const dmg = this.techDashImpactDamage | 0;
                  const wLvl = this.techDashWeaponLevel | 0;
                  for (let i = 0; i < cand.length; i++) {
                    const e = cand[i];
                    if (!e || !e.active || e.hp <= 0) continue;
                    const eid = e.id || '' + (e._uid || i);
                    if (idSet.has(eid)) continue;
                    const dx = e.x - this.x, dy = e.y - this.y;
                    const d2 = dx*dx + dy*dy; if (d2 > (r*r)) continue;
                    // Only hit enemies generally in front of the glide direction to reduce side swipes
                    const dist = Math.sqrt(d2) || 1; const nx = dx / dist, ny = dy / dist;
                    if (dirX*nx + dirY*ny < -0.45) continue; // allow wider cone in front (hit more on glide)
                    // Apply damage via EnemyManager to unify knockback behavior; source at current player pos
                    const isCrit = false;
                    em.takeDamage(e, dmg, isCrit, false, WeaponType.TACHYON_SPEAR, this.x, this.y, wLvl, true);
                    idSet.add(eid);
                    // Small spark
                    this.gameContext?.particleManager?.spawn(e.x, e.y, 1, '#66E6FF', { sizeMin: 0.9, sizeMax: 1.8, lifeMs: 180, speedMin: 0.8, speedMax: 1.6 });
                  }
                }
              }
              // Boss parity: if active boss intersects the glide radius, apply reduced damage once per glide
              try {
                const bm: any = (window as any).__bossManager; const boss = bm?.getActiveBoss?.() || bm?.getBoss?.();
                if (!this.techDashBossHit && boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
                  const r = (this.techDashHitRadius || 0) + (boss.radius || 120);
                  const dxB = boss.x - this.x, dyB = boss.y - this.y;
                  if (dxB*dxB + dyB*dyB <= r*r) {
                    const dmgB = Math.max(1, Math.round((this.techDashImpactDamage || 0) * 0.6));
                    (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, dmgB, false, WeaponType.TACHYON_SPEAR, this.x, this.y, this.techDashWeaponLevel, true);
                    this.techDashBossHit = true;
                  }
                }
              } catch { /* ignore boss parity errors */ }
            }
          } catch { /* no enemy manager or grid yet */ }
        }
        if (this.techDashTimeMs >= this.techDashDurationMs) {
          this.techDashActive = false;
          this.techDashTimeMs = 0;
          this.techDashEmitAccum = 0;
          this.techDashCooldownMs = this.techDashCooldownMsMax;
        }
      }
    }

    // Bio Engineer: BIO Boost (Shift) — independent of Outbreak (Space)
  if (!inputLocked && this.characterData?.id === 'bio_engineer') {
      if (this.bioBoostActive) {
        this.bioBoostActiveMs += dt;
        if (this.bioBoostActiveMs >= 4000) {
          this.bioBoostActive = false;
          this.bioBoostActiveMs = 0;
          this.bioBoostCdMs = this.bioBoostCdMaxMs; // start cooldown when effect ends
          try { (window as any).__bioBoostActiveUntil = 0; } catch {}
        }
      } else if (this.bioBoostCdMs > 0) {
        this.bioBoostCdMs = Math.max(0, this.bioBoostCdMs - dt);
      }
      const shiftNowBio = !!keyState['shift'];
      if (shiftNowBio && !this.bioBoostPrevShift && this.bioBoostCdMs <= 0 && !this.bioBoostActive) {
        this.bioBoostActive = true;
        this.bioBoostActiveMs = 0;
        // Signal EnemyManager for aura VFX window
        try { (window as any).__bioBoostActiveUntil = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 4000; } catch {}
        // Small burst particles via global particle manager if available
        try {
          const pm = (this.gameContext as any)?.particleManager;
          if (pm) {
            const burst = 14;
            for (let i = 0; i < burst; i++) {
              const a = (i / burst) * Math.PI * 2;
              const r = 10 + (i % 2) * 6;
              pm.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1, '#73FF00', { sizeMin: 1, sizeMax: 2.2, lifeMs: 360, speedMin: 1, speedMax: 2.6 });
            }
          }
        } catch {}
      }
      this.bioBoostPrevShift = shiftNowBio;
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
        const gi = this.runnerAfterimagesPool.pop() || { x: 0, y: 0, rotation: 0, flip: false, ageMs: 0, lifeMs: 0, alpha: 1 };
        gi.x = this.x; gi.y = this.y; gi.rotation = this.rotation - Math.PI/2; gi.flip = flipNow; gi.ageMs = 0; gi.lifeMs = lifeMs; gi.alpha = alpha;
        this.runnerAfterimages.push(gi);
        if (this.runnerAfterimages.length > 64) {
          // Move oldest overflow entries back into pool for reuse
          const overflow = this.runnerAfterimages.length - 64;
          for (let k = 0; k < overflow; k++) {
            const reclaimed = this.runnerAfterimages[k];
            if (this.runnerAfterimagesPool.length < 96) this.runnerAfterimagesPool.push(reclaimed);
          }
          this.runnerAfterimages.splice(0, overflow);
        }
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
  // Advance sprite spin; slower overall to reduce visual churn
  const easeInOut = (p: number) => (p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p);
  const spinTurns = 1.2 + 0.4 * easeInOut(t); // ~1.2 -> 1.6 turns over the duration
  const totalRadians = spinTurns * Math.PI * 2;
  const perMs = totalRadians / Math.max(1, this.bladeCycloneDurationMs);
  this.cycloneSpinAngle += perMs * dt;

      // AOE damage every 150ms during cyclone
      if (Math.floor(this.bladeCycloneTimeMs / 150) !== Math.floor((this.bladeCycloneTimeMs - dt) / 150)) {
        (this as any).performBladeCycloneDamage();
      }

  // Spawn rotation particles (throttled to cut overdraw)
      const pm = this.gameContext?.particleManager;
      if (pm) {
        const cycloneRadiusVisual = (this as any).getBladeCycloneTipRadius?.() ?? 240;
    // Inner sparkle (reduced rate)
    if (Math.random() < 0.3) {
          const a = Math.random() * Math.PI * 2;
          const r = 30 + Math.random() * Math.min(100, cycloneRadiusVisual * 0.3);
          pm.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1, '#00FFFF', { sizeMin: 0.9, sizeMax: 2.0, life: 34, speedMin: 0.8, speedMax: 2.2 });
        }
    // Outer swirl hints (reduced rate)
  if (Math.random() < 0.18) {
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
      // remove expired in place while pooling
      let w = 0;
      for (let r = 0; r < this.runnerAfterimages.length; r++) {
        const g = this.runnerAfterimages[r];
        if (g.ageMs < g.lifeMs) {
          this.runnerAfterimages[w++] = g;
        } else {
          if (this.runnerAfterimagesPool.length < 96) this.runnerAfterimagesPool.push(g);
        }
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
    // Psionic Weaver (active window and cooldown can be dynamically scaled)
    if (this.latticeActive) {
      this.latticeActiveMs += dt;
      if (this.latticeActiveMs >= (this.latticeActiveMsMax || 4000)) {
        this.latticeActive = false;
        this.latticeActiveMs = 0;
        this.latticeCdMs = this.latticeCdMaxMs; // start cooldown when effect ends
      }
    } else if (this.latticeCdMs > 0) {
      this.latticeCdMs = Math.max(0, this.latticeCdMs - dt);
    }
    // Ghost Operative: cloak timers (active window/cooldown can be dynamically scaled)
    if (this.characterData?.id === 'ghost_operative') {
      if (this.cloakActive) {
        this.cloakActiveMs += dt;
        if (this.cloakActiveMs >= (this.cloakActiveMsMax || 5000)) {
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
    // Titan Mech: Fortress Stance timers (4s active, 14s cooldown)
    if (this.characterData?.id === 'titan_mech') {
      if ((this as any).fortressActive) {
        (this as any).fortressActiveMs = ((this as any).fortressActiveMs || 0) + dt;
    // Periodic stomp: once per second while Fortress is active
        this.fortressStompAccMs += dt;
        const ex = (this.gameContext as any)?.explosionManager;
        const em: any = (this.gameContext as any)?.enemyManager;
        // On activation, fire an immediate stomp once
        if (!this.fortressDidInitialStomp) {
          this.fortressDidInitialStomp = true;
          try {
      // Use a fixed base radius; ExplosionManager applies area multipliers once globally.
      const radius = 300;
            // Base damage budget: use Mortar stats unless the evolved Howitzer is actually owned
            const aw: Map<number, number> | undefined = (this as any).activeWeapons;
            const hasEvolved = !!(aw && aw.has(WeaponType.SIEGE_HOWITZER));
            const specBase: any = WEAPON_SPECS[hasEvolved ? WeaponType.SIEGE_HOWITZER : WeaponType.MECH_MORTAR];
      const lvlRaw = aw ? (hasEvolved ? (aw.get(WeaponType.SIEGE_HOWITZER) || 1) : (aw.get(WeaponType.MECH_MORTAR) || 1)) : 1;
      const lvl = Math.min(7, Math.max(1, lvlRaw));
      const ls = specBase?.getLevelStats ? specBase.getLevelStats(lvl) : { damage: 220 } as any;
            const gdm = this.getGlobalDamageMultiplier?.() ?? (this as any).globalDamageMultiplier ?? 1;
      // Gentle scaling: 0.6x at L1 → 1.0x at L7
      const scale = 0.6 + (lvl - 1) * (0.4 / 6);
  const stompDamage = Math.max(1, Math.round(((ls.damage || 220) * scale) * gdm * this.getTitanOnlyDamageNerf()));
            // Route damage through ExplosionManager only (avoids double-ticks); boss takes a reduced fraction
            ex?.triggerShockwave(this.x, this.y, stompDamage, radius, '#8B0000', 0.25);
            // Strong outward knockback impulse to sell the stomp
            if (em && typeof em.getEnemies === 'function') {
              const enemies = em.getEnemies();
              const r2 = radius * radius;
              for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i]; if (!e.active || e.hp <= 0) continue;
                // LS FoW: enemies hidden by fog are untargetable and immune to knockback
                try { if (!this.isVisibleForAim(e.x, e.y)) continue; } catch { /* ignore */ }
                const dx = e.x - this.x, dy = e.y - this.y; const d2 = dx*dx + dy*dy; if (d2 > r2) continue;
                const d = Math.max(1, Math.sqrt(d2)); const nx = dx / d, ny = dy / d;
                let boost = 2600; // a bit stronger than Data Sigil finale
                try { if ((window as any).__gameInstance?.gameMode === 'LAST_STAND') boost *= 0.25; } catch {}
                const existingRadial = ((e as any).knockbackVx || 0) * nx + ((e as any).knockbackVy || 0) * ny;
                const added = boost * (existingRadial > 0 ? (em as any).knockbackStackScale || 0.55 : 1);
                const maxV = (em as any).knockbackMaxVelocity || 4200;
                const baseMs = (em as any).knockbackBaseMs || 140;
                const newMag = Math.min(maxV, Math.max(existingRadial, 0) + added);
                (e as any).knockbackVx = nx * newMag; (e as any).knockbackVy = ny * newMag;
                (e as any).knockbackTimer = Math.max((e as any).knockbackTimer || 0, baseMs + 110);
                // Damage already applied via shockwave; skip duplicate direct damage
              }
            }
            // Boss damage handled by triggerShockwave bossDamageFrac
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 180, intensity: 5.5 } }));
          } catch { /* ignore */ }
        }
    while (this.fortressStompAccMs >= 1000) {
          this.fortressStompAccMs -= 1000;
          try {
      // Use fixed base radius; ExplosionManager applies area multipliers.
      const radius = 300;
            const aw: Map<number, number> | undefined = (this as any).activeWeapons;
            const hasEvolved = !!(aw && aw.has(WeaponType.SIEGE_HOWITZER));
            const specBase: any = WEAPON_SPECS[hasEvolved ? WeaponType.SIEGE_HOWITZER : WeaponType.MECH_MORTAR];
      const lvlRaw = aw ? (hasEvolved ? (aw.get(WeaponType.SIEGE_HOWITZER) || 1) : (aw.get(WeaponType.MECH_MORTAR) || 1)) : 1;
      const lvl = Math.min(7, Math.max(1, lvlRaw));
      const ls = specBase?.getLevelStats ? specBase.getLevelStats(lvl) : { damage: 220 } as any;
            const gdm = this.getGlobalDamageMultiplier?.() ?? (this as any).globalDamageMultiplier ?? 1;
      const scale = 0.6 + (lvl - 1) * (0.4 / 6);
  const stompDamage = Math.max(1, Math.round(((ls.damage || 220) * scale) * gdm * this.getTitanOnlyDamageNerf()));
            ex?.triggerShockwave(this.x, this.y, stompDamage, radius, '#8B0000', 0.25);
            // Outward impulse knockback
            if (em && typeof em.getEnemies === 'function') {
              const enemies = em.getEnemies();
              const r2 = radius * radius;
              for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i]; if (!e.active || e.hp <= 0) continue;
                // LS FoW: enforce immunity to knockback when hidden
                try { if (!this.isVisibleForAim(e.x, e.y)) continue; } catch { /* ignore */ }
                const dx = e.x - this.x, dy = e.y - this.y; const d2 = dx*dx + dy*dy; if (d2 > r2) continue;
                const d = Math.max(1, Math.sqrt(d2)); const nx = dx / d, ny = dy / d;
                let boost = 2600;
                try { if ((window as any).__gameInstance?.gameMode === 'LAST_STAND') boost *= 0.25; } catch {}
                const existingRadial = ((e as any).knockbackVx || 0) * nx + ((e as any).knockbackVy || 0) * ny;
                const added = boost * (existingRadial > 0 ? (em as any).knockbackStackScale || 0.55 : 1);
                const maxV = (em as any).knockbackMaxVelocity || 4200;
                const baseMs = (em as any).knockbackBaseMs || 140;
                const newMag = Math.min(maxV, Math.max(existingRadial, 0) + added);
                (e as any).knockbackVx = nx * newMag; (e as any).knockbackVy = ny * newMag;
                (e as any).knockbackTimer = Math.max((e as any).knockbackTimer || 0, baseMs + 110);
                // Damage already applied via shockwave; skip duplicate direct damage
              }
            }
            // Boss damage handled by triggerShockwave bossDamageFrac
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 160, intensity: 5 } }));
          } catch { /* ignore */ }
        }
        if ((this as any).fortressActiveMs >= 4000) {
          (this as any).fortressActive = false; (this as any).fortressActiveMs = 0; (this as any).fortressCdMs = (this as any).fortressCdMaxMs || 14000;
          try { window.dispatchEvent(new CustomEvent('fortressEnd')); } catch {}
        }
      } else if (((this as any).fortressCdMs || 0) > 0) {
        (this as any).fortressCdMs = Math.max(0, ((this as any).fortressCdMs || 0) - dt);
        // Reset stomp accumulators while inactive
        this.fortressStompAccMs = 0; this.fortressDidInitialStomp = false;
      }
    }
  // Bio Engineer: Outbreak timers and input (Spacebar). 5s active, 15s cooldown.
  // Respect global input lock (e.g., revive cinematic) to avoid accidental activation.
  if (!inputLocked && this.characterData?.id === 'bio_engineer') {
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
        // Scale Outbreak radius and potency from class weapon levels; cap by evolved
        const aw: Map<number, number> | undefined = (this as any).activeWeapons;
        const btLvl = (() => { try { return aw?.get(WeaponType.BIO_TOXIN) ?? 1; } catch { return 1; } })();
        const hasSludge = !!(aw && aw.has(WeaponType.LIVING_SLUDGE));
        const btSpec: any = (WEAPON_SPECS as any)[WeaponType.BIO_TOXIN];
        const btStats = btSpec?.getLevelStats ? btSpec.getLevelStats(Math.max(1, Math.min(7, btLvl))) : { cooldown: 88 };
        // Base 300 radius at L1; +12 per BT level (up to L7), multiplied by global area
        const radiusBase = 300 + (Math.max(1, Math.min(7, btLvl)) - 1) * 12;
        const radius = radiusBase * (areaMul || 1);
        // Potency: stacks per tick start at 1; when evolved to Living Sludge, increase to 2 for harder virality
        const stacksPerTick = hasSludge ? 2 : 1;
        const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        try {
          (window as any).__bioOutbreakActiveUntil = nowMs + 5000;
          window.dispatchEvent(new CustomEvent('bioOutbreakStart', { detail: { x: this.x, y: this.y, radius, durationMs: 5000, stacksPerTick } }));
        } catch {}
      }
      this.bioOutbreakPrevKey = spaceNow;
    }
  // Rogue Hacker: Ghost Protocol (Shift) — activation and ticking
    if (!inputLocked && this.characterData?.id === 'rogue_hacker') {
      // Lazy init once we know character
      if (!this.ghostProtocol) {
        this.ghostProtocol = new GhostProtocolAbility(this as any, {
          durationMs: 3000,
          cooldownMs: 10000, // 10s CD per request
          auraRadius: 160,   // smaller zone per request
          dps: 180,
          tickMs: 220,
          slowPct: 0.35,
          glitchMs: 1200,
          moveSpeedMul: 0.55,
        });
      }
      // Live scaling: tie to class weapon level and evolution for damage and visuals
      try {
        const aw: Map<number, number> | undefined = (this as any).activeWeapons;
        const evolved = !!(aw && aw.has(WeaponType.HACKER_BACKDOOR));
        const lvl = aw ? (aw.get(WeaponType.HACKER_BACKDOOR) || aw.get(WeaponType.HACKER_VIRUS) || 1) : 1;
        // Base on Hacker Virus DPS and multiply when evolved so ability never gets weaker
        const spec: any = (WEAPON_SPECS as any)[WeaponType.HACKER_VIRUS];
        const ls = spec?.getLevelStats ? spec.getLevelStats(Math.max(1, Math.min(7, lvl))) : { damage: 32, cooldown: 32 };
        const baseDps = (ls.damage * 60) / Math.max(1, (ls.cooldown || 32));
        const targetDps = Math.round(baseDps * (evolved ? 1.75 : 1.25));
        // Keep zone smaller by default; slight bump when evolved for clarity
        const baseRadius = 160;
        const radius = evolved ? Math.round(baseRadius * 1.15) : baseRadius;
        const tickMs = evolved ? 180 : 200;
        this.ghostProtocol.updateScaling({ dps: targetDps, auraRadius: radius, tickMs, evolved });
      } catch { /* ignore */ }
      const shiftNow = !!keyState['shift'];
      if (shiftNow && !this.ghostPrevShift) {
        this.ghostProtocol.tryActivate();
      }
      this.ghostPrevShift = shiftNow;
      // Per-frame tick (even when not active, it's a cheap guard)
      this.ghostProtocol.update(dt);
    }
    // Titan Mech: Fortress Stance (Shift) — brace to reduce damage and steady cannons
    if (!inputLocked && this.characterData?.id === 'titan_mech') {
      const shiftNow = !!keyState['shift'];
      const cdMs = (this as any).fortressCdMs || 0;
      const active = !!(this as any).fortressActive;
      if (shiftNow && !this.ghostPrevShift && !active && cdMs <= 0) {
        (this as any).fortressActive = true; (this as any).fortressActiveMs = 0; (this as any).fortressCdMaxMs = 14000;
  // Reset stomp gates so activation fires immediate stomp
  this.fortressStompAccMs = 0;
  this.fortressDidInitialStomp = false;
        try { window.dispatchEvent(new CustomEvent('fortressStart', { detail: { x: this.x, y: this.y } })); } catch {}
      }
      // Store last shift for both hacker and titan paths
      this.ghostPrevShift = shiftNow;
    }
    // Smoothly animate Titan Mech visual growth in/out while Fortress toggles
    if (this.characterData?.id === 'titan_mech') {
      const rate = Math.max(0.0001, dt / 150); // ~150ms to reach target scale
      if ((this as any).fortressActive) this.fortressScaleT = Math.min(1, this.fortressScaleT + rate);
      else this.fortressScaleT = Math.max(0, this.fortressScaleT - rate);
    }
    // Passive HP regeneration (applies continuously; supports fractional accumulation)
    if ((this.regen || 0) > 0 && this.hp < this.maxHp) {
      const timeSec = (this as any).gameContext?.getGameTime?.() ?? (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
      const eff = getHealEfficiency(timeSec);
      const heal = (this.regen || 0) * (dt / 1000) * eff;
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

  // Generic auto-aim target for most weapons (includes enemies, boss, treasures)
  let target = this.findNearestEnemy();
  // Last Stand backstop: if any path returned a non-visible target, discard it
  if (target && !this.isVisibleForAim(target.x, target.y)) {
    target = null;
  }
  if (target) {
    // Face target for non-sniper weapons and general aim visuals
    this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
  }

  // Sniper-only pre-aim and charge logic uses a stricter target filter to avoid soon-exploding marks
  {
    // Auto-aim target, prefer one that won't explode before charge completes
    // Use a conservative avoid window equal to charge time (1.5s) since we pick before starting charge
    let target = this.findSniperTargetAvoidingSoonExploding(1500);
    // Fallback: if no enemy is found, try boss, then treasures
  if (!target) {
      try {
        const boss = (this.gameContext as any)?.bossManager?.getActiveBoss?.();
    if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE' && this.isVisibleForAim(boss.x, boss.y)) {
          target = boss as any;
        }
      } catch {}
    }
    if (!target) {
      try {
        const emAny: any = (this.gameContext as any)?.enemyManager;
        if (emAny && typeof emAny.getTreasures === 'function') {
          const treasures = emAny.getTreasures() as Array<{ x:number; y:number; active:boolean; hp:number }>;
          let bestT: any = null; let bestD2 = Infinity;
          for (let i = 0; i < treasures.length; i++) {
            const t = treasures[i];
      if (!t || !t.active || (t as any).hp <= 0) continue; if (!this.isVisibleForAim(t.x, t.y)) continue;
            const dx = (t.x - this.x); const dy = (t.y - this.y); const d2 = dx*dx + dy*dy;
            if (d2 < bestD2) { bestD2 = d2; bestT = t; }
          }
          if (bestT) target = bestT as any;
        }
      } catch { /* ignore treasure lookup */ }
    }
    if (target) {
      // Face sniper target for steady aim
      this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
    }

    // Immediate sniper charge start when stationary (Ghost/Shadow/Evolved), independent of cooldown
    if (target) {
      // Do not allow starting sniper charge while Ghost ultimate RMB is charging (or forcing basic suppression)
      const blockSniperCharge = !!((this as any)._ghostUltCharging) || !!((this as any)._basicFireSuppressed);
      if (blockSniperCharge) {
        // Cancel any in-progress charge immediately to avoid parallel state machines
        (this as any)._sniperCharging = false;
        (this as any)._sniperState = 'idle';
        (this as any)._sniperChargeStart = undefined;
        (this as any)._sniperChargeMax = 0;
      } else {
      // Suppress sniper charge entirely during Ghost Protocol (Rogue Hacker)
      if (this.characterData?.id === 'rogue_hacker' && (this as any)._ghostProtocolActive) {
        // Cancel any in-progress charge
        (this as any)._sniperCharging = false; (this as any)._sniperState = 'idle'; (this as any)._sniperChargeStart = undefined; (this as any)._sniperChargeMax = 0;
      } else {
        const moveMagForSniper = Math.hypot(this.vx || 0, this.vy || 0);
        if (moveMagForSniper <= 0.01 && !(this as any)._sniperCharging) {
          if (this.activeWeapons.has(WeaponType.GHOST_SNIPER)) {
            // Ghost: allow pre-charging regardless of cooldown; will hold until ready
            const spec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
            const lvl = this.activeWeapons.get(WeaponType.GHOST_SNIPER) ?? 1;
            // Re-evaluate target at fire moment; if about to explode, pick a safer target
            if (!target || !target.active || target.hp <= 0) target = this.findSniperTargetAvoidingSoonExploding(0);
            else {
              const anyT: any = target as any; const nowT = performance.now();
              if ((anyT._specterMarkUntil || 0) > 0 && (anyT._specterMarkUntil - nowT) <= 80) {
                target = this.findSniperTargetAvoidingSoonExploding(0);
              }
            }
            if (!target) { // final fallback: treasure
              try {
                const emAny: any = (this.gameContext as any)?.enemyManager;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number; y:number; active:boolean; hp:number }>;
                  let bestT: any = null; let bestD2 = Infinity;
                  for (let i = 0; i < treasures.length; i++) {
                    const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dx = (t.x - this.x); const dy = (t.y - this.y); const d2 = dx*dx + dy*dy;
                    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
                  }
                  if (bestT) target = bestT as any;
                }
              } catch {}
            }
            if (!target) { (this as any)._sniperCharging = false; (this as any)._sniperState = 'idle'; (this as any)._sniperChargeStart = undefined; (this as any)._sniperChargeMax = 0; return; }
            const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
            this.handleGhostSniperFire(baseAngle, target, spec, lvl, WeaponType.GHOST_SNIPER);
          } else if (this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER)) {
            // Evolved Ghost: identical charge/beam loop; uses evolved spec and visuals + mark logic
            const spec = WEAPON_SPECS[WeaponType.SPECTRAL_EXECUTIONER];
            const lvl = this.activeWeapons.get(WeaponType.SPECTRAL_EXECUTIONER) ?? 1;
            if (!target || !target.active || target.hp <= 0) target = this.findSniperTargetAvoidingSoonExploding(0);
            else {
              const anyT: any = target as any; const nowT = performance.now();
              if ((anyT._specterMarkUntil || 0) > 0 && (anyT._specterMarkUntil - nowT) <= 80) {
                target = this.findSniperTargetAvoidingSoonExploding(0);
              }
            }
            if (!target) {
              // final fallback: treasure
              try {
                const emAny: any = (this.gameContext as any)?.enemyManager;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number; y:number; active:boolean; hp:number }>;
                  let bestT: any = null; let bestD2 = Infinity;
                  for (let i = 0; i < treasures.length; i++) {
                    const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dx = (t.x - this.x); const dy = (t.y - this.y); const d2 = dx*dx + dy*dy;
                    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
                  }
                  if (bestT) target = bestT as any;
                }
              } catch {}
            }
            if (!target) { (this as any)._sniperCharging = false; (this as any)._sniperState = 'idle'; (this as any)._sniperChargeStart = undefined; (this as any)._sniperChargeMax = 0; return; }
            const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
            this.handleGhostSniperFire(baseAngle, target, spec, lvl, WeaponType.SPECTRAL_EXECUTIONER);
          } else if (this.activeWeapons.has(WeaponType.VOID_SNIPER)) {
            // Shadow: start charging immediately when stationary; charge loop cycles while waiting for cooldown.
            const spec = WEAPON_SPECS[WeaponType.VOID_SNIPER];
            const lvl = this.activeWeapons.get(WeaponType.VOID_SNIPER) ?? 1;
            if (!target || !target.active || target.hp <= 0) target = this.findSniperTargetAvoidingSoonExploding(0);
            else {
              const anyT: any = target as any; const nowT = performance.now();
              if ((anyT._specterMarkUntil || 0) > 0 && (anyT._specterMarkUntil - nowT) <= 80) {
                target = this.findSniperTargetAvoidingSoonExploding(0);
              }
            }
            if (!target) {
              // final fallback: treasure
              try {
                const emAny: any = (this.gameContext as any)?.enemyManager;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number; y:number; active:boolean; hp:number }>;
                  let bestT: any = null; let bestD2 = Infinity;
                  for (let i = 0; i < treasures.length; i++) {
                    const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dx = (t.x - this.x); const dy = (t.y - this.y); const d2 = dx*dx + dy*dy;
                    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
                  }
                  if (bestT) target = bestT as any;
                }
              } catch {}
            }
            if (!target) { (this as any)._sniperCharging = false; (this as any)._sniperState = 'idle'; (this as any)._sniperChargeStart = undefined; (this as any)._sniperChargeMax = 0; return; }
            const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
            this.handleVoidSniperFire(baseAngle, target, spec, lvl, WeaponType.VOID_SNIPER);
          } else if (this.activeWeapons.has(WeaponType.BLACK_SUN)) {
            // Evolved Shadow (Black Sun): multi-beam snipe to 5 unique targets
            const spec = WEAPON_SPECS[WeaponType.BLACK_SUN];
            const lvl = this.activeWeapons.get(WeaponType.BLACK_SUN) ?? 1;
            if (!target || !target.active || target.hp <= 0) target = this.findSniperTargetAvoidingSoonExploding(0);
            if (!target) {
              // final fallback: treasure
              try {
                const emAny: any = (this.gameContext as any)?.enemyManager;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number; y:number; active:boolean; hp:number }>;
                  let bestT: any = null; let bestD2 = Infinity;
                  for (let i = 0; i < treasures.length; i++) {
                    const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
                    const dx = (t.x - this.x); const dy = (t.y - this.y); const d2 = dx*dx + dy*dy;
                    if (d2 < bestD2) { bestD2 = d2; bestT = t; }
                  }
                  if (bestT) target = bestT as any;
                }
              } catch {}
            }
            if (!target) { (this as any)._sniperCharging = false; (this as any)._sniperState = 'idle'; (this as any)._sniperChargeStart = undefined; (this as any)._sniperChargeMax = 0; return; }
            const baseAngle = Math.atan2(target.y - this.y, target.x - this.x);
            this.handleBlackSunSniperMultiFire(baseAngle, target, spec, lvl);
          }
        }
      }
      }
    }
  }

  // Fire weapons when off cooldown. Most weapons require a target; Scrap-Saw and Drone can self-spawn.
  const isRogueHacker = this.characterData?.id === 'rogue_hacker';
  const suppressFire =
    (isRogueHacker && !!((this as any)._ghostProtocolActive)) ||
    !!((this as any)._fireLocked) ||
    !!((this as any)._ghostUltCharging) ||
    !!((this as any)._basicFireSuppressed);
  if (!suppressFire) for (const [weaponType, level] of this.activeWeapons) {
  // Skip disabled or special-case managed weapons
  const specSkip = WEAPON_SPECS[weaponType as unknown as WeaponType] as any;
  if (specSkip && specSkip.disabled) continue;
  // Quantum Halo: persistent orbs are managed by BulletManager; never fire like a normal weapon
  if (weaponType === WeaponType.QUANTUM_HALO) continue;
  // Sorcerer Orb: persistent orbit + beams managed by BulletManager
  if (weaponType === WeaponType.SORCERER_ORB) continue;
  // Rogue Hacker: skip class weapons here (zones are auto-cast by EnemyManager); allow other weapons
  if (isRogueHacker && (weaponType === WeaponType.HACKER_VIRUS || weaponType === WeaponType.HACKER_BACKDOOR)) continue;
        if (!this.shootCooldowns.has(weaponType)) this.shootCooldowns.set(weaponType, 0);
        const cd = this.shootCooldowns.get(weaponType) || 0;
  // Sniper special-case: if a charge is in progress, don't attempt to fire or reset cooldown here
  if ((weaponType === WeaponType.GHOST_SNIPER || weaponType === WeaponType.SPECTRAL_EXECUTIONER || weaponType === WeaponType.VOID_SNIPER || weaponType === WeaponType.BLACK_SUN) && (this as any)._sniperCharging) {
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
          let rateMul = Math.max(0.1, (this.attackSpeed || 1) * ((rateSource != null ? rateSource : 1)));
          // Bio Boost: double fire rate while active
          if (this.characterData?.id === 'bio_engineer' && this.bioBoostActive) {
            rateMul *= this.bioBoostFireRateMul;
          }
          // Heavy Gunner: minigun spins up while boosting — increase fire rate with heat
          let rateMulWithBoost = rateMul;
          if (this.characterData?.id === 'heavy_gunner' && (weaponType === WeaponType.GUNNER_MINIGUN || weaponType === WeaponType.GUNNER_LAVA_MINIGUN)) {
            const tShaped = (this as any).getGunnerPowerT ? (this as any).getGunnerPowerT() : this.getGunnerBoostT();
            rateMulWithBoost *= (1 + (this.gunnerBoostFireRate - 1) * tShaped);
          }
          if (typeof baseCdMs === 'number') { effCd = baseCdMs / rateMulWithBoost; }
          else { const effCdFrames = (baseCdFrames as number) / rateMulWithBoost; effCd = effCdFrames * FRAME_MS; }
      // Gate: only fire if target is within base range (no extra +10%).
          // Default: require a valid target. Exceptions: homing drone can spawn with no target and ignores range.
          let canFire = true;
          if (!(target && spec && typeof spec.range === 'number' && spec.range > 0)) {
            canFire = !!target;
          }
          // Exception: Kamikaze Drone (HOMING) may spawn without target, but in Last Stand restrict to visible space.
          if (weaponType === WeaponType.HOMING) {
            canFire = true;
            try {
              const bm = this.gameContext?.bulletManager;
              const lvl = Math.max(1, Math.min(7, Math.floor(level)));
              const cap = (lvl >= 7) ? 4 : (lvl >= 4 ? 3 : 2);
              let hovering = 0;
              const bullets = bm?.bullets || [];
              for (let bi = 0; bi < bullets.length; bi++) {
                const bb = bullets[bi]; if (!bb || !bb.active) continue; if (bb.weaponType !== WeaponType.HOMING) continue;
                const ph = (bb as any).phase; if (ph === 'ASCEND' || ph === 'HOVER') { hovering++; if (hovering >= cap) { canFire = false; break; } }
              }
              // In LS, disallow spawning a homing drone if no visible enemy exists right now
              if (canFire) {
                const gi: any = (window as any).__gameInstance; const inLs = !!(gi && gi.gameMode === 'LAST_STAND');
                if (inLs) {
                  let anyVisible = false;
                  const enemies = this.enemyProvider ? this.enemyProvider() : [];
                  for (let i = 0; i < enemies.length; i++) { const e = enemies[i]; if (!e || !e.active || e.hp <= 0) continue; if (this.isVisibleForAim(e.x, e.y)) { anyVisible = true; break; } }
                  if (!anyVisible) canFire = false;
                }
              }
            } catch {}
          }
            if (canFire && target && spec && typeof spec.range === 'number' && spec.range > 0 && weaponType !== WeaponType.HOMING) {
              const dx = target.x - this.x;
              const dy = target.y - this.y;
              let dist = Math.hypot(dx, dy);
              const isGunner = this.characterData?.id === 'heavy_gunner';
              let rangeMul = 1;
              if (isGunner && (weaponType === WeaponType.GUNNER_MINIGUN || weaponType === WeaponType.GUNNER_LAVA_MINIGUN)) {
                const tShaped = (this as any).getGunnerPowerT ? (this as any).getGunnerPowerT() : this.getGunnerBoostT();
                rangeMul = 1 + (this.gunnerBoostRange - 1) * tShaped;
              }
              let effectiveRange = spec.range * rangeMul;
              // LS: clamp effective range to vision radius (circle-only)
              try {
                const gi: any = (window as any).__gameInstance;
                if (gi && gi.gameMode === 'LAST_STAND') {
                  let rVis = 640; try { const tiles = typeof gi.getEffectiveFowRadiusTiles === 'function' ? gi.getEffectiveFowRadiusTiles() : 4; const ts = (typeof gi.fowTileSize === 'number') ? gi.fowTileSize : 160; rVis = Math.floor(tiles * ts * 0.95); } catch {}
                  effectiveRange = Math.min(effectiveRange, rVis);
                }
              } catch {}
              canFire = dist <= effectiveRange;
              // FoW gate: don't fire at targets outside visible field
              if (canFire && !this.isVisibleForAim(target.x, target.y)) {
                canFire = false;
              }
              // Railgun: require a nearby enemy to even begin charging to avoid firing into empty space
              if (canFire && weaponType === WeaponType.RAILGUN) {
                const minProximity = 480; // px
                if (dist > minProximity) canFire = false;
              }
            }
          // Determine final target for this weapon.
          // For other weapons: fire only if a valid target is available and in range.
          // If the current target is invisible (e.g., slipped behind fog), cancel this shot
          if (canFire && target && !this.isVisibleForAim(target.x, target.y)) {
            target = null; canFire = false;
          }
          let fireTarget: Enemy | null = canFire ? target : null;
          // If no target but this is a homing drone, synthesize a forward dummy target so we can spawn.
          if (!fireTarget && canFire && weaponType === WeaponType.HOMING) {
            const dirAng = (Math.hypot(this.vx || 0, this.vy || 0) > 0.01) ? Math.atan2(this.vy, this.vx) : (this.rotation || 0);
            const tx = this.x + Math.cos(dirAng) * 150;
            const ty = this.y + Math.sin(dirAng) * 150;
            const dummy = { x: tx, y: ty } as unknown as Enemy;
            this.shootAt(dummy, weaponType);
            this.shootCooldowns.set(weaponType, effCd);
            continue;
          }
          if (fireTarget) {
            // Neural Nomad: fire to multiple nearest targets per attack (2 → 5 based on level).
            // Targets include enemies, the active boss, and treasures. If fewer targets exist, duplicate closest to keep count consistent.
            if (this.characterData?.id === 'neural_nomad' && weaponType === WeaponType.NOMAD_NEURAL) {
              const enemies = this.enemyProvider ? [...this.enemyProvider()] : [];
              const maxShots = Math.min(5, Math.max(2, 1 + Math.floor(level))); // L1:2, L2:3, L3:4, L4+:5
              const rangeSq = (spec && typeof spec.range === 'number') ? (spec.range * spec.range) : Number.POSITIVE_INFINITY;
              const pairs: Array<{ e: any; d2: number }> = [];
              // Enemies
              for (let i = 0; i < enemies.length; i++) {
                const e = enemies[i]; if (!e || !(e as any).active || e.hp <= 0) continue; if (!this.isVisibleForAim(e.x, e.y)) continue;
                const dx = (e.x - this.x); const dy = (e.y - this.y); const d2 = dx*dx + dy*dy;
                if (d2 > rangeSq) continue; // enforce weapon range
                pairs.push({ e, d2 });
              }
              // Active boss (if any)
              try {
                const bm: any = (window as any).__bossManager;
                const boss = bm?.getActiveBoss?.() ?? bm?.getBoss?.();
                if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
                  const dxB = (boss.x ?? 0) - (this.x ?? 0);
                  const dyB = (boss.y ?? 0) - (this.y ?? 0);
                  const d2B = dxB*dxB + dyB*dyB;
                  if (d2B <= rangeSq) pairs.push({ e: boss as any, d2: d2B });
                }
              } catch { /* ignore boss lookup */ }
              // Treasures (valid shoot targets, low priority compared to enemies/boss in sort by distance)
              try {
                const emAny: any = (this.gameContext as any)?.enemyManager;
                if (emAny && typeof emAny.getTreasures === 'function') {
                  const treasures = emAny.getTreasures() as Array<{ x:number; y:number; active:boolean; hp:number }>;
                  for (let ti = 0; ti < treasures.length; ti++) {
                    const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue; if (!this.isVisibleForAim(t.x, t.y)) continue;
                    const dxT = (t.x - this.x); const dyT = (t.y - this.y); const d2T = dxT*dxT + dyT*dyT;
                    if (d2T <= rangeSq) pairs.push({ e: t as any, d2: d2T });
                  }
                }
              } catch { /* ignore treasure lookup */ }
              // Sort by distance
              pairs.sort((a, b) => a.d2 - b.d2);
              // If nothing collected (edge-case), fall back to the primary fireTarget
              if (pairs.length === 0) {
                const e: any = fireTarget as any; // should exist due to canFire gate
                const ang = Math.atan2((e.y ?? this.y) - this.y, (e.x ?? this.x) - this.x);
                this.spawnSingleProjectile(this.gameContext.bulletManager, weaponType, (WEAPON_SPECS[weaponType].damage || this.bulletDamage), level, ang, 0, 1, 0, e);
                this.shootCooldowns.set(weaponType, effCd);
                continue;
              }
              // Fire exactly maxShots, repeating nearest targets if fewer unique candidates
              const shots = maxShots;
              for (let si = 0; si < shots; si++) {
                const pick = pairs[si % pairs.length].e;
                const ang = Math.atan2((pick.y ?? this.y) - this.y, (pick.x ?? this.x) - this.x);
                this.spawnSingleProjectile(this.gameContext.bulletManager, weaponType, (WEAPON_SPECS[weaponType].damage || this.bulletDamage), level, ang, 0, 1, 0, pick as any);
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
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'tech_warrior') {
      return this.abilityManager.addTachyonHits?.(count) || false;
    }
    // Fallback to legacy implementation
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
    // Delegate to ability manager if available
    if (this.abilityManager && this.characterData?.id === 'tech_warrior') {
      const meters = this.abilityManager.getAbilityMeters();
      return meters.tachyon_charge || { value: 0, max: 1 };
    }
    // Fallback to legacy implementation
    return { value: this.techMeter, max: this.techMeterMax };
  }

  public addWeapon(type: WeaponType) {
  // Rogue Hacker: allow other weapons; the class weapon is managed as an auto-cast zone spawner
    const spec = WEAPON_SPECS[type];
    if (!spec) return;
    // Global safety: if this is a base weapon that evolves and we already own the evolved weapon, do not add the base again
    try {
      if (spec && spec.maxLevel > 1 && spec.evolution) {
        const evolvedOwned = (this.activeWeapons.get(spec.evolution.evolvedWeaponType) || 0) > 0;
        if (evolvedOwned) {
          return;
        }
      }
    } catch {}
    // If selecting an evolved weapon directly, and its base is owned, perform a swap
    try {
      // Find a base weapon that evolves into this 'type'
      let baseForEvolved: WeaponType | undefined;
  let requiredPassiveName: string | undefined;
  let minPassiveLevel: number = 1;
      for (const k in WEAPON_SPECS) {
        const ws = (WEAPON_SPECS as any)[k];
        if (ws && ws.evolution && ws.evolution.evolvedWeaponType === type) {
          baseForEvolved = Number(k) as WeaponType;
          requiredPassiveName = ws.evolution.requiredPassive;
          minPassiveLevel = 1; // All evolutions require only Lv.1 passive
          break;
        }
      }
      if (baseForEvolved !== undefined && this.activeWeapons.has(baseForEvolved)) {
        // Verify passive level (eligible)
        const req = requiredPassiveName ? this.activePassives.find(p => p.type === requiredPassiveName) : undefined;
        if (!requiredPassiveName || (req && req.level >= (minPassiveLevel || 1))) {
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
        // Normalize: all evolutions require only the specified passive at Lv.1
        this.tryEvolveWeapon(type, spec.evolution.evolvedWeaponType, spec.evolution.requiredPassive, 1);
      }
    }
    // Initialize cooldown if weapon is new
    if (!this.shootCooldowns.has(type)) {
      this.shootCooldowns.set(type, 0);
    }
  }

  private tryEvolveWeapon(baseWeaponType: WeaponType, evolvedWeaponType: WeaponType, requiredPassiveName: string, minPassiveLevel: number = 1): void {
    const baseWeaponSpec = WEAPON_SPECS[baseWeaponType];
    const evolvedWeaponSpec = WEAPON_SPECS[evolvedWeaponType];

    if (!baseWeaponSpec || !evolvedWeaponSpec) {
      Logger.error(`Evolution failed: Missing weapon spec for ${baseWeaponType} or ${evolvedWeaponType}`);
      return;
    }

    const passive = this.activePassives.find(p => p.type === requiredPassiveName);
    const requiredPassiveSpec = PASSIVE_SPECS.find(p => p.name === requiredPassiveName);

  // Evolution eligibility: base weapon at max level and required passive at level >= 1 (normalized)
  const needLevel = 1; // enforce Lv.1 globally regardless of config
  if (passive && passive.level >= needLevel) {
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

  /**
   * Test if a world position is inside the player's visible FoW area for aiming.
   * Returns true when FoW is disabled. Mirrors render-side radius and class/passive multipliers.
   */
  private isVisibleForAim(x: number, y: number): boolean {
    // Strict in Last Stand: any failure defaults to NOT visible
    try {
      const gi: any = (window as any).__gameInstance;
      const inLs = !!(gi && gi.gameMode === 'LAST_STAND');
      if (inLs) {
        // Prefer per-frame cache from Last Stand controller
        try {
          const cache: any = (window as any).__lsAimCache;
          if (cache && typeof cache.cx === 'number' && typeof cache.cy === 'number' && typeof cache.r2 === 'number') {
            const dxc = x - cache.cx, dyc = y - cache.cy;
            return (dxc*dxc + dyc*dyc) <= cache.r2; // circle-only
          }
        } catch { /* fall through to compute fallback */ }
        // Fallback compute from core only (circle); no corridor clearance for aim gating
        try {
          const core: any = (window as any).__lsCore;
          const cx = (core && core.x != null) ? core.x : (gi?.player?.x ?? this.x);
          const cy = (core && core.y != null) ? core.y : (gi?.player?.y ?? this.y);
          let radiusPx = 640;
          try { const tiles = typeof gi?.getEffectiveFowRadiusTiles === 'function' ? gi.getEffectiveFowRadiusTiles() : 4; const ts = (gi && typeof gi.fowTileSize === 'number') ? gi.fowTileSize : 160; radiusPx = Math.floor(tiles * ts * 0.95); } catch { /* keep fallback */ }
          const dx1 = x - cx, dy1 = y - cy; return (dx1*dx1 + dy1*dy1) <= (radiusPx * radiusPx);
        } catch { return false; }
      }
      // Non-LS: player-centered FoW (render-aligned). If context missing, default visible.
      const g: any = this.gameContext as any;
      if (!g || !g.fowEnabled || !g.fog) return true;
      const ts: number = (g.fowTileSize || 160);
      const baseTiles: number = Math.max(1, Math.floor(g.fowRadiusBase || 3));
      const aimPad = (g?.__fowAimPad || 1.15);
      const radiusPx = Math.max(220, Math.floor(baseTiles * ts * 0.95 * aimPad));
      const dx = (x - this.x); const dy = (y - this.y);
      return (dx * dx + dy * dy) <= (radiusPx * radiusPx);
    } catch {
      // If anything goes wrong, be strict in LS and permissive elsewhere
      try { return ((window as any).__gameInstance?.gameMode) !== 'LAST_STAND'; } catch { return false; }
    }
  }

  /**
   * Unified target acquisition for all weapons.
   * - mode 'closest' picks the nearest valid candidate (enemies, boss, treasures, chests).
   * - mode 'toughest' prefers highest-HP within range, then closest within range, then closest overall.
   * - avoidExplodingBeforeMs filters enemies marked by Spectral Executioner expiring within the window.
   */
  private findBestTarget(options?: {
    mode?: 'closest' | 'toughest';
    includeBoss?: boolean;
    includeTreasures?: boolean;
    includeChests?: boolean;
    avoidExplodingBeforeMs?: number;
  }): Enemy | null {
    const mode: 'closest' | 'toughest' = options?.mode || ((this.gameContext as any)?.aimMode) || ((window as any).__aimMode) || 'closest';
    const includeBoss = options?.includeBoss !== false;
    const includeTreasures = options?.includeTreasures !== false;
    const includeChests = options?.includeChests !== false;
    const avoidMs = Math.max(0, options?.avoidExplodingBeforeMs || 0);

  // Compute effective max weapon range (Infinity if any weapon lacks finite range)
  let maxRange = 0;
    try {
      if (this.activeWeapons && this.activeWeapons.size > 0) {
        for (const [w, _lvl] of this.activeWeapons) {
          const spec = (WEAPON_SPECS as any)[w];
          let r = (spec && typeof spec.range === 'number') ? spec.range : Infinity;
          if (this.characterData?.id === 'heavy_gunner' && w === WeaponType.GUNNER_MINIGUN) {
            const t = this.getGunnerBoostT();
            const rangeMul = 1 + (this.gunnerBoostRange - 1) * t;
            if (Number.isFinite(r)) r *= rangeMul;
          }
          if (!Number.isFinite(r)) { maxRange = Infinity; break; }
          if (r > maxRange) maxRange = r;
        }
      } else {
        maxRange = Infinity;
      }
    } catch { maxRange = Infinity; }
    // Last Stand: clamp max range to the edge of vision circle so aim cannot exceed visible area
    try {
      const gi: any = (window as any).__gameInstance;
      if (gi && gi.gameMode === 'LAST_STAND') {
        let rVis = 640;
        try { const tiles = typeof gi.getEffectiveFowRadiusTiles === 'function' ? gi.getEffectiveFowRadiusTiles() : 4; const ts = (typeof gi.fowTileSize === 'number') ? gi.fowTileSize : 160; rVis = Math.floor(tiles * ts * 0.95); } catch {}
        if (Number.isFinite(maxRange)) maxRange = Math.min(maxRange, rVis);
      }
    } catch { /* ignore */ }
    const maxRangeSq = Number.isFinite(maxRange) ? (maxRange * maxRange) : Infinity;

  const em: any = (this.gameContext as any)?.enemyManager;
  // FOW visibility gating: reuse unified helper that matches LS core/corridor model
  const isVisible = (x: number, y: number): boolean => this.isVisibleForAim(x, y);
    const enemies: Enemy[] = this.enemyProvider ? [...this.enemyProvider()] : [];
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Optional boss candidate (ACTIVE only)
    const boss = includeBoss ? ((this.gameContext as any)?.bossManager?.getActiveBoss?.() || null) : null;
    const bossValid = !!(boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE');

    // Helper: filter Spectral-marked enemies expiring soon when avoidMs > 0
    const enemyOk = (e: any): boolean => {
      if (!e || !e.active || e.hp <= 0) return false;
      if (avoidMs > 0 && this.activeWeapons && this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER)) {
        const until: number = e._specterMarkUntil || 0;
        if (until > 0 && (until - now) <= (avoidMs + 80)) return false;
      }
      return true;
    };

    // Early boss pick in toughest mode if within range (keeps old behavior)
  if (mode === 'toughest' && bossValid && isVisible(boss.x, boss.y)) {
      const dxB = (boss.x ?? 0) - (this.x ?? 0);
      const dyB = (boss.y ?? 0) - (this.y ?? 0);
      const d2B = dxB * dxB + dyB * dyB;
      if (d2B <= maxRangeSq) return boss as any;
    }

    // Build auxiliary lists when needed
    let treasures: Array<{ x:number; y:number; active:boolean; hp:number; maxHp?:number }> = [];
    let chests: Array<{ x:number; y:number; active:boolean }> = [];
    try {
      if (includeTreasures && em && typeof em.getTreasures === 'function') {
        try { if ((window as any).__gameInstance?.gameMode === 'LAST_STAND') { /* skip treasures */ } else { treasures = em.getTreasures() || []; } } catch { treasures = em.getTreasures() || []; }
      }
      if (includeChests && em && typeof em.getChests === 'function') chests = em.getChests() || [];
    } catch { /* ignore */ }

    if (mode === 'toughest') {
      // 1) Toughest within range
      let pick: Enemy | null = null;
      let bestHp = -1;
      for (let i = 0; i < enemies.length; i++) {
  const e = enemies[i]; if (!enemyOk(e)) continue; if (!isVisible(e.x, e.y)) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx*dx + dy*dy; if (d2 > maxRangeSq) continue;
        const hpMax = (e as any).maxHp ?? e.hp; if (hpMax > bestHp) { bestHp = hpMax; pick = e; }
      }
      if (includeTreasures) {
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || t.hp <= 0) continue; if (!isVisible(t.x, t.y)) continue;
          const dx = (t.x ?? 0) - (this.x ?? 0);
          const dy = (t.y ?? 0) - (this.y ?? 0);
          const d2 = dx*dx + dy*dy; if (d2 > maxRangeSq) continue;
          const hpMax = t.maxHp ?? t.hp; if (hpMax > bestHp) { bestHp = hpMax; pick = (t as unknown as Enemy); }
        }
      }
      if (includeChests) {
        for (let i = 0; i < chests.length; i++) {
          const c = chests[i]; if (!c || !c.active) continue; if (!isVisible(c.x, c.y)) continue;
          const dx = (c.x ?? 0) - (this.x ?? 0);
          const dy = (c.y ?? 0) - (this.y ?? 0);
          const d2 = dx*dx + dy*dy; if (d2 > maxRangeSq) continue;
          if (bestHp < 0) { pick = (c as unknown as Enemy); bestHp = 0; }
        }
      }
      if (pick) return pick;

      // 2) Closest within range
      let bestD2 = Number.POSITIVE_INFINITY; pick = null;
      for (let i = 0; i < enemies.length; i++) {
  const e = enemies[i]; if (!enemyOk(e)) continue; if (!isVisible(e.x, e.y)) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx*dx + dy*dy; if (d2 <= maxRangeSq && d2 < bestD2) { bestD2 = d2; pick = e; }
      }
      if (includeTreasures) {
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || t.hp <= 0) continue; if (!isVisible(t.x, t.y)) continue;
          const dx = (t.x ?? 0) - (this.x ?? 0);
          const dy = (t.y ?? 0) - (this.y ?? 0);
          const d2 = dx*dx + dy*dy; if (d2 <= maxRangeSq && d2 < bestD2) { bestD2 = d2; pick = (t as unknown as Enemy); }
        }
      }
      if (includeChests) {
        for (let i = 0; i < chests.length; i++) {
          const c = chests[i]; if (!c || !c.active) continue; if (!isVisible(c.x, c.y)) continue;
          const dx = (c.x ?? 0) - (this.x ?? 0);
          const dy = (c.y ?? 0) - (this.y ?? 0);
          const d2 = dx*dx + dy*dy; if (d2 <= maxRangeSq && d2 < bestD2) { bestD2 = d2; pick = (c as unknown as Enemy); }
        }
      }
      if (pick) return pick;

      // 3) Closest overall
      bestD2 = Number.POSITIVE_INFINITY; pick = null;
      for (let i = 0; i < enemies.length; i++) {
  const e = enemies[i]; if (!enemyOk(e)) continue; if (!isVisible(e.x, e.y)) continue;
        const dx = (e.x ?? 0) - (this.x ?? 0);
        const dy = (e.y ?? 0) - (this.y ?? 0);
        const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; pick = e; }
      }
      if (includeTreasures) {
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || t.hp <= 0) continue; if (!isVisible(t.x, t.y)) continue;
          const dx = (t.x ?? 0) - (this.x ?? 0);
          const dy = (t.y ?? 0) - (this.y ?? 0);
          const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; pick = (t as unknown as Enemy); }
        }
      }
      if (includeChests) {
        for (let i = 0; i < chests.length; i++) {
          const c = chests[i]; if (!c || !c.active) continue; if (!isVisible(c.x, c.y)) continue;
          const dx = (c.x ?? 0) - (this.x ?? 0);
          const dy = (c.y ?? 0) - (this.y ?? 0);
          const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; pick = (c as unknown as Enemy); }
        }
      }
      return pick;
    }

    // mode === 'closest'
    let bestD2 = Number.POSITIVE_INFINITY; let pick: Enemy | null = null;
  if (bossValid && isVisible(boss.x, boss.y)) {
      const dxB = (boss.x ?? 0) - (this.x ?? 0);
      const dyB = (boss.y ?? 0) - (this.y ?? 0);
      const d2B = dxB*dxB + dyB*dyB; bestD2 = d2B; pick = boss as any;
    }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]; if (!enemyOk(e)) continue; if (!isVisible(e.x, e.y)) continue;
      const dx = (e.x ?? 0) - (this.x ?? 0);
      const dy = (e.y ?? 0) - (this.y ?? 0);
      const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; pick = e; }
    }
    if (includeTreasures) {
      for (let i = 0; i < treasures.length; i++) {
        const t = treasures[i]; if (!t || !t.active || t.hp <= 0) continue; if (!isVisible(t.x, t.y)) continue;
        const dx = (t.x ?? 0) - (this.x ?? 0);
        const dy = (t.y ?? 0) - (this.y ?? 0);
        const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; pick = (t as unknown as Enemy); }
      }
    }
    if (includeChests) {
      for (let i = 0; i < chests.length; i++) {
        const c = chests[i]; if (!c || !c.active) continue; if (!isVisible(c.x, c.y)) continue;
        const dx = (c.x ?? 0) - (this.x ?? 0);
        const dy = (c.y ?? 0) - (this.y ?? 0);
        const d2 = dx*dx + dy*dy; if (d2 < bestD2) { bestD2 = d2; pick = (c as unknown as Enemy); }
      }
    }
    return pick;
  }

  // Backward-compat: delegate to unified selector with defaults
  private findNearestEnemy(): Enemy | null {
    return this.findBestTarget({ mode: 'closest' });
  }

  /**
   * Sniper targeting helper: prefer a target that won't explode (Spectral mark) before a shot after avoidMs.
   * Falls back to nearest alive enemy if none match. Only filters by Spectral mark timing (predictable).
   */
  private findSniperTargetAvoidingSoonExploding(avoidMs: number): Enemy | null {
    return this.findBestTarget({ mode: 'closest', avoidExplodingBeforeMs: avoidMs });
  }

  private shootAt(target: Enemy, weaponType: WeaponType) {
    // Absolute suppression: never allow any fire while Ghost ult is charging or basic fire is suppressed
    if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
    // Hard gate: never fire at targets hidden by Fog-of-War in Last Stand (final safety net)
    try {
      const gi: any = (window as any).__gameInstance;
      if (gi && gi.gameMode === 'LAST_STAND') {
        if (!this.isVisibleForAim(target.x, target.y)) return;
      }
    } catch { /* ignore and proceed for non-LS */ }
    // Rogue Hacker: suppress class weapon bullets (zones are auto-cast elsewhere)
    if (this.characterData?.id === 'rogue_hacker' && weaponType === WeaponType.HACKER_VIRUS) {
      return;
    }
    if (this.gameContext?.bulletManager) {
      const bm = this.gameContext.bulletManager;
      const spec = WEAPON_SPECS[weaponType as keyof typeof WEAPON_SPECS];
      if (spec) {
  // Compute base aim; some weapons override with predictive lead
  let dx = target.x - this.x;
  let dy = target.y - this.y;
  let baseAngle = Math.atan2(dy, dx);
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
        // Apply global class-vs-non-class adjustment in one step
        bulletDamage = this.applyNonClassWeaponBuff(spec, bulletDamage);
        // Heavy Gunner: apply damage/spread boost pre-fire
        const isGunner = this.characterData?.id === 'heavy_gunner';
        if (isGunner && weaponType === WeaponType.GUNNER_MINIGUN) {
          const t = this.getGunnerBoostT();
          // Use shaped power curve for damage scaling (stronger near max heat)
          const tPow = (this as any).getGunnerPowerT ? (this as any).getGunnerPowerT() : t;
          if (t > 0) {
            bulletDamage *= (1 + (this.gunnerBoostDamage - 1) * tPow);
            // Interpolate spread factor: 1 -> gunnerBoostSpread
            const spreadMul = 1 - (1 - this.gunnerBoostSpread) * t;
            spread *= spreadMul;
          }
        }

        // Predictive aiming for Data Sorcerer laser kit
        if (weaponType === WeaponType.GLYPH_COMPILER || weaponType === WeaponType.ORACLE_ARRAY) {
          try {
            const specAny: any = (WEAPON_SPECS as any)[weaponType];
            const lvl = this.activeWeapons.get(weaponType) ?? 1;
            const scaled = specAny?.getLevelStats ? specAny.getLevelStats(lvl) : {};
            const projSpeed = (scaled.speed != null ? scaled.speed : specAny?.speed) || 18;
            const lead = this.computeInterceptAngle(this.x, this.y, target, projSpeed);
            if (lead != null) baseAngle = lead;
          } catch { /* ignore and stick to direct aim */ }
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
                // Abort if ult is charging or basic fire is suppressed NOW
                if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
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
                // Abort if ult is charging or basic fire is suppressed NOW
                if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
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

        // Heavy Gunner evolution: Lava Laser Minigun — sustained micro-beam DPS, refreshed on cadence
        if (weaponType === WeaponType.GUNNER_LAVA_MINIGUN) {
          this.handleLavaMinigunFire(baseAngle, target, spec, weaponLevel);
          return; // handled by beam path
        }

  // Ghost Operative: heavyweight sniper — must be stationary; charge then instant hitscan beam with pierce
        if (weaponType === WeaponType.GHOST_SNIPER) {
          this.handleGhostSniperFire(baseAngle, target, spec, weaponLevel, WeaponType.GHOST_SNIPER);
          return; // handled by beam path
        }
        // Spectral Executioner (evolved Ghost Sniper): same charge/beam path with mark+execute behavior
        if (weaponType === WeaponType.SPECTRAL_EXECUTIONER) {
          this.handleGhostSniperFire(baseAngle, target, spec, weaponLevel, WeaponType.SPECTRAL_EXECUTIONER);
          return; // handled by beam path
        }
        // Shadow Operative: Void Sniper — same charge/aim, applies DoT only and purple beam visuals
        if (weaponType === WeaponType.VOID_SNIPER) {
          this.handleVoidSniperFire(baseAngle, target, spec, weaponLevel, WeaponType.VOID_SNIPER);
          return; // handled by beam path
        }
        // Black Sun: evolved Shadow sniper — multi-beam to 5 unique targets, no stacking
        if (weaponType === WeaponType.BLACK_SUN) {
          this.handleBlackSunSniperMultiFire(baseAngle, target, WEAPON_SPECS[WeaponType.BLACK_SUN], weaponLevel);
          return; // handled by beam path
        }
        // Rogue Hacker: weapon spawns paralysis/DoT zones only; no bullets
        if (weaponType === WeaponType.HACKER_VIRUS) {
          this.handleHackerZoneFire(baseAngle, target, spec, weaponLevel);
          return; // no projectile spawn
        }

  const baseCos = Math.cos(baseAngle);
  const baseSin = Math.sin(baseAngle);
  const perpX0 = -baseSin;
  const perpY0 =  baseCos;
  const hooks = {
    adjustOrigin: (player: any, params: any) => ({ originX: params.originX, originY: params.originY }),
    adjustAngle: (player: any, params: any) => params.finalAngle,
    preSpawnDamage: (player: any, params: any) => params.current,
    afterSpawnBullet: (player: any, params: any) => {}
  }; // Default hooks implementation
  // Apply global damage nerf/buffs for direct-spawn branches (staggered branches use spawnSingleProjectile which applies gdm internally)
  const gdmLocal = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  for (let i = 0; i < toShoot; i++) {
          const angle = baseAngle + (i - (toShoot - 1) / 2) * spread;
          // Compute origin and allow operative hooks to adjust first
          let originX = this.x;
          let originY = this.y;
          let usedHookOrigin = false;
          if (false) { // hooks disabled
            const adj = hooks.adjustOrigin(this as any, { weaponType, total: toShoot, index: i, baseAngle, baseCos, baseSin, perpX: perpX0, perpY: perpY0, originX, originY });
            if (adj) { originX = adj.originX; originY = adj.originY; usedHookOrigin = true; }
          }
          if (!usedHookOrigin && weaponType === WeaponType.DUAL_PISTOLS) {
            // Akimbo Deagle: two barrels left/right simultaneously (no zig-zag across bursts)
            const sideOffsetBase = 18;
            const perpX = perpX0;
            const perpY = perpY0;
            const centeredIndex = (i - (toShoot - 1) / 2);
            const sideSign = centeredIndex < 0 ? -1 : 1;
            originX += perpX * sideOffsetBase * sideSign;
            originY += perpY * sideOffsetBase * sideSign;
            originX += baseCos * 10;
            originY += baseSin * 10;
          } else if (!usedHookOrigin && (weaponType === WeaponType.RUNNER_GUN || weaponType === WeaponType.RUNNER_OVERDRIVE)) {
            // Runner Gun: spawn from left/right pistols
            const sideOffsetBase = 22; // wider separation so lanes are clearly distinct
            const perpX = perpX0;
            const perpY = perpY0;
            let sideSign = -1;
            if (toShoot <= 1) {
              // Alternate each trigger when firing single shots
              sideSign = this.runnerSide;
              this.runnerSide *= -1; // flip for next shot
            } else {
              // Multi-salvo (L6+): fire from both pistols simultaneously
              const centeredIndex = (i - (toShoot - 1) / 2);
              sideSign = centeredIndex < 0 ? -1 : 1;
            }
            originX += perpX * sideOffsetBase * sideSign;
            originY += perpY * sideOffsetBase * sideSign;
            // Nudge forward to read as muzzle, not shoulder
            originX += baseCos * 8;
            originY += baseSin * 8;
          } else if (!usedHookOrigin && (this.characterData?.id === 'titan_mech') && (weaponType === WeaponType.MECH_MORTAR || weaponType === WeaponType.SIEGE_HOWITZER)) {
            // Titan Mech class weapon: spawn from left/right cannon muzzles, alternating per shot
            const sideOffsetBase = 34; // distance from center to each cannon (increased)
            const forwardNudge = 16;   // push slightly forward so it reads as muzzle (increased)
            const perpX = perpX0;
            const perpY = perpY0;
            let sideSign = -1;
            if (toShoot <= 1) {
              // Alternate each trigger
              sideSign = this.mechMortarSide;
              this.mechMortarSide *= -1; // flip for next shot
            } else {
              // Hypothetical multi-salvo: split across barrels
              const centeredIndex = (i - (toShoot - 1) / 2);
              sideSign = centeredIndex < 0 ? -1 : 1;
            }
            originX += perpX * sideOffsetBase * sideSign;
            originY += perpY * sideOffsetBase * sideSign;
            originX += baseCos * forwardNudge;
            originY += baseSin * forwardNudge;
          }
          // Converging fire: if Runner Gun, recompute angle so each barrel aims exactly at target (covers middle)
          let finalAngle = angle;
          // Data Sorcerer: keep predictive base, but adjust per-barrel convergence/aim via hooks where available
          let usedHookAngle = false;
          if (false) { // hooks disabled
            const a = hooks.adjustAngle(this as any, { weaponType, finalAngle, target, originX, originY });
            if (typeof a === 'number') { finalAngle = a; usedHookAngle = true; }
          }
          if (!usedHookAngle) {
            if (weaponType === WeaponType.RUNNER_GUN || weaponType === WeaponType.RUNNER_OVERDRIVE || weaponType === WeaponType.DUAL_PISTOLS || ((weaponType === WeaponType.MECH_MORTAR || weaponType === WeaponType.SIEGE_HOWITZER) && this.characterData?.id === 'titan_mech')) {
              const tdx = target.x - originX; const tdy = target.y - originY;
              finalAngle = Math.atan2(tdy, tdx);
            }
            if (isGunner && weaponType === WeaponType.GUNNER_MINIGUN) {
              const t = this.getGunnerBoostT();
              const j = this.gunnerBoostJitter * t;
              finalAngle += (Math.random() * 2 - 1) * j;
            }
          }
          // Smart Rifle: inject artificial arc spread before homing correction so they visibly curve in
      if (weaponType === WeaponType.RAPID) {
            const arcSpread = 0.35; // radians total fan baseline
            const arcIndex = (i - (toShoot - 1) / 2);
            const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1,(toShoot-1)||1));
            {
        const dmg = Math.max(1, Math.round(bulletDamage * gdmLocal));
        const b = bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, dmg, weaponLevel);
              // Smart Rifle has no minigun-based range scaling; bullets are homing and short-range by design.
            }
          } else {
            // Tech Warrior: handle charged volley on the main fire path
            if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).techCharged) {
              const base = finalAngle;
              const hasSingularity = (this.activeWeapons.get(WeaponType.SINGULARITY_SPEAR) || 0) > 0;
              if (hasSingularity) {
                // Supercharged evolved volley: 5x Singularity spears, red and massive
                const sgSpec: any = (WEAPON_SPECS as any)[WeaponType.SINGULARITY_SPEAR];
                const sgLvl = Math.max(1, Math.min(7, (this.activeWeapons.get(WeaponType.SINGULARITY_SPEAR) ?? weaponLevel)));
                const scaled = sgSpec?.getLevelStats ? sgSpec.getLevelStats(sgLvl) : { damage: bulletDamage };
                let baseDmgLeveled = (scaled?.damage != null ? scaled.damage : bulletDamage);
                try { baseDmgLeveled = this.applyNonClassWeaponBuff(sgSpec, baseDmgLeveled); } catch {}
                const gdm = this.getGlobalDamageMultiplier?.() ?? (this.globalDamageMultiplier || 1);
                // Punchy but bounded: 1.6x per spear ×5 = ~8x burst
                const dmgBase = Math.round(baseDmgLeveled * 1.6 * gdm);
                const deg = Math.PI / 180;
                const angles = [base - 12*deg, base - 6*deg, base, base + 6*deg, base + 12*deg];
                for (let ai = 0; ai < angles.length; ai++) {
                  const a = angles[ai];
                  const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.SINGULARITY_SPEAR, dmgBase, sgLvl);
                  if (b) {
                    (b as any)._isVolley = true;
                    (b as any)._lifestealFrac = 0.01;
                    b.damage = dmgBase;
                    const boost = 1.35; b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
                    const vis: any = { ...(b.projectileVisual as any) };
                    vis.color = '#8B0000';
                    vis.glowColor = '#FF3344';
                    vis.glowRadius = Math.max(vis.glowRadius || 20, 26);
                    vis.trailColor = 'rgba(255,64,64,0.55)';
                    vis.trailLength = Math.max(vis.trailLength || 30, 40);
                    vis.thickness = Math.max(vis.thickness || 5, 8);
                    vis.length = Math.max(vis.length || 28, 40);
                    b.projectileVisual = vis;
                    b.radius = Math.max(b.radius || 6, 10);
                  }
                }
              } else {
                // Base volley: 3x Tachyon spears
                const spreadAng = 12 * Math.PI / 180;
                const lvl = weaponLevel;
                const tachSpec: any = (WEAPON_SPECS as any)[WeaponType.TACHYON_SPEAR];
                const scaled = tachSpec?.getLevelStats ? tachSpec.getLevelStats(lvl) : { damage: bulletDamage };
                let baseDmgLeveled = (scaled?.damage != null ? scaled.damage : bulletDamage);
                try { baseDmgLeveled = this.applyNonClassWeaponBuff(tachSpec, baseDmgLeveled); } catch {}
                const dmgBase = Math.round(baseDmgLeveled * 2.0 * (this.getGlobalDamageMultiplier?.() ?? (this.globalDamageMultiplier || 1)));
                const angles = [base - spreadAng, base, base + spreadAng];
                for (let ai=0; ai<angles.length; ai++) {
                  const a = angles[ai];
                  const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.TACHYON_SPEAR, dmgBase, lvl);
                  if (b) {
                    (b as any)._isVolley = true;
                    (b as any)._lifestealFrac = 0.01; // 1% lifesteal on charged volley
                    b.damage = dmgBase;
                    const boost = 1.35; b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
                    const vis: any = { ...(b.projectileVisual as any) };
                    vis.color = '#8B0000';
                    vis.glowColor = '#B22222';
                    vis.glowRadius = Math.max(vis.glowRadius || 18, 22);
                    vis.trailColor = 'rgba(139,0,0,0.50)';
                    vis.trailLength = Math.max(vis.trailLength || 26, 34);
                    vis.thickness = Math.max(vis.thickness || 4, 6);
                    vis.length = Math.max(vis.length || 26, 34);
                    b.projectileVisual = vis;
                    b.radius = Math.max(b.radius || 6, 8);
                  }
                }
              }
              (this as any).techCharged = false;
              window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 140, intensity: 3.2 } }));
            } else {
              // Oracle Array: evolved multi-lane predictive burst (mirror lanes around base)
              if (weaponType === WeaponType.ORACLE_ARRAY) {
                const specAny: any = (WEAPON_SPECS as any)[WeaponType.ORACLE_ARRAY];
                const lvl = weaponLevel;
                const scaled = specAny?.getLevelStats ? specAny.getLevelStats(lvl) : { lanes: 7, salvo: 1 };
                // Add 4 more projectiles: default to 7 lanes if spec not present
                const lanes = Math.max(1, Math.round((scaled as any).lanes || 7));
                // Slightly wider fan for evolved array
                const laneSpread = (8 * Math.PI) / 180; // 8 degrees per lane step
                const half = Math.floor(lanes / 2);
                // Keep total volley DPS stable by scaling per-lane damage relative to original 3-lane design
                const dScale = 3 / Math.max(1, lanes);
                const perLaneDamage = Math.max(1, Math.round(bulletDamage * gdmLocal * dScale));
                let fired = 0;
                for (let li = -half; li <= half; li++) {
                  if (lanes % 2 === 0 && li === 0) continue; // keep count to lanes
                  const a = finalAngle + li * laneSpread;
                  const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, weaponType, perLaneDamage, weaponLevel);
                  if (b) {
                    fired++;
                    // Make outer lanes visually wider (thicker beams) to sell the array feel
                    try {
                      const vis: any = (b as any).projectileVisual || {};
                      const baseThick = Math.max(2, vis.thickness || 2);
                      const abs = Math.abs(li);
                      // Step thickness: center thinnest, outer lanes thicker
                      const thick = abs >= 3 ? baseThick * 2.2 : abs >= 2 ? baseThick * 1.6 : baseThick;
                      vis.thickness = Math.round(thick);
                      // Slightly extend outer beam length for readability
                      if (vis.length != null) vis.length = Math.round(vis.length * (abs >= 2 ? 1.15 : 1.0));
                      (b as any).projectileVisual = vis;
                    } catch { /* ignore visual tweaks */ }
                  }
                }
                if (fired === 0) {
                  bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, perLaneDamage, weaponLevel);
                }
              } else {
              {
                let dmg = Math.max(1, Math.round(bulletDamage * gdmLocal));
                if (false) { // hooks disabled
                  const v = hooks.preSpawnDamage(this as any, { weaponType, current: dmg });
                  if (typeof v === 'number') dmg = v;
                }
                const b = bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, dmg, weaponLevel);
                // Living Sludge: make adjacent globs slower with shorter range to form a puddle arrow
                if (weaponType === WeaponType.LIVING_SLUDGE && b && toShoot > 1) {
                  const center = Math.floor(toShoot / 2);
                  const isSide = (i !== center);
                  if (isSide) {
                    const speedScale = 0.85;   // a bit slower side globs
                    const rangeMul = 0.80;     // shorter range for side globs
                    b.vx *= speedScale; b.vy *= speedScale;
                    if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rangeMul * rangeMul);
                    if (b.life != null) b.life = Math.round(b.life * rangeMul);
                  }
                }
                if (weaponType === WeaponType.RUNNER_OVERDRIVE && b) {
                  const pm = this.gameContext?.particleManager;
                  if (pm) pm.spawn(originX, originY, 1, 'rgba(178,34,34,0.85)', { sizeMin: 0.8, sizeMax: 1.8, life: 40, speedMin: 1.0, speedMax: 2.4 });
                }
                if (false) { // hooks disabled
                  hooks.afterSpawnBullet(this as any, { weaponType, bullet: b });
                } else if (isGunner && b && weaponType === WeaponType.GUNNER_MINIGUN) {
                  // Legacy fallback for minigun scaling if hook not present
                  const t = this.getGunnerBoostT();
                  const rMul = 1 + (this.gunnerBoostRange - 1) * t;
                  const tPow = (this as any).getGunnerPowerT ? (this as any).getGunnerPowerT() : t;
                  if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rMul*rMul);
                  if (b.life != null) b.life = Math.round(b.life * rMul);
                  const dmgMul = (1 + (this.gunnerBoostDamage - 1) * tPow);
                  b.damage = (b.damage ?? bulletDamage) * dmgMul;
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
    // Absolute suppression at execution time for staggered/queued spawns
    if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
    const angle = baseAngle + (index - (total - 1)) / 2 * spread;
    const baseCos = Math.cos(baseAngle);
    const baseSin = Math.sin(baseAngle);
    const perpX0 = -baseSin;
    const perpY0 =  baseCos;
    let originX = this.x;
    let originY = this.y;
    // Delegate origin adjustments to operative hooks when available
    {
      const hooks = {
        adjustOrigin: (player: any, params: any) => ({ originX: params.originX, originY: params.originY }),
        adjustAngle: (player: any, params: any) => params.finalAngle,
        preSpawnDamage: (player: any, params: any) => params.current,
        afterSpawnBullet: (player: any, params: any) => {}
      }; // Default hooks implementation
      if (false) { // hooks disabled
        const adj = hooks.adjustOrigin(this as any, { weaponType, total, index, baseAngle, baseCos, baseSin, perpX: perpX0, perpY: perpY0, originX, originY });
        if (adj) { originX = adj.originX; originY = adj.originY; }
      }
    }
    if (weaponType === WeaponType.DUAL_PISTOLS) {
      const sideOffset = 18;
      const perpX = perpX0;
      const perpY = perpY0;
      originX += perpX * sideOffset * this.akimboSide;
      originY += perpY * sideOffset * this.akimboSide;
      originX += baseCos * 10;
      originY += baseSin * 10;
      this.akimboSide *= -1;
    } else if (weaponType === WeaponType.RUNNER_GUN || weaponType === WeaponType.RUNNER_OVERDRIVE) {
      // Runner Gun: alternate left/right when single-shot; split by index for multi-salvo
      const sideOffset = 22; // widen spacing to separate streams visually
      const perpX = perpX0;
      const perpY = perpY0;
      let sideSign = -1;
      if (total <= 1) {
        sideSign = this.runnerSide;
        this.runnerSide *= -1;
      } else {
        const centeredIndex = (index - (total - 1) / 2);
        sideSign = centeredIndex < 0 ? -1 : 1;
      }
      originX += perpX * sideOffset * sideSign;
      originY += perpY * sideOffset * sideSign;
      originX += baseCos * 8;
      originY += baseSin * 8;
    }
    let finalAngle = angle;
    // Predictive adjust for DS lasers at the per-shot level (staggered or multi-barrel paths)
    if (weaponType === WeaponType.GLYPH_COMPILER || weaponType === WeaponType.ORACLE_ARRAY) {
      try {
        const specAny: any = (WEAPON_SPECS as any)[weaponType];
        const lvl = weaponLevel;
        const scaled = specAny?.getLevelStats ? specAny.getLevelStats(lvl) : {};
        const projSpeed = (scaled.speed != null ? scaled.speed : specAny?.speed) || 18;
        const tgt = target;
        const a = this.computeInterceptAngle(originX, originY, tgt, projSpeed);
        if (a != null) finalAngle = a;
      } catch { /* ignore */ }
    }
    // Let operative hooks adjust the fire angle (aim rules, jitters, motion-bias)
    {
      const hooks = {
        adjustOrigin: (player: any, params: any) => ({ originX: params.originX, originY: params.originY }),
        adjustAngle: (player: any, params: any) => params.finalAngle,
        preSpawnDamage: (player: any, params: any) => params.current,
        afterSpawnBullet: (player: any, params: any) => {}
      }; // Default hooks implementation
      if (false) { // hooks disabled
        const a = hooks.adjustAngle(this as any, { weaponType, finalAngle, target, originX, originY });
        if (typeof a === 'number') finalAngle = a;
      }
    }
    // Apply global damage multiplier (percent-based passive). Class/non-class adjustment is done at the call site.
    const gdm = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
    bulletDamage = Math.max(1, Math.round(bulletDamage * gdm));

    if (weaponType === WeaponType.RAPID) {
      const arcSpread = 0.35;
      const arcIndex = (index - (total - 1) / 2);
      const arcAngle = finalAngle + arcIndex * (arcSpread / Math.max(1, (total - 1) || 1));
      bm.spawnBullet(originX, originY, originX + Math.cos(arcAngle) * 100, originY + Math.sin(arcAngle) * 100, weaponType, bulletDamage, weaponLevel);
      return;
    }

    // Tech Warrior: if charged and firing a spear, emit 5x Singularity volley when evolved, else 3x Tachyon; then consume charge
    if ((weaponType === WeaponType.TACHYON_SPEAR || weaponType === WeaponType.SINGULARITY_SPEAR) && (this as any).techCharged) {
      const base = finalAngle;
      const hasSingularity = (this.activeWeapons.get(WeaponType.SINGULARITY_SPEAR) || 0) > 0;
      if (hasSingularity) {
        const sgSpec: any = (WEAPON_SPECS as any)[WeaponType.SINGULARITY_SPEAR];
        const sgLvl = Math.max(1, Math.min(7, (this.activeWeapons.get(WeaponType.SINGULARITY_SPEAR) ?? weaponLevel)));
        const scaled = sgSpec?.getLevelStats ? sgSpec.getLevelStats(sgLvl) : { damage: bulletDamage };
        const baseDmgLeveled = (scaled?.damage != null ? scaled.damage : bulletDamage);
        const gdm = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
        const dmgBase = Math.max(1, Math.round(baseDmgLeveled * 1.6 * gdm));
        const deg = Math.PI / 180;
        const angles = [base - 12*deg, base - 6*deg, base, base + 6*deg, base + 12*deg];
        for (let ai = 0; ai < angles.length; ai++) {
          const a = angles[ai];
          const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.SINGULARITY_SPEAR, dmgBase, sgLvl);
          if (b) {
            (b as any)._isVolley = true;
            (b as any)._lifestealFrac = 0.01;
            b.damage = dmgBase;
            const boost = 1.35; b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
            const vis: any = { ...(b.projectileVisual as any) };
            vis.color = '#8B0000'; vis.glowColor = '#FF3344';
            vis.glowRadius = Math.max(vis.glowRadius || 20, 26);
            vis.trailColor = 'rgba(255,64,64,0.55)';
            vis.trailLength = Math.max(vis.trailLength || 30, 40);
            vis.thickness = Math.max(vis.thickness || 5, 8);
            vis.length = Math.max(vis.length || 28, 40);
            b.projectileVisual = vis;
            b.radius = Math.max(b.radius || 6, 10);
          }
        }
      } else {
        const spreadAng = 12 * Math.PI / 180;
        const lvl = weaponLevel;
        const tachSpec: any = (WEAPON_SPECS as any)[WeaponType.TACHYON_SPEAR];
        const scaled = tachSpec?.getLevelStats ? tachSpec.getLevelStats(lvl) : { damage: bulletDamage };
        const baseDmgLeveled = (scaled?.damage != null ? scaled.damage : bulletDamage);
        const dmgBase = Math.max(1, Math.round(baseDmgLeveled * 2.0 * ((this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1))));
        const angles = [base - spreadAng, base, base + spreadAng];
        for (let ai = 0; ai < angles.length; ai++) {
          const a = angles[ai];
          const b = bm.spawnBullet(originX, originY, originX + Math.cos(a) * 100, originY + Math.sin(a) * 100, WeaponType.TACHYON_SPEAR, dmgBase, lvl);
          if (b) {
            (b as any)._isVolley = true; (b as any)._lifestealFrac = 0.01; b.damage = dmgBase;
            const boost = 1.35; b.vx *= boost; b.vy *= boost; (b as any).volleySpeedBoost = boost;
            const vis: any = { ...(b.projectileVisual as any) };
            vis.color = '#8B0000'; vis.glowColor = '#B22222';
            vis.glowRadius = Math.max(vis.glowRadius || 18, 22);
            vis.trailColor = 'rgba(139,0,0,0.50)'; vis.trailLength = Math.max(vis.trailLength || 26, 34);
            vis.thickness = Math.max(vis.thickness || 4, 6); vis.length = Math.max(vis.length || 26, 34);
            b.projectileVisual = vis; b.radius = Math.max(b.radius || 6, 8);
          }
        }
      }
      (this as any).techCharged = false;
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 140, intensity: 3.2 } }));
      return;
    }

    // Default single projectile spawn
    let spawnDamage = bulletDamage;
    // Allow operative-specific damage adjustments pre-spawn (Titan, etc.)
    {
      const hooks = {
        adjustOrigin: (player: any, params: any) => ({ originX: params.originX, originY: params.originY }),
        adjustAngle: (player: any, params: any) => params.finalAngle,
        preSpawnDamage: (player: any, params: any) => params.current,
        afterSpawnBullet: (player: any, params: any) => {}
      }; // Default hooks implementation
      if (false) { // hooks disabled
        const v = hooks.preSpawnDamage(this as any, { weaponType, current: spawnDamage });
        if (typeof v === 'number') spawnDamage = v;
      }
    }
    const b = bm.spawnBullet(originX, originY, originX + Math.cos(finalAngle) * 100, originY + Math.sin(finalAngle) * 100, weaponType, spawnDamage, weaponLevel);
    // Living Sludge: side globs travel a bit slower and shorter to create a puddle arrow pattern
    if (weaponType === WeaponType.LIVING_SLUDGE && b && total > 1) {
      const center = Math.floor(total / 2);
      const isSide = (index !== center);
      if (isSide) {
        const speedScale = 0.85;  // slightly slower
        const rangeMul = 0.80;    // shorter range
        b.vx *= speedScale; b.vy *= speedScale;
        if ((b as any).maxDistanceSq != null) (b as any).maxDistanceSq *= (rangeMul * rangeMul);
        if (b.life != null) b.life = Math.round(b.life * rangeMul);
      }
    }
    // Runner Overdrive: dash surge — within 2s after Runner dash, grant +crit and +projectile speed to evolved shots only
    if (weaponType === WeaponType.RUNNER_OVERDRIVE && b) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now < (this.runnerOverdriveSurgeUntil || 0)) {
        // Speed boost ~20%
        const speedBoost = 1.2;
        b.vx *= speedBoost; b.vy *= speedBoost;
        // Per-bullet crit bonus so only Overdrive shots benefit
        (b as any).critBonus = ((b as any).critBonus || 0) + 0.15; // +15% crit chance
        // Tiny visual kick (optional): extend trail slightly if present
        if (b.projectileVisual) {
          const vis: any = { ...(b.projectileVisual as any) };
          if (typeof vis.trailLength === 'number') vis.trailLength = Math.min(48, (vis.trailLength || 20) + 6);
          b.projectileVisual = vis;
        }
      }
    }
    // Post-spawn bullet adjustments via operative hooks
    {
      const hooks = {}; // No hooks needed
      // if (hooks && hooks.afterSpawnBullet && b) hooks.afterSpawnBullet(this as any, { weaponType, bullet: b }); // hooks disabled
    }
  }

  /**
   * Compute an intercept angle from shooter (sx,sy) toward a moving target using its last-frame velocity.
   * Returns null if a stable intercept cannot be computed.
   */
  private computeInterceptAngle(sx: number, sy: number, target: Enemy, projectileSpeed: number): number | null {
    try {
      const tx = (target as any).x ?? 0;
      const ty = (target as any).y ?? 0;
      const px = (target as any)._prevX;
      const py = (target as any)._prevY;
      const now = performance.now();
      const lastDt = (window as any).__lastFrameDtMs || 16.67;
      let vx = 0, vy = 0;
      if (typeof px === 'number' && typeof py === 'number' && lastDt > 0) {
        vx = (tx - px) / (lastDt / 1000);
        vy = (ty - py) / (lastDt / 1000);
      }
      const rx = tx - sx;
      const ry = ty - sy;
      const v2 = vx*vx + vy*vy;
      const r2 = rx*rx + ry*ry;
      const s = Math.max(0.001, projectileSpeed);
      // Solve t for |r + v t| = s t → (v·v - s^2) t^2 + 2 r·v t + r·r = 0
      const a = v2 - s*s;
      const b = 2*(rx*vx + ry*vy);
      const c = r2;
      let t: number;
      if (Math.abs(a) < 1e-6) {
        // Linear fallback
        if (Math.abs(b) < 1e-6) {
          // Target stationary relative; shoot directly
          return Math.atan2(ry, rx);
        }
        t = -c / b;
      } else {
        const disc = b*b - 4*a*c;
        if (disc < 0) return Math.atan2(ry, rx);
        const sqrt = Math.sqrt(disc);
        const t1 = (-b + sqrt) / (2*a);
        const t2 = (-b - sqrt) / (2*a);
        // pick the smallest positive time
        t = Number.POSITIVE_INFINITY;
        if (t1 > 0 && t1 < t) t = t1;
        if (t2 > 0 && t2 < t) t = t2;
        if (!isFinite(t) || t <= 0) return Math.atan2(ry, rx);
      }
      const aimX = tx + vx * t;
      const aimY = ty + vy * t;
      return Math.atan2(aimY - sy, aimX - sx);
    } catch {
      return null;
    }
  }

  /** Railgun charge + beam fire sequence */
  private handleRailgunFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    // Absolute suppression: do not start or continue while Ghost ult is charging
    if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
    // Use a state flag on player to prevent re-entry during charge
    if ((this as any)._railgunCharging) return;
    (this as any)._railgunCharging = true;
    // Start weapon cooldown now so the loop doesn't try to refire during charge
    {
      const FRAME_MS = 1000 / 60;
      const specStats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : undefined;
      let baseCdMs: number | undefined = (specStats && typeof (specStats as any).cooldownMs === 'number') ? (specStats as any).cooldownMs : (typeof (spec as any).cooldownMs === 'number' ? (spec as any).cooldownMs : undefined);
      let baseCdFrames: number | undefined = baseCdMs == null ? (specStats && typeof (specStats as any).cooldown === 'number' ? (specStats as any).cooldown : (spec?.cooldown ?? 60)) : undefined;
      const rateSource = (this.getFireRateModifier?.() ?? this.fireRateModifier);
      const rateMul = Math.max(0.1, (this.attackSpeed || 1) * ((rateSource != null ? rateSource : 1)));
      const effCd = typeof baseCdMs === 'number' ? (baseCdMs / rateMul) : ((baseCdFrames as number) / rateMul) * FRAME_MS;
      this.shootCooldowns.set(WeaponType.RAILGUN, effCd);
    }
  const chargeTimeMs = 2000; // charge for 2s for a heftier rail feel
  let startTime = performance.now();
  let chargedOnce = false;
    const originX = this.x;
    const originY = this.y - 10; // slight upward to eye line
  const ex = (this.gameContext as any)?.explosionManager;
  // Start a stronger ground glow for the entire charge duration for visibility
  try { ex?.triggerChargeGlow(originX, originY + 8, 34, '#00FFE6', chargeTimeMs); } catch {}

  const chargeStep = () => {
      const now = performance.now();
      // Abort mid-charge if ult begins charging
      if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) {
        (this as any)._railgunCharging = false;
        return;
      }
      const elapsed = now - startTime;
  // No mid-charge visuals; keep it minimal
      if (elapsed < chargeTimeMs) {
        requestAnimationFrame(chargeStep);
        return;
      }
  // Fire beam (single persistent beam hitbox for fixed duration)
  // Emit a stronger reverse shockwave as the charge completes
  try { ex?.triggerMortarImplosion(originX, originY + 6, 120, '#00FFE6', 0.38, 220); } catch {}
      (this as any)._railgunCharging = false;
      // If target is missing (edge cases/headless), use baseAngle
      const beamAngle = (target && isFinite(target.x) && isFinite(target.y))
        ? Math.atan2(target.y - originY, target.x - originX)
        : (isFinite(baseAngle) ? baseAngle : 0);
  const beamDurationMs = 160; // main impact window
      const beamStart = performance.now();
      // Prefer spec level stats for length/thickness when available
      const lvlStats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : undefined;
      const range = Math.max(100, (lvlStats?.length ?? spec.range ?? 900));
      const thickness = Math.max(6, (lvlStats?.thickness ?? (spec.beamVisual?.thickness ?? 12)));
  const gdmRG = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  // Triple base damage with a parity buff for non-class weapons, respecting global damage multiplier
  const baseDmgRG = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage);
  const buffedBaseRG = this.applyNonClassWeaponBuff(spec, baseDmgRG);
  const beamDamageTotal = (buffedBaseRG * 3.0) * gdmRG;
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
        thickness,
  dealDamage: (now:number) => {
          const enemies = game.enemyManager?.getEnemies() || [];
          const cosA = Math.cos(beamAngle);
          const sinA = Math.sin(beamAngle);
          const thickness = beamObj.thickness || 12; // collision core
          // Check for Blocker walls and shorten effective range to first hit
          try {
            const emAny: any = game.enemyManager;
            if (emAny && typeof emAny.firstBlockerHitDistance === 'function') {
              const hit = emAny.firstBlockerHitDistance(originX, originY, beamAngle, range, thickness);
              if (typeof hit === 'number' && hit >= 0 && hit < range) {
                // Temporarily reduce range for collision checks in this tick
                (beamObj as any)._effectiveRange = hit;
              } else {
                (beamObj as any)._effectiveRange = undefined;
              }
            }
          } catch { /* ignore blocker clamp */ }
          const effRange = (beamObj as any)._effectiveRange ?? range;
          for (const e of enemies) {
            if (!e.active || e.hp <= 0) continue;
            // Last Stand safety: skip invisible enemies outright
            try { if (!this.isVisibleForAim(e.x, e.y)) continue; } catch { /* ignore vis check errors */ }
            const relX = e.x - originX;
            const relY = e.y - originY;
            const proj = relX * cosA + relY * sinA; // distance along beam
            if (proj < 0 || proj > effRange) continue;
            const ortho = Math.abs(-sinA * relX + cosA * relY);
            if (ortho <= thickness + e.radius) {
              // Apply tick damage once per frame segment
              const deltaSec = (now - beamObj.lastTick)/1000;
              const dmg = dps * deltaSec;
              game.enemyManager.takeDamage(e, dmg, false, false, WeaponType.RAILGUN, this.x, this.y, weaponLevel, false, 'PLAYER');
            }
          }
          // Boss intersection damage
          try {
            const bossMgr: any = (window as any).__bossManager;
            const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
            if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0) {
              const relX = boss.x - originX;
              const relY = boss.y - originY;
              const proj = relX * cosA + relY * sinA;
              if (proj >= 0 && proj <= effRange) {
                const ortho = Math.abs(-sinA * relX + cosA * relY);
                if (ortho <= (thickness + (boss.radius || 160))) {
                  const deltaSec = (now - beamObj.lastTick)/1000;
                  const dmg = dps * deltaSec;
                  (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, dmg, false, WeaponType.RAILGUN, originX, originY, weaponLevel, false, 'PLAYER');
                }
              }
            }
          } catch {}
          // Also tick treasures intersecting the beam
          try {
            const emAny: any = game.enemyManager;
            if (emAny && typeof emAny.getTreasures === 'function') {
              const treasures = emAny.getTreasures() as Array<{ x:number;y:number;radius:number;active:boolean;hp:number }>;
              const deltaSec = (now - beamObj.lastTick)/1000;
              const dmgT = dps * deltaSec;
              for (let ti = 0; ti < treasures.length; ti++) {
                const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
                const relX = t.x - originX; const relY = t.y - originY;
                const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > range) continue;
                const ortho = Math.abs(-sinA * relX + cosA * relY);
                if (ortho <= (thickness + t.radius) && typeof emAny.damageTreasure === 'function') {
                  emAny.damageTreasure(t, dmgT);
                }
              }
            }
          } catch { /* ignore treasure beam errors */ }
          beamObj.lastTick = now;
        }
      };
      game._activeBeams.push(beamObj);
    // Screen shake & flash
  window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 180, intensity: 7 } }));
      // In headless tests there may be no Game.update loop ticking beams. If so, run a short RAF loop to tick this beam's damage until it expires.
      try {
        const gAny: any = game as any;
        const hasAutoTick = !!(gAny && gAny.__loopTicksBeams);
        if (!hasAutoTick) {
          // Use fixed-size synthetic steps driven by setTimeout, independent of performance.now.
          let elapsed = 0;
          const stepMs = 16; // ~60Hz
          const tickFn = () => {
            // If removed, stop ticking
            if (!game._activeBeams || game._activeBeams.indexOf(beamObj) === -1) return;
            // Advance synthetic timeline and apply damage
            const nextElapsed = Math.min(beamObj.duration, elapsed + stepMs);
            const syntheticNow = beamObj.start + nextElapsed;
            try { if (typeof beamObj.dealDamage === 'function') beamObj.dealDamage(syntheticNow); } catch {}
            elapsed = nextElapsed;
            if (elapsed >= beamObj.duration) return; // finished
            setTimeout(tickFn, stepMs);
          };
          setTimeout(tickFn, stepMs);
        }
      } catch { /* ignore headless tick wiring errors */ }
    }
    // Kick off the charge loop so the beam actually fires after charging
    requestAnimationFrame(chargeStep);
  }

  /** Ghost Sniper and Spectral Executioner: charge, then fire a piercing beam. */
  private handleGhostSniperFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number, weaponKind: WeaponType = WeaponType.GHOST_SNIPER) {
    // Absolute suppression
    if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
    if ((this as any)._sniperCharging) return;
    // Only allow starting charge if not moving
    const moveMag = Math.hypot(this.vx || 0, this.vy || 0);
    // While Phase Cloak is active, tolerate a tiny drift to better handle enemy charging pressure
    const moveThreshold = this.cloakActive ? 0.12 : 0.01;
    if (moveMag > moveThreshold) {
      (this as any)._sniperState = 'blocked';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      return;
    }
    (this as any)._sniperCharging = true;
    (this as any)._sniperState = 'charging';
    // Base 1.5s steady-aim; during Phase Cloak reduce the charge a bit to safely line up under pressure
    let chargeTimeMs = 1500;
    if (this.cloakActive) {
      // 25% faster while cloaked (min 900ms guard)
      chargeTimeMs = Math.max(900, Math.round(chargeTimeMs * 0.75));
    }
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
      if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) {
        (this as any)._sniperCharging = false;
        (this as any)._sniperState = 'idle';
        (this as any)._sniperChargeStart = undefined;
        (this as any)._sniperChargeMax = 0;
        return;
      }
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
  const mvThresh = this.cloakActive ? 0.12 : 0.01;
  if (mv > mvThresh) {
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
        this.shootCooldowns.set(weaponKind, effCd);
      }
      const game: any = this.gameContext;
      if (!game) return;
      // Spectral Executioner: 5-shot burst to 5 different targets
      if (weaponKind === WeaponType.SPECTRAL_EXECUTIONER) {
        const enemies: Enemy[] = game.enemyManager?.getEnemies() || [];
        const nowPick = performance.now();
  // Build candidate list filtered by soon-to-explode mark (allow anti-repeat targets; NR blocks re-marking, not damage)
        const candidates: Enemy[] = [];
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (!e || !e.active || e.hp <= 0) continue;
          if (!this.isVisibleForAim(e.x, e.y)) continue;
          const anyE: any = e as any;
          const until: number = anyE._specterMarkUntil || 0;
          if (until > 0 && (until - nowPick) <= 100) continue; // about to explode
          // In range check against sniper range
          const dx = e.x - originX; const dy = e.y - originY;
          const d2 = dx*dx + dy*dy; if (d2 > (spec.range || 1200) * (spec.range || 1200)) continue;
          candidates.push(e);
        }
        // Sort by distance and pick up to 5 distinct
        candidates.sort((a,b) => {
          const da = (a.x - originX)*(a.x - originX) + (a.y - originY)*(a.y - originY);
          const db = (b.x - originX)*(b.x - originX) + (b.y - originY)*(b.y - originY);
          return da - db;
        });
        const picks: Enemy[] = [];
        for (let i = 0; i < candidates.length && picks.length < 5; i++) picks.push(candidates[i]);
        // Consider boss inclusion always: if already 5 picks, replace the farthest one
        let boss: any = null; let bossIncluded = false;
        try {
          const bm: any = (window as any).__bossManager; boss = bm && (bm.getActiveBoss || bm.getBoss) ? (bm.getActiveBoss ? bm.getActiveBoss() : bm.getBoss()) : null;
        } catch {}
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const bAny: any = boss; const untilB = bAny._specterMarkUntil || 0;
          const nowB = performance.now();
          const dxB = (boss.x ?? originX) - originX; const dyB = (boss.y ?? originY) - originY;
          const inRange = (dxB*dxB + dyB*dyB) <= (spec.range || 1200) * (spec.range || 1200);
          const eligible = !(untilB > 0 && (untilB - nowB) <= 100) && inRange;
          if (eligible) {
            if (picks.length < 5) {
              bossIncluded = true; // add boss as an extra shot
            } else if (picks.length >= 5) {
              // Replace farthest pick to guarantee boss inclusion
              // picks are sorted nearest->farthest, so pop last
              picks.pop();
              bossIncluded = true;
            }
          }
        }
        if (picks.length === 0 && !bossIncluded) return; // nothing valid
        // Damage budget per shot: split single-shot power across the burst
        const baseDamage = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) || 100;
        const gdmSN = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
        const heavyMult = 1.6;
  const perShot = (baseDamage * heavyMult * gdmSN) / Math.max(1, (picks.length + (bossIncluded ? 1 : 0)));
        // Visuals container
        if (!game._activeBeams) game._activeBeams = [];
        // Fire at picked enemies
        for (let i = 0; i < picks.length; i++) {
          const e = picks[i];
          const ang = Math.atan2(e.y - originY, e.x - originX);
          const dist = Math.hypot(e.x - originY, e.y - originY);
          // Distance sweet-spot bonus (non-crit): apply as flat multiplier
          const distBonus = computeGhostRangeBonus(dist);
          // True crit roll from player stats/passives
          const pAny: any = this as any;
          const agi = this.agility || 0;
          const luck = this.luck || 0;
          const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
          const playerBonusPct = (typeof pAny.critBonus === 'number' && isFinite(pAny.critBonus) ? pAny.critBonus : 0) * 100;
          const totalPct = Math.max(0, Math.min(100, basePct + playerBonusPct));
          const critChance = totalPct / 100;
          const isCritical = Math.random() < critChance;
          const critMult = (typeof pAny.critMultiplier === 'number' && isFinite(pAny.critMultiplier)) ? pAny.critMultiplier : 2.0;
          const dmgOut = (perShot * distBonus) * (isCritical ? critMult : 1);
          game.enemyManager.takeDamage(e, dmgOut, isCritical, false, WeaponType.SPECTRAL_EXECUTIONER, originX, originY, weaponLevel, false, 'PLAYER');
          if (game && game.dpsHistory) game.dpsHistory.push({ time: performance.now(), damage: dmgOut });
          // Mark if survived and not in anti-repeat window
          try {
            const anyE: any = e as any; if (anyE.active && anyE.hp > 0) {
              const specExec: any = (WEAPON_SPECS as any)[WeaponType.SPECTRAL_EXECUTIONER];
              const stats = specExec?.getLevelStats ? specExec.getLevelStats(1) : { markMs: 1200 };
              const nowMs = performance.now();
              const nr = anyE._specterNoRepeatUntil || 0;
              if (!(nr > nowMs)) {
                anyE._specterMarkUntil = nowMs + (stats.markMs || 1200);
                anyE._specterMarkFrom = { x: originX, y: originY, time: nowMs };
                anyE._specterOwner = (this as any)._instanceId || 1;
              }
            }
          } catch {}
          // Beam visual
          game._activeBeams.push({ type: 'sniper_exec', x: originX, y: originY, angle: ang, range: dist, start: performance.now(), duration: 1000, lastTick: performance.now(), weaponLevel, thickness: 10 });
        }
        // Optionally include boss as one of the shots
  if (bossIncluded && boss) {
          const bx = boss.x ?? originX; const by = boss.y ?? originY;
          const ang = Math.atan2(by - originY, bx - originX);
          const dist = Math.hypot(bx - originX, by - originY);
          const distBonus = computeGhostRangeBonus(dist);
          const pAny: any = this as any;
          const agi = this.agility || 0; const luck = this.luck || 0;
          const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
          const playerBonusPct = (typeof pAny.critBonus === 'number' && isFinite(pAny.critBonus) ? pAny.critBonus : 0) * 100;
          const totalPct = Math.max(0, Math.min(100, basePct + playerBonusPct));
          const critChance = totalPct / 100;
          const isCritical = Math.random() < critChance;
          const critMult = (typeof pAny.critMultiplier === 'number' && isFinite(pAny.critMultiplier)) ? pAny.critMultiplier : 2.0;
          const dmgOut = (perShot * distBonus) * (isCritical ? critMult : 1);
          (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, dmgOut, isCritical, WeaponType.SPECTRAL_EXECUTIONER, originX, originY, weaponLevel, false, 'PLAYER');
          // Mark boss if survived and not in anti-repeat
          try {
            const bAny: any = boss; if (bAny.active && bAny.hp > 0) {
              const specExec: any = (WEAPON_SPECS as any)[WeaponType.SPECTRAL_EXECUTIONER];
              const stats = specExec?.getLevelStats ? specExec.getLevelStats(1) : { markMs: 1200 };
              const nowMs = performance.now();
              const nr = bAny._specterNoRepeatUntil || 0;
              if (!(nr > nowMs) && !((bAny._specterMarkUntil || 0) > nowMs)) {
                bAny._specterMarkUntil = nowMs + (stats.markMs || 1200);
                bAny._specterMarkFrom = { x: originX, y: originY, time: nowMs };
                bAny._specterOwner = (this as any)._instanceId || 1;
              }
            }
          } catch {}
          game._activeBeams.push({ type: 'sniper_exec', x: originX, y: originY, angle: ang, range: dist, start: performance.now(), duration: 1000, lastTick: performance.now(), weaponLevel, thickness: 10 });
        }
        // Recoil: nudge player slightly based on the first pick if any
        const lead = picks[0] || null; if (lead) { const ang = Math.atan2(lead.y - originY, lead.x - originX); this.x -= Math.cos(ang) * 6; this.y -= Math.sin(ang) * 6; }
        // Impact feel once
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
        return;
      }
      // Ghost Sniper or other variants: single piercing beam path
      // Retarget at fire moment: skip targets about to explode from Spectral mark (Ghost uses Spectral when evolved not present)
      let fireTarget: any = target;
      try {
        if (!fireTarget || !fireTarget.active || fireTarget.hp <= 0) {
          fireTarget = this.findSniperTargetAvoidingSoonExploding(0) || this.findNearestEnemy();
        }
      } catch { /* ignore */ }
      if (!fireTarget || !fireTarget.active || fireTarget.hp <= 0) return;
      const beamAngle = Math.atan2(fireTarget.y - originY, fireTarget.x - originX);
      const range = spec.range || 1200;
  let baseDamage = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) || 100;
  try { baseDamage = this.applyNonClassWeaponBuff(spec, baseDamage); } catch {}
  const gdmSN = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
      const heavyMult = 1.6; // toned down for DPS balance
  let remaining = baseDamage * heavyMult * gdmSN;
  const falloff = 1.0; // No falloff: full damage to every pierced target
      const thickness = 6;  // tight precision line
      // Spectral Executioner is an evolved sniper exception: it goes through everything; no blocker clamp
      let effRange = range;
      if (!this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER)) {
        try {
          const emAny: any = game.enemyManager;
          if (emAny && typeof emAny.firstBlockerHitDistance === 'function') {
            const hit = emAny.firstBlockerHitDistance(originX, originY, beamAngle, range, thickness);
            if (typeof hit === 'number' && hit >= 0 && hit < range) effRange = hit;
          }
        } catch { /* ignore blocker clamp */ }
      }

  // Damage enemies along the line instantly
      const enemies = game.enemyManager?.getEnemies() || [];
      const cosA = Math.cos(beamAngle);
      const sinA = Math.sin(beamAngle);
      // Sort by distance along beam to apply falloff in order
      const candidates: Array<{e: Enemy, proj: number, ortho: number}> = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
    if (!this.isVisibleForAim(e.x, e.y)) continue; // FoW: skip invisible
        const relX = e.x - originX;
        const relY = e.y - originY;
        const proj = relX * cosA + relY * sinA;
  if (proj < 0 || proj > effRange) continue;
        const ortho = Math.abs(-sinA * relX + cosA * relY);
        if (ortho <= thickness + e.radius) {
          candidates.push({ e, proj, ortho });
        }
      }
      candidates.sort((a,b) => a.proj - b.proj);
  // Track the first-hit enemy to apply Specter Mark for evolved variant
  let firstHitEnemy: any = null;
  let anyVisibleEffect = false;
  for (let i = 0; i < candidates.length && remaining > 0.5; i++) {
        const e = candidates[i].e;
    // Long-range sweet spot bonus (non-crit): extra sting if shot traveled far (> 600px)
  const distBonus = computeGhostRangeBonus(candidates[i].proj); // reduced long-shot bonus
    // True crit roll based on player stats/passives
    const pAny: any = this as any;
    const agi = this.agility || 0; const luck = this.luck || 0;
    const basePct = Math.min(60, (agi * 0.8 + luck * 1.2) * 0.5);
    const playerBonusPct = (typeof pAny.critBonus === 'number' && isFinite(pAny.critBonus) ? pAny.critBonus : 0) * 100;
    const totalPct = Math.max(0, Math.min(100, basePct + playerBonusPct));
    const critChance = totalPct / 100;
    const isCritical = Math.random() < critChance;
    const critMult = (typeof pAny.critMultiplier === 'number' && isFinite(pAny.critMultiplier)) ? pAny.critMultiplier : 2.0;
    const dmg = (remaining * distBonus) * (isCritical ? critMult : 1);
  const wType = (this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER) ? WeaponType.SPECTRAL_EXECUTIONER : WeaponType.GHOST_SNIPER);
  game.enemyManager.takeDamage(e, dmg, isCritical, false, wType, originX, originY, weaponLevel, false, 'PLAYER');
        // bleed a bit of damage into damage history for HUD DPS
        if (game && game.dpsHistory) game.dpsHistory.push({ time: performance.now(), damage: dmg });
        remaining *= falloff;
        if (!firstHitEnemy) firstHitEnemy = e;
    anyVisibleEffect = true;
      }

      // Spectral Executioner: apply Specter Mark to first hit target, only if it survived the initial shot
      if (firstHitEnemy && this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER)) {
        const anyE: any = firstHitEnemy as any;
        if (anyE && anyE.active && (anyE.hp > 0)) {
          try {
            const specExec: any = (WEAPON_SPECS as any)[WeaponType.SPECTRAL_EXECUTIONER];
            const stats = specExec?.getLevelStats ? specExec.getLevelStats(1) : { markMs: 1200, execMult: 2.2, chainCount: 2, chainMult: 0.6 };
            const nowMs = performance.now();
            anyE._specterMarkUntil = nowMs + (stats.markMs || 1200);
            anyE._specterMarkFrom = { x: originX, y: originY, time: nowMs };
            anyE._specterOwner = (this as any)._instanceId || 1;
          } catch { /* ignore */ }
        }
      }

      // Also damage treasures intersecting the beam
  try {
        const emAny: any = game.enemyManager;
        if (emAny && typeof emAny.getTreasures === 'function') {
          const treasures = emAny.getTreasures() as Array<{ x:number;y:number;radius:number;active:boolean;hp:number }>;
          const dmgTreasure = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).damage : spec.damage) || 100;
          const dmgVal = dmgTreasure * heavyMult * gdmSN;
          for (let ti = 0; ti < treasures.length; ti++) {
            const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
    if (!this.isVisibleForAim(t.x, t.y)) continue; // FoW gate
            const relX = t.x - originX; const relY = t.y - originY;
            const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > effRange) continue;
            const ortho = Math.abs(-sinA * relX + cosA * relY);
            if (ortho <= (thickness + t.radius) && typeof emAny.damageTreasure === 'function') {
              emAny.damageTreasure(t, dmgVal);
      anyVisibleEffect = true;
            }
          }
        }
      } catch { /* ignore treasure beam errors */ }

      // Optional: boss intersection
      try {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0 && this.isVisibleForAim(boss.x, boss.y)) {
          const relX = boss.x - originX;
          const relY = boss.y - originY;
          const proj = relX * cosA + relY * sinA;
          const ortho = Math.abs(-sinA * relX + cosA * relY);
          if (proj >= 0 && proj <= effRange && ortho <= (thickness + (boss.radius||160))) {
            const bossDmg = (baseDamage * heavyMult * gdmSN) * 0.7; // include global damage passive
            const wType = (this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER) ? WeaponType.SPECTRAL_EXECUTIONER : WeaponType.GHOST_SNIPER);
            (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, bossDmg, (proj > 600), wType, originX, originY, weaponLevel, false, 'PLAYER');
            anyVisibleEffect = true;
            // Spectral Executioner: always mark the boss on intersection (respect anti-repeat and existing mark)
            try {
              if (this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER)) {
                const specExec: any = (WEAPON_SPECS as any)[WeaponType.SPECTRAL_EXECUTIONER];
                const stats = specExec?.getLevelStats ? specExec.getLevelStats(1) : { markMs: 1200 };
                const nowMs = performance.now();
                const bAny: any = boss as any;
                if (bAny && bAny.active && (bAny.hp > 0)) {
                  const nr = bAny._specterNoRepeatUntil || 0;
                  // If not in anti-repeat and not already marked, apply mark
                  if (!(nr > nowMs) && !((bAny._specterMarkUntil || 0) > nowMs)) {
                    bAny._specterMarkUntil = nowMs + (stats.markMs || 1200);
                    bAny._specterMarkFrom = { x: originX, y: originY, time: nowMs };
                    bAny._specterOwner = (this as any)._instanceId || 1;
                  }
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch {}

      // Recoil and visuals only if something visible was actually affected
      if (anyVisibleEffect) {
        this.x -= Math.cos(beamAngle) * 8;
        this.y -= Math.sin(beamAngle) * 8;

        // Visual: short-lived sniper beam
        if (!game._activeBeams) game._activeBeams = [];
        const beamObj = {
  type: (this.activeWeapons.has(WeaponType.SPECTRAL_EXECUTIONER) ? 'sniper_exec' : 'sniper'),
          x: originX,
          y: originY,
          angle: beamAngle,
          range: effRange,
          start: performance.now(),
          duration: 1500, // 1.5s fade-out
          lastTick: performance.now(),
          weaponLevel,
          thickness: 10
        };
        game._activeBeams.push(beamObj);
        // Impact feel
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
      }
    };
    requestAnimationFrame(chargeStep);
  }

  /** Void Sniper: identical to Ghost Sniper but applies DoT; when evolved to Black Sun, spawns seeds that slow, tick, then collapse. */
  private handleVoidSniperFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number, weaponKind: WeaponType = WeaponType.VOID_SNIPER) {
    if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
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
      if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) {
        (this as any)._sniperCharging = false;
        (this as any)._sniperState = 'idle';
        (this as any)._sniperChargeStart = undefined;
        (this as any)._sniperChargeMax = 0;
        return;
      }
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
        // Map cooldown to the active weapon kind (Void Sniper or Black Sun)
        this.shootCooldowns.set(weaponKind, effCd);
      }
      const game: any = this.gameContext; if (!game) return;
  const beamAngle = Math.atan2(target.y - originY, target.x - originX);
  const range = spec.range || 1200;
  const ghostSpec = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
  let baseDamageGhost = (ghostSpec.getLevelStats ? ghostSpec.getLevelStats(weaponLevel).damage : ghostSpec.damage) || 95;
  try { baseDamageGhost = this.applyNonClassWeaponBuff(ghostSpec, baseDamageGhost); } catch {}
  const gdmVS = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  const perTick = 0.40 * baseDamageGhost * gdmVS;
  const ticks = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).ticks : 3) || 3;
  const tickIntervalMs = (spec.getLevelStats ? spec.getLevelStats(weaponLevel).tickIntervalMs : 1000) || 1000;
      const thickness = 6;
  // Clamp range to first Blocker wall hit if present — EXCEPT for Black Sun (goes through everything)
  let effRange = range;
  if (weaponKind !== WeaponType.BLACK_SUN) {
    try {
      const emAny: any = game.enemyManager;
      if (emAny && typeof emAny.firstBlockerHitDistance === 'function') {
        const hit = emAny.firstBlockerHitDistance(originX, originY, beamAngle, range, thickness);
        if (typeof hit === 'number' && hit >= 0 && hit < range) effRange = hit;
      }
    } catch { /* ignore */ }
  }
  const enemies = game.enemyManager?.getEnemies() || [];
      const cosA = Math.cos(beamAngle);
      const sinA = Math.sin(beamAngle);
      const candidates: Array<{e: Enemy, proj: number}> = [];
      // Build only visible candidates so LS FoW can never be bypassed by range
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.active || e.hp <= 0) continue;
        if (!this.isVisibleForAim(e.x, e.y)) continue;
        const relX = e.x - originX; const relY = e.y - originY;
  const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > effRange) continue;
        const ortho = Math.abs(-sinA * relX + cosA * relY);
        if (ortho <= thickness + e.radius) candidates.push({ e, proj });
      }
      candidates.sort((a,b)=> a.proj - b.proj);
      // If evolved to Black Sun, we spawn seeds at first impact points instead of applying traditional DoT.
  const evolvedToBlackSun = (weaponKind === WeaponType.BLACK_SUN) || this.activeWeapons.has(WeaponType.BLACK_SUN);
  // Schedule DoT (non-evolved) or spawn Black Sun seeds (evolved) on each hit enemy
      const nowBase = performance.now();
      let anyVisibleEffect = false;
  for (let i = 0; i < candidates.length; i++) {
        const e = candidates[i].e as any;
        if (evolvedToBlackSun) {
          try {
            const bsSpec: any = WEAPON_SPECS[WeaponType.BLACK_SUN];
            const params = bsSpec?.getLevelStats ? bsSpec.getLevelStats(weaponLevel) : bsSpec;
            const seedTicks = params?.seedTicks ?? 4;
            const tickFrac = params?.seedTickFrac ?? 0.12;
            const seedTickDmg = Math.max(1, Math.round(baseDamageGhost * tickFrac * gdmVS));
            const fuseMs = params?.fuseMs ?? 1200;
            const pullRadius = params?.pullRadius ?? 200;
            const pullStrength = params?.pullStrength ?? 220;
            const collapseRadius = params?.collapseRadius ?? 220;
            const collapseDmg = Math.max(1, Math.round((params?.collapseMult ?? 1.8) * baseDamageGhost * gdmVS));
            const gm: any = this.gameContext?.enemyManager;
            if (gm && typeof gm.spawnBlackSunSeed === 'function') {
              gm.spawnBlackSunSeed(e.x, e.y, { fuseMs, pullRadius, pullStrength, collapseRadius, slowPct: (params?.seedSlowPct ?? 0.25), tickIntervalMs: (params?.seedTickIntervalMs ?? 300), ticks: seedTicks, tickDmg: seedTickDmg, collapseDmg });
              anyVisibleEffect = true;
            }
          } catch { /* ignore spawn errors */ }
    } else {
          // Attach a simple voidDoT structure to enemy; merge stacks by resetting timer and max ticks
          const dot = e._voidSniperDot as { next:number; left:number; dmg:number; stacks?: number } | undefined;
          if (!dot) {
            e._voidSniperDot = { next: nowBase + tickIntervalMs, left: ticks, dmg: perTick, stacks: 1 } as any;
      // Immediate impact damage on hit (single instance) in addition to DoT
      try { (this.gameContext as any)?.enemyManager?.takeDamage?.(e, Math.max(1, Math.round(baseDamageGhost * 0.6 * gdmVS)), false, false, WeaponType.VOID_SNIPER, originX, originY, weaponLevel, false, 'PLAYER'); } catch {}
      if (e._voidSniperDot.left > 0) e._voidSniperDot.left--; // consume the first-tick slot
          } else {
            dot.left = Math.max(dot.left, ticks);
            dot.dmg = (dot.dmg || 0) + perTick;
            dot.next = nowBase + tickIntervalMs;
            dot.stacks = (dot.stacks || 1) + 1;
      // Apply a reduced immediate hit when stacking to reward focus, but smaller to prevent burst spikes
      try { (this.gameContext as any)?.enemyManager?.takeDamage?.(e, Math.max(1, Math.round(baseDamageGhost * 0.25 * gdmVS)), false, false, WeaponType.VOID_SNIPER, originX, originY, weaponLevel, false, 'PLAYER'); } catch {}
      if (dot.left > 0) dot.left--; // consume the first-tick slot
          }
          // Brief paralysis on impact (0.5s)
          e._paralyzedUntil = Math.max(e._paralyzedUntil || 0, nowBase + 500);
          e._lastHitByWeapon = WeaponType.VOID_SNIPER as any;
          anyVisibleEffect = true;
        }
      }
      // If evolved and no enemy was intersected, plant a seed at max beam range so ability is visible
      if (evolvedToBlackSun && candidates.length === 0) {
        try {
          const bsSpec: any = WEAPON_SPECS[WeaponType.BLACK_SUN];
          const params = bsSpec?.getLevelStats ? bsSpec.getLevelStats(weaponLevel) : bsSpec;
          const seedTicks = params?.seedTicks ?? 4;
          const tickFrac = params?.seedTickFrac ?? 0.12;
          const seedTickDmg = Math.max(1, Math.round(baseDamageGhost * tickFrac * gdmVS));
          const fuseMs = params?.fuseMs ?? 1200;
          const pullRadius = params?.pullRadius ?? 200;
          const pullStrength = params?.pullStrength ?? 220;
          const collapseRadius = params?.collapseRadius ?? 220;
          const collapseDmg = Math.max(1, Math.round((params?.collapseMult ?? 1.8) * baseDamageGhost * gdmVS));
          const sx = originX + Math.cos(beamAngle) * range;
          const sy = originY + Math.sin(beamAngle) * range;
          // Do not plant miss-seeds in fog
          if (!this.isVisibleForAim(sx, sy)) {
            // skip spawning if endpoint is not visible
          } else {
          const gm: any = this.gameContext?.enemyManager;
          if (gm && typeof gm.spawnBlackSunSeed === 'function') {
            gm.spawnBlackSunSeed(sx, sy, { fuseMs, pullRadius, pullStrength, collapseRadius, slowPct: (params?.seedSlowPct ?? 0.25), tickIntervalMs: (params?.seedTickIntervalMs ?? 300), ticks: seedTicks, tickDmg: seedTickDmg, collapseDmg });
            anyVisibleEffect = true;
          }
          }
        } catch { /* ignore miss-seed errors */ }
      }

      // Also hit treasures that intersect the beam with immediate per-tick damage (no stacking)
      try {
        const emAny: any = game.enemyManager;
        if (emAny && typeof emAny.getTreasures === 'function') {
          const treasures = emAny.getTreasures() as Array<{ x:number;y:number;radius:number;active:boolean;hp:number }>;
          for (let ti = 0; ti < treasures.length; ti++) {
            const t = treasures[ti]; if (!t || !t.active || (t as any).hp <= 0) continue;
            if (!this.isVisibleForAim(t.x, t.y)) continue;
            const relX = t.x - originX; const relY = t.y - originY;
            const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > effRange) continue;
            const ortho = Math.abs(-sinA * relX + cosA * relY);
            if (ortho <= (thickness + t.radius) && typeof emAny.damageTreasure === 'function') {
              emAny.damageTreasure(t, Math.max(1, Math.round(perTick)));
              anyVisibleEffect = true;
            }
          }
        }
      } catch { /* ignore treasure beam errors */ }

  // Boss intersection: apply DoT (non-evolved) or seed spawn (evolved) to boss if the beam crosses it
      try {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0 && this.isVisibleForAim(boss.x, boss.y)) {
          const relX = boss.x - originX; const relY = boss.y - originY;
          const proj = relX * cosA + relY * sinA;
          const ortho = Math.abs(-sinA * relX + cosA * relY);
  if (proj >= 0 && proj <= effRange && ortho <= (thickness + (boss.radius || 160))) {
            const bAny: any = boss as any;
            if (evolvedToBlackSun) {
              try {
                const bsSpec: any = WEAPON_SPECS[WeaponType.BLACK_SUN];
                const params = bsSpec?.getLevelStats ? bsSpec.getLevelStats(weaponLevel) : bsSpec;
                const seedTicks = params?.seedTicks ?? 4;
                const tickFrac = params?.seedTickFrac ?? 0.12;
                const seedTickDmg = Math.max(1, Math.round(baseDamageGhost * tickFrac * gdmVS));
                const fuseMs = params?.fuseMs ?? 1200;
                const pullRadius = params?.pullRadius ?? 200;
                const pullStrength = params?.pullStrength ?? 220;
                const collapseRadius = params?.collapseRadius ?? 220;
                const collapseDmg = Math.max(1, Math.round((params?.collapseMult ?? 1.8) * baseDamageGhost * gdmVS));
                const gm: any = this.gameContext?.enemyManager;
                if (gm && typeof gm.spawnBlackSunSeed === 'function') {
                  gm.spawnBlackSunSeed(boss.x, boss.y, { fuseMs, pullRadius, pullStrength, collapseRadius, slowPct: (params?.seedSlowPct ?? 0.25), tickIntervalMs: (params?.seedTickIntervalMs ?? 300), ticks: seedTicks, tickDmg: seedTickDmg, collapseDmg });
                  anyVisibleEffect = true;
                }
              } catch { /* ignore boss spawn errors */ }
      } else {
              const dotB = bAny._voidSniperDot as { next:number; left:number; dmg:number; stacks?: number } | undefined;
              if (!dotB) {
                bAny._voidSniperDot = { next: nowBase + tickIntervalMs, left: ticks, dmg: perTick, stacks: 1 };
        // Immediate impact damage on boss as well
  try { (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, Math.max(1, Math.round(baseDamageGhost * 0.6 * gdmVS)), false, WeaponType.VOID_SNIPER, originX, originY, weaponLevel, false, 'PLAYER'); } catch {}
        if ((bAny._voidSniperDot as any).left > 0) (bAny._voidSniperDot as any).left--; // consume first tick
              } else {
                dotB.left = Math.max(dotB.left, ticks);
                dotB.dmg = (dotB.dmg || 0) + perTick;
                dotB.next = nowBase + tickIntervalMs;
                dotB.stacks = (dotB.stacks || 1) + 1;
  // Reduced immediate hit on stacking
  try { (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, Math.max(1, Math.round(baseDamageGhost * 0.25 * gdmVS)), false, WeaponType.VOID_SNIPER, originX, originY, weaponLevel, false, 'PLAYER'); } catch {}
        if (dotB.left > 0) dotB.left--; // consume first tick
              }
              (boss as any)._lastHitByWeapon = WeaponType.VOID_SNIPER;
              try { this.gameContext?.particleManager?.spawn(boss.x, boss.y, 1, '#B266FF'); } catch {}
              anyVisibleEffect = true;
            }
          }
        }
      } catch {}
      // Recoil & visuals
      if (anyVisibleEffect) {
        this.x -= Math.cos(beamAngle) * 8; this.y -= Math.sin(beamAngle) * 8;
        if (!game._activeBeams) game._activeBeams = [];
        const beamObj = { type: 'voidsniper', x: originX, y: originY, angle: beamAngle, range: effRange, start: performance.now(), duration: 1500, lastTick: performance.now(), weaponLevel, thickness: 10 } as any;
        game._activeBeams.push(beamObj);
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3 } }));
      }
    };
    requestAnimationFrame(chargeStep);
  }

  /** Black Sun Sniper: fires 5 beams to 5 different targets; beams cannot layer; each beam deals Void Sniper L7 damage. */
  private handleBlackSunSniperMultiFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) return;
    // Charge gating: identical to Void/Ghost – must be nearly stationary
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
    const surge = this.isShadowSurgeActive();
    const chargeTimeMs = surge ? 375 : 1050;
    (this as any)._sniperChargeStart = performance.now();
    (this as any)._sniperChargeMax = chargeTimeMs;
    const originX = this.x, originY = this.y - 8;
    const start = performance.now();
    const finish = () => {
      (this as any)._sniperCharging = false;
      (this as any)._sniperState = 'idle';
      (this as any)._sniperChargeStart = undefined;
      (this as any)._sniperChargeMax = 0;
      // Start cooldown mapped to Black Sun spec
      const FRAME_MS = 1000 / 60;
      const specStats = spec?.getLevelStats ? spec.getLevelStats(weaponLevel) : undefined;
      let baseCdMs: number | undefined = (specStats && typeof (specStats as any).cooldownMs === 'number') ? (specStats as any).cooldownMs : (typeof (spec as any).cooldownMs === 'number' ? (spec as any).cooldownMs : undefined);
      let baseCdFrames: number | undefined = baseCdMs == null ? (specStats && typeof (specStats as any).cooldown === 'number' ? (specStats as any).cooldown : (spec?.cooldown ?? 60)) : undefined;
      const rateSource = (this.getFireRateModifier?.() ?? this.fireRateModifier);
      const rateMul = Math.max(0.1, (this.attackSpeed || 1) * ((rateSource != null ? rateSource : 1)));
      const effCd = typeof baseCdMs === 'number' ? (baseCdMs / rateMul) : ((baseCdFrames as number) / rateMul) * FRAME_MS;
      this.shootCooldowns.set(WeaponType.BLACK_SUN, effCd);

      const game: any = this.gameContext; if (!game) return;
      // Compute base angle toward current or rechecked target
      let fireTarget: Enemy | null = target && target.active && target.hp > 0 ? target : (this.findSniperTargetAvoidingSoonExploding(0) || this.findNearestEnemy());
      if (!fireTarget) return;
      const baseAng = Math.atan2(fireTarget.y - originY, fireTarget.x - originX);
      const range = (spec?.range ?? 1200);

  // Damage: Void Sniper level 7 base damage
      const vsSpec = WEAPON_SPECS[WeaponType.VOID_SNIPER] as any;
      const vsL7 = vsSpec?.getLevelStats ? vsSpec.getLevelStats(7) : { damage: vsSpec?.damage ?? 95 };
      const gdm = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  let vsL7Damage = (vsL7.damage || 95);
  try { vsL7Damage = this.applyNonClassWeaponBuff(vsSpec, vsL7Damage); } catch {}
  const beamDamage = Math.max(1, Math.round(vsL7Damage * gdm));
  // DoT parameters: mirror Void Sniper per-tick profile at current weapon level
  const ghostSpec = WEAPON_SPECS[WeaponType.GHOST_SNIPER] as any;
  const baseDamageGhost = (ghostSpec.getLevelStats ? ghostSpec.getLevelStats(weaponLevel).damage : ghostSpec.damage) || 95;
  const voidSpec = WEAPON_SPECS[WeaponType.VOID_SNIPER] as any;
  const voidLvl = voidSpec?.getLevelStats ? voidSpec.getLevelStats(weaponLevel) : { ticks: 3, tickIntervalMs: 1000 } as any;
  const ticks = (voidLvl?.ticks ?? 3) || 3;
  const tickIntervalMs = (voidLvl?.tickIntervalMs ?? 1000) || 1000;
  const perTick = Math.max(1, Math.round(0.40 * baseDamageGhost * gdm));

      // Select up to 5 unique targets: prioritize along/near the base ray, then nearest others
      const enemies = (game.enemyManager?.getEnemies?.() || []) as Enemy[];
      const bossMgr: any = (window as any).__bossManager;
      const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
      const selected: Enemy[] = [];
      const used = new Set<Enemy>();

      const cosA = Math.cos(baseAng), sinA = Math.sin(baseAng);
      const thickness = 6;
      const rayAligned: Array<{e: Enemy, proj: number}> = [];
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i]; if (!e || !e.active || e.hp <= 0) continue; if (!this.isVisibleForAim(e.x, e.y)) continue;
        const relX = e.x - originX, relY = e.y - originY;
        const proj = relX * cosA + relY * sinA; if (proj < 0 || proj > range) continue;
        const ortho = Math.abs(-sinA * relX + cosA * relY);
        if (ortho <= thickness + e.radius) rayAligned.push({ e, proj });
      }
      rayAligned.sort((a,b)=>a.proj-b.proj);
      for (let i=0;i<rayAligned.length && selected.length<5;i++){ const e = rayAligned[i].e; if (!used.has(e)) { used.add(e); selected.push(e); } }
      // Fill remaining slots by nearest enemies not already chosen
      if (selected.length < 5) {
        const remaining = [] as Array<{e: Enemy, d2: number}>;
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i]; if (!e || !e.active || e.hp <= 0 || used.has(e)) continue;
          if (!this.isVisibleForAim(e.x, e.y)) continue;
          const dx = e.x - originX, dy = e.y - originY; const d2 = dx*dx + dy*dy;
          if (Math.sqrt(d2) <= range) remaining.push({ e, d2 });
        }
        remaining.sort((a,b)=>a.d2-b.d2);
        for (let i=0;i<remaining.length && selected.length<5;i++){ used.add(remaining[i].e); selected.push(remaining[i].e); }
      }
      // Consider boss as a candidate if active
  if (selected.length < 5 && boss && boss.active && boss.state === 'ACTIVE' && boss.hp > 0 && this.isVisibleForAim(boss.x, boss.y)) {
        selected.push(boss as any as Enemy);
      }

      if (selected.length === 0) return;

      // Fire beams toward each selected unique target. Beams cannot layer: clamp aim per target.
      if (!game._activeBeams) game._activeBeams = [];
      const now = performance.now();
      const visualsOnly = { type: 'sniper_black_sun', thickness: 8 } as any;

      for (let i = 0; i < selected.length; i++) {
        const t = selected[i];
        const ang = Math.atan2(t.y - originY, t.x - originX);
        // Damage application: single instantaneous hit to the target (no pierce), then apply Void Sniper-style DoT
        try {
          const em: any = game.enemyManager;
          // Black Sun visuals ignore blocker walls completely
          let visDist = Math.hypot(t.x - originX, t.y - originY);
          if (t === (boss as any)) {
            em.takeBossDamage?.(t, beamDamage, false, WeaponType.BLACK_SUN, originX, originY, weaponLevel, false, 'PLAYER');
            // Apply DoT on boss
            const bAny: any = t as any;
            const nowB = performance.now();
            const dotB = bAny._voidSniperDot as { next:number; left:number; dmg:number; stacks?: number } | undefined;
            if (!dotB) {
              bAny._voidSniperDot = { next: nowB + tickIntervalMs, left: ticks, dmg: perTick, stacks: 1 };
              if ((bAny._voidSniperDot as any).left > 0) (bAny._voidSniperDot as any).left--; // consume immediate tick slot
            } else {
              dotB.left = Math.max(dotB.left, ticks);
              dotB.dmg = (dotB.dmg || 0) + perTick;
              dotB.next = nowB + tickIntervalMs;
              dotB.stacks = (dotB.stacks || 1) + 1;
              if (dotB.left > 0) dotB.left--; // consume immediate tick slot
            }
          } else {
            em.takeDamage?.(t, beamDamage, false, false, WeaponType.BLACK_SUN, originX, originY, weaponLevel, false, 'PLAYER');
            // Apply DoT and short paralysis on regular enemies
            const eAny: any = t as any;
            const nowE = performance.now();
            const dot = eAny._voidSniperDot as { next:number; left:number; dmg:number; stacks?: number } | undefined;
            if (!dot) {
              eAny._voidSniperDot = { next: nowE + tickIntervalMs, left: ticks, dmg: perTick, stacks: 1 } as any;
              if (eAny._voidSniperDot.left > 0) eAny._voidSniperDot.left--; // consume immediate tick slot
            } else {
              dot.left = Math.max(dot.left, ticks);
              dot.dmg = (dot.dmg || 0) + perTick;
              dot.next = nowE + tickIntervalMs;
              dot.stacks = (dot.stacks || 1) + 1;
              if (dot.left > 0) dot.left--; // consume immediate tick slot
            }
            eAny._paralyzedUntil = Math.max(eAny._paralyzedUntil || 0, nowE + 500);
            eAny._lastHitByWeapon = WeaponType.BLACK_SUN as any;
          }
          // Small camera kick
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 80, intensity: 2 } }));
        } catch {}

  // Visual beam registration (short-lived). Black Sun beams are exceptions: they go through everything, so no clamp.
  const dx = t.x - originX, dy = t.y - originY; let dist = Math.hypot(dx, dy);
  // Intentionally do not clamp Black Sun visuals on Blocker walls.
        game._activeBeams.push({ type: visualsOnly.type, x: originX, y: originY, angle: ang, range: dist, start: now, duration: 160, lastTick: now, weaponLevel, thickness: visualsOnly.thickness });
      }
    };
    const step = () => {
      const now = performance.now();
      if (((this as any)._ghostUltCharging) || ((this as any)._basicFireSuppressed)) {
        (this as any)._sniperCharging = false;
        (this as any)._sniperState = 'idle';
        (this as any)._sniperChargeStart = undefined;
        (this as any)._sniperChargeMax = 0;
        return;
      }
      if (now - start < chargeTimeMs) { requestAnimationFrame(step); return; }
      finish();
    };
    requestAnimationFrame(step);
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
  // Spawn the zone now
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

  /** Heavy Gunner evolution: Lava Laser Minigun — sustained micro-beam that ticks DPS while firing. */
  private handleLavaMinigunFire(baseAngle: number, target: Enemy, spec: any, weaponLevel: number) {
    const game: any = this.gameContext; if (!game) return;
    // Beam origin: slight forward from player center to feel like muzzle
    const originX = this.x + Math.cos(baseAngle) * 10;
    const originY = this.y + Math.sin(baseAngle) * 10;
    const beamAngle = Math.atan2(target.y - originY, target.x - originX);
    const stats = spec?.getLevelStats ? spec.getLevelStats(Math.max(1, weaponLevel)) : spec;
    const rangeBase = (stats?.length || spec.range || 240);
    // Scale range with Heavy Gunner boost to reward heat uptime
  const t = this.getGunnerBoostT();
  const tPow = (this as any).getGunnerPowerT ? (this as any).getGunnerPowerT() : t;
    const range = rangeBase * (1 + (this.gunnerBoostRange - 1) * t);
    // Damage per second target based on spec damage at current level (converted via cooldown cadence)
    const FRAME_MS = 1000 / 60;
    const cdMs = (stats?.cooldownMs != null ? stats.cooldownMs : (stats?.cooldown || 5) * FRAME_MS);
    // Convert per-shot damage to per-second baseline, then apply gunner boost damage scaling
    const gdm = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier ?? 1);
  let perShotBase = (stats?.damage ?? spec.damage ?? 6);
  try { perShotBase = this.applyNonClassWeaponBuff(spec, perShotBase); } catch {}
  let perShot = Math.max(1, perShotBase * gdm);
  // Use shaped curve for damage to feel more overpowered at higher heat
  perShot *= (1 + (this.gunnerBoostDamage - 1) * tPow);
    const dps = perShot * (1000 / Math.max(1, cdMs));
    // Beam lifetime short; we refresh on each fire cadence so it appears continuous
    const durationMs = Math.max(100, Math.min(260, cdMs + 60));
    const beamStart = performance.now();
    if (!game._activeBeams) game._activeBeams = [];
    // Capture current Heavy Gunner heat ratio (0..1) if available
    const gh = (this as any).getGunnerHeat ? (this as any).getGunnerHeat() : undefined;
    const heatT = gh && gh.max > 0 ? Math.max(0, Math.min(1, gh.value / gh.max)) : 0;
    const beamObj = {
      type: 'melter', // reuse melter render path (hot core + rim), but palette overridden below in render
      lavaHint: true,
      heatT,
      x: originX,
      y: originY,
      angle: beamAngle,
      range,
      start: beamStart,
      duration: durationMs,
      lastTick: beamStart,
      weaponLevel,
      thickness: Math.max(6, (stats?.thickness || 8)),
      visLen: range,
      dealDamage: (now: number) => {
        // Live‑update heat for color blending
        try {
          const g: any = (this as any).getGunnerHeat ? (this as any).getGunnerHeat() : undefined;
          if (g && g.max > 0) beamObj.heatT = Math.max(0, Math.min(1, g.value / g.max));
        } catch {}
        const enemies = game.enemyManager?.getEnemies() || [];
        const cosA = Math.cos(beamAngle);
        const sinA = Math.sin(beamAngle);
        const thickness = (beamObj.thickness || 8);
        // Damage this frame based on elapsed since last tick
        const deltaSec = Math.max(0, (now - beamObj.lastTick) / 1000);
        const dmgThisFrame = dps * deltaSec;
        if (dmgThisFrame <= 0) { beamObj.lastTick = now; return; }
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (!e || !e.active || e.hp <= 0) continue;
          const relX = e.x - originX;
          const relY = e.y - originY;
          const proj = relX * cosA + relY * sinA; // distance along beam
          if (proj < 0 || proj > range) continue;
          const ortho = Math.abs(-sinA * relX + cosA * relY);
          if (ortho <= thickness + e.radius) {
            game.enemyManager.takeDamage(e, dmgThisFrame, false, false, WeaponType.GUNNER_LAVA_MINIGUN, originX, originY, weaponLevel, false, 'PLAYER');
          }
        }
        // Boss check
        try {
          const bossMgr: any = (window as any).__bossManager;
          const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
            const relX = boss.x - originX;
            const relY = boss.y - originY;
            const proj = relX * cosA + relY * sinA;
            const ortho = Math.abs(-sinA * relX + cosA * relY);
              if (proj >= 0 && proj <= range && ortho <= (thickness + (boss.radius || 160))) {
                (this.gameContext as any)?.enemyManager?.takeBossDamage?.(boss, dmgThisFrame, false, WeaponType.GUNNER_LAVA_MINIGUN, originX, originY, weaponLevel);
                (boss as any)._lastHitByWeapon = WeaponType.GUNNER_LAVA_MINIGUN;
              }
          }
        } catch {}
        beamObj.lastTick = now;
      }
    };
    game._activeBeams.push(beamObj);
    // Subtle muzzle ember effect
    try { this.gameContext?.particleManager?.spawn(originX, originY, 1, '#FF4500', { sizeMin: 0.6, sizeMax: 1.2, life: 26, speedMin: 0.6, speedMax: 1.4 }); } catch {}
  }

  /**
   * Inflicts damage to the player, clamping HP to zero.
   * @param amount Amount of damage to apply
   */
  public takeDamage(amount: number) {
  // Invulnerability window (i-frames)
  const now = performance.now();
  // Global revive cinematic: player is invulnerable/unhittable
  try { if ((window as any).__reviveCinematicActive) return; } catch {}
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
  // Armor passive: percent reduction applied before HP subtraction
  const armor = (this as any).armorReduction as number | undefined;
  if (armor && armor > 0) {
    amount = Math.max(0, amount * (1 - Math.max(0, Math.min(0.8, armor))));
  }
  // Titan Mech Fortress: flat damage reduction while braced
  if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) {
    amount = Math.max(1, Math.ceil(amount * 0.65));
  }
  // Lethal check with Revive passive (single revive with 5m cooldown)
  if (amount >= this.hp) {
    const hasRevive = !!(this as any).hasRevivePassive;
    const reviveCd = (this as any).reviveCooldownMs ?? (5 * 60 * 1000);
    const reviveHealFrac = (this as any).reviveHealFrac ?? 0.6;
    const reviveIFramesMs = (this as any).reviveIFramesMs ?? 2000;
    const lastReviveAt = (this as any)._lastReviveAt || -Infinity;
    const ready = hasRevive && (now - lastReviveAt >= reviveCd);
    if (ready) {
      // Consume revive: restore HP and grant brief invulnerability
      (this as any)._lastReviveAt = now;
      try {
        const timeSec = (this as any).gameContext?.getGameTime?.() ?? (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
        const eff = getHealEfficiency(timeSec);
        this.hp = Math.max(1, Math.floor(this.maxHp * reviveHealFrac * eff));
      } catch {
        this.hp = Math.max(1, Math.floor(this.maxHp * reviveHealFrac));
      }
      // Trigger short i-frames and a visual pulse
      this.invulnerableUntilMs = now + reviveIFramesMs;
      (this as any)._reviveFlashTime = now;
      try { window.dispatchEvent(new CustomEvent('playerRevived', { detail: { x: this.x, y: this.y } })); } catch {}
      // Start standard post-hit i-frames too
      (this as any)._lastDamageTime = now;
      return;
    }
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
    // Clear any stale crit fields from previous runs/characters to avoid UI showing incorrect 100%
    try {
      if (typeof (this as any).critBonus !== 'undefined' && !isFinite((this as any).critBonus)) delete (this as any).critBonus;
      if (typeof (this as any).critMultiplier !== 'undefined' && !isFinite((this as any).critMultiplier)) delete (this as any).critMultiplier;
    } catch {}
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
  // Only Titan Mech gets a +50% base size; Tech Warrior stays +25% to match visuals; everyone else 1.0
  const baseClassScale = (data?.id === 'tech_warrior') ? 1.25 : 1.0;
  const isTitan = data?.id === 'titan_mech';
  this.characterScale = (isTitan ? 1.5 : 1.0) * baseClassScale;
    // Recompute sprite size from base
    this.size = Math.round(this.baseSpriteSize * this.characterScale);
    // Cache baseSpeed AFTER scaling applied
  this.baseSpeed = this.speed;
  }

  /** Returns per-character scale (1.0 = default). */
  public getCharacterScale(): number {
    // Dynamic: Titan Mech grows an extra 25% while Fortress is active
    if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) return this.characterScale * 1.25;
    return this.characterScale;
  }

  /** Returns innate (pre-passive) movement speed */
  public getBaseMoveSpeed(): number { return this.baseMoveSpeed; }
  /** Returns innate (pre-passive) max HP */
  public getBaseMaxHp(): number { return this.baseMaxHp; }
  /** Returns innate (pre-passive) bullet damage */
  public getBaseBulletDamage(): number { return this.baseBulletDamage; }
  /** Returns global damage multiplier (includes conditional Overclock bonus). */
  public getGlobalDamageMultiplier(): number {
    const base = this.globalDamageMultiplier || 1;
    const anyThis: any = this as any;
    const lvl: number = anyThis.overclockLevel || 0;
    let mul = base;
    if (lvl > 0) {
      const threshold: number = anyThis.overclockHpThreshold ?? 0.5;
      const hpFrac = this.maxHp > 0 ? (this.hp / this.maxHp) : 1;
      if (hpFrac <= threshold) {
        const bonus = anyThis.overclockDamageBonus || 0;
        mul *= (1 + bonus);
      }
    }
    // Fortress stance: more damage while braced
    if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) mul *= 1.5; // +50%
    return mul;
  }
  /** Titan-only global nerf factor to apply only on Titan-specific abilities and weapons. */
  private getTitanOnlyDamageNerf(): number {
    return this.characterData?.id === 'titan_mech' ? 0.49 : 1;
  }
  /** Returns global area multiplier (AoE radius scale) */
  public getGlobalAreaMultiplier(): number {
    let mul = this.globalAreaMultiplier;
    if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) mul *= 1.12;
    return mul;
  }
  /** Global projectile range multiplier (affects max travel distance/life). */
  public getGlobalRangeMultiplier(): number {
    if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) return 1.6; // +60% range while braced
    return 1;
  }
  /** Returns global fire-rate modifier (cooldown scale; >1 = faster). Includes Overclock bonus under 50% HP. */
  public getFireRateModifier(): number {
    const base = this.fireRateModifier || 1;
    const anyThis: any = this as any;
    const lvl: number = anyThis.overclockLevel || 0;
    if (lvl > 0) {
      const threshold: number = anyThis.overclockHpThreshold ?? 0.5;
      const hpFrac = this.maxHp > 0 ? (this.hp / this.maxHp) : 1;
      if (hpFrac <= threshold) {
        const bonus = anyThis.overclockFireRateBonus || 0;
        return base * (1 + bonus);
      }
    }
  // Fortress stance: 300% increase => 4x total fire-rate while active
  if (this.characterData?.id === 'titan_mech' && (this as any).fortressActive) return base * 4.0;
  return base;
  }

  /**
   * Draws the player character using a PNG sprite from assets/player/{characterId}.png.
   * Path is normalized via AssetLoader to support subfolder hosting and file://.
   * If not cached yet, trigger a lazy load once and skip rendering this frame.
   */
  public draw(ctx: CanvasRenderingContext2D): void {
    const assetKey = this.characterData?.sprite || this.characterData?.id || 'cyber_runner';
    const rawPath = '/assets/player/' + assetKey + '.png';
    const AL: any = (window as any).AssetLoader;
    const normalized = AL ? AL.normalizePath(rawPath) : (location.protocol === 'file:' ? ('.' + rawPath) : rawPath);
    let img = this.gameContext?.assetLoader?.getImage(normalized) as HTMLImageElement | undefined;
    if (!img) {
      // Lazy-load once; cache prevents repeated loads. Skip drawing this frame.
      try { this.gameContext?.assetLoader?.loadImage(normalized).catch(()=>null); } catch {}
      return;
    }
  if (img && img.complete && img.naturalWidth > 0) {
      // Ability manager rendering (anchors, special effects, etc.)
      if (this.abilityManager && this.abilityManager.render) {
        try {
          this.abilityManager.render(ctx, this);
        } catch (error) {
          console.warn('Ability manager render error:', error);
        }
      }
      
      // Rogue Hacker: draw Ghost Protocol pool under the sprite
      try { if (this.characterData?.id === 'rogue_hacker' && this.ghostProtocol) { this.ghostProtocol.draw(ctx as any); } } catch {}
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
    // Compute dynamic draw size (applies fortress-scale visually)
    const intended = (this as any).getCharacterScale ? (this as any).getCharacterScale() : this.characterScale;
    let drawScale = intended;
    if (this.characterData?.id === 'titan_mech') {
      // Blend from base -> base*1.25 using fortressScaleT for a short ease
      const base = this.characterScale;
      const target = base * 1.25;
      drawScale = base + (target - base) * this.fortressScaleT;
    }
    const drawSize = Math.round(this.baseSpriteSize * drawScale);
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
  ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
          ctx.restore();
        }
      }
  ctx.save();
  ctx.translate(this.x, this.y);
  // Slow Aura visual (under-sprite): soft cyan ring showing effective slow radius
  try {
    const anyThis: any = this as any;
    const slowLvl: number = anyThis.slowAuraLevel | 0;
    if (slowLvl > 0) {
      const baseR: number = anyThis.slowAuraBaseRadius ?? 352; // keep in sync with PassiveConfig
      const addR: number = anyThis.slowAuraRadiusPerLevel ?? 48;
      const areaMul: number = (this.getGlobalAreaMultiplier?.() ?? (this.globalAreaMultiplier || 1));
      const rEff = (baseR + addR * slowLvl) * (areaMul || 1);
      const avgMs = (window as any).__avgFrameMs || 16;
      const vfxLow = (avgMs > 55) || !!(window as any).__vfxLowMode;
      const visR = Math.max(40, rEff * 0.98); // slight inset for aesthetics
      const inner = Math.max(8, Math.min(24, this.size * 0.2));
      const prevComp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      // Radial gradient: soft cyan core fading to transparent edge
      const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, visR);
      const alpha = vfxLow ? 0.10 : 0.16;
      grad.addColorStop(0.0, `rgba(120, 240, 255, ${alpha * 0.60})`);
      grad.addColorStop(0.35, `rgba(60, 200, 255, ${alpha * 0.35})`);
      grad.addColorStop(0.9, 'rgba(0, 160, 255, 0.08)');
      grad.addColorStop(1.0, 'rgba(0, 160, 255, 0.0)');
      ctx.fillStyle = grad as any;
      ctx.beginPath();
      ctx.arc(0, 0, visR, 0, Math.PI * 2);
      ctx.fill();
      // Optional outline hint on higher settings
      if (!vfxLow) {
        ctx.strokeStyle = 'rgba(0, 200, 255, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, visR * 0.995, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = prevComp;
    }
  } catch {}
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
  // Invisible during Ghost Protocol: skip drawing main sprite; draw a faint silhouette for orientation
  const ghosting = this.characterData?.id === 'rogue_hacker' && !!((this as any)._ghostProtocolActive);
  if (!ghosting) {
    ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
  } else {
    // silhouette ring
    const prevCompG = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = 'rgba(120,240,255,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, this.size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = prevCompG;
    ctx.globalAlpha = 1;
  }
    // Fortress Stance epic VFX (Titan Mech): dark red sigil + rim light while active
      try {
        const anyThis: any = this as any;
        if (this.characterData?.id === 'titan_mech' && anyThis.fortressActive) {
          const avgMs = (window as any).__avgFrameMs || 16;
          const vfxLow = (avgMs > 55) || !!(window as any).__vfxLowMode;
          // Neutralize sprite rotation for world-aligned effects
          ctx.save();
          ctx.rotate(- (appliedRotation + spriteFacingOffset));
      const baseR = drawSize * 0.7;
          const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          const pulse = (Math.sin(t / 160) * 0.5 + 0.5);
          const ringR = baseR * (1.1 + 0.08 * pulse);
          // Ground sigil: dual-tone additive gradient, no fill overdraw
          const prevCompF = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = vfxLow ? 0.18 : 0.26;
      // Outer glow disk (very soft) — dark red theme
      const gradG = ctx.createRadialGradient(0, 0, Math.max(4, baseR * 0.2), 0, 0, ringR * 1.15);
      gradG.addColorStop(0, 'rgba(255,70,70,0.22)');
      gradG.addColorStop(0.6, 'rgba(180,30,30,0.12)');
      gradG.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gradG as any;
          if (!vfxLow) {
            ctx.beginPath();
            ctx.arc(0, 0, ringR * 1.1, 0, Math.PI * 2);
            ctx.fill();
          }
      // Crisp twin rings (dark red)
      ctx.lineWidth = vfxLow ? 1 : 2;
      ctx.strokeStyle = 'rgba(255,80,80,0.7)';
          ctx.beginPath(); ctx.arc(0, 0, ringR, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(200,30,30,0.45)';
          ctx.beginPath(); ctx.arc(0, 0, ringR * 0.78, 0, Math.PI * 2); ctx.stroke();
          // Four cardinal chevrons
          const chevronR = ringR * 0.86;
      const len = Math.max(8, drawSize * 0.18);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,60,60,0.8)';
          for (let k = 0; k < 4; k++) {
            const a = (Math.PI / 2) * k + t / 1000 * 0.6; // slow rotation
            const cx = Math.cos(a) * chevronR;
            const cy = Math.sin(a) * chevronR;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            ctx.stroke();
          }
          // Rim light on the mech body
      ctx.globalAlpha = vfxLow ? 0.18 : 0.32;
      ctx.strokeStyle = 'rgba(255,80,80,0.95)';
      ctx.lineWidth = Math.max(1, drawSize * 0.06);
          ctx.beginPath();
      ctx.arc(0, 0, drawSize * 0.52, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalCompositeOperation = prevCompF;
          ctx.restore();
        }
      } catch {}
      // Overclock visual aura: fiery halo when passive is owned; intensifies under threshold
      try {
        const anyThis: any = this as any;
        const lvl: number = anyThis.overclockLevel || 0;
        if (lvl > 0) {
          const threshold: number = anyThis.overclockHpThreshold ?? 0.5;
          const hpFrac = this.maxHp > 0 ? (this.hp / this.maxHp) : 1;
          const avgMs = (window as any).__avgFrameMs || 16;
          const vfxLow = (avgMs > 55) || !!(window as any).__vfxLowMode;
          const baseRadius = this.size * 0.65; // around the body
          const under = hpFrac <= threshold;
          // Intensity scales with level and whether we're under threshold
          const lvlScale = 0.12 + (lvl * 0.06);
          const intensity = under ? (0.4 + lvlScale) : (0.18 + lvlScale * 0.6);
          const pulse = Math.sin(((typeof performance !== 'undefined' ? performance.now() : Date.now()) + (this.x + this.y) * 3) / 120) * 0.5 + 0.5; // 0..1
          const alpha = Math.max(0.1, Math.min(0.85, intensity * (0.7 + 0.3 * pulse)));
          const outerR = baseRadius * (under ? 1.35 : 1.15);
          const innerR = Math.max(6, baseRadius * 0.25);
          // Ring + glow (single pass; very cheap). Use additive blend for warmth.
          const prevComp2 = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';
          // Soft radial fill
          const grad2 = ctx.createRadialGradient(0, 0, innerR, 0, 0, outerR);
          grad2.addColorStop(0, `rgba(255, 180, 60, ${alpha * 0.45})`);
          grad2.addColorStop(0.6, `rgba(255, 100, 20, ${alpha * 0.25})`);
          grad2.addColorStop(1, 'rgba(255, 60, 0, 0)');
          ctx.fillStyle = grad2 as any;
          ctx.beginPath();
          ctx.arc(0, 0, outerR, 0, Math.PI * 2);
          ctx.fill();
          // Optional flicker ring when under threshold (skipped on low VFX)
          if (!vfxLow && under) {
            const ringR = outerR * (0.88 + 0.06 * pulse);
            ctx.globalAlpha = alpha * 0.7;
            ctx.strokeStyle = `rgba(255,120,40,${Math.max(0.2, 0.5 * pulse)})`;
            ctx.lineWidth = 2 + 1.5 * pulse;
            ctx.beginPath();
            ctx.arc(0, 0, ringR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.globalCompositeOperation = prevComp2;
        }
      } catch {}
      if (flashing) {
        const alpha = 0.45 * (1 - since / 200) + 0.2; // fade out
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(0, 0, drawSize/2, 0, Math.PI*2);
        ctx.fill();
      }
      // Blade Cyclone visual: two swords orbiting while active (scaled to match hit radius)
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
  // Cyan afterimage trails for swords (values finalized after vfxLow is known)
  let trailCount = 0;   // number of ghost blades behind current
  let trailFade = 0.0;  // opacity falloff factor for ghosts
        // Theme: red when Runner Overdrive is owned, cyan otherwise
        const hasOverdrive = !!((this as any).activeWeapons && (this as any).activeWeapons.has(WeaponType.RUNNER_OVERDRIVE));
        const theme = hasOverdrive ? 'red' : 'cyan';
        // Pre-render a single sword into an offscreen canvas to cut per-frame draw cost
        const selfAny: any = this as any;
        let swordCanvas: HTMLCanvasElement | null = selfAny._cycloneSwordCanvas || null;
        let swordCanvasLen: number = selfAny._cycloneSwordCanvasLen || 0;
        let swordCanvasPivotY: number = selfAny._cycloneSwordCanvasPivotY || 0;
        let swordCanvasTheme: string = selfAny._cycloneSwordCanvasTheme || 'cyan';
        // Rebuild cache when blade length or theme changes
        if (!swordCanvas || swordCanvasLen !== bladeLen || swordCanvasTheme !== theme) {
          const off = document.createElement('canvas');
          const offCtx = off.getContext('2d');
          if (offCtx) {
            const bladeW = 4.2;
            const margin = 12; // room for glow
            off.width = Math.ceil(bladeW + margin * 2);
            off.height = Math.ceil(bladeLen + margin * 2 + 8); // include hilt area
            const pivotX = off.width / 2;
            const pivotY = bladeLen + margin;
            offCtx.save();
            offCtx.translate(pivotX, pivotY);
            // Modest glow baked into prerender
            offCtx.shadowColor = (theme === 'red') ? 'rgba(178,34,34,0.45)' : 'rgba(0,255,255,0.35)';
            offCtx.shadowBlur = 3;
            // Core (slightly shorter than blade for depth)
            offCtx.fillStyle = 'rgba(255,255,255,0.9)';
            offCtx.fillRect(-bladeW*0.22, -bladeLen*0.9, bladeW*0.44, bladeLen*0.8);
            // Blade gradient by theme
            const grad = offCtx.createLinearGradient(0, -bladeLen*0.5, 0, bladeLen*0.5);
            if (theme === 'red') {
              grad.addColorStop(0, 'rgba(255,200,200,0.85)');
              grad.addColorStop(1, 'rgba(178,34,34,0.70)');
            } else {
              grad.addColorStop(0, 'rgba(200,255,255,0.85)');
              grad.addColorStop(1, 'rgba(0,255,255,0.55)');
            }
            offCtx.fillStyle = grad as any;
            offCtx.fillRect(-bladeW/2, -bladeLen, bladeW, bladeLen);
            // Hilt
            offCtx.shadowBlur = 0;
            offCtx.fillStyle = '#082b2e';
            offCtx.fillRect(-10, 2, 20, 6);
            offCtx.restore();
            // Persist cache
            selfAny._cycloneSwordCanvas = off;
            selfAny._cycloneSwordCanvasLen = bladeLen;
            selfAny._cycloneSwordCanvasPivotY = pivotY;
            selfAny._cycloneSwordCanvasTheme = theme;
            swordCanvas = off;
            swordCanvasLen = bladeLen;
            swordCanvasPivotY = pivotY;
            swordCanvasTheme = theme;
          }
        }
        // Use additive blending once for swords / ring
  const avgMs = (window as any).__avgFrameMs || 16;
  const severeLoad = avgMs > 55;
  const vfxLow = severeLoad || !!(window as any).__vfxLowMode;
  if (!vfxLow) { trailCount = 3; trailFade = 0.32; }
  const prevComp = ctx.globalCompositeOperation;
  if (!vfxLow) ctx.globalCompositeOperation = 'lighter';
        // Neutralize the sprite rotation once for the cyclone visuals to keep orbit math simple
        ctx.save();
        ctx.rotate(- (appliedRotation + spriteFacingOffset));
        const drawSword = (ang: number, mirror: boolean) => {
          // Position sword around player in world space (sprite rotation already neutralized)
          const px = Math.cos(ang) * radius;
          const py = Math.sin(ang) * radius + bob;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(ang + Math.PI/2);
          if (mirror) ctx.scale(-1, 1);
          const off = selfAny._cycloneSwordCanvas as HTMLCanvasElement;
          if (off) {
            // Soft cyan aura behind blade tip
            if (!vfxLow) {
              ctx.save();
              ctx.globalCompositeOperation = 'lighter';
              ctx.shadowColor = (theme === 'red') ? 'rgba(178,34,34,0.55)' : 'rgba(0,255,255,0.45)';
              ctx.shadowBlur = 12;
              ctx.fillStyle = (theme === 'red') ? 'rgba(178,34,34,0.18)' : 'rgba(0,255,255,0.12)';
              ctx.beginPath();
              ctx.ellipse(0, -bladeLen * 0.8, 10, 16, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
            ctx.drawImage(off, -off.width/2, -swordCanvasPivotY);
          }
          ctx.restore();
        };
  // Edge indicator ring at exact damage radius (subtle glow; red when Overdrive owned)
        ctx.save();
  ctx.strokeStyle = (theme === 'red') ? 'rgba(178,34,34,0.40)' : 'rgba(0,255,255,0.18)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
  ctx.arc(0, 0, cycloneRadiusVisual, 0, Math.PI * 2);
        ctx.stroke();
  ctx.restore();
        // Trails (sub-angles behind the current angle)
        for (let i = trailCount; i >= 1; i--) {
          const a = baseAngle - i * 0.25 + Math.PI/2; // 90° offset to bias left/right
          const alpha = Math.max(0, trailFade * (1 - i / (trailCount + 1)));
          ctx.save();
          ctx.globalAlpha *= alpha;
          drawSword(a, false);
          drawSword(a + Math.PI, true);
          ctx.restore();
        }
        // Add faint sweeping arcs along the ring to sell motion
        if (!vfxLow) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = (theme === 'red') ? 'rgba(178,34,34,0.35)' : 'rgba(0,255,255,0.18)';
          ctx.lineWidth = 2;
          const arcSpan = 0.55; // radians per sweep
          for (let k = -1; k <= 1; k += 2) {
            const arcAng = baseAngle + Math.PI/2 + k * 0.15;
            ctx.beginPath();
            ctx.arc(0, 0, cycloneRadiusVisual - 4, arcAng - arcSpan/2, arcAng + arcSpan/2);
            ctx.stroke();
          }
          ctx.restore();
        }
        // Current swords
        // 90° offset so swords read as left/right instead of front/back
        drawSword(baseAngle + Math.PI/2, false);
        drawSword(baseAngle + Math.PI/2 + Math.PI, true);
  ctx.restore(); // undo rotation neutralization
  ctx.globalCompositeOperation = prevComp;
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
        // Use class weapon DPS to scale the ultimate burst; never let evolved reduce power
        const aw: Map<number, number> | undefined = (this as any).activeWeapons;
        const evolved = !!(aw && aw.has(WeaponType.HACKER_BACKDOOR));
        const virusSpec: any = (WEAPON_SPECS as any)[WeaponType.HACKER_VIRUS];
        const virusStatsAt = (lvl:number) => (virusSpec?.getLevelStats ? virusSpec.getLevelStats(Math.max(1, Math.min(7, lvl))) : { damage: 32, cooldown: 32 });
        const lvlVirus = (aw?.get(WeaponType.HACKER_VIRUS) ?? 1);
        const lvlEvo = (aw?.get(WeaponType.HACKER_BACKDOOR) ?? 0);
        // Current weapon DPS (prefer base virus level if present)
        const curLv = (lvlVirus > 0 ? lvlVirus : (lvlEvo > 0 ? 7 : 1));
        const cur = virusStatsAt(curLv);
        const dpsCur = (cur.damage * 60) / Math.max(1, (cur.cooldown || 32));
        // Max DPS anchor for huge evolved burst
        const max = virusStatsAt(7);
        const dpsMax = (max.damage * 60) / Math.max(1, (max.cooldown || 32));
        const gdm = (this as any).getGlobalDamageMultiplier?.() ?? ((this as any).globalDamageMultiplier || 1);
        const radius = 720;
        // Burst seconds budget: larger when evolved to feel "ultimate"
        const burstSec = evolved ? 4.5 : 2.8;
        const baseDps = evolved ? dpsMax : dpsCur;
        // Base damage before any low-level clamping
        const baseDamage = Math.max(1, Math.round(baseDps * burstSec * gdm));
        // Early-game clamp: keep System Hack modest at low levels when not evolved
        let damage = baseDamage;
        if (!evolved) {
          if (curLv === 1) {
            // 5x less at L1
            damage = Math.max(1, Math.round(baseDamage * 0.2));
          } else if (curLv === 2) {
            // Target around 70 damage at L2 baseline
            const target = 70;
            const mul = Math.min(1, target / baseDamage);
            damage = Math.max(1, Math.round(baseDamage * mul));
          }
        }
        const paralyzeMs = evolved ? 2400 : 2000;
        const glitchMs = 520;
        try { window.dispatchEvent(new CustomEvent('rogueHackUltimate', { detail: { x: this.x, y: this.y, radius, damage, paralyzeMs, glitchMs } })); } catch {}
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: evolved ? 180 : 140, intensity: evolved ? 4.0 : 3.2 } })); } catch {}
      }
      break;
    }
    case 'ghost_operative': {
      // Phase Cloak: duration/speed/cooldown scale with GHOST_SNIPER level and cap at SPECTRAL_EXECUTIONER apex
      if (!this.cloakActive && (this.cloakCdMs <= 0)) {
        const aw: Map<number, number> | undefined = (this as any).activeWeapons;
        const lvlBase = aw?.get(WeaponType.GHOST_SNIPER) ?? 0;
        const hasEvo = !!(aw && aw.has(WeaponType.SPECTRAL_EXECUTIONER));
        const lvl = Math.max(lvlBase, hasEvo ? 7 : 1); // if evolved, treat as apex anchor
        const t = Math.max(0, Math.min(1, (lvl - 1) / 6));
        // Duration: 5s -> 6.5s (evolved cap 6.5)
        const durMsRaw = 5000 + Math.round(1500 * t);
        this.cloakActiveMsMax = hasEvo ? Math.min(6500, durMsRaw) : durMsRaw;
        // Speed mult: 1.32x -> 1.55x (cap when evolved)
        const speedMulRaw = 1.32 + 0.23 * t; // 1.32..1.55
        const speedMul = hasEvo ? Math.min(1.55, speedMulRaw) : speedMulRaw;
        // Cooldown: 16s -> 12s (cap 11s when evolved)
        const cdRaw = 16000 - Math.round(4000 * t);
        this.cloakCdMaxMs = hasEvo ? Math.max(11000, Math.min(16000, cdRaw - 1000)) : Math.max(12000, Math.min(16000, cdRaw));
        // Activate
        this.cloakActive = true;
        this.cloakActiveMs = 0;
        // Speed boost (store and restore later)
        this.cloakPrevSpeed = this.speed;
        this.speed = this.speed * speedMul;
        // Damage immunity window aligns with cloak duration
        this.invulnerableUntilMs = now + this.cloakActiveMsMax;
        // Notify systems that cloak started (lock enemies to current player position)
        try { window.dispatchEvent(new CustomEvent('ghostCloakStart', { detail: { x: this.x, y: this.y, durationMs: this.cloakActiveMsMax } })); } catch {}
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
      // Activate Lattice Weave: duration/radius/cooldown scale with PSIONIC_WAVE, cap at RESONANT_WEB apex
      if (!this.latticeActive && (this.latticeCdMs <= 0)) {
        const aw: Map<number, number> | undefined = (this as any).activeWeapons;
        const lvlBase = aw?.get(WeaponType.PSIONIC_WAVE) ?? 1;
        const hasEvo = !!(aw && aw.has(WeaponType.RESONANT_WEB));
        const lvl = Math.max(1, Math.min(7, hasEvo ? 7 : lvlBase));
        const t = Math.max(0, Math.min(1, (lvl - 1) / 6));
        // Duration: 4s -> 6s (evo cap 6s)
        this.latticeActiveMsMax = hasEvo ? 6000 : (4000 + Math.round(2000 * t));
        // Cooldown: 14s -> 10s (evo cap 9s)
        const cdRaw = 14000 - Math.round(4000 * t);
        this.latticeCdMaxMs = hasEvo ? Math.max(9000, Math.min(14000, cdRaw - 1000)) : Math.max(10000, Math.min(14000, cdRaw));
        // Radius: 300 -> 420 (evo cap 480). Area passive will further multiply in EnemyManager.
        const radiusRaw = 300 + Math.round(120 * t);
        const radius = hasEvo ? Math.min(480, radiusRaw + 40) : radiusRaw; // small bump with evo
        try { (window as any).__weaverLatticeRadius = radius; } catch {}
        // Activate
        this.latticeActive = true;
        this.latticeActiveMs = 0;
        // Visuals/logic hooks read this global deadline
        try { (window as any).__weaverLatticeActiveUntil = now + this.latticeActiveMsMax; } catch {}
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
          // Evolved cap anchor: cap ability within Runic Engine per-cast budget and radius
          const evolvedSpec: any = (WEAPON_SPECS as any)[WeaponType.RUNIC_ENGINE];
          const evolved = evolvedSpec?.getLevelStats ? evolvedSpec.getLevelStats(1) : { sigilRadius: 240, pulseCount: 8, pulseDamage: 200 } as any;
          const baseRadius = (stats?.sigilRadius ?? 140);
          // Grow with level but never exceed evolved radius
          const radius = Math.min(evolved.sigilRadius || 240, Math.round(baseRadius * 1.8));
          // Ability lives longer and connects more; cap pulses at evolved pulseCount
          const basePulses = (stats?.pulseCount ?? 4);
          const proposedPulses = Math.max(basePulses, Math.ceil(basePulses * 1.5));
          const pulseCount = Math.min(proposedPulses, Math.max(1, evolved.pulseCount || 8));
          // Keep total per-cast damage under evolved budget
          const basePulseDamage = (stats?.pulseDamage ?? 95);
          const evolvedBudget = Math.max(1, (evolved.pulseCount || 8) * (evolved.pulseDamage || 200));
          const proposedBudget = pulseCount * basePulseDamage;
          const pulseDamage = proposedBudget > evolvedBudget ? Math.max(1, Math.floor(evolvedBudget / pulseCount)) : basePulseDamage;
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

  // Use spatial query when available to avoid scanning all enemies
  const enemyMgr = this.gameContext?.enemyManager as any;
  const cycloneRadius = (this.getBladeCycloneTipRadius?.() ?? 0) || 240; // fallback ~240px
  const enemies: any[] = (enemyMgr && typeof enemyMgr.queryEnemies === 'function')
    ? enemyMgr.queryEnemies(this.x, this.y, cycloneRadius + 24)
    : (this.enemyProvider ? this.enemyProvider() : []);
  const lvl = Math.max(1, Math.round(this.level || 1));
  const gdm = this.getGlobalDamageMultiplier?.() ?? (this.globalDamageMultiplier ?? 1);

  // Scale cyclone tick damage from class weapon DPS
  // Baseline: Runner Gun at current level. If Overdrive is owned, set anchor to exactly 2× Runner Gun L7 DPS per request.
  const aw: Map<number, number> | undefined = (this as any).activeWeapons;
  const hasOverdrive = !!(aw && aw.has(WeaponType.RUNNER_OVERDRIVE));
  const rgSpec: any = (WEAPON_SPECS as any)[WeaponType.RUNNER_GUN];
  const roSpec: any = (WEAPON_SPECS as any)[WeaponType.RUNNER_OVERDRIVE];
  const rgLvl = (() => { try { return (aw?.get(WeaponType.RUNNER_GUN) ?? 1); } catch { return 1; } })();
  const rgStats = rgSpec?.getLevelStats ? rgSpec.getLevelStats(Math.max(1, Math.min(7, rgLvl))) : { damage: rgSpec?.damage ?? 6, cooldown: rgSpec?.cooldown ?? 6, salvo: rgSpec?.salvo ?? 1 };
  const rgDps = ((rgStats.damage || 0) * (rgStats.salvo || 1) * 60) / Math.max(1, (rgStats.cooldown || 6));
  // Compute 2× L7 baseline when Overdrive is owned
  let anchorDps = rgDps;
  if (hasOverdrive) {
    const rgL7 = rgSpec?.getLevelStats ? rgSpec.getLevelStats(7) : rgStats;
    const rgL7Dps = ((rgL7.damage || 0) * (rgL7.salvo || 1) * 60) / Math.max(1, (rgL7.cooldown || 6));
    anchorDps = rgL7Dps * 2; // 2× stronger than class lvl 7
  }
  // Cyclone emits 4 ticks at 150ms each (0.6s total). Convert a fraction of weapon DPS into each tick.
  const cycloneDpsFraction = 1.0; // average ~10% of class weapon DPS over the 6s cooldown
  const perTickSec = 0.150;
  const damage = Math.max(1, Math.round((anchorDps * cycloneDpsFraction * perTickSec) * (gdm || 1)));
  // Micro knockback only, outward from hero (no pull). Keep gentle push; scale very slightly with level.
  const baseKb = 6 + Math.floor((lvl - 1) * 0.15);

  let hits = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || !e.active || e.hp <= 0) continue;
    const dx = e.x - this.x;
    const dy = e.y - this.y;
    const distSq = dx*dx + dy*dy;
    if (distSq > cycloneRadius * cycloneRadius) continue;

    // Deal damage via EnemyManager for consistency
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
    // Cheap hit spark (throttled): only for the first few hits to curb overdraw
    if (hits < 6) {
      const pm = this.gameContext?.particleManager;
      if (pm) {
        const color = hasOverdrive ? 'rgba(178,34,34,0.95)' : '#00FFFF';
        pm.spawn(e.x, e.y, 1, color, { sizeMin: 0.9, sizeMax: 1.6, life: 22, speedMin: 0.9, speedMax: 1.8 });
      }
    }
    hits++;
  }

  if (hits > 0) {
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 80, intensity: Math.min(3, 1 + hits * 0.25) } })); } catch {}
  }
};

// (Removed older duplicate performRunnerDash that teleported instantly and incorrectly hosted cyclone damage definition.)

/**
 * Tech Warrior Glide
 * - Triggers a 360ms eased glide in the current move direction with brief i-frames.
 * - On start, precomputes a per-glide impact payload scaled from Tachyon Spear and capped by Singularity Spear.
 * - During the glide, sweeps a short radius in front of the player at a fixed cadence, damaging and knocking back each enemy once.
 * - Includes boss parity: applies reduced damage on boss intersection.
 */
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
  this.techDashDirX = dx; this.techDashDirY = dy;
  this.techDashStartX = this.x; this.techDashStartY = this.y;
  this.techDashEndX = this.x + dx * baseDistance;
  this.techDashEndY = this.y + dy * baseDistance;
  this.techDashTimeMs = 0;
  this.techDashActive = true;
  this.techDashEmitAccum = 0;
  this.techDashHitIds.clear();
  this.techDashBossHit = false;
  // Precompute per-glide impact damage scaled by Tachyon Spear and capped at Singularity Spear
  try {
    const aw: Map<number, number> | undefined = (this as any).activeWeapons;
    const tsLvl = Math.max(1, Math.min(7, (aw?.get(WeaponType.TACHYON_SPEAR) ?? 1)));
    const tsSpec: any = (WEAPON_SPECS as any)[WeaponType.TACHYON_SPEAR];
    const sgSpec: any = (WEAPON_SPECS as any)[WeaponType.SINGULARITY_SPEAR];
    const tsStats = tsSpec?.getLevelStats ? tsSpec.getLevelStats(tsLvl) : { damage: tsSpec?.damage ?? 42, cooldown: tsSpec?.cooldown ?? 38, salvo: 1 };
    const sgStats = sgSpec?.getLevelStats ? sgSpec.getLevelStats(1) : { damage: sgSpec?.damage ?? 66, cooldown: sgSpec?.cooldown ?? 68, salvo: 1 };
    const tsDps = ((tsStats.damage || 0) * (tsStats.salvo || 1) * 60) / Math.max(1, (tsStats.cooldown || 38));
    const sgDps = ((sgStats.damage || 0) * (sgStats.salvo || 1) * 60) / Math.max(1, (sgStats.cooldown || 68));
    // Convert a fraction of weapon DPS into a single glide-impact payload. Glide lasts ~0.36s; impact is brief.
  const gdm = this.getGlobalDamageMultiplier?.() ?? (this.globalDamageMultiplier ?? 1);
  // Allocate a larger portion of class weapon DPS to glide impact for a satisfying hit
  const fraction = 0.65; // was 0.38; higher burst per request
  const budget = Math.min(tsDps, sgDps) * fraction * (gdm || 1); // cap at evolved apex and apply passives
    this.techDashImpactDamage = Math.max(1, Math.round(budget));
  // Radius scales with Area and weapon level; larger footprint for glide sweep
  const areaMul = this.getGlobalAreaMultiplier?.() ?? (this.globalAreaMultiplier ?? 1);
  const baseR = Math.max(80, Math.min(160, Math.round(90 + tsLvl * 12))); // 90..174 -> clamped to 160
  this.techDashHitRadius = Math.max(48, Math.round(baseR * (areaMul || 1)));
    this.techDashWeaponLevel = tsLvl;
  } catch { this.techDashImpactDamage = 60; this.techDashHitRadius = 52; this.techDashWeaponLevel = 1; }
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
    const hasOverdrive = !!((this as any).activeWeapons && (this as any).activeWeapons.has(WeaponType.RUNNER_OVERDRIVE));
    const burstColor = hasOverdrive ? 'rgba(178,34,34,0.85)' : '#FFAA33';
    const burst = 14;
    for (let i = 0; i < burst; i++) {
      const a = (i / burst) * Math.PI * 2;
      const r = 18 + Math.random() * 20;
      pm.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1, burstColor, { sizeMin: 1.4, sizeMax: 2.8, life: 48, speedMin: 1.2, speedMax: 2.6 });
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

  // Trigger Runner Overdrive surge: 2s window after a dash enabling evolved Runner shots to gain bonuses
  this.runnerOverdriveSurgeUntil = performance.now() + 2000;

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

  // Subtle red trail burst cue for Overdrive surge
  try {
    const pm = this.gameContext?.particleManager;
    if (pm) {
      const count = 10;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 12 + Math.random() * 24;
        pm.spawn(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1, 'rgba(178,34,34,0.85)', { sizeMin: 1.0, sizeMax: 2.0, life: 36, speedMin: 0.8, speedMax: 1.6 });
      }
    }
  } catch {}
};

// (Removed duplicate older performBladeCycloneDamage implementation)

