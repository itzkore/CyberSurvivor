// SoundSettingsPanel.ts - UI for global sound volume control
// Uses Howler.js global volume
import { Howler } from 'howler';

/**
 * UI panel for controlling global sound volume.
 * @group UI
 */
export class SoundSettingsPanel {
  private panel: HTMLDivElement;
  private slider: HTMLInputElement;

  constructor() {
  this.panel = document.createElement('div');
  this.panel.id = 'sound-settings-panel';
  this.panel.className = 'sound-settings-panel';
  this.installStyles();

  const icon = document.createElement('label');
  icon.setAttribute('for', 'sound-volume');
  icon.textContent = '🔊';
  icon.className = 'sound-icon';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.id = 'sound-volume';
    this.slider.setAttribute('aria-label', 'Master volume');
    this.slider.min = '0';
    this.slider.max = '1';
    this.slider.step = '0.01';
    this.slider.value = String(Howler.volume());
    this.slider.className = 'sound-range';
    this.slider.oninput = () => {
      Howler.volume(parseFloat(this.slider.value));
    };
    this.panel.appendChild(icon);
    this.panel.appendChild(this.slider);
    // Prefer embedding into main menu footer status bar; fallback to header, then floating
    const footerHost = document.querySelector('.mm-footer .status-line') as HTMLElement | null;
    if (footerHost) {
      this.panel.classList.add('inline');
      this.panel.classList.add('footer');
      footerHost.appendChild(this.panel);
    } else {
      const headerHost = document.querySelector('.profile-block') as HTMLElement | null;
      if (headerHost) {
        this.panel.classList.add('inline');
        headerHost.appendChild(this.panel);
      } else {
        // Floating fallback (rare): mimic theme but fixed at top-right
        this.panel.classList.add('floating');
        document.body.appendChild(this.panel);
      }
    }
  }

  /**
   * Show the sound settings panel.
   */
  public show() {
    this.panel.style.display = 'block';
  }

  /**
   * Hide the sound settings panel.
   */
  public hide() {
    this.panel.style.display = 'none';
  }

  /**
   * Detects overlap with currency display (or other HUD pills) and repositions if necessary.
   * Strategy: if overlapping element with id 'currency-amount' (inside its parent) -> move panel to top-left.
   * Fallback: if still overlap, place bottom-right.
   */
  private adjustPosition() {
    // adjustPosition removed (static placement desired)
  }

  /** Inject minimal themed styles shared by menu + fallback */
  private installStyles() {
    if (document.getElementById('sound-settings-styles')) return;
    const style = document.createElement('style');
    style.id = 'sound-settings-styles';
    style.textContent = `
      /* Inline (menu header) pill */
  #sound-settings-panel.inline{display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:2px 6px;background:rgba(0,25,38,.6);border:1px solid rgba(0,255,255,.35);border-radius:999px}
  #sound-settings-panel.inline.footer{margin-left:12px}
      #sound-settings-panel.inline .sound-icon{color:#9fe;font-family:Orbitron,sans-serif;font-size:12px}
      /* Floating fallback */
      #sound-settings-panel.floating{position:absolute;top:8px;right:8px;z-index:10001;display:flex;align-items:center;gap:8px;padding:6px 10px;background:rgba(0,18,24,.9);border:1px solid rgba(0,255,255,.45);border-radius:10px;box-shadow:0 2px 10px rgba(0,255,255,.25)}
  #sound-settings-panel .sound-range{appearance:none;-webkit-appearance:none;width:90px;height:4px;background:rgba(0,255,255,.12);border:1px solid rgba(0,255,255,.18);border-radius:999px;outline:none;box-shadow:inset 0 0 6px rgba(0,255,255,.12)}
      #sound-settings-panel .sound-range::-webkit-slider-runnable-track{height:4px;background:rgba(0,255,255,.12);border-radius:999px}
      #sound-settings-panel .sound-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:#3ED1E4;border:1px solid rgba(0,255,255,.55);box-shadow:0 0 6px rgba(62,209,228,.55);margin-top:-5px}
      #sound-settings-panel .sound-range::-moz-range-track{height:4px;background:rgba(0,255,255,.12);border-radius:999px;border:1px solid rgba(0,255,255,.18)}
      #sound-settings-panel .sound-range::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#3ED1E4;border:1px solid rgba(0,255,255,.55);box-shadow:0 0 6px rgba(62,209,228,.55)}
    `;
    document.head.appendChild(style);
  }
}
