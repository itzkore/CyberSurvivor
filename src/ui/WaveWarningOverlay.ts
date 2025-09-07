export type WaveWarnKind = 'ENEMIES' | 'ELITE' | 'BOSS';

export interface WaveWarningHandle {
  show(kind: WaveWarnKind, customText?: string, durationMs?: number): void;
}

/** Create or return a singleton big HUD wave warning overlay. */
export function ensureWaveWarningOverlay(): WaveWarningHandle {
  let root = document.getElementById('wave-warning-overlay') as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'wave-warning-overlay';
    Object.assign(root.style, {
      position: 'fixed', left: '50%', top: '18%', transform: 'translateX(-50%)',
      zIndex: '160', pointerEvents: 'none', display: 'none'
    } as CSSStyleDeclaration);
    const label = document.createElement('div'); label.className = 'wwo-label';
    root.appendChild(label);
    document.body.appendChild(root);
    installStyles();
  }
  const el = root;
  return {
    show(kind: WaveWarnKind, customText?: string, durationMs = 2000){
      if (!el) return;
      const label = el.querySelector('.wwo-label') as HTMLDivElement | null;
      if (!label) return;
      const text = customText || (kind === 'BOSS' ? 'BOSS INCOMING' : kind === 'ELITE' ? 'ELITE WAVE INCOMING' : 'ENEMIES INCOMING');
      label.textContent = text;
      // Color theme per kind
      const color = kind === 'BOSS' ? '#ff6a6a' : kind === 'ELITE' ? '#ffd166' : '#7dffea';
      label.style.setProperty('--wwo-color', color);
      el.style.display = 'block';
      // Restart animation
      label.classList.remove('wwo-anim');
      // Force reflow
      void label.offsetWidth;
      label.classList.add('wwo-anim');
      window.clearTimeout((el as any).__hideTo);
      (el as any).__hideTo = window.setTimeout(()=>{ el!.style.display = 'none'; }, Math.max(800, durationMs));
    }
  };
}

function installStyles(){
  if (document.getElementById('wave-warning-overlay-styles')) return;
  const style = document.createElement('style'); style.id = 'wave-warning-overlay-styles';
  style.textContent = `
  #wave-warning-overlay .wwo-label{
    font: 800 34px Orbitron, monospace; letter-spacing: 1.6px; text-transform: uppercase;
    color: var(--wwo-color, #7dffea); text-shadow: 0 0 16px var(--wwo-color, #7dffea), 0 0 40px rgba(0,0,0,0.8);
    border: 2px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 12px 18px;
    background: linear-gradient(180deg, rgba(0,16,20,0.75), rgba(0,10,12,0.55));
    box-shadow: 0 10px 40px rgba(0,0,0,0.35), inset 0 0 12px rgba(255,255,255,0.06);
    display: inline-block;
    opacity: 0; transform: scale(0.96);
  }
  #wave-warning-overlay .wwo-label.wwo-anim{
    animation: wwo-pop 260ms ease-out, wwo-hold 1200ms linear 260ms forwards;
  }
  @keyframes wwo-pop { from{ opacity:0; transform: scale(0.92); } to { opacity:1; transform: scale(1); } }
  @keyframes wwo-hold { from{ opacity:1; } to { opacity:0; } }
  `;
  document.head.appendChild(style);
}
