/**
 * Consistent helpers for global ability scaling.
 * Use these instead of accessing player.global* directly to avoid drift.
 */
export function getDamageMul(player: any): number {
  try { return player?.getGlobalDamageMultiplier?.() ?? (player?.globalDamageMultiplier ?? 1); } catch { return 1; }
}

export function getAreaMul(player: any): number {
  try { return player?.getGlobalAreaMultiplier?.() ?? (player?.globalAreaMultiplier ?? 1); } catch { return 1; }
}

export function scaleDamage(base: number, player: any): number {
  const mul = getDamageMul(player) || 1;
  return Math.max(0, Math.round(base * mul));
}

export function scaleRadius(base: number, player: any): number {
  const mul = getAreaMul(player) || 1;
  return Math.max(0, Math.round(base * mul));
}
