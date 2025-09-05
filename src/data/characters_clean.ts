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
  description: 'Turns ruin into salvation. Tethers a Scrap‑Saw and detonates scrap surges to endure.',
  lore: 'They were raised where the wind howls through hollowed towers and the ground cuts like glass. A length of cable, a motor, a blade—call it a weapon, call it a promise. The Scrap‑Saw hums like a heartbeat, tethered to a survivor who refuses to break. When the world closes in, they kindle a blast from the wreckage and patch their wounds with the memory of those who didn’t make it.',
    icon: '/assets/player/wasteland_scavenger.png',
  // defaultWeapon removed: Scrap Lash retired
  defaultWeapon: WeaponType.RICOCHET,
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
  weaponTypes: [WeaponType.RICOCHET, WeaponType.SHOTGUN],
  specialAbility: 'Scrap Surge — Build scrap, unleash a protective blast, and self‑repair +5 HP',
    playstyle: 'Balanced',
  },
  {
    id: 'heavy_gunner',
    name: 'Heavy Gunner',
  description: 'A moving bastion who drowns the field in suppressive storms of lead.',
  lore: 'They were the last to retreat and the first to return. Carbon wrists, tungsten spine, barrels etched with the names they couldn’t save. When the minigun spins up, the world slows under the weight of it—every step a shield for those behind, every burst a promise that nobody else falls today.',
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
  specialAbility: 'Suppression Matrix — Sustained fire that slows enemy movement',
    playstyle: 'Aggressive',
  },
  {
    id: 'tech_warrior',
    name: 'Tech Warrior',
  description: 'Spearheads battles with tachyon lances and collapses threats with singularity tech.',
  lore: 'The last prototype to walk out of a black‑site lab, wired with reflex lattices that taste the future half a second early. Tachyon spears stitch the air with blue fire; singularities blossom like iron flowers. They fight with a scientist’s precision and a soldier’s heart—measured, decisive, unstoppable.',
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
    weaponTypes: [WeaponType.TRI_SHOT, WeaponType.PLASMA],
  specialAbility: 'Tech Sync - Faster reload and firing rates with advanced weapons',
    playstyle: 'Aggressive',
  },
];
