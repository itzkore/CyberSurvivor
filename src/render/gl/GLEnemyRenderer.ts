/**
 * WebGL2 enemy renderer (Textured instanced quads): draws enemies as textured quads into an offscreen canvas.
 *
 * Goals
 * - Single instanced draw call per frame for all enemies (gl.TRIANGLE_STRIP with 4 verts, instanced).
 * - Zero DOM changes: the internal canvas is blitted into the main 2D canvas each frame.
 * - Keep all 2D overlays (rings, status flashes, HP bars) in the existing pipeline; only replace the body sprite.
 * - Minimal allocations per frame: reuse a preallocated Float32Array and GPU buffer; grow by 1.5x when needed.
 * - Premultiplied alpha friendly blending to match Canvas2D composition.
 */
import { Logger } from '../../core/Logger';

export class GLEnemyRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null; // per-vertex unit quad (pos, uv)
  private instanceBuffer: WebGLBuffer | null = null; // per-instance attributes
  private instancesCapacity = 0;
  private uViewSize: WebGLUniformLocation | null = null;
  private uSampler: WebGLUniformLocation | null = null;
  private uTint: WebGLUniformLocation | null = null;
  private texture: WebGLTexture | null = null; // fallback or atlas texture
  private textureReady = false; // true when a real texture (fallback or atlas) is uploaded
  private lastTextureAttemptMs = 0;
  // Atlas state
  private atlasReady = false;
  private atlasMap: Record<string, { u0: number; v0: number; u1: number; v1: number; sizePx: number }> = {};
  private atlasDirty = true;
  private lastAtlasAttemptMs = 0;
  // Prevent log spam for repeatedly missing keys
  private warnedMissing: Record<string, number> = {};
  // Track EnemyManager's sprite version to know when to rebuild atlas
  private lastSpriteVersion = -1;

  // Instance layout: [centerX_ndc, centerY_ndc, size_px, angle_rad, u0, v0, u1, v1, flipX, tintR, tintG, tintB, tintA]
  private instanceStrideFloats = 13;
  private instanceData: Float32Array | null = null;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es\n
       layout(location=0) in vec2 aPos; // unit quad: [-0.5..0.5]\n
       layout(location=1) in vec2 aUV;  // [0..1]\n
       layout(location=2) in vec2 aCenterNDC; // per-instance center in NDC\n
       layout(location=3) in float aSizePx;   // per-instance size in pixels (width=height)\n
       layout(location=4) in float aAngle;    // per-instance rotation (radians)\n
       layout(location=5) in vec4 aUVRect;    // per-instance uv rect (u0,v0,u1,v1) in atlas space\n
  layout(location=6) in float aFlipX;    // per-instance horizontal flip: +1 or -1\n
  layout(location=7) in vec4 aTint;      // per-instance tint (premultiplied-friendly)\n
       uniform vec2 uViewSize; // framebuffer (pixelW, pixelH)\n
       out vec2 vUV;\n
  out vec4 vTint;\n
       void main(){\n
         // Rotate the unit quad around origin (apply optional horizontal flip)\n
         float s = sin(aAngle);\n
         float c = cos(aAngle);\n
         vec2 base = vec2(aPos.x * aFlipX, aPos.y);\n
         vec2 p = vec2( c * base.x - s * base.y, s * base.x + c * base.y );\n
         // Scale to pixels\n
         vec2 px = p * aSizePx;\n
         // Convert pixel offset to NDC (y inverted)\n
         vec2 ndcOfs = vec2(px.x * 2.0 / max(uViewSize.x, 1.0), -px.y * 2.0 / max(uViewSize.y, 1.0));\n
         vec2 ndc = aCenterNDC + ndcOfs;\n
         gl_Position = vec4(ndc, 0.0, 1.0);\n
         vec2 uvMin = aUVRect.xy;\n
         vec2 uvMax = aUVRect.zw;\n
         vUV = uvMin + aUV * (uvMax - uvMin);\n
         vTint = aTint;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       uniform sampler2D uTex;\n
       uniform vec4 uTint; // global tint multiplier (rgb optional, a multiplies alpha)\n
       in vec2 vUV;\n
       in vec4 vTint;\n
       out vec4 outColor;\n
       void main(){\n
         vec4 texel = texture(uTex, vUV);\n
         // Combine per-instance tint and global tint.\n
         vec3 rgb = texel.rgb * uTint.rgb * vTint.rgb;\n
         float a = texel.a * uTint.a * vTint.a;\n
         if (a <= 0.003) discard;\n
         outColor = vec4(rgb, a);\n
       }`
    );
    this.lookupUniforms();
    this.initVAO();
    this.configureGL();
    this.initFallbackTexture();
  }

  private createShader(type: number, src: string): WebGLShader {
    const sh = this.gl.createShader(type)!;
    this.gl.shaderSource(sh, src);
    this.gl.compileShader(sh);
    if (!this.gl.getShaderParameter(sh, this.gl.COMPILE_STATUS)) {
      const log = this.gl.getShaderInfoLog(sh) || 'unknown';
      this.gl.deleteShader(sh);
      throw new Error('Shader compile error: ' + log);
    }
    return sh;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const vs = this.createShader(this.gl.VERTEX_SHADER, vsSrc);
    const fs = this.createShader(this.gl.FRAGMENT_SHADER, fsSrc);
    const prog = this.gl.createProgram()!;
    this.gl.attachShader(prog, vs);
    this.gl.attachShader(prog, fs);
    this.gl.linkProgram(prog);
    this.gl.deleteShader(vs);
    this.gl.deleteShader(fs);
    if (!this.gl.getProgramParameter(prog, this.gl.LINK_STATUS)) {
      const log = this.gl.getProgramInfoLog(prog) || 'unknown';
      this.gl.deleteProgram(prog);
      throw new Error('Program link error: ' + log);
    }
    return prog;
  }

  private lookupUniforms() {
    this.uViewSize = this.gl.getUniformLocation(this.program, 'uViewSize');
    this.uSampler = this.gl.getUniformLocation(this.program, 'uTex');
    this.uTint = this.gl.getUniformLocation(this.program, 'uTint');
  }

  private initVAO() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // Per-vertex quad (pos, uv)
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    // 4 vertices: pos(-0.5..0.5), uv(0..1) arranged for TRIANGLE_STRIP
    const quad = new Float32Array([
      // x, y,   u, v
      -0.5, -0.5,  0.0, 1.0,
       0.5, -0.5,  1.0, 1.0,
      -0.5,  0.5,  0.0, 0.0,
       0.5,  0.5,  1.0, 0.0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    // aPos
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0);
    // aUV
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
    // Per-instance buffer: centerNDC (vec2), sizePx (float), angle (float), uvRect (vec4), flipX (float)
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    // aCenterNDC @ loc 2
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, this.instanceStrideFloats * 4, 0);
    gl.vertexAttribDivisor(2, 1);
    // aSizePx @ loc 3
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, this.instanceStrideFloats * 4, 2 * 4);
    gl.vertexAttribDivisor(3, 1);
    // aAngle @ loc 4
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, this.instanceStrideFloats * 4, 3 * 4);
    gl.vertexAttribDivisor(4, 1);
    // aUVRect @ loc 5
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, this.instanceStrideFloats * 4, 4 * 4);
    gl.vertexAttribDivisor(5, 1);
  // aFlipX @ loc 6
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, this.instanceStrideFloats * 4, 8 * 4);
    gl.vertexAttribDivisor(6, 1);
  // aTint @ loc 7
  gl.enableVertexAttribArray(7);
  gl.vertexAttribPointer(7, 4, gl.FLOAT, false, this.instanceStrideFloats * 4, 9 * 4);
  gl.vertexAttribDivisor(7, 1);
    gl.bindVertexArray(null);
  }

  private configureGL() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  /** Create a 1x1 white fallback texture to avoid shader sampling issues before real assets are ready. */
  private initFallbackTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const white = new Uint8Array([255, 255, 255, 255]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
    this.texture = tex;
    this.textureReady = false; // will swap in real texture when available
  }

  /** Try to build a texture from AssetLoader enemy sprite once available. */
  private ensureEnemyTexture(): void {
    if (this.textureReady) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lastTextureAttemptMs < 500) return; // throttle attempts
    this.lastTextureAttemptMs = now;
    try {
  const AL: any = (window as any).AssetLoader;
      if (!AL) return;
      // Use the game's shared loader to reuse the preloaded cache
      const game: any = (window as any).__gameInstance;
  const loader = game?.assetLoader || new AL();
  // Resolve from manifest with dotted key when possible, fallback to known path
  let path = '';
  try { path = loader.getAsset?.('enemies.default') || ''; } catch {}
      if (!path) path = AL.normalizePath('/assets/enemies/enemy_default.png');
      let img: HTMLImageElement | undefined = loader.getImage?.(path);
      // Proactively load the image if not cached yet to avoid long “no texture” windows in dev
      if ((!img || !img.width || !img.height) && typeof loader.loadImage === 'function' && path) {
        try { loader.loadImage(path); } catch {}
        img = loader.getImage?.(path);
      }
      if (!img || !img.width || !img.height) return; // try again later
      const gl = this.gl;
      const tex = this.texture || gl.createTexture();
      if (!tex) return;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Source is HTMLImageElement (non-premultiplied). Enable premultiply so blending matches Canvas2D (PM alpha).
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      this.texture = tex;
      this.textureReady = true;
    } catch {
      // ignore; will retry later
    }
  }

  /** Build or rebuild the atlas texture from EnemyManager's pre-rendered canvases. */
  private tryBuildAtlasFromManager(enemyManager: any): void {
    try {
      if (!enemyManager) return;
      // Avoid busy-looping atlas builds; throttle attempts
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (nowMs - this.lastAtlasAttemptMs < 200) return;
      this.lastAtlasAttemptMs = nowMs;
      // Wait briefly for sprite readiness to avoid building empty atlases on dev startup
      try {
        if (typeof enemyManager.areSpritesReady === 'function' && enemyManager.areSpritesReady() !== true) {
          // Not ready yet; keep fallback texture path and try again later
          return;
        }
      } catch { /* ignore wait errors */ }
      const baseMap: Array<{ key: string; img: HTMLCanvasElement | HTMLImageElement; size: number }> = [];
      // Base enemy types
      const es: any = enemyManager.enemySprites || {};
      for (const key in es) {
        const bundle = es[key];
        const img = bundle?.normal as HTMLCanvasElement | HTMLImageElement | undefined;
        if (img && (img as any).width && (img as any).height) {
          baseMap.push({ key: String(key), img, size: (img as any).width });
        }
      }
      // Elite kinds
      const elites: any = enemyManager.eliteSprites || {};
      for (const key in elites) {
        const bundle = elites[key];
        const img = bundle?.normal as HTMLCanvasElement | HTMLImageElement | undefined;
        if (img && (img as any).width && (img as any).height) {
          baseMap.push({ key: `ELITE:${String(key)}`, img, size: (img as any).width });
        }
      }
      if (baseMap.length === 0) {
        if (!this.atlasReady) {
          const last = (this as any).__lastEmptyWarnMs || 0;
          const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          if (now - last > 5000) {
            Logger.info('GL enemies: atlas build skipped, no sprites available yet (will retry)');
            (this as any).__lastEmptyWarnMs = now;
          }
        }
        this.atlasReady = false; this.textureReady = !!this.texture; this.atlasMap = {};
        try { (window as any).__glEnemiesAtlasReady = false; } catch {}
        return;
      }
      // Simple shelf packer with padding to prevent texture bleeding
      baseMap.sort((a, b) => b.size - a.size);
      const totalArea = baseMap.reduce((s, e) => s + e.size * e.size, 0);
      const estSide = Math.max(64, Math.ceil(Math.sqrt(totalArea)));
      const pow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };
      const atlasW = pow2(estSide);
      const pad = 2; // pixels of gutter around each sprite
      let x = 0, y = 0, rowH = 0;
      // First pass: place and compute needed height
      const placements: Array<{ key: string; x: number; y: number; size: number; img: any }> = [];
      for (let i = 0; i < baseMap.length; i++) {
        const e = baseMap[i];
        const tile = e.size + pad * 2;
        if (tile > atlasW) continue; // too big; skip
        if (x + tile > atlasW) { x = 0; y += rowH; rowH = 0; }
        placements.push({ key: e.key, x, y, size: e.size, img: e.img });
        x += tile; rowH = Math.max(rowH, tile);
      }
  const atlasH = pow2(y + rowH);
      // Draw
      const cv = document.createElement('canvas');
      cv.width = atlasW; cv.height = atlasH;
      const c2d = cv.getContext('2d');
  if (!c2d) { this.atlasReady = false; this.atlasMap = {}; return; }
      c2d.clearRect(0, 0, atlasW, atlasH);
      const map: Record<string, { u0: number; v0: number; u1: number; v1: number; sizePx: number }> = {};
      for (let i = 0; i < placements.length; i++) {
        const p = placements[i];
        // Draw with padding around each sprite to create a gutter region
        c2d.drawImage(p.img, p.x + pad, p.y + pad, p.size, p.size);
        const u0 = (p.x + pad) / atlasW, v0 = (p.y + pad) / atlasH;
        const u1 = (p.x + pad + p.size) / atlasW, v1 = (p.y + pad + p.size) / atlasH;
        map[p.key] = { u0, v0, u1, v1, sizePx: p.size };
      }
      // Upload
      const gl = this.gl;
      const tex = this.texture || gl.createTexture();
      if (!tex) { this.atlasReady = false; return; }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // Source is a Canvas (sprite atlas) which is already premultiplied by the 2D renderer.
  // Do NOT premultiply again to avoid dark fringes. Keep Y-flip for texture space consistency.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      this.texture = tex;
      this.atlasMap = map;
      // Validate atlas: require at least one entry and dimensions > 1x1
      const valid = (Object.keys(map).length > 0) && (atlasW > 1) && (atlasH > 1);
      this.atlasReady = valid;
      this.textureReady = valid || this.textureReady;
      this.atlasDirty = false;
      (window as any).__glEnemiesAtlasInfo = { width: atlasW, height: atlasH, entries: Object.keys(map).length, builtAt: Date.now() };
      try { (window as any).__glEnemiesAtlasReady = valid; } catch {}
    } catch {
      this.atlasReady = false; this.atlasMap = {};
      try { (window as any).__glEnemiesAtlasReady = false; } catch {}
    }
  }

  private ensureCapacity(count: number) {
    if (count <= this.instancesCapacity) return;
    this.instancesCapacity = Math.ceil(count * 1.5);
    this.instanceData = new Float32Array(this.instancesCapacity * this.instanceStrideFloats);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  public setSize(pixelW: number, pixelH: number) {
    const w = Math.max(1, Math.floor(pixelW));
    const h = Math.max(1, Math.floor(pixelH));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  /**
   * Render enemies into the internal WebGL canvas with Level-of-Detail optimization.
   * Enemies are expected to be objects with: x, y, radius, active, hp.
   */
  public render(
    enemies: Array<any>,
    enemyManager: any,
    playerX: number,
    camX: number,
    camY: number,
    designW: number,
    designH: number,
    pixelW: number,
    pixelH: number,
    opts?: { tint?: [number, number, number, number] }
  ) {
    this.setSize(pixelW, pixelH);
    const gl = this.gl;
    this.ensureCapacity(enemies.length);
    // If atlas is not ready yet, only try to build it with proper throttling to avoid lag
    if (this.atlasDirty || !this.atlasReady) {
      // Only attempt atlas build if throttling allows it (200ms intervals in tryBuildAtlasFromManager)
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (nowMs - this.lastAtlasAttemptMs >= 200) {
        this.tryBuildAtlasFromManager(enemyManager);
      }
      // Publish minimal readiness state for overlay and gating
      try {
        (window as any).__glEnemiesIsReady = !!this.textureReady || !!this.atlasReady;
        (window as any).__glEnemiesAtlasReady = !!this.atlasReady;
        (window as any).__glEnemiesHasValidTexture = !!(this.texture && (this.textureReady || this.atlasReady));
        (window as any).__glEnemiesLastCount = 0;
      } catch {}
      return;
    }
    // Observe EnemyManager sprite version; if changed, mark atlas dirty
    try {
      const v = typeof enemyManager?.getEnemySpriteVersion === 'function' ? enemyManager.getEnemySpriteVersion() : this.lastSpriteVersion;
      if (v !== this.lastSpriteVersion) { this.atlasDirty = true; this.lastSpriteVersion = v; }
    } catch { /* ignore */ }
    // Atlas is ready here; ensure base texture bound (already uploaded in atlas builder),
    // but keep fallback path as a no-op since we require atlas for rendering.
    const inst = this.instanceData as Float32Array;
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    let count = 0;
    const pad = 64;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // LOD system: calculate distance from player for each enemy
    const playerCenterX = playerX;
    const playerCenterY = (window as any).__camY + designH / 2; // Estimate player Y from camera
    
    for (let i = 0; i < enemies.length; i++) {
      const e: any = enemies[i];
      if (!e || !e.active || e.hp <= 0) continue;
      
      // Early viewport culling
      const sx = e.x - camX; let sy = e.y - camY;
      if (sx < -pad || sy < -pad || sx > designW + pad || sy > designH + pad) continue;
      
      // LOD distance calculation
      const distanceToPlayer = Math.hypot(e.x - playerCenterX, e.y - playerCenterY);
      const lodLevel = distanceToPlayer > 800 ? 2 : distanceToPlayer > 400 ? 1 : 0;
      
      // Skip distant enemies under high load
      const avgFrameMs = (window as any).__avgFrameMs || 16;
      if (avgFrameMs > 35 && lodLevel === 2 && Math.random() > 0.3) continue; // Skip 70% of far enemies
      if (avgFrameMs > 50 && lodLevel >= 1 && Math.random() > 0.5) continue; // Skip 50% of medium+ distance enemies
      
      // Elite detection and key
      const eliteKind: string | undefined = (e._elite && e._elite.kind) ? String(e._elite.kind) : undefined;
      const key = eliteKind ? `ELITE:${eliteKind}` : String(e.type || '');
      const rect = this.atlasMap[key];
      if (!rect) {
        // If elite missing, ask manager to build it and mark atlas dirty
        try { if (eliteKind && enemyManager?.ensureEliteSprite) enemyManager.ensureEliteSprite(eliteKind); } catch {}
        const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const last = this.warnedMissing[key] || 0;
        if (nowMs - last > 5000) {
          Logger.warn(`GL enemies: missing atlas entry for key '${key}' (elite=${!!eliteKind}); scheduling rebuild`);
          this.warnedMissing[key] = nowMs;
        }
        this.atlasDirty = true;
      }
      
      // Walking bob and shake offset (design-space) - reduced detail for distant enemies
      let shakeX = 0, shakeY = 0;
      if (lodLevel < 2 && e._shakeUntil && now < e._shakeUntil) {
        const amp = e._shakeAmp || 0.8;
        const phase = e._shakePhase || 0;
        const t = now * 0.03 + phase;
        shakeX = Math.sin(t) * amp;
        shakeY = Math.cos(t * 1.3) * (amp * 0.6);
      }
      const eAny: any = e;
      const faceLeft = (eAny._facingX != null) ? (eAny._facingX < 0) : (playerX < e.x);
      const walkFlip = lodLevel < 2 ? !!eAny._walkFlip : false; // Disable walk animation for far enemies
      const isElite = !!eliteKind;
      const baseR = isElite
        ? Math.max(8, ((rect?.sizePx ?? ((e.radius || 20) * 2)) as number) / 2)
        : Math.max(2, e.radius || 20);
      
      // Reduce animation detail based on LOD level
      const stepAmp = lodLevel >= 1 ? 0 : (isElite ? Math.min(0.8, baseR * 0.03) : Math.min(1.5, baseR * 0.06));
      const stepOffsetX = (walkFlip ? -1 : 1) * stepAmp;
      const stepOffsetY = (walkFlip ? -0.3 : 0.3) * (lodLevel >= 1 ? 0 : 1);
      const cx = sx + shakeX + stepOffsetX;
      sy = sy + shakeY + stepOffsetY;
      const xNdc = cx / designW * 2 - 1;
      const yNdc = (sy / designH * 2 - 1) * -1.0;
      // Average pixel scale
      const avgScale = (0.5 * (scaleX + scaleY));
      // Visual size from atlas entry if available else from radius*2 - scaled by LOD
      const baseSizeDesign = rect?.sizePx ?? ((e.radius || 20) * 2);
      // Mind-controlled enlargement - reduced for distant enemies
      const mcScale = (lodLevel < 2 && eAny._mindControlledUntil && now < eAny._mindControlledUntil) ? 1.5 : 1.0;
      // LOD size reduction for distant enemies
      const lodSizeScale = lodLevel === 2 ? 0.7 : lodLevel === 1 ? 0.85 : 1.0;
      const sizePx = Math.max(2, baseSizeDesign * avgScale * mcScale * lodSizeScale);
      const flipSign = ((faceLeft ? -1 : 1) * (walkFlip ? -1 : 1)) < 0 ? -1 : 1;
      const idx = count * this.instanceStrideFloats;
      inst[idx + 0] = xNdc;
      inst[idx + 1] = yNdc;
      inst[idx + 2] = sizePx;
      // Optional facing/rotation could be passed from enemy; default 0
      inst[idx + 3] = (e.angle || 0);
      // UV rect (fallback to full texture if atlas not ready)
      if (this.atlasReady && rect) {
        inst[idx + 4] = rect.u0; inst[idx + 5] = rect.v0; inst[idx + 6] = rect.u1; inst[idx + 7] = rect.v1;
      } else {
        inst[idx + 4] = 0; inst[idx + 5] = 0; inst[idx + 6] = 1; inst[idx + 7] = 1;
      }
      // Flip sign
      inst[idx + 8] = flipSign;
      // Per-instance tint: default white; reduce visual effects for distant enemies
      let tr = 1.0, tg = 1.0, tb = 1.0, ta = 1.0;
      const pUntil = (eAny._poisonFlashUntil || 0) as number;
      if (lodLevel < 2 && pUntil && now < pUntil) {
        const left = Math.max(0, Math.min(1, (pUntil - now) / 140));
        // Subtle green flash: ramp up green channel; keep premult consistent via alpha
        tr = 0.9 + 0.1 * (1.0 - left);
        tg = 1.0;
        tb = 0.9 + 0.05 * (1.0 - left);
        ta = 1.0; // maintain alpha
      }
      inst[idx + 9]  = tr;
      inst[idx + 10] = tg;
      inst[idx + 11] = tb;
      inst[idx + 12] = ta;
      count++;
    }
  gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  // Publish readiness for outer pipeline decisions (only skip 2D when ready)
  try {
    const hasRealTex = !!(this.texture && (this.textureReady || this.atlasReady));
    (window as any).__glEnemiesIsReady = !!(this.atlasReady || this.textureReady);
    (window as any).__glEnemiesAtlasReady = !!this.atlasReady;
    (window as any).__glEnemiesHasValidTexture = hasRealTex;
  } catch {}
  if (!count) { (window as any).__glEnemiesLastCount = 0; return; }
    gl.useProgram(this.program);
    if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
    const t = opts?.tint || [1.0, 1.0, 1.0, 1.0];
    if (this.uTint) gl.uniform4f(this.uTint, t[0], t[1], t[2], t[3]);
    // Bind texture unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.uSampler) gl.uniform1i(this.uSampler, 0);
    gl.bindVertexArray(this.vao);
    // Update instance buffer (partial)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, count * this.instanceStrideFloats));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    (window as any).__glEnemiesLastCount = count;
  }
}

export function createGLEnemyRendererLike(mainCanvas: HTMLCanvasElement): GLEnemyRenderer | null {
  try {
    const w = Math.max(1, mainCanvas.width);
    const h = Math.max(1, mainCanvas.height);
    return new GLEnemyRenderer(w, h);
  } catch {
    return null;
  }
}
