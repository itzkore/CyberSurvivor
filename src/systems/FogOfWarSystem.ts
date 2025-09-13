/**
 * FogOfWarSystem – MVP tile-based FOW with explored memory.
 * - Maintains tile states: Hidden, Explored, Visible
 * - compute() marks a circular area around player as Visible and downgrades last Visible to Explored
 * - render() draws a dark mask on an offscreen canvas and punches radial holes for visible/explored tiles
 *
 * Performance notes:
 * - Uses sparse Map for tile states to avoid allocating full world grids
 * - Iterates only tiles intersecting the current viewport when rendering
 * - Reuses arrays and offscreen canvases to stay under ~0.5 ms/frame on target HW
 */
export enum FowTileState { Hidden = 0, Explored = 1, Visible = 2 }

export interface CameraLike { x: number; y: number; width: number; height: number }

export class FogOfWarSystem {
  /** World tile size in pixels. Larger tiles = fewer ops. */
  private tileSize = 128; // world pixels per tile
  private worldCols = Number.POSITIVE_INFINITY; // optional bounds (unused in sparse mode)
  private worldRows = Number.POSITIVE_INFINITY;
  // Sparse storage: key = `${tx},${ty}` -> state
  private states = new Map<string, FowTileState>();
  // Reused buffer of last-frame visible tiles to downgrade to Explored on next compute
  private lastVisible: number[] = []; // packed as [tx0,ty0, tx1,ty1, ...]
  // Last compute center (as world coords for fallback rendering)
  private lastCenterWorldX: number = 0;
  private lastCenterWorldY: number = 0;
  private lastRadiusTiles: number = 3;

  // Offscreen mask and pre-baked radial hole sprites
  /** Offscreen mask surface (falls back to HTMLCanvasElement if OffscreenCanvas not available). */
  private maskCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private maskCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private maskW = 0; private maskH = 0;
  private holeVisible: OffscreenCanvas | HTMLCanvasElement | null = null;
  private holeExplored: OffscreenCanvas | HTMLCanvasElement | null = null;
  private holeSizePx = 0; // diameter in pixels for hole sprites
  // Cached circular reveal sprite (alpha falloff) to avoid per-frame gradient creation.
  // We generate a medium-resolution texture and scale it to the requested radius at draw time.
  private circleSprite: OffscreenCanvas | HTMLCanvasElement | null = null;
  private circleSpriteBaseSize = 512; // px, tuned for balance of quality/perf
  // Pre-baked monochrome noise sprite for subtle edge dithering
  private noiseSprite: OffscreenCanvas | HTMLCanvasElement | null = null;
  private noiseSpriteSize = 128;

  /** Configure grid metadata. For sparse mode only tileSize is required. */
  public setGrid(cols: number | undefined, rows: number | undefined, tileSize: number) {
    this.tileSize = Math.max(8, Math.floor(tileSize));
    this.worldCols = (cols && cols > 0) ? cols : Number.POSITIVE_INFINITY;
    this.worldRows = (rows && rows > 0) ? rows : Number.POSITIVE_INFINITY;
  // Keep explored memory across world size changes; do not clear states.
  // Note: hole sprites are lazily created during render to support Node test env.
  }

  /** Returns a tile's current state (for tests/debug). */
  public getTileState(tx: number, ty: number): FowTileState {
    const k = `${tx},${ty}`;
    return this.states.get(k) ?? FowTileState.Hidden;
  }

  /**
   * Compute visibility around player tile.
   * @param ptx player tile X
   * @param pty player tile Y
   * @param radiusTiles integer radius in tiles
   */
  public compute(ptx: number, pty: number, radiusTiles: number) {
    // Downgrade previously visible tiles to Explored first
    for (let i = 0; i < this.lastVisible.length; i += 2) {
      const tx = this.lastVisible[i]; const ty = this.lastVisible[i + 1];
      const k = `${tx},${ty}`;
      const cur = this.states.get(k);
      if (cur === FowTileState.Visible) this.states.set(k, FowTileState.Explored);
    }
    this.lastVisible.length = 0;

    const r = Math.max(0, Math.floor(radiusTiles));
  this.lastRadiusTiles = r;
  this.lastCenterWorldX = (ptx + 0.5) * this.tileSize;
  this.lastCenterWorldY = (pty + 0.5) * this.tileSize;
    const r2 = r * r;
    const minX = ptx - r;
    const maxX = ptx + r;
    const minY = pty - r;
    const maxY = pty + r;
    for (let ty = minY; ty <= maxY; ty++) {
      // Optional bounds clamp (no-op for Infinity)
      if (ty < 0 || ty >= this.worldRows) continue;
      for (let tx = minX; tx <= maxX; tx++) {
        if (tx < 0 || tx >= this.worldCols) continue;
        const dx = tx - ptx;
        const dy = ty - pty;
        if (dx * dx + dy * dy <= r2) {
          const k = `${tx},${ty}`;
          this.states.set(k, FowTileState.Visible);
          this.lastVisible.push(tx, ty);
        }
      }
    }
  }

