// CyberSurvivor UI UpgradePanel
import { Player } from '../game/Player';
import { WeaponType } from '../game/WeaponType';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { Logger } from '../core/Logger'; // Import Logger

export interface UpgradeOption {
  type: 'weapon' | 'passive';
  id: WeaponType | number;
  name: string;
  description: string;
  icon: string;
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
            <span class="upgrade-type">${opt.type === 'weapon' ? 'Weapon' : 'Passive'}</span>
            ${opt.currentLevel !== undefined ? `<span class="upgrade-level">Lv.${opt.currentLevel + 1}</span>` : ''}
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

    Logger.debug(`[UpgradePanel] Generating options. Player active weapons: ${Array.from(this.player.activeWeapons.entries()).map(([wt, lvl]) => WeaponType[wt] + ':' + lvl).join(', ')}`);
    Logger.debug(`[UpgradePanel] Player owned passives: ${ownedPassives.join(', ')}`);

    // --- Option 1: Player's Class Weapon (Unlock or Upgrade) ---
    let classWeaponOption: UpgradeOption | undefined;
    if (this.player.classWeaponType !== undefined) {
      const classWeaponSpec = WEAPON_SPECS[this.player.classWeaponType];
      if (classWeaponSpec) {
        const ownedLevel = this.player.activeWeapons.get(this.player.classWeaponType) || 0;
        if (!ownedLevel && classWeaponSpec.maxLevel > 0) {
          classWeaponOption = {
            type: 'weapon',
            id: this.player.classWeaponType,
            name: `Unlock ${classWeaponSpec.name}`,
            description: classWeaponSpec.description || '',
            icon: classWeaponSpec.icon ?? '',
            currentLevel: 0
          };
          Logger.debug(`[UpgradePanel] Class weapon unlock option: ${classWeaponSpec.name}`);
        } else if (ownedLevel > 0 && ownedLevel < classWeaponSpec.maxLevel) {
          classWeaponOption = {
            type: 'weapon',
            id: this.player.classWeaponType,
            name: `Upgrade ${classWeaponSpec.name} Lv.${ownedLevel + 1}`,
            description: classWeaponSpec.description || '',
            icon: classWeaponSpec.icon ?? '',
            currentLevel: ownedLevel
          };
          Logger.debug(`[UpgradePanel] Class weapon upgrade option: ${classWeaponSpec.name} Lv.${ownedLevel + 1}`);
        }
      }
    }
    if (classWeaponOption) {
      options.push(classWeaponOption);
    }

    // --- Pool of all other available Weapon Options (non-class weapons) ---
    const otherWeaponOptions: UpgradeOption[] = [];
    const allWeaponTypes = Object.values(WeaponType).filter(v => typeof v === 'number') as WeaponType[];
    for (const wt of allWeaponTypes) {
      const spec = WEAPON_SPECS[wt];
      // Exclude class weapons and the player's specific class weapon if it's already added as option 1
      if (!spec || spec.isClassWeapon || (classWeaponOption && wt === classWeaponOption.id)) {
        continue;
      }

      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned && spec.maxLevel > 0) {
        otherWeaponOptions.push({
          type: 'weapon',
          id: wt,
          name: `Unlock ${spec.name}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: 0
        });
      } else if (owned > 0 && owned < spec.maxLevel) {
        otherWeaponOptions.push({
          type: 'weapon',
          id: wt,
          name: `Upgrade ${spec.name} Lv.${owned + 1}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: owned
        });
      }
    }
    this.shuffle(otherWeaponOptions); // Shuffle for random selection later
    Logger.debug(`[UpgradePanel] Other weapon options pool: ${otherWeaponOptions.map(o => o.name).join(', ')}`);

    // --- Pool of all available Passive Options ---
    const allPassiveOptions: UpgradeOption[] = [];
    for (const p of PASSIVE_SPECS) {
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!ownedPassives.includes(p.name)) {
        allPassiveOptions.push({
          type: 'passive',
          id: p.id,
          name: `Unlock ${p.name}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: 0
        });
      } else if (existing && existing.level < p.maxLevel) {
        allPassiveOptions.push({
          type: 'passive',
          id: p.id,
          name: `Upgrade ${p.name} Lv.${existing.level + 1}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: existing.level
        });
      }
    }
    this.shuffle(allPassiveOptions); // Shuffle for random selection later
    Logger.debug(`[UpgradePanel] All passive options pool: ${allPassiveOptions.map(o => o.name).join(', ')}`);

    // --- Option 2: A random passive ---
    let passiveOption: UpgradeOption | undefined;
    if (allPassiveOptions.length > 0) {
      passiveOption = allPassiveOptions.shift(); // Take one from shuffled pool
      options.push(passiveOption!);
    }

    // --- Option 3: A random remaining option (weapon or passive) ---
    const remainingOptionsPool = [...otherWeaponOptions, ...allPassiveOptions]; // Combine remaining
    this.shuffle(remainingOptionsPool); // Shuffle combined pool

    let randomOption: UpgradeOption | undefined;
    if (remainingOptionsPool.length > 0) {
      randomOption = remainingOptionsPool.shift(); // Take one from shuffled pool
      options.push(randomOption!);
    }

    // --- Fill remaining slots if less than 3 options ---
    while (options.length < 3) {
      const combinedPool = [...otherWeaponOptions, ...allPassiveOptions]; // Re-combine for filling
      if (combinedPool.length > 0) {
        const fillOption = combinedPool[Math.floor(Math.random() * combinedPool.length)];
        // Ensure no direct duplicates of already chosen options
        if (!options.some(opt => opt.id === fillOption.id && opt.type === fillOption.type)) {
          options.push(fillOption);
        } else {
          // If it's a duplicate, try to find another random option
          const nonDuplicatePool = combinedPool.filter(opt => !options.some(o => o.id === opt.id && o.type === opt.type));
          if (nonDuplicatePool.length > 0) {
            options.push(nonDuplicatePool[Math.floor(Math.random() * nonDuplicatePool.length)]);
          } else {
            // If no unique options left, break to prevent infinite loop
            break;
          }
        }
      } else {
        // No more options to fill with
        break;
      }
    }

    this.shuffle(options); // Final shuffle for display order
    Logger.debug(`[UpgradePanel] Final generated options: ${options.map(o => o.name).join(', ')}`);

    return options.slice(0, 3); // Ensure only 3 options are returned
  }
}
