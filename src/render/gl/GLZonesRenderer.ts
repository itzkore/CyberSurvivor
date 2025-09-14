/**
 * WebGL2 instanced filled AoE zones renderer (soft disks with normal blending).
 *
 * - Inputs are world-space (design pixels). Renderer converts to NDC and pixel sizes.
 * - Outputs premultiplied alpha colors; composited with blend ONE, ONE_MINUS_SRC_ALPHA.
 */
export interface GLZoneInstance {
  x: number; // world/design x
  y: number; // world/design y
  radius: number; // radius in design pixels
  r: number; g: number; b: number; a: number; // straight alpha (0..1)
}

export class GLZonesRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private instanceData: Float32Array | null = null;
  private capacity = 0;
  private uViewSize: WebGLUniformLocation | null = null;

  // Instance layout: originNDC.xy (2), radiusPx (1), color.rgba (4) => 7 floats
  private readonly strideFloats = 7;

  constructor(width: number, height: number){
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es\n
       layout(location=0) in vec2 aPos;         // unit quad [-1..1]\n
       layout(location=2) in vec2 aOriginNDC;   // center in NDC\n
       layout(location=3) in float aRadiusPx;   // radius in pixels\n
       layout(location=4) in vec4 aColor;       // base color (straight alpha)\n
       uniform vec2 uViewSize;                  // framebuffer size in pixels\n
       out vec2 vLocalPx;\n
       out float vRadiusPx;\n
       out vec4 vColor;\n
       void main(){\n
         float px = aPos.x * aRadiusPx;\n
         float py = aPos.y * aRadiusPx;\n
         float ndcX = (px * 2.0) / max(uViewSize.x, 1.0);\n
         float ndcY = -(py * 2.0) / max(uViewSize.y, 1.0);\n
         gl_Position = vec4(aOriginNDC + vec2(ndcX, ndcY), 0.0, 1.0);\n
         vLocalPx = vec2(px, py);\n
         vRadiusPx = aRadiusPx;\n
         vColor = aColor;\n
       }`,
      `#version 300 es\n
       precision mediump float;\n
       in vec2 vLocalPx;\n
       in float vRadiusPx;\n
       in vec4 vColor;\n
       out vec4 outColor;\n
       void main(){\n
         float d = length(vLocalPx) / max(vRadiusPx, 1.0); // 0 at center -> 1 at edge\n
         // Soft edge to reduce aliasing, mostly solid interior.\n
         float edge = smoothstep(1.0, 0.92, d); // 1 inside, falls to 0 near rim\n
         float a = vColor.a * edge;\n
         if (a <= 0.001) discard;\n
         // Premultiplied output for proper compositing with ONE, ONE_MINUS_SRC_ALPHA\n
         outColor = vec4(vColor.rgb * a, a);\n
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

  private lookupUniforms(){
    this.uViewSize = this.gl.getUniformLocation(this.program, 'uViewSize');
  }

  private initVAO(){
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // Unit quad covering [-1..1] square
    this.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 2*4, 0);

    // Instance buffer
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = this.strideFloats * 4;
    let ofs = 0;
    // aOriginNDC @ loc 2
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(2, 1); ofs += 2*4;
    // aRadiusPx @ loc 3
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(3, 1); ofs += 1*4;
    // aColor @ loc 4
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, ofs); gl.vertexAttribDivisor(4, 1); ofs += 4*4;
    gl.bindVertexArray(null);
  }

  private configureGL(){
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Normal premultiplied alpha blending for filled translucent disks
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,0);
  }

  public setSize(pixelW: number, pixelH: number){
    const w = Math.max(1, Math.floor(pixelW));
    const h = Math.max(1, Math.floor(pixelH));
    if (this.canvas.width !== w || this.canvas.height !== h){
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  private ensureCapacity(count: number){
    if (count <= this.capacity) return;
    this.capacity = Math.ceil(count * 1.5);
    this.instanceData = new Float32Array(this.capacity * this.strideFloats);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instanceData.byteLength, this.gl.DYNAMIC_DRAW);
  }

  public render(
    zones: GLZoneInstance[],
    camX: number,
    camY: number,
    designW: number,
    designH: number,
    pixelW: number,
    pixelH: number
  ){
    this.setSize(pixelW, pixelH);
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!zones || zones.length === 0) return;
    this.ensureCapacity(zones.length);
    const inst = this.instanceData as Float32Array;
    const scaleX = pixelW / Math.max(1, designW);
    const scaleY = pixelH / Math.max(1, designH);
    let count = 0;
    for (let i = 0; i < zones.length; i++){
      const z = zones[i]; if (!z) continue;
      const sx = (z.x - camX);
      const sy = (z.y - camY);
      const xNdc = (sx / designW) * 2 - 1;
      const yNdc = ((sy / designH) * 2 - 1) * -1.0;
      const radiusPx = Math.max(1, z.radius * Math.min(scaleX, scaleY));
      const idx = count * this.strideFloats;
      inst[idx + 0] = xNdc;
      inst[idx + 1] = yNdc;
      inst[idx + 2] = radiusPx;
      inst[idx + 3] = Math.max(0, Math.min(1, z.r));
      inst[idx + 4] = Math.max(0, Math.min(1, z.g));
      inst[idx + 5] = Math.max(0, Math.min(1, z.b));
      inst[idx + 6] = Math.max(0, Math.min(1, z.a));
      count++;
    }
    gl.useProgram(this.program);
    if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, (this.instanceData as Float32Array).subarray(0, count * this.strideFloats));
    // Normal premultiplied blending
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    gl.bindVertexArray(null);
  }
}

export function createGLZonesRendererLike(mainCanvas: HTMLCanvasElement): GLZonesRenderer | null {
  try {
    return new GLZonesRenderer(Math.max(1, mainCanvas.width), Math.max(1, mainCanvas.height));
  } catch {
    return null;
  }
}
