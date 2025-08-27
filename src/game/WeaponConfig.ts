import { WeaponType } from './WeaponType';
import { AssetLoader } from './AssetLoader';

export interface ProjectileVisual {
  /**
   * Type of projectile visual.
   */
  type: 'bullet' | 'laser' | 'beam' | 'plasma' | 'slime' | 'spray' | 'explosive' | 'boomerang' | 'ricochet' | 'drone' | 'arrow';
  /**
   * Hex color for the projectile.
   */
  color?: string;
  /**
   * Optional sprite path for the projectile.
   */
  sprite?: string;
  /**
   * Size of the projectile (for bullets/plasma/slime).
   */
  size?: number;
  /**
   * Length of the projectile (for lasers/beams).
   */
  length?: number;
  /**
   * Thickness of the projectile (for lasers/beams).
   */
  thickness?: number;
  /**
   * Glow color for effects.
   */
  glowColor?: string;
  /**
   * Glow radius for effects.
   */
  glowRadius?: number;
  /**
   * Trai    isClassWeapon: true,
    knockback: 60,olor for the projectile.
   */
  trailColor?: string;
  /**
   * Trail length for the projectile.
   */
  trailLength?: number;
  /**
   * Optional rotation offset (radians) applied after velocity-based angle.
   * Use for sprites whose default art points in a different base direction.
   */
  rotationOffset?: number;
}

export interface WeaponEvolution {
  evolvedWeaponType: WeaponType;
  requiredPassive: string; // Name of the required passive for evolution
}

export interface WeaponSpec {
  id: WeaponType;
  name: string;
  icon?: string;
  description?: string; // Added description property
  /** Short actionable tips shown in UI */
  usageTips?: string[];
  /** If true, this weapon is temporarily disabled and should not be offered or fired. */
  disabled?: boolean;
  cooldown: number; // frames between shots (fallback if cooldownMs not provided)
  /** Optional cooldown expressed in milliseconds. If provided, takes precedence over frame-based cooldown. */
  cooldownMs?: number;
  salvo: number; // bullets per shot
  spread: number; // radians between bullets
  projectile: string; // key to projectile type in manifest (for sprite-based)
  speed: number; // bullet speed
  range: number; // new stat: max range in pixels
  maxLevel: number; // max level for the weapon
  damage: number; // Base damage of the weapon's projectile
  projectileVisual: ProjectileVisual; // New property for visual definition
  traits?: string[]; // Unique traits for weapon
  beamVisual?: ProjectileVisual; // Optional beam visual for weapons like Railgun
  evolution?: WeaponEvolution; // New property for weapon evolution
  explosionRadius?: number; // Optional explosion radius for on-hit effects
  isClassWeapon?: boolean; // New property to identify class weapons
  /**
   * Knockback force applied to enemies hit by this weapon (pixels/frame or arbitrary units)
   */
  knockback?: number;
  /** Optional explicit projectile lifetime override (frames). If absent, derived from range/speed. */
  lifetime?: number;
  /** Plasma / charge weapon specific fields (optional for generic weapons) */
  chargeTimeMs?: number;
  overheatThreshold?: number;
  heatPerShot?: number;
  heatPerFullCharge?: number;
  heatDecayPerSec?: number;
  fragmentCount?: number;
  ionFieldDamageFrac?: number;
  ionFieldDurationMs?: number;
  overchargedMultiplier?: number;
  chargedMultiplier?: number;
  /**
   * Returns scaled stats for the weapon at a given level.
   * @param level Weapon level (1-based)
   */
  getLevelStats?: (level: number) => Record<string, number>;
}

