/**
 * WebGL2 particles renderer. Renders circular sprites via gl.POINTS with a soft mask in the fragment shader.
 *
 * Blending: Premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA). The fragment shader multiplies rgb by alpha.
 * Sizing: Point size is defined in pixels (diameter), clamped to the device's ALIASED_POINT_SIZE_RANGE.
 *
 * Expected instance input (per particle):
 * - aInst: vec3 = [x_ndc, y_ndc, radius_px]
 * - aColor: vec4 = [r,g,b,a] in non-premultiplied space
 *
 * The renderer writes into an offscreen <canvas> with transparent background for later 2D composition.
 */
export class GLParticlesRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private instancesCapacity = 0;
  private lastPixelW = 0;
  private lastPixelH = 0;
  private maxPointSize = 256;
  private uMaxPointSizeLoc: WebGLUniformLocation | null = null;

  // Instance layout: [x_ndc, y_ndc, radius_px, r, g, b, a]
  private instanceStrideFloats = 7;
  private instanceData: Float32Array | null = null; // CPU staging buffer

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
       layout(location=1) in vec4 aColor; // rgba (non-premultiplied)\n
       out vec4 vColor;\n
       uniform float uMaxPointSize;\n
       void main(){\n
         gl_Position = vec4(aInst.x, aInst.y, 0.0, 1.0);\n
         float diameter = max(1.0, aInst.z * 2.0);\n
         // Hardware may clamp further, but cap to queried max to avoid undefined behavior\n
         gl_PointSize = min(diameter, uMaxPointSize);\n
         vColor = aColor;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       in vec4 vColor;\n
       out vec4 outColor;\n
       void main(){\n
         // Make a soft circular sprite inside the point\n
         vec2 uv = gl_PointCoord * 2.0 - 1.0;\n
         float r2 = dot(uv, uv);\n
         // Edge ramps from 0 at edge (r2=1) to 1 at center (r2=0)\n
         float edge = smoothstep(1.0, 0.80, 1.0 - r2);\n
         float a = vColor.a * edge;\n
         // Premultiply color by alpha for correct ONE, ONE_MINUS_SRC_ALPHA blending\n
         outColor = vec4(vColor.rgb * a, a);\n
         if (outColor.a <= 0.01) discard;\n
       }`
    );
    this.initVAO();
    this.configureGL();
    this.queryCaps();
    // Cache uniform locations after program link
    this.uMaxPointSizeLoc = this.gl.getUniformLocation(this.program, 'uMaxPointSize');
    // Initialize viewport and state
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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

  private initVAO() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    // aInst at loc 0: vec3
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, this.instanceStrideFloats * 4, 0);
    gl.vertexAttribDivisor(0, 1);
    // aColor at loc 1: vec4
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, this.instanceStrideFloats * 4, 3 * 4);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  private configureGL() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  private queryCaps() {
    try {
      const range = this.gl.getParameter(this.gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | number[] | null;
      if (range && (range as any).length >= 2) {
        const max = Number((range as any)[1]);
        if (Number.isFinite(max) && max > 0) this.maxPointSize = Math.min(512, Math.max(32, Math.floor(max)));
      }
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
      this.lastPixelW = w; this.lastPixelH = h;
    }
  }

  /**
   * Render active particles.
   * Accepts any array of objects exposing at least: x, y, size, color, life, active.
   *
   * Inputs contract:
   * - particles: array-like of { x:number, y:number, size:number, color:string, life:number(ms), active:boolean }
   * - camX, camY: top-left world camera in design units
   * - designW, designH: render-logic viewport size in design units
   * - pixelW, pixelH: backing store size in device pixels for this offscreen canvas
   *
   * Notes:
   * - Performs simple screen-space culling and optional stride (vfxLow) to reduce work on slow frames.
   * - Alpha curve matches 2D fallback: alpha = max(0.05, life/500).
   */
  public render(
    particles: Array<any>,
    camX: number,
    camY: number,
    designW: number,
    designH: number,
    pixelW: number,
    pixelH: number
  ) {
    this.setSize(pixelW, pixelH);
    const gl = this.gl;
    const avgMs = (window as any).__avgFrameMs || 16;
    const vfxLow = (avgMs > 28) || !!(window as any).__vfxLowMode;
    const step = vfxLow ? 2 : 1;

    // Prepare capacity (rough upper bound)
    const est = Math.ceil(particles.length / step);
    this.ensureCapacity(est);
    const inst = this.instanceData as Float32Array;
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);

    // Screen-space culling bounds in design units (with small padding)
    const minX = camX - 64, maxX = camX + designW + 64;
    const minY = camY - 64, maxY = camY + designH + 64;

    let count = 0;
    for (let i = 0; i < particles.length; i += step) {
      const p: any = particles[i];
      if (!p || !p.active) continue;
      const px = p.x, py = p.y;
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      const sx = (px - camX);
      const sy = (py - camY);
      const xNdc = sx / designW * 2 - 1;
      const yNdc = (sy / designH * 2 - 1) * -1.0;
      let rPx = Math.max(1, (p.size || 2) * (0.5 * (scaleX + scaleY)));
      // Clamp radius to hardware max (gl_PointSize is diameter)
      const maxRadiusPx = this.maxPointSize * 0.5;
      if (rPx > maxRadiusPx) rPx = maxRadiusPx;
      // Alpha from life (match 2D path): clamp floor 0.05, life normalized by 500ms
      let a = Math.max(0.05, Math.min(1, (p.life || 0) / 500));
      // Parse color string lazily (cache by string)
      const [r, g, b] = this.parseColorCached(p.color || '#ffffff');
      const idx = count * this.instanceStrideFloats;
      inst[idx + 0] = xNdc;
      inst[idx + 1] = yNdc;
      inst[idx + 2] = rPx;
      inst[idx + 3] = r;
      inst[idx + 4] = g;
      inst[idx + 5] = b;
      inst[idx + 6] = a;
      count++;
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return; // nothing to draw this frame (cleared above)
    gl.useProgram(this.program);
    // Bind dynamic uniform(s)
    if (this.uMaxPointSizeLoc) gl.uniform1f(this.uMaxPointSizeLoc, this.maxPointSize);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, (this.instanceData as Float32Array).subarray(0, count * this.instanceStrideFloats));
    gl.drawArraysInstanced(gl.POINTS, 0, 1, count);
    gl.bindVertexArray(null);
  }

  private _colorCache: Map<string, [number, number, number]> = new Map();
  private parseColorCached(col: string): [number, number, number] {
    let got = this._colorCache.get(col);
    if (got) return got;
    let r = 1, g = 1, b = 1;
    // #rrggbb
    const mHex = /^#([0-9a-f]{6})$/i.exec(col);
    if (mHex) {
      const n = parseInt(mHex[1], 16);
      r = ((n >> 16) & 255) / 255;
      g = ((n >> 8) & 255) / 255;
      b = (n & 255) / 255;
    } else {
      // rgb/rgba(r,g,b[,a])
      const mR = /^rgba?\(([^)]+)\)$/i.exec(col);
      if (mR) {
        const p = mR[1].split(',').map(s => s.trim());
        r = (parseInt(p[0], 10) || 255) / 255;
        g = (parseInt(p[1], 10) || 255) / 255;
        b = (parseInt(p[2], 10) || 255) / 255;
      }
    }
    got = [r, g, b];
    this._colorCache.set(col, got);
    return got;
  }
}

export function createGLParticlesRendererLike(mainCanvas: HTMLCanvasElement): GLParticlesRenderer | null {
  try {
    const w = Math.max(1, mainCanvas.width);
    const h = Math.max(1, mainCanvas.height);
    return new GLParticlesRenderer(w, h);
  } catch {
    return null;
  }
}
