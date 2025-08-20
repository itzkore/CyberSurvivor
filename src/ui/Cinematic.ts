export class Cinematic {
  /**
   * Draws the skip button at the bottom left and handles click detection.
   * @param ctx CanvasRenderingContext2D
   * @param canvas HTMLCanvasElement
   */
  private drawSkipButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const btnWidth = 120;
    const btnHeight = 44;
    const dpr = (window as any).devicePixelRatio || 1;
    const rs = (window as any).__renderScale || 1;
    const logicalH = canvas.height / (dpr * rs);
    const x = 32;
    const y = logicalH - btnHeight - 32;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#222';
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, btnWidth, btnHeight, 12);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.fillStyle = '#0ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00f6ff';
    ctx.shadowBlur = 12;
    ctx.fillText('Skip', x + btnWidth / 2, y + btnHeight / 2);
    ctx.restore();
  }
  private progress: number = 0;
  public active: boolean = false;
  private onComplete: (() => void) | null = null;
  private duration: number = 900; // 15 seconds at 60fps

  /**
   * Returns true if the cinematic is finished.
   */
  public isFinished(): boolean {
    return !this.active;
  }

  /**
   * Advances the cinematic progress and calls onComplete if finished.
   */
  public update() {
    if (!this.active) return;
    this.progress++;
    if (this.progress > this.duration) {
      this.active = false;
      if (this.onComplete) this.onComplete();
    }
  }

  public start(onComplete: () => void) {
    this.progress = 0;
    this.active = true;
    this.onComplete = onComplete;
    // Attach temporary key listener for ESC skip
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.active) {
        this.active = false;
        if (this.onComplete) this.onComplete();
        window.removeEventListener('keydown', escHandler);
      }
    };
    window.addEventListener('keydown', escHandler);
  }

  public draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    if (!this.active) return;
    ctx.save();
    const dpr = (window as any).devicePixelRatio || 1;
    const rs = (window as any).__renderScale || 1;
    const scale = 1 / (dpr * rs);
    ctx.scale(scale, scale);
    const logicalW = canvas.width * scale;
    const logicalH = canvas.height * scale;
    const fadeFrames = 60;
    let alpha = 1;
    if (this.progress < fadeFrames) alpha = this.progress / fadeFrames; else if (this.progress > this.duration - fadeFrames) alpha = 1 - (this.progress - (this.duration - fadeFrames)) / fadeFrames;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, logicalW, logicalH);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const minDim = Math.min(logicalW, logicalH);
    const titleBase = Math.round(minDim * 0.08);
    const subBase = Math.round(titleBase * 0.48);
    const centerY = logicalH / 2;
    const drawBlock = (title: string, subtitle: string | null, color: string, glow: string) => {
      ctx.font = `bold ${titleBase}px Orbitron, sans-serif`;
      ctx.fillStyle = color;
      ctx.shadowColor = glow;
      ctx.shadowBlur = titleBase * 0.45;
      const titleY = centerY - (subtitle ? subBase * 0.9 : 0);
      ctx.fillText(title, logicalW / 2, titleY);
      if (subtitle) {
        ctx.font = `${subBase}px Orbitron, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.shadowBlur = 0;
        ctx.fillText(subtitle, logicalW / 2, centerY + subBase * 0.4);
      }
    };
    if (this.progress < 180) drawBlock('CYBER SURVIVOR', 'A Neon Roguelike Experience', '#0ff', '#00f6ff');
    else if (this.progress < 420) drawBlock('In the year 2088...', 'Mega-cities are ruled by rogue AIs.', '#ff00cc', '#ff00cc');
    else if (this.progress < 660) drawBlock('You are the last survivor...', 'Fight through endless waves of enemies.', '#00ffea', '#00ffea');
    else drawBlock('Survive the Neon Onslaught!', 'Good luck...', '#0ff', '#00f6ff');
    this.drawSkipButton(ctx, canvas);
    ctx.restore();
  }
}
