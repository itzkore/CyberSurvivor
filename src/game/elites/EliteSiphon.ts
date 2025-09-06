import type { EliteRuntime } from './types';

export function ensureSiphonState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'SIPHON' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

// Siphon: charges a beam, then fires a short drain beam toward player; highly visible via charge glow and pulse.
export function updateEliteSiphon(e: any, playerX: number, playerY: number, now: number) {
  const st = ensureSiphonState(e);
  // Longer windup for better dodge window; keep fire short
  const cd = 3600; const wind = 1100; const fire = 260;
  if (!st.cdUntil) st.cdUntil = now + 1500;
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE':
      if (now >= (st.cdUntil as number)) {
        st.phase = 'WINDUP'; st.phaseUntil = now + wind;
        // Start visible charge-up with necro green glow
        try { (window as any).__gameInstance?.explosionManager?.triggerChargeGlow?.(e.x, e.y, 110, '#AAFFBB', wind); } catch {}
        // Snapshot player's position at windup start; telegraph should NOT track the player thereafter
        (st as any)._targetX = playerX; (st as any)._targetY = playerY;
        // Mark an aiming telegraph locked to the initial player position
        (e as any)._siphonAimStart = now;
        (e as any)._siphonAimUntil = st.phaseUntil;
        (e as any)._siphonAimWidth = 10; // thinner and less obtrusive
        (e as any)._siphonAimTargetX = playerX;
        (e as any)._siphonAimTargetY = playerY;
        // Store an initial angle for any consumers that read it directly
        (e as any)._siphonAimAngle = Math.atan2(playerY - e.y, playerX - e.x);
      }
      break;
    case 'WINDUP': {
      // Do not track the player during windup; the aim remains locked to the initial snapshot
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'ACTION'; st.phaseUntil = now + fire;
        // tag beam params for draw overlay pass via enemy fields
        const tx = (st as any)._targetX ?? playerX; const ty = (st as any)._targetY ?? playerY;
        const ang = Math.atan2(ty - e.y, tx - e.x);
        e._beamUntil = st.phaseUntil; e._beamAngle = ang; e._beamWidth = 12; // slightly thinner for dodgeability
        // Stop drawing aim telegraph once beam fires
        (e as any)._siphonAimUntil = 0;
      }
      break; }
    case 'ACTION': {
      // Apply periodic damage to player if inside beam (coarse check: distance to beam line < width)
      try {
        const p: any = (window as any).__gameInstance?.player; if (p) {
          const ang = e._beamAngle || 0; const bw = e._beamWidth || 12; const len = 900;
          const dx = p.x - e.x, dy = p.y - e.y; const along = dx*Math.cos(ang) + dy*Math.sin(ang); const ortho = -dx*Math.sin(ang) + dy*Math.cos(ang);
          if (along > 0 && along < len && Math.abs(ortho) < bw) { p.takeDamage?.(Math.max(1, Math.round((e.damage||7)*0.12))); }
        }
      } catch {}
      if (now >= (st.phaseUntil as number)) { st.phase = 'RECOVER'; st.phaseUntil = now + 300; e._beamUntil = 0; }
      break; }
    case 'RECOVER':
      if (now >= (st.phaseUntil as number)) { st.phase = 'IDLE'; st.cdUntil = now + cd; }
      break;
  }
}
