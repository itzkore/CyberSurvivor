/**
 * WebGL2 instanced beams renderer: draws linear beams (sniper, melter) with gradients into an offscreen canvas.
 *
 * Inputs are in world/design space; renderer converts to pixel space and handles premultiplied alpha compositing.
 * Supports additive and normal blending via batching.
 */
export interface GLBeamInstance {
  // World/design-space origin of the beam (start point)
  x: number;
  y: number;
  // Beam orientation (radians), length and total thickness (rim thickness)
  angle: number;
  length: number; // in design pixels
  thickness: number; // rim thickness in design pixels
  // Core thickness fraction (0..1) relative to thickness for melter-style beams; sniper uses single band
  coreFrac?: number; // default 0.5 for melter; ignored for sniper
  // Visual type and variant
  type: 0 | 1 | 2; // 0 = sniper, 1 = melter, 2 = railgun (distinct palette)
  variant?: number; // sniper: 0 default white, 1 void, 2 black_sun, 3 exec; melter: 0 default, 1 lava
  // Melter parameters
  hue?: number;     // 0..360 for rainbow melter
  heatT?: number;   // 0..1 for lava intensity
  visLen?: number;  // optional visible length clamp (melter)
  // Base color modulation (premult-friendly straight alpha values 0..1)
  r?: number; g?: number; b?: number; a?: number;
  // Additive pass flag
  additive?: boolean;
  // Per-beam fade 0..1
  fade?: number;
}

