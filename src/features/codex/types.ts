export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface WeaponRef { id: number; name: string; rarity: Rarity }
export interface AbilityRef { id: string; name: string; cooldown: number; icon: string }
export interface PassiveRef { id: string; name: string; }

export interface Operative {
  id: string;
  name: string;
  role: 'ASSAULT' | 'CONTROL' | 'SNIPER' | 'TANK' | 'UTILITY';
  rarity: Rarity;
  portrait: string;
  hp: number;
  dmg: number;
  spd: number;
  signatureWeapon: WeaponRef;
  ability: AbilityRef;
  recommendedPassives: PassiveRef[];
  loreLocked?: boolean;
  lore?: string;
  tips?: { early: string[]; mid: string[]; late: string[] };
  synergies?: Array<{ type: 'weapon'|'passive'|'operative'; id: string | number; strength: number }>;
}