  /** Draws the fog mask over the world space (call before HUD/UI).
   * Note: Explored memory is cosmetic only and never clears visibility (prevents enemies from appearing outside the visible circle).
   */
  public render(
    ctx: CanvasRenderingContext2D,
    camera: CameraLike,
    opts?: {
      enable?: boolean;
      exploredAlpha?: number;
      darkAlpha?: number;
      /** Optional darkness fill color; use a very dark blue-gray to feel more natural than pure black. */
      darkColor?: string;
      visibleCenterX?: number; // world coords (player.x)
      visibleCenterY?: number; // world coords (player.y)
      visibleRadiusPx?: number; // override radius in pixels (fallback = lastRadiusTiles * tileSize)
  visibleRects?: Array<{ x:number; y:number; w:number; h:number }>; // extra clear rects in world coords
  /** Optional: clip the circular reveal to these rects (world coords). Useful to restrict visibility outside corridors. */
  circleClipRects?: Array<{ x:number; y:number; w:number; h:number }>;
      /** Enable subtle edge dithering to break up the reveal line (default true). */
      edgeNoise?: boolean;
      /** Strength of the edge noise (0..0.3 recommended). Default 0.06 */
      edgeNoiseStrength?: number;
      /** Fractional inner/outer radii for the soft edge band used by noise (relative to visibleRadius). */
      edgeNoiseBand?: { inner: number; outer: number };
      /** A soft penumbra outside the main reveal radius to eliminate any perceived hard line into darkness. */
      penumbraScale?: number; // default 1.30 (relative to visible radius)
      penumbraAlpha?: number; // default 0.08 (0..1), strength of soft lightening
    }
  ) {
    if (opts && opts.enable === false) return; // disabled
    // Ensure mask surface matches viewport logical size
    this.ensureMaskSurface(Math.ceil(camera.width), Math.ceil(camera.height));
    if (!this.maskCtx || !this.maskCanvas) return;

  const mctx = this.maskCtx as CanvasRenderingContext2D;
    // Fill darkness – use a tinted near-black to feel less artificial than pure #000
  const darkAlpha = Math.max(0.25, Math.min(1, (opts?.darkAlpha ?? 0.88)));
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = darkAlpha;
    mctx.fillStyle = opts?.darkColor || '#05080d';
    mctx.fillRect(0, 0, this.maskW, this.maskH);

  // 1) Continuous visible circle centered on player (smooth falloff)
  mctx.globalCompositeOperation = 'destination-out';
  mctx.globalAlpha = 1;
  let vcx = (opts?.visibleCenterX ?? this.lastCenterWorldX) - camera.x;
  let vcy = (opts?.visibleCenterY ?? this.lastCenterWorldY) - camera.y;
  let vR = Math.max(8, Math.floor(opts?.visibleRadiusPx ?? (this.lastRadiusTiles * this.tileSize)));
  // Guard against NaN/Infinity: fall back to viewport center and a safe radius
  if (!isFinite(vcx) || !isFinite(vcy)) { vcx = this.maskW * 0.5; vcy = this.maskH * 0.5; }
  if (!isFinite(vR) || vR <= 0) vR = Math.max(64, Math.floor(this.tileSize * Math.max(1, this.lastRadiusTiles)));
  // Ensure cached circle sprite exists (alpha falloff baked once)
  this.ensureCircleSprite();
  // Ensure noise sprite for edge dithering if needed
  const useNoise = (opts?.edgeNoise ?? true) === true;
  if (useNoise) this.ensureNoiseSprite();
  // If circleClipRects provided, constrain the circle reveal to their union
  const hasClipRects = !!(opts?.circleClipRects && opts.circleClipRects.length);
  if (hasClipRects) {
    mctx.save();
    mctx.beginPath();
    for (let i = 0; i < (opts!.circleClipRects as any).length; i++) {
      const r = (opts as any).circleClipRects[i]; if (!r) continue;
      const rx = r.x - camera.x;
      const ry = r.y - camera.y;
      mctx.rect(Math.round(rx), Math.round(ry), Math.round(r.w), Math.round(r.h));
    }
    mctx.clip();
    // Draw cached radial sprite scaled to requested radius
    const d = vR * 2;
    mctx.drawImage(this.circleSprite as any, Math.round(vcx - vR), Math.round(vcy - vR), Math.round(d), Math.round(d));
    mctx.restore();
  } else {
    const d = vR * 2;
    mctx.drawImage(this.circleSprite as any, Math.round(vcx - vR), Math.round(vcy - vR), Math.round(d), Math.round(d));
  }

  // 1a) Soft penumbra beyond the reveal edge – lightly lifts darkness in a wider circle
  {
    // Make the outside band darker by default: narrower and weaker penumbra lighten
    const penScale = Math.max(1.0, Math.min(2.5, opts?.penumbraScale ?? 1.18));
    const penAlpha = Math.max(0, Math.min(0.4, opts?.penumbraAlpha ?? 0.04));
    if (penAlpha > 0 && penScale > 1.0) {
      const r2 = Math.floor(vR * penScale);
      const d2 = r2 * 2;
      mctx.globalCompositeOperation = 'destination-out';
      mctx.globalAlpha = penAlpha;
      mctx.drawImage(this.circleSprite as any, Math.round(vcx - r2), Math.round(vcy - r2), Math.round(d2), Math.round(d2));
      mctx.globalAlpha = 1;
    }
  }

  // 1b) Additional clear rectangles (e.g., corridor road) in world coords
  if (opts?.visibleRects && opts.visibleRects.length) {
    mctx.globalCompositeOperation = 'destination-out';
    mctx.globalAlpha = 1;
    for (let i=0;i<opts.visibleRects.length;i++){
      const r = opts.visibleRects[i]; if (!r) continue;
      const rx = r.x - camera.x;
      const ry = r.y - camera.y;
      mctx.fillRect(Math.round(rx), Math.round(ry), Math.round(r.w), Math.round(r.h));
    }
  }

  // 1c) Subtle noise dithering on the reveal edge to break a perfect line
  if (useNoise && this.noiseSprite) {
    // Clip to an annulus band [inner, outer] of the visible circle
  // Constrain noise band to be mostly inside the visible radius so we don't lighten outside
  const band = opts?.edgeNoiseBand || { inner: 0.82, outer: 0.98 };
    const innerR = Math.max(8, Math.floor(vR * Math.max(0, Math.min(band.inner, 1.5))));
    const outerR = Math.max(innerR+1, Math.floor(vR * Math.max(0, Math.min(band.outer, 2.0))));
    mctx.save();
    mctx.beginPath();
    mctx.arc(Math.round(vcx), Math.round(vcy), outerR, 0, Math.PI * 2);
    mctx.arc(Math.round(vcx), Math.round(vcy), innerR, 0, Math.PI * 2, true);
    mctx.clip();
    // Use destination-out to subtract a tiny irregular amount from darkness (lighten)
    mctx.globalCompositeOperation = 'destination-out';
  mctx.globalAlpha = Math.max(0, Math.min(0.3, opts?.edgeNoiseStrength ?? 0.05));
    // Tile/stretch once to cover the mask; scale keeps it cheap
    mctx.drawImage(this.noiseSprite as any, 0, 0, this.maskW, this.maskH);
    mctx.restore();
  }

  // 2) Explored memory: visual only, no transparency punch-out
  //    We previously cut soft holes (destination-out) for explored tiles, which revealed units.
  //    To ensure enemies never show outside the visible edge, we skip erasing for explored.
  //    Optional: in the future, draw a subtle texture here using source-over (purely cosmetic).

  // Blit mask onto main canvas using current logical scale (do not reset transform)
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(this.maskCanvas as any, 0|0, 0|0); // integer-align
  ctx.restore();
  }