export const WEAPON_SPECS: Record<WeaponType, WeaponSpec> = {
  [WeaponType.PISTOL]:   {
    id: WeaponType.PISTOL,
    name: 'Desert Eagle',
  description: 'Heavy sidearm favored by operatives who like decisive hits. Reliable at mid\-long lanes with stout knockback.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_deagle.png'),
  cooldown: 70, // adjusted to align L1 DPS target (50 DPS)
    salvo: 1,
    spread: 0,
  projectile: 'bullet_cyan', // Use PNG asset for projectile
  speed: 14, // slower baseline; per-level scaling below will override
    // Increased range for Desert Eagle (was 440) to improve long‑range feel
  range: 660,
  maxLevel: 7, // extended cap (was 5) with diminishing late growth
  damage: 58, // baseline damage revised (58 dmg @ 70f -> ~49.7 DPS; scaled function lifts to exact target)
    /**
     * Returns scaled stats for Desert Eagle at a given level.
     * @param level Weapon level (1-based)
     */
    /**
     * Rebalanced progression targeting explicit single‑target DPS milestones:
     * L1: 50  L2: ~85  L3: ~140  L4: ~255  L5: 400
     * Formula chosen: hand-tuned breakpoints (not simple linear) combining damage increase and cooldown reduction.
     * Damage derived from: DPS = (damage * 60) / cooldownFrames.
     */
    getLevelStats(level: number) {
      // Tables define cooldown & DPS targets; damage derived each level.
  const cooldownTable = [70, 65, 60, 52, 45, 42, 38]; // frames (added L6/L7)
  const dpsTable       = [50, 85,140,255,400,470,540]; // added diminishing gains
  const idx = Math.min(Math.max(level,1), cooldownTable.length) - 1;
      const cd = cooldownTable[idx];
      const targetDps = dpsTable[idx];
    const damage = Math.round(targetDps * cd / 60); // derive integer damage
    // Mild ancillary scaling (ethereal + slower)
  const speed = 12 + idx * 1.0; // slower baseline and growth
  // Smaller, lighter core for ethereal vibe
  const projectileSize = 9 + idx * 1.0;
      const recoil = 1 + idx * 0.2;
  // Add base pierce that grows slowly with level: L1 starts at 1
  const pierce = 1 + Math.max(0, Math.min(2, Math.floor((idx) / 3))); // 1 at L1-3, 2 at L4-6, 3 at L7
  return { damage, speed, recoil, cooldown: cd, projectileSize, pierce };
    },
    projectileVisual: {
      type: 'bullet',
      // Ballistic look: warm core, faint amber glow, short muzzle trail
      sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_deagle.png'),
      color: '#FFD6A3',
      glowColor: '#FFB066',
      size: 10,
      glowRadius: 12,
      trailColor: 'rgba(255,180,100,0.14)',
      trailLength: 8
    },
    traits: ['Heavy', 'High Damage', 'Strong Recoil', 'Large Caliber'],
    usageTips: [
      'Pick straight corridors: single shots land best at range.',
      'Time shots on elites—knockback buys safety between volleys.',
      'Upgrade cooldown early to smooth damage rhythm.'
    ],
  evolution: { evolvedWeaponType: WeaponType.DUAL_PISTOLS, requiredPassive: 'Crit' },
    isClassWeapon: false,
    knockback: 32 // Desert Eagle: strong knockback
  },
  /** Data Sigil: rotating glyph that emits pulsing shockwaves */
  [WeaponType.DATA_SIGIL]: {
    id: WeaponType.DATA_SIGIL,
    name: 'Data Sigil',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Plant a rotating golden glyph that emits pulsing shockwaves—a programmable killzone.',
    cooldown: 72,
    salvo: 1,
    spread: 0,
    projectile: 'sigil_seed',
    speed: 6.0,
    range: 380,
    maxLevel: 7,
    damage: 28,
    projectileVisual: { type: 'plasma', color: '#FFD700', size: 9, glowColor: '#FFE066', glowRadius: 16, trailColor: 'rgba(255,215,0,0.25)', trailLength: 12 },
    traits: ['Area','Pulses','Control','Scaling'],
    usageTips: [
      'Drop the sigil ahead of enemy flow—pulses clean up as mobs walk in.',
      'Hold ground at chokepoints; overlapping pulses stack damage.',
      'Pair with slows or pulls to keep enemies inside the radius.'
    ],
    isClassWeapon: true,
    knockback: 2,
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [28,36,46,58,72,88,106][idx];
      const cd  = [72,68,64,60,56,52,48][idx];
      const radius = [98,112,126,140,161,182,210][idx];
      const pulses = [2,2,3,3,4,4,5][idx];
      const pulseDmg = [20,50,80,110,140,170,200][idx];
      return { damage: dmg, cooldown: cd, sigilRadius: radius, pulseCount: pulses, pulseDamage: pulseDmg } as any;
    }
  },
  /** Sorcerer Orb: orbiting arcane orb that fires beams periodically */
  [WeaponType.SORCERER_ORB]: {
    id: WeaponType.SORCERER_ORB,
    name: 'Arcane Orb',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'A guiding orb that orbits the caster and periodically fires arcane beams at nearby foes.',
    cooldown: 54,
    salvo: 1,
    spread: 0,
    projectile: 'orb_purple',
    speed: 0,
    range: 280,
    maxLevel: 7,
    damage: 20,
    projectileVisual: { type: 'plasma', color: '#AA77FF', size: 10, glowColor: '#D6C2FF', glowRadius: 20, trailColor: 'rgba(170,119,255,0.25)', trailLength: 10 },
    traits: ['Orbit','Beams','Area','Scaling'],
    isClassWeapon: true,
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const base = [20,26,34,44,56,70,86][idx];
      const cd   = [54,52,50,48,46,44,42][idx];
      const beams= [1,1,2,2,3,3,4][idx];
      const radius=[120,126,132,140,148,156,164][idx];
      return { damage: base, cooldown: cd, beams, orbitRadius: radius } as any;
    }
  },
  /** Evolution: Akimbo Deagle — slow, heavy two-round bursts; higher knockback and damage. */
  [WeaponType.DUAL_PISTOLS]: {
    id: WeaponType.DUAL_PISTOLS,
    name: 'Akimbo Deagle',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_deagle.png'),
    description: 'Twin hand cannons. Alternating left/right heavy rounds; slow cadence, brutal stagger.',
    cooldown: 18, // frames between individual shots in the burst; overall cadence set via getLevelStats
    salvo: 2,     // two bullets per trigger
    // Runner Gun style initial spread; converging aim recalculates per-barrel
    spread: 0.12,
    projectile: 'bullet_cyan',
    speed: 12,
    range: 640,
  maxLevel: 1,
    damage: 36,
    // Bigger bullets for Akimbo Deagle
    projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_deagle.png'), color: '#FFD6A3', size: 13, glowColor: '#FFB066', glowRadius: 16, trailColor: 'rgba(255,180,100,0.18)', trailLength: 12 },
    traits: ['Burst x2','Heavy','High Knockback'],
    isClassWeapon: false,
    knockback: 40,
    usageTips: [
      'Stutter-step between bursts to keep both shots on-line.',
      'Use corridors—dual recoil control matters at range.',
      'Crit builds shine; two hits quickly stack multipliers.'
    ],
    // Single-level evolve: 2× DPS of Desert Eagle (PISTOL) level 7
    getLevelStats(level: number) {
      const base = (WEAPON_SPECS as any)[WeaponType.PISTOL];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 58, cooldown: 38 };
      const baseDpsL7 = (s.damage * 60) / (s.cooldown || 1);
      const targetDps = baseDpsL7 * 2;
      const cooldown = 12; // fast alternating cadence
      const salvo = 2;     // two bullets per trigger
      const damage = Math.max(1, Math.round(targetDps * cooldown / (salvo * 60)));
      const projectileSize = 20;
      const speed = 14;
      const spread = 0.10;
      return { cooldown, salvo, damage, speed, spread, projectileSize, knockback: 48 } as any;
    }
  },
  [WeaponType.SHOTGUN]:  {
    id: WeaponType.SHOTGUN,
    name: 'Shotgun',
    description: 'Close-quarters burst. When all pellets land, it erases crowds.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_shotgun.png'),
    cooldown: 95,
    salvo: 5,
    spread: 0.22,
    projectile: 'bullet_brown',
    speed: 5.2,
    range: 200,
    maxLevel: 7,
    damage: 9,
    projectileVisual: {
      type: 'bullet',
      // Unique pellet sprite (fallback color + glow if not loaded yet)
      sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_shotgun.png'),
      color: '#FF7A00',
      size: 8,
      glowColor: '#FFB066',
      glowRadius: 10,
      trailColor: 'rgba(255,122,0,0.45)',
      trailLength: 8
    },
    traits: ['High Damage', 'Short Range', 'Tight Spread'],
    usageTips: [
      'Fight inside 200px—pellets fall off hard beyond that.',
      'Feather movement to keep the cone tight.',
      'Large targets can eat multiple pellets at once—hug elites.'
    ],
    isClassWeapon: false,
    knockback: 48,
    /**
     * Shotgun scaling philosophy: burst DPS rises sharply if all pellets land, while spread tightens and pellet count increases.
     * Target approximate full-hit DPS milestones (Lv1→Lv7): 60,70,85,105,140,185,240.
     * Damage per pellet derived: damage = (targetDps * cooldown) / (pellets * 60).
     */
    getLevelStats(level: number) {
      const idx = Math.min(Math.max(level,1),7) - 1;
      const cooldownTable = [95,90,85,80,75,70,62];
      const pelletTable   = [5,5,6,6,7,8,8];
      const targetDps     = [60,70,85,105,140,185,240];
      const spreadTable   = [0.22,0.20,0.19,0.18,0.17,0.16,0.145];
      const speedTable    = [5.2,5.3,5.4,5.5,5.6,5.7,5.8];
      const cd = cooldownTable[idx];
      const pellets = pelletTable[idx];
      const dps = targetDps[idx];
      const rawDamage = (dps * cd) / (pellets * 60);
      const damage = Math.max(1, Math.round(rawDamage));
      return {
        cooldown: cd,
        salvo: pellets,
        damage,
        spread: spreadTable[idx],
        speed: speedTable[idx]
      };
    }
  },
  [WeaponType.RAPID]:    {
    id: WeaponType.RAPID,
    name: 'Smart Rifle',
  description: 'Micro\-guided darts that bias toward high\-value targets. Slow to start, relentless once locked.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_smart.png'),
    // Bee-like micro-missiles: slower base fire rate, very high reliability hitting priority target
    cooldown: 42, // frames; improved by level scaling
    salvo: 1,
    spread: 0, // fired straight; guidance handles tracking
  projectile: 'bullet_smart',
    speed: 3.2, // initial forward velocity; homing logic will adjust per frame
  range: 1400, // massive operational range
  maxLevel: 7,
    damage: 18, // base; balanced by slower cadence
    projectileVisual: {
      type: 'bullet',
      color: '#8CFFC7',
      size: 5,
      glowColor: '#FF6666', // subtle red glow accent
      glowRadius: 12,
  trailColor: 'rgba(255,80,80,0.35)', // subtle red trail
      trailLength: 34
    },
    traits: ['Homing','Boss Focus','High Range','Evolution Ready'],
    usageTips: [
      'Maintain proximity—homing stays tighter up close.',
      'Let darts curve; oversteering can cause pathing losses.',
      'Bosses get priority—use it to clean elites during waves.'
    ],
    isClassWeapon: false,
    /**
     * Smart Rifle scaling: lowers cooldown, increases damage & turn rate, adds auxiliary darts (salvo) late.
     * L1→L5 target DPS (ideal single-target uptime): 25, 38, 55, 75, 100
     */
    getLevelStats(level: number) {
      const idx = Math.min(Math.max(level,1),7) - 1;
      const cooldowns = [42, 40, 38, 36, 34, 32, 30];
      const dpsTargets = [25, 38, 55, 75, 100, 125, 150];
      const turnRate   = [0.06,0.07,0.08,0.09,0.10,0.11,0.12][idx];
      const cd = cooldowns[idx];
      const rawDamage = dpsTargets[idx] * cd / 60;
      const damage = Math.max(1, Math.round(rawDamage));
      return { cooldown: cd, damage, turnRate } as any;
    }
  },
  /** Triple Crossbow: three-bolt pierce volley */
  [WeaponType.TRI_SHOT]: {
    id: WeaponType.TRI_SHOT,
    name: 'Triple Crossbow',
    description: 'Triple volley piercing bolts that reward clean lines and long lanes.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_crossbow.png'),
    cooldown: 100,
    salvo: 3,
    spread: 0.155,
    projectile: 'bullet_crossbow',
    speed: 9.4,
    range: 620,
    maxLevel: 7,
    damage: 22,
    projectileVisual: {
      type: 'bullet',
      sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_crossbow.png'),
      color: '#CFA94A',
      size: 22,
      glowColor: '#FFE07A',
      glowRadius: 18,
      trailColor: 'rgba(255,210,110,0.55)',
      trailLength: 28,
      rotationOffset: 0
    },
    traits: ['Piercing','Triple Volley','Long Range','High Base Damage'],
    isClassWeapon: false,
    knockback: 26,
    getLevelStats(level: number) {
      const idx = Math.min(Math.max(level,1),7) - 1;
      const cooldowns = [100, 92, 84, 74, 64, 60, 56];
      const salvos    = [3, 3, 3, 3, 4, 4, 5];
      const spreads   = [0.155, 0.15, 0.145, 0.14, 0.13, 0.125, 0.12];
      const dpsT      = [40, 65, 95, 140, 200, 240, 285];
      const speeds    = [9.4, 9.6, 9.8, 10.0, 10.3, 10.5, 10.8];
      const rangeUp   = [620, 650, 680, 710, 740, 770, 800];
      const pierce    = [1, 2, 3, 4, 5, 5, 6];
      const cd = cooldowns[idx];
      const salvo = salvos[idx];
      const targetDps = dpsT[idx];
      const rawDamage = targetDps * cd / (salvo * 60);
      const damage = Math.max(1, Math.round(rawDamage));
      const projectileSize = 22 + idx * 1.2;
      return { cooldown: cd, salvo, spread: spreads[idx], damage, speed: speeds[idx], range: rangeUp[idx], projectileSize, pierce: pierce[idx] } as any;
    }
  },
  // Replaced legacy Laser Blaster with new high‑power Blaster (Star Wars style)
  [WeaponType.LASER]:    {
    id: WeaponType.LASER,
  name: 'Laser Blaster',
  description: 'Three\-bolt burst of coherent light. Feels like a short, angry beam.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
  cooldown: 70, // slowed fire rate (~0.86 bursts/sec)
    salvo: 3,     // 3 shots per burst
    spread: 0.035, // slight spread between the 3 bolts
  projectile: 'bullet_laserblaster',
  speed: 16,    // slower visible bolts
  range: 1100,  // very long range
  maxLevel: 7,
  damage: 27,   // base per-bolt (L1 derived from DPS target); overridden by getLevelStats
    projectileVisual: {
      // Use bullet sprite for Laser Blaster while retaining short beam vibe via glow + size
      type: 'bullet',
  sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
      color: '#FF3020',
      size: 10,
      glowColor: '#FF6A50',
      glowRadius: 16,
  trailColor: 'rgba(255,70,50,0.35)',
  trailLength: 18
    },
    traits: ['Burst','Long Range','High Damage','Burn DoT','Stacking (3x)'],
    usageTips: [
      'Stagger steps between bursts to land all three bolts.',
      'Aim down long sightlines—bolts stay lethal far out.',
      'Burn stacks reward focus on a single target.'
    ],
    isClassWeapon: false,
  knockback: 3, // reduced to 25% of previous knockback
    getLevelStats(level: number) {
      const idx = Math.min(Math.max(level,1),7)-1;
  const dpsTargets = [70,150,300,500,750,900,1050];
  const cooldowns  = [70,66,62,58,54,52,50];
  const spreadT    = [0.035,0.034,0.033,0.032,0.031,0.0305,0.030];
  const speedT     = [16,16.5,17,17.5,18,18.3,18.6];
      const salvo = 3; // fixed
      const cd = cooldowns[idx];
      const targetDps = dpsTargets[idx];
  const raw = targetDps * cd / (salvo * 60); // per-bolt damage
  const damage = Math.max(1, Math.round(raw));
      return { cooldown: cd, damage, speed: speedT[idx], spread: spreadT[idx] };
    }
  },
  [WeaponType.RICOCHET]: {
    id: WeaponType.RICOCHET,
    name: 'Ricochet',
  description: 'Skips between targets like bad news. Excels at cleanup and chaining.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    cooldown: 70,
    salvo: 1,
    spread: 0.05,
    projectile: 'bullet_cyan',
    speed: 7,
    range: 420,
  maxLevel: 7,
    damage: 12,
  projectileVisual: { type: 'bullet', color: '#0090FF', size: 9, glowColor: '#33B5FF', glowRadius: 14, trailColor: 'rgba(0,144,255,0.55)', trailLength: 10 },
    traits: ['Bounces Between Enemies', 'Locks On Next Target', 'Max 3 Bounces', 'Low Damage'],
    usageTips: [
      'Fire into clumps—the next target is found faster.',
      'The last bounce often misses if spaced—herd enemies closer.',
      'Pairs well with slows to prevent wide skips.'
    ],
    isClassWeapon: false,
    knockback: 18, // Ricochet: moderate knockback
    getLevelStats(level: number){
  // Reworked for 7 levels: broaden bounce potential & extend damage/cooldown curve.
  const baseDamage = 12;
  const endDamage = 72; // L7 target
  const dmg = Math.round(baseDamage + (endDamage - baseDamage) * (level - 1) / 6);
  const baseCd = 70;
  const cd = Math.round(baseCd * (1 - 0.20 * (level - 1) / 6)); // up to 20% faster at L7
  // Bounce scaling: L1=3 .. L7=9
  const bounces = level + 2; // 3..9
  return { damage: dmg, cooldown: cd, bounces };
    }
  },
  [WeaponType.HOMING]: {
    id: WeaponType.HOMING,
    name: 'Kamikaze Drone',
  description: 'Disposable helper that hunts and detonates. Think guided grenade on wings.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_drone.png'),
    cooldown: 120,
    salvo: 1,
    spread: 0,
  projectile: 'bullet_drone',
    speed: 4.9,
    range: 150,
  maxLevel: 7,
    damage: 40, // Base single-target impact at level 1 (higher burst role)
    projectileVisual: {
      type: 'drone',
      color: '#00BFFF',
      size: 14,
      glowColor: '#00BFFF',
      glowRadius: 10,
      trailColor: 'rgba(0,191,255,0.4)',
  trailLength: 18,
  sprite: '/assets/projectiles/bullet_drone.png'
    },
    traits: ['Homing', 'Circles Player', 'Explodes on Contact', 'Kamikaze'],
    usageTips: [
      'Keep moving—drone paths clear when you kite arcs.',
      'Don’t hoard—launch early so respawns keep pressure up.',
      'Leads targets well in open lanes; avoid tight mazeing.'
    ],
    isClassWeapon: false,
    getLevelStats(level: number){
  // Scale damage from 40 (L1) -> 700 (L7) with geometric progression for consistent relative growth.
  const start = 40;
  const end = 700;
  const steps = 7;
  const ratio = Math.pow(end/start, 1/(steps-1));
  const dmg = Math.round(start * Math.pow(ratio, level-1));
  // Cooldown improvement up to 10% faster at L7
  const baseCd = 120;
  const cd = Math.round(baseCd * (1 - 0.10 * (level-1)/6));
  return { damage: dmg, cooldown: cd };
    },
    knockback: 12 // Homing: light knockback
  },
  [WeaponType.RAILGUN]: {
    id: WeaponType.RAILGUN,
    name: 'Railgun',
  description: 'Charge the core, then draw a line through the world. Cataclysm on a timer.',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
    cooldown: 120,
    salvo: 1,
    spread: 0,
    projectile: 'railgun_orb',
    speed: 0,
    range: 900,
  maxLevel: 7,
    damage: 50, // Base damage for Railgun
    projectileVisual: {
      type: 'plasma',
      color: '#00FFFF',
      size: 28,
      glowColor: '#00FFFF',
      glowRadius: 40,
      trailColor: '#FFD700',
      trailLength: 40
    },
    traits: ['Visible Charging Orb', '2s Charge Time', 'Fires Monster Beam', 'High Damage', 'Boss'],
     usageTips: [
       'Pre\-aim during charge—the beam fires where you commit.',
       'Save for elites/bosses; overkill on trash wastes uptime.',
       'Line up multiple targets—the beam pierces everything.'
     ],
     beamVisual: {
       type: 'beam',
       color: '#FFFFFF',
       thickness: 20,
       length: 260,
       glowColor: '#FF00FF',
       glowRadius: 64,
       trailColor: '#FFD700',
       trailLength: 60
     },
     isClassWeapon: false,
     getLevelStats(level: number){
       const idx = Math.min(Math.max(level,1),7)-1;
       // Railgun extreme burst: targeted DPS milestones (implied by long cooldown) scale steeply early then taper.
       const dpsTargets = [100,180,300,450,650,800,950];
       const cooldowns  = [120,116,112,108,104,100,96];
       const beamLengths= [260,270,280,290,300,310,320];
       const thickness  = [20,21,22,23,24,24,25];
       const cd = cooldowns[idx];
       const damage = Math.max(1, Math.round(dpsTargets[idx] * cd / 60));
       return { cooldown: cd, damage, length: beamLengths[idx], thickness: thickness[idx] };
     }
  },
  [WeaponType.PLASMA]:   { id: WeaponType.PLASMA,   name: 'Plasma Core',  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), cooldown: 90,  salvo: 1, spread: 0, projectile: 'bullet_cyan', speed: 6.2, range: 520, maxLevel: 7, damage: 38, projectileVisual: { type: 'plasma', color: '#66CCFF', size: 16, glowColor: '#E6FBFF', glowRadius: 20, trailColor: 'rgba(160,220,255,0.40)', trailLength: 10 }, traits: ['Charge','Detonate','Ion Field','Scaling'], isClassWeapon: false,
  description: 'Overcharge a core and pop it for AoE—leave an ion field that worries survivors and enemies alike.',
    chargeTimeMs: 450,
    overheatThreshold: 0.85,
    heatPerShot: 0.25,
    heatPerFullCharge: 0.42,
    heatDecayPerSec: 0.35,
  fragmentCount: 0,
  // Base detonation radius (used as fallback); per-level overrides supplied via getLevelStats
  explosionRadius: 120,
    ionFieldDamageFrac: 0.12, // per tick (5 ticks)
    ionFieldDurationMs: 600,
    overchargedMultiplier: 2.2,
    chargedMultiplier: 1.8,
    getLevelStats(level: number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [38,52,68,86,108,125,142][idx];
      const cd  = [90,84,78,72,66,62,58][idx];
      const fragments = [3,3,4,4,5,5,6][idx];
      // Scale AoE radius from 45px (L1) up to 120px (L7)
      const radius = [45,60,75,90,105,115,120][idx];
      return { damage: dmg, cooldown: cd, fragments, explosionRadius: radius };
    }
  },
  // Rebalanced Runner Gun: base damage set for ~60 DPS (damage * salvo * 60 / cooldown)
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), description: 'Two‑round burst spray built for motion. Effective only within 360 range—bullets converge from twin barrels for reliable mid‑range clears.', cooldown: 12, salvo: 2, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 360, maxLevel: 7, damage: 6, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), size: 5, trailColor: 'rgba(0,255,255,0.5)', trailLength: 12, glowColor: '#66F2FF', glowRadius: 10 }, traits: ['Spray', 'Fast', 'Scaling'], usageTips: [
    'Stay inside 360 range: weapons won\'t fire beyond it.',
    'Strafe while firing—barrels auto‑converge toward target for tighter hits.',
    'Dash through gaps and keep pressure; salvo ×2 maintains DPS while repositioning.'
  ], isClassWeapon: true, knockback: 5, getLevelStats(level: number) { const baseDamage=6, baseCooldown=12, mult=7.5; const dmg=Math.round(baseDamage*(1+ (level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1- (level-1)*0.32/6)); return { damage:dmg, cooldown:cd }; } },
  
  
  /** Tech Warrior: Tachyon Spear — a phased dash-lance that pierces and leaves a micro-warp trail. */
  [WeaponType.TACHYON_SPEAR]: {
    id: WeaponType.TACHYON_SPEAR,
    name: 'Tachyon Spear',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Phased dash-lance that pierces lines of enemies leaving a warp wake.',
    cooldown: 48,
    salvo: 1,
    spread: 0,
  projectile: 'spear_tachyon',
  // Default (non-volley) Tachyon is slowed for readability; charged volley overrides speed in Player
  speed: 14,
    range: 680,
    maxLevel: 7,
    damage: 42,
  // Visuals tuned to match the cyan/blue spear in the reference image
  projectileVisual: { type: 'laser', color: '#00C8FF', thickness: 4, length: 100, glowColor: '#66E6FF', glowRadius: 18 },
    traits: ['Dash Pierce','Warp Trail','Line Killer'],
    usageTips: [
      'Use short dashes to line up lanes; the spear pierces and rewards precision.',
      'Volley during openings—charged throws extend length and speed for multi-kills.',
      'Reposition between casts to avoid whiffing the lane.'
    ],
    isClassWeapon: true,
    knockback: 18,
    evolution: { evolvedWeaponType: WeaponType.SINGULARITY_SPEAR, requiredPassive: 'Overclock' },
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [42,56,74,96,122,152,186][idx];
      const cd  = [48,46,44,42,40,38,36][idx];
      const len = [100,110,120,130,140,150,160][idx];
  const spd = [14,15,16,17,18,19,20][idx];
      return { damage: dmg, cooldown: cd, length: len, speed: spd } as any;
    }
  },
  /** Evolution: Singularity Spear — dash pierce that implodes, then explodes creating a gravity ring. */
  [WeaponType.SINGULARITY_SPEAR]: {
    id: WeaponType.SINGULARITY_SPEAR,
    name: 'Singularity Spear',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
    description: 'Piercing dash spear that collapses into a mini‑singularity then detonates.',
    cooldown: 64,
    salvo: 1,
    spread: 0,
    projectile: 'spear_singularity',
    // Evolution speed baseline (unchanged); gravity timing handled in BulletManager
    speed: 16,
    range: 720,
    maxLevel: 1,
    damage: 66,
    projectileVisual: { type: 'laser', color: '#C9A6FF', thickness: 5, length: 120, glowColor: '#DCC6FF', glowRadius: 22 },
    traits: ['Dash Pierce','Implode+Explode','Gravity Ring'],
    isClassWeapon: true,
    knockback: 22,
    // Single-level evolve: 2× DPS of Tachyon Spear level 7
    getLevelStats(level:number){
      const base = (WEAPON_SPECS as any)[WeaponType.TACHYON_SPEAR];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 186, cooldown: 36 };
      const salvo = base?.salvo ?? 1;
      const baseDpsL7 = (s.damage * salvo * 60) / (s.cooldown || 1);
      const targetDps = baseDpsL7 * 2;
      const cooldown = 64; // slower cadence; implosion+explosion adds extra AoE value
      const damage = Math.max(1, Math.round(targetDps * cooldown / 60));
      const length = 120;
      const speed = 16;
      return { cooldown, damage, length, speed } as any;
    }
  },
  
  [WeaponType.BIO_TOXIN]: { id: WeaponType.BIO_TOXIN, name: 'Bio Toxin', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), cooldown: 88, salvo: 1, spread: 0, projectile: 'toxin_green', speed: 3.5, range: 260, maxLevel: 7, damage: 0, projectileVisual: { type: 'slime', color: '#00FF00', size: 9, glowColor: '#00FF00', glowRadius: 10 }, traits: ['Poison','Area','Scaling'], usageTips: [
    'Lob into clumps—pools linger and tick multiple enemies.',
    'Upgrade cadence to chain zones; funnel mobs through the slime.',
    'Pair with slows or pulls to keep enemies bathing in damage.'
  ], isClassWeapon: true, getLevelStats(level:number){
    const baseCooldown=88;
    // Faster fire rate with level: cooldown reduces up to ~40% by level 7
    const cd=Math.max(36, Math.round(baseCooldown*(1-(level-1)*0.40/6)));
    // Impact damage intentionally 0; puddles and poison ticks carry the damage model
    return {damage:0, cooldown:cd};
  } },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_smart.png'), cooldown: 32, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 7, damage: 32, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP','Disrupt','Pierces','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=32, baseCooldown=32, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  // Virus bolts silence abilities briefly—great for shutting down dangerous elites.
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), cooldown: 10, salvo: 1, spread: 0.22, projectile: 'bullet_cyan', speed: 7.7, range: 320, maxLevel: 7, damage: 10, projectileVisual: { type: 'bullet', color: '#B8860B', size: 4, glowColor: '#DAA520', glowRadius: 7, trailColor: 'rgba(184,134,11,0.22)', trailLength: 8 }, traits: ['Spray','Rapid','Scaling'], usageTips: [
    'Strafe into arcs—short bursts keep spread under control.',
    'Stay within 320 range to maintain constant fire.',
    'Knockback and slows help hold targets in the stream.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=10, baseCooldown=10, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  // Sustained pressure—think lawnmower, not sniper.
  [WeaponType.PSIONIC_WAVE]: { id: WeaponType.PSIONIC_WAVE, name: 'Psionic Wave', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'), cooldown: 28, salvo: 1, spread: 0, projectile: 'wave_pink', speed: 9.1, range: 500, maxLevel: 7, damage: 28, 
    description: 'Sweeping psionic beam that pierces and briefly marks foes, slowing them and boosting follow-up damage during the mark.',
    projectileVisual: { type: 'beam', color: '#FFC0CB', thickness: 14, length: 120, glowColor: '#FF00FF', glowRadius: 40, trailColor: '#FFD700', trailLength: 40 }, traits: ['Pierces','Area','Slow','Scaling'], usageTips: [
    'Sweep perpendicular to enemy flow—pierce maximizes coverage.',
    'Tag elites/bosses, then pour damage while the psionic mark is active.',
    'Slows, pulls, or chokepoints extend beam uptime and stack marks safely.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=28, baseCooldown=28, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); const bounces = Math.max(0, level); return {damage:dmg, cooldown:cd, bounces}; } },
  
  /** Neural Nomad class weapon: Neural Threader — pierce to anchor enemies into a threaded link that pulses. */
  [WeaponType.NOMAD_NEURAL]: {
    id: WeaponType.NOMAD_NEURAL,
    name: 'Neural Threader',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    cooldown: 64, // slower fire rate; threads do work over time
    salvo: 1,
    spread: 0,
    projectile: 'needle_teal',
    speed: 11.0,
    range: 720,
    maxLevel: 7,
    damage: 26,
    projectileVisual: { type: 'bullet', color: '#26ffe9', size: 6, glowColor: '#26ffe9', glowRadius: 10, trailColor: 'rgba(38,255,233,0.25)', trailLength: 14 },
    traits: ['Thread','Anchors','Pulses','Pierces','Scaling'],
    usageTips: [
      'Pierce through a clump to anchor multiple targets on one thread.',
      'Kite threaded enemies; the link pulses damage over time.',
      'Upgrade anchors to chain more targets and amplify pulses.'
    ],
    isClassWeapon: true,
    // Thread-specific tuning exposed to BulletManager via getLevelStats
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [26,32,40,50,62,76,92][idx];
      const cd  = [64,60,56,52,48,44,40][idx];
  // Increase anchors per level to allow threading more targets as the weapon levels up
  const anchors = [2,3,4,5,6,7,8][idx];
      const threadLifeMs = [3000,3200,3400,3800,4200,4600,5000][idx];
      const pulseIntervalMs = [500,480,460,440,420,400,380][idx];
      const pulsePct = [0.60,0.68,0.76,0.86,0.96,1.04,1.10][idx]; // of base damage per pulse
      return { damage: dmg, cooldown: cd, anchors, threadLifeMs, pulseIntervalMs, pulsePct } as any;
    }
  },
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'), cooldown: 95, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 7, damage: 95, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser','Armor Pierce','Scaling'], usageTips: [
    'Take longer lines of sight—shots pierce and reward straight lanes.',
    'Weave between shots; high alpha damage favors deliberate pacing.',
    'Prioritize elites and bosses—armor pierce makes headway through tanks.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=95, baseCooldown=95, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  /** Void Sniper: Shadow Operative variant of Ghost Sniper. Deals damage over time only. */
  [WeaponType.VOID_SNIPER]: { id: WeaponType.VOID_SNIPER, name: 'Void Sniper', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'), cooldown: 95, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 7, damage: 95, projectileVisual: { type: 'laser', color: '#6A0DAD', thickness: 2, length: 140, glowColor: '#B266FF', glowRadius: 22 }, traits: ['Laser','Paralysis (0.5s)','Damage Over Time','Pierces','Scaling'], usageTips: [
    'Tag elites and kite—DoT stacks on the same target.',
    'Dark tick visuals confirm stacks; keep targets inside beam length.',
    'Pair with slows or knockback to keep afflicted mobs in range.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=95, baseCooldown=95, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); // ticks: 3 over 3000ms
      return {damage:dmg, cooldown:cd, ticks:3, tickIntervalMs:1000}; } },
  // Mech Mortar: extended range + acceleration handled in BulletManager for more epic arc
  [WeaponType.MECH_MORTAR]: { id: WeaponType.MECH_MORTAR, name: 'Mech Mortar', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'), cooldown: 90, salvo: 1, spread: 0, projectile: 'bullet_gold', speed: 7, damage: 90, range: 520, maxLevel: 8, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'), size: 16, glowColor: '#FFD770', glowRadius: 14, trailColor: 'rgba(255,200,80,0.35)', trailLength: 32, rotationOffset: Math.PI/2 }, explosionRadius: 200, traits: ['Heavy','AoE','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=90, baseCooldown=90, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); const radius = Math.round(200 * (1 + 0.12 * (Math.min(Math.max(level,1),8)-1))); return {damage:dmg, cooldown:cd, explosionRadius: radius}; } },
  /** Quantum Halo: persistent rotating orbs around player. Managed separately (cooldown unused). */
  [WeaponType.QUANTUM_HALO]: {
    id: WeaponType.QUANTUM_HALO,
    name: 'Quantum Halo',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    cooldown: 9999,
    salvo: 0,
    spread: 0,
    projectile: 'orb_yellow',
    speed: 0,
    range: 0,
    maxLevel: 7,
  damage: 22,
  knockback: 28, // strong continuous radial push
  // Fast precise variant: smaller core & shorter trail
  projectileVisual: { type: 'plasma', color: '#FFFBEA', size: 8, glowColor: '#FFEFA8', glowRadius: 34, trailColor: 'rgba(255,240,170,0.45)', trailLength: 14 },
    traits: ['Orbit','Persistent','Pulse','Scaling','Defense'],
    description: 'Defensive constellation of blades—orbits that carve and push enemies away.',
    isClassWeapon: false,
    getLevelStats(level: number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const baseDamage = [22,30,42,58,76,95,115][idx];
  // Orb count progression (start with 2 for immediate 'atom' feel): 2,2,3,3,4,4,5
  const orbCount   = [2,2,3,3,4,4,5][idx];
  // Orbit radius: 10% compounding growth per level
  const baseOrbit = 70;
  const orbitRadius = Math.round(baseOrbit * Math.pow(1.10, level-1));
  // Increased base spin speeds for very fast precise orbiting
  // Faster unified orbit speed for higher DPS coverage (clockwise)
  const spinSpeed  = [3.2,3.5,3.8,4.1,4.4,4.7,5.0][idx];
      const pulseDamage= [0,0,0,90,130,170,220][idx];
      return { damage: baseDamage, orbCount, orbitRadius, spinSpeed, pulseDamage } as any;
    }
  }
  ,
  /** New Scavenger weapon: Scrap Lash — returning boomerang blade that pierces and applies armor shred briefly. */
  [WeaponType.SCRAP_LASH]: {
    id: WeaponType.SCRAP_LASH,
    name: 'Scrap Lash',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png'),
    description: 'Hurl a circular blade that carves through foes and swings back to your hand.',
  cooldown: 38,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
  speed: 7.5,
  range: 360,
    maxLevel: 7,
  damage: 36,
  projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png'), size: 18, glowColor: '#FFE28A', glowRadius: 18, trailColor: 'rgba(255,210,110,0.28)', trailLength: 22 },
    traits: ['Returning','Pierce','Armor Shred','Sustain'],
    isClassWeapon: true,
  knockback: 10,
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
  const damage = [36,46,60,78,100,126,156][idx];
  const cooldown = [38,36,34,32,30,28,26][idx];
  const speed = [7.5,7.8,8.1,8.4,8.7,9.0,9.3][idx];
  const range = [360,380,400,420,440,460,480][idx];
  const pierce = [999,999,999,999,999,999,999][idx];
  const projectileSize = [18,18,19,20,21,22,24][idx];
  return { damage, cooldown, speed, range, pierce, projectileSize } as any;
    }
  },
  /** Evolution: timed 360° grinder with stronger knockback and DoT-like multi-hit */
  [WeaponType.INDUSTRIAL_GRINDER]: {
    id: WeaponType.INDUSTRIAL_GRINDER,
    name: 'Industrial Grinder',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png'),
    description: 'Sustained orbiting grinder that repels and tears through enemies.',
    cooldown: 160,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 0,
    range: 140,
    maxLevel: 1,
    damage: 20,
  // Use explicit sprite path so UI can load it directly
  projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png'), size: 20, glowColor: '#FFE28A', glowRadius: 28 },
    traits: ['Melee','Sustained Orbit','Strong Knockback'],
    isClassWeapon: true,
    knockback: 95,
    // Single-level evolve: 2× DPS of base weapon level 7 (hardcoded values)
    getLevelStats(level:number){
      // Base weapon level 7 stats: damage 225, cooldownMs 660
      const baseDpsL7 = (225 * 1000) / 660; // ~340.9 DPS
      const targetDps = baseDpsL7 * 2; // ~681.8 DPS
      const cooldown = 160; // frames per activation
      const cooldownMs = Math.round(cooldown * (1000/60));
      const damage = Math.max(1, Math.round(targetDps * cooldownMs / 1000));
      const durationMs = 1300;
      const orbitRadius = 140;
      return { cooldown, cooldownMs, damage, durationMs, orbitRadius } as any;
    }
  }
  
};

