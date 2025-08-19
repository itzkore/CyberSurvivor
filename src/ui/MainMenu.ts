import { Logger } from '../core/Logger';
import { matrixBackground } from './MatrixBackground';
import { CHARACTERS } from '../data/characters';

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
      
      <div class="main-menu-header">
        <div class="game-logo">
          <div class="logo-text">CYBER</div>
          <div class="logo-subtext">SURVIVOR</div>
        </div>
        <div class="player-stats">
          <div class="currency-display">
            <span class="currency-icon">⚡</span>
            <span id="currency-amount">${this.playerProfile.currency}</span>
          </div>
        </div>
      </div>

      <div class="main-menu-content">
        <div class="menu-navigation">
          <button class="cyberpunk-btn primary-btn" id="start-mission-btn">
            <span class="btn-text">START MISSION</span>
            <span class="btn-glow"></span>
          </button>
          
          <button class="cyberpunk-btn secondary-btn" id="character-select-btn">
            <span class="btn-text">SELECT OPERATIVE</span>
            <span class="btn-glow"></span>
          </button>
          
          <button class="cyberpunk-btn secondary-btn" id="upgrades-btn">
            <span class="btn-text">UPGRADES</span>
            <span class="btn-glow"></span>
            ${this.playerProfile.currency > 0 ? '<span class="notification-dot"></span>' : ''}
          </button>
          
          <button class="cyberpunk-btn secondary-btn" id="statistics-btn">
            <span class="btn-text">STATISTICS</span>
            <span class="btn-glow"></span>
          </button>
        </div>

        <div class="menu-preview">
          <div class="selected-character-preview" id="character-preview">
            <div class="preview-title">SELECTED OPERATIVE</div>
            <div class="preview-portrait" id="preview-portrait">
              <img src="${location.protocol === 'file:' ? './assets/player/wasteland_scavenger.png' : '/assets/player/wasteland_scavenger.png'}" alt="Character" />
            </div>
            <div class="preview-name" id="preview-name">Select Character</div>
            <div class="preview-stats" id="preview-stats">
              <div class="stat-item">
                <span class="stat-label">Health:</span>
                <span class="stat-value">100</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Damage:</span>
                <span class="stat-value">25</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="main-menu-footer">
        <div class="version-info">v1.0.0 ALPHA</div>
        <div class="connection-status">
          <span class="status-dot"></span>
          NEURAL LINK ACTIVE
        </div>
      </div>
    `;

    document.body.appendChild(this.mainMenuElement);
  // Show sound panel (if exists) while in main menu
  const soundPanel = document.getElementById('sound-settings-panel');
  if (soundPanel) soundPanel.style.display = 'block';
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
          detail: this.gameInstance.selectedCharacterData 
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
