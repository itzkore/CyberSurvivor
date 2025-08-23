/**
 * VideoOverlay draws an HTMLVideoElement onto a canvas with compositing.
 * Designed for full-screen effects like Umbral Surge without per-pixel work.
 *
 * - Uses 'screen' composite so black background acts transparent (black key).
 * - Includes fade-in/out envelope and duration control.
 * - Avoids DOM overlays; video element stays off-DOM and is drawn to canvas.
 */
import { Logger } from '../core/Logger';
export class VideoOverlay {
  private video: HTMLVideoElement;
  private sources: string[] = [];
  private srcIndex = 0;
  private active = false;
  private startTime = 0;
  private durationMs = 0;
  private fadeInMs = 140;
  private fadeOutMs = 220;
  private loop = false;
  // Offscreen buffer to allow color tinting without affecting the entire scene
  private bufferCanvas?: HTMLCanvasElement;
  private bufferCtx?: CanvasRenderingContext2D | null;
  private bufferW: number = 0;
  private bufferH: number = 0;

  constructor(src: string | string[]) {
    const v = document.createElement('video');
    this.sources = Array.isArray(src) ? src.slice() : [src];
    v.src = this.sources[0] || '';
    v.muted = true; // autoplay safe
    (v as any).playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    v.loop = false;
    // Keep off-DOM; we'll draw frames onto canvas directly
    this.video = v;
    // Ensure we can restart quickly after end
    this.video.addEventListener('ended', () => {
      if (!this.loop) this.active = true; // remain active to allow fade-out envelope to complete
    });
    // If a source fails, try the next candidate path automatically
    this.video.addEventListener('error', () => {
      const next = this.srcIndex + 1;
      if (next < this.sources.length) {
        this.srcIndex = next;
        const s = this.sources[this.srcIndex];
        try { this.video.pause(); } catch {}
        try { this.video.src = s; this.video.load(); } catch {}
        Logger.warn('[VideoOverlay] Source failed, trying alternate: ' + s);
      }
    });
  }

  /** Begin playback for a fixed duration with optional loop and custom fades. */
  public async play(durationMs: number, opts?: { loop?: boolean; fadeInMs?: number; fadeOutMs?: number }) {
    this.durationMs = Math.max(0, durationMs | 0);
    this.loop = !!opts?.loop;
    if (opts?.fadeInMs != null) this.fadeInMs = Math.max(0, opts.fadeInMs);
    if (opts?.fadeOutMs != null) this.fadeOutMs = Math.max(0, opts.fadeOutMs);
    // Ensure a valid source and metadata are ready before play
    await this.ensureSourceReady();
    try { this.video.currentTime = 0; } catch { /* ignore */ }
    this.video.loop = this.loop;
    this.startTime = performance.now();
    this.active = true;
    try { await this.video.play(); } catch { /* autoplay may fail; keep active and draw first frame when allowed */ }
  }

  /** Trigger fade-out and stop when envelope reaches zero. */
  public stop() {
    // Let draw handle envelope to zero; pause once fully faded
    this.durationMs = Math.min(this.durationMs, Math.max(0, performance.now() - this.startTime) + this.fadeOutMs);
  }

  public isActive(): boolean { return this.active; }

