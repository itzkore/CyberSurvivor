import type { EliteRuntime } from './types';

// Attach runtime if missing and return it
export function ensureDasherState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'DASHER' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

/**
 * Update behavior for Elite Dasher:
 * - Performs a windup every few seconds and then a fast dash toward player for a short burst.
 * - Dash speed is applied by temporarily adding to knockback velocity fields to reuse movement.
 */
export function updateEliteDasher(e: any, playerX: number, playerY: number, now: number) {
  const st = ensureDasherState(e);
  const baseCd = 2600; // ms between dashes
  const windupMs = 280; // brief telegraph
  const dashMs = 320; // short burst
  // Last Stand: require visibility before attacking/casting
  let canAct = true;
  try {
    const gi: any = (window as any).__gameInstance; if (gi && gi.gameMode === 'LAST_STAND') {
      const em: any = gi.enemyManager; const vis = em?.isVisibleInLastStand?.(e.x, e.y);
      canAct = (vis !== false);
    }
  } catch { canAct = true; }
  if (!st.cdUntil) st.cdUntil = now + 1200 + ((e.id?.length || 0) % 400);
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE': {
      if (now >= (st.cdUntil as number)) {
        if (!canAct) { st.cdUntil = now + 220; break; }
        st.phase = 'WINDUP';
        st.phaseUntil = now + windupMs;
        // subtle shake tag for draw layer
        e._shakeUntil = now + windupMs;
        e._shakeAmp = 1.2; e._shakePhase = (e._shakePhase || 0) + 1;
      }
      break;
    }
    case 'WINDUP': {
      if (!canAct) { st.phaseUntil = now + 120; break; }
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'ACTION';
        st.phaseUntil = now + dashMs;
        // compute normalized vector to player and inject velocity as a temporary knockback vector (reuse path)
        let dx = playerX - e.x; let dy = playerY - e.y; let d = Math.hypot(dx, dy) || 1;
        dx /= d; dy /= d;
        const speed = Math.max(600, 900 - Math.min(600, d)); // closer = slightly slower to avoid instant hits
        e.knockbackVx = dx * speed; e.knockbackVy = dy * speed; e.knockbackTimer = dashMs;
        // enforce brief suppression window so other knockbacks don't cancel the dash instantly
        e._kbSuppressUntil = now + dashMs - 40;
      }
      break;
    }
    case 'ACTION': {
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'RECOVER';
        st.phaseUntil = now + 260;
      }
      break;
    }
    case 'RECOVER': {
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'IDLE';
        st.cdUntil = now + baseCd;
      }
      break;
    }
  }
}