// (Path normalization now handled at declaration via AssetLoader.normalizePath)

/**
 * Cooldown normalization shim (non-breaking):
 * - Ensures every WeaponSpec has cooldownMs derived from frames when absent.
 * - Wraps getLevelStats to always include both cooldown (frames) and cooldownMs (ms).
 *   This is UI-only and does not change gameplay logic that still consumes frames.
 */
(() => {
  const MS_PER_FRAME = 1000 / 60;
  const toMs = (frames?: number) => (typeof frames === 'number' ? Math.round(frames * MS_PER_FRAME) : undefined);
  const toFrames = (ms?: number) => (typeof ms === 'number' ? Math.round(ms / MS_PER_FRAME) : undefined);

  for (const k in WEAPON_SPECS) {
    if (!Object.prototype.hasOwnProperty.call(WEAPON_SPECS, k)) continue;
    const spec = (WEAPON_SPECS as any)[k] as WeaponSpec;
    // Base spec: fill cooldownMs if missing
    if (spec && typeof spec.cooldownMs !== 'number') {
      const ms = toMs(spec.cooldown);
      if (typeof ms === 'number') spec.cooldownMs = ms;
    }
    // Wrap getLevelStats to ensure both cooldown and cooldownMs are present on returned map
    if (spec && typeof spec.getLevelStats === 'function') {
      const orig = spec.getLevelStats.bind(spec);
      spec.getLevelStats = (level: number) => {
        const out = orig(level) || {};
        const hasMs = typeof (out as any).cooldownMs === 'number';
        const hasFrames = typeof (out as any).cooldown === 'number';
        if (!hasMs && hasFrames) {
          (out as any).cooldownMs = toMs((out as any).cooldown);
        } else if (hasMs && !hasFrames) {
          (out as any).cooldown = toFrames((out as any).cooldownMs);
        }
        return out;
      };
    }
  }
})();
