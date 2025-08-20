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
  public needsPatternRedraw = true; // made public for prototype helpers
  public lowFX = false; // accessed by ambient drawer
  // --- Ambient Particles (biome accent glyphs) ---
  public ambientParticles: AmbientParticle[] = [];
  public ambientPoolSize = 64; // fixed pool (reuse objects)
  public ambientInited = false;
  // --- Day/Night Cycle ---
  private dayLengthSec = 180; // full cycle length (3 min)
  public dayFactor = 1; // 0.55 (night) .. 1 (midday)
  private lastPhaseBucket = -1; // for potential future events

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
  // Update biome switching / blending
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
  // Day/Night factor (sinusoidal). 0 at start = sunrise.
  const tDay = (gameTimeSec % this.dayLengthSec) / this.dayLengthSec; // 0..1
  // Map sin wave (-1..1) -> brightness 0.55..1
  this.dayFactor = 0.55 + (Math.sin(tDay * Math.PI * 2 - Math.PI/2) * 0.5 + 0.5) * (1 - 0.55);
  // Bucket for phase changes (8 slices) - reserved for events (not dispatched now)
  this.lastPhaseBucket = Math.floor(tDay * 8);
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
    // Initialize ambient particles lazily (after first draw when we have cam & viewport)
    if (!this.ambientInited) {
      this.initAmbient(camX, camY, canvasW, canvasH);
      this.ambientInited = true;
    }
    // Update + draw ambient particles (before night overlay so they dim consistently)
    this.updateAmbient(camX, camY, canvasW, canvasH);
    this.drawAmbient(ctx, camX, camY, canvasW, canvasH);
    // Night overlay (multiply darkness based on inverse dayFactor)
    const darkness = 1 - this.dayFactor; // 0 (day) -> ~0.45 (night)
    if (darkness > 0.02) {
      ctx.fillStyle = `rgba(0,10,16,${(darkness*0.55).toFixed(3)})`;
      ctx.fillRect(0,0,canvasW,canvasH);
      if (!this.lowFX) {
        // Subtle city light bloom at night
        ctx.globalCompositeOperation = 'overlay';
        const glow = ctx.createRadialGradient(canvasW*0.55, canvasH*0.42, 30, canvasW*0.55, canvasH*0.42, canvasH*0.85);
        glow.addColorStop(0, `rgba(38,255,233,${0.12*darkness})`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0,0,canvasW,canvasH);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
  }
}

// ---- Ambient Particle Implementation ----
interface AmbientParticle {
  x: number; y: number; vx: number; vy: number; size: number; alpha: number; life: number; t: number; color: string;
}

// Extend prototype with particle helpers
export interface EnvironmentManager {
  initAmbient(camX: number, camY: number, vw: number, vh: number): void;
  updateAmbient(camX: number, camY: number, vw: number, vh: number): void;
  drawAmbient(ctx: CanvasRenderingContext2D, camX: number, camY: number, vw: number, vh: number): void;
}

EnvironmentManager.prototype.initAmbient = function(camX: number, camY: number, vw: number, vh: number) {
  this.ambientParticles.length = 0;
  const [a,b] = (this as any).getBiomePair();
  const accents = b.accentDots || a.accentDots || ['#26ffe9'];
  for (let i=0;i<this.ambientPoolSize;i++) {
    this.ambientParticles.push({
      x: camX + Math.random()*vw,
      y: camY + Math.random()*vh,
      vx: (Math.random()*0.12 - 0.06),
      vy: (Math.random()*0.12 - 0.06),
      size: 1 + Math.random()*2,
      alpha: 0.15 + Math.random()*0.35,
      life: 4 + Math.random()*16,
      t: Math.random()*1000,
      color: accents[i % accents.length]
    });
  }
};

EnvironmentManager.prototype.updateAmbient = function(camX: number, camY: number, vw: number, vh: number) {
  const [a,b] = (this as any).getBiomePair();
  const accents = b.accentDots || a.accentDots || ['#26ffe9'];
  const wrapMargin = 40;
  for (let i=0;i<this.ambientParticles.length;i++) {
    const p = this.ambientParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.t += 0.01;
    // gentle drift change
    if ((i + (p.t|0)) % 240 === 0) {
      p.vx += (Math.random()*0.06 - 0.03);
      p.vy += (Math.random()*0.06 - 0.03);
      // clamp
      if (p.vx > 0.12) p.vx = 0.12; if (p.vx < -0.12) p.vx = -0.12;
      if (p.vy > 0.12) p.vy = 0.12; if (p.vy < -0.12) p.vy = -0.12;
    }
    // wrap around camera view bounds with margin
    const minX = camX - wrapMargin; const maxX = camX + vw + wrapMargin;
    const minY = camY - wrapMargin; const maxY = camY + vh + wrapMargin;
    if (p.x < minX) p.x = maxX; else if (p.x > maxX) p.x = minX;
    if (p.y < minY) p.y = maxY; else if (p.y > maxY) p.y = minY;
    // If biome changed (pattern flagged) occasionally retint
    if (this.needsPatternRedraw && (i % 7 === 0)) {
      p.color = accents[(Math.random()*accents.length)|0];
    }
  }
};

EnvironmentManager.prototype.drawAmbient = function(ctx: CanvasRenderingContext2D, camX: number, camY: number, vw: number, vh: number) {
  if (!this.ambientParticles.length) return;
  ctx.save();
  // brightness mod by dayFactor (fewer visible at bright midday)
  const globalFade = 0.6 + (1 - this.dayFactor) * 0.8; // night boosts visibility
  ctx.globalAlpha = 1;
  for (let i=0;i<this.ambientParticles.length;i++) {
    const p = this.ambientParticles[i];
    const sx = p.x - camX;
    const sy = p.y - camY;
    if (sx < -10 || sy < -10 || sx > vw+10 || sy > vh+10) continue;
    const pulse = (Math.sin((p.t + i*0.37) * 2) * 0.5 + 0.5);
    const a = p.alpha * globalFade * (0.55 + pulse*0.45);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = a;
    ctx.fillRect(Math.round(sx), Math.round(sy), p.size, p.size);
    if (!this.lowFX && p.size > 1 && a > 0.2) {
      ctx.globalAlpha = a * 0.35;
      ctx.fillRect(Math.round(sx)-1, Math.round(sy)-1, p.size+2, p.size+2);
    }
  }
  ctx.restore();
};
