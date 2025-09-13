import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import { WeaponType } from '../../WeaponType';
import { WEAPON_SPECS } from '../../WeaponConfig';
import '../../keyState'; // Ensure mouseState is available globally

/**
 * Cyber Runner Ability Manager
 * Handles Vector Boomerang RMB, Dash (Shift), and Overdrive (Space) abilities
 */
export class CyberRunnerAbilityManager extends BaseAbilityManagerImpl {
  // Vector Boomerang RMB ability state
  private boomerangState: VBState = {
    active: false,
    startX: 0, startY: 0,
    x: 0, y: 0, vx: 0, vy: 0,
    t0: 0,
    spin: 0,
    phase: 'OUT' as const,
    targets: [],
    targetIndex: 0,
    returnX: 0, returnY: 0,
    trail: [],
    lastTick: 0,
    meterCdUntil: 0
  };

  // Dash Shift ability
  private dashCooldownMs: number = 0;
  private dashCooldownMsMax: number = 8000;
  private dashPrevKey: boolean = false;
  private dashActive: boolean = false;
  private dashTimeMs: number = 0;
  private dashDurationMs: number = 200;
  private dashDistance: number = 200;
  private dashStartX: number = 0;
  private dashStartY: number = 0;
  private dashEndX: number = 0;
  private dashEndY: number = 0;
  private afterimages: any[] = [];
  private afterimagesPool: any[] = [];
  private dashEmitAccum: number = 0;

  // Overdrive Space ability  
  private overdriveSurgeUntil: number = 0;

  // Input tracking
  private prevRightMouse: boolean = false;

  // Persist lingering trails after boomerang returns so they keep dealing effect for TTL
  private lingeringTrails: Array<{ trail: Array<{ x: number; y: number; t: number }>; expireAt: number }>= [];

  // Constants
  // Cooldown shown in HUD
  private static readonly BOOMERANG_CD_MS = 12000;
  // Movement tuning (units per ms since GameLoop update() receives delta in ms)
  private static readonly BOOMERANG_SPEED = 0.9; // ~15 px/frame at 60fps
  private static readonly BOOMERANG_SPIN = Math.PI * 2.2;
  // Trail lives for 4 seconds and applies small damage + slow while enemies overlap it
  private static readonly TRAIL_TTL = 4000;
  private static readonly TRAIL_RADIUS = 30; // px, thickness of lingering path
  private static readonly TRAIL_SAMPLE_STEP = 4; // sample every Nth node for perf
  private static readonly TRAIL_TICK_MS = 400; // how often an enemy can be ticked by trail
  private static readonly TRAIL_DMG_SCALE = 0.12; // % of bulletDamage per tick (small)
  private static readonly TRAIL_SLOW_MS = 1200; // slow duration from trail overlap
  private static readonly MAX_TARGETS = 5;
  // Outbound guarantees: even with no targets, fly visibly before returning
  private static readonly BOOMERANG_MAX_OUT_DIST = 520; // px from spawn
  private static readonly BOOMERANG_MAX_OUT_TIME = 900; // ms

  constructor() {
    super('cyber_runner');
  }

  update(deltaTime: number, keyState: any, inputLocked: boolean): void {
    const dt = deltaTime;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Update Dash cooldown
    if (this.dashCooldownMs > 0) {
      this.dashCooldownMs = Math.max(0, this.dashCooldownMs - dt);
    }

    // Handle Dash input (Shift)
    if (!inputLocked) {
      const shiftNow = !!keyState['shift'];
      if (shiftNow && !this.dashPrevKey && this.dashCooldownMs <= 0 && !this.dashActive) {
        this.performDash();
      }
      this.dashPrevKey = shiftNow;
    }

    // Update active dash
    if (this.dashActive) {
      this.updateDash(dt);
    }

    // Update Vector Boomerang RMB
    this.updateVectorBoomerang(dt, keyState, inputLocked, now);
  }

