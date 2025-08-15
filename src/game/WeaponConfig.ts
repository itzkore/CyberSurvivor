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

export interface WeaponSpec {
  id: WeaponType;
  name: string;
  icon?: string;
  cooldown: number; // frames between shots
  salvo: number; // bullets per shot
  spread: number; // radians between bullets
  projectile: string; // key to projectile type in manifest (for sprite-based)
  speed: number; // bullet speed
  range: number; // new stat: max range in pixels
  maxLevel: number; // max level for the weapon
  projectileVisual: ProjectileVisual; // New property for visual definition
  traits?: string[]; // Unique traits for weapon
  beamVisual?: ProjectileVisual; // Optional beam visual for weapons like Railgun
}

export const WEAPON_SPECS: Record<WeaponType, WeaponSpec> = {
  [WeaponType.PISTOL]:   { id: WeaponType.PISTOL,  name: 'Desert Eagle',  icon: '/assets/ui/icons/weapon_0.png', cooldown: 90,  salvo: 1, spread: 0,   projectile: 'bullet_gold', speed: 7,  range: 420, maxLevel: 5, projectileVisual: { type: 'bullet', color: '#FFD700', size: 10, glowColor: '#FFD700', glowRadius: 8 }, traits: ['Heavy', 'High Damage', 'Strong Recoil', 'Large Caliber'] },
  [WeaponType.SHOTGUN]:  { id: WeaponType.SHOTGUN,  name: 'Shotgun', icon: '/assets/ui/icons/weapon_1.png', cooldown: 90,  salvo: 5, spread: 0.22, projectile: 'bullet_brown', speed: 4.9,  range: 180, maxLevel: 5, projectileVisual: { type: 'bullet', color: '#A0522D', size: 8, glowColor: '#FFD700', glowRadius: 8 }, traits: ['High Damage', 'Short Range', 'Tight Spread'] },
  [WeaponType.TRI_SHOT]: { id: WeaponType.TRI_SHOT, name: 'Triple Crossbow', icon: '/assets/ui/icons/weapon_2.png', cooldown: 120, salvo: 3, spread: 0.18, projectile: 'arrow_heavy', speed: 7.5, range: 600, maxLevel: 5, projectileVisual: { type: 'arrow', color: '#B8860B', size: 18, glowColor: '#FFD700', glowRadius: 12, trailColor: 'rgba(184,134,11,0.5)', trailLength: 16 }, traits: ['Piercing', 'Heavy Arrow', 'Long Cooldown', 'High Damage'] },
  [WeaponType.RAPID]:    { id: WeaponType.RAPID,    name: 'Rapid',   icon: '/assets/ui/icons/weapon_3.png', cooldown: 15,  salvo: 1, spread: 0,    projectile: 'bullet_cyan', speed: 9.1, range: 340, maxLevel: 5, projectileVisual: { type: 'bullet', color: '#00FF00', size: 5, glowColor: '#00FF00', glowRadius: 4, trailColor: 'rgba(0,255,0,0.5)', trailLength: 10 } },
  [WeaponType.LASER]:    { id: WeaponType.LASER,    name: 'Laser Blaster',   icon: '/assets/ui/icons/weapon_4.png', cooldown: 18,  salvo: 2, spread: 0.08,    projectile: 'bullet_red', speed: 18, range: 320, maxLevel: 5, projectileVisual: { type: 'bullet', color: '#FF2D2D', size: 7, glowColor: '#FF2D2D', glowRadius: 8 }, traits: ['Blaster', 'Fast Projectile', 'Short Burst', 'Moderate Damage'] },
  [WeaponType.BEAM]: {
    id: WeaponType.BEAM,
    name: 'Beam',
    icon: '/assets/ui/icons/weapon_5.png',
    cooldown: 50,
    salvo: 1,
    spread: 0,
    projectile: 'bullet_cyan',
    speed: 17.5,
    range: 700,
    maxLevel: 5,
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
    traits: ['Boss Beam', 'Epic Glow', 'Animated Core']
  },
  [WeaponType.RICOCHET]: { id: WeaponType.RICOCHET, name: 'Ricochet',icon: '/assets/ui/icons/weapon_6.png', cooldown: 70,  salvo: 1, spread: 0.05,  projectile: 'bullet_cyan', speed: 7, range: 420, maxLevel: 5, projectileVisual: { type: 'bullet', color: '#0080FF', size: 10, glowColor: '#0080FF', glowRadius: 7 }, traits: ['Bounces Between Enemies', 'Locks On Next Target', 'Max 3 Bounces', 'Low Damage'] },
  [WeaponType.HOMING]: {
    id: WeaponType.HOMING,
    name: 'Kamikaze Drone',
    icon: '/assets/ui/icons/drone.png',
    cooldown: 120,
    salvo: 1,
    spread: 0,
    projectile: 'drone_blue',
  speed: 4.9,
  range: 150,
    maxLevel: 5,
    projectileVisual: {
      type: 'drone',
      color: '#00BFFF',
      size: 14,
      glowColor: '#00BFFF',
      glowRadius: 10,
      trailColor: 'rgba(0,191,255,0.4)',
      trailLength: 18
    },
    traits: ['Homing', 'Circles Player', 'Explodes on Contact', 'Kamikaze']
  },
  [WeaponType.RAILGUN]: {
    id: WeaponType.RAILGUN,
    name: 'Railgun',
    icon: '/assets/ui/icons/weapon_8.png',
    cooldown: 120,
    salvo: 1,
    spread: 0,
    projectile: 'railgun_orb',
    speed: 0,
    range: 900,
    maxLevel: 5,
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
    }
  },
  [WeaponType.PLASMA]:   { id: WeaponType.PLASMA,   name: 'Plasma',  icon: '/assets/ui/icons/weapon_9.png', cooldown: 60,  salvo: 4, spread: 0.25, projectile: 'bullet_cyan', speed: 11.2, range: 350, maxLevel: 5, projectileVisual: { type: 'plasma', color: '#00FFFF', size: 12, glowColor: '#00FFFF', glowRadius: 10, trailColor: 'rgba(0,255,255,0.3)', trailLength: 5 } },
  [WeaponType.RUNNER_GUN]: { id: WeaponType.RUNNER_GUN, name: 'Runner Gun', icon: '/assets/ui/icons/runner_gun.png', cooldown: 12, salvo: 2, spread: 0.12, projectile: 'bullet_cyan', speed: 10.5, range: 300, maxLevel: 5, projectileVisual: { type: 'spray', color: '#00FFFF', size: 5, glowColor: '#00FFFF', glowRadius: 6, trailColor: 'rgba(0,255,255,0.5)', trailLength: 12 }, traits: ['Spray', 'Fast', 'Low Damage'] },
  [WeaponType.WARRIOR_CANNON]: { id: WeaponType.WARRIOR_CANNON, name: 'Warrior Cannon', icon: '/assets/ui/icons/warrior_cannon.png', cooldown: 60, salvo: 1, spread: 0, projectile: 'bullet_red', speed: 5.6, range: 250, maxLevel: 5, projectileVisual: { type: 'explosive', color: '#FF0000', size: 14, glowColor: '#FF0000', glowRadius: 12 }, traits: ['Explosive', 'High Damage', 'Slow'] },
  [WeaponType.SORCERER_ORB]: {
    id: WeaponType.SORCERER_ORB,
    name: 'Arcane Orb',
    icon: '/assets/ui/icons/sorcerer_orb.png',
    cooldown: 144, // 4x original cooldown
    salvo: 1,
    spread: 0,
    projectile: 'orb_yellow',
    speed: 3.2,
    range: 1200, // Increased initial range for longer travel before first impact
    maxLevel: 5,
    projectileVisual: {
      type: 'bullet',
      color: '#FFD700',
      size: 10,
      glowColor: '#FFD700',
      glowRadius: 18
    },
    traits: ['Piercing', 'Homing', 'Needle', 'Returns', 'Runs Through Enemies', 'Snake', 'Ricochet']
  },
  [WeaponType.SHADOW_DAGGER]: { id: WeaponType.SHADOW_DAGGER, name: 'Shadow Dagger', icon: '/assets/ui/icons/shadow_dagger.png', cooldown: 18, salvo: 1, spread: 0, projectile: 'dagger_purple', speed: 12.6, range: 420, maxLevel: 5, projectileVisual: { type: 'ricochet', color: '#800080', size: 7, glowColor: '#800080', glowRadius: 8 }, traits: ['Ricochet', 'Critical', 'Fast'] },
  [WeaponType.BIO_TOXIN]: { id: WeaponType.BIO_TOXIN, name: 'Bio Toxin', icon: '/assets/ui/icons/bio_toxin.png', cooldown: 88, salvo: 1, spread: 0, projectile: 'toxin_green', speed: 3.5, range: 260, maxLevel: 5, projectileVisual: { type: 'slime', color: '#00FF00', size: 13, glowColor: '#00FF00', glowRadius: 10 }, traits: ['Poison', 'Area', 'Debuff'] },
  [WeaponType.HACKER_VIRUS]: { id: WeaponType.HACKER_VIRUS, name: 'Hacker Virus', icon: '/assets/ui/icons/hacker_virus.png', cooldown: 32, salvo: 1, spread: 0, projectile: 'virus_orange', speed: 8.4, range: 340, maxLevel: 5, projectileVisual: { type: 'plasma', color: '#FFA500', size: 10, glowColor: '#FFA500', glowRadius: 8 }, traits: ['EMP', 'Disrupt', 'Pierces'] },
  [WeaponType.GUNNER_MINIGUN]: { id: WeaponType.GUNNER_MINIGUN, name: 'Minigun', icon: '/assets/ui/icons/gunner_minigun.png', cooldown: 10, salvo: 1, spread: 0.28, projectile: 'bullet_brown', speed: 7.7, range: 320, maxLevel: 5, projectileVisual: { type: 'spray', color: '#A52A2A', size: 6, glowColor: '#A52A2A', glowRadius: 5, trailColor: 'rgba(165,42,42,0.5)', trailLength: 8 }, traits: ['Spray', 'Rapid', 'Lower Damage', 'Wider Spread', 'Balanced'] },
  [WeaponType.PSIONIC_WAVE]: {
    id: WeaponType.PSIONIC_WAVE,
    name: 'Psionic Wave',
    icon: '/assets/ui/icons/psionic_wave.png',
    cooldown: 28,
    salvo: 1,
    spread: 0,
    projectile: 'wave_pink',
    speed: 9.1,
    range: 500,
    maxLevel: 5,
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
    traits: ['Boss Wave', 'Epic Glow', 'Animated Core', 'Pierces', 'Area']
  },
  [WeaponType.SCAVENGER_SLING]: { id: WeaponType.SCAVENGER_SLING, name: 'Scavenger Sling', icon: '/assets/ui/icons/scavenger_sling.png', cooldown: 38, salvo: 1, spread: 0, projectile: 'rock_gray', speed: 7, range: 300, maxLevel: 5, projectileVisual: { type: 'bullet', color: '#808080', size: 10, glowColor: '#808080', glowRadius: 7 }, traits: ['Random', 'Bounces', 'Medium Damage'] },
  [WeaponType.NOMAD_NEURAL]: { id: WeaponType.NOMAD_NEURAL, name: 'Neural Pulse', icon: '/assets/ui/icons/nomad_neural.png', cooldown: 24, salvo: 1, spread: 0, projectile: 'pulse_teal', speed: 9.8, range: 400, maxLevel: 5, projectileVisual: { type: 'plasma', color: '#008080', size: 11, glowColor: '#008080', glowRadius: 9 }, traits: ['Pulse', 'Stun', 'Pierces'] },
  [WeaponType.GHOST_SNIPER]: { id: WeaponType.GHOST_SNIPER, name: 'Ghost Sniper', icon: '/assets/ui/icons/ghost_sniper.png', cooldown: 110, salvo: 1, spread: 0, projectile: 'sniper_white', speed: 22.4, range: 1200, maxLevel: 5, projectileVisual: { type: 'laser', color: '#FFFFFF', thickness: 2, length: 140, glowColor: '#FFFFFF', glowRadius: 18 }, traits: ['Laser', 'Critical', 'Long Range'] },
  [WeaponType.MECH_MORTAR]: {
    id: WeaponType.MECH_MORTAR,
    name: 'Mech Mortar',
    icon: '/assets/ui/icons/mech_mortar.png',
    cooldown: 80,
    salvo: 1,
    spread: 0,
    projectile: 'mortar_shell',
    speed: 6,
    range: 500,
    maxLevel: 5,
    projectileVisual: {
      type: 'explosive',
      color: '#FFA07A',
      size: 16,
      glowColor: '#FFA07A',
      glowRadius: 14,
      trailColor: 'rgba(255,160,122,0.5)',
      trailLength: 16
    },
    traits: ['Explosive', 'Area Damage', 'Arc Trajectory', 'High Impact']
  },
} as const;
