import { WEAPON_SPECS } from '../../../WeaponConfig';
import { WeaponType } from '../../../WeaponType';

type Impact = { x:number; y:number; t:number; fired:boolean; r:number; dmg:number };

/** Titan Mech RMB — Siege Barrage
 * Hold RMB to designate a circular bombardment zone (anchored at press). On release, a sequenced carpet of mortar impacts pounds the area.
 * Zone size and salvo density scale with Mech Mortar level; damage derived from Mortar per-shot. Telegraph grows precisely to final radius.
 * Visuals render post-fog: bright thermobaric markers, expanding target rings, and countdown ticks.
 */
export class SiegeBarrageRMB {
  private game: any; private player: any;
  private isAiming = false;
  private aimStartAt = 0;
  private anchorX = 0; private anchorY = 0; // press position (world)
  private aimEndX = 0; private aimEndY = 0; // current cursor clamped + capped (world)
  private cdUntil = 0;
  private cooldownBaseMs = 24000; // L1, reduced with level
  // Drag-line parameters
  private maxLength = 500; // px hard cap
  private trackHalfWidth = 22; // px (half width of the line strip) — tight line feel
  private impacts: Impact[] = [];
  private previewSeed = 0;

  constructor(game:any, player:any) { this.game = game; this.player = player; }

  /** Cooldown meter for HUD */
  getMeter(now:number) { const remain = Math.max(0, this.cdUntil - now); const max = this.getCooldownMs(); return { value: Math.min(max, max - remain), max, ready: remain <= 0 && !this.isAiming, active: this.isAiming }; }

  beginAim(now:number) {
    if (now < this.cdUntil) return;
  const rm:any = this.game?.roomManager; const ms:any = (this.game?.mouseState || (window as any).mouseState); const px = this.player?.x||0, py = this.player?.y||0;
    // Anchor at press cursor world position (drag start)
    let wx = (ms && typeof ms.worldX === 'number') ? ms.worldX : px;
    let wy = (ms && typeof ms.worldY === 'number') ? ms.worldY : py;
    try { const c = rm?.clampToWalkable?.(wx, wy, 18, 'player'); if (c) { wx = c.x; wy = c.y; } } catch {}
    this.anchorX = wx; this.anchorY = wy; this.aimStartAt = now; this.isAiming = true;
    // Initialize end at anchor
    this.aimEndX = wx; this.aimEndY = wy;
    // Seed preview for deterministic telegraph markers during this aim
    this.previewSeed = (Math.imul(Math.floor(wx*97+wy*131), 2654435761) ^ Math.floor(now)) >>> 0;
  }

  cancelAim() { this.isAiming = false; }

  update(now:number, _dtMs:number) {
    // Fire scheduled impacts
    if (this.impacts.length) {
      const ex:any = this.game?.explosionManager; if (ex) {
        for (let i=0;i<this.impacts.length;i++) {
          const im = this.impacts[i]; if (!im.fired && now >= im.t) {
            // Precursor implosion for punch
            try { ex.triggerMortarImplosion?.(im.x, im.y, Math.max(40, Math.round(im.r*0.6)), '#FFE66D', 0.7, 110); } catch {}
            try { ex.triggerTitanMortarExplosion?.(im.x, im.y, im.dmg, im.r, '#FFD66B'); } catch {}
            im.fired = true;
          }
        }
        // Cull fired impacts only after the last scheduled time + small grace
        let maxT = 0; for (let i=0;i<this.impacts.length;i++) if (this.impacts[i].t > maxT) maxT = this.impacts[i].t;
        if (this.impacts.every(im => im.fired) && now > (maxT + 400)) this.impacts.length = 0;
      }
    }
    if (!this.isAiming) return;
    // Keep anchor clamped in case structures shift (rare)
    try { const rm:any = this.game?.roomManager; const c = rm?.clampToWalkable?.(this.anchorX, this.anchorY, 18, 'player'); if (c) { this.anchorX = c.x; this.anchorY = c.y; } } catch {}
    // Continuously refresh current aim end from cursor while holding
    this.refreshAimEndFromMouse();
  }

  /** Track cursor and update aimEndX/Y while aiming, with walkable clamp and length cap. */
  private refreshAimEndFromMouse() {
    if (!this.isAiming) return;
  const g:any = this.game; const rm = g?.roomManager; const ms:any = (g?.mouseState || (window as any).mouseState);
    let ex = (ms && typeof ms.worldX === 'number') ? ms.worldX : this.aimEndX;
    let ey = (ms && typeof ms.worldY === 'number') ? ms.worldY : this.aimEndY;
    try { const c = rm?.clampToWalkable?.(ex, ey, 18, 'player'); if (c) { ex = c.x; ey = c.y; } } catch {}
    let dx = ex - this.anchorX, dy = ey - this.anchorY; let dist = Math.hypot(dx, dy);
    if (dist > this.maxLength) { const k = this.maxLength / dist; dx *= k; dy *= k; ex = this.anchorX + dx; ey = this.anchorY + dy; }
    this.aimEndX = ex; this.aimEndY = ey;
  }

