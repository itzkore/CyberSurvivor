import { WeaponType } from "../game/WeaponType";

export interface CharacterData {
  id: string;
  name: string;
  description: string;
  lore: string;
  icon: string;
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
  /** Derived overall power rating (computed at load, not persisted) */
  powerScore?: number;
  /** Potential crit chance baseline derived from agility + luck */
  critChance?: number;
  /** Effective EHP proxy (hp * (1 + defense/50)) */
  survivability?: number;
  };
  shape: 'circle' | 'square' | 'triangle';
  color: string;
  weaponTypes: WeaponType[];
  specialAbility?: string;
  playstyle: 'Aggressive' | 'Defensive' | 'Balanced' | 'Support' | 'Stealth';
}

export const CHARACTERS: CharacterData[] = [
  {
    id: 'wasteland_scavenger',
    name: 'Wasteland Scavenger',
    description: 'Resourceful and adaptable, thrives in harsh environments.',
    lore: 'Born in the irradiated wastelands beyond the city walls, this survivor has learned to make the most of scarce resources. Their keen eye for salvage and ability to improvise weapons from scrap makes them a formidable opponent in the cyberpunk apocalypse.',
    icon: '/assets/player/wasteland_scavenger.png',
    defaultWeapon: WeaponType.SCAVENGER_SLING,
    stats: {
      hp: 100,
      maxHp: 100,
      speed: 8.0,
      damage: 23,
      strength: 6,
      intelligence: 6,
      agility: 7,
      luck: 8,
      defense: 5,
    },
    shape: 'square',
    color: '#808080',
    weaponTypes: [WeaponType.SCAVENGER_SLING, WeaponType.RICOCHET, WeaponType.SHOTGUN],
    specialAbility: 'Scrap Master - Increased weapon effectiveness with improvised weapons',
    playstyle: 'Balanced',
  },
  {
    id: 'tech_warrior',
    name: 'Tech Warrior',
    description: 'A cybernetic fighter, excels at rapid fire and advanced weaponry.',
    lore: 'Enhanced with cutting-edge military cybernetics, this warrior represents the pinnacle of human-machine integration. Their neural implants allow for superhuman reaction times and weapon coordination.',
    icon: '/assets/player/tech_warrior.png',
  defaultWeapon: WeaponType.WARRIOR_CANNON,
    stats: {
      hp: 125,
      maxHp: 125,
      speed: 7.2,
      damage: 25,
      strength: 8,
      intelligence: 8,
      agility: 6,
      luck: 6,
      defense: 8,
    },
    shape: 'square',
    color: '#4169E1',
  weaponTypes: [WeaponType.WARRIOR_CANNON, WeaponType.TRI_SHOT, WeaponType.PLASMA, WeaponType.BEAM],
    specialAbility: 'Tech Sync - Faster reload and firing rates with advanced weapons',
    playstyle: 'Aggressive',
  },
  {
    id: 'heavy_gunner',
    name: 'Heavy Gunner',
    description: 'Unloads a barrage of sustained fire.',
    lore: 'A former military specialist who survived the cyber wars by embracing brute force. Their heavy weapons training and cybernetic enhancements allow them to wield devastating firepower that would crush ordinary humans.',
    icon: '/assets/player/heavy_gunner.png',
    defaultWeapon: WeaponType.GUNNER_MINIGUN,
    stats: {
      hp: 150,
      maxHp: 150,
      speed: 5.6,
      damage: 27,
      strength: 9,
      intelligence: 4,
      agility: 3,
      luck: 5,
      defense: 9,
    },
    shape: 'square',
    color: '#8B4513',
    weaponTypes: [WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN, WeaponType.MECH_MORTAR],
    specialAbility: 'Suppression Fire - Sustained fire that slows enemy movement',
    playstyle: 'Aggressive',
  },
  {
    id: 'cyber_runner',
    name: 'Cyber Runner',
    description: 'Lightning-fast mobility specialist with enhanced reflexes.',
    lore: 'Street-smart and cybernetically enhanced for speed, this operative excels at hit-and-run tactics. Neural boost implants provide superhuman agility and reaction time.',
    icon: '/assets/player/cyber_runner.png',
  defaultWeapon: WeaponType.RUNNER_GUN,
    stats: {
      hp: 90,
      maxHp: 90,
      speed: 9.8,
      damage: 21,
      strength: 5,
      intelligence: 7,
      agility: 11,
      luck: 8,
      defense: 4,
    },
    shape: 'triangle',
    color: '#00FF41',
  weaponTypes: [WeaponType.RUNNER_GUN, WeaponType.RICOCHET, WeaponType.BEAM, WeaponType.PLASMA],
    specialAbility: 'Speed Burst - Temporary massive speed increase',
    playstyle: 'Stealth',
  },
  {
    id: 'bio_engineer',
    name: 'Bio Engineer',
    description: 'Scientific specialist with biological weapon mastery.',
    lore: 'A former corporate scientist who turned mercenary after the bio-wars. Uses advanced biotechnology and viral weapons to devastate enemies from within.',
    icon: '/assets/player/bio_engineer.png',
  defaultWeapon: WeaponType.BIO_TOXIN,
    stats: {
      hp: 110,
      maxHp: 110,
      speed: 6.9,
      damage: 24,
      strength: 5,
      intelligence: 10,
      agility: 6,
      luck: 6,
      defense: 6,
    },
    shape: 'circle',
    color: '#39FF14',
  weaponTypes: [WeaponType.BIO_TOXIN, WeaponType.PLASMA, WeaponType.BEAM, WeaponType.SHOTGUN],
    specialAbility: 'Bio Hazard - Weapons apply damage over time effects',
    playstyle: 'Support',
  },
  {
    id: 'data_sorcerer',
    name: 'Data Sorcerer',
    description: 'Master of digital warfare and system manipulation.',
    lore: 'A legendary hacker who can bend reality through code manipulation. Their neural implants allow direct interface with digital systems, making them a walking cyber-weapon.',
    icon: '/assets/player/data_sorcerer.png',
  defaultWeapon: WeaponType.SORCERER_ORB,
    stats: {
      hp: 95,
      maxHp: 95,
      speed: 8.4,
      damage: 28,
      strength: 4,
      intelligence: 10,
      agility: 7,
      luck: 9,
      defense: 5,
    },
    shape: 'triangle',
    color: '#FF00FF',
  weaponTypes: [WeaponType.SORCERER_ORB, WeaponType.BEAM, WeaponType.PLASMA, WeaponType.TRI_SHOT],
    specialAbility: 'Code Strike - Homing projectiles that adapt to enemies',
    playstyle: 'Support',
  },
  {
    id: 'ghost_operative',
    name: 'Ghost Operative',
    description: 'Stealth specialist with cloaking technology.',
    lore: 'A shadow from the corporate espionage wars, this operative uses advanced stealth tech and precision strikes. Their identity remains classified, known only by their devastating efficiency.',
    icon: '/assets/player/ghost_operative.png',
  defaultWeapon: WeaponType.GHOST_SNIPER,
    stats: {
      hp: 80,
      maxHp: 80,
      speed: 9.0,
      damage: 42, // Increased base operative damage for one-shot synergy
      strength: 6,
      intelligence: 8,
      agility: 10, // Slight agility bump for crit scaling
      luck: 9, // Higher luck improves critChance formula
      defense: 3,
    },
    shape: 'triangle',
    color: '#708090',
  weaponTypes: [WeaponType.GHOST_SNIPER, WeaponType.RICOCHET, WeaponType.BEAM, WeaponType.TRI_SHOT],
    specialAbility: 'Phase Cloak - Temporary invisibility and damage immunity',
    playstyle: 'Stealth',
  },
  {
    id: 'neural_nomad',
    name: 'Neural Nomad',
    description: 'Psychic warrior with mind-bending abilities.',
    lore: 'A wanderer from the neural wastes, enhanced with experimental brain-computer interfaces. Their psychic abilities manifest through technological augmentation.',
    icon: '/assets/player/neural_nomad.png',
  defaultWeapon: WeaponType.NOMAD_NEURAL,
    stats: {
      hp: 105,
      maxHp: 105,
      speed: 7.6,
      damage: 26,
      strength: 5,
      intelligence: 9,
      agility: 7,
      luck: 8,
      defense: 6,
    },
    shape: 'circle',
    color: '#9370DB',
  weaponTypes: [WeaponType.NOMAD_NEURAL, WeaponType.PLASMA, WeaponType.BEAM, WeaponType.SCAVENGER_SLING],
    specialAbility: 'Neural Storm - Area effect psychic blast',
    playstyle: 'Support',
  },
  {
    id: 'psionic_weaver',
    name: 'Psionic Weaver',
    description: 'Reality manipulator with energy weaving powers.',
    lore: 'Born with natural psionic abilities, enhanced by cybernetic amplifiers. Can weave energy patterns to create devastating weapon effects and defensive barriers.',
    icon: '/assets/player/psionic_weaver.png',
  defaultWeapon: WeaponType.PSIONIC_WAVE,
    stats: {
      hp: 115,
      maxHp: 115,
      speed: 7.4,
      damage: 28,
      strength: 6,
      intelligence: 9,
      agility: 6,
      luck: 7,
      defense: 7,
    },
    shape: 'circle',
    color: '#FF69B4',
  weaponTypes: [WeaponType.PSIONIC_WAVE, WeaponType.BEAM, WeaponType.PLASMA, WeaponType.TRI_SHOT],
    specialAbility: 'Energy Weave - Projectiles gain homing and piercing effects',
    playstyle: 'Balanced',
  },
  {
    id: 'rogue_hacker',
    name: 'Rogue Hacker',
    description: 'Elite cyber-criminal with system disruption skills.',
    lore: 'Former corpo hacker turned rogue after discovering dark corporate secrets. Uses illegal ICE-breakers and viral weapons to fight the system from within.',
    icon: '/assets/player/rogue_hacker.png',
  defaultWeapon: WeaponType.HACKER_VIRUS,
    stats: {
      hp: 100,
      maxHp: 100,
      speed: 8.2,
      damage: 25,
      strength: 5,
      intelligence: 10,
      agility: 8,
      luck: 9,
      defense: 5,
    },
    shape: 'triangle',
    color: '#FF4500',
  weaponTypes: [WeaponType.HACKER_VIRUS, WeaponType.TRI_SHOT, WeaponType.BEAM, WeaponType.RICOCHET],
    specialAbility: 'System Hack - Weapons temporarily disable enemy abilities',
    playstyle: 'Support',
  },
  {
    id: 'shadow_operative',
    name: 'Shadow Operative',
    description: 'Elite assassin with lethal precision.',
    lore: 'A black ops specialist from the shadow wars, trained in every form of combat. Their cybernetic enhancements focus on lethality and tactical superiority.',
    icon: '/assets/player/shadow_operative.png',
  defaultWeapon: WeaponType.SHADOW_DAGGER,
    stats: {
      hp: 110,
      maxHp: 110,
      speed: 8.6,
      damage: 30,
      strength: 7,
      intelligence: 8,
      agility: 9,
      luck: 6,
      defense: 6,
    },
    shape: 'triangle',
    color: '#2F4F4F',
  weaponTypes: [WeaponType.SHADOW_DAGGER, WeaponType.RICOCHET, WeaponType.TRI_SHOT, WeaponType.BEAM],
    specialAbility: 'Lethal Strike - Critical hits have increased damage and effects',
    playstyle: 'Aggressive',
  },
  {
    id: 'titan_mech',
    name: 'Titan Mech',
    description: 'Heavily armored mechanical warrior with devastating firepower.',
    lore: 'A full-body cybernetic conversion, more machine than human. This walking tank sacrificed humanity for ultimate defensive capability and overwhelming firepower.',
    icon: '/assets/player/titan_mech.png',
    defaultWeapon: WeaponType.MECH_MORTAR,
    stats: {
      hp: 180,
      maxHp: 180,
      speed: 5.0,
      damage: 34,
      strength: 10,
      intelligence: 6,
      agility: 2,
      luck: 4,
      defense: 11,
    },
    shape: 'square',
    color: '#696969',
    weaponTypes: [WeaponType.MECH_MORTAR, WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN],
    specialAbility: 'Armor Plating - Reduced damage from all sources',
    playstyle: 'Defensive',
  },
];

// Normalize icon paths for file:// protocol so leading '/assets/' becomes './assets/'
if (typeof location !== 'undefined' && location.protocol === 'file:') {
  for (const c of CHARACTERS) {
    if (c.icon.startsWith('/assets/')) {
      c.icon = '.' + c.icon; // '/assets/x.png' -> './assets/x.png'
    }
  }
}

// Post-process derived stats for balance transparency
for (const c of CHARACTERS) {
  const s = c.stats;
  // Survivability: hp * (1 + defense/50)
  s.survivability = Math.round(s.hp * (1 + s.defense / 50));
  // Crit chance baseline: (agility * 0.8 + luck * 1.2) / 2 (% -> clamp)
  const crit = (s.agility * 0.8 + s.luck * 1.2) * 0.5;
  s.critChance = Math.min(60, Math.round(crit));
  // Power score: weighted blend of offensive + utility
  s.powerScore = Math.round(
    s.damage * 1.8 +
    s.strength * 1.2 +
    s.intelligence * 1.4 +
    s.agility * 1.1 +
    s.luck * 0.9 +
    s.defense * 0.8 +
    (s.speed * 3) // speed has high influence on overall power
  );
}
