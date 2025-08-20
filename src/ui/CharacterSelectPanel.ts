import { WeaponType } from '../game/WeaponType';
import { Logger } from '../core/Logger';
import { CHARACTERS } from '../data/characters';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { SPEED_SCALE } from '../game/Balance';
import { matrixBackground } from './MatrixBackground';

interface CharacterStats {
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  strength: number;
  intelligence: number;
  agility: number;
  luck: number;
  defense: number;
}

export interface CharacterData {
  id: string;
  name: string;
  description: string;
  lore: string;
  icon: string;
  defaultWeapon: WeaponType;
  stats: CharacterStats;
  shape: 'circle' | 'square' | 'triangle';
  color: string;
  weaponTypes: WeaponType[];
  specialAbility?: string;
  playstyle: 'Aggressive' | 'Defensive' | 'Balanced' | 'Support' | 'Stealth';
}

export class CharacterSelectPanel {
  private characters: CharacterData[] = [];
  private selectedCharacterIndex: number = 0;
  private panelElement: HTMLElement | null = null;
  private currentTab: string = 'basic';

  constructor() {
    this.initializeCharacters();
    this.createHTML();
    this.setupEventListeners();
    this.updateDisplay();
  }

  private initializeCharacters(): void {
    this.characters = CHARACTERS.map(char => ({ ...char }));
    // Ensure Cyber Runner appears first by default (selection only, keeps original array order for data integrity)
    const runnerIndex = this.characters.findIndex(c => c.id === 'cyber_runner');
    if (runnerIndex >= 0) {
      this.selectedCharacterIndex = runnerIndex;
    }
    Logger.info(`CharacterSelectPanel: Loaded ${this.characters.length} characters (initial selection: ${this.characters[this.selectedCharacterIndex]?.id})`);
  }

  private createHTML(): void {
    // Remove any existing panel
    const existing = document.getElementById('character-select-panel');
    if (existing) existing.remove();

    this.panelElement = document.createElement('div');
    this.panelElement.id = 'character-select-panel';
    this.panelElement.className = 'character-select-panel';
    this.panelElement.style.display = 'none';

    this.panelElement.innerHTML = `
      <div class="character-select-adaptive" id="character-select-adaptive">
      <div class="carousel-header">
        <h1 class="carousel-title">SELECT YOUR CHARACTER</h1>
        <div class="carousel-subtitle">Choose your operative for the mission</div>
      </div>
      
      <div class="carousel-container">
        <div class="carousel-main">
          <div class="character-display">
            <div class="portrait-nav">
              <button class="nav-arrow prev" id="prevBtn" aria-label="Previous Character">‹</button>
              <div class="character-portrait">
                <img id="mainPortrait" src="" alt="Character Portrait">
              </div>
              <button class="nav-arrow next" id="nextBtn" aria-label="Next Character">›</button>
            </div>
            <h2 class="character-name" id="mainCharacterName">Character Name</h2>
            <div class="character-class" id="characterClass">Class</div>
          </div>
          
          <div class="carousel-thumbnails" id="thumbnailContainer">
            <!-- Thumbnails will be added dynamically -->
          </div>
        </div>
        
        <div class="info-panel">
          <div class="info-tabs">
            <button class="info-tab active" data-tab="basic">STATS</button>
            <button class="info-tab" data-tab="weapon">WEAPON</button>
            <button class="info-tab" data-tab="lore">LORE</button>
          </div>
          
          <div class="tab-content" id="tabContent">
            <!-- Content will be populated dynamically -->
          </div>
        </div>
      </div>
      
      <div class="carousel-footer">
        <button class="back-button" id="backBtn">BACK TO MENU</button>
        <button class="select-button" id="selectBtn">SELECT OPERATIVE</button>
      </div>
      </div><!-- /character-select-adaptive -->
    `;

    document.body.appendChild(this.panelElement);
    this.populateCarousel();
  // Removed adaptive scaler: panel now uses fluid 100% layout via CSS to always fill screen.
  }

  private populateCarousel(): void {
    const thumbnailContainer = document.getElementById('thumbnailContainer');
    if (!thumbnailContainer) return;

    // Create thumbnails
    thumbnailContainer.innerHTML = '';
    this.characters.forEach((character, index) => {
      const thumbnail = document.createElement('div');
      thumbnail.className = `thumbnail ${index === this.selectedCharacterIndex ? 'active' : ''}`;
      thumbnail.innerHTML = `<img src="${character.icon}" alt="${character.name}">`;
      thumbnail.addEventListener('click', () => {
        this.selectedCharacterIndex = index;
        this.updateDisplay();
      });
      thumbnailContainer.appendChild(thumbnail);
    });
  }

