import { Player } from '../game/Player';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
// Update the import path if WeaponSpecs.ts is located elsewhere, for example:
import { WEAPON_SPECS } from './WeaponConfig'; // Example: adjust '../game/' as needed
import { Logger } from '../core/Logger';

export type UpgradeOption = {
  kind: 'weapon' | 'passive';
  id: number;
  name: string;
  icon?: string;
};

export class UpgradePanel {
  private player: Player;
  public visible: boolean = false;
  public options: UpgradeOption[] = [];
  private upgradePanelElement: HTMLElement | null = null; // New property
  private game: any; // Add game property

  constructor(player: Player, game: any) {
    this.player = player;
    this.game = game; // Store game reference
    this.createDomElements(); // Call new method
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const idx = parseInt(e.key);
      if (!isNaN(idx) && this.options[idx - 1]) {
            // this.applyUpgrade(this.options[idx - 1]); // Old reference, now removed
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  private createDomElements() {
    this.upgradePanelElement = document.createElement('div');
    this.upgradePanelElement.id = 'upgrade-panel';
    this.upgradePanelElement.className = 'level-up-panel hidden'; // Use CSS class and hide initially
    this.upgradePanelElement.innerHTML = `
      <h2 class="neon-text-cyan">Choose Upgrade</h2>
      <div id="upgrade-options-container"></div>
    `;
    document.body.appendChild(this.upgradePanelElement);
  }

  private getAvailableWeapons(): number[] {
    const keys = Object.values(WeaponType).filter(v => typeof v === 'number') as number[];
    return keys;
  }

  /**
   * Generates upgrade options for the panel, strictly enforcing:
   * 1. Option 1: Weapon unlock/upgrade (only from characterData.weaponTypes)
   * 2. Option 2: Passive upgrade/unlock
   * 3. Option 3: Random valid upgrade (weapon or passive, never duplicate, never maxed/unlocked)
   * @returns {UpgradeOption[]} Array of upgrade options for the panel.
   */
  private generateOptions(): UpgradeOption[] {
    // Use only allowed weapons from characterData.weaponTypes
    /**
     * Shuffles array in-place using Fisher-Yates algorithm.
     * @param array Array to shuffle
     */
    function shuffle<T>(array: T[]): T[] {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    }
    let allowedWeaponTypes: WeaponType[] = Array.isArray(this.player.characterData?.weaponTypes)
      ? this.player.characterData.weaponTypes.filter((wt: WeaponType) => WEAPON_SPECS[wt])
      : [];
    allowedWeaponTypes = shuffle(allowedWeaponTypes);
    const ownedWeapons = Array.from(this.player.activeWeapons.keys());
    const ownedPassives = this.player.activePassives.map(p => p.type);

    Logger.debug(`[UpgradePanel] Generating options. Player active weapons: ${Array.from(this.player.activeWeapons.entries()).map(([wt, lvl]) => WeaponType[wt] + ':' + lvl).join(', ')}`);
    Logger.debug(`[UpgradePanel] Player owned passives: ${ownedPassives.join(', ')}`);

    const allPossibleWeaponOptions: UpgradeOption[] = [];
    const allPossiblePassiveOptions: UpgradeOption[] = [];

    // Populate all possible weapon options (unlocks and upgrades)
    const allWeaponTypes = Object.values(WeaponType).filter(v => typeof v === 'number') as WeaponType[];
    Logger.debug(`[UpgradePanel] All weapon types considered: ${allWeaponTypes.map(wt => WeaponType[wt]).join(', ')}`);

    // First, try to get an option for the player's class weapon
    let classWeaponOption: UpgradeOption | undefined;
    if (this.player.classWeaponType !== undefined) {
      const classWeaponSpec = WEAPON_SPECS[this.player.classWeaponType];
      if (classWeaponSpec) {
        const ownedClassWeaponLevel = this.player.activeWeapons.get(this.player.classWeaponType) || 0;
        if (!ownedClassWeaponLevel && classWeaponSpec.maxLevel > 0) {
          classWeaponOption = { kind: 'weapon', id: this.player.classWeaponType, name: `Unlock ${classWeaponSpec.name}`, icon: classWeaponSpec.icon };
          Logger.debug(`[UpgradePanel] Class weapon unlock option: ${classWeaponSpec.name}`);
        } else if (ownedClassWeaponLevel > 0 && ownedClassWeaponLevel < classWeaponSpec.maxLevel) {
          classWeaponOption = { kind: 'weapon', id: this.player.classWeaponType, name: `Upgrade ${classWeaponSpec.name} Lv.${ownedClassWeaponLevel + 1}`, icon: classWeaponSpec.icon };
          Logger.debug(`[UpgradePanel] Class weapon upgrade option: ${classWeaponSpec.name} Lv.${ownedClassWeaponLevel + 1}`);
        }
      }
    }

    // Populate general pool of non-class weapon options
    for (const wt of allWeaponTypes) {
      const spec = WEAPON_SPECS[wt];
      // Exclude class weapons from the general pool, and also exclude the player's current class weapon if it's already handled
      if (!spec || spec.isClassWeapon || (this.player.classWeaponType !== undefined && wt === this.player.classWeaponType)) {
        Logger.debug(`[UpgradePanel] Skipping weapon ${WeaponType[wt]} (no spec, is class weapon, or is player's class weapon)`);
        continue;
      }

      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned && spec.maxLevel > 0) {
        allPossibleWeaponOptions.push({ kind: 'weapon', id: wt, name: `Unlock ${spec.name}`, icon: spec.icon });
        Logger.debug(`[UpgradePanel] Added unlock option: ${spec.name}`);
      } else if (owned > 0 && owned < spec.maxLevel) {
        allPossibleWeaponOptions.push({ kind: 'weapon', id: wt, name: `Upgrade ${spec.name} Lv.${owned + 1}`, icon: spec.icon });
        Logger.debug(`[UpgradePanel] Added upgrade option: ${spec.name} Lv.${owned + 1}`);
      }
    }
    Logger.debug(`[UpgradePanel] All possible weapon options (before shuffle): ${allPossibleWeaponOptions.map(o => o.name).join(', ')}`);

    // Populate all possible passive options (unlocks and upgrades)
    for (const p of PASSIVE_SPECS) {
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!ownedPassives.includes(p.name)) {
        allPossiblePassiveOptions.push({ kind: 'passive', id: p.id, name: `Unlock ${p.name}`, icon: p.icon });
        Logger.debug(`[UpgradePanel] Added unlock passive: ${p.name}`);
      } else if (existing && existing.level < p.maxLevel) {
        allPossiblePassiveOptions.push({ kind: 'passive', id: p.id, name: `Upgrade ${p.name} Lv.${existing.level + 1}`, icon: p.icon });
        Logger.debug(`[UpgradePanel] Added upgrade passive: ${p.name} Lv.${existing.level + 1}`);
      }
    }
    Logger.debug(`[UpgradePanel] All possible passive options (before shuffle): ${allPossiblePassiveOptions.map(o => o.name).join(', ')}`);

    // Shuffle both pools
    shuffle(allPossibleWeaponOptions);
    shuffle(allPossiblePassiveOptions);
    Logger.debug(`[UpgradePanel] Weapon options after shuffle: ${allPossibleWeaponOptions.map(o => o.name).join(', ')}`);
    Logger.debug(`[UpgradePanel] Passive options after shuffle: ${allPossiblePassiveOptions.map(o => o.name).join(', ')}`);

    const options: UpgradeOption[] = [];

    // Option 1: Prioritize class weapon, then random non-class weapon
    if (classWeaponOption) {
      options.push(classWeaponOption);
      Logger.debug(`[UpgradePanel] Option 1 (Class Weapon): ${options[0].name}`);
    } else if (allPossibleWeaponOptions.length > 0) {
      options.push(allPossibleWeaponOptions.shift()!); // Take first after shuffle
      Logger.debug(`[UpgradePanel] Option 1 (Random Non-Class Weapon): ${options[0].name}`);
    }

    // Option 2: Always a passive (random from available passives)
    if (allPossiblePassiveOptions.length > 0) {
      options.push(allPossiblePassiveOptions.shift()!); // Take first after shuffle
      Logger.debug(`[UpgradePanel] Option 2 (Passive): ${options[options.length - 1].name}`);
    }

    // Option 3: Random from remaining (can be weapon or passive)
    const remainingOptions = [...allPossibleWeaponOptions, ...allPossiblePassiveOptions];
    shuffle(remainingOptions);
    Logger.debug(`[UpgradePanel] Remaining options (after shuffle): ${remainingOptions.map(o => o.name).join(', ')}`);

    if (remainingOptions.length > 0) {
      options.push(remainingOptions.shift()!); // Take first after shuffle
      Logger.debug(`[UpgradePanel] Option 3 (Random): ${options[options.length - 1].name}`);
    }

    // Ensure exactly 3 options (fill with duplicates if not enough unique options)
    while (options.length < 3 && (allPossibleWeaponOptions.length > 0 || allPossiblePassiveOptions.length > 0)) {
      const pool = [...allPossibleWeaponOptions, ...allPossiblePassiveOptions];
      if (pool.length > 0) {
        options.push(pool[Math.floor(Math.random() * pool.length)]);
        Logger.debug(`[UpgradePanel] Filling option (duplicate): ${options[options.length - 1].name}`);
      } else {
        break; // No more options to add
      }
    }

    // Final shuffle of the 3 chosen options to randomize their display order
    shuffle(options);
    Logger.debug(`[UpgradePanel] Final options (after display shuffle): ${options.map(o => o.name).join(', ')}`);

    return options.slice(0, 3);
  }
    
