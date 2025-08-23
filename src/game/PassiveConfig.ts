import { Player } from './Player';

export type PassiveSpec = {
  id: number;
  name: string;
  icon?: string;
  description?: string;
  maxLevel: number;
};

export const PASSIVE_SPECS: PassiveSpec[] = [
  { id: 0, name: 'Speed Boost', icon: '/assets/ui/icons/passive_speed.png', description: 'Move faster. Simple, lifesaving.', maxLevel: 7 },
  { id: 1, name: 'Max HP', icon: '/assets/ui/icons/passive_hp.png', description: 'Bulk up your frame to take bigger hits.', maxLevel: 7 },
  { id: 2, name: 'Damage Up', icon: '/assets/ui/icons/passive_damage.png', description: 'Global damage increase—every weapon benefits.', maxLevel: 7 },
  { id: 3, name: 'Fire Rate', icon: '/assets/ui/icons/passive_fire.png', description: 'Reduce weapon cooldowns for more uptime.', maxLevel: 7 },
  { id: 4, name: 'AOE On Kill', icon: '/assets/ui/icons/passive_aoe.png', description: 'Fallen enemies detonate in a small blast.', maxLevel: 1 },
  { id: 5, name: 'Magnet', icon: '/assets/ui/icons/passive_magnet.png', description: 'Extend pickup radius—vacuum XP gems sooner.', maxLevel: 5 },
  { id: 6, name: 'Shield', icon: '/assets/ui/icons/passive_shield.png', description: 'Chance to block damage completely.', maxLevel: 5 },
  { id: 7, name: 'Crit', icon: '/assets/ui/icons/passive_crit.png', description: 'Add critical chance and multiplier.', maxLevel: 7 },
  { id: 8, name: 'Piercing', icon: '/assets/ui/icons/passive_pierce.png', description: 'Bullets pass through more enemies.', maxLevel: 3 },
  { id: 9, name: 'Regen', icon: '/assets/ui/icons/passive_regen.png', description: 'Slow regenerative healing over time.', maxLevel: 7 },
  { id: 10, name: 'Area Up', icon: '/assets/ui/icons/passive_aoe.png', description: 'Increase area radius of suitable effects.', maxLevel: 7 }
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
      // Additive: +0.5 per level over innate base speed (keeps progression linear as tests expect)
      {
        const base = (player as any).getBaseMoveSpeed ? (player as any).getBaseMoveSpeed() : player.speed;
        player.speed = base + level * 0.5;
      }
      break;
    case 1: // Max HP
      {
        const base = (player as any).getBaseMaxHp ? (player as any).getBaseMaxHp() : 100;
        const prevMax = player.maxHp;
        // Slight diminishing after level 5: levels 1-5 +20 each, 6-7 +15 each
        const linear = Math.min(level,5) * 20 + Math.max(0, level-5) * 15;
        player.maxHp = base + linear;
        const gain = player.maxHp - prevMax;
        if (gain > 0) player.hp = Math.min(player.maxHp, player.hp + gain * 0.55); // 55% heal on added HP (slightly reduced)
      }
      break;
    case 2: // Damage Up
      {
        // Global percent damage: +14% per level (slightly reduced scaling for added tiers)
        const perLevel = 0.14;
        (player as any).globalDamageMultiplier = 1 + level * perLevel;
      }
      break;
    case 3: // Fire Rate
      // 13% faster per level with extended cap (L7 ~ +91%)
      player.fireRateModifier = 1 + (level * 0.13);
      break;
    case 10: // Area Up
      {
        const perLevel = 0.10; // +10% radius per level
        (player as any).globalAreaMultiplier = 1 + level * perLevel;
      }
      break;
    case 4: // AOE On Kill
      (player as any).hasAoeOnKill = true; // This might need more complex logic for scaling
      break;
    case 5: // Magnet
      player.magnetRadius = 120 + (level * 36); // Slight taper for 5-level cap
      break;
    case 6: // Shield
      (player as any).shieldChance = Math.min(0.5, (level * 0.055)); // Reaches cap a bit earlier with 5 levels
      break;
    case 7: // Crit
      {
        const bonus = Math.min(0.55, level * 0.0375); // up to 55% at L7
        (player as any).critBonus = bonus;
        (player as any).critMultiplier = Math.min(3.1, 1.5 + level * 0.095); // slight growth, soft cap 3.1x
      }
      break;
    case 8: // Piercing
  // Level-based extra enemy hits after first (level 1 = +1, level 2 = +2, level 3 = +3)
  (player as any).piercing = level; // store numeric level for bullet spawn logic
      break;
    case 9: // Regen
      // Keep conservative. Slight taper after L5.
      const baseRate = Math.min(level,5) * 0.125 + Math.max(0, level-5) * 0.09;
      (player as any).regen = baseRate;
      break;
  }
}
