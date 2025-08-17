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
      speed: 8.4,
      damage: 24,
      strength: 6,
      intelligence: 6,
      agility: 6,
      luck: 8,
      defense: 6,
    },
    shape: 'square',
    color: '#808080',
    weaponTypes: [WeaponType.SCAVENGER_SLING, WeaponType.RICOCHET, WeaponType.SHOTGUN],
    specialAbility: 'Scrap Master - Increased weapon effectiveness with improvised weapons',
    playstyle: 'Balanced',
  },
  {
    id: 'heavy_gunner',
    name: 'Heavy Gunner',
    description: 'Unloads a barrage of sustained fire.',
    lore: 'A former military specialist who survived the cyber wars by embracing brute force. Their heavy weapons training and cybernetic enhancements allow them to wield devastating firepower that would crush ordinary humans.',
    icon: '/assets/player/heavy_gunner.png',
    defaultWeapon: WeaponType.GUNNER_MINIGUN,
    stats: {
      hp: 140,
      maxHp: 140,
      speed: 6.0,
      damage: 28,
      strength: 9,
      intelligence: 4,
      agility: 3,
      luck: 5,
      defense: 8,
    },
    shape: 'square',
    color: '#8B4513',
    weaponTypes: [WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN, WeaponType.MECH_MORTAR],
    specialAbility: 'Suppression Fire - Sustained fire that slows enemy movement',
    playstyle: 'Aggressive',
  },
  {
    id: 'tech_warrior',
    name: 'Tech Warrior',
    description: 'A cybernetic fighter, excels at rapid fire and advanced weaponry.',
    lore: 'Enhanced with cutting-edge military cybernetics, this warrior represents the pinnacle of human-machine integration. Their neural implants allow for superhuman reaction times and weapon coordination.',
    icon: '/assets/player/tech_warrior.png',
    defaultWeapon: WeaponType.TRI_SHOT,
    stats: {
      hp: 120,
      maxHp: 120,
      speed: 7.6,
      damage: 26,
      strength: 7,
      intelligence: 8,
      agility: 7,
      luck: 6,
      defense: 7,
    },
    shape: 'square',
    color: '#4169E1',
    weaponTypes: [WeaponType.TRI_SHOT, WeaponType.PLASMA, WeaponType.BEAM],
    specialAbility: 'Tech Sync - Faster reload and firing rates with advanced weapons',
    playstyle: 'Aggressive',
  },
];
