/**
 * Minimal WebGL2 bullet renderer that draws bullets as antialiased circles using GL_POINTS.
 * Designed to be composited into the main 2D canvas at the bullets layer.
 *
 * Notes:
 * - This is an MVP: visuals are simple circles with a soft edge; weapon-specific sprites/trails aren't handled yet.
 * - The renderer targets an offscreen canvas sized to the main canvas backing store (DPR * renderScale * CSS size).
 * - Game.render() draws this canvas into the 2D context to preserve layering order without refactoring multiple canvases.
 */
/**
 * WebGL2 bullets renderer (MVP): draws bullets as antialiased circles using GL_POINTS into an offscreen canvas.
 *
 * Design goals:
 * - Zero DOM changes: composited into existing 2D pipeline in the bullets layer.
 * - Keep CPU path intact as fallback; skip special bullets (orbit/melee sweep) that have bespoke visuals.
 * - Minimize allocations: reuse a preallocated instance buffer and GPU buffer; grow in chunks when required.
 */
export class GLBulletRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private instancesCapacity = 0;
  private uViewSize: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private lastPixelW = 0;
  private lastPixelH = 0;
  private maxPointSize = 256; // hardware cap, queried at init

  // Instance layout: [x_ndc, y_ndc, radius_pixels]
  private instanceStrideFloats = 3;
  private instanceData: Float32Array | null = null; // CPU-side staging buffer

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es\n
       layout(location=0) in vec3 aInst; // x_ndc, y_ndc, radius_px\n
       uniform vec2 uViewSize; // framebuffer pixel size (w,h)
       // gl_PointSize is in pixels; we take radius_px * 2\n
       void main() {\n
         gl_Position = vec4(aInst.x, aInst.y, 0.0, 1.0);\n
         float diameter = max(1.0, aInst.z * 2.0);\n
         // Additional clamp happens on CPU using queried ALIASED_POINT_SIZE_RANGE; this is a safety cap.\n
         gl_PointSize = min(diameter, 256.0);\n
       }` ,
      `#version 300 es\n
       precision mediump float;\n
       out vec4 outColor;\n
       uniform vec4 uColor;\n
       void main() {\n
         // Circle mask inside point sprite using gl_PointCoord (0..1), with soft edge\n
         vec2 uv = gl_PointCoord * 2.0 - 1.0;\n
         float r2 = dot(uv, uv);\n
         float edge = smoothstep(1.0, 0.80, r2);\n
         // Soft inner falloff for a subtle glow core\n
         float glow = smoothstep(0.0, 0.7, 1.0 - r2);\n
         vec4 col = uColor;\n
         col.a *= edge;\n
         // Slight boost toward center\n
         col.rgb = mix(col.rgb * 0.6, col.rgb, glow);\n
         if (col.a <= 0.01) discard;\n
         outColor = col;\n
       }`
    );
    this.lookupUniforms();
    this.initVAO();
    this.configureGL();
    this.queryCaps();
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
    this.uColor = this.gl.getUniformLocation(this.program, 'uColor');
  }

  private initVAO() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // Instance buffer: vec3 per instance
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    // layout(location=0) vec3 aInst
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, this.instanceStrideFloats * 4, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
  }

  private configureGL() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Premultiplied alpha friendly blending (consistent with Canvas compositing)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  /**
   * Query implementation caps relevant to this renderer (point size range) and cache them.
   * We’ll clamp requested point sizes to maxPointSize to avoid undefined behavior on some drivers.
   */
  private queryCaps() {
    try {
      const gl = this.gl as any;
      const range = this.gl.getParameter(this.gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[] | null;
      if (range && (range as any).length >= 2) {
        const max = Number((range as any)[1]);
        if (Number.isFinite(max) && max > 0) this.maxPointSize = Math.min(512, Math.max(32, Math.floor(max)));
      }
    } catch { /* ignore */ }
  }

  /** Ensure CPU/GPU buffers can hold at least 'count' instances; grows by ~1.5x. */
  private ensureCapacity(count: number) {
    if (count <= this.instancesCapacity) return;
    this.instancesCapacity = Math.ceil(count * 1.5);
    // CPU-side buffer
    this.instanceData = new Float32Array(this.instancesCapacity * this.instanceStrideFloats);
    // GPU-side buffer: allocate (or reallocate) to full capacity; we'll use bufferSubData for partial updates.
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
  }

  /**
   * Resize the internal framebuffer to match the 2D canvas backing store.
   * Call on window resize or when render scale/DPR changes.
   */
  public setSize(pixelW: number, pixelH: number) {
    const w = Math.max(1, Math.floor(pixelW));
    const h = Math.max(1, Math.floor(pixelH));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      this.lastPixelW = w; this.lastPixelH = h;
    }
  }

  /**
   * Render bullets into the internal WebGL canvas.
   * @param bullets Array of bullet-like objects with x,y,radius,active
   * @param camX Camera X (world)
   * @param camY Camera Y (world)
   * @param designW Logical (CSS) width used by the 2D renderer
   * @param designH Logical (CSS) height used by the 2D renderer
   * @param pixelW Backing pixel width of the main canvas (DPR * renderScale * CSS width)
   * @param pixelH Backing pixel height of the main canvas
   */
  /**
   * Render bullets into the internal WebGL canvas.
   * Bullets are expected to be plain objects that at least expose: x, y, radius, active and optionally flags isOrbiting/isMeleeSweep.
   */
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
    // In worst case most bullets are drawable; reserve accordingly.
    this.ensureCapacity(bullets.length);
    // Prepare instance data (ndc coords + radius in pixels)
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    const inst = this.instanceData as Float32Array;
    let count = 0;
    for (let i = 0; i < bullets.length; i++) {
      const b: any = bullets[i];
      if (!b || !b.active) continue;
      // Skip orbiting/melee sweep bullets for now; they have dedicated 2D visuals
      if (b.isOrbiting || b.isMeleeSweep) continue;
      const sx = (b.x - camX);
      const sy = (b.y - camY);
      // Cull off-screen (design space)
      if (sx < -64 || sy < -64 || sx > designW + 64 || sy > designH + 64) continue;
      const xNdc = sx / designW * 2 - 1;
      const yNdc = (sy / designH * 2 - 1) * -1.0;
      let rPx = Math.max(1, (b.radius || 4) * (0.5 * (scaleX + scaleY))); // average scale
      // Guard against driver point size caps. gl_PointSize is diameter in pixels; clamp radius accordingly.
      const maxRadiusPx = this.maxPointSize * 0.5;
      if (rPx * 2 > this.maxPointSize) rPx = maxRadiusPx;
      const idx = count * this.instanceStrideFloats;
      inst[idx + 0] = xNdc;
      inst[idx + 1] = yNdc;
      inst[idx + 2] = rPx;
      count++;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return; // nothing to draw
    gl.useProgram(this.program);
    if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
    // Default soft-cyan bullet color; alpha tuned to blend well over environment
    if (this.uColor) gl.uniform4f(this.uColor, 0.6, 0.95, 1.0, 0.85);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    // Update only the used portion; avoid reallocating the GPU buffer every frame
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, count * this.instanceStrideFloats));
    gl.drawArraysInstanced(gl.POINTS, 0, 1, count);
    gl.bindVertexArray(null);
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
