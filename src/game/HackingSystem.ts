/**
 * Mouse-driven manual hacking system (MVP).
 *
 * Design goals:
 * - Activate only for Rogue Hacker (or future hacking-enabled classes).
 * - Player holds right mouse (or configurable) to charge a hack while aiming a reticle.
 * - Nearest valid enemy inside reticle radius becomes the target; on release after min charge, apply a slow/paralyze debuff.
 * - Non-intrusive: zero overhead when idle; O(N) scan only while charging (early exit best target pass).
 * - Visuals: simple reticle circle + charge arc + target highlight hook (draw returns selected enemy data for caller to decorate).
 * - Extensible: state machine + hooks for future packet / multi-link mechanics.
 */
import type { Enemy } from './EnemyManager';
import { mouseState } from './keyState';

export interface HackingSystemOptions {
  /** Radius (world units) of the targeting reticle. */
  radius?: number;
  /** Minimum charge time (ms) required before releasing executes hack. */
  minChargeMs?: number;
  /** Full charge time (ms) (used for arc). Beyond this grants no extra potency for MVP. */
  fullChargeMs?: number;
  /** Mind control duration (ms). */
  controlDurationMs?: number;
  /** Cooldown between hack executions (ms). */
  cooldownMs?: number;
  /** Whether right mouse button must be held. (Future: allow key remap) */
  useRightButton?: boolean;
  /** If true, hack can only execute when mouse is directly over (inside radius of) the chosen enemy. */
  requireMouseOver?: boolean;
}

type HackState = 'IDLE' | 'CHARGING' | 'COOLDOWN';

export interface HackVisualInfo {
  target: Enemy | null;
  chargeFrac: number; // 0..1
  state: HackState;
  cx: number; cy: number; radius: number;
  /** True if mouse is directly over an enemy this frame (strict hit test). */
  hovered: boolean;
}

export class HackingSystem {
  private opts: Required<HackingSystemOptions>;
  private state: HackState = 'IDLE';
  private chargeStart: number = 0;
  private cooldownUntil: number = 0;
  private lastVisual: HackVisualInfo | null = null;
  private enabled: boolean = true; // external toggle if class changes
  private _lastExecAt: number = 0;
  private _lastTargetId: number = -1;

  constructor(options?: HackingSystemOptions) {
    this.opts = {
      radius: options?.radius ?? 180,
      minChargeMs: options?.minChargeMs ?? 300,
      fullChargeMs: options?.fullChargeMs ?? 1200,
  controlDurationMs: options?.controlDurationMs ?? 10000,
  cooldownMs: options?.cooldownMs ?? 15000,
      useRightButton: options?.useRightButton ?? true,
  requireMouseOver: options?.requireMouseOver ?? true,
    };
  }

  /** Enable / disable system (e.g. non-hacker class). */
  public setEnabled(v: boolean) { this.enabled = v; if (!v) { this.state = 'IDLE'; this.lastVisual = null; } }

  /** Returns last frame visual info (after update). */
  public getVisual(): HackVisualInfo | null { return this.lastVisual; }

