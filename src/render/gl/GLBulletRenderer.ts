/**
 * WebGL2 bullets renderer (sprite-based): draws bullets as textured quads using a small atlas of projectile PNGs.
 * - Builds an atlas from AssetLoader's cached projectile images (manifest projectiles.* entries).
 * - Renders only classic sprite bullets (those with a projectileImageKey and not orbiting/melee/laser/plasma/droplet types).
 * - Other special projectiles continue to be drawn by the 2D path when GL bullets are disabled (default) or when unsupported.
 */
import { Logger } from '../../core/Logger';

export class GLBulletRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private instancesCapacity = 0;
  private uViewSize: WebGLUniformLocation | null = null;
  private uSampler: WebGLUniformLocation | null = null;
  private uTint: WebGLUniformLocation | null = null;
  private texture: WebGLTexture | null = null;
  private textureReady = false;
  private lastAtlasBuildMs = 0;
  // Atlas
  private atlasMap: Record<string, { u0:number; v0:number; u1:number; v1:number }> = {};
  private atlasDirty = true;
  // Track keys we warned about to avoid spam
  private warnedMissing: Record<string, number> = {};
  // Instance layout: [centerX_ndc, centerY_ndc, size_px, angle_rad, u0, v0, u1, v1, a]
  private instanceStrideFloats = 9;
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
       layout(location=0) in vec2 aPos; // unit quad [-0.5..0.5]\n
       layout(location=1) in vec2 aUV;  // base uv [0..1]\n
       layout(location=2) in vec2 aCenterNDC;\n
       layout(location=3) in float aSizePx;\n
       layout(location=4) in float aAngle;\n
       layout(location=5) in vec4 aUVRect; // u0,v0,u1,v1 in atlas space\n
       layout(location=6) in float aAlpha; // per-instance alpha (for future fades)\n
       uniform vec2 uViewSize;\n
       out vec2 vUV;\n
       out float vA;\n
       void main(){\n
         float s = sin(aAngle);\n
         float c = cos(aAngle);\n
         vec2 p = vec2( c * aPos.x - s * aPos.y, s * aPos.x + c * aPos.y );\n
         vec2 px = p * aSizePx;\n
         vec2 ndcOfs = vec2(px.x * 2.0 / max(uViewSize.x,1.0), -px.y * 2.0 / max(uViewSize.y,1.0));\n
         vec2 ndc = aCenterNDC + ndcOfs;\n
         gl_Position = vec4(ndc, 0.0, 1.0);\n
         vec2 uvMin = aUVRect.xy;\n
         vec2 uvMax = aUVRect.zw;\n
         vUV = uvMin + aUV * (uvMax - uvMin);\n
         vA = aAlpha;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       uniform sampler2D uTex;\n
       uniform vec4 uTint;\n
       in vec2 vUV;\n
       in float vA;\n
       out vec4 outColor;\n
       void main(){\n
         vec4 texel = texture(uTex, vUV);\n
         float a = texel.a * uTint.a * vA;\n
         if (a <= 0.003) discard;\n
         outColor = vec4(texel.rgb * uTint.rgb, a);\n
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
    // Per-instance buffer: centerNDC (vec2), sizePx (float), uvRect (vec4), alpha (float)
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
    // aUVRect @ loc 4
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, this.instanceStrideFloats * 4, 4 * 4);
    gl.vertexAttribDivisor(5, 1);
    // aAlpha @ loc 6
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, this.instanceStrideFloats * 4, 8 * 4);
    gl.vertexAttribDivisor(6, 1);
    gl.bindVertexArray(null);
  }

  private configureGL() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

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
    this.textureReady = false;
  }

  private ensureAtlasForKeys(keys: string[]): void {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lastAtlasBuildMs < 200) return; // throttle rapid rebuilds in bursty spawns
    try {
      const AL: any = (window as any).AssetLoader;
      const game: any = (window as any).__gameInstance;
      const loader = game?.assetLoader || (AL ? new AL() : null);
      if (!loader) return;
      // Gather unique keys that we have images for
      const unique: string[] = [];
      for (let i=0;i<keys.length;i++) {
        const k = keys[i] || 'bullet_cyan';
        if (!unique.includes(k)) unique.push(k);
      }
      // Check if all unique keys already present
      let needsBuild = false;
      for (let i=0;i<unique.length;i++) if (!this.atlasMap[unique[i]]) { needsBuild = true; break; }
      if (!needsBuild && this.textureReady) return;
      // Build a simple row-packed atlas with padding
      const items: Array<{ key:string; img: HTMLImageElement; w:number; h:number }> = [];
      for (let i=0;i<unique.length;i++) {
        const key = unique[i];
        // BulletManager stores projectileImageKey as manifest key like 'bullet_cyan'
        const path = loader.getAsset ? loader.getAsset(key.includes('.')?key:(`projectiles.${key}`)) : '';
        const normPath = path || (AL?.normalizePath ? AL.normalizePath(`/assets/projectiles/${key}.png`) : `/assets/projectiles/${key}.png`);
        const img: HTMLImageElement | undefined = loader.getImage?.(normPath) || loader.getImage?.(key);
        if (img && img.width && img.height) {
          items.push({ key, img, w: img.width, h: img.height });
        } else {
          const last = this.warnedMissing[key] || 0;
          const nowMs = (typeof performance!=='undefined'?performance.now():Date.now());
          if (nowMs - last > 5000) {
            Logger.warn(`GL bullets: missing image for key '${key}' (path='${normPath}')`);
            this.warnedMissing[key] = nowMs;
          }
        }
      }
      if (!items.length) return;
      // Sort by width desc for better packing
      items.sort((a,b)=> (b.w*b.h) - (a.w*a.h));
      const pad = 2;
      // Estimate atlas size
      let totalW = 0, maxH = 0;
      for (const it of items) { totalW += it.w + pad*2; maxH = Math.max(maxH, it.h + pad*2); }
      const pow2 = (n:number)=>{ let p=1; while(p<n) p<<=1; return p; };
      const atlasW = pow2(Math.max(64, totalW));
      const atlasH = pow2(Math.max(64, maxH));
      const cv = document.createElement('canvas');
      cv.width = atlasW; cv.height = atlasH;
      const c2d = cv.getContext('2d'); if (!c2d) return;
      c2d.clearRect(0,0,atlasW,atlasH);
      const map: Record<string, { u0:number; v0:number; u1:number; v1:number }> = {};
      let x = 0;
      for (const it of items) {
        if (x + it.w + pad*2 > atlasW) break; // simplistic single-row; should be enough for small set
        const drawX = x + pad, drawY = pad + Math.floor((atlasH - it.h) * 0.5);
        c2d.drawImage(it.img, drawX, drawY, it.w, it.h);
        const u0 = drawX / atlasW, v0 = drawY / atlasH;
        const u1 = (drawX + it.w) / atlasW, v1 = (drawY + it.h) / atlasH;
        map[it.key] = { u0, v0, u1, v1 };
        x += it.w + pad*2;
      }
      const gl = this.gl;
      const tex = this.texture || gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // Canvas source is premultiplied; do not premultiply again.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      this.texture = tex;
      this.atlasMap = map;
      this.textureReady = true;
      this.atlasDirty = false;
      this.lastAtlasBuildMs = now;
      (window as any).__glBulletsAtlasInfo = { width: atlasW, height: atlasH, entries: Object.keys(map).length };
    } catch { /* ignore */ }
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

  /** Render supported bullets (sprite-based) into offscreen GL canvas. */
  public render(
    bullets: Array<any>,
    camX: number,
    camY: number,
    designW: number,
    designH: number,
    pixelW: number,
    pixelH: number
  ) {
    this.setSize(pixelW, pixelH);
    const gl = this.gl;
    // Collect keys we might need this frame
    const keysNeeded: string[] = [];
    for (let i=0;i<bullets.length;i++){
      const b:any = bullets[i];
      if (!b || !b.active) continue;
      if (b.isOrbiting || b.isMeleeSweep) continue; // bespoke visuals
      const vis:any = b.projectileVisual || {};
      const vt = vis.type || 'bullet';
      if (vt !== 'bullet') continue; // skip lasers/plasma/droplet, etc.
      const key = b.projectileImageKey || 'bullet_cyan';
      keysNeeded.push(key);
    }
    if (keysNeeded.length) this.ensureAtlasForKeys(keysNeeded);
    if (!this.textureReady) { gl.viewport(0,0,this.canvas.width,this.canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    // Prepare instances
    this.ensureCapacity(bullets.length);
    const inst = this.instanceData as Float32Array;
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    let count = 0;
    for (let i=0;i<bullets.length;i++){
      const b:any = bullets[i];
      if (!b || !b.active) continue;
      if (b.isOrbiting || b.isMeleeSweep) continue;
      const vis:any = b.projectileVisual || {};
      const vt = vis.type || 'bullet';
      if (vt !== 'bullet') continue;
      const sx = b.x - camX; const sy = b.y - camY;
      if (sx < -64 || sy < -64 || sx > designW + 64 || sy > designH + 64) continue;
      const key = b.projectileImageKey || 'bullet_cyan';
      const rect = this.atlasMap[key];
      if (!rect) continue; // not in atlas yet
      const xNdc = sx / designW * 2 - 1;
      const yNdc = (sy / designH * 2 - 1) * -1.0;
      const sizeDesign = (vis.size != null ? vis.size : (b.radius || 6)) * 2; // 2D draws diameter from radius
      const sizePx = Math.max(2, sizeDesign * (0.5 * (scaleX + scaleY)));
      // Compute orientation angle like 2D path: prefer velocity; fallback to displayAngle/orbitAngle
      let ang = Math.atan2(b.vy || 0, b.vx || 0);
      if ((!b.vx && !b.vy)) {
        if (b.isOrbiting && (b.orbitAngle != null)) ang = b.orbitAngle;
        if ((b as any).displayAngle != null) ang = (b as any).displayAngle;
      }
      if (typeof vis.rotationOffset === 'number') ang += vis.rotationOffset;
      const alpha = 1.0; // future: per-bullet fade
      const idx = count * this.instanceStrideFloats;
      inst[idx+0] = xNdc;
      inst[idx+1] = yNdc;
      inst[idx+2] = sizePx;
      inst[idx+3] = ang;
      inst[idx+4] = rect.u0; inst[idx+5] = rect.v0; inst[idx+6] = rect.u1; inst[idx+7] = rect.v1;
      inst[idx+8] = alpha;
      count++;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;
    gl.useProgram(this.program);
    if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
    if (this.uTint) gl.uniform4f(this.uTint, 1,1,1,1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.uSampler) gl.uniform1i(this.uSampler, 0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, count * this.instanceStrideFloats));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
    (window as any).__glBulletsLastCount = count;
  }
}

export function createGLBulletRendererLike(mainCanvas: HTMLCanvasElement): GLBulletRenderer | null {
  try {
    const w = Math.max(1, mainCanvas.width);
    const h = Math.max(1, mainCanvas.height);
    const r = new GLBulletRenderer(w, h);
    return r;
  } catch {
    return null;
  }
}
