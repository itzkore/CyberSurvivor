import type { Particle } from './Particle';

export class ParticleManager {
  private pool: Particle[] = [];

  constructor(initial = 100) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  private createDead(): Particle {
  // life now stored in milliseconds
  return { x: -9999, y: -9999, vx: 0, vy: 0, life: 0, size: 2, color: '#fff', active: false };
  }

  public spawn(x: number, y: number, count = 8, color = '#ff0', opts?: { sizeMin?: number; sizeMax?: number; lifeMs?: number; speedMin?: number; speedMax?: number }) {
    // Adaptive density: if a global perf monitor is present on window with avgFrameMs, scale particle count
    const perfAvg = (window as any).__avgFrameMs as number | undefined;
    let effectiveCount = count;
    if (perfAvg !== undefined) {
      if (perfAvg > 55) effectiveCount = Math.ceil(count * 0.25);
      else if (perfAvg > 40) effectiveCount = Math.ceil(count * 0.5);
    }
    for (let i = 0; i < effectiveCount; i++) {
      const p = this.pool.find(p => !p.active) || (() => { const np = this.createDead(); this.pool.push(np); return np; })();
      this.activate(p, x, y, color, opts);
    }
  }

  private activate(p: Particle, x: number, y: number, color: string, opts?: { sizeMin?: number; sizeMax?: number; lifeMs?: number; speedMin?: number; speedMax?: number }) {
    const sizeMin = opts?.sizeMin ?? 1;
    const sizeMax = opts?.sizeMax ?? 4;
    const speedMin = opts?.speedMin ?? 2;
    const speedMax = opts?.speedMax ?? 4;
    p.x = x + (Math.random() - 0.5) * 8;
    p.y = y + (Math.random() - 0.5) * 8;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    const ang = Math.random() * Math.PI * 2;
    p.vx = Math.cos(ang) * speed;
    p.vy = Math.sin(ang) * speed;
  // Default 500ms particle life if not specified
  p.life = opts?.lifeMs ?? 500;
    p.size = sizeMin + Math.random() * (sizeMax - sizeMin);
    p.color = color;
    p.active = true;
  }

  public update(deltaMs: number = 16.6667) {
    const decay = Math.pow(0.98, deltaMs / 16.6667); // frame-rate independent decay
    for (const p of this.pool) {
      if (!p.active) continue;
      p.x += p.vx * (deltaMs / 16.6667);
      p.y += p.vy * (deltaMs / 16.6667);
      p.vx *= decay;
      p.vy *= decay;
      p.life -= deltaMs;
      if (p.life <= 0) {
        p.active = false;
        p.x = -9999;
        p.y = -9999;
      }
    }
  }

  /**
   * Draws all particles to the canvas.
   * @param ctx Canvas 2D context
   */
  public draw(ctx: CanvasRenderingContext2D) {
    const dW = (window as any).__designWidth || ctx.canvas.width;
    const dH = (window as any).__designHeight || ctx.canvas.height;
    const camX = (window as any).__camX || 0;
    const camY = (window as any).__camY || 0;
    const minX = camX - 64, maxX = camX + dW + 64;
    const minY = camY - 64, maxY = camY + dH + 64;
    ctx.save();
    ctx.lineWidth = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const a = Math.max(0.05, p.life / 500);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
