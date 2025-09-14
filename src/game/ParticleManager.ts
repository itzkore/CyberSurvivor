import type { Particle } from './Particle';

export class ParticleManager {
  private pool: Particle[] = [];
  // Adaptive soft cap for pool growth; adjusted by perf in update/spawn
  private maxPool = 900; // default budget; lowered in low-FPS, raised in high-FPS

  constructor(initial = 100) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  /** Return a read-only view of the internal particle pool for renderers. */
  public getSnapshot(): ReadonlyArray<Particle> {
    return this.pool;
  }

  private createDead(): Particle {
  // life now stored in milliseconds
  return { x: -9999, y: -9999, vx: 0, vy: 0, life: 0, size: 2, color: '#fff', active: false };
  }

  /**
   * Spawn particles near a point with adaptive density and pool budgeting.
   * - Respects a dynamic pool cap that tightens under low FPS to avoid unbounded growth.
   * - Downscales spawn counts as frame time rises.
   */
  public spawn(
    x: number,
    y: number,
    count = 8,
    color = '#ff0',
    opts?: { sizeMin?: number; sizeMax?: number; lifeMs?: number; speedMin?: number; speedMax?: number }
  ) {
    // Adaptive density: if a global perf monitor is present on window with avgFrameMs, scale particle count
    const perfAvg = (window as any).__avgFrameMs as number | undefined;
    let effectiveCount = count;
    if (perfAvg !== undefined) {
      if (perfAvg > 40) effectiveCount = Math.ceil(count * 0.5);
      if (perfAvg > 55) effectiveCount = Math.ceil(count * 0.25);
      // Tighten max pool as perf drops
      this.maxPool = perfAvg > 55 ? 450 : perfAvg > 32 ? 700 : 900;
    } else {
      this.maxPool = 900;
    }
    // Ensure we don't exceed pool budget when allocating new particles
    for (let i = 0; i < effectiveCount; i++) {
      // Try to reuse first to avoid growth
      let p: Particle | undefined = undefined;
      // Classic for for speed
      for (let j = 0; j < this.pool.length; j++) { const cand = this.pool[j]; if (!cand.active) { p = cand; break; } }
      if (!p) {
        if (this.pool.length >= this.maxPool) break; // skip extra spawns beyond budget
        const np = this.createDead();
        this.pool.push(np);
        p = np;
      }
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
    // Update maxPool once per frame based on perf (keeps budget consistent even if no spawns occur)
    const perfAvg = (window as any).__avgFrameMs as number | undefined;
    if (perfAvg !== undefined) this.maxPool = perfAvg > 55 ? 450 : perfAvg > 32 ? 700 : 900;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      const dtScale = (deltaMs / 16.6667);
      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;
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
    const avgMs = (window as any).__avgFrameMs || 16;
    const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
    ctx.save();
    ctx.lineWidth = 0;
    // In vfxLow, stride through particles to reduce draw calls
    const step = vfxLow ? 2 : 1;
    for (let i = 0; i < this.pool.length; i += step) {
      const p = this.pool[i];
      if (!p || !p.active) continue;
      const px = p.x, py = p.y;
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      const a = Math.max(0.05, p.life / 500);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