  private setupEventListeners(): void {
    // Navigation arrows
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'prevBtn') {
        this.previousCharacter();
      } else if (target.id === 'nextBtn') {
        this.nextCharacter();
      } else if (target.id === 'selectBtn') {
        this.selectCharacter();
      } else if (target.id === 'backBtn') {
        this.hide();
        window.dispatchEvent(new CustomEvent('backToMenu'));
      }
    });

    // Tab switching
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('info-tab')) {
        const tab = target.dataset.tab;
        if (tab) {
          this.switchTab(tab);
        }
      }
    });

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!this.isVisible()) return;
      
      switch(e.key) {
        case 'ArrowLeft':
          this.previousCharacter();
          break;
        case 'ArrowRight':
          this.nextCharacter();
          break;
        case 'Enter':
          this.selectCharacter();
          break;
        case 'Escape':
          this.hide();
          window.dispatchEvent(new CustomEvent('backToMenu'));
          break;
      }
    });
  }

  private previousCharacter(): void {
    this.selectedCharacterIndex = (this.selectedCharacterIndex - 1 + this.characters.length) % this.characters.length;
    this.updateDisplay();
  }

  private nextCharacter(): void {
    this.selectedCharacterIndex = (this.selectedCharacterIndex + 1) % this.characters.length;
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const character = this.characters[this.selectedCharacterIndex];
    if (!character) return;

    // Update main display
    const mainPortrait = document.getElementById('mainPortrait') as HTMLImageElement;
    const mainName = document.getElementById('mainCharacterName');
    const mainClass = document.getElementById('characterClass');

    if (mainPortrait) mainPortrait.src = character.icon;
    if (mainName) mainName.textContent = character.name;
    if (mainClass) mainClass.textContent = character.playstyle;

    // Update thumbnails
    document.querySelectorAll('.thumbnail').forEach((thumb, index) => {
      thumb.classList.toggle('active', index === this.selectedCharacterIndex);
    });

    // Update tab content
    this.updateTabContent();
  }

  private switchTab(tab: string): void {
    this.currentTab = tab;
    
    // Update tab buttons
    document.querySelectorAll('.info-tab').forEach(tabBtn => {
      tabBtn.classList.toggle('active', tabBtn.getAttribute('data-tab') === tab);
    });

    this.updateTabContent();
  }

  private updateTabContent(): void {
    const character = this.characters[this.selectedCharacterIndex];
    const tabContent = document.getElementById('tabContent');
    if (!character || !tabContent) return;

    switch(this.currentTab) {
      case 'basic': {
  const s = character.stats as any; // Allow derived fields (critChance, survivability, powerScore)
        tabContent.innerHTML = `
          <h3>Character Statistics</h3>
          <div class="stats-grid cols-3 compact-text">
            <div class="stat-box"><div class="stat-label">HP</div><div class="stat-value">${s.hp}</div></div>
            <div class="stat-box"><div class="stat-label">Max HP</div><div class="stat-value">${s.maxHp}</div></div>
            <div class="stat-box"><div class="stat-label">Damage</div><div class="stat-value">${s.damage}</div></div>
            <div class="stat-box"><div class="stat-label">Speed</div><div class="stat-value" title="Effective in-game speed after global scaling applies">${(s.speed * SPEED_SCALE).toFixed(2)}</div></div>
            <div class="stat-box"><div class="stat-label">Defense</div><div class="stat-value">${s.defense}</div></div>
            <div class="stat-box"><div class="stat-label">Luck</div><div class="stat-value">${s.luck}</div></div>
            <div class="stat-box"><div class="stat-label">Intelligence</div><div class="stat-value">${s.intelligence}</div></div>
            <div class="stat-box"><div class="stat-label">Strength</div><div class="stat-value">${s.strength}</div></div>
            <div class="stat-box"><div class="stat-label">Agility</div><div class="stat-value">${s.agility}</div></div>
            <div class="stat-box"><div class="stat-label">Crit %</div><div class="stat-value">${s.critChance ?? '—'}</div></div>
            <div class="stat-box"><div class="stat-label">Survive</div><div class="stat-value">${s.survivability ?? '—'}</div></div>
            <div class="stat-box"><div class="stat-label">Power</div><div class="stat-value">${s.powerScore ?? '—'}</div></div>
          </div>
          <p class="compact-text" style="color: rgba(255,255,255,0.8); margin-top: 12px; width: 100%; text-align: left;">${character.description}</p>
          <div class="tab-spacer"></div>
        `;
        break; }

      case 'weapon': {
        const spec = WEAPON_SPECS[character.defaultWeapon as keyof typeof WEAPON_SPECS];
        const traits = spec?.traits?.slice(0,6) || [];
        const loreTag = spec ? this.buildWeaponLore(spec) : 'Forged in the neon crucible.';
        tabContent.innerHTML = `
          <h3>Signature Armament</h3>
          <div class="weapon-info compact-text">
            <div class="weapon-name">${spec?.name || character.defaultWeapon}</div>
            <div class="weapon-description">${spec?.description || 'Primary weapon system optimized for this operative\'s combat style.'}</div>
            <div class="weapon-core-stats">
              <div class="weapon-core-stat"><span class="w-label">Dmg</span><span class="w-val">${spec?.damage ?? '?'}</span></div>
              <div class="weapon-core-stat"><span class="w-label">CD</span><span class="w-val">${spec?.cooldown}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Salvo</span><span class="w-val">${spec?.salvo}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Range</span><span class="w-val">${spec?.range}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Speed</span><span class="w-val">${spec?.speed}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Spread</span><span class="w-val">${spec?.spread}</span></div>
            </div>
            ${traits.length ? `<ul class="weapon-traits">${traits.map(t=>`<li>${t}</li>`).join('')}</ul>`:''}
            <div class="weapon-lore">${loreTag}</div>
          </div>
          ${character.specialAbility ? `<p class="compact-text" style="width: 100%; text-align: left;"><strong>Special Ability:</strong> ${character.specialAbility}</p>` : ''}
          <div class="tab-spacer"></div>
        `;
        break; }

      case 'lore':
        tabContent.innerHTML = `
          <div class="lore-text">${character.lore}</div>
          <div class="lore-quote">
            "In the cyberpunk wasteland, only the strongest survive. This operative has proven their worth in countless missions."
          </div>
        `;
        break;
    }
  }

  private buildWeaponLore(spec: any): string {
    if (!spec) return 'Forged in forgotten foundries beyond the Grid.';
    const parts: string[] = [];
    if (spec.damage) parts.push(`base damage ${spec.damage}`);
    if (spec.range) parts.push(`effective range ${spec.range}`);
    if (spec.cooldown) parts.push(`cooldown ${spec.cooldown}f`);
    const trait = spec.traits?.[0];
    const core = trait ? `${trait.toLowerCase()}` : 'hybrid design';
    return `Legendary ${core} platform engineered for ${parts.slice(0,2).join(' & ')}.`;
  }

  private selectCharacter(): void {
    const selectedCharacter = this.characters[this.selectedCharacterIndex];
    Logger.info(`Character selected: ${selectedCharacter.name}`);
    
    window.dispatchEvent(new CustomEvent('characterSelected', {
      detail: selectedCharacter
    }));
    
    this.hide();
  // Return to main menu so user can start mission (prevent white screen where both panels are hidden)
  window.dispatchEvent(new CustomEvent('showMainMenu'));
  }

  public show(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'flex';
      this.updateDisplay();
  // Ensure it fills viewport (CSS handles sizing)
  this.panelElement.style.left = '0';
  this.panelElement.style.top = '0';
  this.panelElement.style.transform = 'none';
  this.panelElement.style.width = '100%';
  this.panelElement.style.height = '100%';
    }
  matrixBackground.start();
  // Boost visibility slightly for this panel
  const canvas = document.getElementById('matrix-canvas');
  if (canvas) canvas.style.opacity = '0.22';
  }

  public hide(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
    }
  matrixBackground.stop();
  const canvas = document.getElementById('matrix-canvas');
  if (canvas) canvas.style.opacity = '0.15';
  }

  public isVisible(): boolean {
    return this.panelElement?.style.display !== 'none';
  }

  public getSelectedCharacter(): CharacterData | null {
    return this.characters[this.selectedCharacterIndex] || null;
  }

  // Removed custom scaling logic; CSS layout now handles full-screen responsiveness.
}
