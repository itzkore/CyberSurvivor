import { WeaponType } from '../../WeaponType';

type Tornado = {
  x:number; y:number; vx:number; vy:number;
  radius:number; dmg:number;
  tickMs:number; nextTickAt:number;
  speed:number; chaseRadius:number;
  active:boolean; created:number; lifeMs:number;
  targetId:number; lastTargetCheck:number;
};

/**
 * DataTornadoZoneManager
 * - Owns a single, chasing data tornado zone with low-cost visuals.
 * - Delegates damage and spatial queries to enemyManager.
 */
export class DataTornadoZoneManager {
  private enemyManager: any;
  private player: any;
  private tornado: Tornado | null = null;
  private cache: Map<number, HTMLCanvasElement> = new Map();

  constructor(enemyManager: any, player: any) {
    this.enemyManager = enemyManager;
    this.player = player;
  }

  spawn(x:number, y:number, params?: { radius?:number; dmg?:number; tickMs?:number; speed?:number; chaseRadius?:number; lifeMs?:number }): void {
    const now = performance.now();
    const p: any = this.player;
    const areaMul = p?.getGlobalAreaMultiplier?.() ?? (p?.globalAreaMultiplier ?? 1);
    const gdm = p?.getGlobalDamageMultiplier?.() ?? (p?.globalDamageMultiplier ?? 1);
    const radius = Math.max(60, Math.min(220, Math.round((params?.radius ?? 120) * (areaMul || 1))));
    const dmg = Math.max(6, Math.round((params?.dmg ?? 140) * (gdm || 1)));
    this.tornado = {
      x, y, vx: 0, vy: 0,
      radius, dmg,
      tickMs: Math.max(140, params?.tickMs ?? 260),
      nextTickAt: now + 200,
      speed: Math.max(40, Math.min(240, params?.speed ?? 140)),
      chaseRadius: Math.max(240, Math.min(1200, params?.chaseRadius ?? 720)),
      active: true,
      created: now,
      lifeMs: Math.max(3000, Math.min(15000, params?.lifeMs ?? 9000)),
      targetId: -1,
      lastTargetCheck: 0
    };
    try { this.enemyManager?.particleManager?.spawn(x, y, 10, '#FFE066', { sizeMin: 1, sizeMax: 2.5, lifeMs: 440, speedMin: 0.8, speedMax: 2.2 }); } catch {}
  }

