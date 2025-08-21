import { Game } from '../game/Game';
import { matrixBackground } from './MatrixBackground';
import { googleAuthService } from '../auth/AuthService';
import { submitScore, submitScoreAllPeriods, getPlayerId, sanitizeName, isLeaderboardConfigured, fetchTop, fetchPlayerEntry, resolveBoard } from '../leaderboard';

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
  const kills = this.game.getKillCount();
  const timeSec = duration; // survival time in seconds
  const score = timeSec; // primary metric
  // Submit to global board (extend later)
  const pid = getPlayerId();
  const user = googleAuthService.getCurrentUser();
  const name = sanitizeName(user?.nickname || user?.name || 'Guest');
  const maxDpsVal = Math.round((this.game as any).hud?.maxDPS || this.game.getCurrentDPS());
  let topHtml = '';
  if (isLeaderboardConfigured()) {
    // Always submit even if guest (guest runs can still appear)
  // Unified multi-board submission
  try { await submitScoreAllPeriods({ playerId: pid, name, timeSec, kills, level, maxDps: maxDpsVal }); } catch {}
    try {
      const top = await fetchTop('global', 10, 0);
      const me = pid;
      const fmt = (t:number)=>{
        const m=Math.floor(t/60).toString().padStart(2,'0');
        const s=(t%60).toString().padStart(2,'0');
        return m+':'+s;
      };
      if (top.length) {
        let hint = '';
        if (!user) hint = "<div class='hs-empty'>Guest run saved. Login to reserve a nickname.</div>";
        // If player not in top list, fetch their rank separately
        let myRow = '';
        if (!top.some(e=>e.playerId===me)) {
          const entry = await fetchPlayerEntry('global', me);
            if (entry) {
              myRow = `<div class='hs-row me'><span class='rank'>${entry.rank}</span><span class='nick'>${sanitizeName(entry.name)}</span><span class='time'>${fmt(entry.timeSec)}</span><span class='kills'>${entry.kills??'-'}</span><span class='lvl'>${entry.level??'-'}</span></div>`;
            }
        }
        topHtml = `<div class='go-highscores'><div class='hs-title'>Survived ${fmt(timeSec)} · Kills ${kills}</div>`+hint+
          `<div class='hs-row hs-head'><span class='rank'>#</span><span class='nick'>NAME</span><span class='time'>TIME</span><span class='kills'>K</span><span class='lvl'>Lv</span></div>`+
          top.map(e=>`<div class='hs-row ${e.playerId===me?'me':''}'><span class='rank'>${e.rank}</span><span class='nick'>${sanitizeName(e.name)}</span><span class='time'>${fmt(e.timeSec)}</span><span class='kills'>${e.kills??'-'}</span><span class='lvl'>${e.level??'-'}</span></div>`).join('')+myRow+
          `</div>`;
      } else {
        const hint = user ? 'No scores yet.' : 'No scores yet. First guest run will appear.';
        topHtml = `<div class='go-highscores'><div class='hs-title'>Survived ${fmt(timeSec)} · Kills ${kills}</div><div class='hs-empty'>${hint}</div></div>`;
      }
    } catch {
      const mm = Math.floor(timeSec/60).toString().padStart(2,'0');
      const ss = (timeSec%60).toString().padStart(2,'0');
      topHtml = `<div class='go-highscores'><div class='hs-title'>Survived ${mm}:${ss} · Kills ${kills}</div><div class='hs-empty'>Error loading leaderboard.</div></div>`;
    }
  } else {
    const mm = Math.floor(timeSec/60).toString().padStart(2,'0');
    const ss = (timeSec%60).toString().padStart(2,'0');
    topHtml = `<div class='go-highscores'><div class='hs-title'>Survived ${mm}:${ss} · Kills ${kills}</div><div class='hs-empty'>Leaderboard not configured.</div></div>`;
  }
  const baseStats = stats.map(s=>`<div class='go-stat'><span class='label'>${s[0]}</span><span class='value'>${s[1]}</span></div>`).join('');
  this.statsEl.innerHTML = baseStats + topHtml;
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
