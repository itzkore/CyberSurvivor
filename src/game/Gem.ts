export interface Gem {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // deprecated frame-based lifetime (to be removed after migration)
  lifeMs?: number; // millisecond-based lifetime
  size: number;
  value: number; // XP value granted on pickup
  active: boolean;
  tier: number;  // 1..5
  color: string; // render color
}

export interface GemTierSpec {
  tier: number;
  value: number;
  color: string;
  merge: number; // how many of this tier auto-convert into next tier
}

// Ordered ascending by tier
export const GEM_TIERS: GemTierSpec[] = [
  { tier: 1, value: 1,  color: '#FFD700', merge: 8 }, // Small Shard (require more to merge)
  { tier: 2, value: 3,  color: '#00FFA8', merge: 7 }, // Core Fragment
  { tier: 3, value: 8,  color: '#7F5BFF', merge: 6 }, // Data Crystal (rarely reached)
  { tier: 4, value: 20, color: '#C400FF', merge: Infinity }, // Disable auto-merge into Tier 5
  { tier: 5, value: 50, color: '#FF5E2E', merge: Infinity } // No further merges
];

export function getGemTierSpec(tier: number): GemTierSpec {
  return GEM_TIERS[Math.min(GEM_TIERS.length - 1, Math.max(0, tier - 1))];
}
