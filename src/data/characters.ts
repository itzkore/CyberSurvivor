import { WeaponType } from "../game/WeaponType";

export interface CharacterData {
  id: string;
  name: string;
  description: string;
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
  weaponTypes: WeaponType[]; // List of weapon types this character can use
}

export const CHARACTERS: CharacterData[] = [
  {
    id: 'cyber_runner',
    name: 'The Runner',
    description: 'A nimble survivor with enhanced speed and a rapid-fire weapon.',
    icon: '/assets/characters/runner_icon.png',
    defaultWeapon: WeaponType.RUNNER_GUN,
    stats: {
      hp: 80,
      maxHp: 80,
      speed: 5.5,
      damage: 8,
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
      speed: 4.2,
      damage: 12,
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
    id: 'warrior',
    name: 'The Warrior',
    description: 'A resilient fighter with high HP and a powerful, slow-firing cannon.',
    icon: '/assets/characters/warrior_icon.png',
    defaultWeapon: WeaponType.WARRIOR_CANNON,
    stats: {
      hp: 120,
      maxHp: 120,
      speed: 3.5,
      damage: 15,
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