  // --- internals ---
  private ensureMaskSurface(w: number, h: number) {
    if (this.maskCanvas && this.maskW === w && this.maskH === h) return;
    this.maskW = w; this.maskH = h;
    try {
      this.maskCanvas = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w, h) : (() => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; })();
    } catch {
      const c = document.createElement('canvas'); c.width = w; c.height = h; this.maskCanvas = c;
    }
    this.maskCtx = (this.maskCanvas as any).getContext ? (this.maskCanvas as HTMLCanvasElement).getContext('2d') : (this.maskCanvas as OffscreenCanvas).getContext('2d');
    // Recreate hole sprites if tile size changed significantly relative to mask
    this.ensureHoleSprites();
  }

  private ensureHoleSprites() {
    const ts = this.tileSize;
  const diameter = Math.max(8, Math.floor(ts * 1.8)); // larger for softer explored memory
    if (diameter === this.holeSizePx && this.holeVisible && this.holeExplored) return;
    this.holeSizePx = diameter;
  this.holeVisible = this.makeRadialHoleSprite(diameter, 1.0);
  this.holeExplored = this.makeRadialHoleSprite(diameter, 0.75);
  }

  /** Ensure the cached circular reveal sprite is available. Built once at a fixed resolution and scaled at draw time. */
  private ensureCircleSprite() {
    if (this.circleSprite) return;
    const sz = this.circleSpriteBaseSize;
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(sz, sz) : (() => { const el = document.createElement('canvas'); el.width = sz; el.height = sz; return el; })();
    const g = (c as any).getContext ? (c as HTMLCanvasElement).getContext('2d')! : (c as OffscreenCanvas).getContext('2d')!;
    const r = sz / 2;
  // Softer feather profile: widen transition and make outermost alpha exactly 0
  // to avoid any hard ring at the boundary. Stops approximate a smoothstep curve.
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.58, 'rgba(255,255,255,1)');
  grad.addColorStop(0.76, 'rgba(255,255,255,0.60)');
  grad.addColorStop(0.88, 'rgba(255,255,255,0.30)');
  grad.addColorStop(0.96, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    g.fillStyle = grad;
    g.fillRect(0, 0, sz, sz);
    this.circleSprite = c;
  }

  /** Build once a small monochrome noise sprite for edge dithering. */
  private ensureNoiseSprite() {
    if (this.noiseSprite) return;
    const sz = this.noiseSpriteSize;
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(sz, sz) : (() => { const el = document.createElement('canvas'); el.width = sz; el.height = sz; return el; })();
    const g = (c as any).getContext ? (c as HTMLCanvasElement).getContext('2d')! : (c as OffscreenCanvas).getContext('2d')!;
    const img = g.createImageData(sz, sz);
    // Precompute noise – keep it sparse and stable; quantize to 3 levels to avoid banding
    const data = img.data;
    for (let i = 0, p = 0; i < sz * sz; i++, p += 4) {
      // xorshift-like LCG on index for deterministic flicker-free pattern
      let v = (i * 1664525 + 1013904223) >>> 0;
      v ^= v << 13; v ^= v >>> 17; v ^= v << 5;
      const n = (v & 0xff);
      // quantize: 0, 128, 255
      const q = (n < 85) ? 0 : (n < 170 ? 128 : 255);
      data[p] = data[p+1] = data[p+2] = q;
      data[p+3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.noiseSprite = c;
  }

  private makeRadialHoleSprite(diameter: number, innerAlpha: number): OffscreenCanvas | HTMLCanvasElement {
    const c = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(diameter, diameter) : (() => { const el = document.createElement('canvas'); el.width = diameter; el.height = diameter; return el; })();
    const g = (c as any).getContext ? (c as HTMLCanvasElement).getContext('2d')! : (c as OffscreenCanvas).getContext('2d')!;
    const r = diameter / 2;
    // Build radial alpha gradient from center (innerAlpha) -> edges (0)
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0.0, `rgba(255,255,255,${innerAlpha})`);
    grad.addColorStop(0.6, `rgba(255,255,255,${innerAlpha * 0.45})`);
    grad.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, diameter, diameter);
    return c;
  }

  private drawHole(ctx: CanvasRenderingContext2D, sprite: OffscreenCanvas | HTMLCanvasElement, cx: number, cy: number) {
    const s = this.holeSizePx;
    ctx.drawImage(sprite as any, Math.round(cx - s / 2), Math.round(cy - s / 2));
  }

  /** Clear all remembered tiles (use when starting a new run). */
  public clear() {
    this.states.clear();
    this.lastVisible.length = 0;
  }
}
