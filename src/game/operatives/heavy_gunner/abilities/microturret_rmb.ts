import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';
import { mouseState } from '../../../keyState';
import { WeaponType } from '../../../WeaponType';
import { WEAPON_SPECS } from '../../../WeaponConfig';

type TurretState = { x:number;y:number;spawn:number;next:number;range:number;level:number;faceA:number; side:number } | null;

const COOLDOWN_MS = 20000;
const RELOCATE_COOLDOWN_MS = 5000; // After initial placement, RMB can relocate only after 5s
const RANGE = 520;

function ensureHudGetter(p: any, getRemain: () => number, isActive: () => boolean) {
  if (!p.getGunnerTurret) {
    p.getGunnerTurret = function() {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const max = COOLDOWN_MS; const remain = Math.max(0, getRemain());
      return { value: (max - remain), max, ready: remain<=0, active: !!isActive() };
    };
  }
}

export const MicroTurretRMB: AbilityDescriptor = {
  key: 'RMB',
  id: 'gunner_micro_turret',
  getMeter: (p: Player) => (p as any).getGunnerTurret?.() ?? null,
  update: (p: Player & any, dtMs: number) => {
    const g: any = (p as any).gameContext || (window as any).__gameInstance;
    if (!g) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // state bag
    if (!(p as any).__hgTurret) { (p as any).__hgTurret = { turret: null as TurretState, cooldownUntil: 0, periodMs: 160, image: undefined as HTMLImageElement|undefined }; }
    const S = (p as any).__hgTurret as { turret: TurretState; cooldownUntil:number; periodMs:number; image?:HTMLImageElement };

    // preload image once (normalized path)
    try {
      if (!S.image && g.assetLoader?.loadImage) {
        const AL = (window as any).AssetLoader;
        const raw = '/assets/turrets/turret_gunner.png';
        const path = AL ? AL.normalizePath(raw) : raw;
        g.assetLoader.loadImage(path).then((img:HTMLImageElement)=>S.image=img).catch(()=>{});
      }
    } catch {}

    // bind HUD getter
    ensureHudGetter(p, () => Math.max(0, S.cooldownUntil - now), () => !!S.turret);

    // Input sampling
  const mouse = mouseState; const rDown = !!mouse.right;
    const edge = (()=>{ const prev = (p as any).__hgPrevR || false; (p as any).__hgPrevR = rDown; return rDown && !prev; })();
    const rawMx = mouse.x || 0, rawMy = mouse.y || 0; const camX = g.camX || 0, camY = g.camY || 0; const worldX = rawMx + camX, worldY = rawMy + camY;
    // Helper: clamp target to walkable interior to avoid placing on palisades/holders/etc.
    const clampToWalkable = (x:number, y:number) => {
      try {
        const rm:any = g.roomManager || (window as any).__roomManager;
        if (rm && typeof rm.clampToWalkable === 'function') {
          const c = rm.clampToWalkable(x, y, 14, 'player');
          return { x: c.x, y: c.y };
        }
      } catch {}
      return { x, y };
    };

    // RMB behavior: place or relocate
    if (edge) {
      const hasTurret = !!S.turret;
      const canPlace = now >= S.cooldownUntil;
      const canRelocate = hasTurret && (now - (S.turret as any).spawn) >= RELOCATE_COOLDOWN_MS;
      if (!hasTurret && canPlace) {
        const level = (()=>{ try { return p.weaponLevels?.GUNNER_MINIGUN || p.weaponLevel || 1; } catch { return 1; } })();
        S.periodMs = resolveMinigunPeriod(level);
        // Initialize turret with alternating muzzle side (-1 left, +1 right)
        const pos = clampToWalkable(worldX, worldY);
        (S as any).turret = { x: pos.x, y: pos.y, spawn: now, next: now + 200, range: RANGE, level, faceA: 0, side: -1 };
        S.cooldownUntil = now + COOLDOWN_MS;
        try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: pos.x, y: pos.y, color:'#FF8C3B', r:120 } })); } catch {}
      } else if (canRelocate) {
        const t = S.turret as any; if (t) {
          const pos = clampToWalkable(worldX, worldY);
          t.x = pos.x; t.y = pos.y; t.spawn = now; t.next = now + 120; // small settle time before next shot
          try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: pos.x, y: pos.y, color:'#FF8C3B', r:120 } })); } catch {}
        }
      }
    }

  const t = S.turret as any; if (!t) return;
    if (now >= t.next) {
      t.next = now + getAdjustedPeriodMs(p, S.periodMs);
      const em:any = g.enemyManager; const list = (typeof em.queryEnemies === 'function') ? em.queryEnemies(t.x, t.y, t.range) : (em.getEnemies?.() || []);
      const isVisibleLS = (ex:number,ey:number)=>{ try{ return em.isVisibleInLastStand ? em.isVisibleInLastStand(ex,ey) : true; }catch{ return true; } };
      let best:any=null; let bd2=Infinity;
      for (let i=0;i<list.length;i++) {
        const e:any = list[i]; if (!e || !e.active || e.hp<=0) continue; if (!isVisibleLS(e.x, e.y)) continue;
        const dx=e.x-t.x, dy=e.y-t.y; const d2=dx*dx+dy*dy; if (d2>t.range*t.range) continue; if (d2<bd2){ bd2=d2; best=e; t.faceA = Math.atan2(dy, dx); }
      }
      if (best) fireAt(g, p, S, best.x, best.y);
    }
  },
  drawWorld: (p: Player & any, ctx: CanvasRenderingContext2D) => {
    const S = (p as any).__hgTurret as { turret: TurretState; image?:HTMLImageElement } | undefined; if (!S || !S.turret) return;
    const t:any = S.turret;
    // World-space context: Game.ts already applied scale and -cam translation.
    ctx.save();
    ctx.translate(t.x, t.y);
    // Removed temporary ground shadow per request
    if (S.image) {
      const sz = 36;
      ctx.save();
      // PNG needs +90° clockwise rotation to align with facing
      ctx.rotate(t.faceA + Math.PI/2);
      ctx.drawImage(S.image, -sz/2, -sz/2, sz, sz);
      ctx.restore();
    }
    else { ctx.fillStyle = '#AA6633'; ctx.beginPath(); ctx.arc(0,0, 14, 0, Math.PI*2); ctx.fill(); ctx.strokeStyle = '#FFD199'; ctx.lineWidth = 2; ctx.stroke(); ctx.save(); ctx.rotate(t.faceA); ctx.fillStyle = '#663300'; ctx.fillRect(0, -3, 18, 6); ctx.restore(); }
    try { ctx.globalAlpha = 0.08; ctx.strokeStyle = '#FFAA66'; ctx.beginPath(); ctx.arc(0,0, RANGE, 0, Math.PI*2); ctx.stroke(); } catch {}
    ctx.restore();
  },
  drawOverlay: (p: Player & any, ctx: CanvasRenderingContext2D) => {
    const S = (p as any).__hgTurret as { turret: TurretState; cooldownUntil:number } | undefined; if (!S) return;
    const g:any = (p as any).gameContext || (window as any).__gameInstance; const now = (typeof performance!=='undefined'?performance.now():Date.now()); const remain = Math.max(0, (S.cooldownUntil||0) - now); const max = COOLDOWN_MS; const frac = 1 - Math.max(0, Math.min(1, remain / max));
    const camX=g.camX||0, camY=g.camY||0, rs=g.renderScale||1, W=g.canvas?.width||g.designWidth||1280, H=g.canvas?.height||g.designHeight||720;
    const sx = (p.x - camX) * rs; const sy = (p.y - camY) * rs;
    ctx.save(); ctx.lineWidth = 3 * rs; ctx.strokeStyle = remain<=0 ? '#FFAA66' : '#FFCC99';
    ctx.beginPath(); ctx.arc(sx, sy, 24 * rs, -Math.PI/2, -Math.PI/2 + frac * Math.PI*2); ctx.stroke();
    if (S.turret) {
      const tx = ((S.turret as any).x - camX) * rs; const ty = ((S.turret as any).y - camY) * rs; const inside = tx >= 0 && ty >= 0 && tx <= W*rs && ty <= H*rs;
      ctx.globalCompositeOperation = 'screen';
      if (inside) { ctx.strokeStyle = 'rgba(255,200,120,0.9)'; ctx.beginPath(); ctx.arc(tx, ty, 16 * rs, 0, Math.PI*2); ctx.stroke(); }
      else {
        const cx = (W*rs)/2, cy = (H*rs)/2; let dx=tx-cx, dy=ty-cy; const d=Math.max(0.001, Math.hypot(dx,dy)); dx/=d; dy/=d;
        const margin = 20 * rs; const halfW=cx-margin, halfH=cy-margin; const t=Math.min(Math.abs(halfW/dx)||9999, Math.abs(halfH/dy)||9999); const px=cx+dx*t, py=cy+dy*t;
        ctx.translate(px, py); const ang = Math.atan2(dy, dx); ctx.rotate(ang); const s = 14 * rs; ctx.fillStyle = 'rgba(255,200,120,0.9)'; ctx.beginPath(); ctx.moveTo(s,0); ctx.lineTo(-s*0.6, s*0.6); ctx.lineTo(-s*0.3,0); ctx.lineTo(-s*0.6,-s*0.6); ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
};

function getAdjustedPeriodMs(p:any, base:number): number {
  try {
    const gh = typeof p.getGunnerHeat === 'function' ? p.getGunnerHeat() : null;
    const t = (gh && gh.active && typeof p.getGunnerPowerT === 'function') ? Math.max(0, Math.min(1, p.getGunnerPowerT())) : 0;
    const rateMul = 1 + (p.gunnerBoostFireRate - 1) * t;
    return Math.max(40, Math.round(base / Math.max(1e-3, rateMul)));
  } catch { return base; }
}

function resolveMinigunPeriod(level:number): number { const base = 160; return Math.max(60, Math.round(base * Math.pow(0.95, Math.max(0, level-1)))); }

function fireAt(g:any, p:any, S:any, tx:number, ty:number) {
  const t = S.turret; if (!t) return;
  try {
    const WT:any = (window as any).WeaponType;
    const wType = WT?.GUNNER_MINIGUN ?? WeaponType.GUNNER_MINIGUN;
    // Base turret damage: exactly half of the minigun's per-shot damage at current level
    let dmg = 1;
    try {
      const lvl = Math.max(1, Math.min(7, (t.level || 1)));
      const spec = WEAPON_SPECS[wType as WeaponType];
      const basePerShot = (() => {
        if (spec?.getLevelStats) {
          const stats = spec.getLevelStats(lvl) as any;
          if (stats && typeof stats.damage === 'number') return stats.damage as number;
        }
        return (spec?.damage ?? 12) as number;
      })();
      dmg = Math.max(1, Math.round(basePerShot * 0.5));
    } catch {}
    try {
      const gh = p?.getGunnerHeat?.(); if (gh?.active && typeof p.getGunnerPowerT === 'function') { const tPow = p.getGunnerPowerT(); dmg = Math.round(dmg * (1 + (p.gunnerBoostDamage - 1) * tPow)); }
    } catch {}
    // Compute alternating left/right muzzle offset relative to aim
    const ang = Math.atan2(ty - t.y, tx - t.x);
    t.faceA = ang;
    // Ensure side toggle exists
    if ((t as any).side !== 1 && (t as any).side !== -1) (t as any).side = -1;
    const baseCos = Math.cos(ang), baseSin = Math.sin(ang);
    const perpX = -baseSin, perpY = baseCos;
    const sideOffset = 12; // visual barrel separation for turret
    const forwardNudge = 8; // small forward muzzle nudge
    const originX = t.x + perpX * sideOffset * (t as any).side + baseCos * forwardNudge;
    const originY = t.y + perpY * sideOffset * (t as any).side + baseSin * forwardNudge;
    const b = g.bulletManager?.spawnBullet?.(originX, originY, tx, ty, wType, dmg, t.level, 'TURRET');
    if (b) {
      try { const vis:any = (b as any).projectileVisual || {}; const size = vis.size || (vis.thickness || 6); if (typeof size === 'number') vis.size = Math.max(1, Math.round(size * 0.7)); (b as any).projectileVisual = vis; } catch {}
      const sp = Math.max(0.0001, Math.hypot((b as any).vx||0, (b as any).vy||0));
      try { const gh = p?.getGunnerHeat?.(); let extra = 0; if (gh?.active && typeof p.getGunnerPowerT === 'function') { const tPow = p.getGunnerPowerT(); extra = (p.gunnerBoostRange - 1) * tPow; } const reach = t.range * (1 + extra); const ttlMs = Math.round(1000 * (reach / sp)); (b as any).ttl = Math.min((b as any).ttl || ttlMs, ttlMs); } catch {}
    }
    // Flip side for next shot
    (t as any).side *= -1;
  } catch {}
}

