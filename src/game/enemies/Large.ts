import type { Enemy } from '../EnemyManager';
import type { EnemyManager } from '../EnemyManager';

/** Configure a freshly-spawned 'large' enemy's core stats and progression scaling. */
export function configureLargeSpawn(em: EnemyManager, enemy: Enemy, gameTime: number): void {
  const late = gameTime >= 180;
  enemy.hp = late ? 900 : 480;
  enemy.maxHp = enemy.hp;
  enemy.radius = 38;
  // Very small bump to keep packs cohesive behind mediums
  // @ts-ignore
  const baseScale: number = (em as any).enemySpeedScale ?? 0.55;
  enemy.speed = 0.45 * 0.28 * baseScale; // was 0.42
  enemy.damage = 10;

  // Defensive cap before progression
  try {
    const ghostCap = 9.0 * ((window as any)?.SPEED_SCALE || 0.45);
    if ((enemy as any).speed > ghostCap) (enemy as any).speed = ghostCap;
  } catch {}

  // Progression scaling
  const minutes = Math.max(0, gameTime / 60);
  const hpMul = 1 + 0.20 * minutes + 0.03 * minutes * minutes;
  const dmgMul = 1 + 0.06 * minutes + 0.01 * minutes * minutes;
  const kbFloor = 0.50;
  const kbResist = Math.min(0.75, kbFloor + 0.05 * minutes + 0.008 * minutes * minutes);
  enemy.hp = Math.max(1, Math.round(enemy.hp * hpMul));
  enemy.maxHp = enemy.hp;
  enemy.damage = Math.max(1, Math.round(enemy.damage * dmgMul));
  (enemy as any)._kbResist = kbResist;

  // Early assistance: up to +35% at t=0, fades to 0 by 3 minutes
  const earlyBoost = 1 + Math.max(0, 0.35 * (1 - Math.min(1, minutes / 3)));
  enemy.speed *= earlyBoost;
  // Gentler late ramp
  const lateMul = 1 + Math.min(0.12, 0.010 * minutes);
  enemy.speed *= lateMul;
  // Absolute caps per type and global clamp
  try { enemy.speed = (em as any).clampToTypeCaps(enemy.speed, 'large'); } catch {}
  try {
    const ghostCap = 9.0 * ((window as any)?.SPEED_SCALE || 0.45);
    if (enemy.speed > ghostCap) enemy.speed = ghostCap;
  } catch {}
  // Brief knockback suppression early
  if (minutes < 1.0) { (enemy as any)._kbSuppressUntil = (performance.now ? performance.now() : Date.now()) + 550; }
}
