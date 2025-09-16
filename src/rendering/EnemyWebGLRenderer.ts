import type { Enemy } from '../game/EnemyManager';

interface EnemyRenderInput {
  enemies: Enemy[];
  cameraX: number;
  cameraY: number;
  viewWidth: number;
  viewHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  shakeX: number;
  shakeY: number;
  time: number;
  brightness: number;
}

type GlResources = {
  gl: WebGL2RenderingContext;
  vao: WebGLVertexArrayObject;
  quad: WebGLBuffer;
  instanceBuffer: WebGLBuffer;
  program: WebGLProgram;
  uniforms: {
    camera: WebGLUniformLocation | null;
    viewSize: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    shake: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    brightness: WebGLUniformLocation | null;
  };
  capacity: number;
};

const FLOATS_PER_INSTANCE = 10;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${info}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error('Unable to create WebGL program');
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Failed to link program: ${info}`);
  }
  return program;
}

function createResources(canvas: HTMLCanvasElement): GlResources | null {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;

  const vsSource = `#version 300 es
in vec2 a_position;
in vec2 a_center;
in vec2 a_radiusType;
in vec4 a_color;
in vec2 a_misc;

uniform vec2 u_camera;
uniform vec2 u_viewSize;
uniform vec2 u_resolution;
uniform vec2 u_shake;

out vec2 v_local;
out vec4 v_color;
out float v_health;
out float v_type;

void main() {
  v_local = a_position;
  v_color = a_color;
  v_health = a_misc.x;
  v_type = a_radiusType.y;
  vec2 world = a_center + a_position * a_radiusType.x;
  vec2 camera = (world - u_camera + u_shake) / u_viewSize;
  vec2 clip = vec2(camera.x * 2.0 - 1.0, 1.0 - camera.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;
  const fsSource = `#version 300 es
precision highp float;

in vec2 v_local;
in vec4 v_color;
in float v_health;
in float v_type;

uniform float u_time;
uniform float u_brightness;

out vec4 outColor;

void main() {
  float dist = length(v_local);
  if (dist > 1.0) {
    discard;
  }
  float alpha = smoothstep(1.0, 0.88, 1.0 - dist);
  float health = clamp(v_health, 0.0, 1.0);
  vec3 base = v_color.rgb * clamp(u_brightness, 0.45, 1.35);
  float rim = smoothstep(0.96, 1.12, dist);
  float coreMask = smoothstep(health, health - 0.12, dist);
  vec3 core = mix(base * 0.35, base, health * 0.9 + 0.1);
  vec3 color = mix(core, base, coreMask);
  if (v_type > 1.5) {
    float pulse = 0.88 + 0.12 * sin(u_time * 0.005 + dist * 8.0);
    color *= pulse;
  }
  vec3 rimColor = mix(base * 1.35, vec3(1.0), 0.2);
  color = mix(color, rimColor, rim * 0.7);
  outColor = vec4(color, alpha);
}
`;
  const program = createProgram(gl, vsSource, fsSource);

  const quad = gl.createBuffer();
  if (!quad) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  const quadVerts = new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  const instanceBuffer = gl.createBuffer();
  if (!instanceBuffer) {
    gl.deleteBuffer(quad);
    gl.deleteProgram(program);
    return null;
  }

  const vao = gl.createVertexArray();
  if (!vao) {
    gl.deleteBuffer(quad);
    gl.deleteBuffer(instanceBuffer);
    gl.deleteProgram(program);
    return null;
  }

  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  const stride = FLOATS_PER_INSTANCE * 4;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 32);
  gl.vertexAttribDivisor(4, 1);

  gl.bindVertexArray(null);

  const uniforms = {
    camera: gl.getUniformLocation(program, 'u_camera'),
    viewSize: gl.getUniformLocation(program, 'u_viewSize'),
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    shake: gl.getUniformLocation(program, 'u_shake'),
    time: gl.getUniformLocation(program, 'u_time'),
    brightness: gl.getUniformLocation(program, 'u_brightness'),
  };

  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);

  return {
    gl,
    vao,
    quad,
    instanceBuffer,
    program,
    uniforms,
    capacity: 0,
  };
}

