import { radioService } from './RadioService';
import { SoundManager } from '../game/SoundManager';

export interface RadioOverlayHandle {
  show(): void;
  hide(): void;
}

/** Ensure a single radio overlay exists; returns show/hide handle. */
export function ensureRadioOverlay(): RadioOverlayHandle {
  let root = document.getElementById('radio-overlay');
  if (!root) {
    root = document.createElement('div');
    root.id = 'radio-overlay';
    root.innerHTML = `
      <div class="ro-shell" aria-label="Radio">
        <button class="ro-btn" id="ro-prev" title="Previous">⏮</button>
        <button class="ro-btn" id="ro-play" title="Play/Pause">▶</button>
        <button class="ro-btn" id="ro-next" title="Next">⏭</button>
        <button class="ro-btn" id="ro-shuffle" title="Shuffle">🔀</button>
        <div class="ro-title" id="ro-title"><span class="scroll">Radio — Ready</span></div>
        <input type="range" id="ro-volume" min="0" max="1" step="0.01" title="Volume" />
      </div>`;
    document.body.appendChild(root);
    installStyles();
    // Avoid overlapping the Last Stand HUD: pin below HUD if present
    const adjustLayout = () => {
      try {
        const hud = document.querySelector('.ls-hud') as HTMLElement | null;
        const shell = root!.querySelector('.ro-shell') as HTMLElement | null;
        if (!shell) return;
        let top = 20;
        if (hud && hud.offsetParent !== null) {
          const rect = hud.getBoundingClientRect();
          // Place radio just below HUD with a small gap
          top = Math.max(20, Math.round(rect.bottom + 10));
        }
        (root as HTMLElement).style.top = `${top}px`;
        // Nudge closer to center on small screens to avoid clipping
        const vw = Math.max(320, window.innerWidth || 0);
        (root as HTMLElement).style.right = (vw < 920 ? '12px' : '140px');
      } catch {/* ignore */}
    };
  // Initial and reactive adjustments
    adjustLayout();
    window.addEventListener('resize', adjustLayout);
    const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(adjustLayout) : null;
    try { const hud = document.querySelector('.ls-hud') as HTMLElement | null; if (hud && ro) ro.observe(hud); } catch {}
    // Also re-adjust shortly after show to account for font/layout settling
    setTimeout(adjustLayout, 50);
  (root as any).__adjust = adjustLayout;
    // Init radio (idempotent)
    try { radioService.init(); } catch {}
  const title = root.querySelector('#ro-title .scroll') as HTMLElement | null;
    const bPrev = root.querySelector('#ro-prev') as HTMLButtonElement | null;
    const bPlay = root.querySelector('#ro-play') as HTMLButtonElement | null;
    const bNext = root.querySelector('#ro-next') as HTMLButtonElement | null;
  const bShuf = root.querySelector('#ro-shuffle') as HTMLButtonElement | null;
  const vSlider = root.querySelector('#ro-volume') as HTMLInputElement | null;
    // subscribe
    radioService.subscribe(({ playing, track, shuffle }) => {
      if (bPlay) bPlay.textContent = playing ? '⏸' : '▶';
      if (bShuf) bShuf.style.opacity = shuffle ? '1' : '0.75';
  if (title) title.textContent = track ? ((playing ? '♪ ' : '') + track.title) : '—';
    });
    // handlers
    bPrev?.addEventListener('click', () => { SoundManager.playUiClick({ volume: 0.14, durationMs: 70, freq: 1220 }); radioService.prev(); });
    bNext?.addEventListener('click', () => { SoundManager.playUiClick({ volume: 0.14, durationMs: 70, freq: 1220 }); radioService.next(); });
    bShuf?.addEventListener('click', () => { SoundManager.playUiClick({ volume: 0.14, durationMs: 70, freq: 980 }); radioService.toggleShuffle(); });
    bPlay?.addEventListener('click', () => { SoundManager.playUiClick({ volume: 0.14, durationMs: 70, freq: 1350 }); radioService.toggle(); });
    if (vSlider) {
      try { vSlider.value = String((SoundManager as any).getVolume?.() ?? 0.5); } catch { vSlider.value = '0.5'; }
      vSlider.addEventListener('input', () => {
        const v = Math.max(0, Math.min(1, parseFloat(vSlider!.value)));
        SoundManager.setVolume(v);
      });
      // Keep in sync with other sliders (like Main Menu)
      window.addEventListener('volumechange', (e: any) => {
        const vol = typeof e?.detail === 'number' ? e.detail : null;
        if (vol == null) return;
        const cur = parseFloat(vSlider!.value);
        if (Math.abs(cur - vol) > 0.001) vSlider!.value = String(vol);
      });
    }
    root.style.display = 'none';
  }
  return {
  show(){ const el = document.getElementById('radio-overlay'); if (el) { el.style.display = 'block'; try { (el as any).__adjust && (el as any).__adjust(); } catch {} } },
    hide(){ const el = document.getElementById('radio-overlay'); if (el) el.style.display = 'none'; }
  };
}

function installStyles() {
  if (document.getElementById('radio-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'radio-overlay-styles';
  style.textContent = `
  #radio-overlay{position:fixed;top:20px;right:190px;z-index:120;pointer-events:auto}
  #radio-overlay .ro-shell{display:flex;align-items:center;gap:6px;border:1px solid rgba(0,255,255,0.35);background:rgba(0,25,38,0.32);backdrop-filter:blur(4px);padding:4px 8px;border-radius:10px;width:360px;height:28px}
  #radio-overlay .ro-btn{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:22px;border-radius:6px;border:1px solid rgba(0,255,255,0.45);background:rgba(0,45,60,0.35);color:#b8faff;cursor:pointer;font-size:12px;line-height:1;user-select:none}
  #radio-overlay .ro-btn:hover{background:rgba(0,80,100,0.45);box-shadow:0 0 10px rgba(0,255,255,0.25) inset}
  #radio-overlay .ro-title{font-size:12px;color:#9adfff;width:160px;white-space:nowrap;overflow:hidden;position:relative}
  #radio-overlay #ro-volume{appearance:none;width:90px;height:4px;background:rgba(0,255,255,0.22);border-radius:3px;outline:none;margin-left:6px}
  #radio-overlay #ro-volume::-webkit-slider-thumb{appearance:none;width:12px;height:12px;border-radius:50%;background:#26ffe9;border:1px solid rgba(0,255,255,0.7);box-shadow:0 0 8px rgba(38,255,233,0.45)}
  #radio-overlay .ro-title .scroll{display:inline-block; padding-left:100%; animation: ro-marquee 12s linear infinite;}
  @keyframes ro-marquee { from{ transform: translateX(0); } to { transform: translateX(-100%); } }
  @media (max-width: 920px){ #radio-overlay{right: 12px; } }
  `;
  document.head.appendChild(style);
}
