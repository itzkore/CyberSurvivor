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
      this.panelElement.className = 'upgrade-panel-container hidden'; // Start hidden
      document.body.appendChild(this.panelElement);
    }
    this.panelElement.innerHTML = `
      <h2 class="neon-text-cyan">Choose Upgrade</h2>
      <div class="upgrade-options-container"></div>
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
      this.panelElement.style.display = 'block';
      this.panelElement.style.zIndex = '9999';
      this.panelElement.style.pointerEvents = 'auto';
      Logger.debug('[UpgradePanel] Panel DOM after show:', {
        display: this.panelElement.style.display,
        zIndex: this.panelElement.style.zIndex,
        pointerEvents: this.panelElement.style.pointerEvents,
        classList: Array.from(this.panelElement.classList)
      });
    }
    Logger.debug('[UpgradePanel] Panel shown.');
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
    Logger.debug('[UpgradePanel] Panel hidden.');
  }

  /**
   * Render upgrade options in the panel.
   */
  private renderOptions(): void {
    if (!this.panelElement) return;
    const container = this.panelElement.querySelector('.upgrade-options-container');
    if (!container) return;

    container.innerHTML = ''; // Clear existing options

    this.options.forEach((opt, i) => {
      const card = document.createElement('div');
      card.className = 'upgrade-option neon-border';
      card.innerHTML = `
        <div class="upgrade-icon">${opt.icon ? `<img src="${opt.icon}" alt="${opt.name}" style="width:48px;height:48px;object-fit:contain;" />` : ''}</div>
        <div class="upgrade-info">
          <div class="upgrade-title">${opt.name}</div>
          <div class="upgrade-desc">${opt.description}</div>
          <div class="upgrade-meta">
            <span class="upgrade-type">${opt.type === 'weapon' ? 'Weapon' : opt.type === 'passive' ? 'Passive' : 'Skip'}</span>
            ${opt.currentLevel !== undefined && opt.type !== 'skip' ? `<span class="upgrade-level">Lv.${opt.currentLevel + 1}</span>` : ''}
          </div>
        </div>
        <div class="upgrade-key">[${i + 1}]</div>
      `;
      card.onclick = () => this.applyUpgrade(i);
      container.appendChild(card);
    });
    Logger.debug('[UpgradePanel] Options rendered.');
  }

  /**
   * Apply the selected upgrade and hide panel.
   */
  private applyUpgrade(index: number): void {
    const chosen = this.options[index];
    if (!chosen) return;

    Logger.debug(`[UpgradePanel] Applying upgrade: ${chosen.name}`);

    if (chosen.type === 'weapon') {
      const weaponType = chosen.id as WeaponType;
      const beforeLevel = this.player.activeWeapons.get(weaponType) || 0;
      this.player.addWeapon(weaponType);
      const afterLevel = this.player.activeWeapons.get(weaponType) || 0;
      Logger.debug(`[UpgradePanel] Weapon ${weaponType} upgraded: before=${beforeLevel}, after=${afterLevel}`);
    } else if (chosen.type === 'passive') {
      const passiveSpec = PASSIVE_SPECS.find(ps => ps.id === chosen.id);
      if (passiveSpec) {
        this.player.addPassive(passiveSpec.name);
        Logger.debug('[UpgradePanel] Player passives after upgrade:', this.player.activePassives);
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
    Logger.debug('[UpgradePanel] Upgrade applied, panel hidden, game state resumed.');
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
    const allowedWeaponTypes: WeaponType[] = Array.isArray(this.player.characterData?.weaponTypes)
      ? this.player.characterData.weaponTypes.filter((wt: WeaponType) => WEAPON_SPECS[wt])
      : [];
    // Build weapon upgrade/unlock pool
    const weaponOptions: UpgradeOption[] = [];
    for (const wt of allowedWeaponTypes) {
      const spec = WEAPON_SPECS[wt];
      if (!spec) continue;
      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned && spec.maxLevel > 0) {
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

    Logger.debug(`[UpgradePanel] Final generated options: ${options.map(o => o.name).join(', ')}`);
    return options.slice(0, 3);
  }
}
