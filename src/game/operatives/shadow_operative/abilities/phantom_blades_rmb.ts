import { WEAPON_SPECS } from '../../../WeaponConfig';
import { WeaponType } from '../../../WeaponType';
import { scaleDamage } from '../../../scaling';

type BladeVisual = { x0:number; y0:number; x1:number; y1:number; born:number; ttl:number };

/** Shadow Operative RMB — Phantom Blades
 * Hold RMB to project a growing void wedge. On release, unleash spectral blades along the aim.
 * The wedge range equals the effective slash length. Blades pierce, with pierce scaling by Void Sniper level.
 * Visuals are drawn post-fog using deep void purples and neon violet glows.
 */
export class PhantomBladesRMB {
  private game: any;
  private player: any;

  private cooldownMs = 22000;
  private cdUntil = 0;

  private isAiming = false;
  private aimStartAt = 0;
  private aimDir = 0; // radians
  private aimWorldX = 0;
  private aimWorldY = 0;

  private maxRange = 520;
  private minRange = 140;
  private growMs = 900; // time to reach maxRange while holding
  private baseHalfAngle = 0.18; // ~10° at min; grows slightly with charge

  private bladeThickness = 18; // px (geometry check thickness)
  private bladeCount = 5;
  private bladeTtl = 1300; // visual linger per blade (slow fade)
  private blades: BladeVisual[] = [];

  constructor(game:any, player:any) {
    this.game = game; this.player = player;
  }

  getMeter(now:number) { const remain = Math.max(0, this.cdUntil - now); return { value: this.cooldownMs - remain, max: this.cooldownMs, ready: remain <= 0 && !this.isAiming, active: this.isAiming }; }

  beginAim(now:number) {
    if (now < this.cdUntil) return;
    this.isAiming = true; this.aimStartAt = now;
  }

  cancelAim() { this.isAiming = false; }

  update(now:number, dtMs:number) {
    // Cull expired blade visuals
    if (this.blades.length) {
      const out: BladeVisual[] = [];
      for (let i=0;i<this.blades.length;i++) { const b = this.blades[i]; if (now - b.born < b.ttl) out.push(b); }
      this.blades = out;
    }

    if (!this.isAiming) return;
    const ms:any = (window as any).mouseState;
    if (ms && typeof ms.worldX === 'number' && typeof ms.worldY === 'number') {
      const px = (this.player?.x || 0), py = (this.player?.y || 0);
      let dx = ms.worldX - px, dy = ms.worldY - py; const d = Math.hypot(dx, dy) || 1; dx/=d; dy/=d;
      this.aimDir = Math.atan2(dy, dx);
      this.aimWorldX = ms.worldX; this.aimWorldY = ms.worldY;
    }
  }

