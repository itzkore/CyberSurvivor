import { Player } from './Player';

export type PassiveSpec = {
  id: number;
  name: string;
  icon?: string;
  description?: string;
  maxLevel: number;
};

export const PASSIVE_SPECS: PassiveSpec[] = [
  { id: 0, name: 'Speed Boost', icon: '/assets/ui/icons/passive_speed.png', description: 'Move faster. Simple, lifesaving.', maxLevel: 5 },
  { id: 1, name: 'Max HP', icon: '/assets/ui/icons/passive_hp.png', description: 'Bulk up your frame to take bigger hits.', maxLevel: 5 },
  { id: 2, name: 'Damage Up', icon: '/assets/ui/icons/passive_damage.png', description: 'Global damage increase—every weapon benefits.', maxLevel: 5 },
  { id: 3, name: 'Fire Rate', icon: '/assets/ui/icons/passive_fire.png', description: 'Reduce weapon cooldowns for more uptime.', maxLevel: 5 },
  { id: 4, name: 'AOE On Kill', icon: '/assets/ui/icons/passive_aoe.png', description: 'Fallen enemies detonate in a small blast.', maxLevel: 1 },
  { id: 5, name: 'Magnet', icon: '/assets/ui/icons/passive_magnet.png', description: 'Extend pickup radius—vacuum XP gems sooner.', maxLevel: 5 },
  { id: 6, name: 'Shield', icon: '/assets/ui/icons/passive_shield.png', description: 'Chance to block damage completely.', maxLevel: 5 },
  { id: 7, name: 'Crit', icon: '/assets/ui/icons/passive_crit.png', description: 'Add critical chance and multiplier.', maxLevel: 5 },
  { id: 8, name: 'Piercing', icon: '/assets/ui/icons/passive_pierce.png', description: 'Bullets pass through more enemies.', maxLevel: 3 },
  { id: 9, name: 'Regen', icon: '/assets/ui/icons/passive_regen.png', description: 'Slow regenerative healing over time.', maxLevel: 5 },
  { id: 10, name: 'Area Up', icon: '/assets/ui/icons/passive_aoe.png', description: 'Increase area radius of suitable effects.', maxLevel: 3 }
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
        // Old L7 max was +3.5; redistribute to hit +3.5 at new L5 cap -> +0.7 per level
        player.speed = base + level * 0.7;
      }
      break;
    case 1: // Max HP
      {
        const base = (player as any).getBaseMaxHp ? (player as any).getBaseMaxHp() : 100;
        const prevMax = player.maxHp;
        // Old L7 total bonus was +130 (5*20 + 2*15). Redistribute to reach +130 at L5 -> +26 per level
        const linear = level * 26;
        player.maxHp = base + linear;
        const gain = player.maxHp - prevMax;
        if (gain > 0) player.hp = Math.min(player.maxHp, player.hp + gain * 0.55); // 55% heal on added HP (slightly reduced)
      }
      break;
    case 2: // Damage Up
      {
        // Old L7 total was +98% (7*14%). Redistribute to hit +98% at L5 -> +19.6% per level
        const perLevel = 0.196;
        (player as any).globalDamageMultiplier = 1 + level * perLevel;
      }
      break;
    case 3: // Fire Rate
      // Old L7 was ~+91%. Redistribute to hit the same at L5 -> +18.2% per level
      player.fireRateModifier = 1 + (level * 0.182);
      break;
    case 10: // Area Up
      {
  const perLevel = 0.10; // +10% radius per level
  const lvl = Math.min(level, 3);
  (player as any).globalAreaMultiplier = 1 + lvl * perLevel;
      }
      break;
    case 4: // AOE On Kill
      (player as any).hasAoeOnKill = true; // This might need more complex logic for scaling
      break;
    case 5: // Magnet
      player.magnetRadius = 120 + (level * 36); // Slight taper for 5-level cap
      break;
    case 6: // Shield
  // Keep prior max (L5 existed already). +5.5% per level, capped at 50%.
  (player as any).shieldChance = Math.min(0.5, (level * 0.055));
      break;
    case 7: // Crit
      {
        // Old L7 crit chance bonus was ~26.25% (7*3.75%). Redistribute to hit ~26.25% at L5 -> 5.25% per level
        const bonus = Math.min(0.55, level * 0.0525);
        (player as any).critBonus = bonus;
        // Old L7 crit multiplier was 1.5 + 0.665 = 2.165. Redistribute to reach that at L5 -> +0.133 per level
        (player as any).critMultiplier = Math.min(3.1, 1.5 + level * 0.133);
      }
      break;
    case 8: // Piercing
  // Level-based extra enemy hits after first (level 1 = +1, level 2 = +2, level 3 = +3)
  (player as any).piercing = level; // store numeric level for bullet spawn logic
      break;
    case 9: // Regen
  // Buffed: double the baseline regen and keep linear scaling — 0.25 HP/s per level
  // Level 4 => 1.0 HP/s; Level 5 => 1.25 HP/s
  (player as any).regen = level * 0.25;
      break;
  }
}
