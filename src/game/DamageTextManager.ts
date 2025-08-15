export type DamageText = {
  x: number;
  y: number;
  value: number;
  life: number;
  color: string;
  active: boolean;
};

export class DamageTextManager {
  private pool: DamageText[] = [];

  constructor(initial = 40) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  private createDead(): DamageText {
    return { x: -9999, y: -9999, value: 0, life: 0, color: '#fff', active: false };
  }

  public spawn(x: number, y: number, value: number, color = '#FFD700') {
    const t = this.pool.find((t) => !t.active) || this.createDead();
    t.x = x + (Math.random() - 0.5) * 12;
    t.y = y + (Math.random() - 0.5) * 12;
    t.value = value;
    t.life = 24 + Math.floor(Math.random() * 8);
    t.color = color;
    t.active = true;
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

  public draw(ctx: CanvasRenderingContext2D) {
    for (const t of this.pool) {
      if (!t.active) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0.2, t.life / 32);
      ctx.font = 'bold 18px Orbitron, Arial';
      ctx.fillStyle = t.color;
      ctx.textAlign = 'center';
      ctx.fillText(`${t.value}`, t.x, t.y);
      ctx.restore();
    }
  }
}
