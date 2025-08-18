import { WeaponType } from './WeaponType';

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
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 80, // faster fire rate
    salvo: 1,
    spread: 0,
  projectile: 'bullet_cyan', // Use PNG asset for projectile
  speed: 12, // Increased speed for faster bullet
    range: 440,
    maxLevel: 8,
  damage: 56, // Doubled base damage for even stronger one-shot capability
    /**
     * Returns scaled stats for Desert Eagle at a given level.
     * @param level Weapon level (1-based)
     */
    getLevelStats(level: number) {
      // Thinner, faster bullet scaling, higher damage
      return {
        damage: 56 + level * 20, // +20 per level, doubled scaling
        speed: 12 + level * 1.5, // +1.5 per level, starts faster
        recoil: 1 + level * 0.25, // +0.25 per level
        cooldown: Math.max(40, 80 - level * 5), // faster fire rate
        projectileSize: 7 + level * 1.2, // thinner bullet, slower growth
        explosionRadius: 100 + level * 10 // bigger splash
      };
    },
    projectileVisual: {
      type: 'bullet',
      sprite: '/assets/projectiles/bullet_cyan.png',
      size: 7, // Desert Eagle: thin
      trailColor: 'rgba(255,215,0,0.5)',
      trailLength: 18
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
    icon: '/assets/ui/icons/upgrade_speed.png',
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
      sprite: '/assets/projectiles/bullet_cyan.png',
      size: 10, // Shotgun: medium
      trailColor: 'rgba(160,82,45,0.5)',
      trailLength: 10
    },
    traits: ['High Damage', 'Short Range', 'Tight Spread'],
    isClassWeapon: false,
    knockback: 48 // Shotgun: very strong knockback
  },
  [WeaponType.TRI_SHOT]: {
    id: WeaponType.TRI_SHOT,
    name: 'Triple Crossbow',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 110,
    salvo: 3,
    spread: 0.16,
    projectile: 'arrow_heavy',
    speed: 8.2,
    range: 620,
    maxLevel: 5,
    damage: 18,
    projectileVisual: {
      type: 'arrow',
      color: '#B8860B',
      size: 18,
      glowColor: '#FFD700',
      glowRadius: 12,
      trailColor: 'rgba(184,134,11,0.5)',
      trailLength: 16
    },
    traits: ['Piercing', 'Heavy Arrow', 'Long Cooldown', 'High Damage'],
    isClassWeapon: false
  },
  [WeaponType.RAPID]:    {
    id: WeaponType.RAPID,
    name: 'Rapid',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 13,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 10.2,
    range: 360,
    maxLevel: 5,
    damage: 4,
    projectileVisual: {
      type: 'bullet',
      sprite: '/assets/projectiles/bullet_cyan.png',
      size: 7, // Rapid: thin
      trailColor: 'rgba(0,255,0,0.5)',
      trailLength: 10
    },
    traits: ['Fast', 'Low Damage', 'Quick Reload'],
    isClassWeapon: false
  },
  [WeaponType.LASER]:    {
    id: WeaponType.LASER,
    name: 'Laser Blaster',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 16,
    salvo: 2,
    spread: 0.07,
    projectile: 'bullet_red',
    speed: 19,
    range: 340,
    maxLevel: 5,
    damage: 7,
    projectileVisual: {
      type: 'bullet',
      color: '#FF2D2D',
      size: 8,
      glowColor: '#FF6666',
      glowRadius: 9,
      trailColor: 'rgba(255,45,45,0.5)',
      trailLength: 12
    },
    traits: ['Blaster', 'Fast Projectile', 'Short Burst', 'Moderate Damage'],
    isClassWeapon: false
  },
  [WeaponType.BEAM]: {
    id: WeaponType.BEAM,
    name: 'Beam',
    icon: '/assets/ui/icons/upgrade_speed.png',
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
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 70,
    salvo: 1,
    spread: 0.05,
    projectile: 'bullet_cyan',
    speed: 7,
    range: 420,
    maxLevel: 5,
    damage: 12,
  projectileVisual: { type: 'bullet', sprite: '/assets/projectiles/bullet_cyan.png', size: 10, trailColor: 'rgba(0,128,255,0.5)', trailLength: 8 },
    traits: ['Bounces Between Enemies', 'Locks On Next Target', 'Max 3 Bounces', 'Low Damage'],
    isClassWeapon: false,
    knockback: 18 // Ricochet: moderate knockback
  },
  [WeaponType.HOMING]: {
    id: WeaponType.HOMING,
    name: 'Kamikaze Drone',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 120,
    salvo: 1,
    spread: 0,
    projectile: 'drone_blue',
    speed: 4.9,
    range: 150,
    maxLevel: 5,
    damage: 25, // Base damage for Homing Drone
    projectileVisual: {
      type: 'drone',
      color: '#00BFFF',
      size: 14,
      glowColor: '#00BFFF',
      glowRadius: 10,
      trailColor: 'rgba(0,191,255,0.4)',
      trailLength: 18
    },
    traits: ['Homing', 'Circles Player', 'Explodes on Contact', 'Kamikaze'],
    isClassWeapon: false,
    knockback: 12 // Homing: light knockback
  },
  [WeaponType.RAILGUN]: {
    id: WeaponType.RAILGUN,
    name: 'Railgun',
    icon: '/assets/ui/icons/upgrade_speed.png',
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
  [WeaponType.PLASMA]:   { id: WeaponType.PLASMA,   name: 'Plasma',  icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 60,  salvo: 4, spread: 0.25, projectile: 'bullet_cyan', speed: 11.2, range: 350, maxLevel: 5, damage: 10, projectileVisual: { type: 'plasma', color: '#00FFFF', size: 12, glowColor: '#00FFFF', glowRadius: 10, trailColor: 'rgba(0,255,255,0.3)', trailLength: 5 }, isClassWeapon: false },
  // Rebalanced Runner Gun: base damage set for ~60 DPS (damage * salvo * 60 / cooldown)
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 12, salvo: 2, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 300, maxLevel: 5, damage: 6, projectileVisual: { type: 'bullet', sprite: '/assets/projectiles/bullet_cyan.png', size: 5, trailColor: 'rgba(0,255,255,0.5)', trailLength: 12 }, traits: ['Spray', 'Fast', 'Scaling'], isClassWeapon: true, knockback: 5, getLevelStats(level: number) { const baseDamage=6, baseCooldown=12, mult=5.833333; const dmg=Math.round(baseDamage*(1+ (level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1- (level-1)*0.30/4)); return { damage:dmg, cooldown:cd }; } },
  [WeaponType.WARRIOR_CANNON]: { id: WeaponType.WARRIOR_CANNON, name: 'Warrior Cannon', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 60, salvo: 1, spread: 0, projectile: 'bullet_red', speed: 5.6, range: 250, maxLevel: 5, damage: 60, projectileVisual: { type: 'explosive', color: '#FF0000', size: 14, glowColor: '#FF0000', glowRadius: 12 }, traits: ['Explosive', 'Burst', 'Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=60, baseCooldown=60, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.SORCERER_ORB]: { id: WeaponType.SORCERER_ORB, name: 'Arcane Orb', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 144, salvo: 1, spread: 0, projectile: 'orb_yellow', speed: 3.2, range: 1200, maxLevel: 5, damage: 144, projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 18 }, traits: ['Piercing','Homing','Returns','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=144, baseCooldown=144, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.SHADOW_DAGGER]: { id: WeaponType.SHADOW_DAGGER, name: 'Shadow Dagger', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 18, salvo: 1, spread: 0, projectile: 'dagger_purple', speed: 12.6, range: 420, maxLevel: 5, damage: 18, projectileVisual: { type: 'ricochet', color: '#800080', size: 7, glowColor: '#800080', glowRadius: 8 }, traits: ['Ricochet','Critical','Scaling'], isClassWeapon: true, knockback: 20, getLevelStats(level:number){ const baseDamage=18, baseCooldown=18, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.BIO_TOXIN]: { id: WeaponType.BIO_TOXIN, name: 'Bio Toxin', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 88, salvo: 1, spread: 0, projectile: 'toxin_green', speed: 3.5, range: 260, maxLevel: 5, damage: 88, projectileVisual: { type: 'slime', color: '#00FF00', size: 13, glowColor: '#00FF00', glowRadius: 10 }, traits: ['Poison','Area','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=88, baseCooldown=88, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 32, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 5, damage: 32, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP','Disrupt','Pierces','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=32, baseCooldown=32, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 10, salvo: 1, spread: 0.28, projectile: 'bullet_cyan', speed: 7.7, range: 320, maxLevel: 5, damage: 10, projectileVisual: { type: 'bullet', sprite: '/assets/projectiles/bullet_cyan.png', size: 6, trailColor: 'rgba(165,42,42,0.5)', trailLength: 8 }, traits: ['Spray','Rapid','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=10, baseCooldown=10, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.PSIONIC_WAVE]: { id: WeaponType.PSIONIC_WAVE, name: 'Psionic Wave', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 28, salvo: 1, spread: 0, projectile: 'wave_pink', speed: 9.1, range: 500, maxLevel: 5, damage: 28, projectileVisual: { type: 'beam', color: '#FFC0CB', thickness: 14, length: 120, glowColor: '#FF00FF', glowRadius: 40, trailColor: '#FFD700', trailLength: 40 }, traits: ['Pierces','Area','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=28, baseCooldown=28, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.SCAVENGER_SLING]: { id: WeaponType.SCAVENGER_SLING, name: 'Scavenger Sling', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 38, salvo: 1, spread: 0, projectile: 'rock_gray', speed: 7, range: 300, maxLevel: 5, damage: 38, projectileVisual: { type: 'bullet', color: '#808080', size: 10, glowColor: '#808080', glowRadius: 7 }, traits: ['Bounces','Scaling'], isClassWeapon: true, knockback: 24, getLevelStats(level:number){ const baseDamage=38, baseCooldown=38, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.NOMAD_NEURAL]: { id: WeaponType.NOMAD_NEURAL, name: 'Neural Pulse', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 24, salvo: 1, spread: 0, projectile: 'pulse_teal', speed: 9.8, range: 400, maxLevel: 5, damage: 24, projectileVisual: { type: 'plasma', color: '#008080', size: 11, glowColor: '#008080', glowRadius: 9 }, traits: ['Pulse','Pierces','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=24, baseCooldown=24, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 95, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 5, damage: 95, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser','Armor Pierce','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=95, baseCooldown=95, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } },
  [WeaponType.MECH_MORTAR]: { id: WeaponType.MECH_MORTAR, name: 'Mech Mortar', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 90, salvo: 1, spread: 0, projectile: 'bullet_gold', speed: 7, damage: 90, range: 420, maxLevel: 8, projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 8 }, explosionRadius: 200, traits: ['Heavy','AoE','Scaling'], isClassWeapon: true, getLevelStats(level:number){ const baseDamage=90, baseCooldown=90, mult=5.833333; const dmg=Math.round(baseDamage*(1+(level-1)*(mult-1)/4)); const cd=Math.round(baseCooldown*(1-(level-1)*0.30/4)); return {damage:dmg, cooldown:cd}; } }
};

// Normalize asset paths (icons & projectile sprites) for file:// protocol so absolute /assets paths work in packaged Electron
if (typeof location !== 'undefined' && location.protocol === 'file:') {
  for (const key in WEAPON_SPECS) {
    const spec = WEAPON_SPECS[key as unknown as WeaponType];
    if (!spec) continue;
    if (spec.icon && spec.icon.startsWith('/assets/')) spec.icon = '.' + spec.icon;
    if (spec.projectileVisual && spec.projectileVisual.sprite && spec.projectileVisual.sprite.startsWith('/assets/')) {
      spec.projectileVisual.sprite = '.' + spec.projectileVisual.sprite;
    }
    if (spec.beamVisual && spec.beamVisual.sprite && spec.beamVisual.sprite.startsWith('/assets/')) {
      spec.beamVisual.sprite = '.' + spec.beamVisual.sprite;
    }
  }
}
