import type { EliteRuntime } from './types';

export function ensureBlockerState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'BLOCKER' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

// Blocker: periodically spawns a blocking segment between itself and player; uses ExplosionManager visuals via events.
export function updateEliteBlocker(e: any, playerX: number, playerY: number, now: number) {
  const st = ensureBlockerState(e);
  const cd = 3600; const wind = 420;
  let canAct = true; try { const gi:any=(window as any).__gameInstance; if (gi && gi.gameMode==='LAST_STAND'){ const em:any=gi.enemyManager; const vis=em?.isVisibleInLastStand?.(e.x,e.y); canAct=(vis!==false);} } catch {}
  if (!st.cdUntil) st.cdUntil = now + 1500;
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE':
      if (now >= (st.cdUntil as number)) { if (!canAct) { st.cdUntil = now + 260; break; } st.phase = 'WINDUP'; st.phaseUntil = now + wind; e._shakeUntil = st.phaseUntil; }
      break;
    case 'WINDUP':
      if (!canAct) { st.phaseUntil = now + 120; break; }
      if (now >= (st.phaseUntil as number)) {
        st.phase = 'ACTION'; st.phaseUntil = now + 100;
        try {
          const game: any = (window as any).__gameInstance;
          const mx = (e.x + playerX) * 0.5; const my = (e.y + playerY) * 0.5;
          // visual shockwave to mark barrier spawn
          game?.explosionManager?.triggerShockwave?.(mx, my, 0, 90, '#66F2FF');
          // install a soft blocker zone via blackSunZones suppression API if present
          const z = game?.enemyManager?.blackSunZones;
          if (z && typeof z.addTemporaryBarrier === 'function') {
            // Orient barrier perpendicular (90°) to the line toward the player; make it longer and thinner
            const baseAng = Math.atan2(playerY - e.y, playerX - e.x);
            const barrierAng = baseAng + Math.PI * 0.5;
            z.addTemporaryBarrier(mx, my, barrierAng, 260, 16, 1600);
          }
          // Always draw a visible barrier overlay line so players see the wall (even if zones are stubbed)
          try {
            const baseAng = Math.atan2(playerY - e.y, playerX - e.x);
            const ang = baseAng + Math.PI * 0.5; // 90° to the player line
            const halfLen = 130; // matches 260 length above
            const x0 = mx - Math.cos(ang) * halfLen;
            const y0 = my - Math.sin(ang) * halfLen;
            const x1 = mx + Math.cos(ang) * halfLen;
            const y1 = my + Math.sin(ang) * halfLen;
            const until = (now + 1600);
            // Store ephemeral draw data on enemy for EnemyManager overlay pass
            (e as any)._blockerWall = { x0, y0, x1, y1, until, w: 4 };
          } catch {}
        } catch { /* ignore */ }
      }
      break;
    case 'ACTION':
      if (now >= (st.phaseUntil as number)) { st.phase = 'RECOVER'; st.phaseUntil = now + 260; }
      break;
    case 'RECOVER':
      if (now >= (st.phaseUntil as number)) { st.phase = 'IDLE'; st.cdUntil = now + cd; }
      break;
  }
}