function colorForEnemy(enemy: Enemy): [number, number, number, number] {
  const now = performance.now();
  const eAny = enemy as any;
  const eliteKind = eAny?._elite?.kind ? String(eAny._elite.kind) : undefined;
  const mindControlled = !!(eAny?._mindControlledUntil && eAny._mindControlledUntil > now);
  const bleeding = !!(eAny?._bleedUntil && eAny._bleedUntil > now);
  let base: [number, number, number] = [0.84, 0.22, 0.28];
  if (enemy.type === 'medium') base = [1.0, 0.58, 0.18];
  else if (enemy.type === 'large') base = [0.68, 0.45, 1.0];
  if (eliteKind) {
    if (eliteKind === 'DASHER') base = [1.0, 0.32, 0.52];
    else if (eliteKind === 'GUNNER') base = [1.0, 0.85, 0.32];
    else if (eliteKind === 'SUPPRESSOR') base = [0.32, 0.86, 1.0];
    else if (eliteKind === 'BOMBER') base = [1.0, 0.54, 0.32];
    else if (eliteKind === 'BLOCKER') base = [0.48, 0.96, 0.66];
    else if (eliteKind === 'BLINKER') base = [0.78, 0.58, 1.0];
    else base = [0.52, 0.96, 0.76];
  }
  if (mindControlled) base = [0.34, 0.92, 0.82];
  else if (bleeding) base = [0.9, 0.16, 0.36];
  return [base[0], base[1], base[2], 1.0];
}

export class EnemyWebGLRenderer {
  private canvas: HTMLCanvasElement;
  private resources: GlResources | null;
  private instanceData: Float32Array;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'none';
    this.resources = createResources(this.canvas);
    this.instanceData = new Float32Array(0);
  }

  isAvailable(): boolean {
    return !!this.resources;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  private ensureCapacity(count: number) {
    if (!this.resources) return;
    if (count <= this.resources.capacity) return;
    const next = Math.max(count, Math.floor(this.resources.capacity * 1.5) + 8);
    this.instanceData = new Float32Array(next * FLOATS_PER_INSTANCE);
    this.resources.capacity = next;
  }

  render(input: EnemyRenderInput) {
    if (!this.resources) return;
    const { enemies, pixelWidth, pixelHeight } = input;
    const { gl, vao, program, instanceBuffer, uniforms } = this.resources;

    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;

    if (!enemies.length) {
      gl.viewport(0, 0, pixelWidth, pixelHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    this.ensureCapacity(enemies.length);
    const data = this.instanceData;
    let ptr = 0;
    const now = input.time;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      const color = colorForEnemy(enemy);
      const hp = enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 1;
      const eAny = enemy as any;
      const elite = eAny?._elite?.kind ? 2.0 : (enemy.type === 'large' ? 1.4 : enemy.type === 'medium' ? 1.0 : 0.6);
      data[ptr++] = enemy.x;
      data[ptr++] = enemy.y;
      data[ptr++] = enemy.radius;
      data[ptr++] = elite;
      data[ptr++] = color[0];
      data[ptr++] = color[1];
      data[ptr++] = color[2];
      data[ptr++] = color[3];
      data[ptr++] = hp;
      data[ptr++] = now;
    }

    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.uniform2f(uniforms.camera, input.cameraX, input.cameraY);
    gl.uniform2f(uniforms.viewSize, input.viewWidth, input.viewHeight);
    gl.uniform2f(uniforms.resolution, pixelWidth, pixelHeight);
    gl.uniform2f(uniforms.shake, input.shakeX, input.shakeY);
    gl.uniform1f(uniforms.time, input.time);
    gl.uniform1f(uniforms.brightness, input.brightness);

    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, enemies.length * FLOATS_PER_INSTANCE), gl.DYNAMIC_DRAW);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, enemies.length);

    gl.bindVertexArray(null);
    gl.useProgram(null);
  }
}