  private performDash(): void {
    if (this.dashCooldownMs > 0 || this.dashActive) return;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
    // Calculate dash distance based on level
    const lvl = Math.max(1, Math.round(this.player.level || 1));
    const distance = Math.min(400, this.dashDistance * (1 + lvl * 0.15));

    // Determine dash direction from input
    const keyState = (window as any).keyState || {};
    let dirX = 0, dirY = 0;
    if (keyState['w'] || keyState['arrowup']) dirY -= 1;
    if (keyState['s'] || keyState['arrowdown']) dirY += 1;
    if (keyState['a'] || keyState['arrowleft']) dirX -= 1;
    if (keyState['d'] || keyState['arrowright']) dirX += 1;

    // If no input, use last movement direction or default forward
    if (dirX === 0 && dirY === 0) {
      const mvMag = Math.hypot(this.player.vx || 0, this.player.vy || 0);
      if (mvMag > 0.1) {
        dirX = (this.player.vx || 0) / mvMag;
        dirY = (this.player.vy || 0) / mvMag;
      } else {
        dirY = -1; // Default upward
      }
    } else {
      const mag = Math.hypot(dirX, dirY);
      dirX /= mag;
      dirY /= mag;
    }

    this.dashStartX = this.player.x;
    this.dashStartY = this.player.y;
    this.dashEndX = this.player.x + dirX * distance;
    this.dashEndY = this.player.y + dirY * distance;
    this.dashTimeMs = 0;
    this.dashActive = true;
    this.dashDistance = distance;
    this.dashEmitAccum = 0;
    this.afterimages = [];

    // Brief i-frames during dash
    this.player.invulnerableUntilMs = Math.max(this.player.invulnerableUntilMs || 0, now + Math.min(this.dashDurationMs - 20, 150));

    // Start cooldown
    this.dashCooldownMs = this.dashCooldownMsMax;
  }

  private updateDash(dt: number): void {
    this.dashTimeMs += dt;
    const t = Math.max(0, Math.min(1, this.dashTimeMs / this.dashDurationMs));

    // Smooth easing
    const ease = t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);

    // Update position
    this.player.x = this.dashStartX + (this.dashEndX - this.dashStartX) * ease;
    this.player.y = this.dashStartY + (this.dashEndY - this.dashStartY) * ease;

    // Emit afterimages
    this.dashEmitAccum += dt;
    if (this.dashEmitAccum >= 12) {
      this.dashEmitAccum = 0;
      this.afterimages.push({
        x: this.player.x,
        y: this.player.y,
        alpha: 1.0
      });
    }

    // Fade afterimages
    for (const img of this.afterimages) {
      img.alpha = Math.max(0, img.alpha - dt / 200);
    }
    this.afterimages = this.afterimages.filter(img => img.alpha > 0);

