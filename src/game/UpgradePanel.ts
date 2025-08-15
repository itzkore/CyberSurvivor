import { Player } from '../game/Player';
import { WeaponType } from './WeaponType';
import { PASSIVE_SPECS, applyPassive } from './PassiveConfig';
// Update the import path if WeaponSpecs.ts is located elsewhere, for example:
import { WEAPON_SPECS } from './WeaponConfig'; // Example: adjust '../game/' as needed

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
      if (!isNaN(idx)) {
        this.applyUpgrade(idx - 1);
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

  private generateOptions(): UpgradeOption[] {
    const ownedWeapons = Array.from(this.player.activeWeapons.keys());
    const items: UpgradeOption[] = [];
    const availableWeapons = this.getAvailableWeapons().filter(w => {
      const spec = (WEAPON_SPECS as any)[w];
      const currentLevel = this.player.activeWeapons.get(w as WeaponType) || 0;
      return (!ownedWeapons.includes(w) || (spec && currentLevel < spec.maxLevel));
    });

    // Always add at least one weapon unlock or upgrade
    let weaponAdded = false;
    for (const w of availableWeapons) {
      if (items.length >= 5) break;
      const spec = (WEAPON_SPECS as any)[w];
      const currentLevel = this.player.activeWeapons.get(w as WeaponType) || 0;
      if (!ownedWeapons.includes(w)) {
        items.push({ kind: 'weapon', id: w, name: `Unlock ${spec.name}`, icon: spec.icon });
        weaponAdded = true;
      } else if (spec && currentLevel < spec.maxLevel) {
        items.push({ kind: 'weapon', id: w, name: `Upgrade ${spec.name} Lv.${currentLevel + 1}`, icon: spec.icon });
        weaponAdded = true;
      }
    }

    // Fill remaining slots with passives
    const passives = PASSIVE_SPECS;
    let i = 0;
    while (items.length < 5 && i < passives.length) {
      const p = passives[i];
      items.push({ kind: 'passive', id: p.id, name: p.name, icon: p.icon });
      i++;
    }

    // If for some reason no weapon was added, forcibly add a random available weapon
    if (!weaponAdded && availableWeapons.length > 0) {
      const w = availableWeapons[0];
      const spec = (WEAPON_SPECS as any)[w];
      items[0] = { kind: 'weapon', id: w, name: `Unlock ${spec.name}`, icon: spec.icon };
    }
    return items.slice(0, 5);
  }

  private renderOptions() {
    const optionsContainer = this.upgradePanelElement?.querySelector('#upgrade-options-container');
    if (!optionsContainer) return;

    optionsContainer.innerHTML = ''; // Clear previous options

    this.options.forEach((opt, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'upgrade-option';
      optionElement.style.fontSize = '2em';
      optionElement.style.padding = '28px';
      optionElement.style.margin = '18px';
      optionElement.style.borderRadius = '18px';
      optionElement.style.boxShadow = '0 0 24px #FFD700, 0 0 48px #FF00FF';
      optionElement.style.background = 'linear-gradient(90deg, #222 0%, #FFD700 60%, #FF00FF 100%)';
      optionElement.style.transition = 'transform 0.18s, box-shadow 0.18s';
      optionElement.innerHTML = `
        <div class="option-content" style="display:flex;align-items:center;gap:24px;">
          <div style="position:relative;">
            <img src="${opt.icon || ''}" alt="${opt.name}" class="option-icon" style="width:56px;height:56px;box-shadow:0 0 12px #FFD700;border-radius:12px;"/>
            <span style="position:absolute;top:-18px;left:0;font-size:1em;color:#FFD700;text-shadow:0 0 8px #FF00FF;">${index + 1}</span>
          </div>
          <span class="option-name neon-text-cyan" style="font-size:1.1em;">${opt.name}</span>
          <span class="option-kind" style="font-size:0.95em;opacity:0.7;">${opt.kind === 'weapon' ? 'Weapon' : 'Passive'}</span>
        </div>
      `;
      optionElement.addEventListener('mouseenter', () => {
        optionElement.style.transform = 'scale(1.07)';
        optionElement.style.boxShadow = '0 0 48px #FFD700, 0 0 96px #FF00FF';
      });
      optionElement.addEventListener('mouseleave', () => {
        optionElement.style.transform = 'scale(1)';
        optionElement.style.boxShadow = '0 0 24px #FFD700, 0 0 48px #FF00FF';
      });
      optionElement.addEventListener('click', () => this.applyUpgrade(index));
      // Keyboard shortcut hint
      optionElement.title = `Press [${index + 1}] or click to select`;
      optionsContainer.appendChild(optionElement);
    });
  }

  public update() {
    if (!this.visible && this.player.exp >= this.player.getNextExp()) {
      this.options = this.generateOptions();
      // Defensive copy to prevent mutation bugs
      this.options = [...this.options];
      this.visible = true;
      this.upgradePanelElement?.classList.remove('hidden');
      this.renderOptions();
      window.dispatchEvent(new CustomEvent('upgradeOpen', { detail: { level: this.player.level } }));
    }
    if (this.visible && this.upgradePanelElement?.classList.contains('hidden')) {
      this.upgradePanelElement?.classList.remove('hidden');
    } else if (!this.visible && !this.upgradePanelElement?.classList.contains('hidden')) {
      this.upgradePanelElement?.classList.add('hidden');
    }
  }

  public applyUpgrade(index: number) {
    // Defensive: always use a fresh copy of options
    const opts = [...this.options];
    // Fix: Clamp index to valid range
    const opt = opts[Math.max(0, Math.min(index, opts.length - 1))];
    if (!opt) return;
    if (opt.kind === 'weapon') {
      // Fix: Ensure correct weapon type is selected
      const weaponType = opt.id as WeaponType;
      if (!this.player.activeWeapons.has(weaponType)) {
        this.player.addWeapon(weaponType);
        this.player.upgrades.push(`Weapon:${opt.name}`);
      } else {
        // Upgrade weapon if not at max level
        const spec = WEAPON_SPECS[weaponType];
        const currentLevel = this.player.activeWeapons.get(weaponType) || 0;
        if (spec && currentLevel < spec.maxLevel) {
          this.player.addWeapon(weaponType);
          this.player.upgrades.push(`Weapon:${opt.name} Lv.${currentLevel + 1}`);
        }
      }
    } else {
      const existingPassive = this.player.activePassives.find(p => p.type === opt.name);
      const passiveLevel = existingPassive ? existingPassive.level + 1 : 1;
      applyPassive(this.player, opt.id, passiveLevel);
      this.player.upgrades.push(`Passive:${opt.name}`);
    }
    this.player.exp -= this.player.getNextExp();
    this.player.level += 1;
    this.visible = false;
    this.upgradePanelElement?.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('upgradeClose'));
  }

  public close() {
    this.visible = false;
    this.upgradePanelElement?.classList.add('hidden'); // Hide the panel
    window.dispatchEvent(new CustomEvent('upgradeClose'));
  }
}
