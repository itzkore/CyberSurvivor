// EnvironmentManager: handles biome palette, background rendering & ambient cycle
// Keeps rendering lightweight by caching pattern tiles per biome and reusing gradients.
import { Logger } from '../core/Logger';

interface Biome {
  name: string;
  gradient: { top: string; mid: string; bottom: string };
  gridColor: string; // rgba/hex with alpha for grid lines
  noiseColor: string;
  accentDots?: string[]; // optional multi-color sparse dots
}

const BIOMES: Biome[] = [
  {
    name: 'Neon Plains',
    gradient: { top: '#041c20', mid: '#092b33', bottom: '#0d3b44' },
    gridColor: '#1e3f4455',
    noiseColor: '#235e68',
    accentDots: ['#26ffe9', '#00b3a3']
  },
  {
    name: 'Data Wastes',
    gradient: { top: '#0a0a1a', mid: '#181825', bottom: '#232347' },
    gridColor: '#2a2f4d55',
    noiseColor: '#2d3558',
    accentDots: ['#26ffe9', '#00b3ff']
  }
];

export class EnvironmentManager {
  private patternCanvas: HTMLCanvasElement;
  private patternCtx: CanvasRenderingContext2D;
  private patternSize = 512;
  private gridSize = 160;
  private currentBiomeIndex = 0;
  private nextBiomeIndex = 1;
  private biomeBlend = 1; // 0..1 while transitioning
  private lastBiomeSwitch = 0;
  private biomeDurationMs = 120_000; // 2 minutes per biome
  private transitionMs = 9000; // 9s transition
  private gradientCache?: CanvasGradient;
  private gradientBiomeKey = '';
  private needsPatternRedraw = true;
  private lowFX = false;

  constructor() {
    this.patternCanvas = document.createElement('canvas');
    this.patternCtx = this.patternCanvas.getContext('2d')!;
    this.patternCanvas.width = this.patternSize;
    this.patternCanvas.height = this.patternSize;
  }

  public setLowFX(low: boolean) { if (this.lowFX !== low) { this.lowFX = low; this.needsPatternRedraw = true; } }

  private getBiomePair(): [Biome, Biome] {
    const a = BIOMES[this.currentBiomeIndex];
    const b = BIOMES[this.nextBiomeIndex];
    return [a, b];
  }

  public update(gameTimeSec: number) {
    const nowMs = gameTimeSec * 1000;
    if (nowMs - this.lastBiomeSwitch >= this.biomeDurationMs) {
      this.lastBiomeSwitch = nowMs;
      this.currentBiomeIndex = this.nextBiomeIndex;
      this.nextBiomeIndex = (this.nextBiomeIndex + 1) % BIOMES.length;
      this.biomeBlend = 0;
      this.needsPatternRedraw = true; // new biome base
      this.gradientCache = undefined;
      Logger.info('[Environment] Switching biome to ' + BIOMES[this.currentBiomeIndex].name);
    }
    // Handle transition blend at start of each biome period
    const sinceSwitch = nowMs - this.lastBiomeSwitch;
    if (sinceSwitch < this.transitionMs) {
      this.biomeBlend = sinceSwitch / this.transitionMs;
      this.gradientCache = undefined; // gradient shifts during blend
    } else {
      this.biomeBlend = 1;
    }
  }

  private lerpColor(c1: string, c2: string, t: number): string {
    // Accept #rrggbb
    const hex = (c: string) => c.replace('#','');
    const h1 = hex(c1); const h2 = hex(c2);
    const r = Math.round(parseInt(h1.slice(0,2),16) * (1-t) + parseInt(h2.slice(0,2),16) * t);
    const g = Math.round(parseInt(h1.slice(2,4),16) * (1-t) + parseInt(h2.slice(2,4),16) * t);
    const b = Math.round(parseInt(h1.slice(4,6),16) * (1-t) + parseInt(h2.slice(4,6),16) * t);
    return `rgb(${r},${g},${b})`;
  }

