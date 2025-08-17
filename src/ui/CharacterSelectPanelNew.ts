import { AssetLoader } from '../game/AssetLoader';
import { WeaponType } from '../game/WeaponType';
import { Logger } from '../core/Logger';
import { CHARACTERS } from '../data/characters';

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

/**
 * Professional Character Selection Panel with Tabbed Interface
 * Features: Character grid, tabbed info panel (Preview/Stats/Weapons/Lore), professional styling
 */
export class CharacterSelectPanel {
  private characters: CharacterData[] = [];
  private selectedCharacterIndex: number = 0;
  private panelElement: HTMLElement | null = null;
  private currentTab: string = 'preview';

  constructor() {
    this.initializeCharacters();
    this.createHTML();
    this.initializeEventHandlers();
  }

  /**
   * Initialize characters from the data file
   */
  private initializeCharacters(): void {
    this.characters = CHARACTERS.map(char => ({ ...char }));
    Logger.info(`CharacterSelectPanel: Loaded ${this.characters.length} characters`);
  }

  /**
   * Creates the HTML structure for the professional character selection panel
   */
  private createHTML(): void {
    // Remove existing panel if it exists
    const existing = document.getElementById('character-select-panel');
    if (existing) {
      existing.remove();
    }

    // Create main panel container
    this.panelElement = document.createElement('div');
    this.panelElement.id = 'character-select-panel';
    this.panelElement.className = 'character-select-container';
    this.panelElement.style.display = 'none';

    // Load and inject CSS
    this.loadCSS();

    // Create HTML structure
    this.panelElement.innerHTML = `
      <!-- Character Grid -->
      <div class="character-grid" id="characterGrid">
          <!-- Characters will be dynamically populated -->
      </div>

      <!-- Character Info Panel -->
      <div class="character-info-panel">
          <!-- Header -->
          <div class="info-header">
              <div class="info-character-name" id="selectedCharacterName">Select a Character</div>
              <div class="info-character-subtitle" id="selectedCharacterSubtitle">Choose your cyberpunk warrior</div>
              <div class="playstyle-badge" id="playstyleBadge" style="display: none;">Balanced</div>
          </div>

          <!-- Tabs -->
          <div class="info-tabs">
              <button class="tab-button active" data-tab="preview">Preview</button>
              <button class="tab-button" data-tab="stats">Stats</button>
              <button class="tab-button" data-tab="weapons">Weapons</button>
              <button class="tab-button" data-tab="lore">Lore</button>
          </div>

          <!-- Tab Content -->
          <div class="tab-content">
              <!-- Preview Tab -->
              <div class="tab-pane active" id="preview-tab">
                  <div class="special-ability" id="specialAbility" style="display: none;">
                      <div class="ability-title" id="abilityTitle">Special Ability</div>
                      <div class="ability-description" id="abilityDescription">Description</div>
                  </div>
                  <div class="character-portrait" style="width: 150px; height: 150px; margin: 20px auto;">
                      <img id="previewPortrait" src="" alt="Character Portrait" style="display: none;">
                  </div>
                  <div class="lore-text" id="previewDescription">
                      Select a character to see their details.
                  </div>
              </div>

              <!-- Stats Tab -->
              <div class="tab-pane" id="stats-tab" style="display: none;">
                  <div class="stats-grid" id="statsGrid">
                      <!-- Stats will be dynamically populated -->
                  </div>
              </div>

              <!-- Weapons Tab -->
              <div class="tab-pane" id="weapons-tab" style="display: none;">
                  <div class="weapons-grid" id="weaponsGrid">
                      <!-- Weapons will be dynamically populated -->
                  </div>
              </div>

              <!-- Lore Tab -->
              <div class="tab-pane" id="lore-tab" style="display: none;">
                  <div class="lore-text" id="loreText">
                      Select a character to read their backstory.
                  </div>
              </div>
          </div>

          <!-- Action Buttons -->
          <div class="action-buttons">
              <button class="btn btn-secondary" id="backButton">Back</button>
              <button class="btn btn-primary" id="selectButton">Select Character</button>
          </div>
      </div>
    `;

    // Append to body
    document.body.appendChild(this.panelElement);

    // Populate character grid
    this.populateCharacterGrid();
    
    Logger.info('CharacterSelectPanel: Professional tabbed interface created');
  }

  /**
   * Loads CSS styles for the character selection panel
   */
  private loadCSS(): void {
    // Check if CSS is already loaded
    if (document.getElementById('character-select-css')) return;

    const link = document.createElement('link');
    link.id = 'character-select-css';
    link.rel = 'stylesheet';
    link.href = '/src/ui/character-select-panel.css';
    document.head.appendChild(link);
  }

