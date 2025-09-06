import type { EliteRuntime, SpawnProjectileFn } from './types';

export function ensureBomberState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'BOMBER' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

// Bomber: tosses slow arcing bombs that explode with a big readable ring.
export function updateEliteBomber(e: any, playerX: number, playerY: number, now: number, spawnProjectile: SpawnProjectileFn, dmgScale: number = 1) {
  const st = ensureBomberState(e);
  const cd = 3200; const wind = 420;
  if (!st.cdUntil) st.cdUntil = now + 1200;
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE':
      if (now >= (st.cdUntil as number)) { st.phase = 'WINDUP'; st.phaseUntil = now + wind; e._shakeUntil = st.phaseUntil; e._shakeAmp = 1.0; }
      break;
    case 'WINDUP':
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'ACTION'; st.phaseUntil = now + 80;
        const dx = (playerX - e.x), dy = (playerY - e.y); const d = Math.hypot(dx, dy) || 1; const nx = dx/d, ny = dy/d;
        // lob: slow speed, long ttl, explodes with big ring
        const speed = 160; const vx = nx*speed, vy = ny*speed;
        const dmg = Math.round((e.damage||8) * 2.2 * dmgScale);
        spawnProjectile(e.x + nx*(e.radius+6), e.y + ny*(e.radius+6), vx, vy, { radius: 12, damage: dmg, ttlMs: 1800, spriteKey: undefined, color: '#FFDD55', explodeRadius: 120, explodeDamage: Math.round(dmg*0.9), explodeColor: '#FFAA33' });
      }
      break;
    case 'ACTION':
      if (now >= (st.phaseUntil as number)) { st.phase = 'RECOVER'; st.phaseUntil = now + 220; }
      break;
    case 'RECOVER':
      if (now >= (st.phaseUntil as number)) { st.phase = 'IDLE'; st.cdUntil = now + cd; }
      break;
  }
}
