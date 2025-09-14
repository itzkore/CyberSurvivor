import { WEAPON_SPECS } from '../../../WeaponConfig';
import { WeaponType } from '../../../WeaponType';
import { scaleDamage } from '../../../scaling';

type ArcPoint = { x: number; y: number };

/** Psionic Weaver RMB — Phase Stitch
 * Press RMB to aim; on release, blink along a graceful arc to the targeted point,
 * slicing along the path and leaving a shimmering thread that damages enemies crossing it.
 * Cooldown starts immediately after the blink; thread persists independently.
 */
export class PhaseStitchRMB {
  private game: any;
  private player: any;
  private cdUntil = 0;
  private activeThread: { pts: ArcPoint[]; ttlMs: number; width: number; damagePerTick: number; tickAccum: number } | null = null;
  private aiming = false;
  private aimX = 0; private aimY = 0;
  // Blink bookkeeping
  private originX = 0; private originY = 0;
  private targetX = 0; private targetY = 0;
  private lastArcPts: ArcPoint[] | null = null;
  private returnAt: number | null = null;
  private justTeleportedAt: number = -Infinity;
  private justReturnedAt: number = -Infinity;
  private lingerUntil: number = 0; // lock movement and linger 1s at destination

  // Tunables
  private readonly cooldownMs = 15000;
  private readonly maxArcLen = 520; // max travel distance
  private readonly arcControl = 0.35; // curve strength (0..1)
  private readonly threadTtlMs = 1500; // lingering ribbon lifetime
  private readonly threadWidth = 12;   // px, visual
  private readonly tickMs = 120;       // DoT cadence
  private readonly invulnTotalMs = 520; // base i-frames; we'll extend dynamically to cover linger+return
  private readonly lingerMs = 1000;    // wait 1 second at destination
  private readonly returnDelayMs = 0;  // immediate scheduling after linger
  private readonly landingWave: { radius: number; damage: number; slowMs: number; slowMul: number } = { radius: 180, damage: 110, slowMs: 1200, slowMul: 0.6 };
  // Return animation
  private returning = false;
  private returnT0 = 0;
  private returnDurMs = 420; // smooth pacing back along the arc

  constructor(game: any, player: any) { this.game = game; this.player = player; }

  getMeter(now: number) { const remain = Math.max(0, this.cdUntil - now); return { value: this.cooldownMs - remain, max: this.cooldownMs, ready: remain <= 0 && !this.aiming, active: this.aiming }; }

