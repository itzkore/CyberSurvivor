import { WeaponType } from './WeaponType';

export interface ProjectileVisual {
  type: 'bullet' | 'laser' | 'beam' | 'plasma' | 'slime' | 'spray' | 'explosive' | 'boomerang' | 'ricochet' | 'drone' | 'arrow';
  color: string; // Hex color
  size?: number; // For bullets/plasma/slime
  length?: number; // For lasers/beams
  thickness?: number; // For lasers/beams
  glowColor?: string; // For glow effects
  glowRadius?: number; // For glow effects
  trailColor?: string; // For trails
  trailLength?: number; // For trails
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
    projectile: 'bullet_gold',
    speed: 8,
    range: 440,
    maxLevel: 8,
    damage: 14,
    /**
     * Returns scaled stats for Desert Eagle at a given level.
     * @param level Weapon level (1-based)
     */
    getLevelStats(level: number) {
      // Aggressive scaling: each level is a big jump
      return {
        damage: 14 + level * 8, // +8 per level
        speed: 8 + level * 1.2, // +1.2 per level
        recoil: 1 + level * 0.25, // +0.25 per level
        cooldown: Math.max(40, 80 - level * 5), // faster fire rate
        projectileSize: 12 + level * 2, // bigger bullets
        explosionRadius: 100 + level * 10 // bigger splash
      };
    },
    projectileVisual: {
      type: 'bullet',
      color: '#FFD700',
      size: 12,
      glowColor: '#FFFACD',
      glowRadius: 10,
      trailColor: 'rgba(255,215,0,0.5)',
      trailLength: 14
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
      color: '#A0522D',
      size: 10,
      glowColor: '#FFD700',
      glowRadius: 8,
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
      color: '#00FF00',
      size: 7,
      glowColor: '#00FFCC',
      glowRadius: 6,
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
    projectileVisual: { type: 'bullet', color: '#0080FF', size: 10, glowColor: '#0080FF', glowRadius: 7 },
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
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 12, salvo: 2, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 300, maxLevel: 5, damage: 7, projectileVisual: { type: 'spray', color: '#00FFFF', size: 5, glowColor: '#00FFFF', glowRadius: 6, trailColor: 'rgba(0,255,255,0.5)', trailLength: 12 }, traits: ['Spray', 'Fast', 'Low Damage'], isClassWeapon: true, knockback: 5 // Half of current state (10 -> 5)
  },
  [WeaponType.WARRIOR_CANNON]: { id: WeaponType.WARRIOR_CANNON, name: 'Warrior Cannon', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 60, salvo: 1, spread: 0, projectile: 'bullet_red', speed: 5.6, range: 250, maxLevel: 5, damage: 40, projectileVisual: { type: 'explosive', color: '#FF0000', size: 14, glowColor: '#FF0000', glowRadius: 12 }, traits: ['Explosive', 'High Damage', 'Slow'], isClassWeapon: true },
  [WeaponType.SORCERER_ORB]: {
    id: WeaponType.SORCERER_ORB,
    name: 'Arcane Orb',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 144, // 4x original cooldown
    salvo: 1,
    spread: 0,
    projectile: 'orb_yellow',
    speed: 3.2,
    range: 1200, // Increased initial range for longer travel before first impact
    maxLevel: 5,
    damage: 25, // Base damage for Sorcerer Orb
    projectileVisual: {
      type: 'bullet',
      color: '#FFD700',
      size: 10,
      glowColor: '#FFD700',
      glowRadius: 18
    },
    traits: ['Piercing', 'Homing', 'Needle', 'Returns', 'Runs Through Enemies', 'Snake', 'Ricochet'],
    isClassWeapon: true
  },
  [WeaponType.SHADOW_DAGGER]: {
    id: WeaponType.SHADOW_DAGGER,
    name: 'Shadow Dagger',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 18,
    salvo: 1,
    spread: 0,
    projectile: 'dagger_purple',
    speed: 12.6,
    range: 420,
    maxLevel: 5,
    damage: 18,
    projectileVisual: { type: 'ricochet', color: '#800080', size: 7, glowColor: '#800080', glowRadius: 8 },
    traits: ['Ricochet', 'Critical', 'Fast'],
    isClassWeapon: true,
    knockback: 20 // Dagger: moderate knockback
  },
  [WeaponType.BIO_TOXIN]: { id: WeaponType.BIO_TOXIN, name: 'Bio Toxin', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 88, salvo: 1, spread: 0, projectile: 'toxin_green', speed: 3.5, range: 260, maxLevel: 5, damage: 10, projectileVisual: { type: 'slime', color: '#00FF00', size: 13, glowColor: '#00FF00', glowRadius: 10 }, traits: ['Poison', 'Area', 'Debuff'], isClassWeapon: true },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 32, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 5, damage: 12, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP', 'Disrupt', 'Pierces'], isClassWeapon: true },
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 10, salvo: 1, spread: 0.28, projectile: 'bullet_brown', speed: 7.7, range: 320, maxLevel: 5, damage: 6, projectileVisual: { type: 'spray', color: '#A52A2A', size: 6, glowColor: '#A52A2A', glowRadius: 5, trailColor: 'rgba(165,42,42,0.5)', trailLength: 8 }, traits: ['Spray', 'Rapid', 'Lower Damage', 'Wider Spread', 'Balanced'], isClassWeapon: true },
  [WeaponType.PSIONIC_WAVE]: {
    id: WeaponType.PSIONIC_WAVE,
    name: 'Psionic Wave',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 28,
    salvo: 1,
    spread: 0,
    projectile: 'wave_pink',
    speed: 9.1,
    range: 500,
    maxLevel: 5,
    damage: 22, // Base damage for Psionic Wave
    projectileVisual: {
      type: 'beam',
      color: '#FFC0CB',
      thickness: 14,
      length: 120,
      glowColor: '#FF00FF',
      glowRadius: 40,
      trailColor: '#FFD700',
      trailLength: 40
    },
    traits: ['Boss Wave', 'Epic Glow', 'Animated Core', 'Pierces', 'Area'],
    isClassWeapon: true
  },
  [WeaponType.SCAVENGER_SLING]: {
    id: WeaponType.SCAVENGER_SLING,
    name: 'Scavenger Sling',
    icon: '/assets/ui/icons/upgrade_speed.png',
    cooldown: 38,
    salvo: 1,
    spread: 0,
    projectile: 'rock_gray',
    speed: 7,
    range: 300,
    maxLevel: 5,
    damage: 15,
    projectileVisual: { type: 'bullet', color: '#808080', size: 10, glowColor: '#808080', glowRadius: 7 },
    traits: ['Random', 'Bounces', 'Medium Damage'],
    isClassWeapon: true,
    knockback: 24 // Sling: medium knockback
  },
  [WeaponType.NOMAD_NEURAL]: { id: WeaponType.NOMAD_NEURAL, name: 'Neural Pulse', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 24, salvo: 1, spread: 0, projectile: 'pulse_teal', speed: 9.8, range: 400, maxLevel: 5, damage: 14, projectileVisual: { type: 'plasma', color: '#008080', size: 11, glowColor: '#008080', glowRadius: 9 }, traits: ['Pulse', 'Stun', 'Pierces'], isClassWeapon: true },
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: '/assets/ui/icons/upgrade_speed.png', cooldown: 110, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 5, damage: 60, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser', 'Critical', 'Long Range'], isClassWeapon: true },
  [WeaponType.MECH_MORTAR]: {
    id: WeaponType.MECH_MORTAR,
    name: 'Mech Mortar',
    icon: '/assets/ui/icons/upgrade_speed.png', // Pistol icon
    cooldown: 90, // Pistol cooldown
    salvo: 1, // Pistol salvo
    spread: 0, // Pistol spread
    projectile: 'bullet_gold', // Pistol projectile
    speed: 7, // Original speed
    damage: 60, // Revert to original balanced damage
     range: 420, // Pistol range
     maxLevel: 8, // Pistol maxLevel
     projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 8 }, // Pistol projectileVisual
     explosionRadius: 200, // Revert explosion radius to 200px as requested
  traits: ['Heavy', 'High Damage', 'Strong Recoil', 'Large Caliber'], // Pistol traits
  isClassWeapon: true
  }
};
