import { screenToWorld } from '../../../../core/coords';
import { WeaponType } from '../../../WeaponType';

/** Bio Engineer RMB: Mycelial Network — lays a toxic ribbon between player and cursor.
 * Enemies on the ribbon are heavily slowed and their poison ticks 2x faster.
 * Visual: neon-green/yellow glowing strand with spores drifting along it.
 */
export class MycelialNetworkRMB {
  private game: any;
  private cdUntil = 0;
  private readonly cooldownMs = 15000; // 15s CD
  private readonly lifeMs = 6000;      // 6s duration
  private readonly halfWidth = 30;     // ~60px wide ribbon

  constructor(game: any) { this.game = game; }

  /** Return current HUD meter values for the RMB (cooldown progress). */
  public getMeter(nowMs: number): { value: number; max: number; ready: boolean } {
    const max = this.cooldownMs;
    const remain = Math.max(0, this.cdUntil - nowMs);
    return { value: (max - remain), max, ready: remain <= 0 };
  }

  update(nowMs: number, _deltaMs: number, rDown: boolean, edge: boolean, camX: number, camY: number) {
    if (!edge || nowMs < this.cdUntil) return;
    // World-space cursor
    const ms: any = (window as any).mouseState;
    let wx = 0, wy = 0;
    if (ms && typeof ms.worldX === 'number' && typeof ms.worldY === 'number') {
      wx = ms.worldX; wy = ms.worldY;
    } else {
      const mx = (window as any).__mouseX || 0; const my = (window as any).__mouseY || 0;
      const w = screenToWorld(mx, my, camX, camY); wx = w.x; wy = w.y;
    }
    const p = this.game.player;
    const x1 = p.x, y1 = p.y, x2 = wx, y2 = wy;
    // Spawn gameplay zone in EnemyManager
    try { this.game.enemyManager.spawnMycelialNetwork(x1, y1, x2, y2, this.halfWidth * 2, this.lifeMs); } catch {}
    // Immediate spores along strand as feedback
    try {
      const pm = this.game.particleManager; if (pm) {
        const steps = 10;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps; const sx = x1 + (x2 - x1) * t; const sy = y1 + (y2 - y1) * t;
          const hue = 90 + Math.sin(t * Math.PI * 2) * 20; // around green/yellow
          const color = `hsl(${hue}, 100%, 60%)`;
          pm.spawn(sx, sy, 2, color, { sizeMin: 0.8, sizeMax: 1.6, lifeMs: 400, speedMin: 0.6, speedMax: 1.6 });
        }
      }
    } catch {}
    // Small screen pulse
    try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 80, intensity: 2.2 } })); } catch {}
    // Start CD
    this.cdUntil = nowMs + this.cooldownMs;
  }
}
