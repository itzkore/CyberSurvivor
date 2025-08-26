import { WeaponType } from '../game/WeaponType';
import { Logger } from '../core/Logger';
import { CHARACTERS } from '../data/characters';
import { WEAPON_SPECS } from '../game/WeaponConfig';
// Speed scale no longer shown in Basic tab; keep gameplay usage elsewhere
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
  private resizeHandler: (() => void) | null = null;

  // (Legacy) Baseline constants no longer used directly – kept if future clamp logic needed
  private static readonly BASE_WIDTH = 1400; // px
  private static readonly BASE_HEIGHT = 820; // px
  // Target maximum proportional screen usage (leave breathing room even if content fits)
  // Allow near full usage; user requested fuller window fill
  private static readonly MAX_SCREEN_USAGE_W = 1; // full width usage
  private static readonly MAX_SCREEN_USAGE_H = 1; // full height usage

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
  const s = character.stats as any; // Allow derived fields (critChance, survivability, powerScore, damageIndex, movementIndex)
        tabContent.innerHTML = `
          <h3>Character Statistics</h3>
          <div class="stats-grid cols-3 compact-text">
            <div class="stat-box"><div class="stat-label">HP</div><div class="stat-value">${s.hp}</div></div>
            <div class="stat-box"><div class="stat-label">Max HP</div><div class="stat-value">${s.maxHp}</div></div>
            <div class="stat-box"><div class="stat-label">Damage</div><div class="stat-value" title="Offense index (display only)">${s.damageIndex ?? s.damage}</div></div>
            <div class="stat-box"><div class="stat-label">Movement</div><div class="stat-value" title="Mobility index (display only)">${s.movementIndex ?? s.speed}</div></div>
            <div class="stat-box"><div class="stat-label">Defense</div><div class="stat-value">${s.defense}</div></div>
            <div class="stat-box"><div class="stat-label">Luck</div><div class="stat-value">${s.luck}</div></div>
            <div class="stat-box"><div class="stat-label">Intelligence</div><div class="stat-value">${s.intelligence}</div></div>
            <div class="stat-box"><div class="stat-label">Strength</div><div class="stat-value">${s.strength}</div></div>
            <div class="stat-box"><div class="stat-label">Agility</div><div class="stat-value">${s.agility}</div></div>
            <div class="stat-box"><div class="stat-label">Crit %</div><div class="stat-value">${s.critChance ?? '—'}</div></div>
            <div class="stat-box"><div class="stat-label">Survive</div><div class="stat-value">${s.survivability ?? '—'}</div></div>
            <div class="stat-box"><div class="stat-label">Power</div><div class="stat-value">${s.powerScore ?? '—'}</div></div>
          </div>
          <p class="compact-text character-desc">${character.description}</p>
          <div class="tab-spacer"></div>
        `;
        break; }

      case 'weapon': {
        const spec = WEAPON_SPECS[character.defaultWeapon as keyof typeof WEAPON_SPECS];
    const traits = spec?.traits?.slice(0,6) || [];
    const tips = ((spec as any)?.usageTips as string[] | undefined) ?? this.buildFallbackTips(spec);
        const loreTag = spec ? this.buildWeaponLore(spec) : 'Forged in the neon crucible.';
        tabContent.innerHTML = `
          <h3>Signature Armament</h3>
          <div class="weapon-info compact-text">
            <div class="weapon-name">${spec?.name || character.defaultWeapon}</div>
            <div class="weapon-description">${spec?.description || 'Primary weapon system optimized for this operative\'s combat style.'}</div>
            <div class="weapon-core-stats">
              <div class="weapon-core-stat"><span class="w-label">Dmg</span><span class="w-val">${spec?.damage ?? '?'}</span></div>
              <div class="weapon-core-stat"><span class="w-label">CD</span><span class="w-val">${(spec as any)?.cooldownMs ? (spec as any).cooldownMs + 'ms' : (spec?.cooldown + 'f')}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Salvo</span><span class="w-val">${spec?.salvo}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Range</span><span class="w-val">${spec?.range}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Speed</span><span class="w-val">${spec?.speed}</span></div>
              <div class="weapon-core-stat"><span class="w-label">Spread</span><span class="w-val">${spec?.spread}</span></div>
            </div>
            ${traits.length ? `<ul class="weapon-traits">${traits.map(t=>`<li>${t}</li>`).join('')}</ul>`:''}
      ${tips && tips.length ? `<div class="weapon-tips"><div class="tips-title">Tips</div><ul>${tips.map(t=>`<li>${this.escapeHtml(t)}</li>`).join('')}</ul></div>`:''}
            <div class="weapon-lore">${loreTag}</div>
          </div>
          ${character.specialAbility ? `<p class="compact-text character-special"><strong>Special Ability:</strong> ${character.specialAbility}</p>` : ''}
          <div class="tab-spacer"></div>
        `;
        break; }

      case 'lore': {
        // Improve readability: larger font, higher contrast, comfortable line-height
        // Add soft cross-class hinting based on weapon synergies
        const synergyHint = this.buildLoreSynergyHint(character);
        tabContent.innerHTML = `
          <div class="lore-pane">
            <div class="lore-text" style="font-size: 1.05rem; line-height: 1.5; color: #E8F1F2; letter-spacing: 0.2px;">
              ${this.escapeHtml(character.lore)}
            </div>
            ${synergyHint ? `<div class="lore-synergy" style="margin-top: 12px; font-size: 0.95rem; color: #C9E4FF;">${synergyHint}</div>` : ''}
            <div class="lore-quote" style="margin-top: 16px; font-style: italic; color: #99AAB5;">
              "In the cyberpunk wasteland, only the strongest survive. This operative has proven their worth in countless missions."
            </div>
          </div>
        `;
        break; }
    }
  }
  private buildLoreSynergyHint(c: CharacterData): string | '' {
    // Lightweight cross-class callouts by default weapon
    switch (c.defaultWeapon) {
      case WeaponType.HACKER_VIRUS:
        return 'Synergy: Tag bosses with Rogue Hacker zones, then let Psionic Weaver or Data Sorcerer capitalize on the debuff window.';
      case WeaponType.QUANTUM_HALO:
        return 'Synergy: Quantum Halo keeps chip damage rolling—pair with Scavenger’s Scrap‑Saw for reliable boss contact.';
      case WeaponType.SCRAP_SAW:
        return 'Synergy: Scrap‑Saw primes targets; Neural Nomad threads or Data Sigils will finish clustered packs.';
      case WeaponType.NOMAD_NEURAL:
        return 'Synergy: Primer tethers love marked enemies—combine with Psionic marks or Rogue Hacker glitch for fast anchors.';
      default:
        return '';
    }
  }

  private buildWeaponLore(spec: any): string {
    if (!spec) return 'Forged in forgotten foundries beyond the Grid.';
    const bits: string[] = [];
    if (typeof spec.damage === 'number') bits.push(`Dmg ${spec.damage}`);
    if (typeof spec.cooldownMs === 'number') bits.push(`CD ${spec.cooldownMs}ms`);
    else if (typeof spec.cooldown === 'number') bits.push(`CD ${spec.cooldown}f`);
    if (typeof spec.range === 'number') bits.push(`Range ${spec.range}`);
    if (typeof spec.salvo === 'number') bits.push(`Salvo ${spec.salvo}`);
    const traits = Array.isArray(spec.traits) ? spec.traits.slice(0,2).join(' • ') : '';
    return [traits, bits.join('  |  ')].filter(Boolean).join('  —  ');
  }

  private buildFallbackTips(spec: any): string[] {
    if (!spec) return ['Move with the flow and fire into crowds.'];
    const tips: string[] = [];
    if (typeof spec.range === 'number') tips.push(`Fight near ${Math.round(spec.range)}px range—outside it damage uptime drops.`);
    if (typeof spec.salvo === 'number' && spec.salvo > 1) tips.push('Land full salvo—closer spacing increases DPS.');
    if (typeof spec.spread === 'number' && spec.spread > 0.15) tips.push('Feather movement; shorter bursts tighten spread.');
    if (Array.isArray(spec.traits) && spec.traits.includes('Piercing')) tips.push('Line enemies—pierce rewards straight lanes.');
    if (Array.isArray(spec.traits) && spec.traits.includes('Area')) tips.push('Hold chokepoints—area damage scales with density.');
    if (Array.isArray(spec.traits) && spec.traits.includes('Homing')) tips.push('Keep targets nearby—homing stays locked at close range.');
    if (!tips.length) tips.push('Stay mobile and shoot into dense packs to maximize hits.');
    return tips.slice(0,3);
  }

  // Minimal HTML escape to keep UI safe for dynamic strings
  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private selectCharacter(): void {
    const selectedCharacter = this.characters[this.selectedCharacterIndex];
    Logger.info(`Character selected: ${selectedCharacter.name}`);
    
    window.dispatchEvent(new CustomEvent('characterSelected', {
      detail: selectedCharacter
    }));
    
    this.hide();
  // In normal runs, return to main menu so user can start mission.
  // In Sandbox, main.ts handles immediate restart with the selected operative; avoid menu bounce.
  const gm = (window as any).__game?.gameMode;
  if (gm !== 'SANDBOX') {
    window.dispatchEvent(new CustomEvent('showMainMenu'));
  }
  }

  public show(): void {
    if (this.panelElement) {
  this.panelElement.style.display = 'flex';
      this.updateDisplay();
  // Removed direct positioning inline styles (handled via CSS class .character-select-panel--visible)
  this.panelElement.classList.add('character-select-panel--visible');
      // Apply scaling after a frame to ensure DOM has laid out
      requestAnimationFrame(() => this.applyAutoScale());
      // Attach resize listener (once)
      if (!this.resizeHandler) {
        this.resizeHandler = () => this.applyAutoScale();
        window.addEventListener('resize', this.resizeHandler);
      }
    }
  matrixBackground.start();
  // Boost visibility slightly for this panel
  const canvas = document.getElementById('matrix-canvas');
  if (canvas) canvas.setAttribute('data-opacity','22');
  }

  public hide(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
    }
  matrixBackground.stop();
  const canvas = document.getElementById('matrix-canvas');
  if (canvas) canvas.setAttribute('data-opacity','15');
    // Detach listener when hidden to avoid unnecessary work
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  public isVisible(): boolean {
    return this.panelElement?.style.display !== 'none';
  }

  public getSelectedCharacter(): CharacterData | null {
    return this.characters[this.selectedCharacterIndex] || null;
  }

  // Removed custom scaling logic; CSS layout now handles full-screen responsiveness.
  /**
   * Dynamically scales the entire character select adaptive container if the
   * viewport is smaller than the baseline design size (helps when OS UI scaling
   * or browser zoom causes cramped / overlapping layout). Uses a uniform scale
   * to preserve proportions and centers the scaled content.
   */
  private applyAutoScale(): void {
    if (!this.panelElement) return;
    const adaptive = this.panelElement.querySelector('#character-select-adaptive') as HTMLElement | null;
    if (!adaptive) return;

    // Clear transforms to measure natural (unscaled) size
  adaptive.style.transform = 'none';
    adaptive.style.margin = '0';

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = adaptive.getBoundingClientRect();
    const naturalW = rect.width || CharacterSelectPanel.BASE_WIDTH;
    const naturalH = rect.height || CharacterSelectPanel.BASE_HEIGHT;

    // Desired usage area (we now allow modest UPSCALING to better fill large viewports / 125% OS scale)
  const targetUsageW = CharacterSelectPanel.MAX_SCREEN_USAGE_W;
  const targetUsageH = CharacterSelectPanel.MAX_SCREEN_USAGE_H;

    // Compute scale needed to reach target usage (can be >1 if natural size is smaller)
  const upScaleW = (vw * targetUsageW) / naturalW;
  const upScaleH = (vh * targetUsageH) / naturalH;
  // Contain (fits inside) and Cover (fills, may overflow) strategies
  const containDesired = Math.min(upScaleW, upScaleH);
  const coverDesired = Math.max(upScaleW, upScaleH); // ensures no gaps
  // Always prefer cover for "no gaps" requirement
  const desiredScale = coverDesired;

    // Contain scale ensures we never overflow viewport (if natural bigger)
  const containScale = Math.min(vw / naturalW, vh / naturalH, 1);

    // Allow upscaling up to a safe cap so text doesn't become blurry; cap depends on DPR
    const dpr = window.devicePixelRatio || 1;
  const maxUpscale = dpr > 1.1 ? 1.35 : 1.50; // allow more enlargement so layout fills window fully

    let scale: number;
    if (desiredScale < 1) {
      // If even cover wants shrink, use contain to avoid unnecessary overflow.
      scale = Math.max(Math.min(containScale, desiredScale), 0.70);
    } else {
      scale = Math.min(desiredScale, maxUpscale);
    }

    if (scale !== 1) {
      const scaledW = naturalW * scale;
      const scaledH = naturalH * scale;
      const diffX = vw - scaledW; // can be negative when covering
      const diffY = vh - scaledH;
      // Center even when negative (overflow) so cropping is symmetrical
      const translateX = (diffX / 2) / scale;
      const translateY = (diffY / 2) / scale;
      adaptive.style.transformOrigin = 'top left';
  adaptive.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      adaptive.setAttribute('data-scale', scale.toFixed(3));
      adaptive.setAttribute('data-scale-components', JSON.stringify({mode:'cover', coverDesired: coverDesired.toFixed(3), containDesired: containDesired.toFixed(3), used: scale.toFixed(3), maxUpscale, dpr}));
    } else {
      adaptive.style.transform = 'none';
      adaptive.removeAttribute('data-scale');
      adaptive.removeAttribute('data-scale-components');
    }
  }
}
