/**
 * TFKinematics: Minimal WebGL2 Transform Feedback scaffold for kinematics updates.
 * - Keeps its own hidden WebGL2 context.
 * - Can upload x,y,vx,vy and perform x += vx*dt, y += vy*dt on GPU.
 * - Readback is supported for scaffolding purposes (avoid for perf in production).
 *
 * NOTE: This is a scaffold. It is not used unless explicitly wired behind a flag.
 */
export class TFKinematics {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement | null = null;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private tf!: WebGLTransformFeedback;
  private buffers: { pos: WebGLBuffer; vel: WebGLBuffer; posOut: WebGLBuffer; velOut: WebGLBuffer } | null = null;
  private capacity = 0;
  private uDtLoc: WebGLUniformLocation | null = null;

  constructor(gl?: WebGL2RenderingContext) {
    if (gl) {
      this.gl = gl;
    } else {
      this.canvas = document.createElement('canvas');
      const ctx = this.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
      if (!ctx) throw new Error('WebGL2 not supported');
      this.gl = ctx;
    }
    this.initProgram();
  }

  private initProgram() {
    const gl = this.gl;
    // Vertex shader performs kinematics update and writes to TF varyings
    const vsSrc = `#version 300 es\n
      precision highp float;\n
      layout(location=0) in vec2 aPos;\n
      layout(location=1) in vec2 aVel;\n
      uniform float uDt;\n
      out vec2 vOutPos;\n
      out vec2 vOutVel;\n
      void main(){\n
        vec2 p = aPos + aVel * uDt;\n
        vOutPos = p;\n
        vOutVel = aVel;\n
      }\n
    `;
    // Minimal passthrough fragment (unused in TF)
    const fsSrc = `#version 300 es\n
      precision highp float;\n
      out vec4 outColor;\n
      void main(){ outColor = vec4(0.0); }\n
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error('VS compile: ' + gl.getShaderInfoLog(vs));
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error('FS compile: ' + gl.getShaderInfoLog(fs));

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.transformFeedbackVaryings(prog, ['vOutPos', 'vOutVel'], gl.SEPARATE_ATTRIBS);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program link: ' + gl.getProgramInfoLog(prog));
    gl.deleteShader(vs); gl.deleteShader(fs);
    this.program = prog;

    this.vao = gl.createVertexArray()!;
    this.tf = gl.createTransformFeedback()!;
    this.uDtLoc = gl.getUniformLocation(prog, 'uDt');
  }

  ensureCapacity(count: number) {
    if (count <= this.capacity) return;
    const gl = this.gl;
    // round to next power of 2 for fewer reallocs
    const cap = Math.max(1024, 1 << Math.ceil(Math.log2(count + 16)));

    // Create / re-create buffers
    const createBuffer = (byteSize: number) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_COPY);
      return buf;
    };

    const bytes = cap * 2 * 4; // vec2 float32
    const newBuffers = {
      pos: createBuffer(bytes),
      vel: createBuffer(bytes),
      posOut: createBuffer(bytes),
      velOut: createBuffer(bytes),
    };

    this.buffers = newBuffers;
    this.capacity = cap;
  }

  syncFromSoA(posX: Float32Array, posY: Float32Array, velX: Float32Array, velY: Float32Array, count: number) {
    if (!this.buffers) throw new Error('Buffers not initialized');
    const gl = this.gl; const n = Math.min(count, this.capacity);
    // Interleave on the fly into temp views to upload vec2
    const pack = (ax: Float32Array, ay: Float32Array) => {
      const out = new Float32Array(n * 2);
      for (let i = 0, j = 0; i < n; i++, j += 2) { out[j] = ax[i]; out[j + 1] = ay[i]; }
      return out;
    };
    const pos = pack(posX, posY);
    const vel = pack(velX, velY);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vel);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vel);
  }

  // Upload already-packed vec2 buffers (length = count * 2).
  syncPacked(posXY: Float32Array, velXY: Float32Array, count: number) {
    if (!this.buffers) throw new Error('Buffers not initialized');
    const gl = this.gl; const n = Math.min(count, this.capacity);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posXY.subarray(0, n * 2));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vel);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, velXY.subarray(0, n * 2));
  }

  update(dtSec: number, count: number) {
    if (!this.buffers) throw new Error('Buffers not initialized');
    const gl = this.gl; const n = Math.min(count, this.capacity);
    gl.useProgram(this.program);
    gl.uniform1f(this.uDtLoc, dtSec);

    gl.bindVertexArray(this.vao);
    // Bind inputs
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vel);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    // Bind transform feedback outputs
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.buffers.posOut);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, this.buffers.velOut);

    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);

    // swap in/out buffers
    const tmpPos = this.buffers.pos; this.buffers.pos = this.buffers.posOut; this.buffers.posOut = tmpPos;
    const tmpVel = this.buffers.vel; this.buffers.vel = this.buffers.velOut; this.buffers.velOut = tmpVel;

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindVertexArray(null);
  }

  // Optional readback (slow). For scaffolding only.
  readbackPositions(count: number): Float32Array {
    if (!this.buffers) throw new Error('Buffers not initialized');
    const gl = this.gl; const n = Math.min(count, this.capacity);
    const out = new Float32Array(n * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
    return out;
  }
}

export default TFKinematics;
