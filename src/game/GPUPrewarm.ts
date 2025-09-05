/**
 * GPUPrewarm: optional warm-up to reduce first-frame jank by
 * initializing GPU contexts and uploading a small texture via WebGL.
 * Safe-noop if WebGL is unavailable.
 */
export class GPUPrewarm {
  static prewarm(canvas2D?: HTMLCanvasElement) {
    try {
      // 1) Touch WebGL to initialize driver and allocate a context
      const glCanvas = document.createElement('canvas');
      glCanvas.width = 4; glCanvas.height = 4;
      const gl = (glCanvas.getContext('webgl', { preserveDrawingBuffer: false, antialias: false })
        || glCanvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (gl) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const pixels = new Uint8Array(4 * 4 * 4); // small 4x4 RGBA
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.finish?.();
        gl.deleteTexture(tex);
      }
    } catch {/* ignore */}
    try {
      // 2) For 2D canvas, set properties that hint GPU compositing and pre-allocate a small draw
      if (canvas2D) {
        const ctx = canvas2D.getContext('2d', { alpha: true, desynchronized: true }) as CanvasRenderingContext2D | null;
        if (ctx) {
          // draw a tiny transparent pixel to force internal state init
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = 'rgba(0,0,0,0)';
          ctx.fillRect(0, 0, 1, 1);
        }
      }
    } catch {/* ignore */}
  }
}
