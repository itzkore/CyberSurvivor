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
    const logicalW = canvas.width / (dpr * rs);
    const logicalH = canvas.height / (dpr * rs);
    // Fade in/out effect
    let alpha = 1;
    if (this.progress < 60) {
      alpha = this.progress / 60;
    } else if (this.progress > this.duration - 60) {
      alpha = 1 - (this.progress - (this.duration - 60)) / 60;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';

    // Epic intro sequence
    if (this.progress < 180) {
      ctx.font = 'bold 54px Orbitron, sans-serif';
      ctx.fillStyle = '#0ff';
      ctx.shadowColor = '#00f6ff';
      ctx.shadowBlur = 24;
      ctx.fillText('CYBER SURVIVOR', logicalW / 2, logicalH / 2 - 40);
      ctx.font = '28px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('A Neon Roguelike Experience', logicalW / 2, logicalH / 2 + 30);
    } else if (this.progress < 420) {
      ctx.font = 'bold 42px Orbitron, sans-serif';
      ctx.fillStyle = '#ff00cc';
      ctx.shadowColor = '#ff00cc';
      ctx.shadowBlur = 18;
      ctx.fillText('In the year 2088...', logicalW / 2, logicalH / 2 - 20);
      ctx.font = '24px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('Mega-cities are ruled by rogue AIs.', logicalW / 2, logicalH / 2 + 30);
    } else if (this.progress < 660) {
      ctx.font = 'bold 42px Orbitron, sans-serif';
      ctx.fillStyle = '#00ffea';
      ctx.shadowColor = '#00ffea';
      ctx.shadowBlur = 18;
      ctx.fillText('You are the last survivor...', logicalW / 2, logicalH / 2 - 20);
      ctx.font = '24px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('Fight through endless waves of enemies.', logicalW / 2, logicalH / 2 + 30);
    } else {
      ctx.font = 'bold 48px Orbitron, sans-serif';
      ctx.fillStyle = '#0ff';
      ctx.shadowColor = '#00f6ff';
      ctx.shadowBlur = 24;
      ctx.fillText('Survive the Neon Onslaught!', logicalW / 2, logicalH / 2);
      ctx.font = '24px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('Good luck...', logicalW / 2, logicalH / 2 + 60);
    }
  // Draw skip button
  this.drawSkipButton(ctx, canvas);
  ctx.restore();
  }

  /**
   * Handles click events for the skip button. Should be called from main game input handler.
   * Returns true if skip was triggered.
   */
  public handleClick(x: number, y: number, canvas: HTMLCanvasElement): boolean {
    if (!this.active) return false;
    const btnWidth = 120;
    const btnHeight = 44;
    const dpr = (window as any).devicePixelRatio || 1;
    const rs = (window as any).__renderScale || 1;
    const logicalH = canvas.height / (dpr * rs);
    const btnX = 32;
    const btnY = logicalH - btnHeight - 32;
    if (x >= btnX && x <= btnX + btnWidth && y >= btnY && y <= btnY + btnHeight) {
      this.active = false;
      if (this.onComplete) this.onComplete();
      return true;
    }
    return false;
  }
}
