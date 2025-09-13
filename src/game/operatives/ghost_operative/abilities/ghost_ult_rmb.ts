import type { Player } from '../../../Player';
import { WeaponType } from '../../../WeaponType';

/**
 * Ghost Ultimate RMB controller.
 * Hold RMB for 3000ms while stationary to charge; during charge movement and normal firing are locked.
 * On completion, fires a massive unlimited‑range beam that ignores blockers and shakes the screen.
 * Visuals: absorbs particles toward the player while charging (low-FX friendly), then spawns a special beam type.
 */
export class GhostUltRMB {
  private game: any;
  private player: Player;
  private cdMsMax = 28000; // long cooldown (~28s)
  private cdMs = 0;
  private chargeMsMax = 3000; // 3s hold
  private chargeStart: number | null = null;
  private charging: boolean = false;
  private activeWindowMs = 220; // brief active lock window post‑fire
  private activeUntil: number = 0;
  // Local visual state for the fired beam (ability-owned rendering)
  private vis?: { start: number; duration: number; angle: number; len: number; thickness: number };

  constructor(game: any, player: Player) {
    this.game = game;
    this.player = player;
  }

  update(now: number, dt: number, rDown: boolean, camX: number, camY: number) {
    // Tick cooldown
    this.cdMs = Math.max(0, this.cdMs - dt);

    // Cancel any legacy/parallel sniper charge while ult is charging
    const pAny: any = this.player as any;

    // If currently in active beam recoil window, keep input suppressed
    const inActive = now < this.activeUntil;

    // Handle charging state
    if (this.charging) {
      // Movement cancels charging
      const mv = Math.hypot(this.player.vx || 0, this.player.vy || 0);
      if (!rDown || mv > 0.01) {
        this.stopCharge();
        return;
      }
      // Aim to cursor and rotate while charging
      try {
        const ms: any = (window as any).mouseState;
        if (ms && typeof ms.worldX === 'number' && typeof ms.worldY === 'number') {
          const dx = ms.worldX - this.player.x;
          const dy = ms.worldY - (this.player.y - 8);
          (this.player as any).rotation = Math.atan2(dy, dx);
        }
      } catch {}
      // Spawn gentle absorb particles
      try {
        const pm = this.game?.particleManager;
        if (pm && !this.game.lowFX) {
          // Pull small shards inward from a ring
          for (let i = 0; i < 2; i++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 40 + Math.random() * 40;
            const px = this.player.x + Math.cos(ang) * dist;
            const py = this.player.y + Math.sin(ang) * dist;
            pm.spawn(px, py, 1, '#C9ECFF', { sizeMin: 0.6, sizeMax: 1.1, life: 46, speedMin: 0.4, speedMax: 0.9, vx: (this.player.x - px) * 0.02, vy: (this.player.y - py) * 0.02 });
          }
        }
      } catch {}
      // Complete?
      const elapsed = now - (this.chargeStart || now);
      if (elapsed >= this.chargeMsMax) {
        this.finishChargeAndFire(now);
      } else {
        // Maintain locks while charging
        pAny._ghostUltCharging = true;
        pAny._inputMoveLocked = true;
        pAny._fireLocked = true;
      }
      return;
    }

    // If not charging: can we start?
    if (rDown && this.cdMs <= 0 && !inActive) {
      // Must be nearly stationary
      const moveMag = Math.hypot(this.player.vx || 0, this.player.vy || 0);
      if (moveMag <= 0.01) {
        this.startCharge(now);
      }
    }
  }

  private startCharge(now: number) {
    if (this.charging) return;
    this.charging = true;
    this.chargeStart = now;
    const pAny: any = this.player as any;
    // Cancel any existing sniper charge immediately
    pAny._sniperCharging = false;
    pAny._sniperState = 'idle';
    pAny._sniperChargeStart = undefined;
    pAny._sniperChargeMax = 0;
    pAny._ghostUltCharging = true;
    pAny._inputMoveLocked = true;
    pAny._fireLocked = true;
    pAny._basicFireSuppressed = true; // explicitly block basic weapon attacks
    // Subtle ground glow cue
    try { this.game?.explosionManager?.triggerChargeGlow(this.player.x, this.player.y + 6, 36, '#C9ECFF', this.chargeMsMax); } catch {}
  }

