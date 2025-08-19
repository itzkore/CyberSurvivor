// Lightweight FPS counter overlay. Attach via GameLoop.setFrameHook.
// Follows project conventions: no console spam, minimal allocations.

export class FPSCounter {
  private container: HTMLDivElement;
  private frameCount = 0;
  private lastSampleTime = performance.now();
  private fps = 0;
  private minFps = Infinity;
  private maxFps = 0;
  private lastUpdateDom = 0;
  private readonly updateIntervalMs = 500; // DOM update cadence
  // Jitter tracking
  private deltas: number[] = new Array(240);
  private deltaIndex = 0;
  private deltaFilled = false;
  private lastFrameTs = performance.now();
  private p95 = 0; // 95th percentile frame time
  private droppedFrames = 0; // count frames whose delta exceeds 2x target ( >33ms )
  private hitchEvents = 0; // count severe hitches >100ms

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'fps-overlay';
    this.container.style.cssText = [
      'position:fixed',
      'top:4px',
      'left:4px',
      'padding:4px 6px',
      'background:rgba(0,0,0,0.45)',
      'font:12px/14px monospace',
      'color:#0ff',
      'z-index:9999',
      'border:1px solid #044',
      'border-radius:4px',
      'pointer-events:none',
      'user-select:none'
    ].join(';');
    this.container.textContent = 'FPS…';
    document.body.appendChild(this.container);
  }

  public frame(deltaMs: number) {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastSampleTime;
    // Jitter capture (raw delta between hooks, not smoothed)
  const rawDelta = now - this.lastFrameTs;
    this.lastFrameTs = now;
  // Detect dropped / hitch frames (presentation pacing issues)
  if (rawDelta > 33) this.droppedFrames++;
  if (rawDelta > 100) this.hitchEvents++;
    this.deltas[this.deltaIndex++] = rawDelta;
    if (this.deltaIndex >= this.deltas.length) { this.deltaIndex = 0; this.deltaFilled = true; }
    if (elapsed >= 1000) {
      this.fps = (this.frameCount * 1000) / elapsed;
      if (this.fps < this.minFps) this.minFps = this.fps;
      if (this.fps > this.maxFps) this.maxFps = this.fps;
      this.frameCount = 0;
      this.lastSampleTime = now;
    }
    // Throttle DOM writes
    if (now - this.lastUpdateDom >= this.updateIntervalMs) {
      // Compute p95 jitter when buffer has enough samples
      const count = this.deltaFilled ? this.deltas.length : this.deltaIndex;
      if (count > 10) {
        // Approximate p95 without full sort to cut per-update cost (reduces GC & jitter):
        // Use a coarse bucket histogram (0-200ms) with 2ms resolution.
        const buckets = new Array(101).fill(0);
        for (let i=0;i<count;i++) {
          let v = this.deltas[i];
          if (v > 200) v = 200;
          const bi = (v / 2) | 0; // 0..100
          buckets[bi]++;
        }
        const targetRank = Math.floor(count * 0.95);
        let cumulative = 0;
        let bucketMs = 0;
        for (let b=0;b<buckets.length;b++) {
          cumulative += buckets[b];
          if (cumulative >= targetRank) { bucketMs = b * 2; break; }
        }
        this.p95 = bucketMs;
        (window as any).__frameJitterP95 = this.p95;
      }
      // Round values without extra allocations
      const f = Math.round(this.fps);
      const min = isFinite(this.minFps) ? Math.round(this.minFps) : 0;
      const max = Math.round(this.maxFps);
      const jit = this.p95.toFixed(1);
  this.container.textContent = `FPS ${f} (min ${min} / max ${max})\nJit p95 ${jit}ms  drop ${this.droppedFrames} hitch ${this.hitchEvents}`;
      // Simple color shift based on FPS bucket
      let hue = 140; // greenish
      if (f < 50) hue = 60; // yellow
      if (f < 40) hue = 25; // orange
      if (f < 30) hue = 0;  // red
      this.container.style.color = `hsl(${hue} 100% 65%)`;
      this.lastUpdateDom = now;
    }
  }

  public destroy() {
    this.container.remove();
  }
}
