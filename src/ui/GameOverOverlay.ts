import { Game } from '../game/Game';
import { matrixBackground } from './MatrixBackground';
import { HighScoreService } from '../auth/HighScoreService';
import { googleAuthService } from '../auth/AuthService';
import { RemoteLeaderboardService } from '../auth/RemoteLeaderboardService';
import { ScoreLogService } from '../auth/ScoreLogService';

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
  const style = document.createElement('style');
  style.textContent = `.go-highscores{margin-top:14px}.go-highscores .hs-title{font-size:14px;opacity:.8;margin-bottom:4px}
  .hs-row{display:flex;justify-content:space-between;font-size:12px;padding:2px 6px;border:1px solid rgba(0,255,255,0.15);border-radius:4px;margin-bottom:2px}
  .hs-row.first{background:linear-gradient(90deg,#8a6 0,#444 100%);color:#fff}
  .hs-row.me{outline:1px solid #0ff}
  .hs-empty{font-size:12px;opacity:.6;padding:4px 2px}
  `;
  document.head.appendChild(style);
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
    // Record high score (using kill count as score baseline for now)
    (async () => {
      try {
  const characterId = (this.game as any).selectedCharacterData?.id || 'unknown';
  const mode = (this.game as any).currentMode || 'SHOWDOWN';
  const score = this.game.getKillCount();
        let wasHigh = false;
        let top: any[] = [];
        const remote = RemoteLeaderboardService.isAvailable();
        try {
          await RemoteLeaderboardService.submit(score, { mode, characterId, level, durationSec: duration });
          top = await RemoteLeaderboardService.getTop(mode, characterId, 20);
          // Determine if our score is present and top
          const user = googleAuthService.getCurrentUser();
          const myIdx = top.findIndex(e=> user && e.userId === user.id && e.score === score);
          if (myIdx === 0) wasHigh = true; // top spot
        } catch {
          // Remote path failed; fall back to local record
          top = [];
        }
        if (!top.length) {
          // Remote unavailable or failed -> use local service (ensures one entry only)
          wasHigh = HighScoreService.record(score, { mode, characterId, level, durationSec: duration });
          top = HighScoreService.getTop(mode, characterId, 20);
        }
        const user = googleAuthService.getCurrentUser();
  // Removed LOCAL/GLOBAL labeling per requirement
        // Final defensive dedup (user+score) in case backend or local layer produced duplicates
        const seen = new Set<string>();
        const final: any[] = [];
        for (const e of top) {
          const k = (e.userId || e.nickname) + ':' + e.score;
            if (seen.has(k)) continue;
            seen.add(k);
            final.push(e);
        }
  // Log (always, remote or local path)
  ScoreLogService.log({ score, mode, characterId, level, durationSec: duration, source: remote ? 'remote' : 'local-fallback' });
  const topHtml = `<div class='go-highscores'><div class='hs-title'>Top 20 ${mode} / ${characterId}</div>` +
          (final.length ? final.map((e,i)=> `<div class='hs-row ${i===0?'first':''} ${user && e.userId===user.id?'me':''}'><span class='rank'>${i+1}</span><span class='nick'>${e.nickname}</span><span class='score'>${e.score}</span></div>`).join('') : '<div class="hs-empty">No remote scores yet.</div>') +
          '</div>';
        const baseStats = stats.map(s=>`<div class='go-stat'><span class='label'>${s[0]}</span><span class='value'>${s[1]}</span></div>`).join('');
        this.statsEl.innerHTML = baseStats + topHtml + (wasHigh ? "<div class='new-hs-banner'>NEW HIGH SCORE</div>" : '');
      } catch {
        this.statsEl.innerHTML = stats.map(s=>`<div class='go-stat'><span class='label'>${s[0]}</span><span class='value'>${s[1]}</span></div>`).join('');
      }
    })();
  }

  public show() {
    if (this.visible) return;
    this.visible = true;
    this.buildStats();
    // Auto-refresh leaderboard every 5 seconds while visible
    const refreshLoop = () => {
      if (!this.visible) return;
      try { this.buildStats(); } catch {/* ignore */}
      if (this.visible) setTimeout(refreshLoop, 5000);
    };
    setTimeout(refreshLoop, 5000);
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
