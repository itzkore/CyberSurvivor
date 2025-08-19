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
      existing.style.position = 'fixed';
      existing.style.inset = '0';
      existing.style.display = 'none';
      existing.style.zIndex = '1800';
  existing.style.background = 'radial-gradient(circle at 50% 40%, rgba(10,30,45,0.92) 0%, rgba(5,10,18,0.92) 55%, rgba(4,8,14,0.95) 100%)';
      existing.style.backdropFilter = 'blur(4px)';
      existing.style.fontFamily = 'Orbitron, Consolas, monospace';
      existing.style.color = '#dff';
      existing.style.userSelect = 'none';
      existing.innerHTML = `
  <div id="death-flash" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;"></div>
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
      const styleId = 'gameover-overlay-style';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
          #gameover-overlay { animation: go-fade .5s ease forwards; }
          #gameover-overlay .go-container { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) scale(1); width:min(100%,880px); padding:70px 80px 60px; border:1px solid #00ffe0; border-radius:18px; background:linear-gradient(145deg,rgba(0,40,55,0.55),rgba(0,18,28,0.85)); box-shadow:0 0 32px #00ffe022, inset 0 0 40px #00ffe010; text-align:center; animation: go-container-in .55s cubic-bezier(.16,.7,.3,1); }
          .go-title { margin:0 0 12px; font-size:78px; letter-spacing:10px; font-weight:700; background:linear-gradient(120deg,#00fff2,#74fffd,#ff4df2); -webkit-background-clip:text; color:transparent; filter:drop-shadow(0 0 12px #00fff2); }
          .go-sub { font-size:18px; opacity:.68; margin-bottom:34px; letter-spacing:2px; }
          .go-stats { display:flex; flex-wrap:wrap; justify-content:center; gap:26px 40px; margin:0 0 44px; font-size:14px; letter-spacing:1px; }
          .go-stat { min-width:120px; }
          .go-stat .label { display:block; font-size:11px; opacity:.55; letter-spacing:.15em; text-transform:uppercase; margin-bottom:4px; }
          .go-stat .value { font-size:22px; font-weight:600; color:#fff; text-shadow:0 0 8px #00fff2; }
          .go-buttons { display:flex; flex-wrap:wrap; gap:20px; justify-content:center; margin-bottom:34px; }
          .go-btn { background:linear-gradient(140deg,#042f37,#06444e); border:1px solid #00ffe0; color:#cfffff; font-size:17px; font-weight:600; padding:16px 42px; border-radius:12px; cursor:pointer; letter-spacing:2px; position:relative; overflow:hidden; transition:background .25s, transform .2s, box-shadow .25s; }
          .go-btn:before { content:''; position:absolute; inset:0; background:linear-gradient(110deg,rgba(0,255,230,0.35),rgba(0,140,120,0) 60%); opacity:0; transition:opacity .35s; }
          .go-btn:hover:before { opacity:1; }
          .go-btn:hover { transform:translateY(-3px); box-shadow:0 0 18px #00ffe044, 0 0 2px #00ffe0 inset; }
          .go-btn:active { transform:translateY(-1px); filter:brightness(.9); }
          .go-hint { font-size:12px; opacity:.45; letter-spacing:.3em; }
          #death-flash { animation: none; }
          @media (max-width:960px){ .go-container { padding:60px 40px 54px; } .go-title{ font-size:60px; letter-spacing:6px; } }
          @media (max-width:640px){ .go-container { padding:50px 28px 48px; } .go-title{ font-size:48px; } .go-buttons{ gap:14px; } .go-btn{ padding:14px 32px; font-size:15px; } }
          @keyframes go-fade { from { opacity:0; } to { opacity:1; } }
          @keyframes go-container-in { 0% { opacity:0; transform:translate(-50%,-50%) scale(1.08); filter:blur(4px); } 60% { filter:blur(0); } 100% { opacity:1; transform:translate(-50%,-50%) scale(1); } }
          @keyframes death-flash { 0% { opacity:1; } 100% { opacity:0; } }
        `;
        document.head.appendChild(style);
      }
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
    this.el.style.display = 'block';
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
  public hide() { if (!this.visible) return; this.visible = false; this.el.style.display='none'; matrixBackground.stop(); }
  private restart() { const data = (this.game as any).selectedCharacterData; this.hide(); this.game.resetGame(data); }
  private characterSelect() { this.hide(); window.dispatchEvent(new CustomEvent('showCharacterSelect')); }
  private toMenu() { this.hide(); window.dispatchEvent(new CustomEvent('showMainMenu')); }
}

export function ensureGameOverOverlay(game: Game): GameOverOverlay {
  let ov = (window as any).__gameOverOverlay as GameOverOverlay | undefined;
  if (!ov) { ov = new GameOverOverlay(game); (window as any).__gameOverOverlay = ov; }
  return ov;
}