    // End dash
    if (this.dashTimeMs >= this.dashDurationMs) {
      this.dashActive = false;
      this.dashTimeMs = 0;
      this.dashEmitAccum = 0;
    }
  }

  private updateVectorBoomerang(dt: number, keyState: any, inputLocked: boolean, now: number): void {
    const g: any = (this.player as any).gameContext || (window as any).__gameInstance;
    if (!g) return;

    // RMB input detection
    const mouseState = (window as any).mouseState;
    const rDown = !!(mouseState && mouseState.right);
    const edge = rDown && !this.prevRightMouse;
    this.prevRightMouse = rDown;

    if (edge && !this.boomerangState.active && now >= this.boomerangState.meterCdUntil && !inputLocked) {
      this.launchBoomerang(now, mouseState, g);
    }

    // Update active boomerang
    if (this.boomerangState.active) {
      this.updateBoomerangMovement(dt, now, g);
    }

    // Update lingering trails (apply effects and clean up)
    this.updateLingeringTrails(now, g);
  }

  private launchBoomerang(now: number, mouseState: any, g: any): void {
    // Launch toward mouse position or fallback direction
    let tx: number, ty: number;
    
    if (typeof mouseState.worldX === 'number' && typeof mouseState.worldY === 'number') {
      tx = mouseState.worldX;
      ty = mouseState.worldY;
    } else {
      // Fallback: launch upward
      tx = this.player.x;
      ty = this.player.y - 300;
    }

    this.boomerangState.active = true;
    this.boomerangState.t0 = now;
    this.boomerangState.lastTick = now;
    this.boomerangState.startX = this.player.x;
    this.boomerangState.startY = this.player.y;
    this.boomerangState.x = this.player.x;
    this.boomerangState.y = this.player.y;
    this.boomerangState.spin = CyberRunnerAbilityManager.BOOMERANG_SPIN;
    this.boomerangState.phase = 'OUT';
    this.boomerangState.trail = [];
    this.boomerangState.targets = [];
    this.boomerangState.targetIndex = 0;
  (this.boomerangState as any).impacted = new Set<any>();

    // Calculate direction and velocity (ensure non-zero)
    let dx = tx - this.player.x;
    let dy = ty - this.player.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 1) { dy = -1; dx = 0; distance = 1; }
    const nx = dx / distance;
    const ny = dy / distance;

    this.boomerangState.vx = nx * CyberRunnerAbilityManager.BOOMERANG_SPEED;
    this.boomerangState.vy = ny * CyberRunnerAbilityManager.BOOMERANG_SPEED;

    // Start cooldown
    this.boomerangState.meterCdUntil = now + CyberRunnerAbilityManager.BOOMERANG_CD_MS;

    // Seed a starting trail sample so path is visible from the first frame
    this.boomerangState.trail.push({ x: this.boomerangState.x, y: this.boomerangState.y, t: now });
  }

  private updateBoomerangMovement(dt: number, now: number, g: any): void {
    const S = this.boomerangState;

    // Find nearby enemies for targeting
    if (S.phase === 'OUT' && S.targets.length < CyberRunnerAbilityManager.MAX_TARGETS) {
      try {
        const enemies = g.enemyManager?.getEnemies ? g.enemyManager.getEnemies() : [];
        for (const e of enemies) {
          if (e.dead) continue;
          const dist = Math.hypot(e.x - S.x, e.y - S.y);
          if (dist < 120 && !S.targets.includes(e)) {
            S.targets.push(e);
            if (S.targets.length >= CyberRunnerAbilityManager.MAX_TARGETS) break;
          }
        }
      } catch {}
    }

    // Phase logic
    if (S.phase === 'OUT') {
      // Move toward next target; if none, continue forward visibly before returning
      if (S.targetIndex < S.targets.length) {
        const target = S.targets[S.targetIndex];
        const dx = target.x - S.x;
        const dy = target.y - S.y;
        const d = Math.hypot(dx, dy);
        if (d < 25) {
          S.targetIndex++;
        } else {
          const steer = 0.15;
          const desiredX = (dx / d) * CyberRunnerAbilityManager.BOOMERANG_SPEED;
          const desiredY = (dy / d) * CyberRunnerAbilityManager.BOOMERANG_SPEED;
          S.vx = S.vx * (1 - steer) + desiredX * steer;
          S.vy = S.vy * (1 - steer) + desiredY * steer;
        }
      } else {
        // No targets: keep going straight until max distance or time, then return
        const traveled = Math.hypot(S.x - S.startX, S.y - S.startY);
        const elapsed = now - S.t0;
        if (traveled >= CyberRunnerAbilityManager.BOOMERANG_MAX_OUT_DIST || elapsed >= CyberRunnerAbilityManager.BOOMERANG_MAX_OUT_TIME) {
          S.phase = 'RETURN';
        } // else: keep current vx, vy (forward)
      }
    } else if (S.phase === 'RETURN') {
      // Return to player
      const dx = this.player.x - S.x;
      const dy = this.player.y - S.y;
      const d = Math.hypot(dx, dy);
      const steer = 0.2;
      const desiredX = (dx / d) * CyberRunnerAbilityManager.BOOMERANG_SPEED;
      const desiredY = (dy / d) * CyberRunnerAbilityManager.BOOMERANG_SPEED;
      S.vx = S.vx * (1 - steer) + desiredX * steer;
      S.vy = S.vy * (1 - steer) + desiredY * steer;

      if (d < 28) {
        // On return, finalize and persist trail for lingering effect
        try {
          const copy = S.trail.slice();
          if (copy.length > 1) {
            this.lingeringTrails.push({ trail: copy, expireAt: now + CyberRunnerAbilityManager.TRAIL_TTL });
          }
        } catch {}
        S.active = false;
      }
    }

    // Update position
    S.x += S.vx * dt;
    S.y += S.vy * dt;

    // Add trail point
    S.trail.push({ x: S.x, y: S.y, t: now });
    while (S.trail.length > 0 && now - S.trail[0].t > CyberRunnerAbilityManager.TRAIL_TTL) {
      S.trail.shift();
    }

    // Apply impact damage (single-hit, capped) and slow, plus lingering trail effects
    try {
      const enemies = g.enemyManager?.getEnemies ? g.enemyManager.getEnemies() : [];
      const impacted: Set<any> = (S as any).impacted || new Set<any>();
      for (const e of enemies) {
        if (e.dead) continue;
        const distToBoomerang = Math.hypot(e.x - S.x, e.y - S.y);
        // On first contact per enemy per launch, deal a heavy impact: 400% of current Runner bullet damage
        if (distToBoomerang < 55) {
          if (!impacted.has(e) && impacted.size < CyberRunnerAbilityManager.MAX_TARGETS) {
            const base = (this.player.bulletDamage || this.player.baseDamage || 10);
            const mul = (this.player.getGlobalDamageMultiplier?.() ?? this.player.globalDamageMultiplier ?? 1);
            // Increase impact damage by +100% (from 4.0× to 8.0× Runner bullet damage)
            const impact = Math.max(1, Math.round(base * (mul || 1) * 8.0));
            g.enemyManager.takeDamage(e, impact, false, false, WeaponType.RUNNER_GUN, S.x, S.y, (this.player as any)?.weaponLevel || 1, false, 'PLAYER');
            impacted.add(e);
            (e as any)._vbSlowUntil = now + 900;
          } else {
            // Already impacted this launch: just refresh a short slow on close pass
            (e as any)._vbSlowUntil = Math.max((e as any)._vbSlowUntil || 0, now + 600);
          }
        }
      }
      (S as any).impacted = impacted;
      // Apply trail effects for current active trail
      this.applyTrailEffects(S.trail, now, g);
    } catch {}
  }

  // Shared trail effect application (active or lingering)
  private applyTrailEffects(trail: Array<{ x: number; y: number; t: number }>, now: number, g: any) {
    if (!trail || trail.length <= 1) return;
    try {
      const enemies = g.enemyManager?.getEnemies ? g.enemyManager.getEnemies() : [];
      const r2 = CyberRunnerAbilityManager.TRAIL_RADIUS * CyberRunnerAbilityManager.TRAIL_RADIUS;
      for (let ei = 0; ei < enemies.length; ei++) {
        const e: any = enemies[ei];
        if (!e || e.dead) continue;
        const dueTrail = e._vbTrailNextTick || 0;
        if (now < dueTrail) continue;
        const ex = e.x as number; const ey = e.y as number;
        let hitTrail = false;
        for (let i = 0; i < trail.length; i += CyberRunnerAbilityManager.TRAIL_SAMPLE_STEP) {
          const p = trail[i];
          const dx = ex - p.x; const dy = ey - p.y;
          if ((dx * dx + dy * dy) <= r2) { hitTrail = true; break; }
        }
        if (!hitTrail) continue;
        const base = (this.player.bulletDamage || this.player.baseDamage || 10);
        const mul = (this.player.getGlobalDamageMultiplier?.() ?? this.player.globalDamageMultiplier ?? 1);
        const weaponLvl = (this.player as any)?.weaponLevel || 1;
        const dmgSmall = Math.max(1, Math.round(base * (mul || 1) * (CyberRunnerAbilityManager.TRAIL_DMG_SCALE + 0.01 * (weaponLvl - 1))));
        g.enemyManager.takeDamage(e, dmgSmall, false, false, WeaponType.RUNNER_GUN, ex, ey, weaponLvl, false, 'PLAYER');
        e._vbTrailNextTick = now + CyberRunnerAbilityManager.TRAIL_TICK_MS;
        const slowUntil = now + CyberRunnerAbilityManager.TRAIL_SLOW_MS;
        e._vbSlowUntil = Math.max(e._vbSlowUntil || 0, slowUntil);
      }
    } catch {}
  }

  private updateLingeringTrails(now: number, g: any) {
    if (!this.lingeringTrails || this.lingeringTrails.length === 0) return;
    // Apply effects and prune expired trails
    for (let i = 0; i < this.lingeringTrails.length; i++) {
      const lt = this.lingeringTrails[i];
      // Drop old points beyond TTL to keep arrays small
      while (lt.trail.length > 0 && now - lt.trail[0].t > CyberRunnerAbilityManager.TRAIL_TTL) {
        lt.trail.shift();
      }
      if (lt.trail.length <= 1 || now >= lt.expireAt) {
        // Mark empty by clearing array; actual prune later
        lt.trail.length = 0;
        continue;
      }
      // Apply lingering effects
      this.applyTrailEffects(lt.trail, now, g);
    }
    // Prune empties
    this.lingeringTrails = this.lingeringTrails.filter(t => t.trail.length > 1 && now < t.expireAt);
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
    return {
      runner_vector_boomerang: {
        value: Math.max(0, CyberRunnerAbilityManager.BOOMERANG_CD_MS - Math.max(0, this.boomerangState.meterCdUntil - now)),
        max: CyberRunnerAbilityManager.BOOMERANG_CD_MS,
        ready: now >= this.boomerangState.meterCdUntil,
        active: this.boomerangState.active
      },
      runner_dash: {
        value: Math.max(0, this.dashCooldownMsMax - this.dashCooldownMs),
        max: this.dashCooldownMsMax,
        ready: this.dashCooldownMs <= 0,
        active: this.dashActive
      }
    };
  }

  handleKeyPress(key: string): boolean {
    // Handle any special key presses for Cyber Runner
    return false; // Return true if handled, false otherwise
  }

  render(ctx: CanvasRenderingContext2D, player: any): void {
    // Context here is already in WORLD SPACE (Game.ts applies scale and translate(-camX,-camY)).
    // Draw using world coordinates directly.
    // Runner dash: no ground AoE visuals. Skip afterimage circles to avoid confusion.

    // Render boomerang (active)
    if (this.boomerangState.active) {
      this.renderBoomerang(ctx);
    }
    // Render lingering trails (without boomerang body)
    if (this.lingeringTrails && this.lingeringTrails.length > 0) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const isEvolved = !!((this.player as any)?.activeWeapons && (this.player as any).activeWeapons.has(WeaponType.RUNNER_OVERDRIVE));
      for (const lt of this.lingeringTrails) {
        if (!lt || !lt.trail || lt.trail.length <= 1) continue;
        this.renderTrailOnly(ctx, lt.trail, now, isEvolved);
      }
    }
  }

  private renderBoomerang(ctx: CanvasRenderingContext2D): void {
    const S = this.boomerangState;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
  // Trail effects (smoke/glow only)
  const isEvolved = !!((this.player as any)?.activeWeapons && (this.player as any).activeWeapons.has(WeaponType.RUNNER_OVERDRIVE));
  this.renderTrailOnly(ctx, S.trail, now, isEvolved);

  // Boomerang body (smaller visual silhouette)
    const ang = (now - S.t0) / 1000 * S.spin;
    
    ctx.save();
    ctx.translate(S.x, S.y);
    ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    // Core shape
  const bodyFill = isEvolved ? '#ff5a5a' : '#3bd1ff';
  const bodyStroke = isEvolved ? '#ffdede' : '#ffffff';
  ctx.fillStyle = bodyFill;
  ctx.strokeStyle = bodyStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Scaled down ~60%
    ctx.moveTo(16, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Center glint
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderTrailOnly(ctx: CanvasRenderingContext2D, trail: Array<{ x: number; y: number; t: number }>, now: number, evolved: boolean) {
    if (!trail || trail.length <= 0) return;
    // Smoke/glow puffs only (skip very end to avoid a solid cap)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const nP = trail.length;
    const skipTailCount = Math.max(1, Math.floor(nP * 0.08)); // skip last ~8% of points
    for (let i = 0; i < nP; i++) {
      if (i >= nP - skipTailCount) continue; // avoid a round "head" disc at the end
      const b = trail[i];
      const age = (now - b.t) / CyberRunnerAbilityManager.TRAIL_TTL;
      let alpha = Math.max(0, 1 - age);
      // Also gently fade the last ~15% to avoid a filled ribbon effect
      const along = i / Math.max(1, nP - 1);
      if (along > 0.85) alpha *= 0.45;
      const tsx = b.x;
      const tsy = b.y;
      // Thinner puffs for a much smaller visual footprint (was ~14..30)
      const r = (7 + 9 * (1 - age)) * (along > 0.90 ? 0.6 : 0.85);
      const grad = ctx.createRadialGradient(tsx, tsy, 0, tsx, tsy, r);
      if (evolved) {
        // Red theme for evolved Runner Gun
        grad.addColorStop(0, `rgba(255,90,90,${0.34 * alpha})`);
        grad.addColorStop(1, 'rgba(200,0,0,0)');
      } else {
        grad.addColorStop(0, `rgba(80,220,255,${0.32 * alpha})`);
        grad.addColorStop(1, 'rgba(0,120,200,0)');
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(tsx, tsy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // No inner bright line: user requested only the smoke trail.
    ctx.restore();
  }
}

// VBState interface
interface VBState {
  active: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t0: number;
  spin: number;
  phase: 'OUT' | 'CHASE' | 'RETURN';
  targets: any[];
  targetIndex: number;
  returnX: number;
  returnY: number;
  trail: Array<{ x: number; y: number; t: number }>;
  lastTick: number;
  meterCdUntil: number;
}