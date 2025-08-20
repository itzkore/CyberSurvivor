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
  { id: 8, name: 'Piercing', icon: '/assets/ui/icons/passive_pierce.png', description: 'Bullets pierce enemies (up to 3 levels)', maxLevel: 3 },
  { id: 9, name: 'Regen', icon: '/assets/ui/icons/passive_regen.png', description: 'Regenerate HP over time', maxLevel: 5 }
];

// Normalize asset paths for file:// protocol (Electron packaged)
if (typeof location !== 'undefined' && location.protocol === 'file:') {
  for (const p of PASSIVE_SPECS) {
    if (p.icon && p.icon.startsWith('/assets/')) p.icon = '.' + p.icon; // becomes ./assets/...
  }
}

export function applyPassive(player: Player, passiveId: number, level: number) {
  switch (passiveId) {
    case 0: // Speed Boost
      // Additive: +0.5 per level over innate base (do not stack on previous passive applications)
      {
        const base = (player as any).getBaseMoveSpeed ? (player as any).getBaseMoveSpeed() : player.speed;
        player.speed = base + level * 0.5;
      }
      break;
    case 1: // Max HP
      {
        const base = (player as any).getBaseMaxHp ? (player as any).getBaseMaxHp() : 100;
        const prevMax = player.maxHp;
        player.maxHp = base + level * 20;
        // Increase current HP proportionally to the gained max (heals only the delta)
        const gain = player.maxHp - prevMax;
        if (gain > 0) player.hp = Math.min(player.maxHp, player.hp + gain * 0.6); // partial heal (60% of increase)
      }
      break;
    case 2: // Damage Up
      {
  // Global percent damage: +15% per level (multiplicative)
  const perLevel = 0.15;
  (player as any).globalDamageMultiplier = 1 + level * perLevel;
      }
      break;
    case 3: // Fire Rate
      player.fireRateModifier = 1 + (level * 0.15); // 15% faster per level (buffed for clearer impact)
      break;
    case 4: // AOE On Kill
      (player as any).hasAoeOnKill = true; // This might need more complex logic for scaling
      break;
    case 5: // Magnet
      player.magnetRadius = 120 + (level * 40); // greatly increased collection area
      break;
    case 6: // Shield
      (player as any).shieldChance = Math.min(0.5, (level * 0.05)); // Max 50% block
      break;
    case 7: // Crit
      {
        const bonus = Math.min(0.5, level * 0.04); // bonus (0..0.5)
        (player as any).critBonus = bonus; // store as normalized bonus probability (not percent)
        (player as any).critMultiplier = Math.min(3.0, 1.5 + level * 0.1); // soft cap 3x
      }
      break;
    case 8: // Piercing
  // Level-based extra enemy hits after first (level 1 = +1, level 2 = +2, level 3 = +3)
  (player as any).piercing = level; // store numeric level for bullet spawn logic
      break;
    case 9: // Regen (scaled down by 75%)
      // Previously 0.5 * level HP/s. Reduced to 0.125 * level (25% of prior) for balance.
      (player as any).regen = (level * 0.125); // hp per second
      break;
  }
}