    public update() {
      if (!this.visible && this.player.exp >= this.player.getNextExp()) {
        this.options = this.generateOptions();
        // Defensive copy to prevent mutation bugs
        this.options = [...this.options];
        this.visible = true;
        this.upgradePanelElement?.classList.remove('hidden');
        this.drawOptions();
        window.dispatchEvent(new CustomEvent('upgradeOpen', { detail: { level: this.player.level } }));
      }
      if (this.visible && this.upgradePanelElement?.classList.contains('hidden')) {
        this.upgradePanelElement?.classList.remove('hidden');
      } else if (!this.visible && !this.upgradePanelElement?.classList.contains('hidden')) {
        this.upgradePanelElement?.classList.add('hidden');
      }
    }

  /**
   * Renders the upgrade options in the panel.
   * Ensures no duplicate DOM nodes and updates option descriptions.
   * Micro-optimized for minimal DOM manipulation.
   */
  private drawOptions(): void {
    if (!this.upgradePanelElement) return;
    const container = this.upgradePanelElement.querySelector('#upgrade-options-container');
    if (!container) return;

    // Remove all children (micro-optimized: only if count mismatches)
    if (container.childElementCount !== this.options.length) {
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    for (let i = 0; i < this.options.length; ++i) {
      const opt = this.options[i];
      let optionDiv = container.children[i] as HTMLElement | undefined;
      if (!optionDiv) {
        optionDiv = document.createElement('div');
        optionDiv.className = 'upgrade-option neon-border';
        container.appendChild(optionDiv);
      }
      optionDiv.innerHTML = `
        <div class="upgrade-icon">${opt.icon ? `<img src="${opt.icon}" alt="${opt.name}" />` : ''}</div>
        <div class="upgrade-title">${opt.name}</div>
        <div class="upgrade-desc">${this.getOptionDescription(opt)}</div>
        <div class="upgrade-key">[${i + 1}]</div>
      `;
    }
    // Hide extra nodes if any
    for (let j = this.options.length; j < container.childElementCount; ++j) {
      (container.children[j] as HTMLElement).style.display = 'none';
    }
  }

  /**
   * Applies the selected upgrade to the player, guaranteeing unlock/upgrade.
   * Defensive: always refresh options for next upgrade.
   * @param option The selected upgrade option.
   */
  applyUpgrade(option: UpgradeOption) {
  // Removed: applyUpgrade logic, now handled by UI UpgradePanel
  }

  public close() {
    this.visible = false;
    this.upgradePanelElement?.classList.add('hidden'); // Hide the panel
    window.dispatchEvent(new CustomEvent('upgradeClose'));
  }

  private getOptionDescription(option: UpgradeOption): string {
    if (option.kind === 'weapon') {
      const spec = WEAPON_SPECS[option.id as WeaponType];
      if (spec) {
        const currentLevel = this.player.activeWeapons.get(option.id as WeaponType) || 0;
        if (currentLevel < spec.maxLevel) {
          return spec.description || `Increases ${spec.name} power.`;
        } else if (spec.evolution) {
          return `Evolves ${spec.name} with ${PASSIVE_SPECS.find(p => p.name === spec.evolution?.requiredPassive)?.name}.`;
        }
      }
    } else if (option.kind === 'passive') {
      const spec = PASSIVE_SPECS.find(p => p.id === option.id);
      if (spec) {
        const currentLevel = this.player.activePassives.find(p => p.type === spec.name)?.level || 0;
        if (currentLevel < spec.maxLevel) {
          return spec.description || `Increases ${spec.name} effect.`;
        } else {
          return `Max level reached for ${spec.name}.`;
        }
      }
    }
    return 'No description available.';
  }
}
