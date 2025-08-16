export type DamageText = {
  x: number;
  y: number;
  value: number;
  life: number;
  color: string;
  active: boolean;
  isCritical?: boolean; // New property for critical hits
};

export class DamageTextManager {
  private pool: DamageText[] = [];

  constructor(initial = 40) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  private createDead(): DamageText {
    return { x: -9999, y: -9999, value: 0, life: 0, color: '#fff', active: false, isCritical: false };
  }

  public spawn(x: number, y: number, value: number, color = '#FFD700', isCritical: boolean = false) { // Added isCritical parameter
    const t = this.pool.find((t) => !t.active) || this.createDead();
    t.x = x + (Math.random() - 0.5) * 12;
    t.y = y + (Math.random() - 0.5) * 12;
    t.value = value;
    t.life = isCritical ? 40 : 24 + Math.floor(Math.random() * 8); // Longer life for critical
    t.color = isCritical ? '#FF00FF' : color; // Purple for critical
    t.active = true;
    t.isCritical = isCritical;
    if (!this.pool.includes(t)) this.pool.push(t);
  }

  public update() {
    for (const t of this.pool) {
      if (!t.active) continue;
      t.y -= 0.7;
      t.life--;
      if (t.life <= 0) {
        t.active = false;
        t.x = -9999;
        t.y = -9999;
      }
    }
  }

  /**
   * Draws all damage text overlays to the canvas.
   * @param ctx Canvas 2D context
   * @param camX Camera X offset
   * @param camY Camera Y offset
   */
  public draw(ctx: CanvasRenderingContext2D, camX: number, camY: number) {
    for (const t of this.pool) {
      if (!t.active) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, t.life / (t.isCritical ? 40 : 32)); // Fade out based on life
      ctx.font = t.isCritical ? 'bold 24px Orbitron, Arial' : 'bold 18px Orbitron, Arial'; // Larger font for critical
      ctx.fillStyle = t.color;
      ctx.textAlign = 'center';
      if (t.isCritical) {
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 10;
      }
      ctx.fillText(`${t.value}`, t.x - camX + ctx.canvas.width / 2, t.y - camY + ctx.canvas.height / 2); // Adjust for camera
      ctx.restore();
    }
  }
}
