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
      visibleCenterX?: number; // world coords (player.x)
      visibleCenterY?: number; // world coords (player.y)
      visibleRadiusPx?: number; // override radius in pixels (fallback = lastRadiusTiles * tileSize)
  visibleRects?: Array<{ x:number; y:number; w:number; h:number }>; // extra clear rects in world coords
  /** Optional: clip the circular reveal to these rects (world coords). Useful to restrict visibility outside corridors. */
  circleClipRects?: Array<{ x:number; y:number; w:number; h:number }>;
    }
  ) {
    if (opts && opts.enable === false) return; // disabled
    // Ensure mask surface matches viewport logical size
    this.ensureMaskSurface(Math.ceil(camera.width), Math.ceil(camera.height));
    if (!this.maskCtx || !this.maskCanvas) return;

  const mctx = this.maskCtx as CanvasRenderingContext2D;
    // Fill darkness
  const darkAlpha = Math.max(0.25, Math.min(1, (opts?.darkAlpha ?? 0.95))); // slightly lighter by default to reduce perceived banding
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = darkAlpha;
    mctx.fillStyle = '#000';
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
  // Softer feather profile: longer transition from full to edge to avoid harsh edge against black
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.00, 'rgba(255,255,255,1)');
  grad.addColorStop(0.74, 'rgba(255,255,255,1)');
  grad.addColorStop(0.90, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.28)');
    g.fillStyle = grad;
    g.fillRect(0, 0, sz, sz);
    this.circleSprite = c;
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
