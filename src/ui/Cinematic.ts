export class Cinematic {
  /**
   * Draws the skip button at the bottom left and handles click detection.
   * @param ctx CanvasRenderingContext2D
   * @param canvas HTMLCanvasElement
   */
  private drawSkipButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, logicalH: number) {
    // Adaptive sizing for very small heights
    const small = logicalH < 480;
    const btnWidth = small ? 100 : 120;
    const btnHeight = small ? 36 : 44;
    const x = 24; // slightly tighter margin for tiny screens
    const bottomPad = small ? 16 : 32;
    const y = Math.max(8, logicalH - btnHeight - bottomPad);
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
  // NOTE: Game.render already applied internal scaling; we base layout strictly on CSS pixels (client rect)
  // to remain correct under Windows display scaling (>100%) and any DPI changes.
  const rect = canvas.getBoundingClientRect();
  let logicalW = rect.width;
  let logicalH = rect.height;
  // Fallback if rect not ready (very early frame)
  if (!logicalW || !logicalH) {
    logicalW = window.innerWidth || canvas.width;
    logicalH = window.innerHeight || canvas.height;
  }
    const fadeFrames = 60;
    let alpha = 1;
    if (this.progress < fadeFrames) alpha = this.progress / fadeFrames; else if (this.progress > this.duration - fadeFrames) alpha = 1 - (this.progress - (this.duration - fadeFrames)) / fadeFrames;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, logicalW, logicalH);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  // Adaptive text scaling relative to a design baseline to avoid oversized appearance on high DPI scaled desktops.
  const baseW = 1600;
  const baseH = 900;
  const scale = Math.min(logicalW / baseW, logicalH / baseH, 1); // never upscale above 1
  // Base font sizes (iteratively shrink later if needed)
  let titleBase = Math.round(72 * scale); // 72px at baseline
  let subBase = Math.round(Math.max(24, titleBase * 0.38));
    const centerY = logicalH / 2;
    const t = this.progress;
    // Subtle vertical easing motion for main title block
  // Removed previous easing yOffset to guarantee strict centering.
  const yOffset = 0;
    const wrapText = (text: string, font: string, maxWidth: number): string[] => {
      if (!text) return [];
      ctx.font = font;
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let cur = '';
      for (let i=0;i<words.length;i++) {
        const test = cur ? cur + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width > maxWidth && cur) {
          lines.push(cur);
          cur = words[i];
        } else {
          cur = test;
        }
      }
      if (cur) lines.push(cur);
      return lines;
    };
    const drawBlock = (title: string, subtitle: string | null, gradStops: [string,string], glow: string) => {
      ctx.save();
      const safePadX = Math.min(80, Math.max(32, logicalW * 0.05));
      const safePadTop = Math.min(120, Math.max(32, logicalH * 0.06));
      const safePadBottom = Math.min(140, Math.max(80, logicalH * 0.12)); // allow room for skip
      const maxW = logicalW - safePadX * 2;
      const maxH = logicalH - safePadTop - safePadBottom;
      const build = () => {
        ctx.font = `900 ${titleBase}px Orbitron, sans-serif`;
        const titleLines = wrapText(title, ctx.font, maxW);
        const tLH = Math.round(titleBase * 1.06);
        ctx.font = `600 ${subBase}px Orbitron, sans-serif`;
        const subtitleLines = subtitle ? wrapText(subtitle, ctx.font, maxW * 0.92) : [];
        const sLH = Math.round(subBase * 1.12);
        const gap = subtitle ? Math.max(12, subBase * 0.6) : 0;
        // width measurement
        ctx.font = `900 ${titleBase}px Orbitron, sans-serif`;
        let widest = 0; for (const l of titleLines) { const w = ctx.measureText(l).width; if (w > widest) widest = w; }
        ctx.font = `600 ${subBase}px Orbitron, sans-serif`;
        for (const l of subtitleLines) { const w = ctx.measureText(l).width; if (w > widest) widest = w; }
        const totalH = titleLines.length * tLH + (subtitle ? gap + subtitleLines.length * sLH : 0);
        return { titleLines, subtitleLines, tLH, sLH, gap, widest, totalH };
      };
      let m = build();
      let tries = 0;
      while ((m.widest > maxW || m.totalH > maxH) && tries < 14) {
        const scaleW = maxW / Math.max(1, m.widest);
        const scaleH = maxH / Math.max(1, m.totalH);
        const s = Math.min(scaleW, scaleH, 0.97);
        titleBase = Math.max(18, Math.floor(titleBase * s));
        subBase = Math.max(10, Math.round(titleBase * 0.40));
        m = build();
        tries++;
      }
      const blockTop = Math.round((logicalH - m.totalH) / 2);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#00191c';
      ctx.shadowColor = glow; ctx.shadowBlur = Math.max(8, titleBase * 0.45);
      ctx.lineWidth = Math.max(2, Math.round(titleBase * 0.055));
      const grad = ctx.createLinearGradient(
        logicalW/2 - Math.min(420, titleBase * 7),
        blockTop - titleBase,
        logicalW/2 + Math.min(420, titleBase * 7),
        blockTop + titleBase * m.titleLines.length
      );
      grad.addColorStop(0, gradStops[0]);
      grad.addColorStop(1, gradStops[1]);
      ctx.font = `900 ${titleBase}px Orbitron, sans-serif`;
      for (let i=0;i<m.titleLines.length;i++) {
        const y = blockTop + i * m.tLH + titleBase * 0.70; // reduced baseline offset for true visual centering
        const line = m.titleLines[i];
        ctx.strokeText(line, logicalW/2, y);
        ctx.fillStyle = grad;
        ctx.fillText(line, logicalW/2, y);
      }
      if (m.subtitleLines.length) {
        ctx.shadowBlur = Math.max(4, subBase * 0.35);
        ctx.shadowColor = '#001417';
        ctx.fillStyle = '#dff';
        ctx.font = `600 ${subBase}px Orbitron, sans-serif`;
  const subStart = blockTop + m.titleLines.length * m.tLH + m.gap + subBase * 0.65; // reduced baseline offset
        for (let i=0;i<m.subtitleLines.length;i++) {
          const y = subStart + i * m.sLH;
          ctx.fillText(m.subtitleLines[i], logicalW/2, y);
        }
      }
      ctx.restore();
    };
    if (t < 180) drawBlock('CYBER SURVIVOR', 'A Neon Roguelike Experience', ['#00ffff','#ff00cc'], '#00f6ff');
    else if (t < 420) drawBlock('In the year 2088...', 'Mega-cities are ruled by rogue AIs.', ['#ff2ad9','#ffa400'], '#ff00cc');
    else if (t < 660) drawBlock('You are the last survivor...', 'Fight through endless waves of enemies.', ['#00ffe0','#00b3ff'], '#00ffea');
    else drawBlock('Survive the Neon Onslaught!', 'Good luck...', ['#00ffff','#ff00cc'], '#00f6ff');
  // Skip button drawn in adjusted logical coordinate space
  this.drawSkipButton(ctx, canvas, logicalH);
  // Update hit rect (match adaptive sizing logic)
  const small = logicalH < 480;
  this.skipRect.w = small ? 100 : 120;
  this.skipRect.h = small ? 36 : 44;
  const bottomPad = small ? 16 : 32;
  this.skipRect.x = small ? 24 : 32; // keep near margin
  this.skipRect.y = Math.max(8, logicalH - this.skipRect.h - bottomPad);
  // Optional debug: set window.__cinCenterTest = true to show crosshair & bounding box
  if ((window as any).__cinCenterTest) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(logicalW/2,0); ctx.lineTo(logicalW/2,logicalH); ctx.moveTo(0,logicalH/2); ctx.lineTo(logicalW,logicalH/2);
    ctx.stroke();
    ctx.restore();
  }
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