  private ensurePattern() {
    if (!this.needsPatternRedraw) return;
    const ctx = this.patternCtx;
    const size = this.patternSize;
    ctx.clearRect(0,0,size,size);
    const [a, b] = this.getBiomePair();
    const t = this.biomeBlend;
    // Use target biome for grid after transition else current
    const gridColor = t < 1 ? a.gridColor : b.gridColor;
    ctx.lineWidth = 1;
    ctx.strokeStyle = gridColor;
    const g = this.gridSize;
    for (let x=0; x<=size; x+=g) { ctx.beginPath(); ctx.moveTo(x+0.5,0); ctx.lineTo(x+0.5,size); ctx.stroke(); }
    for (let y=0; y<=size; y+=g) { ctx.beginPath(); ctx.moveTo(0,y+0.5); ctx.lineTo(size,y+0.5); ctx.stroke(); }
    // Sparse noise dots
    const noiseCount = this.lowFX ? 70 : 140;
    const noiseColor = t < 1 ? a.noiseColor : b.noiseColor;
    for (let i=0;i<noiseCount;i++) {
      const seed = (i * 48271) & 0x7fffffff;
      const rx = (seed % 1000) / 1000;
      const ry = ((seed / 1000) % 1000) / 1000;
      const px = rx * size;
      const py = ry * size;
      if ((px % g) < 3 || (py % g) < 3) continue;
      ctx.fillStyle = noiseColor;
      ctx.fillRect(px, py, 2, 2);
      if (!this.lowFX && (i % 35 === 0)) {
        const accents = (t < 1 ? a.accentDots : b.accentDots) || [];
        if (accents.length) {
          ctx.fillStyle = accents[i % accents.length] + '33';
          ctx.fillRect(px, py, 2, 2);
        }
      }
    }
    this.needsPatternRedraw = false;
  }

  private ensureGradient(ctx: CanvasRenderingContext2D, canvasHeight: number) {
    const [a, b] = this.getBiomePair();
    const t = this.biomeBlend;
    const key = a.name + '|' + b.name + '|' + t.toFixed(3) + '|' + canvasHeight;
    if (this.gradientBiomeKey === key && this.gradientCache) return;
    // Blend top/mid/bottom colors
    const top = this.lerpColor(a.gradient.top, b.gradient.top, t);
    const mid = this.lerpColor(a.gradient.mid, b.gradient.mid, t);
    const bottom = this.lerpColor(a.gradient.bottom, b.gradient.bottom, t);
    const g = ctx.createLinearGradient(0, 0, 0, canvasHeight);
    g.addColorStop(0, top);
    g.addColorStop(0.5, mid);
    g.addColorStop(1, bottom);
    this.gradientCache = g;
    this.gradientBiomeKey = key;
  }

  public draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, canvasW: number, canvasH: number) {
    this.ensureGradient(ctx, canvasH);
    ctx.save();
    ctx.fillStyle = this.gradientCache!;
    ctx.fillRect(0,0,canvasW,canvasH);
    this.ensurePattern();
    if (this.patternCanvas) {
      const size = this.patternSize;
      const offX = - (camX % size);
      const offY = - (camY % size);
      for (let x = offX; x < canvasW; x += size) {
        for (let y = offY; y < canvasH; y += size) {
          ctx.drawImage(this.patternCanvas, x, y);
        }
      }
    }
    if (!this.lowFX) {
      const t = (performance.now()/4000)%1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.04 + Math.sin(t * Math.PI*2) * 0.015;
      const rg = ctx.createRadialGradient(canvasW*0.6, canvasH*0.4, 40, canvasW*0.6, canvasH*0.4, canvasH*0.9);
      rg.addColorStop(0, 'rgba(38,255,233,0.12)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0,0,canvasW,canvasH);
    }
    ctx.restore();
  }
}