  /**
   * Populates the character grid with character cards
   */
  private populateCharacterGrid(): void {
    const grid = document.getElementById('characterGrid');
    if (!grid) return;

    grid.innerHTML = '';
    
    this.characters.forEach((character, index) => {
      const card = document.createElement('div');
      card.className = 'character-card';
      card.dataset.characterId = character.id;
      
      card.innerHTML = `
        <div class="character-portrait">
          <img src="${character.icon}" alt="${character.name}" onerror="this.style.display='none'">
        </div>
        <div class="character-name">${character.name}</div>
        <div class="character-class">${character.playstyle || 'Balanced'}</div>
      `;

      card.addEventListener('click', () => {
        this.selectCharacter(index, card);
      });

      grid.appendChild(card);
    });

    // Select first character by default
    if (this.characters.length > 0) {
      const firstCard = grid.querySelector('.character-card') as HTMLElement;
      if (firstCard) {
        this.selectCharacter(0, firstCard);
      }
    }
  }

  /**
   * Initialize event handlers for tabs and buttons
   */
  private initializeEventHandlers(): void {
    // Wait for DOM to be ready
    setTimeout(() => {
      // Tab switching
      const tabButtons = document.querySelectorAll('.tab-button');
      tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          const tabName = target.dataset.tab;
          if (tabName) {
            this.switchTab(tabName);
          }
        });
      });

      // Action buttons
      const backButton = document.getElementById('backButton');
      const selectButton = document.getElementById('selectButton');

      backButton?.addEventListener('click', () => {
        this.handleBack();
      });

      selectButton?.addEventListener('click', () => {
        this.handleSelect();
      });
    }, 100);
  }

  /**
   * Switch between tabs
   */
  private switchTab(tabName: string): void {
    // Update tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(btn => {
      const button = btn as HTMLElement;
      button.classList.toggle('active', button.dataset.tab === tabName);
    });

    // Update tab content
    const tabPanes = document.querySelectorAll('.tab-pane');
    tabPanes.forEach(pane => {
      (pane as HTMLElement).style.display = 'none';
    });
    
    const targetTab = document.getElementById(`${tabName}-tab`);
    if (targetTab) {
      targetTab.style.display = 'block';
      this.currentTab = tabName;
      
      // Refresh content for the selected tab
      this.refreshTabContent(tabName);
    }
  }

  /**
   * Refresh content for the current tab
   */
  private refreshTabContent(tabName: string): void {
    if (this.selectedCharacterIndex < 0 || this.selectedCharacterIndex >= this.characters.length) return;

    const character = this.characters[this.selectedCharacterIndex];

    switch (tabName) {
      case 'stats':
        this.renderStats(character);
        break;
      case 'weapons':
        this.renderWeapons(character);
        break;
      case 'lore':
        this.renderLore(character);
        break;
      case 'preview':
        this.renderPreview(character);
        break;
    }
  }

  /**
   * Select a character and update the info panel
   */
  private selectCharacter(index: number, cardElement: HTMLElement): void {
    // Update selection UI
    const allCards = document.querySelectorAll('.character-card');
    allCards.forEach(card => {
      card.classList.remove('selected');
    });
    cardElement.classList.add('selected');

    this.selectedCharacterIndex = index;
    const character = this.characters[index];
    
    this.updateCharacterInfo(character);
  }

  /**
   * Update character information in the info panel
   */
  private updateCharacterInfo(character: CharacterData): void {
    // Update header
    const nameEl = document.getElementById('selectedCharacterName');
    const subtitleEl = document.getElementById('selectedCharacterSubtitle');
    const badgeEl = document.getElementById('playstyleBadge');

    if (nameEl) nameEl.textContent = character.name;
    if (subtitleEl) subtitleEl.textContent = character.description;
    
    // Update playstyle badge
    if (badgeEl && character.playstyle) {
      badgeEl.textContent = character.playstyle;
      badgeEl.className = `playstyle-badge playstyle-${character.playstyle.toLowerCase()}`;
      badgeEl.style.display = 'inline-block';
    }

    // Update special ability
    this.updateSpecialAbility(character);

    // Update portrait
    const portrait = document.getElementById('previewPortrait') as HTMLImageElement;
    if (portrait && character.icon) {
      portrait.src = character.icon;
      portrait.style.display = 'block';
    }

    // Refresh current tab content
    this.refreshTabContent(this.currentTab);
  }

  /**
   * Update special ability display
   */
  private updateSpecialAbility(character: CharacterData): void {
    const abilitySection = document.getElementById('specialAbility');
    const abilityTitle = document.getElementById('abilityTitle');
    const abilityDescription = document.getElementById('abilityDescription');
    
    if (character.specialAbility && abilitySection && abilityTitle && abilityDescription) {
      const parts = character.specialAbility.split(' - ');
      abilityTitle.textContent = parts[0];
      abilityDescription.textContent = parts[1] || character.specialAbility;
      abilitySection.style.display = 'block';
    }
  }

  /**
   * Render character stats
   */
  private renderStats(character: CharacterData): void {
    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    const stats = character.stats;
    const maxValues = {
      hp: 200,
      maxHp: 200,
      speed: 12,
      damage: 40,
      strength: 10,
      intelligence: 10,
      agility: 10,
      luck: 10,
      defense: 10
    };

    statsGrid.innerHTML = '';

    Object.entries(stats).forEach(([key, value]) => {
      if (typeof value !== 'number') return;
      
      const statItem = document.createElement('div');
      statItem.className = 'stat-item';
      
      const maxValue = maxValues[key as keyof typeof maxValues] || 10;
      const percentage = Math.min((value / maxValue) * 100, 100);
      
      statItem.innerHTML = `
        <div class="stat-label">${key.charAt(0).toUpperCase() + key.slice(1)}</div>
        <div class="stat-value">${value}</div>
        <div class="stat-bar">
          <div class="stat-fill" style="width: ${percentage}%"></div>
        </div>
      `;
      
      statsGrid.appendChild(statItem);
    });
  }

  /**
   * Render character weapons
   */
  private renderWeapons(character: CharacterData): void {
    const weaponsGrid = document.getElementById('weaponsGrid');
    if (!weaponsGrid) return;

    const weapons = character.weaponTypes || [];
    const weaponNames: { [key: number]: string } = {
      [WeaponType.PISTOL]: 'Pistol',
      [WeaponType.SHOTGUN]: 'Shotgun',
      [WeaponType.TRI_SHOT]: 'Tri-Shot',
      [WeaponType.RUNNER_GUN]: 'Runner Gun',
      [WeaponType.WARRIOR_CANNON]: 'Warrior Cannon',
      [WeaponType.SORCERER_ORB]: 'Sorcerer Orb',
      [WeaponType.SHADOW_DAGGER]: 'Shadow Dagger',
      [WeaponType.BIO_TOXIN]: 'Bio Toxin',
      [WeaponType.HACKER_VIRUS]: 'Hacker Virus',
      [WeaponType.GUNNER_MINIGUN]: 'Gunner Minigun',
      [WeaponType.PSIONIC_WAVE]: 'Psionic Wave',
      [WeaponType.SCAVENGER_SLING]: 'Scavenger Sling',
      [WeaponType.NOMAD_NEURAL]: 'Nomad Neural',
      [WeaponType.GHOST_SNIPER]: 'Ghost Sniper',
      [WeaponType.MECH_MORTAR]: 'Mech Mortar'
    };

    weaponsGrid.innerHTML = '';

    weapons.forEach(weaponType => {
      const weaponItem = document.createElement('div');
      weaponItem.className = 'weapon-item';
      
      const weaponName = weaponNames[weaponType] || `Weapon ${weaponType}`;
      
      weaponItem.innerHTML = `
        <div class="weapon-name">${weaponName}</div>
        <div class="weapon-description">Available weapon type for this character</div>
      `;
      
      weaponsGrid.appendChild(weaponItem);
    });

    if (weapons.length === 0) {
      weaponsGrid.innerHTML = '<div class="weapon-item"><div class="weapon-name">Universal Weapons</div><div class="weapon-description">This character can use any available weapon</div></div>';
    }
  }

  /**
   * Render character lore
   */
  private renderLore(character: CharacterData): void {
    const loreText = document.getElementById('loreText');
    if (!loreText) return;

    loreText.textContent = character.lore || 'No backstory available for this character.';
  }

  /**
   * Render character preview
   */
  private renderPreview(character: CharacterData): void {
    const previewDescription = document.getElementById('previewDescription');
    if (!previewDescription) return;

    previewDescription.textContent = character.description || 'No description available.';
  }

  /**
   * Handle character selection
   */
  private handleSelect(): void {
    const selectedChar = this.characters[this.selectedCharacterIndex];
    if (selectedChar) {
      Logger.info(`Character selected: ${selectedChar.name}`);
      // Dispatch event to game
      window.dispatchEvent(new CustomEvent('startGame', { detail: selectedChar }));
      this.hide();
    } else {
      Logger.warn('No character selected');
    }
  }

  /**
   * Handle back button
   */
  private handleBack(): void {
    Logger.info('CharacterSelectPanel: Back button clicked');
    this.hide();
    window.dispatchEvent(new CustomEvent('showMainMenu'));
  }

  /**
   * Show the character selection panel
   */
  show(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'flex';
      Logger.info('CharacterSelectPanel: Panel shown');
    }
  }

  /**
   * Hide the character selection panel
   */
  hide(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
      Logger.info('CharacterSelectPanel: Panel hidden');
    }
  }

  /**
   * Get the currently selected character
   */
  getSelectedCharacter(): CharacterData | null {
    return this.characters[this.selectedCharacterIndex] || null;
  }
}