  /** Draw current frame scaled to cover the given logical width/height using the provided ctx. */
  public draw(ctx: CanvasRenderingContext2D, logicalW: number, logicalH: number, composite: GlobalCompositeOperation = 'screen', baseAlpha: number = 1.0) {
    if (!this.active) return;
    const now = performance.now();
    const elapsed = now - this.startTime;
    if (this.durationMs <= 0) { this.active = false; return; }

    // Envelope: ease-in/out
    const tIn = Math.max(0, Math.min(1, this.fadeInMs > 0 ? elapsed / this.fadeInMs : 1));
    const tOutRaw = (this.durationMs - elapsed) / (this.fadeOutMs || 1);
    const tOut = Math.max(0, Math.min(1, this.fadeOutMs > 0 ? tOutRaw : 1));
    const easeIn = tIn * tIn; // quad ease-in
    const easeOut = tOut * (2 - tOut); // quad ease-out
    const env = Math.max(0, Math.min(1, Math.min(easeIn, easeOut)));
    let alpha = Math.max(0, Math.min(1, baseAlpha * env));
    // Tail softening: reduce opacity more aggressively in the last ~40% of the duration
    // smoothstep helper
    const smoothstep = (edge0: number, edge1: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, (edge1 - edge0))));
      return t * t * (3 - 2 * t);
    };
    const frac = Math.max(0, Math.min(1, this.durationMs > 0 ? (elapsed / this.durationMs) : 0));
    const tailT = smoothstep(0.6, 0.98, frac); // starts easing after 60% of playback
    const tailScale = 1 - tailT * 0.55; // up to ~55% opacity reduction by the end
    alpha *= tailScale;

    // If fully faded, stop and pause video to save cycles
    if (alpha <= 0.001) {
      this.active = false;
      try { this.video.pause(); } catch { /* ignore */ }
      return;
    }

    // Only draw when we have dimensions
    const vw = this.video.videoWidth || 0;
    const vh = this.video.videoHeight || 0;
    if (vw <= 0 || vh <= 0) return; // metadata not ready yet

    // Compute cover fit (preserve aspect, fill entire area)
    const scale = Math.max(logicalW / vw, logicalH / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const dx = (logicalW - dw) * 0.5;
    const dy = (logicalH - dh) * 0.5;

    // Composite with black-as-transparent behavior.
    // Prefer 'screen'. If not supported, fall back to additive blending ('plus-lighter' or 'lighter')
    ctx.save();
    let op: GlobalCompositeOperation = composite;
    ctx.globalCompositeOperation = op;
    if (ctx.globalCompositeOperation !== op) {
      // Try plus-lighter
      op = 'plus-lighter' as GlobalCompositeOperation;
      ctx.globalCompositeOperation = op;
      if (ctx.globalCompositeOperation !== op) {
        // Fallback to widely-supported 'lighter'
        op = 'lighter' as GlobalCompositeOperation;
        ctx.globalCompositeOperation = op;
      }
    }
    ctx.globalAlpha = alpha;

    // Prepare offscreen buffer sized to drawn dimensions to allow local tinting
    const bw = Math.max(1, Math.ceil(dw));
    const bh = Math.max(1, Math.ceil(dh));
    if (!this.bufferCanvas) {
      this.bufferCanvas = document.createElement('canvas');
      this.bufferCtx = this.bufferCanvas.getContext('2d');
      this.bufferW = 0; this.bufferH = 0;
    }
    if (this.bufferW !== bw || this.bufferH !== bh) {
      this.bufferW = bw; this.bufferH = bh;
      this.bufferCanvas!.width = bw; this.bufferCanvas!.height = bh;
    }
    const bctx = this.bufferCtx!;
    if (!bctx) { ctx.restore(); return; }
    // Clear previous content
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, bw, bh);

    // Build filter string depending on blend op
  const isAdditive = (op === 'lighter' || (op as any) === 'plus-lighter');
  const baseFilter = isAdditive ? 'contrast(1.18) saturate(1.08)' : 'contrast(1.22) brightness(1.03) saturate(1.08)';
  // Avoid hue rotation to prevent unintended green shifts; keep native video hues
  const filterStr = baseFilter;
    const prevBFilter = bctx.filter;
    try { bctx.filter = filterStr; } catch {}
    bctx.drawImage(this.video, 0, 0, bw, bh);
    // Reset filter
    try { bctx.filter = prevBFilter; } catch {}

    // Apply a mild dark-purple tint using multiply, isolated to the buffer
  bctx.globalCompositeOperation = 'multiply';
  bctx.globalAlpha = 0.28; // stronger purple tint
  bctx.fillStyle = '#5a1f83'; // dark purple (magenta-leaning) to overcome blue bias
    bctx.fillRect(0, 0, bw, bh);
    // Restore defaults for future draws
    bctx.globalCompositeOperation = 'source-over';
    bctx.globalAlpha = 1;

    // Draw the tinted buffer onto the main canvas with desired composite and alpha
    ctx.drawImage(this.bufferCanvas!, dx, dy, dw, dh);
    ctx.restore();
  }

  /** Ensure the current source is set and metadata is available; try alternates on error. */
  private ensureSourceReady(): Promise<void> {
    // Quick path: already have metadata and dimensions
    if (this.video.readyState >= 1 && (this.video.videoWidth || 0) > 0) return Promise.resolve();
    if (this.srcIndex >= this.sources.length) this.srcIndex = 0;
    const tryIndex = (i: number): Promise<void> => {
      if (i >= this.sources.length) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const src = this.sources[i];
        if (!src) { resolve(); return; }
        let done = false;
        const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
        const onMeta = () => finish();
        const onCanPlay = () => finish();
        const onErr = () => {
          const next = i + 1;
          cleanup();
          if (next < this.sources.length) {
            this.srcIndex = next;
            const s = this.sources[next];
            Logger.warn('[VideoOverlay] Failed to load video source, switching to ' + s);
            try {
              this.video.pause();
              this.video.src = s;
              this.video.load();
            } catch {}
            // Try next source
            tryIndex(next).then(() => resolve());
          } else {
            resolve();
          }
        };
        const cleanup = () => {
          this.video.removeEventListener('loadedmetadata', onMeta);
          this.video.removeEventListener('canplay', onCanPlay);
          this.video.removeEventListener('error', onErr);
        };
        try {
          this.video.pause();
          this.video.src = src;
          this.video.load();
        } catch {}
        this.video.addEventListener('loadedmetadata', onMeta, { once: true });
        this.video.addEventListener('canplay', onCanPlay, { once: true });
        this.video.addEventListener('error', onErr, { once: true });
        // Poll for readiness as a safety net (up to ~3 seconds)
        let waited = 0;
        const interval = 100;
        const poll = () => {
          if (done) return;
          const rs = this.video.readyState;
          if ((rs >= 2 && (this.video.videoWidth || 0) > 0)) { finish(); return; }
          waited += interval;
          if (waited >= 3000) { finish(); return; }
          setTimeout(poll, interval);
        };
        setTimeout(poll, interval);
      });
    };
    return tryIndex(this.srcIndex);
  }
}
