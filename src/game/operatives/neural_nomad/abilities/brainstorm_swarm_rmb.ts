import { WEAPON_SPECS } from '../../../WeaponConfig';
import { WeaponType } from '../../../WeaponType';
// no sounds for this ability per design

type Drone = { ang: number; next: number };

/** Neural Nomad RMB — Brainstorm Swarm (Boomerang)
 * Sends micro‑drones from the Nomad to the clicked world position and back.
 * - Drones auto‑fire smart needles while traveling.
 * - No fixed duration; cooldown (15s) starts only after all drones return.
 * - Drone count scales: +1 at levels 5 and 7 (cap 6). Small launch radius bump accordingly.
 */
export class BrainstormSwarmRMB {
  private game: any;
  private player: any;
  private cdUntil = 0;
  private drones: Drone[] = [];
  private phase: 'idle' | 'outbound' | 'inbound' = 'idle';
  private destX = 0; private destY = 0;
  private centerX = 0; private centerY = 0; // orbit center moves along path
  private orbitR = 44;                       // active orbit radius
  private orbitW = 2.2;                      // rad/s angular velocity

  // Tunables
  private readonly cooldownMs = 15000; // 15s after return
  private readonly firePeriodMs = 500;
  private readonly targetRange = 900;
  private speedOut = 260;   // px/s
  private speedIn = 320;    // px/s (slightly faster return)
  private orbitRBase = 44;  // base orbit radius (scaled by level bumps)

  constructor(game: any, player: any) { this.game = game; this.player = player; }

  public getMeter(nowMs: number): { value: number; max: number; ready: boolean; active: boolean } {
    const max = this.cooldownMs;
    const remain = Math.max(0, this.cdUntil - nowMs);
    const active = this.phase !== 'idle';
    const ready = remain <= 0 && !active;
    return { value: (max - remain), max, ready, active };
  }

  public isActive(): boolean { return this.phase !== 'idle'; }

  private getWeaponLevel(p: any): number {
    try { return Math.max(1, (p.activeWeapons?.get?.(WeaponType.NOMAD_NEURAL)) ?? (p.weaponLevel || 1)); } catch { return 1; }
  }

  private getDroneCount(lvl: number): number {
    let n = 4;
    if (lvl >= 5) n += 1;
    if (lvl >= 7) n += 1;
    return Math.min(6, n);
  }

  private getLaunchRadius(lvl: number): number {
    let r = this.orbitRBase;
    if (lvl >= 5) r += 6;
    if (lvl >= 7) r += 6;
    return r;
  }

