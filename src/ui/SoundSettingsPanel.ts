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
    // Fixed small panel in absolute top-right corner
    this.panel.style.position = 'absolute';
    this.panel.style.top = '0px';
    this.panel.style.right = '0px';
  this.panel.style.zIndex = '10001';
    this.panel.style.background = 'rgba(25,25,40,0.92)';
    this.panel.style.border = '2px solid #00FFFF';
    this.panel.style.borderRadius = '8px';
    this.panel.style.padding = '4px 6px';
  this.panel.style.boxShadow = '0 2px 8px #00FFFF55';
  this.panel.style.pointerEvents = 'auto';

    const label = document.createElement('label');
    label.textContent = '🔊';
    label.style.color = '#00FFFF';
    label.style.fontFamily = 'Orbitron, sans-serif';
    label.style.fontSize = '12px';
    label.style.marginRight = '4px';

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1';
    this.slider.step = '0.01';
    this.slider.value = String(Howler.volume());
    this.slider.style.width = '42px'; // roughly half original width
    this.slider.style.verticalAlign = 'middle';
    this.slider.oninput = () => {
      Howler.volume(parseFloat(this.slider.value));
    };

    this.panel.appendChild(label);
    this.panel.appendChild(this.slider);

  document.body.appendChild(this.panel);
    // Force fixed top-right placement (no dynamic reposition logic now)
    this.panel.style.left = 'auto';
    this.panel.style.bottom = 'auto';
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
}
