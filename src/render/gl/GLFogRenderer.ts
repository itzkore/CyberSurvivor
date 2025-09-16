/**
 * WebGL2 full-screen Fog of War renderer.
 *
 * Draws a dark overlay with a circular reveal around a center, optional soft penumbra,
 * and an optional flashlight wedge cone. Outputs premultiplied alpha for correct compositing.
 */
export interface GLFogParams {
  // World/design-space camera and center
  camX: number;
  camY: number;
  centerX: number; // world x
  centerY: number; // world y
  designW: number;
  designH: number;
  pixelW: number; // target framebuffer width in physical pixels
  pixelH: number; // target framebuffer height in physical pixels
  radiusPx: number; // reveal radius in pixels
  darkRGB: [number, number, number]; // straight color (0..1)
  darkAlpha: number; // 0..1
  penScale?: number; // > 1 to enable penumbra
  penAlpha?: number; // 0..1
  wedge?: {
    enabled: boolean;
    dirX: number; // unit
    dirY: number; // unit
    halfAngleRad: number; // radians
    radius: number; // pixels
  };
}

export class GLFogRenderer {
  public readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null = null;
  private quadVBO: WebGLBuffer | null = null;

  // uniforms
  private uViewSize: WebGLUniformLocation | null = null;
  private uDarkColor: WebGLUniformLocation | null = null;
  private uDarkAlpha: WebGLUniformLocation | null = null;
  private uCenterPx: WebGLUniformLocation | null = null;
  private uRadiusPx: WebGLUniformLocation | null = null;
  private uPenScale: WebGLUniformLocation | null = null;
  private uPenAlpha: WebGLUniformLocation | null = null;
  private uWedgeEnabled: WebGLUniformLocation | null = null;
  private uWedgeDir: WebGLUniformLocation | null = null;
  private uWedgeCosHalf: WebGLUniformLocation | null = null;
  private uWedgeRadius: WebGLUniformLocation | null = null;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.program = this.createProgram(
      `#version 300 es\n
       layout(location=0) in vec2 aPos; // NDC quad [-1,1]\n
       void main(){\n
         gl_Position = vec4(aPos, 0.0, 1.0);\n
       }`,
  `#version 300 es\n
   precision highp float;\n
       uniform vec2 uViewSize;\n
       uniform vec3 uDarkColor;\n
       uniform float uDarkAlpha;\n
       uniform vec2 uCenterPx;\n
       uniform float uRadiusPx;\n
       uniform float uPenScale;\n
       uniform float uPenAlpha;\n
       uniform int uWedgeEnabled;\n
       uniform vec2 uWedgeDir;\n
       uniform float uWedgeCosHalf;\n
       uniform float uWedgeRadius;\n
       out vec4 outColor;\n
       void main(){\n
         // Convert to pixel coords: gl_FragCoord is in pixels, origin bottom-left.\n
         vec2 fragPx = vec2(gl_FragCoord.x, gl_FragCoord.y);\n
         // Distance to reveal center (passed in GL pixel space).\n
         float dist = distance(fragPx, uCenterPx);\n
         float r = max(uRadiusPx, 1.0);\n
         float dNorm = dist / r;\n
         // Base circular reveal: 1 inside, 0 outside, with a soft rim.\n
         float circleReveal = 1.0 - smoothstep(0.92, 1.0, dNorm);\n
         // Optional flashlight wedge: additional reveal within a cone and radius.\n
         float wedgeReveal = 0.0;\n
         if (uWedgeEnabled != 0) {\n
           vec2 toFrag = normalize(fragPx - uCenterPx);\n
           float angCos = dot(uWedgeDir, toFrag);\n
           if (angCos >= uWedgeCosHalf && dist <= uWedgeRadius) {\n
             float t = clamp(dist / max(uWedgeRadius, 1.0), 0.0, 1.0);\n
             // Softer near the tip, fades out at max radius.\n
             wedgeReveal = 1.0 - smoothstep(0.8, 1.0, t);\n
           }\n
         }\n
         // Penumbra outside the main radius – gently lighten darkness beyond edge.\n
         float pen = 0.0;\n
         if (uPenAlpha > 0.0 && uPenScale > 1.0) {\n
           if (dNorm > 1.0) {\n
             float t = (dNorm - 1.0) / max(uPenScale - 1.0, 1e-5);\n
             pen = uPenAlpha * (1.0 - clamp(t, 0.0, 1.0));\n
           }\n
         }\n
         float reveal = clamp(max(circleReveal, wedgeReveal) + pen, 0.0, 1.0);\n
         float alpha = clamp(uDarkAlpha * (1.0 - reveal), 0.0, 1.0);\n
         outColor = vec4(uDarkColor * alpha, alpha); // premultiplied\n
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
    const gl = this.gl;
    this.uViewSize = gl.getUniformLocation(this.program, 'uViewSize');
    this.uDarkColor = gl.getUniformLocation(this.program, 'uDarkColor');
    this.uDarkAlpha = gl.getUniformLocation(this.program, 'uDarkAlpha');
    this.uCenterPx = gl.getUniformLocation(this.program, 'uCenterPx');
    this.uRadiusPx = gl.getUniformLocation(this.program, 'uRadiusPx');
    this.uPenScale = gl.getUniformLocation(this.program, 'uPenScale');
    this.uPenAlpha = gl.getUniformLocation(this.program, 'uPenAlpha');
    this.uWedgeEnabled = gl.getUniformLocation(this.program, 'uWedgeEnabled');
    this.uWedgeDir = gl.getUniformLocation(this.program, 'uWedgeDir');
    this.uWedgeCosHalf = gl.getUniformLocation(this.program, 'uWedgeCosHalf');
    this.uWedgeRadius = gl.getUniformLocation(this.program, 'uWedgeRadius');
  }

  private initVAO(){
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    // Full-screen quad in NDC
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
    gl.bindVertexArray(null);
  }

  private configureGL(){
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
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

  public render(p: GLFogParams){
    const gl = this.gl;
    this.setSize(p.pixelW, p.pixelH);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Convert world center -> pixel coords relative to viewport (top-left origin), then to GL pixel Y (bottom-left origin)
    const scaleX = p.pixelW / Math.max(1, p.designW);
    const scaleY = p.pixelH / Math.max(1, p.designH);
    const cxPxTL = (p.centerX - p.camX) * scaleX;
    const cyPxTL = (p.centerY - p.camY) * scaleY;
  // Snap to half-pixel to reduce subpixel jitter when composited to a 2D canvas
  // This helps minimize visible shimmer at the fog edge during smooth camera/player motion.
  const cxPxGL = Math.round(cxPxTL) + 0.5;
  const cyPxGL = Math.round(p.pixelH - cyPxTL) + 0.5;
    // Wedge direction in GL pixel space is identical (only direction matters)
    const wedge = p.wedge;
    const wedgeEnabled = wedge && wedge.enabled && isFinite(wedge.dirX) && isFinite(wedge.dirY) && isFinite(wedge.halfAngleRad) && isFinite(wedge.radius);
    // Normalize wedge dir defensively
    let wdX = 1.0, wdY = 0.0;
    if (wedgeEnabled) {
      const len = Math.hypot(wedge!.dirX, wedge!.dirY) || 1.0;
      wdX = wedge!.dirX / len;
      wdY = -wedge!.dirY / len; // flip Y because GL pixel space has inverted Y
    }

    gl.useProgram(this.program);
    if (this.uViewSize) gl.uniform2f(this.uViewSize, this.canvas.width, this.canvas.height);
    if (this.uDarkColor) gl.uniform3f(this.uDarkColor, p.darkRGB[0], p.darkRGB[1], p.darkRGB[2]);
    if (this.uDarkAlpha) gl.uniform1f(this.uDarkAlpha, Math.max(0, Math.min(1, p.darkAlpha)));
    if (this.uCenterPx) gl.uniform2f(this.uCenterPx, cxPxGL, cyPxGL);
    if (this.uRadiusPx) gl.uniform1f(this.uRadiusPx, Math.max(1, p.radiusPx));
    if (this.uPenScale) gl.uniform1f(this.uPenScale, Math.max(1, p.penScale ?? 1.18));
  if (this.uPenAlpha) gl.uniform1f(this.uPenAlpha, Math.max(0.0, Math.min(1.0, p.penAlpha ?? 0.04)));
    if (this.uWedgeEnabled) gl.uniform1i(this.uWedgeEnabled, wedgeEnabled ? 1 : 0);
    if (this.uWedgeDir) gl.uniform2f(this.uWedgeDir, wdX, wdY);
    if (this.uWedgeCosHalf) gl.uniform1f(this.uWedgeCosHalf, wedgeEnabled ? Math.cos(wedge!.halfAngleRad) : 0.0);
    if (this.uWedgeRadius) gl.uniform1f(this.uWedgeRadius, wedgeEnabled ? wedge!.radius : 1.0);

  (window as any).__glFogReady = true;
  this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    this.gl.bindVertexArray(null);
  }
}

export function createGLFogRendererLike(mainCanvas: HTMLCanvasElement): GLFogRenderer | null {
  try {
    return new GLFogRenderer(Math.max(1, mainCanvas.width), Math.max(1, mainCanvas.height));
  } catch {
    return null;
  }
}
