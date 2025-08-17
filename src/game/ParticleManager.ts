import type { Particle } from './Particle';

export class ParticleManager {
  private pool: Particle[] = [];

  constructor(initial = 100) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  private createDead(): Particle {
    return { x: -9999, y: -9999, vx: 0, vy: 0, life: 0, size: 2, color: '#fff', active: false };
  }

  public spawn(x: number, y: number, count = 8, color = '#ff0', opts?: { sizeMin?: number; sizeMax?: number; life?: number; speedMin?: number; speedMax?: number }) {
    for (let i = 0; i < count; i++) {
      const p = this.pool.find(p => !p.active) || (() => { const np = this.createDead(); this.pool.push(np); return np; })();
      this.activate(p, x, y, color, opts);
    }
  }

  private activate(p: Particle, x: number, y: number, color: string, opts?: { sizeMin?: number; sizeMax?: number; life?: number; speedMin?: number; speedMax?: number }) {
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
    p.life = opts?.life ?? 60;
    p.size = sizeMin + Math.random() * (sizeMax - sizeMin);
    p.color = color;
    p.active = true;
  }

  public update() {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98; // Ensure vertical velocity also decays
      p.life--;
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
    for (const p of this.pool) {
      if (!p.active) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, p.life / 60); // Fade out over the full life duration
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