  private stopCharge() {
    this.charging = false;
    this.chargeStart = null;
    const pAny: any = this.player as any;
    pAny._ghostUltCharging = false;
    pAny._inputMoveLocked = false;
    pAny._fireLocked = false;
    pAny._basicFireSuppressed = false;
  }

  private async finishChargeAndFire(now: number) {
    // Fire beam
    this.charging = false;
    const pAny: any = this.player as any;
    pAny._ghostUltCharging = false;
    // Movement & fire remain locked very briefly during recoil window, then released
    pAny._inputMoveLocked = true;
    pAny._fireLocked = true;
    this.activeUntil = now + this.activeWindowMs;
    setTimeout(() => {
      const pAny2: any = this.player as any;
      pAny2._inputMoveLocked = false;
      pAny2._fireLocked = false;
    }, this.activeWindowMs);

    const game: any = this.game;
    if (!game) { this.cdMs = this.cdMsMax; return; }

    // Determine aim: use current facing rotation
    const originX = this.player.x;
    const originY = this.player.y - 8;
  const beamAngle = this.player.rotation || 0;

    // Damage budget: scale off Ghost Sniper base damage at current level and global multiplier
    try {
      const WEAPON_SPECS = (await import('../../../WeaponConfig')).WEAPON_SPECS as any; // dynamic to avoid cycles
      const lvl = (this.player.activeWeapons?.get?.(WeaponType.GHOST_SNIPER) ?? 1) as number;
      const base = WEAPON_SPECS[WeaponType.GHOST_SNIPER];
      const dmgBase = (base?.getLevelStats ? base.getLevelStats(lvl).damage : base?.damage) || 100;
      const gdm = (pAny.getGlobalDamageMultiplier?.() ?? (pAny.globalDamageMultiplier ?? 1));
  const beamDamage = Math.max(1, Math.round(dmgBase * 4.0 * gdm)); // 400% weapon damage
      // Apply instant damage along unlimited range, ignoring blockers and FoW (still respects enemy active/hp)
      const enemies = game.enemyManager?.getEnemies?.() || [];
      const cosA = Math.cos(beamAngle);
      const sinA = Math.sin(beamAngle);
      // Fixed beam width: 300px across the entire path (functionally and visually)
      const corridorFullWidth = 300;
      const fullHalfT = corridorFullWidth / 2; // 150px half-thickness
      const startHalfT = fullHalfT; // no wedge; constant thickness
      const rampLen = 0; // no ramp
      let anyHit = false;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i]; if (!e || !e.active || e.hp <= 0) continue;
        const relX = e.x - originX; const relY = e.y - originY;
        const proj = relX * cosA + relY * sinA; if (proj < 0) continue;
        const ortho = Math.abs(-sinA * relX + cosA * relY);
        let halfT = fullHalfT;
        // constant thickness (no wedge)
        if (ortho <= halfT + e.radius) {
          game.enemyManager?.takeDamage?.(e, beamDamage, proj > 600, false, WeaponType.GHOST_SNIPER, originX, originY, lvl, false, 'PLAYER');
          anyHit = true;
        }
      }
      // Boss intersection
      try {
        const bossMgr: any = (window as any).__bossManager;
        const boss = bossMgr && bossMgr.getBoss ? bossMgr.getBoss() : null;
        if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
          const relX = boss.x - originX; const relY = boss.y - originY;
          const proj = relX * cosA + relY * sinA;
          const ortho = Math.abs(-sinA * relX + cosA * relY);
          let halfT = fullHalfT; // constant thickness
          if (proj >= 0 && ortho <= (halfT + (boss.radius || 160))) {
            game.enemyManager?.takeBossDamage?.(boss, Math.round(beamDamage * 0.85), proj > 600, WeaponType.GHOST_SNIPER, originX, originY, lvl, false, 'PLAYER');
            anyHit = true;
          }
        }
      } catch {}

      // Visuals: store transient beam for local rendering (decoupled from Game.ts beams)
      this.vis = { start: now, duration: 900, angle: beamAngle, len: 4000, thickness: corridorFullWidth };
      // Recoil + shake
      this.player.x -= Math.cos(beamAngle) * 14;
      this.player.y -= Math.sin(beamAngle) * 14;
      try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 220, intensity: 7 } })); } catch {}
  // Impact flash at origin to sell corridor-wide blast
  try { this.game?.explosionManager?.triggerChargeGlow(originX, originY, 52, '#C9ECFF', 220); } catch {}
      // DPS history breadcrumb
      if (game && game.dpsHistory) game.dpsHistory.push({ time: performance.now(), damage: beamDamage });
    } catch {}

    // Start cooldown
    this.cdMs = this.cdMsMax;
    // Release basic fire suppression after recoil window
    setTimeout(() => { (this.player as any)._basicFireSuppressed = false; }, this.activeWindowMs);
  }

  getMeter(now: number) {
    const ready = this.cdMs <= 0 && !this.charging;
    const active = this.charging || (now < this.activeUntil);
    let value = 0, max = this.cdMsMax;
    if (this.charging && this.chargeStart != null) {
      value = Math.max(0, Math.min(now - this.chargeStart, this.chargeMsMax));
      max = this.chargeMsMax;
    } else {
      value = this.cdMsMax - this.cdMs;
      max = this.cdMsMax;
    }
    return { value, max, ready, active };
  }

  // Helpers for rendering/UX
  isCharging(): boolean { return this.charging; }
  getChargeProgress(now: number): number {
    if (!this.charging || this.chargeStart == null) return 0;
    const p = (now - this.chargeStart) / this.chargeMsMax;
    return p < 0 ? 0 : (p > 1 ? 1 : p);
  }

  /** Render charging cues and fired beam visuals. Called from the ability manager. */
  render(ctx: CanvasRenderingContext2D, player: Player) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Fired beam
    if (this.vis) {
      const t = (now - this.vis.start) / this.vis.duration;
      if (t >= 1) { this.vis = undefined; }
      else {
        const fade = 1 - t; const fadeEase = fade * fade;
        ctx.save();
        // Position/orientation at player origin at render time (origin follows player slight recoil)
        const ox = player.x; const oy = player.y - 8;
        ctx.translate(ox, oy);
        ctx.rotate(this.vis.angle);
        const len = this.vis.len;
        const tFull = Math.max(10, this.vis.thickness);
        // Temporal width expansion: start narrow, expand to full in ~140ms
        const expandMs = 140; // visual only; hitbox remains full
        const te = Math.min(1, Math.max(0, (now - this.vis.start) / expandMs));
        // Ease-out curve for a punchy open (fast at start, settle): cubic easeOut
        const teEase = 1 - Math.pow(1 - te, 3);
        const tNow = Math.max(6, tFull * (0.22 + 0.78 * teEase));
        // Solid slab (narrow->full)
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(180, 235, 255, ${0.78 * fadeEase})`;
        ctx.beginPath();
        ctx.rect(0, -tNow / 2, len, tNow);
        ctx.fill();
        // Brief additive core flash in first ~90ms for epic pop
        const flashMs = 90;
        if ((now - this.vis.start) < flashMs && !(this.game?.lowFX)) {
          const k = 1 - ((now - this.vis.start) / flashMs);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(255, 255, 255, ${0.55 * k})`;
          ctx.fillRect(0, -tNow * 0.22, Math.min(480, len * 0.4), tNow * 0.44);
          ctx.globalCompositeOperation = 'source-over';
        }
        // Edge lines
        ctx.shadowBlur = this.game?.lowFX ? 0 : 10 * (0.6 + 0.4 * fadeEase);
        ctx.shadowColor = `rgba(200, 245, 255, ${0.6 * fadeEase})`;
        ctx.strokeStyle = `rgba(220, 250, 255, ${0.9 * fadeEase})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -tNow / 2);
        ctx.lineTo(len, -tNow / 2);
        ctx.moveTo(0, tNow / 2);
        ctx.lineTo(len, tNow / 2);
        ctx.stroke();
        // Shockwave ring at origin for impact feel (first 160ms)
        const ringMs = 160;
        if ((now - this.vis.start) < ringMs && !(this.game?.lowFX)) {
          const tt = (now - this.vis.start) / ringMs;
          const ringR = 18 + tt * 44;
          const a = 0.35 * (1 - tt);
          ctx.save();
          ctx.setTransform(1,0,0,1,0,0);
          ctx.translate(ox, oy);
          ctx.beginPath();
          ctx.strokeStyle = `rgba(200, 240, 255, ${a})`;
          ctx.lineWidth = 2;
          ctx.arc(0,0, ringR, 0, Math.PI*2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }
    }
  }
}
