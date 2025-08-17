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
          <div class="upgrade-hint">Press number (1-3) or ESC to skip</div>
        </div>
        <div class="upgrade-options-grid" data-upgrade-options></div>
        <div class="upgrade-footer compact-text">
          <span class="legend"><span class="badge badge-weapon">W</span> Weapon <span class="badge badge-passive">P</span> Passive <span class="badge badge-class">C</span> Class Weapon</span>
        </div>
      </div>
    `;
  }

  private addEventListeners(): void {
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const idx = parseInt(e.key);
      if (!isNaN(idx) && idx >= 1 && idx <= this.options.length) {
        this.applyUpgrade(idx - 1);
      } else if (e.key === 'Escape') {
        this.hide();
        if (this.game && typeof this.game.setState === 'function') {
          this.game.setState('GAME'); // Unpause if escape is pressed
        }
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
        progressHtml = `<div class="upgrade-progress" aria-label="Progress ${current}/${max}">
          <div class="upgrade-progress-bar" style="--progress:${pct}%;"></div>
          <div class="upgrade-progress-text">Lv ${current}/${max}</div>
        </div>`;
      }

      card.innerHTML = `
        <div class="upgrade-key-indicator">${i + 1}</div>
        <div class="upgrade-icon">${opt.icon ? `<img src="${opt.icon}" alt="${opt.name}" />` : ''}</div>
        <div class="upgrade-body">
          <div class="upgrade-row">
            <div class="upgrade-title-line">
              <span class="upgrade-title">${opt.name}</span>
              ${isClassWeapon ? '<span class="badge badge-class" title="Class Weapon">C</span>' : ''}
            </div>
            <div class="upgrade-type-line">${opt.type === 'weapon' ? '<span class="badge badge-weapon">Weapon</span>' : opt.type === 'passive' ? '<span class="badge badge-passive">Passive</span>' : '<span class="badge badge-skip">Skip</span>'}</div>
          </div>
          <div class="upgrade-desc">${opt.description}</div>
          ${progressHtml}
        </div>
      `;
      card.addEventListener('click', () => this.applyUpgrade(i));
      container.appendChild(card);
    }
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
}
