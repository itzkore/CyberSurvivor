import { WeaponType } from "../game/WeaponType";

export interface CharacterData {
  id: string;
  name: string;
  description: string;
  icon: string; // Add icon property
  defaultWeapon: WeaponType;
  stats: {
    hp: number;
    maxHp: number;
    speed: number;
    damage: number;
    strength: number;
    intelligence: number;
    agility: number;
    luck: number;
    defense: number;
  };
  shape: 'circle' | 'square' | 'triangle';
  color: string;
  weaponTypes: WeaponType[]; // List of weapon types this character can use
}

export const CHARACTERS: CharacterData[] = [
  {
    id: 'wasteland_scavenger',
    name: 'Wasteland Scavenger',
    description: 'Resourceful and adaptable, thrives in harsh environments.',
    icon: '/assets/characters/wasteland_scavenger.png',
    defaultWeapon: WeaponType.SCAVENGER_SLING,
    stats: {
      hp: 100,
      maxHp: 100,
      speed: 8.4, // Doubled (4.2 * 2)
      damage: 24, // Doubled (12 * 2)
      strength: 6,
      intelligence: 6,
      agility: 6,
      luck: 8,
      defense: 6,
    },
    shape: 'square',
    color: '#808080',
    weaponTypes: [WeaponType.SCAVENGER_SLING, WeaponType.RICOCHET, WeaponType.SHOTGUN],
  },
  {
    id: 'heavy_gunner',
    name: 'Heavy Gunner',
    description: 'Unloads a barrage of sustained fire.',
    icon: '/assets/characters/heavy_gunner.png',
    defaultWeapon: WeaponType.GUNNER_MINIGUN,
    stats: {
      hp: 130,
      maxHp: 130,
      speed: 7.6, // Doubled (3.8 * 2)
      damage: 40, // Doubled (20 * 2)
      strength: 10,
      intelligence: 5,
      agility: 5,
      luck: 4,
      defense: 9,
    },
    shape: 'square',
    color: '#FFD700',
    weaponTypes: [WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN, WeaponType.RAILGUN],
  },
  {
    id: 'tech_warrior',
    name: 'Tech Warrior',
    description: 'A cybernetic fighter, excels at rapid fire and advanced weaponry.',
    icon: '/assets/characters/tech_warrior.png',
    defaultWeapon: WeaponType.TRI_SHOT,
    stats: {
      hp: 110,
      maxHp: 110,
      speed: 9.2, // Doubled (4.6 * 2)
      damage: 30, // Doubled (15 * 2)
      strength: 8,
      intelligence: 7,
      agility: 7,
      luck: 6,
      defense: 7,
    },
    shape: 'square',
    color: '#00AAFF',
    weaponTypes: [WeaponType.TRI_SHOT, WeaponType.RAPID, WeaponType.LASER],
  },
  {
    id: 'shadow_operative',
    name: 'Shadow Operative',
    description: 'A master of stealth and daggers, excels at critical hits and evasion.',
    icon: '/assets/characters/shadow_operative.png',
    defaultWeapon: WeaponType.SHADOW_DAGGER,
    stats: {
      hp: 75,
      maxHp: 75,
      speed: 11.6, // Doubled (5.8 * 2)
      damage: 32, // Doubled (16 * 2)
      strength: 6,
      intelligence: 8,
      agility: 12,
      luck: 10,
      defense: 2,
    },
    shape: 'triangle',
    color: '#222222',
    weaponTypes: [WeaponType.SHADOW_DAGGER, WeaponType.PISTOL, WeaponType.RAPID],
  },
  {
    id: 'neural_nomad',
    name: 'Neural Nomad',
    description: 'A wandering mind hacker, specializes in neural disruption and stuns.',
    icon: '/assets/characters/neural.nomad.png',
    defaultWeapon: WeaponType.NOMAD_NEURAL,
    stats: {
      hp: 95,
      maxHp: 95,
      speed: 8.4, // Doubled (4.2 * 2)
      damage: 26, // Doubled (13 * 2)
      strength: 5,
      intelligence: 11,
      agility: 8,
      luck: 7,
      defense: 5,
    },
    shape: 'triangle',
    color: '#00BFFF',
    weaponTypes: [WeaponType.NOMAD_NEURAL, WeaponType.LASER, WeaponType.PLASMA],
  },
  {
    id: 'data_sorcerer',
    name: 'Data Sorcerer',
    description: 'A digital mage, manipulates code and disrupts enemies with viruses.',
    icon: '/assets/characters/data_sorcerer.png',
    defaultWeapon: WeaponType.HACKER_VIRUS,
    stats: {
      hp: 85,
      maxHp: 85,
      speed: 8.4, // Doubled (4.2 * 2)
      damage: 28, // Doubled (14 * 2)
      strength: 4,
      intelligence: 12,
      agility: 7,
      luck: 9,
      defense: 4,
    },
    shape: 'triangle',
    color: '#00FFCC',
    weaponTypes: [WeaponType.HACKER_VIRUS, WeaponType.PLASMA, WeaponType.SORCERER_ORB],
  },
  {
    id: 'ghost_operative',
    name: 'Ghost Operative',
    description: 'A stealth specialist, excels at evasion and critical strikes.',
    icon: '/assets/characters/ghost_operative.png',
    defaultWeapon: WeaponType.GHOST_SNIPER,
    stats: {
      hp: 80,
      maxHp: 80,
      speed: 9.6, // Doubled (4.8 * 2)
      damage: 36, // Doubled (18 * 2)
      strength: 7,
      intelligence: 9,
      agility: 10,
      luck: 8,
      defense: 3,
    },
    shape: 'circle',
    color: '#FFFFFF',
    weaponTypes: [WeaponType.GHOST_SNIPER, WeaponType.RAILGUN, WeaponType.PISTOL],
  },
  {
    id: 'titan_mech',
    name: 'Titan Mech',
    description: 'A heavily armored war machine, slow but incredibly resilient.',
    icon: '/assets/characters/titan_mech.png',
    defaultWeapon: WeaponType.MECH_MORTAR,
    stats: {
      hp: 150,
      maxHp: 150,
      speed: 5.8, // Increased by 50% (2.5 * 1.5)
      damage: 40, // Doubled (20 * 2)
      strength: 10,
      intelligence: 4,
      agility: 3,
      luck: 3,
      defense: 12,
    },
    shape: 'square',
    color: '#444444',
    weaponTypes: [WeaponType.MECH_MORTAR, WeaponType.RAILGUN, WeaponType.SHOTGUN],
  },
  {
    id: 'cyber_runner',
    name: 'The Runner',
    description: 'A nimble survivor with enhanced speed and a rapid-fire weapon.',
    icon: '/assets/characters/runner_icon.png',
    defaultWeapon: WeaponType.RUNNER_GUN,
    stats: {
      hp: 80,
      maxHp: 80,
      speed: 8.4, // Doubled (4.2 * 2)
      damage: 16, // Doubled (8 * 2)
      strength: 4,
      intelligence: 6,
      agility: 8,
      luck: 5,
      defense: 4,
    },
    shape: 'circle',
    color: '#00FFFF',
    weaponTypes: [WeaponType.RAPID, WeaponType.LASER, WeaponType.PLASMA, WeaponType.RICOCHET, WeaponType.HOMING],
  },
  {
    id: 'psionic_weaver',
    name: 'Psionic Weaver',
    description: 'A master of psychic power, dealing area damage and controlling the battlefield.',
    icon: '/assets/characters/psionic_weaver.png',
  defaultWeapon: WeaponType.PSIONIC_WAVE,
    stats: {
      hp: 90,
      maxHp: 90,
      speed: 6.3, // Increased by 50% (4.2 * 1.5)
      damage: 24, // Doubled (12 * 2)
      strength: 5,
      intelligence: 10,
      agility: 6,
      luck: 6,
      defense: 5,
    },
    shape: 'triangle',
    color: '#AA00FF',
    weaponTypes: [WeaponType.PLASMA, WeaponType.LASER, WeaponType.HOMING],
  },
  {
    id: 'bio_engineer',
    name: 'Bio Engineer',
    description: 'A master of toxins and biological warfare, excels at area denial and debuffs.',
    icon: '/assets/characters/bio_engineer.png',
    defaultWeapon: WeaponType.BIO_TOXIN,
    stats: {
      hp: 100,
      maxHp: 100,
      speed: 6.0, // Increased by 50% (4.0 * 1.5)
      damage: 20, // Doubled (10 * 2)
      strength: 6,
      intelligence: 8,
      agility: 5,
      luck: 7,
      defense: 6,
    },
    shape: 'square',
    color: '#00FF88',
    weaponTypes: [WeaponType.BIO_TOXIN, WeaponType.PLASMA, WeaponType.HACKER_VIRUS],
  },
  {
    id: 'warrior',
    name: 'The Warrior',
    description: 'A resilient fighter with high HP and a powerful, slow-firing cannon.',
    icon: '/assets/characters/warrior_icon.png',
    defaultWeapon: WeaponType.WARRIOR_CANNON,
    stats: {
      hp: 120,
      maxHp: 120,
      speed: 5.2, // Increased by 50% (3.5 * 1.5)
      damage: 30, // Doubled (15 * 2)
      strength: 8,
      intelligence: 3,
      agility: 3,
      luck: 4,
      defense: 8,
    },
    shape: 'square',
    color: '#FF4500',
    weaponTypes: [WeaponType.SHOTGUN, WeaponType.BEAM, WeaponType.PLASMA, WeaponType.RAILGUN, WeaponType.WARRIOR_CANNON],
  }
];