  commit(now:number) {
    if (!this.isAiming) return;
    const held = now - this.aimStartAt;
    this.isAiming = false;
    if (now < this.cdUntil) return;

  // Determine final segment from anchor -> last aimed end (ensure we have latest cursor)
  this.refreshAimEndFromMouse();
  const dx = this.aimEndX - this.anchorX; const dy = this.aimEndY - this.anchorY;
  let lineLen = Math.hypot(dx, dy);
  if (lineLen < 1) return; // nothing to do
  if (lineLen > this.maxLength) lineLen = this.maxLength;
  const dir = Math.atan2(dy, dx);
  // Class weapon stats (prefer evolved Siege Howitzer if owned)
  const aw: Map<number, number> | undefined = this.player?.activeWeapons;
  const hasHowitzer = !!(aw && aw.has(WeaponType.SIEGE_HOWITZER));
  const baseType = hasHowitzer ? WeaponType.SIEGE_HOWITZER : WeaponType.MECH_MORTAR;
  const spec:any = (WEAPON_SPECS as any)[baseType];
  const lvl = (() => { try { return Math.max(1, aw?.get?.(baseType) ?? 1); } catch { return 1; } })();
  const s = spec?.getLevelStats ? spec.getLevelStats(Math.min(7, Math.max(1, lvl))) : { damage: spec?.damage ?? 100, explosionRadius: spec?.explosionRadius ?? 150 };
  const areaMul = this.player?.getGlobalAreaMultiplier?.() ?? (this.player?.globalAreaMultiplier ?? 1);
  // Base impact radius scaled from weapon explosion radius
  const baseImpactR = Math.round((s.explosionRadius ?? 150) * 0.9) * (areaMul || 1);
  const halfW = Math.round(this.trackHalfWidth * (0.9 + 0.2*((lvl-1)/6))) * (areaMul || 1);
  // Damage budget per impact: fraction of class weapon shot damage (apply class/non-class buff parity + global damage)
  const gMul = this.player?.getGlobalDamageMultiplier?.() ?? (this.player?.globalDamageMultiplier ?? 1);
  let baseShot = (s.damage ?? 120);
  try { if (typeof this.player?.applyNonClassWeaponBuff === 'function') baseShot = this.player.applyNonClassWeaponBuff(spec, baseShot); } catch {}
  const perImpact = Math.max(10, Math.round((baseShot * 0.40) * (gMul || 1)));
  // Salvo size scales with level and charge
  const lenT = Math.max(0.1, Math.min(1, lineLen / this.maxLength));
  const minN = 6, maxN = 14; const n = Math.round(minN + (maxN - minN) * (0.35 + 0.65*((lvl-1)/6)) * (0.35 + 0.65*lenT));
  const duration = 780 + Math.round(520 * lenT); // spread impacts across this window
  // Center of the segment for scheduling
  const cx = this.anchorX + Math.cos(dir) * (lineLen/2);
  const cy = this.anchorY + Math.sin(dir) * (lineLen/2);
  this.scheduleLineImpacts(now, cx, cy, dir, lineLen, halfW, n, duration, perImpact, baseImpactR);

    // Start cooldown
    this.cdUntil = now + this.getCooldownMs();
    // Screen emphasis
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 3.2 } })); } catch {}
  }

  /** Post-Fog rendering for telegraph and preview markers (line strip). */
  render(ctx: CanvasRenderingContext2D) {
    const g:any = this.game || (window as any).__gameInstance; const camX = g?.camX||0, camY = g?.camY||0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Draw faint countdown pips for scheduled impacts still pending (fun feedback)
    if (this.impacts.length) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let i=0;i<this.impacts.length;i++) {
        const im = this.impacts[i]; if (im.fired) continue;
        const age = Math.max(0, im.t - now); const a = Math.max(0, Math.min(1, 1 - age / 900));
        const x = im.x - camX, y = im.y - camY;
        // Outer soft ring
        ctx.strokeStyle = `rgba(255,210,120,${(0.22 + 0.5*a).toFixed(3)})`;
        ctx.lineWidth = 2 + Math.round(2*a);
        ctx.beginPath(); ctx.arc(x, y, Math.max(10, Math.round(im.r*0.65)), 0, Math.PI*2); ctx.stroke();
        // Crosshair
        ctx.strokeStyle = `rgba(255, 230, 150, ${(0.4 + 0.4*a).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x-8, y); ctx.lineTo(x+8, y); ctx.moveTo(x, y-8); ctx.lineTo(x, y+8); ctx.stroke();
      }
      ctx.restore();
    }

    if (!this.isAiming) return;
  // Update current aim end from mouse (drag target) and clamp to max length
  this.refreshAimEndFromMouse();
  const ex = this.aimEndX, ey = this.aimEndY;
  const dx = ex - this.anchorX, dy = ey - this.anchorY; let dist = Math.hypot(dx, dy);
  if (dist > this.maxLength) dist = this.maxLength;
  const dir = Math.atan2(dy, dx);
    const lvl = this.getMortarLevel();
    const areaMul = this.player?.getGlobalAreaMultiplier?.() ?? (this.player?.globalAreaMultiplier ?? 1);
    const lineLen = Math.max(0, Math.round(dist));
    const halfW = Math.round(this.trackHalfWidth * (0.9 + 0.2*((lvl-1)/6))) * (areaMul || 1);
    const cx = (this.anchorX + ex)/2 - camX, cy = (this.anchorY + ey)/2 - camY;
    const ca = Math.cos(dir), sa = Math.sin(dir);
    const hx = ca * (lineLen/2), hy = sa * (lineLen/2);
    const px = -sa * halfW, py = ca * halfW;
    // Draw soft strip
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // inner bright core for clarity
    ctx.strokeStyle = 'rgba(255, 230, 150, 0.90)'; ctx.lineWidth = Math.max(2, Math.round(halfW*0.35));
    ctx.beginPath(); ctx.moveTo(cx - hx, cy - hy); ctx.lineTo(cx + hx, cy + hy); ctx.stroke();
    // soft filled strip
    ctx.fillStyle = 'rgba(255, 197, 109, 0.12)';
    ctx.beginPath();
    ctx.moveTo(cx - hx - px, cy - hy - py);
    ctx.lineTo(cx + hx - px, cy + hy - py);
    ctx.lineTo(cx + hx + px, cy + hy + py);
    ctx.lineTo(cx - hx + px, cy - hy + py);
    ctx.closePath(); ctx.fill();
    // Edge strokes
    ctx.strokeStyle = 'rgba(255, 214, 107, 0.85)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - hx - px, cy - hy - py); ctx.lineTo(cx + hx - px, cy + hy - py);
    ctx.moveTo(cx - hx + px, cy - hy + py); ctx.lineTo(cx + hx + px, cy + hy + py);
    ctx.stroke();
    // Preview markers along the line
    const pCount = this.previewLineCount(lvl, Math.max(0.1, Math.min(1, lineLen/this.maxLength)));
    for (let i=0;i<pCount;i++) {
      const s = (i + 0.5) / pCount - 0.5; // -0.5..0.5 along centerline
      const lx = cx + ca * (s * lineLen);
      const ly = cy + sa * (s * lineLen);
      ctx.strokeStyle = 'rgba(255, 240, 170, 0.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(lx, ly, Math.max(5, Math.round(halfW*0.35)), 0, Math.PI*2); ctx.stroke();
    }
    ctx.restore();
  }

  onTimeShift(deltaMs:number) {
    this.cdUntil += deltaMs; if (this.isAiming) this.aimStartAt += deltaMs;
    for (let i=0;i<this.impacts.length;i++) this.impacts[i].t += deltaMs;
  }

  private getCooldownMs(): number {
    const lvl = this.getMortarLevel();
    const base = this.cooldownBaseMs; // 24s at L1
    const cd = base - (lvl-1)*1000; // down to 18s at L7
    return Math.max(12000, cd);
  }

  private getMortarLevel(): number {
    try { return Math.max(1, this.player?.activeWeapons?.get?.(WeaponType.MECH_MORTAR) ?? 1); } catch { return 1; }
  }

  private scheduleLineImpacts(now:number, cx:number, cy:number, dir:number, lineLen:number, halfW:number, count:number, windowMs:number, damage:number, impactR:number) {
    const out = Math.max(1, count|0); const arr: Impact[] = new Array(out);
    const ca = Math.cos(dir), sa = Math.sin(dir);
    const px = -sa, py = ca; // perpendicular unit
    for (let i=0;i<out;i++) {
      const s = (i / Math.max(1, out-1)) - 0.5; // -0.5..0.5 along centerline
      const lateralJitter = ((this.previewSeed >>> (i%24)) & 0xff)/255 - 0.5; // -0.5..0.5
      const offLat = lateralJitter * halfW * 0.9;
      const x = cx + ca * (s * lineLen) + px * offLat;
      const y = cy + sa * (s * lineLen) + py * offLat;
      const t = now + Math.round((i / Math.max(1, out-1)) * windowMs);
      arr[i] = { x, y, t, fired: false, r: Math.max(32, Math.round(impactR * (0.9 - 0.15*((i%3)/2)))), dmg: damage };
    }
    this.impacts = arr;
    // Central pre-signal along strip: three implosion blips (start, mid, end)
    try {
      const hx = ca * (lineLen/2), hy = sa * (lineLen/2);
      const midX = cx, midY = cy;
      const startX = cx - hx, startY = cy - hy;
      const endX = cx + hx, endY = cy + hy;
      this.game?.explosionManager?.triggerMortarImplosion(startX, startY, Math.round(halfW*1.2), '#FFE66D', 0.28, 160);
      this.game?.explosionManager?.triggerMortarImplosion(midX, midY, Math.round(halfW*1.6), '#FFE66D', 0.22, 180);
      this.game?.explosionManager?.triggerMortarImplosion(endX, endY, Math.round(halfW*1.2), '#FFE66D', 0.28, 160);
    } catch {}
  }

  private previewLineCount(lvl:number, t:number): number { return Math.round(6 + (14-6) * (0.35 + 0.65*((lvl-1)/6)) * (0.4 + 0.6*t)); }
}
