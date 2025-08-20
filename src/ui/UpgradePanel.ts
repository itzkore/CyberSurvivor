// CyberSurvivor UI UpgradePanel
import { Player } from '../game/Player';
import { WeaponType } from '../game/WeaponType';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { Logger } from '../core/Logger'; // Import Logger

/**
 * Represents an upgrade option for the UpgradePanel.
 * @group UI
 */
export interface UpgradeOption {
  /**
   * Type of upgrade: 'weapon', 'passive', or 'skip'.
   */
  type: 'weapon' | 'passive' | 'skip';
  /**
   * Unique identifier for the upgrade (WeaponType or number for skip).
   */
  id: WeaponType | number;
  /**
   * Display name of the upgrade.
   */
  name: string;
  /**
   * Description of the upgrade.
   */
  description: string;
  /**
   * Icon asset path for the upgrade.
   */
  icon: string;
  /**
   * Current upgrade level (if applicable).
   */
  currentLevel?: number;
}

export class UpgradePanel {
  private player: Player;
  private game: any; // Consider a more specific type if available (e.g., Game class)
  public visible: boolean = false;
  public options: UpgradeOption[] = [];
  private panelElement: HTMLElement | null = null;

  constructor(player: Player, game: any) {
    this.player = player;
    this.game = game;
    this.createDomElements(); // Ensure DOM elements are created
    this.addEventListeners(); // Add event listeners
  }

  private createDomElements(): void {
    this.panelElement = document.getElementById('upgrade-panel');
    if (!this.panelElement) {
      this.panelElement = document.createElement('div');
      this.panelElement.id = 'upgrade-panel';
      // Use unified overlay + panel theme classes
      this.panelElement.className = 'upgrade-panel-overlay hidden'; // Start hidden
      document.body.appendChild(this.panelElement);
    }
    this.panelElement.innerHTML = `
      <div class="upgrade-panel ui-panel">
        <div class="upgrade-header">
          <h2 class="panel-title">Choose Upgrade</h2>
          <div class="upgrade-hint">1·2·3 = Select &nbsp; R = Reroll &nbsp; ESC = Skip</div>
        </div>
        <div class="upgrade-options-grid" data-upgrade-options></div>
        <div class="upgrade-footer compact-text">
          <div class="footer-hints">Type colors: Weapon ▸ teal, Passive ▸ green-blue, Class ▸ bright cyan</div>
          <button type="button" class="btn-reroll" data-reroll title="Reroll upgrade options (testing)">Reroll</button>
        </div>
      </div>
    `;
  }

