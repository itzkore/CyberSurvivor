import { Player } from './Player';

export type PassiveSpec = {
  id: number;
  name: string;
  icon?: string;
  description?: string;
  maxLevel: number;
};

export const PASSIVE_SPECS: PassiveSpec[] = [
  { id: 0, name: 'Speed Boost', icon: '/assets/ui/icons/passive_speed.png', description: 'Increase movement speed', maxLevel: 5 },
  { id: 1, name: 'Max HP', icon: '/assets/ui/icons/passive_hp.png', description: 'Increase maximum HP', maxLevel: 5 },
  { id: 2, name: 'Damage Up', icon: '/assets/ui/icons/passive_damage.png', description: 'Increase bullet damage', maxLevel: 5 },
  { id: 3, name: 'Fire Rate', icon: '/assets/ui/icons/passive_fire.png', description: 'Decrease weapon cooldown', maxLevel: 5 },
  { id: 4, name: 'AOE On Kill', icon: '/assets/ui/icons/passive_aoe.png', description: 'Small explosion on enemy death', maxLevel: 1 },
  { id: 5, name: 'Magnet', icon: '/assets/ui/icons/passive_magnet.png', description: 'Attract nearby gems', maxLevel: 3 },
  { id: 6, name: 'Shield', icon: '/assets/ui/icons/passive_shield.png', description: 'Chance to block damage', maxLevel: 3 },
  { id: 7, name: 'Crit', icon: '/assets/ui/icons/passive_crit.png', description: 'Chance for critical hits', maxLevel: 5 },
  { id: 8, name: 'Piercing', icon: '/assets/ui/icons/passive_pierce.png', description: 'Bullets pierce enemies', maxLevel: 1 },
  { id: 9, name: 'Regen', icon: '/assets/ui/icons/passive_regen.png', description: 'Regenerate HP over time', maxLevel: 5 }
];

export function applyPassive(player: Player, passiveId: number, level: number) {
  switch (passiveId) {
    case 0: // Speed Boost
      player.speed = 2.0 + (level * 0.5); // Base speed + 0.5 per level
      break;
    case 1: // Max HP
      player.maxHp = 100 + (level * 20);
      player.hp = Math.min(player.maxHp, player.hp + 20);
      break;
    case 2: // Damage Up
      player.bulletDamage = 10 + (level * 2);
      break;
    case 3: // Fire Rate
      player.fireRateModifier = 1 + (level * 0.1); // 10% faster per level
      break;
    case 4: // AOE On Kill
      (player as any).hasAoeOnKill = true; // This might need more complex logic for scaling
      break;
    case 5: // Magnet
      player.magnetRadius = 50 + (level * 10);
      break;
    case 6: // Shield
      (player as any).shieldChance = Math.min(0.5, (level * 0.05)); // Max 50% block
      break;
    case 7: // Crit
      (player as any).critChance = Math.min(0.5, (level * 0.04));
      (player as any).critMultiplier = 1.5 + (level * 0.1);
      break;
    case 8: // Piercing
      (player as any).piercing = true; // This might need more complex logic for scaling
      break;
    case 9: // Regen
      (player as any).regen = (level * 0.5); // hp per second
      break;
  }
}