  commit(now:number) {
    if (!this.isAiming) return;
    const p:any = this.player; if (!p) { this.isAiming = false; return; }
    this.isAiming = false;
    if (now < this.cdUntil) return;

    // Determine charged range and wedge
    const t = Math.max(0, Math.min(1, (now - this.aimStartAt) / this.growMs));
    const range = this.minRange + (this.maxRange - this.minRange) * t;
    const halfAng = this.baseHalfAngle + 0.12 * t; // broaden slightly as it grows

    // Pierce scaling by Void Sniper level
    const lvl = (()=>{ try { return Math.max(1, p.activeWeapons?.get?.(WeaponType.VOID_SNIPER) ?? 1); } catch { return 1; } })();
    const pierce = 1 + Math.floor((lvl - 1) / 2); // L1:1, L3:2, L5:3, L7:3

    // Damage budget based on Void Sniper per-shot damage (scaled)
    let dmg = 40;
    try {
      const spec:any = (WEAPON_SPECS as any)[WeaponType.VOID_SNIPER];
      const s = spec?.getLevelStats ? spec.getLevelStats(Math.min(7, Math.max(1, lvl))) : { damage: spec?.damage ?? 100 };
  // Per-blade damage tuned to a fraction of per-shot expected damage
  dmg = Math.max(6, Math.round((s.damage ?? 100) * 0.45));
  // Apply global damage multiplier via helper
  dmg = Math.max(1, scaleDamage(dmg, p));
    } catch {}

    // Emit N instantaneous blades within wedge (centered), apply geometry-based damage with pierce limit per blade
    const g:any = this.game; const em:any = g?.enemyManager; if (!em) { this.cdUntil = now + this.cooldownMs; return; }
    const px = p.x, py = p.y;
    const count = this.bladeCount;
    const span = halfAng * 1.6; // distribute within most of the wedge
    for (let i=0;i<count;i++) {
      const a = this.aimDir + ((i - (count-1)/2) / Math.max(1,(count-1))) * span;
      const x1 = px + Math.cos(a) * range;
      const y1 = py + Math.sin(a) * range;
      // Visual record
      this.blades.push({ x0: px, y0: py, x1, y1, born: now, ttl: this.bladeTtl });
      // Apply damage along the blade path (single tick), respecting pierce limit
      try { this.applyBladeDamage(em, px, py, x1, y1, dmg, pierce, now); } catch {}
    }

    // Cooldown starts on commit
    this.cdUntil = now + this.cooldownMs;
    // Camera pulse and subtle shake
    try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: px, y: py, r: Math.min(240, range*0.6), color:'#6A0DAD' } })); } catch {}
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2.0 } })); } catch {}
  }

  /** Draw telegraph wedge and recent blade echoes (world space; call after fog for telegraph). */
  render(ctx: CanvasRenderingContext2D) {
    const p:any = this.player; if (!p) return;
    const g:any = this.game || (window as any).__gameInstance; const camX = g?.camX || 0, camY = g?.camY || 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Blade echoes (slow fade)
    if (this.blades.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i=0;i<this.blades.length;i++) {
        const b = this.blades[i];
        const age = now - b.born;
        const lin = Math.max(0, Math.min(1, 1 - age / b.ttl));
        // Ease the fade to linger longer up-front and trail slowly near the end
        const fade = Math.pow(lin, 0.5);       // alpha curve (slower disappearing)
        const widthT = Math.pow(lin, 0.75);    // width decay curve
        const x0 = b.x0 - camX, y0 = b.y0 - camY, x1 = b.x1 - camX, y1 = b.y1 - camY;
        const w = Math.max(4, Math.round(this.bladeThickness * (0.3 + 0.7 * widthT)));
        // Outer glow
        ctx.strokeStyle = `rgba(178,102,255,${0.24 * fade})`;
        ctx.lineWidth = w;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // Core
        ctx.strokeStyle = `rgba(106,13,173,${0.62 * fade})`;
        ctx.lineWidth = Math.max(2, Math.round(w * 0.34));
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // Thin inner filament to emphasize lingering beam
        ctx.strokeStyle = `rgba(220,200,255,${0.22 * fade})`;
        ctx.lineWidth = Math.max(1, Math.round(w * 0.18));
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
    }

    if (!this.isAiming) return;
    // Compute current charged range and wedge
    const t = Math.max(0, Math.min(1, (now - this.aimStartAt) / this.growMs));
    const range = this.minRange + (this.maxRange - this.minRange) * t;
    const halfAng = this.baseHalfAngle + 0.12 * t;
    const cx = p.x - camX, cy = p.y - camY;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.aimDir);
    ctx.globalCompositeOperation = 'lighter';
    // Soft wedge fill
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, range);
    grad.addColorStop(0, 'rgba(75, 0, 130, 0.12)');
    grad.addColorStop(1, 'rgba(75, 0, 130, 0.00)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const steps = 18;
    for (let i=0;i<=steps;i++) {
      const a = -halfAng + (i/steps) * (2*halfAng);
      const x = Math.cos(a) * range, y = Math.sin(a) * range; ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    // Edge outline
    ctx.strokeStyle = 'rgba(178,102,255,0.65)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, range, -halfAng, halfAng); ctx.stroke();
    // Inner spinny runes
    const ringR = Math.max(26, Math.min(range * 0.25, 80));
    ctx.strokeStyle = 'rgba(178,102,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, ringR, 0, Math.PI*2); ctx.stroke();
    // Direction tick marks
    const ticks = 8; const r0 = ringR - 4, r1 = ringR + 4;
    for (let i=0;i<ticks;i++) { const a = (i * (Math.PI*2))/ticks; const ca=Math.cos(a), sa=Math.sin(a); ctx.beginPath(); ctx.moveTo(ca*r0, sa*r0); ctx.lineTo(ca*r1, sa*r1); ctx.stroke(); }
    ctx.restore();
  }

  /** Time shift for pause/blur. */
  onTimeShift(deltaMs:number) {
    this.cdUntil += deltaMs;
    // Shift blade visuals
    for (let i=0;i<this.blades.length;i++) this.blades[i].born += deltaMs;
    if (this.isAiming) this.aimStartAt += deltaMs;
  }

  private applyBladeDamage(em:any, x0:number, y0:number, x1:number, y1:number, dmg:number, pierce:number, now:number) {
    // Query nearby enemies using a bounding query if available
    const cx = (x0 + x1) * 0.5; const cy = (y0 + y1) * 0.5; const r = Math.hypot(x1 - x0, y1 - y0) * 0.5 + this.bladeThickness + 24;
    const list = (typeof em.queryEnemies === 'function') ? em.queryEnemies(cx, cy, r) : (em.getEnemies?.() || []);
    // Precompute segment
    const dx = x1 - x0, dy = y1 - y0; const len2 = dx*dx + dy*dy || 1; const br = this.bladeThickness;
    let hits = 0;
    for (let i=0;i<list.length;i++) {
      const e:any = list[i]; if (!e || !e.active || e.hp <= 0) continue;
      // Visibility filter in Last Stand
      try { if (em.isVisibleInLastStand && !em.isVisibleInLastStand(e.x, e.y)) continue; } catch {}
      const rad = (e.radius || 12) + br;
      // Point-segment distance squared
      const t = Math.max(0, Math.min(1, ((e.x - x0)*dx + (e.y - y0)*dy) / len2));
      const px = x0 + t * dx, py = y0 + t * dy; const dd2 = (e.x - px)*(e.x - px) + (e.y - py)*(e.y - py);
      if (dd2 <= rad*rad) {
        // Apply damage; respect pierce limit per blade
        try { em.takeDamage ? em.takeDamage(e, dmg, false, false, WeaponType.VOID_SNIPER, px, py, Math.max(1, (this.player?.activeWeapons?.get?.(WeaponType.VOID_SNIPER) ?? 1)), false, 'PLAYER') : (e.hp -= dmg); } catch { e.hp -= dmg; }
        hits++; if (hits >= pierce) break;
        // Minor slow on hit to sell void feel
        try { e._slowUntil = Math.max(e._slowUntil||0, now + 300); e._slowMul = Math.min(e._slowMul||1, 0.8); } catch {}
      }
    }
  }
}
