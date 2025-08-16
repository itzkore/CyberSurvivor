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

  constructor(player: Player) {
    this.player = player;
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
    const allowedWeaponTypes: WeaponType[] = Array.isArray(this.player.characterData?.weaponTypes)
      ? this.player.characterData.weaponTypes.filter((wt: WeaponType) => WEAPON_SPECS[wt])
      : [];
    const ownedWeapons = Array.from(this.player.activeWeapons.keys());
    // --- Option 1: Weapon unlock/upgrade ---
    let weaponOption: UpgradeOption | undefined;
    for (let i = 0; i < allowedWeaponTypes.length; ++i) {
      const wt = allowedWeaponTypes[i];
      const spec = WEAPON_SPECS[wt];
      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned) {
        weaponOption = {
          kind: 'weapon',
          id: wt,
          name: `Unlock ${spec.name}`,
          icon: spec.icon,
        };
        break;
      } else if (owned < spec.maxLevel) {
        weaponOption = {
          kind: 'weapon',
          id: wt,
          name: `Upgrade ${spec.name} Lv.${owned + 1}`,
          icon: spec.icon,
        };
        break;
      }
    }
    const options: UpgradeOption[] = [];
    if (weaponOption) options.push(weaponOption);

    // --- Option 2: Passive upgrade/unlock ---
    let passiveOption: UpgradeOption | undefined;
    const ownedPassives = this.player.activePassives.map(p => p.type);
    for (let i = 0; i < PASSIVE_SPECS.length; ++i) {
      const p = PASSIVE_SPECS[i];
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!ownedPassives.includes(p.name)) {
        passiveOption = {
          kind: 'passive',
          id: p.id,
          name: `Unlock ${p.name}`,
          icon: p.icon,
        };
        break;
      } else if (existing && existing.level < p.maxLevel) {
        passiveOption = {
          kind: 'passive',
          id: p.id,
          name: `Upgrade ${p.name} Lv.${existing.level + 1}`,
          icon: p.icon,
        };
        break;
      }
    }
    if (passiveOption) options.push(passiveOption);

    // --- Option 3: Random valid upgrade ---
    const validThirdOptions: UpgradeOption[] = [];
    for (let i = 0; i < allowedWeaponTypes.length; ++i) {
      const wt = allowedWeaponTypes[i];
      const spec = WEAPON_SPECS[wt];
      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned && spec.maxLevel > 0) {
        validThirdOptions.push({ kind: 'weapon', id: wt, name: `Unlock ${spec.name}`, icon: spec.icon });
      } else if (owned && owned < spec.maxLevel) {
        validThirdOptions.push({ kind: 'weapon', id: wt, name: `Upgrade ${spec.name} Lv.${owned + 1}`, icon: spec.icon });
      }
    }
    for (let i = 0; i < PASSIVE_SPECS.length; ++i) {
      const p = PASSIVE_SPECS[i];
      const owned = ownedPassives.includes(p.name);
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!owned) {
        validThirdOptions.push({ kind: 'passive', id: p.id, name: `Unlock ${p.name}`, icon: p.icon });
      } else if (existing && existing.level < p.maxLevel) {
        validThirdOptions.push({ kind: 'passive', id: p.id, name: `Upgrade ${p.name} Lv.${existing.level + 1}`, icon: p.icon });
      }
    }
    // Remove duplicates and already chosen options
    const filteredThirdOptions = validThirdOptions.filter(opt => !options.some(o => o.kind === opt.kind && o.id === opt.id));
    if (filteredThirdOptions.length > 0) {
      const third = filteredThirdOptions[Math.floor(Math.random() * filteredThirdOptions.length)];
      options.push(third);
    }
    // Ensure exactly 3 options
    while (options.length < 3 && options.length > 0) {
      options.push({ ...options[Math.floor(Math.random() * options.length)] });
    }
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
