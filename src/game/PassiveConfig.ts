import { Player } from './Player';
import { getHealEfficiency } from './Balance';

export type PassiveSpec = {
  id: number;
  name: string;
  icon?: string;
  description?: string;
  maxLevel: number;
};

export const PASSIVE_SPECS: PassiveSpec[] = [
  { id: 0, name: 'Speed Boost', icon: '/assets/ui/icons/passive_speed.svg', description: 'Move faster. Simple, lifesaving.', maxLevel: 5 },
  { id: 1, name: 'Max HP', icon: '/assets/ui/icons/passive_hp.svg', description: 'Bulk up your frame to take bigger hits.', maxLevel: 5 },
  { id: 2, name: 'Damage Up', icon: '/assets/ui/icons/passive_damage.svg', description: 'Global damage increase—every weapon benefits.', maxLevel: 5 },
  { id: 3, name: 'Fire Rate', icon: '/assets/ui/icons/passive_fire.svg', description: 'Reduce weapon cooldowns for more uptime.', maxLevel: 5 },
  { id: 4, name: 'AOE On Kill', icon: '/assets/ui/icons/passive_aoe.svg', description: 'Enemies you kill explode. Scales with level (damage and radius).', maxLevel: 3 },
  { id: 5, name: 'Magnet', icon: '/assets/ui/icons/passive_magnet.svg', description: 'Extend pickup radius—vacuum XP gems sooner.', maxLevel: 5 },
  { id: 6, name: 'Shield', icon: '/assets/ui/icons/passive_shield.svg', description: 'Chance to block damage completely.', maxLevel: 5 },
  { id: 7, name: 'Crit', icon: '/assets/ui/icons/passive_crit.svg', description: 'Add critical chance and multiplier.', maxLevel: 5 },
  { id: 8, name: 'Piercing', icon: '/assets/ui/icons/passive_pierce.svg', description: 'Bullets pass through more enemies.', maxLevel: 3 },
  { id: 9, name: 'Regen', icon: '/assets/ui/icons/passive_regen.svg', description: 'Slow regenerative healing over time.', maxLevel: 5 },
  { id: 10, name: 'Area Up', icon: '/assets/ui/icons/passive_area.svg', description: 'Increase area radius of suitable effects.', maxLevel: 3 },
  // New general passives
  { id: 11, name: 'Armor', icon: '/assets/ui/icons/passive_armor.svg', description: 'Reduce incoming damage.', maxLevel: 5 },
  { id: 12, name: 'Revive', icon: '/assets/ui/icons/passive_revive.svg', description: 'Survive a lethal hit. 5-minute cooldown.', maxLevel: 1 },
  { id: 13, name: 'Slow Aura', icon: '/assets/ui/icons/passive_slow.svg', description: 'Slow nearby enemies in an aura around you.', maxLevel: 3 },
  { id: 14, name: 'Overclock', icon: '/assets/ui/icons/passive_overclock.svg', description: 'Below 50% HP: increased attack speed and damage. Scales with level.', maxLevel: 3 },
  // New: Lifesteal — heal for a small fraction of damage dealt (applies to all sources)
  { id: 15, name: 'Lifesteal', icon: '/assets/ui/icons/passive_lifesteal.svg', description: 'Heal a small % of all damage dealt. 0.1% at L1 up to 0.5% at L5.', maxLevel: 5 }
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
        if (gain > 0) {
          try {
            const timeSec = (player as any)?.gameContext?.getGameTime?.() ?? (window as any)?.__gameInstance?.getGameTime?.() ?? 0;
            const eff = getHealEfficiency(timeSec);
            player.hp = Math.min(player.maxHp, player.hp + gain * 0.55 * eff);
          } catch {
            player.hp = Math.min(player.maxHp, player.hp + gain * 0.55);
          }
        } // 55% heal on added HP (slightly reduced)
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
      {
        // Scaling: per-level damage fraction and base radius (pre-Area multiplier)
        // L1: 40% dmg, 70px radius; L2: 55% dmg, 85px; L3: 70% dmg, 100px
        const lvl = Math.max(1, Math.min(3, level | 0));
        const dmgFracs = [0, 0.40, 0.55, 0.70];
        const baseRads = [0, 70, 85, 100];
        (player as any).hasAoeOnKill = true;
        (player as any).aoeOnKillLevel = lvl;
        (player as any).aoeOnKillDamageFrac = dmgFracs[lvl];
        (player as any).aoeOnKillRadiusBase = baseRads[lvl];
      }
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
    case 11: // Armor
      {
        // Simple percentage mitigation. 6% per level (L5 = 30%).
        const perLevel = 0.06;
        (player as any).armorReduction = Math.min(0.8, level * perLevel);
      }
      break;
    case 12: // Revive (L1 only)
      {
        // Flag and parameters for revive logic handled in Player.takeDamage
        (player as any).hasRevivePassive = level >= 1;
        // Expose cooldown and heal fraction so gameplay can tweak without code changes
        (player as any).reviveCooldownMs = 5 * 60 * 1000; // 5 minutes
        (player as any).reviveHealFrac = 0.6; // restore to 60% max HP
        (player as any).reviveIFramesMs = 2000; // 2s invulnerability after revive
      }
      break;
    case 13: // Slow Aura
      {
        // Store level and derived parameters; EnemyManager will apply effect in speed calc
        const lvl = Math.max(0, Math.min(3, level | 0));
        (player as any).slowAuraLevel = lvl;
  // Buff: increase radiuses by 60% (visible + effect). Now base 352px (+48px/level).
  // Note: final effective radius also scales with Area Up passive in EnemyManager.
  (player as any).slowAuraBaseRadius = 352; // 220 * 1.6
  (player as any).slowAuraRadiusPerLevel = 48; // 30 * 1.6
        (player as any).slowAuraStrength = lvl <= 0 ? 0 : (0.16 + lvl * 0.07); // L1=0.23, L2=0.30, L3=0.37
      }
      break;
    case 14: // Overclock
      {
        // Under 50% HP: gain attack speed (fire rate) and global damage multipliers.
        // Scaling: L1 = +15% fire rate, +10% damage; L2 = +25% fire rate, +16% damage; L3 = +35% fire rate, +22% damage.
        const lvl = Math.max(1, Math.min(3, level | 0));
        (player as any).overclockLevel = lvl;
        const fireRateBonuses = [0, 0.15, 0.25, 0.35]; // index by level
        const damageBonuses   = [0, 0.10, 0.16, 0.22];
        (player as any).overclockFireRateBonus = fireRateBonuses[lvl];
        (player as any).overclockDamageBonus = damageBonuses[lvl];
        // Threshold configurable in case of future tuning
        (player as any).overclockHpThreshold = 0.5; // 50%
      }
      break;
    case 15: // Lifesteal
      {
        // Fraction of damage dealt returned as healing. Nerfed by 50%: L1=0.1% -> L5=0.5%.
        const table = [0, 0.001, 0.002, 0.003, 0.004, 0.005];
        const lvl = Math.max(0, Math.min(5, level | 0));
        (player as any).lifestealFrac = table[lvl];
      }
      break;
  }
}
