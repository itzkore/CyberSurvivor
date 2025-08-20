/**
 * Adaptive viewport scaler for DPI / small window handling.
 * Provides a consistent baseline layout (design resolution) and scales down
 * uniformly when the actual viewport is smaller (including effective CSS px reduction
 * from Windows display scaling in Electron).
 *
 * We intentionally avoid scaling the full-screen background; only an inner wrapper
 * containing UI content is transformed. This keeps visual effects (e.g. matrix background)
 * crisp while guaranteeing UI fits.
 */
export interface AdaptiveScaleOptions {
  baseWidth?: number;    // Design logical width
  baseHeight?: number;   // Design logical height
  minScale?: number;     // Minimum uniform scale (contain mode)
  maxScale?: number;     // Maximum allowed scale (applies to uniform or independent axes)
  compensateDPR?: boolean; // Neutralize Windows display scaling shrink
  allowUpscale?: boolean; // Allow >1 scaling
  mode?: 'contain' | 'stretch'; // contain preserves aspect (no cropping, may leave margins); stretch fills viewport (independent X/Y scaling, no margins)
  adaptiveHeight?: boolean; // When mode==='stretch': lock vertical scale to 1 and expand layout height to viewport (avoids squish from browser chrome reducing innerHeight)
  offsetY?: number; // Additional pixel offset from top in stretch mode
}

const DEFAULTS: Required<AdaptiveScaleOptions> = {
  baseWidth: 1920,
  baseHeight: 1080,
  minScale: 0.6,
  maxScale: 1,
  compensateDPR: false,
  allowUpscale: false,
  mode: 'contain',
  adaptiveHeight: false,
  offsetY: 0
};

interface AttachedState { el: HTMLElement; opts: Required<AdaptiveScaleOptions>; rafId: number | null; lastKey: string; }

const attached: AttachedState[] = [];

function computeScale(opts: Required<AdaptiveScaleOptions>) {
  const dpr = opts.compensateDPR ? window.devicePixelRatio || 1 : 1;
  const effW = window.innerWidth * dpr;
  const effH = window.innerHeight * dpr;
  if (opts.mode === 'stretch') {
    let sx = effW / opts.baseWidth;
    let sy = effH / opts.baseHeight;
    if (opts.adaptiveHeight) {
      // Allow vertical shrink when viewport is shorter (avoid cropping) and vertical grow when taller (fill space)
      // Keep independent scaling; do not lock to 1.
      // Nothing extra needed here; we just keep computed sy.
    }
    if (!opts.allowUpscale) { sx = Math.min(sx, 1); sy = Math.min(sy, 1); }
    sx = Math.min(Math.max(opts.minScale, sx), opts.maxScale);
    sy = Math.min(Math.max(opts.minScale, sy), opts.maxScale);
    return { sx, sy, key: `stretch:${sx.toFixed(4)}:${sy.toFixed(4)}` };
  } else {
    let s = Math.min(effW / opts.baseWidth, effH / opts.baseHeight);
    if (!opts.allowUpscale) s = Math.min(s, 1);
    s = Math.min(Math.max(opts.minScale, s), opts.maxScale);
    return { sx: s, sy: s, key: `contain:${s.toFixed(4)}` };
  }
}

function applyScale(state: AttachedState) {
  const { el, opts } = state;
  const result = computeScale(opts);
  if (result.key === state.lastKey) return;
  state.lastKey = result.key;
  el.style.position = 'fixed';
  el.style.width = opts.baseWidth + 'px';
  el.style.height = opts.baseHeight + 'px';
  if (opts.mode === 'stretch') {
    // Fill entire viewport: anchor top-left and stretch.
    el.style.left = '0';
  el.style.top = (opts.offsetY || 0) + 'px';
    el.style.transformOrigin = '0 0';
    if (opts.adaptiveHeight && result.sy >= 1) {
      // When we are scaling up (taller viewport), expand logical height so internal vertical flex/distribution can use extra space.
      el.style.height = window.innerHeight + 'px';
    } else {
      el.style.height = opts.baseHeight + 'px';
    }
    el.style.transform = `scale(${result.sx}, ${result.sy})`;
  } else {
    // Contain: center both axes (classic letterbox removal)
    const s = result.sx; // uniform
    el.style.left = '50%';
    el.style.top = '50%';
    el.style.transformOrigin = '50% 50%';
    el.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  el.dataset.scale = result.key;
}

function scheduleApply(state: AttachedState) {
  if (state.rafId != null) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(() => {
    applyScale(state);
    state.rafId = null;
  });
}

function onResize() {
  for (const s of attached) scheduleApply(s);
}

window.addEventListener('resize', onResize);

/** Attach adaptive scaling behavior to an element. */
export function attachAdaptiveScaler(el: HTMLElement, options: AdaptiveScaleOptions = {}): void {
  if (attached.find(a => a.el === el)) return;
  const opts: Required<AdaptiveScaleOptions> = { ...DEFAULTS, ...options };
  const state: AttachedState = { el, opts, rafId: null, lastKey: '' };
  attached.push(state); applyScale(state);
}

/** Force re-apply (e.g., after dynamic content or orientation changes). */
export function refreshAdaptiveScalers(): void { attached.forEach(s => { s.lastKey = ''; applyScale(s); }); }
