/**
 * WebGL2 enemy renderer (textured instanced quads) with LOD and sprite atlas.
 * - Draws all enemies in 1 instanced call.
 * - Offscreen canvas is composited by Game over the 2D pipeline.
 * - Builds an atlas from EnemyManager sprites and a synthetic IMPOSTER for far LOD.
 */
import { Logger } from '../../core/Logger';
import { PerfFlags as Flags } from '../../config/perfFlags';

export class GLEnemyRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null; // per-vertex unit quad (pos, uv)
  private instanceBuffer: WebGLBuffer | null = null; // per-instance data
  private instancesCapacity = 0;
  private instanceStrideFloats = 13; // center(2), size(1), angle(1), uvRect(4), flip(1), tint(4)
  private instanceData: Float32Array = new Float32Array(0);
  // uniforms
  private uViewSize: WebGLUniformLocation | null = null;
  private uSampler: WebGLUniformLocation | null = null;
  private uTint: WebGLUniformLocation | null = null;
  // atlas/texture
  private texture: WebGLTexture | null = null;
  private textureReady = false;
  private atlasReady = false;
  private atlasDirty = true;
  private lastAtlasAttemptMs = 0;
  private lastSpriteVersion = 0;
  private atlasMap: Record<string, { u0:number; v0:number; u1:number; v1:number; sizePx:number }> = {};
  private warnedMissing: Record<string, number> = {};

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es
       layout(location=0) in vec2 aPos;
       layout(location=1) in vec2 aUV;
       layout(location=2) in vec2 aCenterNDC;
       layout(location=3) in float aSizePx;
       layout(location=4) in float aAngle;
       layout(location=5) in vec4 aUVRect;
       layout(location=6) in float aFlipX;
       layout(location=7) in vec4 aTintInst;
       uniform vec2 uViewSize;
       out vec2 vUV;
       out vec4 vTint;
       void main(){
         float s = sin(aAngle);
         float c = cos(aAngle);
         vec2 p = vec2( (c * aPos.x - s * aPos.y) * aFlipX, s * aPos.x + c * aPos.y );
         vec2 px = p * aSizePx;
         vec2 ndcOfs = vec2(px.x * 2.0 / max(uViewSize.x,1.0), -px.y * 2.0 / max(uViewSize.y,1.0));
         vec2 ndc = aCenterNDC + ndcOfs;
         gl_Position = vec4(ndc, 0.0, 1.0);
         vec2 uvMin = aUVRect.xy;
         vec2 uvMax = aUVRect.zw;
         vUV = uvMin + aUV * (uvMax - uvMin);
         vTint = aTintInst;
       }`,
      `#version 300 es
       precision mediump float;
       uniform sampler2D uTex;
       uniform vec4 uTint;
       in vec2 vUV;
       in vec4 vTint;
       out vec4 outColor;
       void main(){
         vec4 texel = texture(uTex, vUV);
         float a = texel.a * uTint.a * vTint.a;
         if (a <= 0.003) discard;
         outColor = vec4(texel.rgb * uTint.rgb * vTint.rgb, a);
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
    // Per-instance buffer: centerNDC (vec2), sizePx (float), angle (float), uvRect (vec4), flipX (float), tint(vec4)
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

  // 1x1 white fallback texture
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
    this.textureReady = false; // will be replaced when atlas is built
  }

  // Build or rebuild the atlas texture from EnemyManager's pre-rendered canvases
  private tryBuildAtlasFromManager(enemyManager: any): void {
    try {
      if (!enemyManager) return;
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (nowMs - this.lastAtlasAttemptMs < 200) return; // throttle
      this.lastAtlasAttemptMs = nowMs;
      // Wait until sprites are ready
      try {
        if (typeof enemyManager.areSpritesReady === 'function' && enemyManager.areSpritesReady() !== true) return;
      } catch { /* ignore */ }
      const baseMap: Array<{ key: string; img: HTMLCanvasElement | HTMLImageElement; size: number }> = [];
      const es: any = enemyManager.enemySprites || {};
      for (const key in es) {
        const img = es[key]?.normal as HTMLCanvasElement | HTMLImageElement | undefined;
        if (img && (img as any).width && (img as any).height) baseMap.push({ key: String(key), img, size: (img as any).width });
      }
      const elites: any = enemyManager.eliteSprites || {};
      for (const key in elites) {
        const img = elites[key]?.normal as HTMLCanvasElement | HTMLImageElement | undefined;
        if (img && (img as any).width && (img as any).height) baseMap.push({ key: `ELITE:${String(key)}`, img, size: (img as any).width });
      }
      // Synthetic imposter for far LOD
      try {
        const imposterSize = 32;
        const cvI = document.createElement('canvas'); cvI.width = imposterSize; cvI.height = imposterSize;
        const g = cvI.getContext('2d');
        if (g) {
          g.clearRect(0, 0, imposterSize, imposterSize);
          const cx = imposterSize * 0.5, cy = imposterSize * 0.5, r = imposterSize * 0.5 - 1;
          const grad = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
          grad.addColorStop(0, 'rgba(255,255,255,1)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI*2); g.closePath(); g.fill();
          baseMap.push({ key: 'IMPOSTER', img: cvI, size: imposterSize });
        }
      } catch { /* ignore */ }
      if (baseMap.length === 0) {
        this.atlasReady = false; this.atlasMap = {};
        try { (window as any).__glEnemiesAtlasReady = false; } catch {}
        return;
      }
      // Shelf packer with small padding
      baseMap.sort((a, b) => b.size - a.size);
      const totalArea = baseMap.reduce((s, e) => s + e.size * e.size, 0);
      const estSide = Math.max(64, Math.ceil(Math.sqrt(totalArea)));
      const pow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };
      const atlasW = pow2(estSide);
      const pad = 2;
      let x = 0, y = 0, rowH = 0;
      const placements: Array<{ key:string; x:number; y:number; size:number; img:any }> = [];
      for (let i=0;i<baseMap.length;i++) {
        const e = baseMap[i]; const tile = e.size + pad*2;
        if (tile > atlasW) continue;
        if (x + tile > atlasW) { x = 0; y += rowH; rowH = 0; }
        placements.push({ key: e.key, x, y, size: e.size, img: e.img });
        x += tile; rowH = Math.max(rowH, tile);
      }
      const atlasH = pow2(y + rowH);
      const cv = document.createElement('canvas'); cv.width = atlasW; cv.height = atlasH;
      const c2d = cv.getContext('2d'); if (!c2d) { this.atlasReady = false; this.atlasMap = {}; return; }
      c2d.clearRect(0, 0, atlasW, atlasH);
      const map: Record<string, { u0:number; v0:number; u1:number; v1:number; sizePx:number }> = {};
      for (let i=0;i<placements.length;i++) {
        const p = placements[i];
        c2d.drawImage(p.img, p.x + pad, p.y + pad, p.size, p.size);
        const u0 = (p.x + pad) / atlasW, v0 = (p.y + pad) / atlasH;
        const u1 = (p.x + pad + p.size) / atlasW, v1 = (p.y + pad + p.size) / atlasH;
        map[p.key] = { u0, v0, u1, v1, sizePx: p.size };
      }
      const gl = this.gl;
      const tex = this.texture || gl.createTexture(); if (!tex) { this.atlasReady = false; return; }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Canvas is already premultiplied by 2D context
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      this.texture = tex; this.atlasMap = map;
      const valid = (Object.keys(map).length > 0) && (atlasW > 1) && (atlasH > 1);
      this.atlasReady = valid; this.textureReady = valid || this.textureReady; this.atlasDirty = false;
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
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  public setSize(pixelW: number, pixelH: number) {
    const w = Math.max(1, Math.floor(pixelW));
    const h = Math.max(1, Math.floor(pixelH));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h; this.gl.viewport(0, 0, w, h);
    }
  }

  // Render enemies to the internal GL canvas with LOD
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
    // Atlas build if needed
    if (this.atlasDirty || !this.atlasReady) {
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (nowMs - this.lastAtlasAttemptMs >= 200) this.tryBuildAtlasFromManager(enemyManager);
      try {
        (window as any).__glEnemiesIsReady = !!this.textureReady || !!this.atlasReady;
        (window as any).__glEnemiesAtlasReady = !!this.atlasReady;
        (window as any).__glEnemiesHasValidTexture = !!(this.texture && (this.textureReady || this.atlasReady));
        (window as any).__glEnemiesLastCount = 0;
      } catch {}
      return;
    }
    // Observe sprite version to trigger rebuilds
    try {
      const v = typeof enemyManager?.getEnemySpriteVersion === 'function' ? enemyManager.getEnemySpriteVersion() : this.lastSpriteVersion;
      if (v !== this.lastSpriteVersion) { this.atlasDirty = true; this.lastSpriteVersion = v; }
    } catch { /* ignore */ }

    const inst = this.instanceData as Float32Array;
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    const pad = 64;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const playerCenterX = playerX;
    const playerCenterY = ((window as any).__camY ?? camY) + designH / 2;
    const lodEnabled = !!Flags.lodEnabled;
    const nearDist = Flags.lodNearDistance ?? 400;
    const farDist = Flags.lodFarDistance ?? 800;
    const avgFrameMs = (window as any).__avgFrameMs || 16;
    const skipFar = lodEnabled && (avgFrameMs > (Flags.lodSkipFarAtAvgMs ?? 35));
    const skipMed = lodEnabled && (avgFrameMs > (Flags.lodSkipMediumAtAvgMs ?? 50));
    let count = 0;

    for (let i = 0; i < enemies.length; i++) {
      const e: any = enemies[i];
      if (!e || !e.active || e.hp <= 0) continue;
      const sx = e.x - camX; let sy = e.y - camY;
      if (sx < -pad || sy < -pad || sx > designW + pad || sy > designH + pad) continue;
      const d = lodEnabled ? Math.hypot(e.x - playerCenterX, e.y - playerCenterY) : 0;
      const lodLevel = lodEnabled ? (d > farDist ? 2 : d > nearDist ? 1 : 0) : 0;
      if (lodLevel === 2 && skipFar && Math.random() < (Flags.lodSkipFarRatio ?? 0.7)) continue;
      if (lodLevel >= 1 && skipMed && Math.random() < (Flags.lodSkipMediumRatio ?? 0.5)) continue;

      const eliteKind: string | undefined = (e._elite && e._elite.kind) ? String(e._elite.kind) : undefined;
      const key = eliteKind ? `ELITE:${eliteKind}` : String(e.type || '');
      let rect = this.atlasMap[key];
      if (!rect) {
        try { if (eliteKind && enemyManager?.ensureEliteSprite) enemyManager.ensureEliteSprite(eliteKind); } catch {}
        const nowMs2 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const last = this.warnedMissing[key] || 0;
        if (nowMs2 - last > 5000) { Logger.warn(`GL enemies: missing atlas entry for key '${key}' (elite=${!!eliteKind}); scheduling rebuild`); this.warnedMissing[key] = nowMs2; }
        this.atlasDirty = true;
      }
      if (lodLevel === 2 && Flags.lodImposterEnabled) {
        const imp = this.atlasMap['IMPOSTER']; if (imp) rect = imp;
      }
      let shakeX = 0, shakeY = 0;
      if (lodLevel < 2 && e._shakeUntil && now < e._shakeUntil) {
        const amp = e._shakeAmp || 0.8; const phase = e._shakePhase || 0; const t = now * 0.03 + phase;
        shakeX = Math.sin(t) * amp; shakeY = Math.cos(t * 1.3) * (amp * 0.6);
      }
      const eAny: any = e;
      const faceLeft = (eAny._facingX != null) ? (eAny._facingX < 0) : (playerX < e.x);
      const walkFlip = lodLevel < 2 ? !!eAny._walkFlip : false;
      const isElite = !!eliteKind;
      const baseR = isElite ? Math.max(8, ((rect?.sizePx ?? ((e.radius || 20) * 2)) as number) / 2) : Math.max(2, e.radius || 20);
      const stepAmp = lodLevel >= 1 ? 0 : (isElite ? Math.min(0.8, baseR * 0.03) : Math.min(1.5, baseR * 0.06));
      const stepOffsetX = (walkFlip ? -1 : 1) * stepAmp; const stepOffsetY = (walkFlip ? -0.3 : 0.3) * (lodLevel >= 1 ? 0 : 1);
      const cx = sx + shakeX + stepOffsetX; sy = sy + shakeY + stepOffsetY;
      const xNdc = cx / designW * 2 - 1; const yNdc = (sy / designH * 2 - 1) * -1.0;
      const avgScale = (0.5 * (scaleX + scaleY));
      const baseSizeDesign = rect?.sizePx ?? ((e.radius || 20) * 2);
      const mcScale = (lodLevel < 2 && eAny._mindControlledUntil && now < eAny._mindControlledUntil) ? 1.5 : 1.0;
      const lodSizeScale = lodLevel === 2 ? 0.7 : lodLevel === 1 ? 0.85 : 1.0;
      const sizePx = Math.max(2, baseSizeDesign * avgScale * mcScale * lodSizeScale);
      const flipSign = ((faceLeft ? -1 : 1) * (walkFlip ? -1 : 1)) < 0 ? -1 : 1;

      const idx = count * this.instanceStrideFloats;
      inst[idx + 0] = xNdc; inst[idx + 1] = yNdc; inst[idx + 2] = sizePx; inst[idx + 3] = (e.angle || 0);
      if (this.atlasReady && rect) { inst[idx + 4] = rect.u0; inst[idx + 5] = rect.v0; inst[idx + 6] = rect.u1; inst[idx + 7] = rect.v1; }
      else { inst[idx + 4] = 0; inst[idx + 5] = 0; inst[idx + 6] = 1; inst[idx + 7] = 1; }
      inst[idx + 8] = flipSign;
      let tr = 1.0, tg = 1.0, tb = 1.0, ta = 1.0;
      const pUntil = (eAny._poisonFlashUntil || 0) as number;
      if (lodLevel < 2 && pUntil && now < pUntil) { const left = Math.max(0, Math.min(1, (pUntil - now) / 140)); tr = 0.9 + 0.1 * (1.0 - left); tg = 1.0; tb = 0.9 + 0.05 * (1.0 - left); ta = 1.0; }
      inst[idx + 9] = tr; inst[idx + 10] = tg; inst[idx + 11] = tb; inst[idx + 12] = ta;
      count++;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texture); if (this.uSampler) gl.uniform1i(this.uSampler, 0);
    gl.bindVertexArray(this.vao);
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