  update(deltaMs:number): void {
    const t = this.tornado; if (!t || !t.active) return;
    const now = performance.now();
    if (now - t.created > t.lifeMs) { t.active = false; return; }
    // Select/refresh target every ~180ms
    if (now - t.lastTargetCheck > 180) {
      t.lastTargetCheck = now;
      let best: any = null; let bestD2 = t.chaseRadius * t.chaseRadius;
      const grid = this.enemyManager?.enemySpatialGrid;
      const candidates = grid ? grid.query(t.x, t.y, t.chaseRadius) : (this.enemyManager?.activeEnemies || []);
      for (let i=0, il=candidates.length; i<il; i++) {
        const e = candidates[i]; if (!e.active || e.hp <= 0) continue;
        const dx = e.x - t.x, dy = e.y - t.y; const d2 = dx*dx + dy*dy;
        if (d2 < bestD2) { bestD2 = d2; best = e; }
      }
      if (!best) {
        try {
          const bm: any = (window as any).__bossManager; const boss = bm?.getActiveBoss?.() ?? bm?.getBoss?.();
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') best = boss;
        } catch {}
      }
      t.targetId = best ? (best.id ?? -2) : -1;
    }
    // Move toward target (or player) with gentle acceleration
    let tx = this.player?.x ?? t.x, ty = this.player?.y ?? t.y;
    if (t.targetId !== -1) {
      let target: any = null;
      const active = this.enemyManager?.activeEnemies || [];
      for (let i=0, il=active.length; i<il; i++) { const e:any = active[i]; if (e.id === t.targetId) { target = e; break; } }
      if (!target && t.targetId === -2) {
        try { const bm: any = (window as any).__bossManager; const boss = bm?.getActiveBoss?.() ?? bm?.getBoss?.(); if (boss && boss.active) target = boss; } catch {}
      }
      if (target && target.active && target.hp > 0) { tx = target.x; ty = target.y; }
    }
    const dx = tx - t.x, dy = ty - t.y; const dist = Math.hypot(dx, dy) || 1;
    const maxStep = (t.speed * deltaMs) / 1000;
    const desiredVx = (dx / dist) * t.speed;
    const desiredVy = (dy / dist) * t.speed;
    const accel = Math.min(1, (deltaMs * 0.0025));
    t.vx += (desiredVx - t.vx) * accel;
    t.vy += (desiredVy - t.vy) * accel;
    t.x += Math.max(-maxStep, Math.min(maxStep, t.vx * deltaMs / 1000));
    t.y += Math.max(-maxStep, Math.min(maxStep, t.vy * deltaMs / 1000));
    // AoE tick
    if (now >= t.nextTickAt) {
      t.nextTickAt = now + t.tickMs;
      const r = t.radius; const r2 = r*r; const x = t.x, y = t.y; const dmg = t.dmg;
      const grid = this.enemyManager?.enemySpatialGrid;
      const cand = grid ? grid.query(x, y, r + 32) : (this.enemyManager?.activeEnemies || []);
      for (let i=0, il=cand.length; i<il; i++) {
        const e = cand[i]; if (!e.active || e.hp <= 0) continue;
        const ex = e.x - x, ey = e.y - y; if (ex > r || ex < -r || ey > r || ey < -r) continue;
        if (ex*ex + ey*ey <= r2) {
          this.enemyManager?.takeDamage?.(e, dmg, false, false, WeaponType.DATA_SIGIL, x, y, undefined, true);
          (e as any)._lastHitByWeapon = WeaponType.DATA_SIGIL;
        }
      }
      try {
        const bm: any = (window as any).__bossManager; const boss = bm?.getActiveBoss?.() ?? bm?.getBoss?.();
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const bx = boss.x - x, by = boss.y - y; if (!(bx > r || bx < -r || by > r || by < -r)) {
            if (bx*bx + by*by <= r2) this.enemyManager?.takeBossDamage?.(boss, dmg, false, WeaponType.DATA_SIGIL, x, y, undefined, true);
          }
        }
      } catch {}
      // Visual micro-shockwave (cheap)
      try {
        const game: any = (window as any).__gameInstance || (window as any).__game;
        const ex = game && game.explosionManager;
        if (ex && typeof ex.triggerShockwave === 'function') {
          ex.triggerShockwave(x, y, 0, Math.max(8, Math.min(r, 110)), '#FFEFA8');
        }
      } catch {}
    }
  }

  draw(ctx: CanvasRenderingContext2D, minX:number, maxX:number, minY:number, maxY:number): void {
    const t = this.tornado; if (!t || !t.active) return;
    if (t.x < minX || t.x > maxX || t.y < minY || t.y > maxY) return;
    const vfxLow = (this.enemyManager?.avgFrameMs || 16) > 26 || !!(window as any).__vfxLowMode;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const rr = Math.round(t.radius / 10) * 10;
    let spr: HTMLCanvasElement | null = this.cache.get(rr) || null;
    if (!spr && !vfxLow) {
      const size = rr * 2 + 24; const off = document.createElement('canvas'); off.width = size; off.height = size;
      const oc = off.getContext('2d');
      if (oc) {
        oc.save(); oc.translate(size/2, size/2); oc.globalCompositeOperation = 'lighter';
        // Swirl arcs
        const arcs = 3;
        for (let a=0;a<arcs;a++){
          const ang = a * (Math.PI*2/arcs);
          oc.globalAlpha = 0.28; oc.strokeStyle = '#FFEFA8'; oc.lineWidth = 6; oc.shadowColor = '#FFEFA8'; oc.shadowBlur = 14;
          oc.beginPath(); oc.arc(0, 0, rr * (0.72 + a*0.12), ang, ang + Math.PI*1.2); oc.stroke();
        }
        // Inner core glow
        oc.globalAlpha = 0.16; oc.fillStyle = '#FFF6C2'; oc.beginPath(); oc.arc(0,0, rr*0.5, 0, Math.PI*2); oc.fill();
        // Hatched middle circle (clipped)
        const coreR = rr * 0.42;
        oc.save();
        oc.beginPath(); oc.arc(0, 0, coreR, 0, Math.PI * 2); oc.clip();
        oc.globalAlpha = 0.22; oc.strokeStyle = '#FFD65A'; oc.lineWidth = 1;
        const step = Math.max(3, Math.floor(rr * 0.08));
        const span = coreR * 2 + 16;
        for (let s = -span; s <= span; s += step) {
          oc.beginPath(); oc.moveTo(-coreR - 12, s - coreR - 12); oc.lineTo(coreR + 12, s + coreR + 12); oc.stroke();
        }
        oc.globalAlpha = 0.15; oc.strokeStyle = '#FFE28C';
        for (let s = -span; s <= span; s += step) {
          oc.beginPath(); oc.moveTo(-coreR - 12, -s + coreR + 12); oc.lineTo(coreR + 12, -s - coreR - 12); oc.stroke();
        }
        oc.restore();
        oc.restore();
        spr = off; this.cache.set(rr, spr);
      }
    }
    if (spr && !vfxLow) {
      const nowMs = performance.now();
      const pulse = 1 + 0.05 * Math.sin(nowMs*0.01);
      const rot = nowMs * 0.0025;
      ctx.globalAlpha = 0.9; ctx.translate(t.x, t.y); ctx.rotate(rot); ctx.scale(pulse, pulse);
      ctx.drawImage(spr, -spr.width/2, -spr.height/2);
      ctx.setTransform(1,0,0,1,0,0);
    } else {
      ctx.globalAlpha = 0.18; ctx.strokeStyle = '#FFEFA8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(t.x, t.y, t.radius, 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }
}
