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
  private texture: WebGLTexture | null = null;
  private textureReady = false;
  private lastTextureAttemptMs = 0;

  // Instance layout: [centerX_ndc, centerY_ndc, size_px, angle_rad]
  private instanceStrideFloats = 4;
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
       uniform vec2 uViewSize; // framebuffer (pixelW, pixelH)\n
       out vec2 vUV;\n
       void main(){\n
         // Rotate the unit quad around origin\n
         float s = sin(aAngle);\n
         float c = cos(aAngle);\n
         vec2 p = vec2( c * aPos.x - s * aPos.y, s * aPos.x + c * aPos.y );\n
         // Scale to pixels\n
         vec2 px = p * aSizePx;\n
         // Convert pixel offset to NDC (y inverted)\n
         vec2 ndcOfs = vec2(px.x * 2.0 / max(uViewSize.x, 1.0), -px.y * 2.0 / max(uViewSize.y, 1.0));\n
         vec2 ndc = aCenterNDC + ndcOfs;\n
         gl_Position = vec4(ndc, 0.0, 1.0);\n
         vUV = aUV;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       uniform sampler2D uTex;\n
       uniform vec4 uTint; // premultiplied-friendly tint (rgb optional, a multiplies alpha)\n
       in vec2 vUV;\n
       out vec4 outColor;\n
       void main(){\n
         vec4 texel = texture(uTex, vUV);\n
         // Apply tint without breaking premult: scale rgb and alpha appropriately\n
         vec3 rgb = texel.rgb * uTint.rgb;\n
         float a = texel.a * uTint.a;\n
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
    // Per-instance buffer: centerNDC (vec2), sizePx (float), angle (float)
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
      // Resolve from manifest when possible, fallback to known path
      let path = '';
      try { path = loader.getAsset?.('enemies.default') || ''; } catch {}
      if (!path) path = AL.normalizePath('/assets/enemies/enemy_default.png');
      const img: HTMLImageElement | undefined = loader.getImage?.(path);
      if (!img || !img.width || !img.height) return; // try again later
      const gl = this.gl;
      const tex = this.texture || gl.createTexture();
      if (!tex) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
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
   * Render enemies into the internal WebGL canvas.
   * Enemies are expected to be objects with: x, y, radius, active, hp.
   */
  public render(
    enemies: Array<any>,
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
    // Try to swap in the enemy texture once assets are ready
    this.ensureEnemyTexture();
    const inst = this.instanceData as Float32Array;
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    let count = 0;
    const pad = 64;
    for (let i = 0; i < enemies.length; i++) {
      const e: any = enemies[i];
      if (!e || !e.active || e.hp <= 0) continue;
      const sx = e.x - camX; const sy = e.y - camY;
      if (sx < -pad || sy < -pad || sx > designW + pad || sy > designH + pad) continue;
      const xNdc = sx / designW * 2 - 1;
      const yNdc = (sy / designH * 2 - 1) * -1.0;
      // Average scale for pixel radius
      const rPx = Math.max(2, (e.radius || 20) * (0.5 * (scaleX + scaleY)));
      const sizePx = rPx * 2;
      const idx = count * this.instanceStrideFloats;
      inst[idx + 0] = xNdc;
      inst[idx + 1] = yNdc;
      inst[idx + 2] = sizePx;
      // Optional facing/rotation could be passed from enemy; default 0
      inst[idx + 3] = (e.angle || 0);
      count++;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
