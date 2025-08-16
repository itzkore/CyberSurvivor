import type { Particle } from './Particle';

export class ParticleManager {
  private pool: Particle[] = [];

  constructor(initial = 100) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  private createDead(): Particle {
    return { x: -9999, y: -9999, vx: 0, vy: 0, life: 0, size: 2, color: '#fff', active: false };
  }

  public spawn(x: number, y: number, count = 8, color = '#ff0') {
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((p) => !p.active);
      if (!p) {
        const np = this.createDead();
        this.pool.push(np);
        this.activate(np, x, y, color);
      } else this.activate(p, x, y, color);
    }
  }

  private activate(p: Particle, x: number, y: number, color: string) {
    p.x = x + (Math.random() - 0.5) * 8;
    p.y = y + (Math.random() - 0.5) * 8;
    const speed = 2 + Math.random() * 2;
    const ang = Math.random() * Math.PI * 2;
    p.vx = Math.cos(ang) * speed;
    p.vy = Math.sin(ang) * speed;
    p.life = 60; // Set a fixed life for explosion particles (approx 1 second at 60 FPS)
    p.size = 1 + Math.random() * 3;
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