export class GLBeamsRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private instanceData: Float32Array | null = null;
  private capacity = 0;
  private uViewSize: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;

  // Instance layout (floats):
  // originNDC.xy, cos, sin, lenPx, thickPx, coreFrac, type, variant, hueDeg, heatT, visLenPx, rgba(4), fade, pad -> 2+1+1+1+1+1+1+1+1+1+1+4+1+1 = 17 floats
  private strideFloats = 17;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es\n
       layout(location=0) in vec2 aPos;         // unit quad [-0.5..0.5] (centered)\n
       layout(location=2) in vec2 aOriginNDC;   // origin in NDC\n
       layout(location=3) in float aCos;        // cos(angle)\n
       layout(location=4) in float aSin;        // sin(angle)\n
       layout(location=5) in float aLenPx;      // length in pixels\n
       layout(location=6) in float aThickPx;    // thickness in pixels (rim thickness)\n
       layout(location=7) in float aCoreFrac;   // core thickness / total thickness\n
       layout(location=8) in float aType;       // 0 sniper, 1 melter\n
       layout(location=9) in float aVariant;    // variant selector\n
       layout(location=10) in float aHueDeg;    // hue degrees for melter\n
       layout(location=11) in float aHeatT;     // 0..1 lava heat\n
       layout(location=12) in float aVisLenPx;  // visible length clamp\n
       layout(location=13) in vec4 aColor;      // base color (straight alpha)\n
       layout(location=14) in float aFade;      // fade 0..1\n
       uniform vec2 uViewSize;                  // framebuffer size in pixels\n
       uniform float uTime;                     // time in seconds\n
       out vec2 vUV;\n
       out float vHalfThickPx;\n
       out float vCoreHalfPx;\n
       out float vType;\n
       out float vVariant;\n
       out float vHueDeg;\n
       out float vHeatT;\n
       out float vLenPx;\n
       out float vVisLenPx;\n
       out vec4 vColor;\n
       out float vFade;\n
       void main(){\n
         float lenPx = max(1.0, aLenPx);\n
         float thickPx = max(1.0, aThickPx);\n
         // Position the quad so that its left edge sits at the origin and it extends along +X by lenPx.\n
         // aPos.x in [-0.5..0.5] -> local x in [0..lenPx], aPos.y maps across thickness.\n
         float localX = (aPos.x + 0.5) * lenPx;\n
         float localY = aPos.y * thickPx;\n
         // Rotate by angle and convert to NDC offset.\n
         float ndcX = (localX * aCos - localY * aSin) * 2.0 / max(uViewSize.x, 1.0);\n
         float ndcY = -(localX * aSin + localY * aCos) * 2.0 / max(uViewSize.y, 1.0);\n
         vec2 ndc = aOriginNDC + vec2(ndcX, ndcY);\n
         gl_Position = vec4(ndc, 0.0, 1.0);\n
         vUV = vec2(clamp(localX / max(lenPx, 1.0), 0.0, 1.0), clamp(localY / max(thickPx*0.5,1.0), -1.0, 1.0));\n
         vHalfThickPx = thickPx * 0.5;\n
         vCoreHalfPx = max(0.5, aCoreFrac * thickPx * 0.5);\n
         vType = aType; vVariant = aVariant; vHueDeg = aHueDeg; vHeatT = aHeatT; vLenPx = lenPx; vVisLenPx = max(1.0, aVisLenPx);\n
         vColor = aColor; vFade = aFade;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       in vec2 vUV;\n
       in float vHalfThickPx;\n
       in float vCoreHalfPx;\n
       in float vType;\n
       in float vVariant;\n
       in float vHueDeg;\n
       in float vHeatT;\n
       in float vLenPx;\n
       in float vVisLenPx;\n
       in vec4 vColor;\n
       in float vFade;\n
       out vec4 outColor;\n
       // Simple HSL to RGB for melter rainbow
       vec3 hsl2rgb(float h, float s, float l){
         float c = (1.0 - abs(2.0*l - 1.0)) * s;
         float hp = h / 60.0;
         float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
         vec3 rgb;
         if (hp < 1.0) rgb = vec3(c, x, 0);
         else if (hp < 2.0) rgb = vec3(x, c, 0);
         else if (hp < 3.0) rgb = vec3(0, c, x);
         else if (hp < 4.0) rgb = vec3(0, x, c);
         else if (hp < 5.0) rgb = vec3(x, 0, c);
         else rgb = vec3(c, 0, x);
         float m = l - 0.5*c;
         return rgb + vec3(m);
       }
       void main(){\n
         float u = clamp(vUV.x, 0.0, 1.0); // along length
         float vy = vUV.y;                 // across half thickness in [-1..1]
         float alpha = vColor.a * vFade;   // base alpha scaled by fade
         if (alpha <= 0.001) discard;      // early out

         vec3 col = vColor.rgb;           // will override based on type/variant
         float a = 0.0;
         if (vType < 0.5) {
           // Sniper: gradient band, bright core at origin fading to 0 at end
           // Variants set color palette
           vec3 c0; vec3 c1; vec3 rim; float addA0; float addA1; 
           if (vVariant > 2.5) { // exec: warm gold
             c0 = vec3(1.0, 0.96, 0.78); c1 = vec3(1.0, 0.84, 0.55); rim = vec3(1.0, 0.86, 0.47);
             addA0 = 0.95; addA1 = 0.28;
           } else if (vVariant > 1.5) { // black_sun: indigo
             c0 = vec3(0.62, 0.44, 1.0); c1 = vec3(0.29, 0.0, 0.51); rim = vec3(0.61, 0.47, 1.0); addA0 = 0.95; addA1 = 0.22;
           } else if (vVariant > 0.5) { // void
             c0 = vec3(0.73, 0.49, 1.0); c1 = vec3(0.42, 0.05, 0.68); rim = vec3(0.70, 0.40, 1.0); addA0 = 0.95; addA1 = 0.22;
           } else { // default white
             c0 = vec3(1.0, 1.0, 1.0); c1 = vec3(0.78, 0.94, 1.0); rim = vec3(0.88, 0.97, 1.0); addA0 = 0.95; addA1 = 0.28;
           }
           float t1 = smoothstep(0.0, 0.1, u);
           float t2 = smoothstep(0.1, 0.3, u);
           float tEnd = 1.0 - smoothstep(0.5, 1.0, u);
           vec3 grad = mix(c0, c1, t2);
           float band = 1.0 - smoothstep(0.9, 1.0, abs(vy)); // soft edges
           float gAlpha = mix(addA0, addA1, t2) * tEnd * band * alpha;
           col = grad; a = gAlpha;
         } else if (vType < 1.5) {
           // Melter: core and rim; rainbow or lava tint; fade at vis end
           float vis = clamp(vVisLenPx / max(vLenPx, 1.0), 0.0, 1.0);
           float tail = 1.0 - smoothstep(vis * 0.8, vis, u);
           float band = 1.0 - smoothstep(0.9, 1.0, abs(vy));
           float coreRegion = step(abs(vy), vCoreHalfPx / max(vHalfThickPx, 1.0));
           if (vVariant > 0.5) {
             // Lava palette: core amber-white, rim deep reds/oranges based on heatT
             float ht = clamp(vHeatT, 0.0, 1.0);
             vec3 coreCol = mix(vec3(1.0, 0.55, 0.2), vec3(1.0, 0.9, 0.7), 1.0 - ht*0.6);
             vec3 r0 = vec3(1.0, 0.47, 0.0);
             vec3 r1 = vec3(1.0, 0.15, 0.0);
             vec3 r2 = vec3(1.0, 0.1, 0.08);
             vec3 r3 = vec3(1.0, 0.7, 0.0);
             float g = smoothstep(0.0, 1.0, u);
             vec3 rimCol = mix(mix(r0, r1, g), mix(r2, r3, g), 0.5);
             col = mix(rimCol, coreCol, coreRegion);
             a = (0.45 * coreRegion + 0.30 * (1.0 - coreRegion)) * band * tail * alpha;
           } else {
             // Rainbow rim via HSL along length; core white
             float hue = mod(vHueDeg + u * 360.0, 360.0);
             vec3 rim = hsl2rgb(hue, 1.0, 0.6);
             vec3 coreCol = vec3(1.0);
             col = mix(rim, coreCol, coreRegion);
             a = (0.42 * coreRegion + 0.28 * (1.0 - coreRegion)) * band * tail * alpha;
             }
           } else {
             // Railgun: warm gold/orange band independent from sniper variants
             vec3 c0 = vec3(1.0, 0.94, 0.65);
             vec3 c1 = vec3(1.0, 0.82, 0.35);
             float t2 = smoothstep(0.08, 0.35, u);
             float tEnd = 1.0 - smoothstep(0.55, 1.0, u);
             vec3 grad = mix(c0, c1, t2);
             float band = 1.0 - smoothstep(0.88, 1.0, abs(vy));
             float gAlpha = mix(0.95, 0.30, t2) * tEnd * band * alpha;
             col = grad; a = gAlpha;
           }
         // Output premultiplied color
         outColor = vec4(col * a, a);
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
    this.uTime = this.gl.getUniformLocation(this.program, 'uTime');
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
    let ofs = 0;
    // aOriginNDC @ loc 2
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(2, 1); ofs += 2*4;
    // aCos @ loc 3
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(3, 1); ofs += 1*4;
    // aSin @ loc 4
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(4, 1); ofs += 1*4;
    // aLenPx @ loc 5
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(5, 1); ofs += 1*4;
    // aThickPx @ loc 6
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(6, 1); ofs += 1*4;
    // aCoreFrac @ loc 7
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(7, 1); ofs += 1*4;
    // aType @ loc 8
    gl.enableVertexAttribArray(8); gl.vertexAttribPointer(8, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(8, 1); ofs += 1*4;
    // aVariant @ loc 9
    gl.enableVertexAttribArray(9); gl.vertexAttribPointer(9, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(9, 1); ofs += 1*4;
    // aHueDeg @ loc 10
    gl.enableVertexAttribArray(10); gl.vertexAttribPointer(10, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(10, 1); ofs += 1*4;
    // aHeatT @ loc 11
    gl.enableVertexAttribArray(11); gl.vertexAttribPointer(11, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(11, 1); ofs += 1*4;
    // aVisLenPx @ loc 12
    gl.enableVertexAttribArray(12); gl.vertexAttribPointer(12, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(12, 1); ofs += 1*4;
    // aColor @ loc 13
    gl.enableVertexAttribArray(13); gl.vertexAttribPointer(13, 4, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(13, 1); ofs += 4*4;
    // aFade @ loc 14
    gl.enableVertexAttribArray(14); gl.vertexAttribPointer(14, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(14, 1); ofs += 1*4;
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
   * Render beams. Splits into additive and normal passes based on instance.additive.
   */
  public render(
    beams: GLBeamInstance[],
    camX: number,
    camY: number,
    designW: number,
    designH: number,
    pixelW: number,
    pixelH: number,
    timeSec: number
  ) {
    this.setSize(pixelW, pixelH);
    const gl = this.gl;
    if (!beams || beams.length === 0) { gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clear(gl.COLOR_BUFFER_BIT); return; }
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    const add: GLBeamInstance[] = [];
    const norm: GLBeamInstance[] = [];
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (!b) continue;
      (b.additive ? add : norm).push(b);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const drawBatch = (batch: GLBeamInstance[], additiveBlend: boolean) => {
      if (!batch.length) return;
      this.ensureCapacity(batch.length);
      const inst = this.instanceData as Float32Array;
      let count = 0;
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i];
        // Origin in screen space
        const sx = (b.x - camX);
        const sy = (b.y - camY);
        // Convert origin to NDC
        const xNdc = (sx / designW) * 2 - 1;
        const yNdc = ((sy / designH) * 2 - 1) * -1.0;
        const lenPx = Math.max(1, b.length * scaleX); // assume isotropic scaling
        const thickPx = Math.max(1, b.thickness * scaleY); // same scale for y
        const idx = count * this.strideFloats;
        inst[idx + 0] = xNdc; // aOriginNDC.x
        inst[idx + 1] = yNdc; // aOriginNDC.y
        const c = Math.cos(b.angle), s = Math.sin(b.angle);
        inst[idx + 2] = c; // aCos
        inst[idx + 3] = s; // aSin
        inst[idx + 4] = lenPx; // aLenPx
        inst[idx + 5] = thickPx; // aThickPx
        inst[idx + 6] = Math.max(0.0, Math.min(1.0, b.coreFrac ?? 0.5)); // aCoreFrac
        inst[idx + 7] = (b.type ?? 0) | 0; // aType
        inst[idx + 8] = (b.variant ?? 0) | 0; // aVariant
        inst[idx + 9] = (b.hue ?? 0); // aHueDeg
        inst[idx + 10] = Math.max(0, Math.min(1, b.heatT ?? 0)); // aHeatT
        inst[idx + 11] = Math.max(1, (b.visLen ?? b.length) * scaleX); // aVisLenPx
        inst[idx + 12] = Math.max(0, Math.min(1, b.r ?? 1)); // aColor.r
        inst[idx + 13] = Math.max(0, Math.min(1, b.g ?? 1)); // aColor.g
        inst[idx + 14] = Math.max(0, Math.min(1, b.b ?? 1)); // aColor.b
        inst[idx + 15] = Math.max(0, Math.min(1, b.a ?? 1)); // aColor.a
        inst[idx + 16] = Math.max(0, Math.min(1, b.fade ?? 1)); // aFade
        count++;
      }
      gl.useProgram(this.program);
      if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
      if (this.uTime) gl.uniform1f(this.uTime, timeSec);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, (this.instanceData as Float32Array).subarray(0, count * this.strideFloats));
      if (additiveBlend) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    };
    drawBatch(add, true);
    drawBatch(norm, false);
  }
}

export function createGLBeamsRendererLike(mainCanvas: HTMLCanvasElement): GLBeamsRenderer | null {
  try {
    const w = Math.max(1, mainCanvas.width);
    const h = Math.max(1, mainCanvas.height);
    return new GLBeamsRenderer(w, h);
  } catch {
    return null;
  }
}
