export class Cinematic {
  /**
   * Draws the skip button at the bottom left and handles click detection.
   * @param ctx CanvasRenderingContext2D
   * @param canvas HTMLCanvasElement
   */
  private drawSkipButton(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, logicalH: number) {
    const locked = !!(window as any).__cinSkipLocked;
    // Adaptive sizing for very small heights
    const small = logicalH < 480;
    const btnWidth = small ? 100 : 120;
    const btnHeight = small ? 36 : 44;
    const x = 24; // slightly tighter margin for tiny screens
    const bottomPad = small ? 16 : 32;
    const y = Math.max(8, logicalH - btnHeight - bottomPad);
    ctx.save();
    ctx.globalAlpha = locked ? 0.65 : 0.85;
    ctx.fillStyle = locked ? '#151a1c' : '#222';
    ctx.strokeStyle = locked ? 'rgba(120,160,170,0.8)' : '#0ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, btnWidth, btnHeight, 12);
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.fillStyle = locked ? '#9bb' : '#0ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = locked ? 'rgba(0,0,0,0)' : '#00f6ff';
    ctx.shadowBlur = locked ? 0 : 12;
    ctx.fillText(locked ? 'Loading…' : 'Skip', x + btnWidth / 2, y + btnHeight / 2);
    ctx.restore();
  }
  private progress: number = 0;
  public active: boolean = false;
  private onComplete: (() => void) | null = null;
  private duration: number = 900; // 15 seconds at 60fps
  // Cached skip button rect (logical space) for reliable hit detection
  private skipRect = { x:32, y:0, w:120, h:44 };
  private mode: 'SHOWDOWN' | 'DUNGEON' | 'LAST_STAND' = 'SHOWDOWN';
  private scripts: Record<'SHOWDOWN' | 'DUNGEON' | 'LAST_STAND', Array<{ title: string; subtitle: string | null }>> = {
    SHOWDOWN: [
      { title: 'SHOWDOWN PROTOCOL', subtitle: 'Open-sector engagement initiated.' },
      { title: 'NO WALLS • NO SANCTUARY', subtitle: 'An endless neon expanse. Hostiles can vector from any bearing.' },
      { title: 'ADAPTIVE SWARM INBOUND', subtitle: 'Every second online amplifies the AI response matrix.' },
      { title: 'LAST OPERATIVE ONLINE', subtitle: 'Hold the field. Rewrite the kill statistics.' }
    ],
    DUNGEON: [
      { title: 'DUNGEON BREACH', subtitle: 'Subterranean node cluster detected beneath the megacity.' },
      { title: 'SEGMENTED HALL NETWORK', subtitle: 'Procedural rooms. Choke points. Ambush geometry favored.' },
      { title: 'ENEMY FABRICATORS ACTIVE', subtitle: 'Clear sectors, push deeper. Data shards fund survival.' },
      { title: 'OVERRIDE THE CORE', subtitle: 'Advance. Isolate. Erase rogue sub-AIs.' }
    ],
    LAST_STAND: [
      { title: 'LAST STAND INITIATED', subtitle: 'A defense Core anchors the corridor. Keep it online.' },
      { title: 'RIGHT-FLANK THREAT VECTOR', subtitle: 'Waves will drive from the east. Shape the kill lane.' },
      { title: 'FORTIFY THE LINE', subtitle: 'Place turrets on neon pads. Buy palisades to hold the choke.' },
      { title: 'SURVIVE THE ONSLAUGHT', subtitle: 'Shops open between waves. Spend scrap to escalate.' }
    ]
  };

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

  /** Start cinematic; supports legacy (onComplete) or (mode, onComplete) signatures. */
  public start(modeOrCb: any, maybeCb?: () => void) {
    this.progress = 0;
    this.active = true;
    if (typeof modeOrCb === 'string') {
      this.mode = (modeOrCb === 'DUNGEON' ? 'DUNGEON' : modeOrCb === 'LAST_STAND' ? 'LAST_STAND' : 'SHOWDOWN');
      this.onComplete = maybeCb || null;
    } else {
      // legacy signature
      this.onComplete = modeOrCb || null;
      this.mode = 'SHOWDOWN';
    }
    // Attach temporary key listener for ESC skip
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.active) {
        if ((window as any).__cinSkipLocked) { e.preventDefault(); return; }
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
      // Subtle, restrained styling (no neon rainbow gradient)
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,20,24,0.85)';
      ctx.shadowColor = 'rgba(0,255,255,0.28)';
      ctx.shadowBlur = Math.max(2, titleBase * 0.18); // much lower glow
      ctx.lineWidth = Math.max(1, Math.round(titleBase * 0.035));
      // Use near‑solid fill with very slight vertical luminance shift
      const grad = ctx.createLinearGradient(0, blockTop - titleBase, 0, blockTop + titleBase * m.titleLines.length);
      const baseA = gradStops[0] || '#7ce9ff';
      const baseB = gradStops[1] || baseA;
      // Blend second stop toward first to kill rainbow effect
      grad.addColorStop(0, baseA);
      grad.addColorStop(1, baseB);
      ctx.font = `900 ${titleBase}px Orbitron, sans-serif`;
      for (let i=0;i<m.titleLines.length;i++) {
        const y = blockTop + i * m.tLH + titleBase * 0.70; // reduced baseline offset for true visual centering
        const line = m.titleLines[i];
        ctx.strokeText(line, logicalW/2, y);
        ctx.fillStyle = grad;
        ctx.fillText(line, logicalW/2, y);
      }
      if (m.subtitleLines.length) {
        ctx.shadowBlur = Math.max(1, subBase * 0.12);
        ctx.shadowColor = 'rgba(0,255,255,0.18)';
        ctx.fillStyle = '#c8f8ff'; // softer cyan-white
        ctx.font = `600 ${subBase}px Orbitron, sans-serif`;
  const subStart = blockTop + m.titleLines.length * m.tLH + m.gap + subBase * 0.65; // reduced baseline offset
        for (let i=0;i<m.subtitleLines.length;i++) {
          const y = subStart + i * m.sLH;
          ctx.fillText(m.subtitleLines[i], logicalW/2, y);
        }
      }
      ctx.restore();
    };
  // Pass muted monochromatic pairs to keep API stable while producing restrained visuals
  const script = this.scripts[this.mode];
  const segLen = Math.max(1, Math.floor(this.duration / script.length));
  const segIndex = Math.min(script.length - 1, Math.floor(t / segLen));
  const seg = script[segIndex];
  drawBlock(seg.title, seg.subtitle, ['#8cefff','#7dd2e6'], '#00f6ff');
  // Skip button drawn in adjusted logical coordinate space
  this.drawSkipButton(ctx, canvas, logicalH);
  // If locked, draw a tiny spinner next to the button to indicate background loading
  if ((window as any).__cinSkipLocked) {
    ctx.save();
    const small = logicalH < 480;
    const btnH = small ? 36 : 44;
    const bottomPad = small ? 16 : 32;
    const y = Math.max(8, logicalH - btnH - bottomPad);
    const x = (small ? 24 : 32) + (small ? 100 : 120) + 12;
    const r = 8;
    ctx.lineWidth = 3; ctx.strokeStyle = '#7bd';
    ctx.beginPath(); ctx.arc(x, y + btnH/2, r, Math.PI*0.25, Math.PI*1.75); ctx.stroke();
    ctx.restore();
  }
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
  if ((window as any).__cinSkipLocked) return false;
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
