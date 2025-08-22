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
   * Trail color for the projectile.
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
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
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
      const explosionRadius = 110 + idx * 15; // earlier AoE presence
      const recoil = 1 + idx * 0.2;
  // Add base pierce that grows slowly with level: L1 starts at 1
  const pierce = 1 + Math.max(0, Math.min(2, Math.floor((idx) / 3))); // 1 at L1-3, 2 at L4-6, 3 at L7
  return { damage, speed, recoil, cooldown: cd, projectileSize, explosionRadius, pierce };
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
    explosionRadius: 100,
    traits: ['Heavy', 'High Damage', 'Strong Recoil', 'Large Caliber'],
    evolution: { evolvedWeaponType: WeaponType.SHOTGUN, requiredPassive: 'Bullet Velocity' },
    isClassWeapon: false,
    knockback: 32 // Desert Eagle: strong knockback
  },
  [WeaponType.SHOTGUN]:  {
    id: WeaponType.SHOTGUN,
    name: 'Shotgun',
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
    cooldown: 95,
    salvo: 5,
    spread: 0.22,
    projectile: 'bullet_brown',
    speed: 5.2,
  range: 200,
  maxLevel: 10,
    damage: 9,
    projectileVisual: {
      type: 'bullet',
  // Unique pellet sprite (fallback color + glow if not loaded yet)
  sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_shotgun.png'),
  color: '#FF7A00',
  size: 8, // slightly smaller visual; multiple pellets read clearer
  glowColor: '#FFB066',
  glowRadius: 10,
  trailColor: 'rgba(255,122,0,0.45)',
  trailLength: 8
    },
    traits: ['High Damage', 'Short Range', 'Tight Spread'],
    isClassWeapon: false,
    knockback: 48, // Shotgun: very strong knockback
    /**
     * Shotgun scaling philosophy: burst DPS rises sharply if all pellets land, while spread tightens and pellet count increases.
     * Target approximate full-hit DPS milestones (Lv1→Lv8): 60,70,85,105,140,185,240,300.
     * Damage per pellet derived: damage = (targetDps * cooldown) / (pellets * 60).
     */
    getLevelStats(level: number) {
      const idx = Math.min(Math.max(level,1),10) - 1;
      const cooldownTable = [95,90,85,80,75,70,62,55,52,48];
      const pelletTable   = [5,5,6,6,7,8,8,9,9,10];
      const targetDps     = [60,70,85,105,140,185,240,300,350,400];
      const spreadTable   = [0.22,0.20,0.19,0.18,0.17,0.16,0.145,0.14,0.135,0.13];
      const speedTable    = [5.2,5.3,5.4,5.5,5.6,5.7,5.8,6.0,6.1,6.2];
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
  [WeaponType.TRI_SHOT]: {
    id: WeaponType.TRI_SHOT,
    name: 'Triple Crossbow',
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
    cooldown: 100, // slightly faster base to smooth early feel
    salvo: 3,      // three bolts per volley (central + two angled)
    spread: 0.155, // modest fan; tight enough to double-hit large enemies
  projectile: 'bullet_crossbow', // use manifest key so loader preloads PNG
    speed: 9.4,    // faster travel for long‑range identity
  range: 620,    // long (reduced from 780 to prevent excessive off‑screen hits)
  maxLevel: 7,   // extended cap; evolution may shift timing
    damage: 22,    // base per bolt (pre-scaling function)
    projectileVisual: {
      // Use 'bullet' so BulletManager sprite branch loads visual.sprite (type 'arrow' was falling through to circle fallback)
      type: 'bullet',
  sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_crossbow.png'), // unique crossbow bolt sprite
      color: '#CFA94A',
      size: 22,
      glowColor: '#FFE07A',
      glowRadius: 18,
      trailColor: 'rgba(255,210,110,0.55)',
      trailLength: 28,
      // If the PNG art points upward, rotate -90deg so velocity angle (pointing right baseline) matches.
  // Final orientation: sprite already points in facing (right) direction; no rotation offset needed.
  rotationOffset: 0
    },
    traits: ['Piercing', 'Triple Volley', 'Long Range', 'High Base Damage'],
    isClassWeapon: false,
    knockback: 26,
  /**
   * Triple Crossbow scaling goals (full-volley DPS):
   * L1 40  L2 65  L3 95  L4 140  L5 200 (evolution candidate afterward)
   * Scaling levers: cooldown reduction, salvo growth (adds 4th bolt at L5), spread tighten, damage growth.
   */
    getLevelStats(level: number) {
  const idx = Math.min(Math.max(level,1),7) - 1;
  const cooldowns = [100, 92, 84, 74, 64, 60, 56];
  const salvos    = [3, 3, 3, 3, 4, 4, 5];
  const spreads   = [0.155, 0.15, 0.145, 0.14, 0.13, 0.125, 0.12];
  const dpsT      = [40, 65, 95, 140, 200, 240, 285];
  const speeds    = [9.4, 9.6, 9.8, 10.0, 10.3, 10.5, 10.8];
	const rangeUp   = [620, 650, 680, 710, 740, 770, 800];
  const pierce   = [1, 2, 3, 4, 5, 5, 6];
      const cd = cooldowns[idx];
      const salvo = salvos[idx];
      const targetDps = dpsT[idx];
      // Per‑bolt damage derived: DPS = (damage * salvo * 60)/cooldown => damage = DPS * cooldown /(salvo*60)
      const rawDamage = targetDps * cd / (salvo * 60);
      const damage = Math.max(1, Math.round(rawDamage));
      // Mild projectile size growth for clarity feedback.
  const projectileSize = 22 + idx * 1.2; // still grows slightly per level (capped at L5)
      return {
        cooldown: cd,
        salvo,
        spread: spreads[idx],
        damage,
        speed: speeds[idx],
        range: rangeUp[idx],
        projectileSize,
        pierce: pierce[idx]
      };
    }
  },
  [WeaponType.RAPID]:    {
    id: WeaponType.RAPID,
    name: 'Smart Rifle',
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
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
    isClassWeapon: false,
    /**
     * Smart Rifle scaling: lowers cooldown, increases damage & turn rate, adds auxiliary darts (salvo) late.
     * L1→L5 target DPS (ideal single-target uptime): 25, 38, 55, 75, 100
     */
    getLevelStats(level: number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dpsTargets = [25,38,55,75,100,125,150];
      const cooldowns  = [42,38,34,30,26,24,22];
      const salvo      = [1,1,1,1,2,2,2];
      const dmg = Math.round(dpsTargets[idx] * cooldowns[idx] / (salvo[idx]*60));
      const speeds = [3.2,3.4,3.6,3.8,4.1,4.3,4.5];
      const turnRates = [0.065,0.075,0.085,0.095,0.11,0.12,0.13];
      return { cooldown: cooldowns[idx], salvo: salvo[idx], damage: dmg, speed: speeds[idx], turnRate: turnRates[idx] };
    }
  },
  // Replaced legacy Laser Blaster with new high‑power Blaster (Star Wars style)
  [WeaponType.LASER]:    {
    id: WeaponType.LASER,
  name: 'Laser Blaster',
    icon: '/assets/ui/icons/upgrade_speed.png',
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
  [WeaponType.BEAM]: {
    id: WeaponType.BEAM,
    name: 'Beam',
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
    cooldown: 50,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 17.5,
    range: 700,
  maxLevel: 7,
    damage: 30, // Base damage for Beam
    projectileVisual: {
      type: 'beam',
      color: '#8000FF',
      thickness: 16,
      length: 80,
      glowColor: '#FF00FF',
      glowRadius: 32,
      trailColor: '#FFD700',
      trailLength: 30
    },
    traits: ['Boss Beam', 'Epic Glow', 'Animated Core'],
    isClassWeapon: false,
    knockback: 8, // Beam: low knockback
    getLevelStats(level: number){
      const idx = Math.min(Math.max(level,1),7)-1;
      // Target sustained DPS curve (single-target contact): 60,90,130,180,240,300,360
      const dpsTargets = [60,90,130,180,240,300,360];
      const cooldowns  = [50,48,46,44,42,40,38];
      const thickness  = [16,16,17,17,18,18,19];
      const lengths    = [80,82,84,86,88,90,92];
      const cd = cooldowns[idx];
      const rawDamage = dpsTargets[idx] * cd / 60; // per-shot damage (beam tick when fired)
      const damage = Math.max(1, Math.round(rawDamage));
      return { cooldown: cd, damage, thickness: thickness[idx], length: lengths[idx] };
    }
  },
  [WeaponType.RICOCHET]: {
    id: WeaponType.RICOCHET,
    name: 'Ricochet',
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
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
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
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
  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
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
  [WeaponType.PLASMA]:   { id: WeaponType.PLASMA,   name: 'Plasma Core',  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 90,  salvo: 1, spread: 0, projectile: 'bullet_cyan', speed: 7.5, range: 520, maxLevel: 7, damage: 38, projectileVisual: { type: 'plasma', color: '#55C8FF', size: 14, glowColor: '#9FFFFF', glowRadius: 18, trailColor: 'rgba(120,240,255,0.45)', trailLength: 8 }, traits: ['Charge','Detonate','Fragments / Ion Field','Scaling'], isClassWeapon: false,
    chargeTimeMs: 450,
    overheatThreshold: 0.85,
    heatPerShot: 0.25,
    heatPerFullCharge: 0.42,
    heatDecayPerSec: 0.35,
    fragmentCount: 3,
    ionFieldDamageFrac: 0.12, // per tick (5 ticks)
    ionFieldDurationMs: 600,
    overchargedMultiplier: 2.2,
    chargedMultiplier: 1.8,
    getLevelStats(level: number){
  const dmg = [38,52,68,86,108,125,142][level-1] || 38;
  const cd  = [90,84,78,72,66,62,58][level-1] || 90;
  const fragments = [3,3,4,4,5,5,6][level-1] || 3;
      return { damage: dmg, cooldown: cd, fragments };
    }
  },
  // Rebalanced Runner Gun: base damage set for ~60 DPS (damage * salvo * 60 / cooldown)
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), description: 'Two‑round burst spray built for motion. Effective only within 360 range—bullets converge from twin barrels for reliable mid‑range clears.', cooldown: 12, salvo: 2, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 360, maxLevel: 7, damage: 6, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), size: 5, trailColor: 'rgba(0,255,255,0.5)', trailLength: 12, glowColor: '#66F2FF', glowRadius: 10 }, traits: ['Spray', 'Fast', 'Scaling'], usageTips: [
    'Stay inside 360 range: weapons won\'t fire beyond it.',
    'Strafe while firing—barrels auto‑converge toward target for tighter hits.',
    'Dash through gaps and keep pressure; salvo ×2 maintains DPS while repositioning.'
  ], isClassWeapon: true, knockback: 5, getLevelStats(level: number) { const baseDamage=6, baseCooldown=12, mult=7.5; const dmg=Math.round(baseDamage*(1+ (level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1- (level-1)*0.32/6)); return { damage:dmg, cooldown:cd }; } },
  [WeaponType.WARRIOR_CANNON]: { id: WeaponType.WARRIOR_CANNON, name: 'Warrior Cannon', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 60, salvo: 1, spread: 0, projectile: 'bullet_red', speed: 5.6, range: 250, maxLevel: 7, damage: 60, projectileVisual: { type: 'explosive', color: '#FF0000', size: 14, glowColor: '#FF0000', glowRadius: 12 }, traits: ['Explosive', 'Burst', 'Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=60, baseCooldown=60, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  /** Tech Warrior: Tachyon Spear — a phased dash-lance that pierces and leaves a micro-warp trail. */
  [WeaponType.TACHYON_SPEAR]: {
    id: WeaponType.TACHYON_SPEAR,
    name: 'Tachyon Spear',
    icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
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
  projectileVisual: { type: 'laser', color: '#FFA500', thickness: 4, length: 100, glowColor: '#FFB347', glowRadius: 18 },
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
    icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
    description: 'Piercing dash spear that collapses into a mini‑singularity then detonates.',
    cooldown: 64,
    salvo: 1,
    spread: 0,
  projectile: 'spear_singularity',
  // Evolution speed baseline (unchanged); gravity timing handled in BulletManager
  speed: 16,
    range: 720,
    maxLevel: 7,
    damage: 66,
    projectileVisual: { type: 'laser', color: '#C9A6FF', thickness: 5, length: 120, glowColor: '#DCC6FF', glowRadius: 22 },
    traits: ['Dash Pierce','Implode+Explode','Gravity Ring'],
    isClassWeapon: true,
    knockback: 22,
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [66,84,108,138,174,216,264][idx];
      const cd  = [64,62,60,58,56,54,52][idx];
      const len = [120,130,140,150,160,170,180][idx];
  const spd = [16,17,18,19,20,21,22][idx];
      return { damage: dmg, cooldown: cd, length: len, speed: spd } as any;
    }
  },
  [WeaponType.SORCERER_ORB]: { id: WeaponType.SORCERER_ORB, name: 'Arcane Orb', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 144, salvo: 1, spread: 0, projectile: 'orb_yellow', speed: 3.2, range: 1200, maxLevel: 7, damage: 144, projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 18 }, traits: ['Piercing','Homing','Returns','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=144, baseCooldown=144, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  /** Data Sorcerer class weapon: plants a rotating magenta sigil that pulses AoE damage. */
  [WeaponType.DATA_SIGIL]: {
    id: WeaponType.DATA_SIGIL,
    name: 'Data Sigil',
    icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
    description: 'Hack the arena with a rotating magenta glyph that pulses shockwaves.',
    cooldown: 72,
    salvo: 1,
    spread: 0,
    projectile: 'sigil_seed',
    speed: 6.0,
    range: 380,
    maxLevel: 7,
    damage: 28,
    projectileVisual: { type: 'plasma', color: '#FF00FF', size: 9, glowColor: '#FF66FF', glowRadius: 14, trailColor: 'rgba(255,0,255,0.25)', trailLength: 10 },
    traits: ['Area','Pulses','Control','Scaling'],
    usageTips: [
      'Drop the sigil ahead of enemy flow—pulses clean up as mobs walk in.',
      'Hold ground at chokepoints; overlapping pulses stack damage.',
      'Pair with slows or pulls to keep enemies inside the radius.'
    ],
    isClassWeapon: true,
    knockback: 10,
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [28,36,46,58,72,88,106][idx];
      const cd  = [72,68,64,60,56,52,48][idx];
      const radius = [110,120,130,140,150,165,180][idx];
      const pulses = [2,2,3,3,4,4,5][idx];
      const pulseDmg = [45,60,78,100,126,156,190][idx];
      return { damage: dmg, cooldown: cd, sigilRadius: radius, pulseCount: pulses, pulseDamage: pulseDmg } as any;
    }
  },
  [WeaponType.SHADOW_DAGGER]: { id: WeaponType.SHADOW_DAGGER, name: 'Shadow Dagger', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 18, salvo: 1, spread: 0, projectile: 'dagger_purple', speed: 12.6, range: 420, maxLevel: 7, damage: 18, projectileVisual: { type: 'ricochet', color: '#800080', size: 7, glowColor: '#800080', glowRadius: 8 }, traits: ['Ricochet','Critical','Scaling'], isClassWeapon: true, knockback: 20, getLevelStats(level:number){ const baseDamage=18, baseCooldown=18, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.BIO_TOXIN]: { id: WeaponType.BIO_TOXIN, name: 'Bio Toxin', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 88, salvo: 1, spread: 0, projectile: 'toxin_green', speed: 3.5, range: 260, maxLevel: 7, damage: 44, projectileVisual: { type: 'slime', color: '#00FF00', size: 9, glowColor: '#00FF00', glowRadius: 10 }, traits: ['Poison','Area','Scaling'], usageTips: [
    'Lob into clumps—pools linger and tick multiple enemies.',
    'Upgrade cadence to chain zones; funnel mobs through the slime.',
    'Pair with slows or pulls to keep enemies bathing in damage.'
  ], isClassWeapon: true, getLevelStats(level:number){
    const baseDamage=44, baseCooldown=88, dmgMult=7.5;
    const dmg=Math.round(baseDamage*(1+(level-1)*(dmgMult-1)/6));
    // Faster fire rate with level: cooldown reduces up to ~40% by level 7
    const cd=Math.max(36, Math.round(baseCooldown*(1-(level-1)*0.40/6)));
    return {damage:dmg, cooldown:cd};
  } },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 32, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 7, damage: 32, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP','Disrupt','Pierces','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=32, baseCooldown=32, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 10, salvo: 1, spread: 0.22, projectile: 'bullet_cyan', speed: 7.7, range: 320, maxLevel: 7, damage: 10, projectileVisual: { type: 'bullet', color: '#B8860B', size: 4, glowColor: '#DAA520', glowRadius: 7, trailColor: 'rgba(184,134,11,0.22)', trailLength: 8 }, traits: ['Spray','Rapid','Scaling'], usageTips: [
    'Strafe into arcs—short bursts keep spread under control.',
    'Stay within 320 range to maintain constant fire.',
    'Knockback and slows help hold targets in the stream.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=10, baseCooldown=10, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.PSIONIC_WAVE]: { id: WeaponType.PSIONIC_WAVE, name: 'Psionic Wave', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 28, salvo: 1, spread: 0, projectile: 'wave_pink', speed: 9.1, range: 500, maxLevel: 7, damage: 28, 
    description: 'Sweeping psionic beam that pierces and briefly marks foes, slowing them and boosting follow-up damage during the mark.',
    projectileVisual: { type: 'beam', color: '#FFC0CB', thickness: 14, length: 120, glowColor: '#FF00FF', glowRadius: 40, trailColor: '#FFD700', trailLength: 40 }, traits: ['Pierces','Area','Slow','Scaling'], usageTips: [
    'Sweep perpendicular to enemy flow—pierce maximizes coverage.',
    'Tag elites/bosses, then pour damage while the psionic mark is active.',
    'Slows, pulls, or chokepoints extend beam uptime and stack marks safely.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=28, baseCooldown=28, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); const bounces = Math.max(0, level); return {damage:dmg, cooldown:cd, bounces}; } },
  [WeaponType.SCAVENGER_SLING]: { id: WeaponType.SCAVENGER_SLING, name: 'Scavenger Sling', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 38, salvo: 1, spread: 0, projectile: 'rock_gray', speed: 7, range: 300, maxLevel: 7, damage: 38, projectileVisual: { type: 'bullet', color: '#808080', size: 10, glowColor: '#808080', glowRadius: 7 }, traits: ['Bounces','Scaling'], isClassWeapon: true, knockback: 24, getLevelStats(level:number){ const baseDamage=38, baseCooldown=38, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  /** Neural Nomad class weapon: Neural Threader — pierce to anchor enemies into a threaded link that pulses. */
  [WeaponType.NOMAD_NEURAL]: {
    id: WeaponType.NOMAD_NEURAL,
    name: 'Neural Threader',
    icon: '/assets/ui/icons/upgrade_speed.png',
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
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 95, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 7, damage: 95, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser','Armor Pierce','Scaling'], usageTips: [
    'Take longer lines of sight—shots pierce and reward straight lanes.',
    'Weave between shots; high alpha damage favors deliberate pacing.',
    'Prioritize elites and bosses—armor pierce makes headway through tanks.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=95, baseCooldown=95, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); return {damage:dmg, cooldown:cd}; } },
  /** Void Sniper: Shadow Operative variant of Ghost Sniper. Deals damage over time only. */
  [WeaponType.VOID_SNIPER]: { id: WeaponType.VOID_SNIPER, name: 'Void Sniper', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 95, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 7, damage: 95, projectileVisual: { type: 'laser', color: '#6A0DAD', thickness: 2, length: 140, glowColor: '#B266FF', glowRadius: 22 }, traits: ['Laser','Paralysis (0.5s)','Damage Over Time','Pierces','Scaling'], usageTips: [
    'Tag elites and kite—DoT stacks on the same target.',
    'Dark tick visuals confirm stacks; keep targets inside beam length.',
    'Pair with slows or knockback to keep afflicted mobs in range.'
  ], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=95, baseCooldown=95, mult=7.5; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/6)); const cd=Math.round(baseCooldown*(1-(level-1)*0.32/6)); // ticks: 3 over 3000ms
      return {damage:dmg, cooldown:cd, ticks:3, tickIntervalMs:1000}; } },
  // Mech Mortar: extended range + acceleration handled in BulletManager for more epic arc
  [WeaponType.MECH_MORTAR]: { id: WeaponType.MECH_MORTAR, name: 'Mech Mortar', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 90, salvo: 1, spread: 0, projectile: 'bullet_gold', speed: 7, damage: 90, range: 520, maxLevel: 8, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png'), size: 16, glowColor: '#FFD770', glowRadius: 14, trailColor: 'rgba(255,200,80,0.35)', trailLength: 32, rotationOffset: Math.PI/2 }, explosionRadius: 200, traits: ['Heavy','AoE','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=90, baseCooldown=90, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  /** Quantum Halo: persistent rotating orbs around player. Managed separately (cooldown unused). */
  [WeaponType.QUANTUM_HALO]: {
    id: WeaponType.QUANTUM_HALO,
    name: 'Quantum Halo',
    icon: '/assets/ui/icons/upgrade_speed.png',
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
  /** Scavenger class melee: arc sweep with scrap stacks + shrapnel burst */
  [WeaponType.SCRAP_SAW]: {
    id: WeaponType.SCRAP_SAW,
    name: 'Scrap-Saw',
    icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
  description: 'Arc sweep along a ring‑distance blade. Builds scrap stacks; at threshold, triggers a large blast around the user and heals +5 HP. Tether line deals 50% damage.',
  // Slower cadence: larger base cooldown (ms)
  cooldownMs: 930,
  // Fallback frames value (unused when cooldownMs is present)
  cooldown: 56,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 0,
  // Slightly increased reach for sweep contact radius
  range: 140, // used as arc reach in px
    maxLevel: 7,
    damage: 32,
  // Use manifest key; BulletManager resolves to actual path via AssetLoader
  projectileVisual: { type: 'bullet', sprite: 'bullet_saw', size: 16, glowColor: '#FFD770', glowRadius: 16, rotationOffset: 0 },
    traits: ['Melee','Arc Sweep','Scrap Stacks','Scrap Explosion','Self‑Heal','Tether','Armor Shred','High Knockback'],
    usageTips: [
      'Connect with the ring at blade distance for full damage; the tether line also hurts (50%).',
      'Hit multiple enemies to build scrap fast—on trigger, you\'ll blast and heal +5 HP.',
      'Sweep slowly; timing the arc into clumps gives better meter value than spamming.'
    ],
    isClassWeapon: true,
    knockback: 60,
    evolution: { evolvedWeaponType: WeaponType.INDUSTRIAL_GRINDER, requiredPassive: 'Magnet' },
    getLevelStats(level: number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const dmg = [32,46,64,88,118,150,185][idx];
  // Bigger cooldown progression in ms; longer sweep duration for a slower, smoother arc
  const cdMs  = [930,900,870,840,810,780,750][idx];
  const arc = [120,130,140,150,160,160,160][idx];
  const dur = [280,300,320,340,360,380,400][idx];
      const knock= [60,64,68,72,76,80,84][idx];
      const shards=[6,6,7,8,8,9,10][idx];
  return { damage: dmg, cooldownMs: cdMs, arcDegrees: arc, sweepDurationMs: dur, knockback: knock, shrapnelCount: shards } as any;
    }
  },
  /** Evolution: timed 360° grinder with stronger knockback and DoT-like multi-hit */
  [WeaponType.INDUSTRIAL_GRINDER]: {
    id: WeaponType.INDUSTRIAL_GRINDER,
    name: 'Industrial Grinder',
    icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'),
    description: 'Sustained orbiting grinder that repels and tears through enemies.',
    cooldown: 180,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 0,
    range: 140,
    maxLevel: 7,
    damage: 20,
  // Use manifest key; BulletManager resolves to actual path via AssetLoader
  projectileVisual: { type: 'bullet', sprite: 'bullet_grinder', size: 20, glowColor: '#FFE28A', glowRadius: 28 },
    traits: ['Melee','Sustained Orbit','Strong Knockback'],
    isClassWeapon: true,
    knockback: 95,
    getLevelStats(level:number){
      const idx = Math.min(Math.max(level,1),7)-1;
      const cd = [180,172,164,156,148,140,132][idx];
      const dmg= [20,26,34,44,56,70,86][idx];
      const dur= [1200,1250,1300,1350,1400,1450,1500][idx];
      const rad= [120,125,130,135,140,145,150][idx];
      return { cooldown: cd, damage: dmg, durationMs: dur, orbitRadius: rad } as any;
    }
  }
  
};

// (Path normalization now handled at declaration via AssetLoader.normalizePath)
