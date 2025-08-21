import { Logger } from '../core/Logger';
import { matrixBackground } from './MatrixBackground';
import { CHARACTERS } from '../data/characters';
// Static imports for auth/score services to avoid mixed dynamic+static warnings in Vite
import { googleAuthService } from '../auth/AuthService';
import { fetchTop, getPlayerId, resolveBoard, sanitizeName, isLeaderboardConfigured, fetchPlayerEntry, loadSnapshot } from '../leaderboard';

interface PlayerProfile {
  currency: number;
  permanentUpgrades: {
    healthBoost: number;
    damageBoost: number;
    speedBoost: number;
    luckBoost: number;
  };
  unlockedCharacters: string[];
  highScores: { [characterId: string]: number };
}

export class MainMenu {
  private mainMenuElement: HTMLElement | null = null;
  private gameInstance: any;
  private matrixDrops?: number[];
  private _matrixChars?: string[];
  private playerProfile: PlayerProfile;
  private selectedMode: 'SHOWDOWN' | 'DUNGEON' = 'SHOWDOWN';
  private authUnsub?: () => void;
  private authUser: import('../auth/AuthService').GoogleUserProfile | null = null;
  private incrementalEntries: any[] = [];
  private playerId: string = getPlayerId();
  private currentBoard: string = 'global';

  constructor(game: any) {
    this.gameInstance = game;
    this.playerProfile = this.loadPlayerProfile();
    this.removeOldElements();
    this.createMainMenu();
    // Ensure Cyber Runner is the default selected operative if none chosen yet
    this.setDefaultCharacter();
    this.setupEventListeners();
    this.initializeMatrix();
  }

  /**
   * Sets Cyber Runner as the default selected character on the main menu
   * so the player can immediately start without opening the select panel.
   * Won't override an existing selection (e.g., returning to menu).
   */
  private setDefaultCharacter(): void {
    if (this.gameInstance.selectedCharacterData) return; // Preserve prior selection
    const cyber = CHARACTERS.find(c => c.id === 'cyber_runner');
    if (cyber) {
      this.gameInstance.selectedCharacterData = cyber;
      this.updateCharacterPreview(cyber);
      Logger.info('MainMenu: Default character set to cyber_runner');
    } else {
      Logger.warn('MainMenu: cyber_runner character not found in CHARACTERS list');
    }
  }

  private removeOldElements(): void {
    // Remove any old menu elements
    const oldMenu = document.getElementById('main-menu');
    const oldCharacterSelect = document.getElementById('character-select-panel');
    
    if (oldMenu) oldMenu.remove();
    if (oldCharacterSelect) oldCharacterSelect.remove();
  }

  private loadPlayerProfile(): PlayerProfile {
    const saved = localStorage.getItem('cybersurvivor-profile');
    if (saved) {
      return JSON.parse(saved);
    }
    return {
      currency: 0,
      permanentUpgrades: {
        healthBoost: 0,
        damageBoost: 0,
        speedBoost: 0,
        luckBoost: 0
      },
      unlockedCharacters: ['wasteland_scavenger', 'tech_warrior', 'heavy_gunner'],
      highScores: {}
    };
  }

  private savePlayerProfile(): void {
    localStorage.setItem('cybersurvivor-profile', JSON.stringify(this.playerProfile));
  }

