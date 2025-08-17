/**
 * MatrixBackground
 * Reusable animated "matrix rain" canvas background for menu UIs.
 * Manages its own canvas element (id: matrix-canvas) and ref-counted start/stop.
 */
export class MatrixBackground {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private drops: number[] = [];
  private speeds: number[] = [];
  private fontSize = 16; // Larger glyphs
  private animationFrame: number | null = null;
  private activeConsumers = 0; // simple ref count so multiple panels can request it
  private chars = '01アカサタナハマヤラワ░▒▓█#/\\<>+-'.split('');
  private palette = ['#00806a', '#007a7a', '#501c60']; // Muted core palette
  private highlightColors = ['#b3f5e6', '#d8d8f5']; // Softer highlights
  private lastGlitchTime = 0;
  private glitchInterval = 650; // ms between structured glitch bursts
  private frame = 0;

  constructor() {
    const existing = document.getElementById('matrix-canvas') as HTMLCanvasElement | null;
    this.canvas = existing || document.createElement('canvas');
    if (!existing) {
      this.canvas.id = 'matrix-canvas';
      this.canvas.style.position = 'fixed';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.canvas.style.pointerEvents = 'none';
  this.canvas.style.zIndex = '1600'; // Above menus (<=1500) so effect is visible
  this.canvas.style.opacity = '0.07';
  this.canvas.style.mixBlendMode = 'screen';
      document.body.appendChild(this.canvas);
    }
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    const columns = this.canvas.width / this.fontSize;
    const colCount = Math.floor(columns);
    this.drops = Array(colCount).fill(1);
    this.speeds = Array(colCount);
    for (let i = 0; i < colCount; i++) {
      // Slower baseline speeds (0.4–1.0 rows per frame)
      this.speeds[i] = 0.4 + Math.random() * 0.6;
    }
  }

  private draw = () => {
    if (!this.ctx) return;
    this.frame++;
    // Heavier trail alpha creates smoother motion at slower speed
    this.ctx.fillStyle = 'rgba(0,0,0,0.08)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.font = `${this.fontSize}px "Source Code Pro", monospace`;

    const now = performance.now();
    const doStructuredGlitch = now - this.lastGlitchTime > this.glitchInterval;
    if (doStructuredGlitch) {
      this.lastGlitchTime = now;
    }

    for (let i = 0; i < this.drops.length; i++) {
      const y = this.drops[i] * this.fontSize;
      // Random palette with bias: majority normal palette, occasional highlight
      let color: string;
  if (Math.random() < 0.01) { // fewer bright highlights
        color = this.highlightColors[Math.floor(Math.random() * this.highlightColors.length)];
      } else {
        color = this.palette[(i + (this.frame % this.palette.length) + (Math.random() * this.palette.length)|0) % this.palette.length];
      }
      this.ctx.fillStyle = color;
      const text = this.chars[Math.floor(Math.random() * this.chars.length)];

      // Slight horizontal jitter for glitch vibe
      let x = i * this.fontSize;
      if (Math.random() < 0.03) x += (Math.random() - 0.5) * 4;

      this.ctx.fillText(text, x, y);

      // Structured glitch burst: duplicate some columns with offset and additive color
      if (doStructuredGlitch && Math.random() < 0.05) { // fewer glitch bursts
        this.ctx.globalAlpha = 0.25;
        this.ctx.fillStyle = this.highlightColors[Math.floor(Math.random() * this.highlightColors.length)];
        this.ctx.fillText(text, x + (Math.random() * 6 - 3), y + (Math.random() * 6 - 3));
        this.ctx.globalAlpha = 1;
      }

      // Sporadic micro flicker overlay
      if (Math.random() < 0.008) { // rarer flicker
        this.ctx.globalAlpha = 0.15;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText(text, x, y - this.fontSize);
        this.ctx.globalAlpha = 1;
      }

      // Reset logic with slightly higher probability for diversity
      if (y > this.canvas.height && Math.random() > 0.965) {
        this.drops[i] = 0;
        // Occasionally change speed on reset
        this.speeds[i] = 0.4 + Math.random() * 0.6;
      }
      // Advance using per-column speed
      this.drops[i] += this.speeds[i];
    }
    if (this.activeConsumers > 0) {
      this.animationFrame = requestAnimationFrame(this.draw);
    } else {
      this.animationFrame = null;
    }
  };

  /** Request background animation (increments active user count) */
  public start() {
    this.activeConsumers++;
    if (this.activeConsumers === 1 && !this.animationFrame) {
      this.draw();
    }
  }

  /** Release a usage of the background (stops when count reaches zero) */
  public stop() {
    if (this.activeConsumers > 0) this.activeConsumers--;
    if (this.activeConsumers === 0 && this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
      if (this.ctx) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}

// Shared singleton
export const matrixBackground = new MatrixBackground();
