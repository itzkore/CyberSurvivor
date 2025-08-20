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
  // Cached skip button rect (logical space) for reliable hit detection
  private skipRect = { x:32, y:0, w:120, h:44 };

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
  // Use the same high-DPI scaling convention as the main game render path:
  // canvas.width/height are already multiplied by dpr * renderScale, so we upscale the context
  // so that drawing at logical CSS coordinates produces crisp output without manual conversion.
  const dpr = (window as any).devicePixelRatio || 1;
  const rs = (window as any).__renderScale || 1;
  ctx.scale(dpr * rs, dpr * rs);
  const logicalW = canvas.width / (dpr * rs);
  const logicalH = canvas.height / (dpr * rs);
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
  const titleBase = Math.round(minDim * 0.07); // tuned size for clearer separation
  const subBase = Math.round(titleBase * 0.42);
    const centerY = logicalH / 2;
    const t = this.progress;
    // Subtle vertical easing motion for main title block
    const easeInOut = (x:number) => x<0.5 ? 2*x*x : -1+(4-2*x)*x;
    const motionPhase = Math.min(1, t / 90);
    const yOffset = -20 * (1 - easeInOut(motionPhase));
    const drawBlock = (title: string, subtitle: string | null, gradStops: [string,string], glow: string) => {
      ctx.save();
      // Compute a block layout so title + subtitle never overlap regardless of size.
      const blockSpacing = subtitle ? subBase * 0.55 : 0; // gap between baseline of title & baseline of subtitle
      const totalBlockHeight = subtitle ? (titleBase + blockSpacing + subBase) : titleBase;
      const blockTop = centerY - totalBlockHeight / 2 + yOffset; // center vertically
      const titleY = blockTop + titleBase * 0.85; // adjust for typical cap height vs full em
      const subtitleY = subtitle ? (titleY + blockSpacing + subBase * 0.75) : 0;

      const grad = ctx.createLinearGradient(
        logicalW/2 - Math.min(400, titleBase * 6),
        titleY - titleBase,
        logicalW/2 + Math.min(400, titleBase * 6),
        titleY + titleBase
      );
      grad.addColorStop(0, gradStops[0]);
      grad.addColorStop(1, gradStops[1]);
      ctx.font = `900 ${titleBase}px Orbitron, sans-serif`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, Math.round(titleBase * 0.055));
      ctx.strokeStyle = '#00191c';
      ctx.shadowColor = glow;
      ctx.shadowBlur = Math.max(8, titleBase * 0.45);
      ctx.strokeText(title, logicalW/2, titleY);
      ctx.fillStyle = grad;
      ctx.fillText(title, logicalW/2, titleY);
      if (subtitle) {
        ctx.font = `600 ${subBase}px Orbitron, sans-serif`;
        ctx.shadowBlur = Math.max(4, subBase * 0.35);
        ctx.shadowColor = '#001417';
        ctx.fillStyle = '#dff';
        ctx.fillText(subtitle, logicalW/2, subtitleY);
      }
      ctx.restore();
    };
    if (t < 180) drawBlock('CYBER SURVIVOR', 'A Neon Roguelike Experience', ['#00ffff','#ff00cc'], '#00f6ff');
    else if (t < 420) drawBlock('In the year 2088...', 'Mega-cities are ruled by rogue AIs.', ['#ff2ad9','#ffa400'], '#ff00cc');
    else if (t < 660) drawBlock('You are the last survivor...', 'Fight through endless waves of enemies.', ['#00ffe0','#00b3ff'], '#00ffea');
    else drawBlock('Survive the Neon Onslaught!', 'Good luck...', ['#00ffff','#ff00cc'], '#00f6ff');
  // Skip button drawn in same logical coordinate space
  this.drawSkipButton(ctx, canvas);
  this.skipRect.y = logicalH - this.skipRect.h - 32; // keep rect aligned with button
    ctx.restore();
  }

  /** External click handler for reliable skip (coordinates already relative to canvas client box). */
  public handleClick(x:number, y:number, canvas:HTMLCanvasElement): boolean {
    if (!this.active) return false;
    // x,y are in CSS pixels (logical space) because getBoundingClientRect() was used upstream.
    const r = this.skipRect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      this.skip();
      return true;
    }
    return false;
  }

  /** Programmatically skip the cinematic and enter gameplay. */
  private skip() {
    if (!this.active) return;
    this.active = false;
    if (this.onComplete) this.onComplete();
  }
}