  private createMainMenu(): void {
    this.mainMenuElement = document.createElement('div');
    this.mainMenuElement.id = 'main-menu';
    this.mainMenuElement.className = 'cyberpunk-main-menu';
    this.mainMenuElement.innerHTML = `
      <div class="matrix-bg-overlay"></div>
      <div class="main-menu-shell" id="main-menu-adaptive">
        <header class="mm-header">
          <div class="logo-block">
            <div class="logo-main">CYBER<span>SURVIVOR</span></div>
            <div class="version-tag">ALPHA v1.0.0</div>
          </div>
          <div class="profile-block">
            <div class="currency-display compact">
              <span class="currency-icon">⚡</span>
              <span id="currency-amount">${this.playerProfile.currency}</span>
            </div>
            <div class="auth-container" id="auth-container">
              <button class="cyberpunk-btn tertiary-btn tight hidden-init" id="login-btn">
                <span class="btn-text">SIGN IN</span>
                <span class="btn-glow"></span>
              </button>
              <div class="auth-profile hidden-init" id="auth-profile">
                <img id="auth-avatar" class="auth-avatar" alt="User" />
                <div class="auth-meta">
                  <div class="auth-nick" id="auth-name"></div>
                  <div class="auth-email" id="auth-email"></div>
                </div>
                <button id="logout-btn" class="mini-logout" title="Sign Out">✕</button>
              </div>
            </div>
          </div>
        </header>
        <main class="mm-main">
          <section class="panel left nav-panel">
            <button class="main-cta" id="start-mission-btn">START RUN</button>
            <div class="mode-select-block">
              <label for="game-mode-select">MODE</label>
              <select id="game-mode-select" class="mode-select">
                <option value="SHOWDOWN" selected>Showdown (Open)</option>
                <option value="DUNGEON">Dungeon (Rooms)</option>
              </select>
              <div id="mode-desc" class="mode-desc"></div>
            </div>
            <div class="nav-buttons">
              <button class="nav-btn" id="character-select-btn">Operatives</button>
              <button class="nav-btn" id="upgrades-btn">Upgrades ${this.playerProfile.currency > 0 ? '<span class="notification-dot"></span>' : ''}</button>
              <button class="nav-btn" id="statistics-btn">Statistics</button>
            </div>
          </section>
          <section class="panel center preview-panel" id="character-preview">
            <div class="preview-portrait" id="preview-portrait">
              <img src="${(window as any).AssetLoader ? (window as any).AssetLoader.normalizePath('/assets/player/wasteland_scavenger.png') : (location.protocol==='file:'?'./assets/player/wasteland_scavenger.png':(location.pathname.split('/').filter(Boolean)[0]? '/' + location.pathname.split('/').filter(Boolean)[0] + '/assets/player/wasteland_scavenger.png':'/assets/player/wasteland_scavenger.png'))}" alt="Character" />
            </div>
            <div class="preview-meta">
              <div class="preview-name" id="preview-name">Select Character</div>
              <div class="preview-stats" id="preview-stats"></div>
            </div>
          </section>
          <section class="panel right highscores-panel" id="highscores-panel">
            <div class="hs-header" id="hs-title">HIGHSCORES</div>
            <div class="hs-board-select" style="margin:4px 0 6px;display:flex;gap:4px;flex-wrap:wrap">
              <button class="nav-btn mini" data-board="global" style="padding:3px 6px;font-size:11px">Global</button>
              <button class="nav-btn mini" data-board="daily:auto" style="padding:3px 6px;font-size:11px">Daily</button>
              <button class="nav-btn mini" data-board="weekly:auto" style="padding:3px 6px;font-size:11px">Weekly</button>
              <button class="nav-btn mini" data-board="monthly:auto" style="padding:3px 6px;font-size:11px">Monthly</button>
            </div>
            <div class="hs-panel" id="hs-remote-board">No scores yet.</div>
            <button class="nav-btn" id="hs-load-more" style="margin-top:6px;font-size:11px;padding:4px 6px;">Load More</button>
          </section>
        </main>
        <footer class="mm-footer">
          <div class="status-line"><span class="status-dot"></span>NEURAL LINK STABLE</div>
          <div class="hint-line">ESC = Pause · ENTER = Confirm</div>
        </footer>
      </div>`;

    document.body.appendChild(this.mainMenuElement);
    // Adaptive scaling
    import('./ViewportScaler').then(mod => {
      const adaptive = document.getElementById('main-menu-adaptive');
      if (adaptive) mod.attachAdaptiveScaler(adaptive as HTMLElement, {
        baseWidth: 1920,
        baseHeight: 1080,
        // Stretch so the logical canvas fills viewport (no margins)
        // Allow independent X/Y scaling; enable vertical expansion.
        minScale: 0.5,
        maxScale: 3,
        allowUpscale: true,
        mode: 'stretch',
        adaptiveHeight: true
      });
    }).catch(()=>{});
    // Show sound panel (if exists) while in main menu
    const soundPanel = document.getElementById('sound-settings-panel');
    if (soundPanel) soundPanel.style.display = 'block';
    // Auth init (static import to avoid chunk duplication warnings)
    const loginBtn = document.getElementById('login-btn');
    const authProfile = document.getElementById('auth-profile');
    if (loginBtn) {
      // Always keep button enabled so we can capture clicks for diagnostics; attempt lazy config refresh.
      if (!googleAuthService.isConfigured()) {
        const refreshed = googleAuthService.refreshClientIdFromMeta?.();
        if (!refreshed) {
          loginBtn.title = 'Google Sign-In not yet configured (meta missing)';
        } else {
          loginBtn.title = 'Sign in with Google';
        }
      } else {
        loginBtn.title = 'Sign in with Google';
      }
      loginBtn.removeAttribute('disabled');
      loginBtn.style.display = 'inline-flex';
      loginBtn.classList.remove('hidden-init');
      loginBtn.addEventListener('click', () => {
        Logger.info('[AuthUI] SIGN IN raw click handler entered (configured=' + googleAuthService.isConfigured() + ', ready=' + googleAuthService.isReady() + ')');
        if (!googleAuthService.isConfigured()) {
          const refreshed = googleAuthService.refreshClientIdFromMeta?.();
          Logger.warn('[AuthUI] Not configured on click; refresh attempt result=', refreshed);
          if (!refreshed) return; // still not configured
        }
        Logger.info('[AuthUI] SIGN IN clicked');
        // If GIS not ready yet, immediately attempt new-tab flow (synchronous window.open) to avoid popup blocking.
        if (!googleAuthService.isReady()) {
          Logger.info('[AuthUI] GIS not ready – launching new-tab id_token flow and preloading script');
          googleAuthService.openNewTabSignIn().catch(e=>Logger.warn('[AuthUI] new-tab flow error', e));
          // Kick off preload (no await so gesture remains for window.open already executed)
          googleAuthService.preload().catch(()=>{});
          return;
        }
        // Try popup access token flow first (non-blocking); don't await before potential fallbacks.
        googleAuthService.popupAccessSignIn().then(user => {
          if (user) { Logger.info('[AuthUI] popup access flow succeeded'); return; }
          Logger.info('[AuthUI] popup access flow returned null, trying new-tab');
          return googleAuthService.openNewTabSignIn();
        }).then(user => {
          if (user) { Logger.info('[AuthUI] new-tab flow succeeded'); return; }
          Logger.info('[AuthUI] new-tab flow returned null, opening fallback modal');
          return googleAuthService.openLogin();
        }).catch(e => {
          Logger.warn('[AuthUI] sign-in sequence error', e);
          googleAuthService.openLogin().catch(()=>{});
        });
      });
    }
    if (authProfile) {
      authProfile.addEventListener('click', () => {
        const dd = document.getElementById('auth-dropdown');
        if (dd) dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
      });
    }
    // Proactively preload GIS script in background after slight delay to mitigate first-click latency.
    if (googleAuthService.isConfigured()) {
      setTimeout(()=>{ googleAuthService.preload().catch(()=>{}); }, 200);
    }

    // --- Instrumentation for diagnosing missing click events ---
    // Global capture listener to log any click events hitting or bubbling from the login button.
    if (!(window as any).__loginBtnDebugInstalled) {
      (window as any).__loginBtnDebugInstalled = true;
      window.addEventListener('click', (ev) => {
        const t = ev.target as HTMLElement | null;
        if (!t) return;
        if (t.id === 'login-btn' || t.closest('#login-btn')) {
          Logger.info('[AuthUI][Debug] Global click observed on #login-btn (target=' + t.tagName + ')');
        }
      }, true);
    }
    // Force pointer-events + z-index for safety (some cascading styles may interfere in certain layouts/resolutions).
    const lb = document.getElementById('login-btn') as HTMLElement | null;
    if (lb) { lb.style.pointerEvents = 'auto'; lb.style.zIndex = '1000'; }
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      googleAuthService.signOut();
      const dd = document.getElementById('auth-dropdown');
      if (dd) dd.style.display = 'none';
    });
    this.authUnsub = googleAuthService.subscribe(user => {
      this.authUser = user;
      this.updateAuthUI();
      this.refreshHighScores();
    });
  // Periodic refresh (local only now) every 5s
  const loop = () => { this.refreshHighScores(); setTimeout(loop, 5000); }; setTimeout(loop, 5000);
    if (!document.getElementById('mm-hs-styles')) {
      const style = document.createElement('style');
      style.id = 'mm-hs-styles';
      style.textContent = `.highscores-panel .hs-row{display:flex;justify-content:space-between;padding:2px 4px;margin-bottom:2px;border:1px solid rgba(0,255,255,0.15);border-radius:3px;font-size:12px}.highscores-panel .hs-row.first{background:linear-gradient(90deg,#8a6 0,#333 100%);color:#fff}.highscores-panel .hs-empty{opacity:.6;font-size:11px}`;
      document.head.appendChild(style);
    }
    const loadMore = this.mainMenuElement.querySelector('#hs-load-more') as HTMLButtonElement | null;
    if (loadMore) {
      loadMore.addEventListener('click', () => {
        // For local only we already hold all entries; simply re-render (could paginate if expanded later)
        const characterId = (this.gameInstance as any).selectedCharacterData?.id || 'wasteland_scavenger';
        const modeSelect = document.getElementById('game-mode-select') as HTMLSelectElement | null;
        const mode = modeSelect?.value || 'SHOWDOWN';
        this.renderHighScoreList(mode, characterId);
      });
    }
    this.refreshHighScores();
    // Board selector events
    this.mainMenuElement.querySelectorAll('.hs-board-select [data-board]')
      .forEach(btn => btn.addEventListener('click', (e)=>{
        const b = (e.currentTarget as HTMLElement).getAttribute('data-board') || 'global';
        this.currentBoard = b;
        this.refreshHighScores();
      }));
  }

  private setupEventListeners(): void {
    const startBtn = document.getElementById('start-mission-btn');
    const characterBtn = document.getElementById('character-select-btn');
    const upgradesBtn = document.getElementById('upgrades-btn');
    const statisticsBtn = document.getElementById('statistics-btn');

    startBtn?.addEventListener('click', () => {
      if (this.gameInstance.selectedCharacterData) {
        this.hide();
        window.dispatchEvent(new CustomEvent('startGame', { 
          detail: { character: this.gameInstance.selectedCharacterData, mode: this.selectedMode } 
        }));
      } else {
        this.showCharacterSelect();
      }
    });

    characterBtn?.addEventListener('click', () => {
      this.showCharacterSelect();
    });

    upgradesBtn?.addEventListener('click', () => {
      this.showUpgrades();
    });

    statisticsBtn?.addEventListener('click', () => {
      this.showStatistics();
    });

    // Listen for character selection
    window.addEventListener('characterSelected', (event: Event) => {
      const customEvent = event as CustomEvent;
      this.gameInstance.selectedCharacterData = customEvent.detail;
      this.updateCharacterPreview(customEvent.detail);
    });

    // Listen for currency updates
    window.addEventListener('currencyEarned', (event: Event) => {
      const customEvent = event as CustomEvent;
      this.playerProfile.currency += customEvent.detail.amount;
      this.savePlayerProfile();
      this.updateCurrencyDisplay();
    });

    // Game mode select logic
    const modeSelect = document.getElementById('game-mode-select') as HTMLSelectElement | null;
    const modeDesc = document.getElementById('mode-desc');
    const updateDesc = () => {
      if (!modeSelect || !modeDesc) return;
      const v = modeSelect.value as 'SHOWDOWN' | 'DUNGEON';
      this.selectedMode = v;
      if (v === 'SHOWDOWN') {
        modeDesc.textContent = 'Showdown: Vast open cyber expanse. No walls, enemies can surround from any direction.';
      } else {
        modeDesc.textContent = 'Dungeon: Procedurally linked rooms & corridors. Funnel enemies, explore branches.';
      }
    };
    if (modeSelect) {
      modeSelect.addEventListener('change', updateDesc);
      updateDesc();
    }
  }

  private showCharacterSelect(): void {
    this.hide();
    window.dispatchEvent(new CustomEvent('showCharacterSelect'));
  }


  private showUpgrades(): void {
    // Create upgrades modal
    const upgradesModal = document.createElement('div');
    upgradesModal.className = 'cyberpunk-modal';
    upgradesModal.innerHTML = `
      <div class="modal-content upgrades-panel">
        <div class="modal-header">
          <h2>PERMANENT UPGRADES</h2>
          <button class="close-btn" id="close-upgrades">×</button>
        </div>
        <div class="upgrades-grid">
          <div class="upgrade-item">
            <div class="upgrade-icon">❤️</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Health Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.healthBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.healthBoost + 1) * 100} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="healthBoost">UPGRADE</button>
          </div>
          <div class="upgrade-item">
            <div class="upgrade-icon">⚔️</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Damage Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.damageBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.damageBoost + 1) * 150} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="damageBoost">UPGRADE</button>
          </div>
          <div class="upgrade-item">
            <div class="upgrade-icon">💨</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Speed Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.speedBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.speedBoost + 1) * 120} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="speedBoost">UPGRADE</button>
          </div>
          <div class="upgrade-item">
            <div class="upgrade-icon">🍀</div>
            <div class="upgrade-info">
              <div class="upgrade-name">Luck Boost</div>
              <div class="upgrade-level">Level ${this.playerProfile.permanentUpgrades.luckBoost}</div>
              <div class="upgrade-cost">Cost: ${(this.playerProfile.permanentUpgrades.luckBoost + 1) * 200} ⚡</div>
            </div>
            <button class="upgrade-btn" data-upgrade="luckBoost">UPGRADE</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(upgradesModal);

    // Setup upgrade button handlers
    upgradesModal.querySelectorAll('.upgrade-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const upgradeType = (e.target as HTMLElement).dataset.upgrade as keyof PlayerProfile['permanentUpgrades'];
        this.purchaseUpgrade(upgradeType);
        upgradesModal.remove();
        this.showUpgrades(); // Refresh
      });
    });

    document.getElementById('close-upgrades')?.addEventListener('click', () => {
      upgradesModal.remove();
    });
  }

  private purchaseUpgrade(upgradeType: keyof PlayerProfile['permanentUpgrades']): void {
    const costs = { healthBoost: 100, damageBoost: 150, speedBoost: 120, luckBoost: 200 };
    const cost = (this.playerProfile.permanentUpgrades[upgradeType] + 1) * costs[upgradeType];
    
    if (this.playerProfile.currency >= cost) {
      this.playerProfile.currency -= cost;
      this.playerProfile.permanentUpgrades[upgradeType]++;
      this.savePlayerProfile();
      this.updateCurrencyDisplay();
    }
  }

  private showStatistics(): void {
    const statsModal = document.createElement('div');
    statsModal.className = 'cyberpunk-modal';
    statsModal.innerHTML = `
      <div class="modal-content stats-panel">
        <div class="modal-header">
          <h2>MISSION STATISTICS</h2>
          <button class="close-btn" id="close-stats">×</button>
        </div>
        <div class="stats-content">
          <h3>High Scores</h3>
          ${Object.entries(this.playerProfile.highScores).map(([char, score]) => 
            `<div class="score-item">${char}: ${score}</div>`
          ).join('') || '<div class="no-scores">No scores yet</div>'}
        </div>
      </div>
    `;

    document.body.appendChild(statsModal);
    document.getElementById('close-stats')?.addEventListener('click', () => {
      statsModal.remove();
    });
  }

  private updateCharacterPreview(characterData: any): void {
    const previewPortrait = document.getElementById('preview-portrait')?.querySelector('img') as HTMLImageElement;
    const previewName = document.getElementById('preview-name');
    const previewStats = document.getElementById('preview-stats');

    if (previewPortrait) previewPortrait.src = characterData.icon;
    if (previewName) previewName.textContent = characterData.name;
    if (previewStats) {
      previewStats.innerHTML = `
        <div class="stat-item">
          <span class="stat-label">Health:</span>
          <span class="stat-value">${characterData.stats.hp + (this.playerProfile.permanentUpgrades.healthBoost * 10)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Damage:</span>
          <span class="stat-value">${characterData.stats.damage + (this.playerProfile.permanentUpgrades.damageBoost * 5)}</span>
        </div>
      `;
    }
  }

  private updateCurrencyDisplay(): void {
    const currencyEl = document.getElementById('currency-amount');
    if (currencyEl) currencyEl.textContent = this.playerProfile.currency.toString();
  }

  private updateAuthUI(): void {
    const loginBtn = document.getElementById('login-btn');
    const authProfile = document.getElementById('auth-profile');
    const avatar = document.getElementById('auth-avatar') as HTMLImageElement | null;
    const nameEl = document.getElementById('auth-name');
    const emailEl = document.getElementById('auth-email');
    if (!loginBtn || !authProfile) return;
    if (this.authUser) {
      loginBtn.classList.add('hidden-init');
      authProfile.classList.remove('hidden-init');
      if (avatar) avatar.src = this.authUser.picture || 'https://www.gravatar.com/avatar/?d=mp';
      if (nameEl) nameEl.textContent = this.authUser.nickname || this.authUser.name;
      if (emailEl) emailEl.textContent = this.authUser.email;
      // If profile incomplete prompt for nickname
      if (!this.authUser.profileComplete) {
        this.showNicknameModal();
      }
    } else {
  authProfile.classList.add('hidden-init');
  loginBtn.classList.remove('hidden-init');
    }
  }
  private async refreshHighScores(): Promise<void> {
    const remotePanel = document.getElementById('hs-remote-board');
    if (!remotePanel) return;
      if (!isLeaderboardConfigured()) {
        remotePanel.innerHTML = '<div class="hs-empty">Leaderboard not configured</div>';
        return;
      }
    const characterId = (this.gameInstance as any).selectedCharacterData?.id || 'wasteland_scavenger';
    const modeSelect = document.getElementById('game-mode-select') as HTMLSelectElement | null;
    const mode = modeSelect?.value || 'SHOWDOWN';
    const titleEl = document.getElementById('hs-title');
    if (titleEl) titleEl.textContent = 'HIGHSCORES';
    remotePanel.innerHTML = '<div class="hs-empty">Loading…</div>';
    try {
      const target = this.currentBoard;
      const { board } = resolveBoard(target);
      // Try snapshot immediately for responsive feel
      const snap = loadSnapshot(board, 10, 0);
      if (snap) {
        const fmtS = (t:number)=>`${Math.floor(t/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
        remotePanel.innerHTML = `<div class='hs-row hs-head'><span class='rank'>#</span><span class='nick'>NAME</span><span class='time'>TIME</span><span class='kills'>K</span><span class='lvl'>Lv</span></div>` + snap.map(e=>`<div class='hs-row'><span class='rank'>${e.rank}</span><span class='nick'>${sanitizeName(e.name)}</span><span class='time'>${fmtS(e.timeSec)}</span><span class='kills'>${e.kills??'-'}</span><span class='lvl'>${e.level??'-'}</span></div>`).join('');
      }
  const top = await fetchTop(board, 10, 0);
  // Enforce descending ordering by timeSec (defensive if backend ever returns unsorted)
  const sorted = [...top].sort((a,b)=> (b.timeSec||0) - (a.timeSec||0));
  this.incrementalEntries = sorted;
      const me = this.playerId;
      const fmt = (t:number)=>{
        const m=Math.floor(t/60).toString().padStart(2,'0');
        const s=(t%60).toString().padStart(2,'0');
        return m+':'+s;
      };
      if (sorted.length) {
        const header = `<div class='hs-row hs-head'>
          <span class='rank'>#</span>
          <span class='nick'>NAME</span>
          <span class='time'>TIME</span>
          <span class='kills'>K</span>
          <span class='lvl'>Lv</span>
        </div>`;
        remotePanel.innerHTML = header + sorted.map((e,i) => `<div class='hs-row ${e.playerId===me?'me':''}'>
          <span class='rank'>${i+1}</span>
          <span class='nick'>${sanitizeName(e.name)}</span>
          <span class='time'>${fmt(e.timeSec)}</span>
          <span class='kills'>${e.kills ?? '-'}</span>
          <span class='lvl'>${e.level ?? '-'}</span>
        </div>`).join('');
        // If I'm not in the visible list, append own real rank from backend (may be >10)
    if (!sorted.some(e=>e.playerId===me)) {
          try {
      const meEntry = await fetchPlayerEntry(board, me); // uses backend rank ordering
            if (meEntry && meEntry.rank > 10) {
              remotePanel.innerHTML += `<div class='hs-row me' style='margin-top:4px;border-top:1px solid rgba(0,255,255,0.25)'>
                <span class='rank'>${meEntry.rank}</span>
                <span class='nick'>${sanitizeName(meEntry.name)}</span>
                <span class='time'>${fmt(meEntry.timeSec)}</span>
                <span class='kills'>${meEntry.kills ?? '-'}</span>
                <span class='lvl'>${meEntry.level ?? '-'}</span>
              </div>`;
            }
          } catch {/* ignore own-rank errors */}
        }
      } else {
        remotePanel.innerHTML = '<div class=\"hs-empty\">No times.</div>';
      }
    } catch (err) {
      remotePanel.innerHTML = '<div class="hs-empty">Error loading.</div>';
    }
  }

  private async renderHighScoreList(mode:string, characterId:string) {
    const remotePanel = document.getElementById('hs-remote-board');
    if (!remotePanel) return;
    let html = '';
  html = '<div class="hs-empty">(No local storage scoreboard)</div>';
  // Remote rank/around removed
    remotePanel.innerHTML = html;
  }

  private showNicknameModal(): void {
    // Avoid duplicates
    if (document.getElementById('nickname-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'nickname-modal';
    modal.className = 'cyberpunk-modal';
    const suggested = this.authUser?.nickname || 'CyberOperative';
    modal.innerHTML = `
      <div class="modal-content nickname-panel">
        <div class="modal-header">
          <h2>CREATE HANDLE</h2>
          <button class="close-btn" id="close-nick">×</button>
        </div>
        <div class="nickname-body">
          <p>Select a unique cyber handle. This will identify you on leaderboards later.</p>
          <input id="nickname-input" class="nickname-input" maxlength="24" value="${suggested}" />
          <div class="nickname-actions">
            <button id="nickname-reroll" class="cyberpunk-btn secondary-btn small-btn">REROLL</button>
            <button id="nickname-save" class="cyberpunk-btn primary-btn small-btn">SAVE</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    import('../auth/NicknameGenerator').then(mod => {
      const input = document.getElementById('nickname-input') as HTMLInputElement | null;
      document.getElementById('nickname-reroll')?.addEventListener('click', () => {
        if (input) input.value = mod.generateNickname();
      });
    }).catch(()=>{});
    document.getElementById('nickname-save')?.addEventListener('click', () => this.saveNickname());
    document.getElementById('close-nick')?.addEventListener('click', () => modal.remove());
  }

  private saveNickname(): void {
    const input = document.getElementById('nickname-input') as HTMLInputElement | null;
    if (!input || !this.authUser) return;
    const val = input.value.trim();
    if (!val) return;
  // Use statically imported googleAuthService (avoid dynamic import causing Vite warning)
  googleAuthService.setNickname(val);
  const modal = document.getElementById('nickname-modal');
  if (modal) modal.remove();
  }

  private initializeMatrix(): void {
    const canvas = document.createElement('canvas');
    canvas.id = 'matrix-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '-1';
    canvas.style.opacity = '0.1';

    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const matrixChars = '01アカサタナハマヤラワ'.split('');
    const fontSize = 10;
    const columns = canvas.width / fontSize;
    const drops: number[] = Array(Math.floor(columns)).fill(1);

    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#0F3';
      ctx.font = `${fontSize}px monospace`;

      for (let i = 0; i < drops.length; i++) {
        const text = matrixChars[Math.floor(Math.random() * matrixChars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    setInterval(draw, 35);
  }

  public show(): void {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'flex';
      this.updateCurrencyDisplay();
    }
  matrixBackground.start();
  const soundPanel = document.getElementById('sound-settings-panel');
    if (soundPanel) {
      soundPanel.style.display = 'block';
    } else {
      // Lazy load original floating sound settings panel (main menu only)
      import('./SoundSettingsPanel').then(mod => {
        try {
          const panel = new mod.SoundSettingsPanel();
          panel.show();
        } catch { /* ignore */ }
      }).catch(()=>{/* ignore */});
    }
  }

  public hide(): void {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'none';
    }
  matrixBackground.stop();
  const soundPanel = document.getElementById('sound-settings-panel');
  if (soundPanel) soundPanel.style.display = 'none';
  }

  public updateScore(characterId: string, score: number): void {
    if (!this.playerProfile.highScores[characterId] || score > this.playerProfile.highScores[characterId]) {
      this.playerProfile.highScores[characterId] = score;
      this.savePlayerProfile();
    }
  }

  public getPermanentUpgrades(): PlayerProfile['permanentUpgrades'] {
    return this.playerProfile.permanentUpgrades;
  }

  public addCurrency(amount: number): void {
    this.playerProfile.currency += amount;
    this.savePlayerProfile();
    this.updateCurrencyDisplay();
  }

  public getMainMenuElement(): HTMLElement | null {
    return this.mainMenuElement;
  }

  public drawMatrixBackground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    // Matrix background is now handled by initializeMatrix() method
    // This method is kept for compatibility but does nothing since we have canvas-based matrix
  }
}
