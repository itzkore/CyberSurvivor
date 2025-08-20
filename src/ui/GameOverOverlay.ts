import { Game } from '../game/Game';
import { matrixBackground } from './MatrixBackground';

/** Cinematic themed Game Over overlay */
export class GameOverOverlay {
  private el: HTMLDivElement;
  private game: Game;
  private visible = false;
  private buttonsHooked = false;
  private statsEl!: HTMLDivElement;

  constructor(game: Game) {
    this.game = game;
    let existing = document.getElementById('gameover-overlay') as HTMLDivElement | null;
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'gameover-overlay';
      existing.innerHTML = `
        <div class="go-death-flash" id="death-flash"></div>
        <div class="go-container">
          <h1 class="go-title">DEFEATED</h1>
          <div class="go-sub">Humanity remembers your stand.</div>
          <div class="go-stats" id="go-stats"></div>
          <div class="go-buttons">
            <button class="go-btn" data-action="restart">Restart Run</button>
            <button class="go-btn" data-action="character">Character Select</button>
            <button class="go-btn" data-action="menu">Main Menu</button>
          </div>
          <div class="go-hint">Enter = Restart · Esc = Main Menu</div>
        </div>`;
      document.body.appendChild(existing);
    }
    this.el = existing;
    this.statsEl = existing.querySelector('#go-stats') as HTMLDivElement;
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.key === 'Enter') { this.restart(); }
      if (e.key === 'Escape') { this.toMenu(); }
    });
    window.addEventListener('showGameOverOverlay', () => {
      this.show();
    });
  }

  private ensureButtons() {
    if (this.buttonsHooked) return;
    this.buttonsHooked = true;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest) return;
      const btn = t.closest('[data-action]') as HTMLElement | null;
      if (!btn) return;
      const act = btn.getAttribute('data-action');
      switch (act) {
        case 'restart': this.restart(); break;
        case 'character': this.characterSelect(); break;
        case 'menu': this.toMenu(); break;
      }
    });
  }

  private buildStats() {
    // Simple runtime stats; extend with more metrics later
  const duration = Math.floor(this.game.getGameTime());
    const mins = Math.floor(duration / 60).toString().padStart(2,'0');
    const secs = (duration % 60).toString().padStart(2,'0');
  const level = this.game.player.level;
  const maxDps = Math.round((this.game as any).hud?.maxDPS || this.game.getCurrentDPS());
    const stats: [string,string][] = [
      ['Time', `${mins}:${secs}`],
      ['Level', `${level}`],
      ['Kill Count', `${this.game.getKillCount()}`],
      ['Max DPS', `${maxDps}`]
    ];
    this.statsEl.innerHTML = stats.map(s=>`<div class='go-stat'><span class='label'>${s[0]}</span><span class='value'>${s[1]}</span></div>`).join('');
  }

  public show() {
    if (this.visible) return;
    this.visible = true;
    this.buildStats();
    this.el.classList.add('visible');
    matrixBackground.start();
    this.ensureButtons();
    // Trigger white flash
    const flash = this.el.querySelector('#death-flash') as HTMLDivElement | null;
    if (flash) {
      flash.style.animation = 'none'; // reset
      void flash.offsetWidth; // reflow
      flash.style.animation = 'death-flash 2s linear forwards';
    }
  }
  public hide() { if (!this.visible) return; this.visible = false; this.el.classList.remove('visible'); matrixBackground.stop(); }
  private restart() { const data = (this.game as any).selectedCharacterData; this.hide(); this.game.resetGame(data); }
  private characterSelect() { this.hide(); window.dispatchEvent(new CustomEvent('showCharacterSelect')); }
  private toMenu() { this.hide(); window.dispatchEvent(new CustomEvent('showMainMenu')); }
}

export function ensureGameOverOverlay(game: Game): GameOverOverlay {
  let ov = (window as any).__gameOverOverlay as GameOverOverlay | undefined;
  if (!ov) { ov = new GameOverOverlay(game); (window as any).__gameOverOverlay = ov; }
  return ov;
}
