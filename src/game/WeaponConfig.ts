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
  /** Optional minimum level required for the passive; defaults to 1 if omitted */
  minPassiveLevel?: number;
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
    getLevelStats(level:number){
      // Balance target: ~2.2× Minigun L7 DPS concentrated in a short beam tick stream.
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
  // Evolve into a sustained emitter when you enlarge zones
  evolution: { evolvedWeaponType: WeaponType.RUNIC_ENGINE, requiredPassive: 'Area Up' },
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
  /** Runic Engine — Evolution of Data Sigil: sustained rotating engine with higher pulse density and chaining. */
  [WeaponType.RUNIC_ENGINE]: {
    id: WeaponType.RUNIC_ENGINE,
    name: 'Runic Engine',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'An anchored runic engine that emits dense, chaining shockwaves. Holds space with brutal rhythm.',
    cooldown: 90,
    salvo: 1,
    spread: 0,
    projectile: 'sigil_seed',
    speed: 0,
    range: 420,
    maxLevel: 1,
    damage: 0,
    projectileVisual: { type: 'plasma', color: '#FFD700', size: 11, glowColor: '#FFF08A', glowRadius: 24 },
    traits: ['Area','Pulses','Chain','Evolution'],
    isClassWeapon: true,
    knockback: 4,
    getLevelStats(level:number){
      // Anchor evolved power to Data Sigil L7 pulses budget and multiply for evolution
      const base = (WEAPON_SPECS as any)[WeaponType.DATA_SIGIL];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { cooldown: 48, pulseCount: 5, pulseDamage: 200 } as any;
      const basePerCast = (s.pulseCount || 5) * (s.pulseDamage || 200);
      const baseDps = (basePerCast * 60) / Math.max(1, (s.cooldown || 48));
      const targetDps = baseDps * 1.6; // evolution budget
      const cooldown = 90; // slower cadence; pulses are denser and stronger
      const pulseCount = 8; // more pulses per engine cycle
      const pulseDamage = Math.max(1, Math.round((targetDps * cooldown) / (pulseCount * 60)));
      const sigilRadius = 240;
      const chain = 2;
      return { cooldown, sigilRadius, pulseCount, pulseDamage, chain } as any;
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
  // Evolve into a conflux that slows and amplifies control when you bring your own Slow Aura
  evolution: { evolvedWeaponType: WeaponType.ARCANE_CONFLUX, requiredPassive: 'Slow Aura' },
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const base = [20,26,34,44,56,70,86][idx];
      const cd   = [54,52,50,48,46,44,42][idx];
      const beams= [1,1,2,2,3,3,4][idx];
      const radius=[120,126,132,140,148,156,164][idx];
      return { damage: base, cooldown: cd, beams, orbitRadius: radius } as any;
    }
  },
  /** Arcane Conflux — Evolution of Sorcerer Orb: clustered orbit with heavy slow and frequent beams. */
  [WeaponType.ARCANE_CONFLUX]: {
    id: WeaponType.ARCANE_CONFLUX,
    name: 'Arcane Conflux',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'A dense cluster of orbs forming a slowing field that lashes enemies with beams.',
    cooldown: 60,
    salvo: 1,
    spread: 0,
    projectile: 'orb_purple',
    speed: 0,
    range: 300,
    maxLevel: 1,
    damage: 0,
    projectileVisual: { type: 'plasma', color: '#C39BFF', size: 11, glowColor: '#EBD6FF', glowRadius: 26 },
    traits: ['Orbit','Heavy Slow','Beams','Evolution'],
    isClassWeapon: true,
    getLevelStats(level:number){
      // Anchor evolved to Sorcerer Orb L7 and multiply. Allocate into beams per trigger.
      const base = (WEAPON_SPECS as any)[WeaponType.SORCERER_ORB];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 86, cooldown: 42, beams: 4 } as any;
      const baseDps = (s.damage * 60) / Math.max(1, (s.cooldown || 42));
      const targetDps = baseDps * 1.7; // evolved boost
      const cooldown = 60;
      const beams = 4;
      const orbitRadius = 120;
      const slowStrength = 0.35;
      const pulseDamage = Math.max(1, Math.round((targetDps * cooldown) / (beams * 60)));
      return { cooldown, beams, orbitRadius, slowStrength, pulseDamage } as any;
    }
  },

  /** Glyph Compiler — new Data Sorcerer class weapon: compile rune shards into a glyph that fires predictive lances. */
  [WeaponType.GLYPH_COMPILER]: {
    id: WeaponType.GLYPH_COMPILER,
    name: 'Glyph Compiler',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Compile runes into a predictive array—fires lances along computed enemy paths.',
  cooldown: 40,
    salvo: 1,
    spread: 0,
    projectile: 'laser_white',
    speed: 18,
    range: 760,
    maxLevel: 7,
    damage: 26,
    // Yellow/golden laser theme to match Data Sorcerer palette
    projectileVisual: {
      type: 'laser',
      color: '#FFD700',
      thickness: 2,
      length: 90,
      glowColor: '#FFF08A',
      glowRadius: 18,
      trailColor: 'rgba(255,215,0,0.30)',
      trailLength: 14
    },
  traits: ['Predictive','Pierce','Paralysis','Damage Over Time','Crit','Scaling'],
    usageTips: [
      'Kite to lengthen enemy trajectories; predictive lances thrive on straight lines.',
      'Stack Crit for burst—compiled shots seek high‑value targets first.'
    ],
    isClassWeapon: true,
    evolution: { evolvedWeaponType: WeaponType.ORACLE_ARRAY, requiredPassive: 'Crit' },
    getLevelStats(level:number){
    const idx = Math.min(Math.max(level,1),7)-1;
  // Buff 2: stronger damage and slightly faster cadence to raise PF
  const dmg = [44,58,76,100,130,170,260][idx];
  const cd  = [34,32,30,28,26,24,20][idx];
  // Penetration increases by +1 each level (L1..L7 => 1..7)
  const pierce = [1,2,3,4,5,6,7][idx];
      const critMul = [1.5,1.6,1.7,1.8,1.9,2.0,2.1][idx];
      return { damage: dmg, cooldown: cd, pierce, critMultiplier: critMul } as any;
    }
  },
  /** Oracle Array — Evolution of Glyph Compiler: multi‑lane predictive fire with innate crit amp. */
  [WeaponType.ORACLE_ARRAY]: {
    id: WeaponType.ORACLE_ARRAY,
    name: 'Oracle Array',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'A lattice that projects predictive lances across multiple lanes with amplified critical strikes.',
    cooldown: 50,
    salvo: 1,
    spread: 0,
    projectile: 'laser_white',
    speed: 20,
    range: 900,
    maxLevel: 1,
    damage: 0,
    // Oracle Array adopts a brighter golden-white for evolved identity
    projectileVisual: {
      type: 'laser',
      color: '#FFEFA8',
      thickness: 2,
      length: 110,
      glowColor: '#FFE066',
      glowRadius: 22,
      trailColor: 'rgba(255,224,102,0.35)',
      trailLength: 16
    },
  traits: ['Predictive','Multi‑lane','Paralysis','Damage Over Time','Crit Amp','Evolution'],
    isClassWeapon: true,
    getLevelStats(level:number){
      // Anchor to Glyph L7 and rein in the evolved budget to avoid runaway PF in crowds.
      const base = (WEAPON_SPECS as any)[WeaponType.GLYPH_COMPILER];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 26, cooldown: 42 } as any;
    const baseDpsL7 = (s.damage * 60) / Math.max(1, (s.cooldown || 42));
  const targetDps = baseDpsL7 * 0.82; // nudge down to tighten around 1500 PF
  const cooldown = 60; // modestly slower cadence
      const lanes = 3; // multi‑lane identity
      const pierce = 3; // slightly lower pierce than base plan
      const critMultiplier = 2.2;
      const damage = Math.max(1, Math.round((targetDps * cooldown) / 60));
      return { cooldown, lanes, pierce, critMultiplier, damage } as any;
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
  // Bigger bullets for Akimbo Deagle (sprite rotated 180° to match travel direction)
  projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_deagle.png'), color: '#FFD6A3', size: 13, glowColor: '#FFB066', glowRadius: 16, trailColor: 'rgba(255,180,100,0.18)', trailLength: 12, rotationOffset: Math.PI },
    traits: ['Burst x2','Heavy','High Knockback'],
    isClassWeapon: false,
    knockback: 40,
    usageTips: [
      'Stutter-step between bursts to keep both shots on-line.',
      'Use corridors—dual recoil control matters at range.',
      'Crit builds shine; two hits quickly stack multipliers.'
    ],
    // Single-level evolve: ~1.7× DPS of Desert Eagle (PISTOL) level 7
    getLevelStats(level: number) {
      const base = (WEAPON_SPECS as any)[WeaponType.PISTOL];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 58, cooldown: 38 };
      const baseDpsL7 = (s.damage * 60) / (s.cooldown || 1);
      const targetDps = baseDpsL7 * 1.7;
      const cooldown = 14; // still fast alternating cadence
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
  evolution: { evolvedWeaponType: WeaponType.SERPENT_CHAIN, requiredPassive: 'Area Up' },
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
  /** Evolution: Serpent Chain — agile chain-bullet that ramps damage per bounce and finishes with a coiling burst. */
  [WeaponType.SERPENT_CHAIN]: {
    id: WeaponType.SERPENT_CHAIN,
    name: 'Serpent Chain',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Binds the crowd. Each bounce ramps damage; the last target detonates a coiling burst.',
    cooldown: 58, // a touch faster than base Ricochet L7
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 8.2,
    range: 520,
    maxLevel: 1,
    damage: 16,
  projectileVisual: { type: 'bullet', color: '#7EF1FF', size: 7, glowColor: '#A8F7FF', glowRadius: 14, trailColor: 'rgba(126,241,255,0.45)', trailLength: 18, rotationOffset: Math.PI },
    traits: ['Bounce Ramp','Finisher Burst','Crowd Control'],
    isClassWeapon: false,
    knockback: 16,
    getLevelStats(level: number){
      // Target: ~2.2x DPS of Ricochet L7 assuming full bounce chain and finisher value
      const base = (WEAPON_SPECS as any)[WeaponType.RICOCHET];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 72, cooldown: 56, bounces: 9 };
      const baseDpsL7 = (s.damage * 60) / (s.cooldown || 1);
      const targetDps = baseDpsL7 * 2.2;
      const cd = 58;
      const dmg = Math.max(1, Math.round(targetDps * cd / 60));
      // Bounce plan: keep 9 bounces; ramp 10% damage per bounce, finisher burst ~120% of base
      const bounces = 9;
      const ramp = 0.10;
      const finisherFrac = 1.20;
      return { cooldown: cd, damage: dmg, bounces, ramp, finisherFrac } as any;
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
  sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_drone.png')
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
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), description: 'Single‑round spray built for motion. Effective only within 360 range—tight spread for reliable mid‑range clears.', cooldown: 6, salvo: 1, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 360, maxLevel: 7, damage: 6, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), size: 5, trailColor: 'rgba(0,255,255,0.55)', trailLength: 16, glowColor: '#66F2FF', glowRadius: 12 }, traits: ['Spray', 'Fast', 'Scaling'], usageTips: [
    'Stay inside 360 range: weapons won\'t fire beyond it.',
    'Strafe while firing—barrels auto‑converge toward target for tighter hits.',
  'Dash through gaps and keep pressure; maintain DPS while repositioning.'
  ], isClassWeapon: true, knockback: 5, evolution: { evolvedWeaponType: WeaponType.RUNNER_OVERDRIVE, requiredPassive: 'Fire Rate' }, getLevelStats(level: number) { const baseDamage=6, baseCooldown=6, mult=8.2; const lvl=Math.min(Math.max(level,1),7); const dmg=Math.round(baseDamage*(1+ (lvl-1)*(mult-1)/6)); const cd=Math.max(3, Math.round(baseCooldown*(1- (lvl-1)*0.38/6))); const salvo = [1,1,1,1,1,2,2][lvl-1]; return { damage:dmg, cooldown:cd, salvo }; } },
  
  
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
  evolution: { evolvedWeaponType: WeaponType.SINGULARITY_SPEAR, requiredPassive: 'Speed Boost' },
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
  // Buff 2: increase damage and slightly faster cadence to reach ~500 PF band
  const dmg = [80,104,136,176,228,288,380][idx];
  const cd  = [38,36,34,32,30,28,24][idx];
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
    // Single-level evolve: ~1.35× DPS of Tachyon Spear level 7
    getLevelStats(level:number){
      const base = (WEAPON_SPECS as any)[WeaponType.TACHYON_SPEAR];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 186, cooldown: 36 };
      const salvo = base?.salvo ?? 1;
      const baseDpsL7 = (s.damage * salvo * 60) / (s.cooldown || 1);
  const targetDps = baseDpsL7 * 1.38; // slight DPS increase to hit ~1500 PF
  const cooldown = 68; // slight cadence increase to lift PF into band
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
  ], isClassWeapon: true, evolution: { evolvedWeaponType: WeaponType.LIVING_SLUDGE, requiredPassive: 'Area Up' }, getLevelStats(level:number){
    const baseCooldown=88;
    // Buff 2: slightly faster cadence and multi-puddle spawns via salvo growth
    const cd=Math.max(24, Math.round(baseCooldown*(1-(level-1)*0.58/6)));
    const salvo=[1,1,1,2,2,2,3][Math.min(Math.max(level,1),7)-1];
    // Impact damage intentionally 0; puddles and poison ticks carry the damage model
    return {damage:0, cooldown:cd, salvo};
  } },
  
  /** Bio Engineer evolution: Living Sludge — viscous pools that flow toward enemies, merge to grow, and apply heavy slow. */
  [WeaponType.LIVING_SLUDGE]: {
    id: WeaponType.LIVING_SLUDGE,
    name: 'Living Sludge',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Viscous toxic globs that crawl toward crowds, merging into bigger, deadlier pools that heavily slow and corrode.',
  cooldown: 96,
  // Triple glob: center + two adjacent (wider fan)
  salvo: 3,
  spread: 0.44,
    projectile: 'sludge_green',
    speed: 3.2,
    range: 240,
    maxLevel: 1,
    damage: 0,
    // Slimy/gummy visual baseline
    projectileVisual: { type: 'slime', color: '#66FF6A', size: 11, glowColor: '#8BFF8E', glowRadius: 14 },
    traits: ['Poison','Heavy Slow','Merges','Flows','Evolution'],
    isClassWeapon: true,
    knockback: 4,
    // Single-level evolve: runtime handles flow/merge; Bio Toxin DoT tables remain in EnemyManager
    getLevelStats(level:number){
      // Slightly slower cadence to reduce puddle density (minor speedup)
      return { damage: 0, cooldown: 130, salvo: 2, projectileSize: 11, speed: 3.2 } as any;
    }
  },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_smart.png'), cooldown: 30, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 7, damage: 36, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP','Disrupt','Pierces','Scaling'], isClassWeapon: true, evolution: { evolvedWeaponType: WeaponType.HACKER_BACKDOOR, requiredPassive: 'Fire Rate' }, getLevelStats(level:number){ const baseDamage=36, baseCooldown=30, mult=8.0; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.36/6)); return {damage:dmg, cooldown:cd}; } },
  // Virus bolts silence abilities briefly—great for shutting down dangerous elites.
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), cooldown: 9, salvo: 1, spread: 0.22, projectile: 'bullet_cyan', speed: 7.7, range: 320, maxLevel: 7, damage: 12, projectileVisual: { type: 'bullet', color: '#B8860B', size: 4, glowColor: '#DAA520', glowRadius: 7, trailColor: 'rgba(184,134,11,0.22)', trailLength: 8 }, traits: ['Spray','Rapid','Scaling'], usageTips: [
    'Strafe into arcs—short bursts keep spread under control.',
    'Stay within 320 range to maintain constant fire.',
    'Knockback and slows help hold targets in the stream.'
  ], isClassWeapon: true, evolution: { evolvedWeaponType: WeaponType.GUNNER_LAVA_MINIGUN, requiredPassive: 'Fire Rate', minPassiveLevel: 1 }, getLevelStats(level:number){ const baseDamage=12, baseCooldown=9, mult=8.0; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.max(3, Math.round(baseCooldown*(1-(level-1)*0.40/6))); return {damage:dmg, cooldown:cd}; } },
  // Sustained pressure—think lawnmower, not sniper.
  [WeaponType.PSIONIC_WAVE]: { id: WeaponType.PSIONIC_WAVE, name: 'Psionic Wave', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'), cooldown: 22, salvo: 1, spread: 0, projectile: 'wave_pink', speed: 9.6, range: 560, maxLevel: 7, damage: 34, 
    description: 'Sweeping psionic beam that pierces and briefly marks foes, slowing them and boosting follow-up damage during the mark.',
  projectileVisual: { type: 'beam', color: '#FFC0CB', thickness: 12, length: 132, glowColor: '#FF00FF', glowRadius: 38, trailColor: '#FFD700', trailLength: 40 }, traits: ['Pierces','Area','Slow','Scaling'], usageTips: [
    'Sweep perpendicular to enemy flow—pierce maximizes coverage.',
    'Tag elites/bosses, then pour damage while the psionic mark is active.',
    'Slows, pulls, or chokepoints extend beam uptime and stack marks safely.'
  ], isClassWeapon: true, evolution: { evolvedWeaponType: WeaponType.RESONANT_WEB, requiredPassive: 'Regen' }, getLevelStats(level:number){
    // Buff: stronger damage growth and slightly faster top-end cadence
    const idx = Math.min(Math.max(level,1),7)-1;
  const damageTbl   = [40,50,64,82,104,130,160][idx];
  const cooldownTbl = [22,21,19,18,17,16,14][idx];
    const bounceTbl   = [1,2,3,4,5,6,7][idx];
  const pierceTbl   = [1,1,2,2,2,3,3][idx];
  const lenTbl      = [136,140,144,148,152,156,160][idx];
    const thickTbl    = [12,12,12,12,11,11,10][idx];
    return { damage: damageTbl, cooldown: cooldownTbl, bounces: bounceTbl, pierce: pierceTbl, length: lenTbl, thickness: thickTbl } as any;
  } },

  /** Evolution for Psionic Weaver: Resonant Web — orbiting strands that pulse and apply marks */
  [WeaponType.RESONANT_WEB]: {
    id: WeaponType.RESONANT_WEB,
    name: 'Resonant Web',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Orbiting psionic strands that weave a web, pulsing damage and amplifying marked targets.',
    cooldown: 160,
    salvo: 0,
    spread: 0,
    projectile: 'orb_purple',
    speed: 0,
    range: 0,
    maxLevel: 1,
    damage: 24,
  // Smaller, punchier orb visuals for a more energetic feel
  projectileVisual: { type: 'plasma', color: '#FF66FF', size: 8, glowColor: '#FF99FF', glowRadius: 30, trailColor: 'rgba(255,102,255,0.25)', trailLength: 12 },
    traits: ['Orbit','Pulses','Mark Synergy','Evolution'],
    isClassWeapon: true,
    knockback: 6,
    // Single-level evolve: tuned web for evolved target PF ~1500
    getLevelStats(level: number){
      // Small buff to reach ~1500 PF without runaway
      const strands = 4;
      const pulseIntervalMs = 310;
      const pulseDamage = 76;
      const orbitRadius = 135;
      return { damage: pulseDamage, cooldown: 160, strands, pulseIntervalMs, pulseDamage, orbitRadius } as any;
    }
  },
  /** Rogue Hacker evolution: Backdoor Rootkit — zones gain longer paralysis and on-death chain spawns; periodic trace pings add bonus damage. */
  [WeaponType.HACKER_BACKDOOR]: {
    id: WeaponType.HACKER_BACKDOOR,
    name: 'Backdoor Rootkit',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_smart.png'),
    description: 'Compromised systems propagate—the virus nests deeper, chaining new breaches on kill and hard-locking targets longer.',
    cooldown: 26,
    salvo: 1,
    spread: 0,
    projectile: 'virus_orange',
    speed: 9.2,
    range: 420,
    maxLevel: 1,
    damage: 44,
  projectileVisual: { type: 'plasma', color: '#FF1333', size: 11, glowColor: '#FF3355', glowRadius: 12 },
    traits: ['EMP','Chain','Hard Lock','Evolution'],
    isClassWeapon: true,
    getLevelStats(level:number){
      // Boost zone to lift PF toward target while avoiding previous extremes
      const base = (WEAPON_SPECS as any)[WeaponType.HACKER_VIRUS];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 160, cooldown: 21 } as any;
      const baseDps = (s.damage * 60) / Math.max(1, (s.cooldown || 32));
      const targetDps = baseDps * 2.0;
      const cooldown = 26; // keep reliable seeding cadence
      const damage = Math.max(1, Math.round((targetDps * cooldown) / 60 * 0.10));
      // Zone params
      const zoneRadius = 180;
      const zoneLifeMs = 3000;
      const paralyzeMs = 2100;
      const dotTicks = 6;
      const dotTickMs = 460;
      const chainCount = 3;
      const chainRadius = 230;
      const chainDelayMs = 70;
      const tracePulseMs = 820;
      const tracePulseFrac = 0.50;
      const vulnFrac = 0.32;
    const vulnLingerMs = 650;
  const sustainDps = 615; // per target, per second (tiny bump)
      const sustainTickMs = 110;
      return { cooldown, damage, zoneRadius, zoneLifeMs, paralyzeMs, dotTicks, dotTickMs, chainCount, chainRadius, chainDelayMs, tracePulseMs, tracePulseFrac, vulnFrac, vulnLingerMs, sustainDps, sustainTickMs } as any;
    }
  },
  
  /** Neural Nomad class weapon: Neural Threader — pierce to anchor enemies into a threaded link that pulses. */
  [WeaponType.NOMAD_NEURAL]: {
    id: WeaponType.NOMAD_NEURAL,
    name: 'Neural Threader',
  icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
  cooldown: 60, // moderate fire rate; threads do work over time (tuned)
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
  // Evolve into a Neural Nexus when you bring control to the field
  evolution: { evolvedWeaponType: WeaponType.NEURAL_NEXUS, requiredPassive: 'Slow Aura' },
    // Thread-specific tuning exposed to BulletManager via getLevelStats
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
  // Rebalance: tone down pulses and cadence to land near 550 PF band overall
  const dmg = [28,36,48,62,80,102,126][idx];
  const cd  = [58,54,50,46,44,42,40][idx];
  // Keep anchors reasonable; extend pulse interval and reduce per-pulse fraction
  const anchors = [2,3,4,5,6,7,8][idx];
    const threadLifeMs = [3000,3200,3400,3600,3800,4200,4600][idx];
  const pulseIntervalMs = [580,560,540,520,500,480,460][idx];
  const pulsePct = [0.55,0.62,0.70,0.78,0.88,0.98,1.10][idx]; // of base damage per pulse
      return { damage: dmg, cooldown: cd, anchors, threadLifeMs, pulseIntervalMs, pulsePct } as any;
    }
  },
  /** Neural Nexus — Evolution of Neural Threader: auto-links primed enemies into a persistent network that detonates on expiry. */
  [WeaponType.NEURAL_NEXUS]: {
    id: WeaponType.NEURAL_NEXUS,
    name: 'Neural Nexus',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Autonomous neural mesh that snaps to primed foes, pulsing harder and detonating on collapse.',
    cooldown: 56,
    salvo: 1,
    spread: 0,
    projectile: 'needle_teal',
    speed: 12.5,
    range: 820,
    maxLevel: 1,
    damage: 0,
    projectileVisual: { type: 'bullet', color: '#26ffe9', size: 7, glowColor: '#9ffcf6', glowRadius: 16, trailColor: 'rgba(38,255,233,0.30)', trailLength: 16 },
    traits: ['Thread','Autosnap','Pulses','Expiry Detonation','Evolution'],
    isClassWeapon: true,
    getLevelStats(level:number){
      // Modest buff to approach PF target
      const base = (WEAPON_SPECS as any)[WeaponType.NOMAD_NEURAL];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 92, cooldown: 40, pulsePct: 1.10 } as any;
      const baseDpsL7 = (s.damage * 60) / Math.max(1, (s.cooldown || 40));
  const targetDps = baseDpsL7 * 0.76; // slight trim to land nearer ~1500 PF
      const cooldown = 60;
      const anchors = 8;
      const threadLifeMs = 4900;
      const pulseIntervalMs = 470;
      const pulsePct = 1.0;
      const detonateFrac = 1.25;
      const damage = Math.max(1, Math.round((targetDps * cooldown) / 60));
      return { cooldown, damage, anchors, threadLifeMs, pulseIntervalMs, pulsePct, detonateFrac } as any;
    }
  },
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'), cooldown: 60, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 7, damage: 50, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser','Armor Pierce','Scaling'], evolution: { evolvedWeaponType: WeaponType.SPECTRAL_EXECUTIONER, requiredPassive: 'Vision' }, usageTips: [
    'Take longer lines of sight—shots pierce and reward straight lanes.',
    'Weave between shots; high alpha damage favors deliberate pacing.',
    'Prioritize elites and bosses—armor pierce makes headway through tanks.'
  ], isClassWeapon: true, getLevelStats(level:number){
      // Target explicit single-target DPS milestones AFTER global class 0.6x:
      // L1=50 DPS, L7=700 DPS. Because class weapons are multiplied by 0.6 at runtime,
      // we set pre-multiplier targets = desired / 0.6 (≈1.6667×) here.
      const lvl = Math.max(1, Math.min(7, level));
      const cdTable =    [60, 58, 56, 54, 52, 50, 48]; // frames
      // Pre-multiplier DPS to achieve 50/700 after 0.6x: scale former rails by 1/0.6
      const dpsTargets = [83,183,350,600,867,1033,1167]; // ≈ (50..700)/0.6
      const cd = cdTable[lvl-1];
      const damage = Math.max(1, Math.round(dpsTargets[lvl-1] * cd / 60));
      // Slight range/speed polish with level (cosmetic)
      const speed = 22.4 + (lvl-1) * 0.3;
      return { damage, cooldown: cd, speed } as any;
    } },
  /** Spectral Executioner — Evolution of Ghost Sniper: Marks targets; on mark expiry or death triggers an on‑target execution pulse that can chain. */
  [WeaponType.SPECTRAL_EXECUTIONER]: {
    id: WeaponType.SPECTRAL_EXECUTIONER,
    name: 'Spectral Executioner',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
    description: 'Tag foes with a specter mark; when it ends, a golden shockwave executes the target and chains.',
    usageTips: [
      'First target hit is marked; when the mark ends, an on-target golden pulse executes it.',
      'Marks can chain to nearby marked targets as smaller pulses. Focus fire to set up multi-kills.',
  'Crit as the gate synergizes—stack crit to amplify execute windows.'
    ],
  cooldown: 50, // faster cadence to meet single-target DPS goal
    salvo: 1,
    spread: 0,
    projectile: 'sniper_white',
    speed: 22.4,
    range: 1200,
    maxLevel: 1,
    damage: 0,
    projectileVisual: { type: 'laser', color: '#E6F7FF', thickness: 2, length: 140, glowColor: '#C0F0FF', glowRadius: 20 },
    traits: ['Laser','Mark','Execute','Chain','Pierces','Evolution'],
    isClassWeapon: true,
    getLevelStats(level:number){
      // Evolved single-target DPS target: 1200 DPS AFTER 0.6x class nerf.
      // Set pre-multiplier target to 1200 / 0.6 = 2000 DPS.
      const targetDps = 2000;
      const cooldown = 50; // frames
      const baseDamage = Math.max(1, Math.round((targetDps * cooldown) / 60));
      // Execution parameters balanced around single-target budget; AoE/chain is gravy not primary DPS.
      const markMs = 900;
      const execMult = 1.25;
      const chainCount = 1; // limit chaining so single-target stays primary
      const chainMult = 0.40;
      return { cooldown, damage: baseDamage, markMs, execMult, chainCount, chainMult } as any;
    }
  },
  /** Void Sniper: Shadow Operative variant of Ghost Sniper. Deals damage over time only. */
  [WeaponType.VOID_SNIPER]: { id: WeaponType.VOID_SNIPER, name: 'Void Sniper', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'), cooldown: 92, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 7, damage: 102, projectileVisual: { type: 'laser', color: '#6A0DAD', thickness: 2, length: 140, glowColor: '#B266FF', glowRadius: 22 }, traits: ['Laser','Paralysis (0.5s)','Damage Over Time','Pierces','Scaling','Evolution'], usageTips: [
    'Tag elites and kite—DoT stacks on the same target.',
    'Dark tick visuals confirm stacks; keep targets inside beam length.',
    'Pair with slows or knockback to keep afflicted mobs in range.'
  ], isClassWeapon: true,
  evolution: { evolvedWeaponType: WeaponType.BLACK_SUN, requiredPassive: 'Vision' } as any,
  getLevelStats(level:number){ const baseDamage=106, baseCooldown=90, mult=8.4; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.40/6)); // ticks: 3 over 3000ms
      return {damage:dmg, cooldown:cd, ticks:3, tickIntervalMs:1000}; } },
  /** Black Sun — Evolution of Void Sniper: Seeds void orbs that slow and tick; they collapse after a short fuse with a pull and a pulse. */
  [WeaponType.BLACK_SUN]: {
    id: WeaponType.BLACK_SUN,
    name: 'Black Sun',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
    description: 'Unleashes five converging void beams at once—each locks a different target and sears it.',
    usageTips: [
      'Stand still to steady your aim, then release a five-target snipe volley.',
      'Beams won’t stack on the same enemy—position to tag separate elites.',
      'Damage scales with Void Sniper’s apex—synergizes with crit and damage boosts.'
    ],
    cooldown: 95,
    salvo: 1,
    spread: 0,
    projectile: 'sniper_white',
    speed: 22.4,
    range: 1200,
    maxLevel: 1,
    damage: 0,
    projectileVisual: { type: 'laser', color: '#4B0082', thickness: 2, length: 140, glowColor: '#B266FF', glowRadius: 24 },
  traits: ['Laser','Seed','Slow','Collapse','AoE','Evolution'],
    isClassWeapon: true,
  // Evolution is defined on Void Sniper; Black Sun is the evolved weapon.
  getLevelStats(level:number){
      // Buff from under-target result to reach ~1500 PF
      const base = (WEAPON_SPECS as any)[WeaponType.VOID_SNIPER];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 220, cooldown: 60, ticks: 3 } as any;
      const baseDpsL7 = (s.damage * 60) / Math.max(1, (s.cooldown || 60));
  const targetDps = baseDpsL7 * 0.30; // trim to reduce overperformance
      const cooldown = 110;
      const damage = Math.max(1, Math.round((targetDps * cooldown) / 60 * 0.48));
      // Seed + collapse mechanics
      const seedSlowPct = 0.85;
      const seedTicks = 6;
      const seedTickIntervalMs = 300;
      const seedTickFrac = 0.38;
      const fuseMs = 2000;
      const pullRadius = 170;
      const pullStrength = 540;
      const collapseRadius = 190;
      const collapseMult = 1.95;
      return { cooldown, damage, seedSlowPct, seedTicks, seedTickIntervalMs, seedTickFrac, fuseMs, pullRadius, pullStrength, collapseRadius, collapseMult } as any;
  }
  },
  // Mech Mortar: extended range + acceleration handled in BulletManager for more epic arc
  [WeaponType.MECH_MORTAR]: { id: WeaponType.MECH_MORTAR, name: 'Mech Mortar', icon: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'), cooldown: 90, salvo: 1, spread: 0, projectile: 'bullet_gold', speed: 7, damage: 90, range: 520, maxLevel: 7, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'), size: 16, glowColor: '#FFD770', glowRadius: 14, trailColor: 'rgba(255,200,80,0.35)', trailLength: 32, rotationOffset: Math.PI/2 }, explosionRadius: 150, traits: ['Heavy','AoE','Scaling'], isClassWeapon: true, evolution: { evolvedWeaponType: WeaponType.SIEGE_HOWITZER, requiredPassive: 'Area Up' }, getLevelStats(level:number){ const baseDamage=90, baseCooldown=90, mult=5.833333; const lvl = Math.min(Math.max(level,1),7); const dmg=Math.round(baseDamage*(1+(lvl-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(lvl-1)*0.30/4)); const radius = Math.round(150 * (1 + 0.20 * (lvl-1))); return {damage:dmg, cooldown:cd, explosionRadius: radius}; } },
  /** Siege Howitzer — Evolution of Mech Mortar: slower cadence, much larger blast with intensified burn. */
  [WeaponType.SIEGE_HOWITZER]: {
    id: WeaponType.SIEGE_HOWITZER,
    name: 'Siege Howitzer',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'),
    description: 'Evolved siege cannon. Heavy arc, massive thermobaric detonation with scorching aftermath.',
    cooldown: 84,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_gold',
    speed: 7.2,
    range: 560,
    maxLevel: 1,
    damage: 0,
    projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'), size: 18, glowColor: '#FFE28A', glowRadius: 18, trailColor: 'rgba(255,210,110,0.40)', trailLength: 48, rotationOffset: Math.PI/2 },
    explosionRadius: 260,
    traits: ['Heavy','AoE','Thermobaric','Evolution'],
    isClassWeapon: true,
    getLevelStats(level:number){
      // Derive from Mortar L7 power with a slightly conservative evolution multiplier
      const base = (WEAPON_SPECS as any)[WeaponType.MECH_MORTAR];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 300, cooldown: 60, explosionRadius: 220 } as any;
  const baseDps = (s.damage * 60) / Math.max(1, (s.cooldown || 60));
  const target = baseDps * 0.40;
  const cd = 96;
      const damage = Math.max(1, Math.round((target * cd) / 60));
      const explosionRadius = 240;
      return { cooldown: cd, damage, explosionRadius } as any;
    }
  },
  /** Quantum Halo: persistent rotating orbs around player. Managed separately (cooldown unused). */
  [WeaponType.QUANTUM_HALO]: {
    id: WeaponType.QUANTUM_HALO,
    name: 'Quantum Halo',
  // Icon: render as orbit ring in UpgradePanel via inline SVG; keep a neutral cyan bullet fallback
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
  // Provide a pseudo-sprite hint so UI prefers a graphic over a generic beam icon
  projectileVisual: { type: 'plasma', color: '#FFFBEA', size: 8, glowColor: '#FFEFA8', glowRadius: 34, trailColor: 'rgba(255,240,170,0.45)', trailLength: 14 },
    traits: ['Orbit','Persistent','Pulse','Scaling','Defense'],
    description: 'Defensive constellation of blades—orbits that carve and push enemies away.',
  isClassWeapon: false,
  disabled: true,
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
  const pulseDamage= [0,0,0,110,150,195,240][idx];
      return { damage: baseDamage, orbCount, orbitRadius, spinSpeed, pulseDamage } as any;
    }
  }
  ,
  /** Heavy Gunner evolution: Lava Laser Minigun — sustained micro-beam that melts through lines at close range. */
  [WeaponType.GUNNER_LAVA_MINIGUN]: {
    id: WeaponType.GUNNER_LAVA_MINIGUN,
    name: 'Lava Laser Minigun',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_laserblaster.png'),
    description: 'Spin the barrels into a white-hot micro-beam. Short, thick, and relentless—pure close-range melt.',
    cooldown: 5,
    salvo: 1,
    spread: 0.04,
    projectile: 'beam_lava',
    speed: 0,
    range: 260,
    maxLevel: 1,
    damage: 6,
    // Represent as a beam for UI; actual visuals handled in Game beams render
    projectileVisual: { type: 'beam', color: '#FF4500', thickness: 8, length: 220, glowColor: '#FF8C00', glowRadius: 22, trailColor: 'rgba(255,69,0,0.45)', trailLength: 28 },
    traits: ['Beam','Sustained','Pierces','Short Range'],
    isClassWeapon: true,
    knockback: 4,
    getLevelStats(level: number){
      // Balance target lower to avoid overshooting PF
      const base = (WEAPON_SPECS as any)[WeaponType.GUNNER_MINIGUN];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 75, cooldown: 3 } as any;
      const baseDpsL7 = (s.damage * 60) / Math.max(1, s.cooldown||1);
      const targetDps = baseDpsL7 * 1.7;
      const cd = 5; // frames
      const dmg = Math.max(1, Math.round(targetDps * cd / 60));
      const length = 240;
      const thickness = 8;
      return { cooldown: cd, damage: dmg, length, thickness } as any;
    }
  },
  /** New Scavenger weapon: Scrap Lash — returning boomerang blade that pierces and applies armor shred briefly. */
  [WeaponType.SCRAP_LASH]: {
    id: WeaponType.SCRAP_LASH,
    name: 'Scrap Lash',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png'),
    description: 'Hurl a circular blade that carves through foes and swings back to your hand.',
  cooldown: 36,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
  speed: 7.5,
  range: 360,
    maxLevel: 7,
  damage: 38,
  projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_sawblade.png'), size: 18, glowColor: '#FFE28A', glowRadius: 18, trailColor: 'rgba(255,210,110,0.28)', trailLength: 22 },
    traits: ['Returning','Pierce','Armor Shred','Sustain'],
  isClassWeapon: true,
  disabled: false,
  knockback: 10,
  // Evolves into an orbiting grinder when you have sufficient area scaling
  evolution: { evolvedWeaponType: WeaponType.INDUSTRIAL_GRINDER, requiredPassive: 'Area Up' },
  getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
  const damage = [38,50,66,86,110,140,176][idx];
  const cooldown = [36,34,32,30,28,26,24][idx];
  const speed = [7.5,7.9,8.3,8.7,9.1,9.4,9.8][idx];
  const range = [380,400,420,440,460,480,520][idx];
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
  disabled: true,
    knockback: 95,
    // Single-level evolve: ~1.9× DPS of base weapon level 7 (anchored to current base stats)
    getLevelStats(level:number){
      const base = (WEAPON_SPECS as any)[WeaponType.SCRAP_LASH];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 156, cooldown: 26 } as any;
      const baseDpsL7 = (s.damage * 60) / Math.max(1, (s.cooldown || 26));
      const targetDps = baseDpsL7 * 1.38;
      const cooldown = 165; // frames per activation
      const cooldownMs = Math.round(cooldown * (1000/60));
      const damage = Math.max(1, Math.round(targetDps * cooldownMs / 1000));
      const durationMs = 1200;
      const orbitRadius = 135;
      return { cooldown, cooldownMs, damage, durationMs, orbitRadius } as any;
    }
  }
  ,
  /** Cyber Runner evolution: Runner Overdrive — hyper-cadence twin-stream with lane biasing. */
  [WeaponType.RUNNER_OVERDRIVE]: {
    id: WeaponType.RUNNER_OVERDRIVE,
    name: 'Runner Overdrive',
    icon: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'),
    description: 'Flip the limiter. Twin converging streams lock to your strafe—surgical spray at insane cadence.',
    cooldown: 4,
    salvo: 2,
    spread: 0.06,
    projectile: 'bullet_cyan',
    speed: 12.5,
    range: 380,
    maxLevel: 1,
    damage: 6,
    // Dark neon red theme
  // Draw as a pure color bullet (no cyan sprite) so theme is dark neon red with a visible trail
  projectileVisual: { type: 'bullet', size: 6, color: '#8B0000', glowColor: '#B22222', glowRadius: 18, trailColor: 'rgba(139,0,0,0.70)', trailLength: 22 },
    traits: ['Twin Stream','Hyper Cadence','Lane Bias'],
    isClassWeapon: true,
    knockback: 6,
    getLevelStats(level: number){
      // Boost enough to hit ~1500 PF band but avoid runaway
      const base = (WEAPON_SPECS as any)[WeaponType.RUNNER_GUN];
      const s = base?.getLevelStats ? base.getLevelStats(7) : { damage: 18, cooldown: 4 };
      const salvo = 2;
      const cd = 4; // frames
      const baseDpsL7 = (s.damage * 60) / Math.max(1, (s.cooldown || 1));
  const targetDps = baseDpsL7 * 3.26; // tiny lift toward band
      const dmg = Math.max(1, Math.round(targetDps * cd / (salvo * 60)));
      const spread = 0.06; // tighter
      const speed = 12.5;
      const projectileSize = 6;
      return { cooldown: cd, salvo, damage: dmg, spread, speed, projectileSize } as any;
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