  beginAim() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now < this.cdUntil) return;
    this.aiming = true;
  }

  cancelAim() { this.aiming = false; }

  /** Commit the blink to the current aim position and spawn the lingering thread. */
  commit(now: number, worldX: number, worldY: number) {
    if (now < this.cdUntil) { this.aiming = false; return; }
    const p = this.player as any; if (!p) { this.aiming = false; return; }
    // Clamp destination to max arc length
    const dx = worldX - p.x, dy = worldY - p.y;
    const dist = Math.hypot(dx, dy) || 1;
    const maxD = this.maxArcLen;
    const k = Math.min(1, maxD / dist);
    let tx = p.x + dx * k, ty = p.y + dy * k;
    // Further clamp to walkable area to prevent blinking into walls or void
    try {
      const g: any = this.game || (window as any).__gameInstance; const rm: any = g?.roomManager || (window as any).__roomManager;
      if (rm && typeof rm.clampToWalkable === 'function') {
        const clamped = rm.clampToWalkable(tx, ty, p.radius || 16, 'player');
        if (clamped && typeof clamped.x === 'number' && typeof clamped.y === 'number') { tx = clamped.x; ty = clamped.y; }
      }
    } catch {}

    // Build a curved arc using a quadratic Bezier approximation
    const midx = (p.x + tx) * 0.5; const midy = (p.y + ty) * 0.5;
    // Curve control offset perpendicular to line
    const nx = -dy / dist, ny = dx / dist;
    const ctrlX = midx + nx * (dist * this.arcControl);
    const ctrlY = midy + ny * (dist * this.arcControl);
    const pts = this.sampleQuadBezier({ x: p.x, y: p.y }, { x: ctrlX, y: ctrlY }, { x: tx, y: ty }, 26);

  // Teleport hero to end point (smooth pacing visual implied by arc render; instantaneous move for gameplay)
    this.originX = p.x; this.originY = p.y;
    this.targetX = tx; this.targetY = ty;
    p.x = tx; p.y = ty;
    this.lastArcPts = pts;
    this.justTeleportedAt = now;
  // I-frames: extend to cover linger + return
  try { p.invulnerableUntilMs = Math.max(p.invulnerableUntilMs || 0, now + this.lingerMs + this.returnDurMs + 150); } catch {}
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 100, intensity: 2.6 } })); } catch {}

    // Spawn lingering thread
    const dmgTick = this.computeThreadTickDamage();
    this.activeThread = { pts, ttlMs: this.threadTtlMs, width: this.threadWidth, damagePerTick: dmgTick, tickAccum: 0 };
  // Linger: lock movement for 1s at destination; return after linger
  this.lingerUntil = now + this.lingerMs;
  try { (p as any)._inputMoveLocked = true; } catch {}
  // Landing AoE damage + slow
  try { this.emitLandingWave(tx, ty); } catch {}
  try { this.applyLandingWaveDamage(now); } catch {}
  // Schedule return to origin after linger
  this.returnAt = this.lingerUntil + this.returnDelayMs;

    // Put on cooldown immediately
    this.cdUntil = now + this.cooldownMs;
    this.aiming = false;
  }

  update(now: number, dtMs: number) {
    // Tick lingering thread
    if (this.activeThread) {
      const t = this.activeThread;
      t.ttlMs -= dtMs;
      // Damage application on cadence
      t.tickAccum += dtMs;
      while (t.tickAccum >= this.tickMs) {
        t.tickAccum -= this.tickMs;
        this.applyThreadDamage(t);
      }
      if (t.ttlMs <= 0) this.activeThread = null;
    }

    // Handle movement lock release
    if (this.lingerUntil > 0 && now >= this.lingerUntil) {
      try { (this.player as any)._inputMoveLocked = false; } catch {}
      this.lingerUntil = 0;
    }

    // Handle return to origin after linger (animate along inverted arc)
    if (this.returnAt && now >= this.returnAt && !this.returning && this.lastArcPts && this.lastArcPts.length > 1) {
      this.returning = true;
      this.returnT0 = now;
    }
    if (this.returning && this.lastArcPts && this.lastArcPts.length > 1) {
      const t = Math.max(0, Math.min(1, (now - this.returnT0) / this.returnDurMs));
      // easeInOutQuad
      const ease = t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
      const idx = Math.floor((1 - ease) * (this.lastArcPts.length - 1));
      const pt = this.lastArcPts[idx];
      const p:any = this.player;
      p.x = pt.x; p.y = pt.y;
      if (t >= 1) {
        this.returning = false;
        this.returnAt = null;
        this.justReturnedAt = now;
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2.2 } })); } catch {}
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, player: any) {
    // Aiming preview: curved ghost arc
    if (this.aiming) {
      const ms: any = (window as any).mouseState;
      if (ms && typeof ms.worldX === 'number' && typeof ms.worldY === 'number') {
        const px = player.x, py = player.y;
        const dx = ms.worldX - px, dy = ms.worldY - py;
        const dist = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, this.maxArcLen / dist);
        let tx = px + dx * k, ty = py + dy * k;
        // Preview respects walkable clamp as well
        try {
          const g: any = this.game || (window as any).__gameInstance; const rm: any = g?.roomManager || (window as any).__roomManager;
          if (rm && typeof rm.clampToWalkable === 'function') {
            const clamped = rm.clampToWalkable(tx, ty, player.radius || 16, 'player');
            if (clamped && typeof clamped.x === 'number' && typeof clamped.y === 'number') { tx = clamped.x; ty = clamped.y; }
          }
        } catch {}
        const midx = (px + tx) * 0.5; const midy = (py + ty) * 0.5;
        const nx = -dy / dist, ny = dx / dist;
        const ctrlX = midx + nx * (dist * this.arcControl);
        const ctrlY = midy + ny * (dist * this.arcControl);
        const pts = this.sampleQuadBezier({ x: px, y: py }, { x: ctrlX, y: ctrlY }, { x: tx, y: ty }, 26);
        // Epic visuals: neon magenta thread with pulsing glow and parallax motes
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // Thicker glow + offset shadow to sell trajectory
        this.drawRibbon(ctx, pts, 12, 'rgba(255,77,227,0.20)', 'rgba(255,148,240,0.85)');
        this.drawRibbon(ctx, pts, 18, 'rgba(255,77,227,0.10)', 'rgba(255,148,240,0.25)');
        // Floating motes along the path for preview
        const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.drawMotes(ctx, pts, tNow, '#ff94f0');
        ctx.restore();
      }
    }

    // Lingering thread rendering
    if (this.activeThread) {
      const t = this.activeThread;
      const alpha = Math.max(0, Math.min(1, t.ttlMs / this.threadTtlMs));
      const core = `rgba(255, 148, 240, ${0.65 * alpha})`;
      const glow = `rgba(255, 77, 227, ${0.18 * alpha})`;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.drawRibbon(ctx, t.pts, t.width, glow, core);
      // Halo pulses at both ends of the thread
      const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const s = t.pts[0], e = t.pts[t.pts.length - 1];
      this.drawFlare(ctx, s.x, s.y, tNow, 18 * alpha, `rgba(255,148,240,${0.5 * alpha})`);
      this.drawFlare(ctx, e.x, e.y, tNow, 18 * alpha, `rgba(255,148,240,${0.5 * alpha})`);
      // Extra particles as it fades
      this.drawMotes(ctx, t.pts, tNow, `rgba(255,148,240,${0.6 * alpha})`);
      ctx.restore();
    }

  // Blink/Return bursts and return echo ribbon
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.justTeleportedAt < 220 && this.lastArcPts) {
      const f = 1 - (now - this.justTeleportedAt) / 220;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.drawFlare(ctx, this.targetX, this.targetY, now, 28 * f, `rgba(255,148,240,${0.45 * f})`);
      this.drawRibbon(ctx, this.lastArcPts, 16 * f, `rgba(255,77,227,${0.15 * f})`, `rgba(255,148,240,${0.45 * f})`);
      ctx.restore();
    }
    if (now - this.justReturnedAt < 220 && this.lastArcPts) {
      const f = 1 - (now - this.justReturnedAt) / 220;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // Reverse arc for return echo
      const rev = this.lastArcPts;
      this.drawFlare(ctx, this.originX, this.originY, now, 26 * f, `rgba(255,148,240,${0.4 * f})`);
      this.drawRibbon(ctx, rev, 14 * f, `rgba(255,77,227,${0.14 * f})`, `rgba(255,148,240,${0.40 * f})`);
      ctx.restore();
    }

    // Sakura petals along the path and during linger
    if (this.lastArcPts) {
      const age = now - this.justTeleportedAt;
      const active = age < 1200 || (this.lingerUntil > now);
      if (active) {
        try { this.drawSakura(ctx, this.lastArcPts, now); } catch {}
      }
    }
  }

  // Helpers
  private sampleQuadBezier(a: ArcPoint, c: ArcPoint, b: ArcPoint, steps: number): ArcPoint[] {
    const out = new Array<ArcPoint>(steps);
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y;
      out[i] = { x, y };
    }
    return out;
  }

  private drawRibbon(ctx: CanvasRenderingContext2D, pts: ArcPoint[], width: number, glow: string, core: string) {
    // Outer glow
    ctx.strokeStyle = glow;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    // Core line
    ctx.strokeStyle = core;
    ctx.lineWidth = Math.max(2, Math.round(width * 0.35));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  private drawMotes(ctx: CanvasRenderingContext2D, pts: ArcPoint[], tNow: number, color: string) {
    // Sprinkle a few evenly spaced particles with gentle drift
    const count = 10;
    const len = pts.length;
    for (let i = 0; i < count; i++) {
      const idx = Math.floor((i / (count - 1)) * (len - 1));
      const p = pts[idx];
      const phase = (tNow * 0.002 + i * 0.37) % (Math.PI * 2);
      const r = 2 + 1.5 * (0.5 + 0.5 * Math.sin(phase));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(phase) * 6, p.y + Math.sin(phase) * 6, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private computeThreadTickDamage(): number {
    const p: any = this.player;
    const lvl = (() => { try { return Math.max(1, (p.activeWeapons?.get?.(WeaponType.PSIONIC_WAVE) ?? 1)); } catch { return 1; } })();
    const spec: any = (WEAPON_SPECS as any)[WeaponType.PSIONIC_WAVE];
    const stats = spec?.getLevelStats ? spec.getLevelStats(lvl) : { damage: spec?.damage ?? 20 };
    const base = stats?.damage ?? 20;
    let dmg = Math.round(base * 0.8); // per tick along the thread
  // Apply global damage multiplier via helper (consistent behavior)
  try { dmg = scaleDamage(dmg, p); } catch {}
    return Math.max(1, dmg);
  }

  private applyThreadDamage(t: { pts: ArcPoint[]; ttlMs: number; width: number; damagePerTick: number; tickAccum: number }) {
    const g: any = this.game; const p: any = this.player; if (!g || !p) return;
    const em: any = g.enemyManager; if (!em) return;
    const enemies = (typeof em.queryEnemies === 'function') ? em.queryEnemies(p.x, p.y, this.maxArcLen + 60) : (em.getEnemies?.() || []);
    const half = t.width * 0.5;
    // Precompute segments
    for (let i = 0; i < enemies.length; i++) {
      const e: any = enemies[i]; if (!e || !e.active || e.hp <= 0) continue;
      // Quick reject by visibility in Last Stand
      try { if (em.isVisibleInLastStand && !em.isVisibleInLastStand(e.x, e.y)) continue; } catch {}
      // Distance to polyline under a width threshold
      if (this.pointNearPolyline(e.x, e.y, t.pts, half + (e.radius || 12))) {
        try { e.applyDamage ? e.applyDamage(t.damagePerTick, p) : (e.hp -= t.damagePerTick); } catch { /* best effort */ }
      }
    }
  }

  private pointNearPolyline(x: number, y: number, pts: ArcPoint[], rad: number): boolean {
    const r2 = rad * rad;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x, ay = pts[i].y;
      const bx = pts[i+1].x, by = pts[i+1].y;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx*dx + dy*dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax)*dx + (y - ay)*dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const dd2 = (x - px)*(x - px) + (y - py)*(y - py);
      if (dd2 <= r2) return true;
    }
    return false;
  }

  private drawFlare(ctx: CanvasRenderingContext2D, x: number, y: number, tNow: number, baseR: number, color: string) {
    const pulse = 0.5 + 0.5 * Math.sin(tNow * 0.02);
    const r = Math.max(2, baseR * (0.8 + 0.4 * pulse));
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private applyLandingWaveDamage(now: number) {
    const g:any = this.game; const p:any = this.player; if (!g||!p) return;
    const em:any = g.enemyManager; if (!em) return;
  const R = this.landingWave.radius; const dmg = scaleDamage(this.landingWave.damage, p);
    const list = em.getEnemies?.() || [];
    for (let i=0;i<list.length;i++) {
      const e:any = list[i]; if (!e||!e.active||e.hp<=0) continue;
      const dx = e.x - this.targetX, dy = e.y - this.targetY; if (dx*dx+dy*dy > R*R) continue;
      try { em.takeDamage(e, dmg, false, false, WeaponType.PSIONIC_WAVE, this.targetX, this.targetY, (p.activeWeapons?.get?.(WeaponType.PSIONIC_WAVE) ?? 1), false, 'PLAYER'); } catch { e.hp -= dmg; }
      // apply slow
      try { e._slowUntil = Math.max(e._slowUntil||0, now + this.landingWave.slowMs); e._slowMul = Math.min(e._slowMul||1, this.landingWave.slowMul); } catch {}
    }
  }

  private emitLandingWave(x: number, y: number) {
    const g:any = this.game; if (!g) return;
    try { g.explosionManager?.triggerShockwave?.(x, y, Math.round(this.landingWave.damage*0.6), this.landingWave.radius, '#ff9bd6'); } catch {}
    try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x, y, r: this.landingWave.radius, color:'#ff7fce' } })); } catch {}
  }

  private drawSakura(ctx: CanvasRenderingContext2D, pts: ArcPoint[], now: number) {
    // Render a few drifting pink petals along the arc
    const count = 14; const len = pts.length;
    for (let i=0;i<count;i++) {
      const idx = Math.floor((i/(count-1)) * (len-1)); const p = pts[idx];
      const phase = (now*0.0015 + i*0.37);
      const wobX = Math.cos(phase*2.1) * 6; const wobY = Math.sin(phase*1.9) * 5;
      const r = 2 + 1.8 * (0.5 + 0.5*Math.sin(phase*3.2));
      ctx.save();
      ctx.translate(p.x + wobX, p.y + wobY);
      ctx.rotate(Math.sin(phase)*0.6);
      ctx.fillStyle = 'rgba(255,170,210,0.85)';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r*0.9, -r*0.2, 0, r);
      ctx.quadraticCurveTo(-r*0.9, -r*0.2, 0, -r);
      ctx.fill();
      ctx.restore();
    }
  }
}
