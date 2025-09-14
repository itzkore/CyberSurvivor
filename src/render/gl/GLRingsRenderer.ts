/**
 * WebGL2 instanced rings renderer: draws many annular bands (shockwaves, rings) into an offscreen canvas.
 *
 * Design-space inputs (center x/y in world, radii in design pixels); renderer converts to pixel space.
 * Supports two blend modes by batching: normal premultiplied and additive (for bright shockwaves).
 */
export interface GLRingInstance {
  // World/design-space center (will be converted to screen space using cam)
  x: number;
  y: number;
  // Radii in design pixels
  innerR: number;
  outerR: number;
  // Premultiplied-friendly RGBA color (0..1)
  r: number;
  g: number;
  b: number;
  a: number;
  // If true, draw in additive blend pass
  additive?: boolean;
}

export class GLRingsRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private instanceData: Float32Array | null = null;
  private capacity = 0;
  private uViewSize: WebGLUniformLocation | null = null;

  // Instance layout (floats): centerNDC.xy, sizePx, innerPx, outerPx, featherPx, color.rgba -> 1+1+1+1+1 + 4 + 2 = 11 floats
  private strideFloats = 11;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es\n
       layout(location=0) in vec2 aPos;         // unit quad [-0.5..0.5]\n
       layout(location=2) in vec2 aCenterNDC;   // center in NDC\n
       layout(location=3) in float aSizePx;     // quad size in pixels (diameter = outerR*2)\n
       layout(location=4) in float aInnerPx;    // inner radius in px\n
       layout(location=5) in float aOuterPx;    // outer radius in px\n
       layout(location=6) in float aFeatherPx;  // feather width in px\n
       layout(location=7) in vec4 aColor;       // instance color (premultiplied-friendly)\n
       uniform vec2 uViewSize;                  // framebuffer size in pixels\n
       out vec2 vLocalPx;\n
       out float vInnerPx;\n
       out float vOuterPx;\n
       out float vFeatherPx;\n
       out vec4 vColor;\n
       void main(){\n
         // Scale quad to pixels and convert to NDC at the given center.\n
         vec2 px = aPos * aSizePx;\n
         vec2 ndcOfs = vec2(px.x * 2.0 / max(uViewSize.x, 1.0), -px.y * 2.0 / max(uViewSize.y, 1.0));\n
         vec2 ndc = aCenterNDC + ndcOfs;\n
         gl_Position = vec4(ndc, 0.0, 1.0);\n
         // Pass local pixel-space coordinate so fragment can compute radial distance.\n
         vLocalPx = px;\n
         vInnerPx = aInnerPx;\n
         vOuterPx = aOuterPx;\n
         vFeatherPx = aFeatherPx;\n
         vColor = aColor;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       in vec2 vLocalPx;\n
       in float vInnerPx;\n
       in float vOuterPx;\n
       in float vFeatherPx;\n
       in vec4 vColor;\n
       out vec4 outColor;\n
       void main(){\n
         float r = length(vLocalPx);\n
         // Smooth ring alpha: fade near inner and outer edges with feather.\n
         float aInner = smoothstep(vInnerPx - vFeatherPx, vInnerPx, r);\n
         float aOuter = 1.0 - smoothstep(vOuterPx - vFeatherPx, vOuterPx, r);\n
         float mask = clamp(aInner * aOuter, 0.0, 1.0);\n
         float alpha = vColor.a * mask;\n
         if (alpha <= 0.002) discard;\n
         // Output premultiplied color: rgb scaled by resulting alpha (straight->premult conversion)\n
         outColor = vec4(vColor.rgb * alpha, alpha);\n
       }`
    );
    this.lookupUniforms();
    this.initVAO();
    this.configureGL();
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
  }

  private initVAO() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // Per-vertex quad
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    const quad = new Float32Array([
      -0.5, -0.5,
       0.5, -0.5,
      -0.5,  0.5,
       0.5,  0.5,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    // aPos @ loc 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2 * 4, 0);
    // Instance buffer
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = this.strideFloats * 4;
    // aCenterNDC @ loc 2
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(2, 1);
    // aSizePx @ loc 3
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 2 * 4); gl.vertexAttribDivisor(3, 1);
    // aInnerPx @ loc 4
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 3 * 4); gl.vertexAttribDivisor(4, 1);
    // aOuterPx @ loc 5
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 4 * 4); gl.vertexAttribDivisor(5, 1);
    // aFeatherPx @ loc 6
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, 5 * 4); gl.vertexAttribDivisor(6, 1);
    // aColor @ loc 7
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 4, gl.FLOAT, false, stride, 6 * 4); gl.vertexAttribDivisor(7, 1);
    gl.bindVertexArray(null);
  }

  private configureGL() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  public setSize(pixelW: number, pixelH: number) {
    const w = Math.max(1, Math.floor(pixelW));
    const h = Math.max(1, Math.floor(pixelH));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  private ensureCapacity(count: number) {
    if (count <= this.capacity) return;
    this.capacity = Math.ceil(count * 1.5);
    this.instanceData = new Float32Array(this.capacity * this.strideFloats);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
  }

  /**
   * Draw rings with two passes: additive and normal, to match ExplosionManager visual intent.
   */
  public render(
    rings: GLRingInstance[],
    camX: number,
    camY: number,
    designW: number,
    designH: number,
    pixelW: number,
    pixelH: number
  ) {
    this.setSize(pixelW, pixelH);
    const gl = this.gl;
    if (!rings || rings.length === 0) { gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    const avgScale = 0.5 * (scaleX + scaleY);
    // Split into additive and normal batches
    const add: GLRingInstance[] = [];
    const norm: GLRingInstance[] = [];
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r) continue;
      (r.additive ? add : norm).push(r);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Helper to draw a batch
    const drawBatch = (batch: GLRingInstance[], additiveBlend: boolean) => {
      if (!batch.length) return;
      this.ensureCapacity(batch.length);
      const inst = this.instanceData as Float32Array;
      let count = 0;
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i];
        const sx = (b.x - camX);
        const sy = (b.y - camY);
        // Convert to NDC from design space
        const xNdc = (sx / designW) * 2 - 1;
        const yNdc = ((sy / designH) * 2 - 1) * -1.0;
        const sizePx = Math.max(2, (b.outerR * 2) * avgScale);
        const innerPx = Math.max(0, b.innerR * avgScale);
        const outerPx = Math.max(innerPx + 1e-3, b.outerR * avgScale);
        const featherPx = Math.max(0.5, Math.min(12, (outerPx - innerPx) * 0.6));
        const idx = count * this.strideFloats;
        inst[idx + 0] = xNdc; // aCenterNDC.x
        inst[idx + 1] = yNdc; // aCenterNDC.y
        inst[idx + 2] = sizePx; // aSizePx
        inst[idx + 3] = innerPx; // aInnerPx
        inst[idx + 4] = outerPx; // aOuterPx
        inst[idx + 5] = featherPx; // aFeatherPx
        inst[idx + 6] = b.r; // aColor.r
        inst[idx + 7] = b.g; // aColor.g
        inst[idx + 8] = b.b; // aColor.b
        inst[idx + 9] = b.a; // aColor.a
        inst[idx + 10] = 0; // padding (unused)
        count++;
      }
      gl.useProgram(this.program);
      if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, count * this.strideFloats));
      if (additiveBlend) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    };
    // Draw additive first, then normal; order is not critical for blending here
    drawBatch(add, true);
    drawBatch(norm, false);
  }
}

export function createGLRingsRendererLike(mainCanvas: HTMLCanvasElement): GLRingsRenderer | null {
  try {
    const w = Math.max(1, mainCanvas.width);
    const h = Math.max(1, mainCanvas.height);
    return new GLRingsRenderer(w, h);
  } catch {
    return null;
  }
}
