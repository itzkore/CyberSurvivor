// SoundSettingsPanel.ts - UI for global sound volume control
// Uses Howler.js global volume
import { Howler } from 'howler';

/**
 * UI panel for controlling global sound volume.
 * @group UI
 */
export class SoundSettingsPanel {
  // Deprecated legacy panel; retained as inert class to avoid breaking imports.
  // No DOM is created and methods are no-ops.
  constructor() {}

  /**
   * Show the sound settings panel.
   */
  public show() { /* no-op */ }

  /**
   * Hide the sound settings panel.
   */
  public hide() { /* no-op */ }

  /**
   * Detects overlap with currency display (or other HUD pills) and repositions if necessary.
   * Strategy: if overlapping element with id 'currency-amount' (inside its parent) -> move panel to top-left.
   * Fallback: if still overlap, place bottom-right.
   */
  private adjustPosition() { /* no-op */ }

  /** Inject minimal themed styles shared by menu + fallback */
  private installStyles() { /* no-op */ }
}
