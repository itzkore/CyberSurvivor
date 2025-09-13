import type { Enemy } from '../EnemyManager';
import type { EnemyManager } from '../EnemyManager';

/** Configure a freshly-spawned 'small' enemy's core stats and progression scaling. */
export function configureSmallSpawn(em: EnemyManager, enemy: Enemy, gameTime: number): void {
  const late = gameTime >= 180;
  enemy.hp = late ? 160 : 100;
  enemy.maxHp = enemy.hp;
  enemy.radius = 20;
  // Make smalls slower baseline; they should no longer outpace the player
  // Note: smalls can be scaled in Last Stand via lsSmallSpeedMul to lead the pack.
  // @ts-ignore - access private for internal tuning
  const baseScale: number = (em as any).enemySpeedScale ?? 0.55;
  // @ts-ignore
  const lsSmallSpeedMul: number = (em as any).lsSmallSpeedMul ?? 1;
  enemy.speed = (late ? 0.90 : 1.05) * 0.30 * baseScale * lsSmallSpeedMul;
  enemy.damage = 4;

  // Defensive global cap before progression (vs Ghost baseline)
  try {
    const ghostCap = 9.0 * ((window as any)?.SPEED_SCALE || 0.45);
    if ((enemy as any).speed > ghostCap) (enemy as any).speed = ghostCap;
  } catch {}

  // Progression scaling over run time
  const minutes = Math.max(0, gameTime / 60);
  // HP grows strongly into late game; tuned to ~6x at 10m
  const hpMul = 1 + 0.20 * minutes + 0.03 * minutes * minutes;
  // Damage grows modestly; tuned to ~2.6x at 10m
  const dmgMul = 1 + 0.06 * minutes + 0.01 * minutes * minutes;
  // Knockback resistance ramps up; small has floor 0.00
  const kbFloor = 0.00;
  const kbResist = Math.min(0.75, kbFloor + 0.05 * minutes + 0.008 * minutes * minutes);
  enemy.hp = Math.max(1, Math.round(enemy.hp * hpMul));
  enemy.maxHp = enemy.hp;
  enemy.damage = Math.max(1, Math.round(enemy.damage * dmgMul));
  (enemy as any)._kbResist = kbResist;

  // Speed profile: small stays almost flat; tiny late uptick only
  const smMul = 1 + Math.min(0.04, 0.004 * minutes);
  enemy.speed *= smMul;
}