  /** Core update. Supply: dt, world mouse -> (mx,my), list of enemies (subset already active), and a timestamp. */
  public update(now: number, dt: number, enemies: Enemy[], worldMouseX: number, worldMouseY: number, isRightButtonDown: boolean) {
    if (!this.enabled) { this.lastVisual = null; return; }
    // Transition out of cooldown
    if (this.state === 'COOLDOWN' && now >= this.cooldownUntil) {
      this.state = 'IDLE';
    }
  const { radius, minChargeMs, fullChargeMs, cooldownMs, controlDurationMs } = this.opts;
    let target: Enemy | null = null;
    const useBtn = this.opts.useRightButton;
    const triggerDown = useBtn ? isRightButtonDown : mouseState.down;

    // Track hovered enemy (strict mouseover) for gating if required
    const hovered = this.findMouseOverEnemy(enemies, worldMouseX, worldMouseY);

    switch (this.state) {
      case 'IDLE': {
        if (triggerDown) {
          // Only begin charging if an enemy is directly under cursor (strict mouseover)
          if (!this.opts.requireMouseOver || hovered) {
            this.state = 'CHARGING';
            this.chargeStart = now;
          } // else ignore press until cursor is over an enemy
        }
        break;
      }
      case 'CHARGING': {
        if (!triggerDown) {
          // Release -> attempt execute
            const chargedMs = now - this.chargeStart;
            if (chargedMs >= minChargeMs) {
              // Acquire target (scan once at release for accuracy)
              target = this.findNearestEnemy(enemies, worldMouseX, worldMouseY, radius);
              if (target) {
                if (this.opts.requireMouseOver && hovered && hovered !== target) {
                  // Require that the specific hovered enemy is the one we fire on; if different target picked, abort.
                  target = null;
                }
                if (target) {
                  this.executeHack(now, target, controlDurationMs);
                  this.state = 'COOLDOWN';
                  this.cooldownUntil = now + cooldownMs;
                } else {
                  this.state = 'IDLE';
                }
              } else {
                this.state = 'IDLE'; // no target found
              }
            } else {
              this.state = 'IDLE'; // insufficient charge
            }
        } else {
          // While charging, track current potential target for UI only (cheap nearest scan)
          target = this.findNearestEnemy(enemies, worldMouseX, worldMouseY, radius);
        }
        break;
      }
    }

    const chargeFrac = this.state === 'CHARGING' ? Math.max(0, Math.min(1, (now - this.chargeStart) / fullChargeMs)) : 0;
    // If we require mouseover and the hovered enemy differs, zero out target in visual to reflect gating
    if (this.opts.requireMouseOver && target && hovered && hovered !== target) {
      target = null;
    }
  this.lastVisual = { target, chargeFrac, state: this.state, cx: worldMouseX, cy: worldMouseY, radius, hovered: !!hovered };
  }

  /** Internal: find nearest enemy to (x,y) within r. */
  private findNearestEnemy(enemies: Enemy[], x: number, y: number, r: number): Enemy | null {
    let best: Enemy | null = null; let bestD2 = r * r;
    for (let i=0;i<enemies.length;i++) {
      const e: any = enemies[i]; if (!e || e.dead) continue;
      // Skip enemies already heavily paralyzed by class effects (optional future filter)
      const dx = e.x - x; const dy = e.y - y; const d2 = dx*dx + dy*dy;
      if (d2 <= bestD2) { bestD2 = d2; best = e; }
    }
    return best;
  }

  /** Strict mouseover: enemy center distance <= its radius. */
  private findMouseOverEnemy(enemies: Enemy[], x: number, y: number): Enemy | null {
    for (let i=0;i<enemies.length;i++) {
      const e: any = enemies[i]; if (!e || e.dead) continue;
      const dx = e.x - x; const dy = e.y - y; const r = (e.radius || 0); if (dx*dx + dy*dy <= r*r) return e;
    }
    return null;
  }

  /** Apply hack debuff & emit event for FX / audio. */
  private executeHack(now: number, enemy: Enemy, controlMs: number) {
    const anyE: any = enemy as any;
    const until = now + controlMs;
    // Clear paralysis if present; apply mind control flags
    anyE._paralyzedUntil = 0;
    anyE._mindControlledUntil = until;
    anyE._mindControlNextPulse = now; // schedule immediate first pulse
    anyE._lastHackedAt = now;
    this._lastExecAt = now; this._lastTargetId = (anyE.id || anyE.uid || -1);
    try { window.dispatchEvent(new CustomEvent('manualHackExecute', { detail: { enemyId: this._lastTargetId, x: enemy.x, y: enemy.y, until, controlMs } })); } catch {}
  }

  /** Cooldown / readiness meter for HUD. value counts up toward max. */
  public getMeter(): { value:number; max:number; ready:boolean } {
    const now = performance.now();
    const max = this.opts.cooldownMs;
    const remain = Math.max(0, this.cooldownUntil - now);
    const ready = remain <= 0 && this.state !== 'CHARGING';
    return { value: ready ? max : (max - remain), max, ready };
  }
}

/** Utility to map screen -> world for mouse if camera offset known. */
export function screenToWorld(mx: number, my: number, camX: number, camY: number): { x:number; y:number } {
  return { x: mx + camX, y: my + camY };
}
