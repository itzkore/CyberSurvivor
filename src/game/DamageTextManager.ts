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
  // Reusable buffer to avoid allocations when formatting numbers
  private formatterTmp = { v: 0 };

  constructor(initial = 40) {
    for (let i = 0; i < initial; i++) this.pool.push(this.createDead());
  }

  private createDead(): DamageText {
    return { x: -9999, y: -9999, value: 0, life: 0, color: '#fff', active: false, isCritical: false };
  }

  public spawn(x: number, y: number, value: number, color = '#FFD700', isCritical: boolean = false) { // Added isCritical parameter
    const t = this.pool.find((t) => !t.active) || this.createDead();
  // Store precise world coords (add only tiny vertical offset so text is above source).
  // Random horizontal jitter caused misalignment vs boss/enemy position; remove it for clarity.
  t.x = x;
  t.y = y - 8; // small upward bias
    t.value = value; // store raw; format on draw
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
  public draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, renderScale: number = 1) {
    // Batch by (isCritical) since styles differ; could extend to color bucket if many colors appear.
    const normal: DamageText[] = [];
    const crit: DamageText[] = [];
    for (const t of this.pool) { if (!t.active) continue; (t.isCritical ? crit : normal).push(t); }
    ctx.textAlign = 'center';
    // Draw normal hits
    if (normal.length) {
      ctx.font = 'bold 18px Orbitron, Arial';
      for (let i=0;i<normal.length;i++) {
        const t = normal[i];
        ctx.globalAlpha = Math.max(0.2, t.life / 32);
        ctx.fillStyle = t.color;
        const raw = t.value;
        let display: string;
        if (raw >= 1000000) display = (raw / 1000000).toFixed(raw >= 10000000 ? 0 : 1) + 'm';
        else if (raw >= 1000) display = (raw / 1000).toFixed(raw >= 10000 ? 0 : 1) + 'k';
        else display = Math.round(raw).toString();
        const sx = (t.x - camX) * renderScale;
        const sy = (t.y - camY) * renderScale;
        ctx.fillText(display, sx, sy);
      }
    }
    // Draw critical hits (with glow)
    if (crit.length) {
      ctx.font = 'bold 24px Orbitron, Arial';
      ctx.shadowBlur = 10;
      for (let i=0;i<crit.length;i++) {
        const t = crit[i];
        ctx.globalAlpha = Math.max(0.2, t.life / 40);
        ctx.fillStyle = t.color;
        ctx.shadowColor = t.color;
        const raw = t.value;
        let display: string;
        if (raw >= 1000000) display = (raw / 1000000).toFixed(raw >= 10000000 ? 0 : 1) + 'm';
        else if (raw >= 1000) display = (raw / 1000).toFixed(raw >= 10000 ? 0 : 1) + 'k';
        else display = Math.round(raw).toString();
        const sx = (t.x - camX) * renderScale;
        const sy = (t.y - camY) * renderScale;
        ctx.fillText(display, sx, sy);
      }
      // Reset glow state minimally
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    }
  }
}
