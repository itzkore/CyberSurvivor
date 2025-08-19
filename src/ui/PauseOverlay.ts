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
      existing.style.position = 'fixed';
      existing.style.top = '0';
      existing.style.left = '0';
      existing.style.width = '100%';
      existing.style.height = '100%';
      existing.style.background = 'rgba(0,0,0,0.78)';
      existing.style.display = 'none';
      existing.style.zIndex = '1700'; // Above matrix canvas (1600)
      existing.style.backdropFilter = 'blur(2px)';
      existing.style.pointerEvents = 'auto';
      existing.style.userSelect = 'none';
      existing.style.fontFamily = 'Consolas, "Source Code Pro", monospace';
      existing.style.color = '#b3f5e6';
      existing.style.textShadow = '0 0 6px #00ffaa44';
      existing.style.display = 'none';
      existing.innerHTML = `
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;max-width:720px;padding:48px 56px;border:1px solid #00b3a3;box-shadow:0 0 28px #00ffdd33, inset 0 0 28px #00ffdd11;border-radius:14px;background:linear-gradient(145deg,rgba(0,25,28,0.35),rgba(0,12,14,0.55));backdrop-filter:blur(4px);">
          <h1 style='margin:0 0 12px;font-size:56px;letter-spacing:6px;font-weight:600;'>PAUSED</h1>
          <p id='pause-overlay-reason' style='margin:0 0 22px;font-size:18px;opacity:.78;min-height:22px;'></p>
            <div id='pause-btn-row' style='display:flex;justify-content:center;gap:22px;margin:0 0 26px;flex-wrap:wrap;'>
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
          <p style='margin:0;font-size:13px;opacity:.42;'>Esc = Resume  •  M = Main Menu</p>
        </div>`;
      // Inject lightweight button styling once
      const styleId = 'pause-overlay-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          #pause-overlay .pause-btn { background:rgba(0,180,165,0.12); color:#bff; font-size:16px; letter-spacing:1px; padding:14px 34px; border:1px solid #00b3a3; border-radius:8px; cursor:pointer; font-family:Consolas,'Source Code Pro',monospace; position:relative; overflow:hidden; transition:background .18s, transform .18s, box-shadow .18s; }
          #pause-overlay .pause-btn:before { content:''; position:absolute; inset:0; background:linear-gradient(100deg,rgba(0,255,230,0.25),rgba(0,140,120,0) 60%); opacity:0; transition:opacity .25s; }
          #pause-overlay .pause-btn:hover:before { opacity:1; }
          #pause-overlay .pause-btn:hover { background:rgba(0,210,195,0.18); box-shadow:0 0 12px #00ffe533, 0 0 2px #00ffe5 inset; transform:translateY(-2px); }
          #pause-overlay .pause-btn:active { transform:translateY(0); filter:brightness(.9); }
          #pause-overlay .pause-audio { margin:0 0 28px; padding:18px 22px 24px; border:1px solid #00b3a3; border-radius:12px; background:linear-gradient(135deg,rgba(0,40,44,0.25),rgba(0,18,20,0.35)); box-shadow:0 0 18px #00ffe511 inset, 0 0 14px #00ffe522; max-width:520px; margin-left:auto; margin-right:auto; }
          #pause-overlay .pause-audio-title { font-size:18px; letter-spacing:4px; margin:0 0 14px; font-weight:600; color:#bff; text-shadow:0 0 8px #00ffe5; }
          #pause-overlay .pause-audio-row { display:flex; align-items:center; gap:14px; }
          #pause-overlay .pause-audio-label { font-size:14px; letter-spacing:2px; color:#bff; }
          #pause-overlay .pause-audio-val { font-size:13px; min-width:42px; text-align:right; letter-spacing:1px; color:#bff; }
          #pause-overlay input[type=range] { -webkit-appearance:none; width:260px; height:6px; background:rgba(0,255,230,0.15); border-radius:4px; outline:none; border:1px solid #00b3a3; box-shadow:0 0 6px #00ffe522 inset; }
          #pause-overlay input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:18px; height:18px; border-radius:50%; background:#00ffe5; border:2px solid #014a44; box-shadow:0 0 10px #00ffe5aa, 0 0 2px #fff inset; cursor:pointer; transition:transform .15s, box-shadow .15s; }
          #pause-overlay input[type=range]::-webkit-slider-thumb:hover { transform:scale(1.15); box-shadow:0 0 14px #00ffe5ff, 0 0 2px #fff inset; }
          #pause-overlay input[type=range]::-moz-range-track { height:6px; background:rgba(0,255,230,0.15); border:1px solid #00b3a3; border-radius:4px; }
          #pause-overlay input[type=range]::-moz-range-thumb { width:18px; height:18px; border-radius:50%; background:#00ffe5; border:2px solid #014a44; box-shadow:0 0 10px #00ffe5aa, 0 0 2px #fff inset; cursor:pointer; }
        `;
        document.head.appendChild(style);
      }
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
