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
  cooldown: number; // frames between shots
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
  speed: 18, // increased base projectile speed (+50%)
    // Increased range for Desert Eagle (was 440) to improve long‑range feel
    range: 660,
    maxLevel: 5, // capped at 5 to match provided DPS milestone (L5 = 400 DPS)
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
      const cooldownTable = [70, 65, 60, 52, 45]; // frames
      const dpsTable       = [50, 85,140,255,400];
      const idx = Math.min(Math.max(level,1), 5) - 1;
      const cd = cooldownTable[idx];
      const targetDps = dpsTable[idx];
      const damage = Math.round(targetDps * cd / 60); // derive integer damage
      // Mild ancillary scaling
  const speed = 18 + idx * 1.8; // maintain proportional growth after base speed increase
  // Increase base projectile visual size (300% request) -> previous baseline 3.5 now ~10.5
  const projectileSize = 10.5 + idx * 1.8; // preserve proportional growth (scaled by 3x)
      const explosionRadius = 110 + idx * 15; // earlier AoE presence
      const recoil = 1 + idx * 0.2;
      return { damage, speed, recoil, cooldown: cd, projectileSize, explosionRadius };
    },
    projectileVisual: {
      type: 'bullet',
      // Dedicated sprite for Desert Eagle bullet (size doubled again)
  sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_deagle.png'),
      color: '#E6C200',
  size: 72, // 300% increase (24 * 3) -> render diameter = 144px
      glowColor: '#FFC933',
      glowRadius: 28,
      trailColor: 'rgba(255,200,0,0.55)',
      trailLength: 30,
      rotationOffset: 3.141592653589793 // flip 180° if sprite appears backward
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
    maxLevel: 8,
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
      const idx = Math.min(Math.max(level,1),8) - 1;
      const cooldownTable = [95,90,85,80,75,70,62,55];
      const pelletTable   = [5,5,6,6,7,8,8,9];
      const targetDps     = [60,70,85,105,140,185,240,300];
      const spreadTable   = [0.22,0.20,0.19,0.18,0.17,0.16,0.145,0.14];
      const speedTable    = [5.2,5.3,5.4,5.5,5.6,5.7,5.8,6.0];
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
  maxLevel: 5,   // standardized cap; evolution will occur from level 5 later
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
  const idx = Math.min(Math.max(level,1),5) - 1;
      // Frames (60fps). Larger reductions mid/late for satisfying ramp.
  const cooldowns = [100, 92, 84, 74, 64];
      // Base volley salvo progression (adds 4th bolt at L5+).
  const salvos    = [3, 3, 3, 3, 4];
      // Spread tightening so more multi-hits at higher levels.
  const spreads   = [0.155, 0.15, 0.145, 0.14, 0.13];
      // Target overall DPS (sum of all bolts if all land on large target).
  const dpsT      = [40, 65, 95, 140, 200];
      // Travel speed slight increase improves effective DPS at range.
  const speeds    = [9.4, 9.6, 9.8, 10.0, 10.3];
	const rangeUp   = [620, 650, 680, 710, 740]; // trimmed overall range curve
  // Per-level pierce scaling (remaining additional targets after first impact): 1,2,3,4,5
  const pierce   = [1, 2, 3, 4, 5];
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
    maxLevel: 5,
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
      const idx = Math.min(Math.max(level,1),5)-1;
      const dpsTargets = [25,38,55,75,100];
      const cooldowns  = [42,38,34,30,26];
      const salvo      = [1,1,1,1,2]; // adds a 2nd dart at L5
      const dmg = Math.round(dpsTargets[idx] * cooldowns[idx] / (salvo[idx]*60));
      // Slight speed increase helps reach far boss quickly
      const speeds = [3.2,3.4,3.6,3.8,4.1];
      // Turn rate hint (used by homing logic; store as pseudo-field)
      const turnRates = [0.065,0.075,0.085,0.095,0.11];
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
    maxLevel: 5,
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
      const idx = Math.min(Math.max(level,1),5)-1;
  // Full triple-hit (all 3 bolts connect) DPS progression target: 70 -> 750
  // Intermediate milestones chosen for satisfying geometric-ish growth while preserving feel.
  const dpsTargets = [70,150,300,500,750];
  const cooldowns  = [70,66,62,58,54]; // modest fire-rate improvement over levels
  const spreadT    = [0.035,0.034,0.033,0.032,0.031];
  const speedT     = [16,16.5,17,17.5,18];
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
    maxLevel: 5,
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
    knockback: 8 // Beam: low knockback
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
    maxLevel: 5,
    damage: 12,
  projectileVisual: { type: 'bullet', color: '#0090FF', size: 9, glowColor: '#33B5FF', glowRadius: 14, trailColor: 'rgba(0,144,255,0.55)', trailLength: 10 },
    traits: ['Bounces Between Enemies', 'Locks On Next Target', 'Max 3 Bounces', 'Low Damage'],
    isClassWeapon: false,
    knockback: 18 // Ricochet: moderate knockback
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
    maxLevel: 5,
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
      // Scale damage from 40 (L1) -> 450 (L5) smoothly using geometric progression for consistent relative growth.
      const start = 40;
      const end = 450;
      const steps = 5; // levels
      const ratio = Math.pow(end/start, 1/(steps-1));
      const dmg = Math.round(start * Math.pow(ratio, level-1));
      // Optionally tighten cooldown slightly with levels for DPS consistency (small 6% total reduction)
      const baseCd = 120;
      const cd = Math.round(baseCd * (1 - 0.06 * (level-1)/4));
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
    maxLevel: 5,
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
     isClassWeapon: false
  },
  [WeaponType.PLASMA]:   { id: WeaponType.PLASMA,   name: 'Plasma',  icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 60,  salvo: 4, spread: 0.25, projectile: 'bullet_cyan', speed: 11.2, range: 350, maxLevel: 5, damage: 10, projectileVisual: { type: 'plasma', color: '#00FFFF', size: 12, glowColor: '#00FFFF', glowRadius: 10, trailColor: 'rgba(0,255,255,0.3)', trailLength: 5 }, isClassWeapon: false },
  // Rebalanced Runner Gun: base damage set for ~60 DPS (damage * salvo * 60 / cooldown)
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 12, salvo: 2, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 300, maxLevel: 5, damage: 6, projectileVisual: { type: 'bullet', sprite: AssetLoader.normalizePath('/assets/projectiles/bullet_cyan.png'), size: 5, trailColor: 'rgba(0,255,255,0.5)', trailLength: 12, glowColor: '#66F2FF', glowRadius: 10 }, traits: ['Spray', 'Fast', 'Scaling'], isClassWeapon: true, knockback: 5, getLevelStats(level: number) { const baseDamage=6, baseCooldown=12, mult=5.833333; const dmg=Math.round(baseDamage*(1+ (level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1- (level-1)*0.30/4)); return { damage:dmg, cooldown:cd }; } },
  [WeaponType.WARRIOR_CANNON]: { id: WeaponType.WARRIOR_CANNON, name: 'Warrior Cannon', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 60, salvo: 1, spread: 0, projectile: 'bullet_red', speed: 5.6, range: 250, maxLevel: 5, damage: 60, projectileVisual: { type: 'explosive', color: '#FF0000', size: 14, glowColor: '#FF0000', glowRadius: 12 }, traits: ['Explosive', 'Burst', 'Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=60, baseCooldown=60, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.SORCERER_ORB]: { id: WeaponType.SORCERER_ORB, name: 'Arcane Orb', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 144, salvo: 1, spread: 0, projectile: 'orb_yellow', speed: 3.2, range: 1200, maxLevel: 5, damage: 144, projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 18 }, traits: ['Piercing','Homing','Returns','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=144, baseCooldown=144, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.SHADOW_DAGGER]: { id: WeaponType.SHADOW_DAGGER, name: 'Shadow Dagger', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 18, salvo: 1, spread: 0, projectile: 'dagger_purple', speed: 12.6, range: 420, maxLevel: 5, damage: 18, projectileVisual: { type: 'ricochet', color: '#800080', size: 7, glowColor: '#800080', glowRadius: 8 }, traits: ['Ricochet','Critical','Scaling'], isClassWeapon: true, knockback: 20, getLevelStats(level:number){ const baseDamage=18, baseCooldown=18, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.BIO_TOXIN]: { id: WeaponType.BIO_TOXIN, name: 'Bio Toxin', icon: AssetLoader.normalizePath('/assets/ui/icons/upgrade_speed.png'), cooldown: 88, salvo: 1, spread: 0, projectile: 'toxin_green', speed: 3.5, range: 260, maxLevel: 5, damage: 88, projectileVisual: { type: 'slime', color: '#00FF00', size: 13, glowColor: '#00FF00', glowRadius: 10 }, traits: ['Poison','Area','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=88, baseCooldown=88, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 32, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 5, damage: 32, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP','Disrupt','Pierces','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=32, baseCooldown=32, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 10, salvo: 1, spread: 0.28, projectile: 'bullet_cyan', speed: 7.7, range: 320, maxLevel: 5, damage: 10, projectileVisual: { type: 'bullet', color: '#B8860B', size: 6, glowColor: '#DAA520', glowRadius: 9, trailColor: 'rgba(184,134,11,0.55)', trailLength: 10 }, traits: ['Spray','Rapid','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=10, baseCooldown=10, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.PSIONIC_WAVE]: { id: WeaponType.PSIONIC_WAVE, name: 'Psionic Wave', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 28, salvo: 1, spread: 0, projectile: 'wave_pink', speed: 9.1, range: 500, maxLevel: 5, damage: 28, projectileVisual: { type: 'beam', color: '#FFC0CB', thickness: 14, length: 120, glowColor: '#FF00FF', glowRadius: 40, trailColor: '#FFD700', trailLength: 40 }, traits: ['Pierces','Area','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=28, baseCooldown=28, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.SCAVENGER_SLING]: { id: WeaponType.SCAVENGER_SLING, name: 'Scavenger Sling', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 38, salvo: 1, spread: 0, projectile: 'rock_gray', speed: 7, range: 300, maxLevel: 5, damage: 38, projectileVisual: { type: 'bullet', color: '#808080', size: 10, glowColor: '#808080', glowRadius: 7 }, traits: ['Bounces','Scaling'], isClassWeapon: true, knockback: 24, getLevelStats(level:number){ const baseDamage=38, baseCooldown=38, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.NOMAD_NEURAL]: { id: WeaponType.NOMAD_NEURAL, name: 'Neural Pulse', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 24, salvo: 1, spread: 0, projectile: 'pulse_teal', speed: 9.8, range: 400, maxLevel: 5, damage: 24, projectileVisual: { type: 'plasma', color: '#008080', size: 11, glowColor: '#008080', glowRadius: 9 }, traits: ['Pulse','Pierces','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=24, baseCooldown=24, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 95, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 5, damage: 95, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser','Armor Pierce','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=95, baseCooldown=95, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.MECH_MORTAR]: { id: WeaponType.MECH_MORTAR, name: 'Mech Mortar', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 90, salvo: 1, spread: 0, projectile: 'bullet_gold', speed: 7, damage: 90, range: 420, maxLevel: 8, projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 8 }, explosionRadius: 200, traits: ['Heavy','AoE','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=90, baseCooldown=90, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } }
  
};

// (Path normalization now handled at declaration via AssetLoader.normalizePath)
