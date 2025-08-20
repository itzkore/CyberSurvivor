import { matrixBackground } from './MatrixBackground';
import { Game } from '../game/Game';

/**
 * PauseOverlay
 * Fullscreen dark overlay shown when the game auto‑pauses (window blur / click out).
 * Displays subtle matrix rain (via MatrixBackground) and a resume hint.
 */
export class PauseOverlay {
  private el: HTMLDivElement;
  private game: Game;
  private visible = false;
  private auto: boolean = false;
  private buttonsHooked = false;
  private escCaptureHandler?: (e: KeyboardEvent) => void;
  private suppressEscUntil: number = 0; // timestamp to debounce ESC that opened menu

  constructor(game: Game) {
    this.game = game;
    let existing = document.getElementById('pause-overlay') as HTMLDivElement | null;
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'pause-overlay';
      existing.innerHTML = `
        <div class="pause-overlay-content">
          <h1 class='pause-title'>PAUSED</h1>
          <p id='pause-overlay-reason' class='pause-reason'></p>
          <div id='pause-btn-row' class='pause-btn-row'>
            <button id='btn-resume' class='pause-btn'>Resume</button>
            <button id='btn-restart' class='pause-btn'>Restart</button>
            <button id='btn-mainmenu' class='pause-btn'>Main Menu</button>
          </div>
          <div id='pause-audio' class='pause-audio'>
            <div class='pause-audio-title'>AUDIO</div>
            <div class='pause-audio-row'>
              <span class='pause-audio-label'>Volume</span>
              <input id='pause-volume' type='range' min='0' max='1' step='0.01' />
              <span id='pause-volume-val' class='pause-audio-val'></span>
            </div>
          </div>
          <p class='pause-hint'>Esc = Resume  •  M = Main Menu</p>
        </div>`;
      document.body.appendChild(existing);
    }
    this.el = existing;
  // Removed global bubble-phase key listener to avoid double ESC handling race.
  }

  private ensureButtonHandlers() {
    if (this.buttonsHooked) return;
    this.buttonsHooked = true;
    const resumeBtn = this.el.querySelector('#btn-resume');
  const mainBtn = this.el.querySelector('#btn-mainmenu');
  const restartBtn = this.el.querySelector('#btn-restart');
  resumeBtn?.addEventListener('click', () => this.requestResume());
  mainBtn?.addEventListener('click', () => this.returnToMenu());
  restartBtn?.addEventListener('click', () => this.restartRun());
  this.initAudioControls();
  }

  private requestResume() {
    if (!this.visible) return;
  // Call game.resume() directly (more robust than event-only path)
  try { this.game.resume(); } catch { /* ignore */ }
  // Also emit resume event for any external listeners
  (window as any).dispatchEvent(new CustomEvent('resumeGame'));
  // Let Game.resume trigger hide; only force hide if still visible shortly after
  setTimeout(() => { if (this.visible) this.hide(); }, 200);
  }

  private returnToMenu() {
    if (!this.visible) return;
    this.hide();
  try { (this.game as any).stopToMainMenu(); } catch {}
  window.dispatchEvent(new CustomEvent('showMainMenu'));
  }

  private restartRun() {
    if (!this.visible) return;
    try {
      // Use currently selected character data from game (if tracked) or fallback
      const data = (this.game as any).selectedCharacterData;
  // Clear flags and arm pending initial upgrade + cinematic start
  try { (this.game as any).initialUpgradeOffered = false; } catch {}
  try { (this.game as any).pendingInitialUpgrade = true; } catch {}
  // Hide pause first so cinematic is visible
  this.hide();
  // Perform reset (does not auto-start loop) then launch cinematic sequence
  this.game.resetGame(data);
  // Start full cinematic + later GAME state triggers initial upgrade popup
  this.game.startCinematicAndGame();
    } catch { /* silent */ }
  }

  private async initAudioControls() {
    const slider = this.el.querySelector('#pause-volume') as HTMLInputElement | null;
    const valEl = this.el.querySelector('#pause-volume-val') as HTMLElement | null;
    if (!slider) return;
    try {
      const { Howler } = await import('howler');
      const setVal = () => { if (valEl) valEl.textContent = Math.round(Howler.volume()*100)+'%'; };
      slider.value = String(Howler.volume());
      setVal();
      slider.oninput = () => { Howler.volume(parseFloat(slider.value)); setVal(); };
    } catch { /* ignore */ }
  }

  public show(auto: boolean) {
    if (this.visible) return;
    this.auto = auto;
    this.visible = true;
  this.suppressEscUntil = performance.now() + 140; // swallow the ESC that invoked pause
    const reason = this.el.querySelector('#pause-overlay-reason') as HTMLElement | null;
    if (reason) {
      if (auto) {
        reason.style.display = 'block';
        reason.textContent = 'Focus lost – game auto‑paused.';
      } else {
        reason.textContent = '';
        reason.style.display = 'block'; // keep height consistent
      }
    }
    this.el.style.display = 'block';
    matrixBackground.start();
    this.ensureButtonHandlers();
    // Add capture-level ESC handler to guarantee resume even if focused element swallows key
    this.escCaptureHandler = (e: KeyboardEvent) => {
      if (!this.visible) return;
      const k = e.key;
      if (k === 'Escape') {
        if (performance.now() < this.suppressEscUntil) { // swallow the triggering ESC
          e.preventDefault();
          return;
        }
        e.preventDefault();
        this.requestResume();
      } else if (k === 'm' || k === 'M') {
        e.preventDefault();
        this.returnToMenu();
      }
    };
    document.addEventListener('keydown', this.escCaptureHandler, true);
  }

  public hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.display = 'none';
    matrixBackground.stop();
    if (this.escCaptureHandler) {
      document.removeEventListener('keydown', this.escCaptureHandler, true);
      this.escCaptureHandler = undefined;
    }
  }
}

// Helper for lazy external access
export function ensurePauseOverlay(game: Game): PauseOverlay {
  let overlay = (window as any).__pauseOverlay as PauseOverlay | undefined;
  if (!overlay) {
    overlay = new PauseOverlay(game);
    (window as any).__pauseOverlay = overlay;
  }
  return overlay;
}