  private setupLaunch(now: number, destX: number, destY: number) {
    const p: any = this.player; if (!p) return;
    const lvl = this.getWeaponLevel(p);
    const n = this.getDroneCount(lvl);
    this.orbitR = this.getLaunchRadius(lvl);
    this.drones.length = 0;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      // Stagger initial fire times slightly per drone
      this.drones.push({ ang, next: now + this.firePeriodMs * (i * 0.2) });
    }
    this.destX = destX; this.destY = destY;
    this.centerX = p.x; this.centerY = p.y;
    this.phase = 'outbound';
    try {
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 80, intensity: 1.6 } }));
    } catch { /* optional */ }
  }

  private centerNear(tx: number, ty: number, eps = 8): boolean { return Math.hypot(this.centerX - tx, this.centerY - ty) <= eps; }

  /** Update ability each frame. edge=true when RMB pressed this frame. Optionally pass click world coords. */
  update(nowMs: number, dtMs: number, _rDown: boolean, edge: boolean, clickX?: number, clickY?: number) {
    const g: any = this.game; const p: any = this.player; if (!g || !p) return;
    const em: any = g.enemyManager; if (!em) return;

    // Activate on edge if off cooldown and not already active
    if (edge && this.phase === 'idle' && nowMs >= this.cdUntil) {
      const cx = (typeof clickX === 'number') ? clickX : p.x;
      const cy = (typeof clickY === 'number') ? clickY : p.y;
      this.setupLaunch(nowMs, cx, cy);
    }

    if (!this.isActive()) return;

    // Advance orbit angles (keep spacing while traveling)
    const stepAng = this.orbitW * (dtMs / 1000);
    for (let i = 0; i < this.drones.length; i++) { this.drones[i].ang = (this.drones[i].ang + stepAng) % (Math.PI * 2); }

    if (this.phase === 'outbound') {
      // Move shared orbit center toward destination
      const reached = this.stepCenterTowards(this.destX, this.destY, this.speedOut, dtMs);
      if (reached || this.centerNear(this.destX, this.destY)) {
        this.phase = 'inbound';
  // no sound
      }
    } else if (this.phase === 'inbound') {
      // Move center back to player's current position
      const px = p.x, py = p.y;
      const back = this.stepCenterTowards(px, py, this.speedIn, dtMs);
      if (back || this.centerNear(px, py)) {
        // End active state and start cooldown
        this.phase = 'idle';
        this.drones.length = 0;
        this.cdUntil = nowMs + this.cooldownMs;
  // no sound
      }
    }

    // Firing from each drone's current position
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      if (nowMs < d.next) continue;
      d.next = nowMs + this.firePeriodMs;

      // Compute current drone position on the ring
      const ox = this.centerX + Math.cos(this.drones[i].ang) * this.orbitR;
      const oy = this.centerY + Math.sin(this.drones[i].ang) * this.orbitR;

      // Find nearest visible target within range of this drone
      let best: any = null; let bd2 = Infinity;
      const list = (typeof em.queryEnemies === 'function') ? em.queryEnemies(ox, oy, this.targetRange) : (em.getEnemies?.() || []);
      const isVisibleLS = (ex:number,ey:number)=>{ try{ return em.isVisibleInLastStand ? em.isVisibleInLastStand(ex,ey) : true; }catch{ return true; } };
      for (let j = 0; j < list.length; j++) {
        const e: any = list[j]; if (!e || !e.active || e.hp <= 0) continue; if (!isVisibleLS(e.x,e.y)) continue;
        const dx = e.x - ox, dy = e.y - oy; const dd2 = dx*dx + dy*dy; if (dd2 > this.targetRange*this.targetRange) continue;
        if (dd2 < bd2) { bd2 = dd2; best = e; }
      }
      if (!best) continue;

      // Damage: 25 + 35% of class weapon damage at current level
      const wType = WeaponType.NOMAD_NEURAL;
      const lvl = this.getWeaponLevel(p);
      const spec: any = (WEAPON_SPECS as any)[wType];
      const baseShot = (() => {
        try { if (spec?.getLevelStats) { const st = spec.getLevelStats(lvl) as any; if (st && typeof st.damage === 'number') return st.damage; }
        } catch {}
        return (spec?.damage ?? 20);
      })();
      let dmg = Math.round(25 + baseShot * 0.35);
      try { dmg = Math.round(dmg * (p.globalDamageMultiplier || 1)); } catch {}

  const b = g.bulletManager?.spawnBullet?.(ox, oy, best.x, best.y, wType, dmg, lvl, 'NOMAD_SWARM');
      if (b) {
        try {
          const vis: any = (b as any).projectileVisual || {};
          vis.color = '#9FF7FF';
          const sz = vis.size || vis.thickness || 4; vis.size = Math.max(1, Math.round(sz * 0.7));
          (b as any).projectileVisual = vis;
          // Slightly shorter TTL to feel “needle‑like”
          const sp = Math.max(0.0001, Math.hypot((b as any).vx||0, (b as any).vy||0));
          const reach = 620; const ttlMs = Math.round(1000 * (reach / sp)); (b as any).ttl = Math.min((b as any).ttl || ttlMs, ttlMs);
          // no sound on fire
        } catch {}
      }
    }
  }

  drawWorld(ctx: CanvasRenderingContext2D, _player: any) {
    if (!this.isActive() || !this.drones.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      const x = this.centerX + Math.cos(d.ang) * this.orbitR;
      const y = this.centerY + Math.sin(d.ang) * this.orbitR;
      ctx.fillStyle = 'rgba(160,255,255,0.78)';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // Soft destination hint while outbound
    if (this.phase === 'outbound') {
      ctx.strokeStyle = 'rgba(111,232,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.destX, this.destY, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Move center toward target; returns true if reached this frame
  private stepCenterTowards(tx: number, ty: number, speed: number, dtMs: number): boolean {
    const dx = tx - this.centerX, dy = ty - this.centerY;
    const dist = Math.hypot(dx, dy);
    const step = speed * (dtMs / 1000);
    if (dist <= Math.max(8, step)) { this.centerX = tx; this.centerY = ty; return true; }
    const inv = 1 / Math.max(1e-5, dist);
    this.centerX += dx * inv * step;
    this.centerY += dy * inv * step;
    return false;
  }
}
