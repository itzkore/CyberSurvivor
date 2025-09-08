import type { EliteRuntime, SpawnProjectileFn } from './types';

export function ensureBlinkerState(e: any): EliteRuntime {
  if (!e._elite) e._elite = { kind: 'BLINKER' } as EliteRuntime;
  return e._elite as EliteRuntime;
}

// Blinker: teleports near the player after a glow, then short dash slash.
export function updateEliteBlinker(e: any, playerX: number, playerY: number, now: number, spawnProjectile?: SpawnProjectileFn) {
  const st = ensureBlinkerState(e);
  // Randomize cadence slightly so groups desync and feel less uniform
  const baseCd = 2400; const cdJitter = 360; // ±360ms
  const cd = baseCd + (Math.random() * 2 - 1) * cdJitter;
  const wind = 360; const slashMs = 180;
  let canAct = true; try { const gi:any=(window as any).__gameInstance; if (gi && gi.gameMode==='LAST_STAND'){ const em:any=gi.enemyManager; const vis=em?.isVisibleInLastStand?.(e.x,e.y); canAct=(vis!==false);} } catch {}
  if (!st.cdUntil) st.cdUntil = now + 1000;
  if (!st.phase) st.phase = 'IDLE';
  switch (st.phase) {
    case 'IDLE':
      if (now >= (st.cdUntil as number)) { if (!canAct) { st.cdUntil = now + 220; break; } st.phase = 'WINDUP'; st.phaseUntil = now + wind; e._blinkTelegraphUntil = st.phaseUntil; }
      break;
    case 'WINDUP':
      if (!canAct) { st.phaseUntil = now + 120; break; }
      if (now >= (st.phaseUntil as number)) {
  // Teleport to a safer ring around the player (not strictly behind), further away for readability.
  const ang = Math.random()*Math.PI*2; const r = 340 + Math.random()*120; // 340..460px
        e.x = playerX + Math.cos(ang)*r; e.y = playerY + Math.sin(ang)*r;
        st.phase = 'ACTION'; st.phaseUntil = now + slashMs;
        // small forward slash toward player via knockback reuse
        let dx = playerX - e.x, dy = playerY - e.y; let d = Math.hypot(dx,dy)||1; dx/=d; dy/=d; const speed = 900; e.knockbackVx = dx*speed; e.knockbackVy = dy*speed; e.knockbackTimer = slashMs; e._kbSuppressUntil = now + slashMs;
      }
      break;
    case 'ACTION':
      if (now >= (st.phaseUntil as number)) { st.phase = 'RECOVER'; st.phaseUntil = now + 240; }
      break;
    case 'RECOVER':
      if (now >= (st.phaseUntil as number)) {
        // Randomly fire a tiny, highly-visible bullet toward player after blink/strike
        if (spawnProjectile && Math.random() < 0.55) {
          const dx = playerX - e.x, dy = playerY - e.y; const d = Math.hypot(dx,dy) || 1; const nx = dx/d, ny = dy/d;
          const spd = 320; // small but readable
          const dmg = Math.max(1, Math.round((e.damage || 6) * 0.6));
          spawnProjectile(e.x + nx * (e.radius + 4), e.y + ny * (e.radius + 4), nx*spd, ny*spd, {
            radius: 6,
            damage: dmg,
            ttlMs: 2200,
            spriteKey: '/assets/projectiles/elite/elite_blinker_shot.svg',
            color: '#CC99FF'
          });
        }
        st.phase = 'IDLE'; st.cdUntil = now + cd;
      }
      break;
  }
}
