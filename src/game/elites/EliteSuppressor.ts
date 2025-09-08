import type { EliteRuntime } from './types';

export function ensureSuppressorState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'SUPPRESSOR' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

/**
 * Elite Suppressor:
 * - Emits occasional suppression fields that briefly slow the player if standing within range.
 * - Forces repositioning without being overly punishing.
 */
export function updateEliteSuppressor(e: any, playerX: number, playerY: number, now: number) {
  const st = ensureSuppressorState(e);
  const cd = 3000;
  const pulseMs = 900;
  let canAct = true; try { const gi:any=(window as any).__gameInstance; if (gi && gi.gameMode==='LAST_STAND'){ const em:any=gi.enemyManager; const vis=em?.isVisibleInLastStand?.(e.x,e.y); canAct=(vis!==false);} } catch {}
  if (!st.cdUntil) st.cdUntil = now + 1600 + ((e.id?.length || 0) % 500);
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE': {
      if (now >= (st.cdUntil as number)) {
        if (!canAct) { st.cdUntil = now + 220; break; }
        st.phase = 'ACTION';
        st.phaseUntil = now + pulseMs;
        // Visual hint via shake
        e._shakeUntil = now + 260; e._shakeAmp = 0.8; e._shakePhase = ((e._shakePhase||0)+1);
        // Expose pulse window & radius for renderer
        const r = (e.radius || 34) + 140;
        e._supPulseStart = now;
        e._supPulseUntil = st.phaseUntil;
        e._supPulseRadius = r;
        e._supPulseColor = '#66F9FF';
      }
      break;
    }
    case 'ACTION': {
  if (!canAct) { st.phaseUntil = now + 120; break; }
      // Apply slow to player if within radius
      const r = (e.radius || 34) + 140; // decent area
      const dx = playerX - e.x; const dy = playerY - e.y;
      if (dx*dx + dy*dy <= r*r) {
        try {
          const p: any = (window as any).__gameInstance?.player || (window as any).playerInstance;
          if (p) {
            // Tag a short movement slow; Player.update should respect movementSlowUntil if present
            p.movementSlowUntil = Math.max(p.movementSlowUntil || 0, now + 650);
            p.movementSlowFrac = Math.max(p.movementSlowFrac || 0, 0.25);
          }
        } catch { /* ignore */ }
      }
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'RECOVER';
        st.phaseUntil = now + 240;
  // Clear pulse marker shortly after end (renderer guards by time)
  e._supPulseUntil = now; // expires immediately
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
