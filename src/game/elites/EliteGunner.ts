import type { EliteRuntime, SpawnProjectileFn } from './types';

export function ensureGunnerState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'GUNNER' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

/**
 * Update behavior for Elite Gunner:
 * - Every few seconds, fires a slow, dodgeable bolt toward the player's current position.
 * - High cooldown. Projectile speed is low and radius is moderate.
 */
export function updateEliteGunner(e: any, playerX: number, playerY: number, now: number, spawnProjectile: SpawnProjectileFn, damageScale: number = 1) {
  const st = ensureGunnerState(e);
  const cd = 2800; // long cooldown between shots
  const windup = 360; // telegraph
  if (!st.cdUntil) st.cdUntil = now + 1200 + ((e.id?.length || 0) % 500);
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE': {
      if (now >= (st.cdUntil as number)) {
        st.phase = 'WINDUP';
        st.phaseUntil = now + windup;
        e._shakeUntil = now + windup; e._shakeAmp = 0.9; e._shakePhase = ((e._shakePhase||0)+1);
      }
      break;
    }
    case 'WINDUP': {
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'ACTION';
        st.phaseUntil = now + 80;
        // snapshot aim at start of fire
        const dx = (playerX - e.x); const dy = (playerY - e.y);
        const d = Math.hypot(dx, dy) || 1;
        const nx = dx / d; const ny = dy / d;
        const speed = 200; // slow bolt
        const vx = nx * speed; const vy = ny * speed;
        const dmg = Math.round((e.damage || 10) * 1.8 * damageScale);
        spawnProjectile(e.x + nx * (e.radius + 6), e.y + ny * (e.radius + 6), vx, vy, {
          radius: 10,
          damage: dmg,
          ttlMs: 4500,
          // Use a dedicated SVG sprite with glow; falls back to additive circle if not yet loaded
          spriteKey: '/assets/projectiles/elite/elite_gunner_bolt.svg',
          color: '#FFCC66',
          explodeRadius: 90,
          explodeDamage: Math.round(dmg * 0.5),
          explodeColor: '#FFCC66'
        });
      }
      break;
    }
    case 'ACTION': {
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'RECOVER';
        st.phaseUntil = now + 200;
      }
      break;
    }
    case 'RECOVER': {
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'IDLE';
        st.cdUntil = now + cd;
      }
      break;
    }
  }
}