  private addEventListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const rawKey = e.key;
      const key = rawKey.toLowerCase();
      // Map multiple physical / layout-specific keys to option indices
      const keyMap: Record<string, number> = {
        '1': 0, '+': 0,         // first option
        '2': 1,                 // second option
        '3': 2, ',': 2, 'š': 2  // third option (map 'š' to option 3 for alt keyboard layout)
      };
      if (key in keyMap) {
        const targetIdx = keyMap[key];
        if (targetIdx < this.options.length) {
          this.applyUpgrade(targetIdx);
          e.preventDefault();
          return;
        }
      }
      if (key === 'r') { // Reroll hotkey
        this.reroll();
        e.preventDefault();
        return;
      }
      const idxNum = parseInt(rawKey, 10);
      if (!isNaN(idxNum) && idxNum >= 1 && idxNum <= this.options.length) {
        this.applyUpgrade(idxNum - 1);
      } else if (key === 'escape') {
        this.hide();
        if (this.game && typeof this.game.setState === 'function') {
          this.game.setState('GAME'); // Unpause if escape is pressed
        }
      }
    });

    // Delegate reroll button click
    document.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (!target) return;
      if (target.matches('[data-reroll]')) {
        if (this.visible) this.reroll();
      }
    });
  }

  /**
   * Show the upgrade selector panel and render options.
   */
  public show(): void {
    this.visible = true;
    this.options = this.generateOptions();
    this.renderOptions();
    if (this.panelElement) {
      this.panelElement.classList.remove('hidden');
  // Keep flex container from CSS for perfect centering
  this.panelElement.style.display = 'flex';
      this.panelElement.style.zIndex = '9999';
      this.panelElement.style.pointerEvents = 'auto';
  // Apply uniform scale so aspect / internal ratio does not reflow (3 cards stay fixed)
  this.applyScale();
  // Ensure grid forced to 3 columns (no wrapping to 2/1) regardless of media queries
  const grid = this.panelElement.querySelector('.upgrade-options-grid');
  if (grid) grid.classList.add('fixed-three');
    }
  }

  /**
   * Rerolls (regenerates) the upgrade options without closing the panel.
   * Intended for rapid testing of different upgrade pools.
   * Does nothing if panel is not visible.
   */
  private reroll(): void {
    if (!this.visible) return;
    this.options = this.generateOptions();
    this.renderOptions();
    // Optional: emit event for external listeners / analytics
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('upgradeRerolled'));
    }
  }

  /**
   * Hide the upgrade selector panel.
   */
  public hide(): void {
    this.visible = false;
    if (this.panelElement) {
      this.panelElement.classList.add('hidden');
      this.panelElement.style.display = 'none';
      this.panelElement.style.pointerEvents = 'none';
    }
  }

  /**
   * Render upgrade options in the panel.
   */
  private renderOptions(): void {
    if (!this.panelElement) return;
    const container = this.panelElement.querySelector('[data-upgrade-options]');
    if (!container) return;

    container.innerHTML = ''; // Clear existing options

    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const isClassWeapon = opt.type === 'weapon' && opt.id === this.player.characterData?.defaultWeapon;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'upgrade-card';
      if (opt.type === 'weapon') card.classList.add('is-weapon');
      if (opt.type === 'passive') card.classList.add('is-passive');
      if (isClassWeapon) card.classList.add('is-class');

      // Progress (only for non-skip options)
      let progressHtml = '';
      if (opt.type !== 'skip' && opt.currentLevel !== undefined) {
        const spec = opt.type === 'weapon' ? WEAPON_SPECS[opt.id as WeaponType] : PASSIVE_SPECS.find(p => p.id === opt.id);
        const max = spec ? (spec as any).maxLevel ?? 1 : 1;
        const current = Math.min(opt.currentLevel, max);
        const pct = Math.min(100, Math.round(((current) / max) * 100));
        progressHtml = `<div class=\"upgrade-progress\" aria-label=\"Progress ${current}/${max}\">
          <div class=\"upgrade-progress-bar\" data-progress=\"${pct}\"></div>
          <div class=\"upgrade-progress-text\">Lv ${current}/${max}</div>
        </div>`;
      }

      // Decide icon markup: weapons keep their image; passives use neon green arrow SVG
      let iconHtml = '';
      if (opt.type === 'weapon' && opt.icon) {
        iconHtml = `<img src="${opt.icon}" alt="${opt.name}" />`;
      } else if (opt.type === 'passive') {
  iconHtml = `<svg viewBox='0 0 64 64' width='52' height='52' role='img' aria-label='Passive Upgrade' class='passive-arrow'>
          <defs>
            <linearGradient id='gradPassive' x1='0' y1='1' x2='0' y2='0'>
              <stop offset='0%' stop-color='#00a85a'/>
              <stop offset='50%' stop-color='#00ff88'/>
              <stop offset='100%' stop-color='#b6ffd9'/>
            </linearGradient>
          </defs>
          <path d='M30.9 7.2 10.4 30.1c-1.6 1.8-1.6 4.6.1 6.3 1.7 1.7 4.4 1.7 6.1 0l9.9-10.6v29.5c0 2.4 2 4.3 4.4 4.3s4.4-1.9 4.4-4.3V25.8l9.9 10.6c1.7 1.7 4.4 1.7 6.1 0 1.7-1.7 1.7-4.5.1-6.3L31.9 7.2a1.4 1.4 0 0 0-1-.4c-.4 0-.8.1-1 .4Z' fill='url(#gradPassive)' stroke='#00ff99' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' />
        </svg>`;
      }

      card.innerHTML = `
        <div class="upgrade-key-indicator">${i + 1}</div>
        <div class="upgrade-icon top-right">${iconHtml}</div>
        <div class="upgrade-body">
          <div class="upgrade-row">
            <div class="upgrade-title-line">
              <span class="upgrade-title">${opt.name}</span>
              ${isClassWeapon ? '<span class="badge badge-class" title="Class Weapon">C</span>' : ''}
            </div>
            <div class="upgrade-type-line">${opt.type === 'weapon' ? '<span class="badge badge-weapon">Weapon</span>' : opt.type === 'passive' ? '<span class="badge badge-passive">Passive</span>' : '<span class="badge badge-skip">Skip</span>'}</div>
          </div>
          <div class="upgrade-desc">${opt.description}</div>
        </div>
        ${progressHtml ? `<div class="upgrade-progress-wrapper">${progressHtml}</div>` : ''}
      `;
      // Simple adaptive sizing: measure text lengths and add data attribute
      const titleLen = opt.name.length;
      const descLen = opt.description?.length || 0;
      if (titleLen > 24 || descLen > 140) {
        card.setAttribute('data-text-small','1');
      }
      if (titleLen > 32 || descLen > 200) {
        card.setAttribute('data-text-small','2');
      }
      card.addEventListener('click', () => this.applyUpgrade(i));
      container.appendChild(card);
    }
    // Apply progress widths (CSP-safe)
    container.querySelectorAll('.upgrade-progress-bar[data-progress]').forEach(el => {
      const pct = (el as HTMLElement).getAttribute('data-progress');
      if (pct) (el as HTMLElement).style.width = pct + '%';
    });
  }

  /**
   * Apply the selected upgrade and hide panel.
   */
  private applyUpgrade(index: number): void {
    const chosen = this.options[index];
    if (!chosen) return;


    if (chosen.type === 'weapon') {
      const weaponType = chosen.id as WeaponType;
      const beforeLevel = this.player.activeWeapons.get(weaponType) || 0;
      this.player.addWeapon(weaponType);
      const afterLevel = this.player.activeWeapons.get(weaponType) || 0;
    } else if (chosen.type === 'passive') {
      const passiveSpec = PASSIVE_SPECS.find(ps => ps.id === chosen.id);
      if (passiveSpec) {
        this.player.addPassive(passiveSpec.name);
      }
    }
    // Force HUD/UI update if needed (optional: emit event)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('playerUpgraded'));
    }
    this.hide();
    if (this.game && typeof this.game.setState === 'function') {
      this.game.setState('GAME'); // Unpause after upgrade selection
    }
  }

  /**
   * Shuffles array in-place using Fisher-Yates algorithm.
   * @param array Array to shuffle
   */
  private shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Generates upgrade options for the panel, strictly enforcing:
   * 1. Option 1: Player's class weapon (unlock or upgrade) if available and not maxed.
   * 2. Option 2: A random passive upgrade/unlock.
   * 3. Option 3: A random weapon (non-class) or passive upgrade/unlock, not duplicating options 1 or 2.
   * @returns {UpgradeOption[]} Array of upgrade options for the panel.
   */
  public generateOptions(): UpgradeOption[] {
    const options: UpgradeOption[] = [];
    const ownedWeapons = Array.from(this.player.activeWeapons.keys());
    const ownedPassives = this.player.activePassives.map(p => p.type);
    const maxWeapons = 5;
    /**
     * Patch: Allow all weapons in WEAPON_SPECS to be available for upgrade selection,
     * not just those in characterData.weaponTypes. This enables Cyber Runner to get any weapon.
     */
    /**
     * Patch: Allow all weapons except other class weapons (isClassWeapon=true and not Runner Gun).
     * Cyber Runner should get only non-class weapons and their own class weapon (Runner Gun).
     */
    // Only allow non-class weapons and the player's own class weapon
    const playerClassWeapon = this.player.characterData?.defaultWeapon;
    const allowedWeaponTypes: WeaponType[] = Object.keys(WEAPON_SPECS)
      .map(wt => Number(wt))
      .filter(wt => {
        const spec = WEAPON_SPECS[wt as WeaponType];
        if (!spec) return false;
        // Allow if not a class weapon, or is the player's own class weapon
        return !spec.isClassWeapon || wt === playerClassWeapon;
      });
    // Build weapon upgrade/unlock pool
    const weaponOptions: UpgradeOption[] = [];
    for (const wt of allowedWeaponTypes) {
      const spec = WEAPON_SPECS[wt];
      if (!spec) continue;
      const owned = this.player.activeWeapons.get(wt) || 0;
      // Only offer unlock if player has less than 5 weapons
      if (!owned && spec.maxLevel > 0 && this.player.activeWeapons.size < maxWeapons) {
        weaponOptions.push({
          type: 'weapon',
          id: wt,
          name: `Unlock ${spec.name}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: 0
        });
      } else if (owned > 0 && owned < spec.maxLevel) {
        weaponOptions.push({
          type: 'weapon',
          id: wt,
          name: `Upgrade ${spec.name} Lv.${owned + 1}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: owned
        });
      }
    }
    this.shuffle(weaponOptions);
    // Build passive upgrade/unlock pool
    const passiveOptions: UpgradeOption[] = [];
    for (const p of PASSIVE_SPECS) {
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!ownedPassives.includes(p.name)) {
        passiveOptions.push({
          type: 'passive',
          id: p.id,
          name: `Unlock ${p.name}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: 0
        });
      } else if (existing && existing.level < p.maxLevel) {
        passiveOptions.push({
          type: 'passive',
          id: p.id,
          name: `Upgrade ${p.name} Lv.${existing.level + 1}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: existing.level
        });
      }
    }
    this.shuffle(passiveOptions);

    // Option 1: Always weapon unless 5 maxxed weapons
    let option1: UpgradeOption | undefined;
    const ownedWeaponCount = ownedWeapons.length;
    const allWeaponsMaxxed = ownedWeaponCount === maxWeapons && weaponOptions.length === 0;
    if (!allWeaponsMaxxed && weaponOptions.length > 0) {
      option1 = weaponOptions.shift();
    } else if (passiveOptions.length > 0) {
      option1 = passiveOptions.shift();
    } else {
      option1 = { type: 'skip', id: -1, name: 'Skip', description: 'No upgrades available.', icon: '' } as any;
    }
    if (option1) {
      options.push(option1);
    } else {
      options.push({ type: 'skip', id: -1, name: 'Skip', description: 'No upgrades available.', icon: '' });
    }

    // Option 2: Always passive unless all passives and weapons are maxxed
    let option2: UpgradeOption | undefined;
    const allPassivesMaxxed = passiveOptions.length === 0;
    if (!allPassivesMaxxed) {
      option2 = passiveOptions.shift();
    } else if (weaponOptions.length > 0) {
      option2 = weaponOptions.shift();
    } else {
      option2 = { type: 'skip', id: -2, name: 'Skip', description: 'No upgrades available.', icon: '' } as any;
    }
    if (option2) {
      options.push(option2);
    } else {
      options.push({ type: 'skip', id: -2, name: 'Skip', description: 'No upgrades available.', icon: '' });
    }

    // Option 3: Unique random from both pools, or skip if none
    const combinedPool = [...weaponOptions, ...passiveOptions].filter(opt => !options.some(o => o && o.id === opt.id && o.type === opt.type));
    let option3: UpgradeOption | undefined;
    if (combinedPool.length > 0) {
      option3 = combinedPool[Math.floor(Math.random() * combinedPool.length)];
    } else {
      option3 = { type: 'skip', id: -3, name: 'Skip', description: 'No upgrades available.', icon: '' } as any;
    }
    if (option3) {
      options.push(option3);
    } else {
      options.push({ type: 'skip', id: -3, name: 'Skip', description: 'No upgrades available.', icon: '' });
    }

    return options.slice(0, 3);
  }

  /** Uniform scaling: keep 3-column layout, shrink/grow whole panel via transform without ratio distortion */
  private applyScale() {
    const root = this.panelElement?.querySelector('.upgrade-panel.ui-panel') as HTMLElement | null;
    if (!root) return;
    root.classList.add('scaled');
    // Base design dimensions for panel contents
    const baseW = 1100; // matches CSS width
    const baseH = 420;  // approximate typical height; refine using bounding box
    // Measure actual height after render if available
    const rect = root.getBoundingClientRect();
    const hRef = rect.height || baseH;
    // Compute scale to fit within viewport padding (leave some margin)
    const availW = window.innerWidth * 0.94;
    const availH = window.innerHeight * 0.9;
    let scale = Math.min(availW / baseW, availH / hRef, 1);
    if (scale < 0.55) scale = 0.55; // readability floor
    root.style.setProperty('--panel-scale', scale.toFixed(3));
    // Re-center by adjusting margin when scaled down (since flex centers original box size)
    root.style.margin = '0 auto';

    // Attach resize listener once
    if (!(window as any).__upgradePanelScaleBound) {
      (window as any).__upgradePanelScaleBound = true;
      window.addEventListener('resize', () => {
        if (this.visible) this.applyScale();
      });
    }
  }
}
