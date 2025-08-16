// CyberSurvivor UI UpgradePanel
import { Player } from '../game/Player';
import { WeaponType } from '../game/WeaponType';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';

export interface UpgradeOption {
  type: 'weapon' | 'passive';
  id: WeaponType | number;
  name: string;
  description: string;
  icon: string;
  currentLevel?: number;
}

export class UpgradePanel {
  /**
   * Updates the player reference for the upgrade panel.
   * Call this after game resets the player.
   */
  public setPlayer(player: Player): void {
    this.player = player;
  }
  private panelElement: HTMLElement | null = null;

  /**
   * Show the upgrade selector panel and render options.
   */
  public show(): void {
    if (!this.panelElement) {
      this.panelElement = document.getElementById('upgrade-panel');
      if (!this.panelElement) {
        // Create panel if missing
        this.panelElement = document.createElement('div');
        this.panelElement.id = 'upgrade-panel';
        this.panelElement.className = 'upgrade-panel-container';
        document.body.appendChild(this.panelElement);
      }
    }
    this.panelElement.style.display = 'block';
    this.visible = true;
    this.options = this.generateOptions();
    this.renderOptions();
  }

  /**
   * Hide the upgrade selector panel.
   */
  public hide(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
    }
    this.visible = false;
  }

  /**
   * Render upgrade options in the panel.
   */
  private renderOptions(): void {
    if (!this.panelElement) return;
    this.panelElement.innerHTML = '<h2 class="neon-text-cyan">Choose Upgrade</h2>';
    const container = document.createElement('div');
    container.className = 'upgrade-options-container';
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
    this.panelElement.appendChild(container);
  }

  /**
   * Apply the selected upgrade and hide panel.
   */
  private applyUpgrade(index: number): void {
    const chosen = this.options[index];
    if (!chosen) return;
    if (chosen.type === 'weapon') {
      this.player.addWeapon(chosen.id as WeaponType);
    } else if (chosen.type === 'passive') {
      const passiveSpec = PASSIVE_SPECS.find(ps => ps.id === chosen.id);
      if (passiveSpec) {
        this.player.addPassive(passiveSpec.name);
      }
    }
    this.hide();
    if (this.game && typeof this.game.setState === 'function') {
      this.game.setState('GAME'); // Unpause after upgrade selection
    }
  }
  private player: Player;
  private game: any;
  public visible: boolean = false;
  public options: UpgradeOption[] = [];

  constructor(player: Player, game: any) {
    this.player = player;
    this.game = game;
  }

  /**
   * Generates upgrade options for the panel, strictly enforcing:
   * 1. Option 1: Weapon unlock/upgrade (only from characterData.weaponTypes, excluding class weapons)
   * 2. Option 2: Passive upgrade/unlock
   * 3. Option 3: Random valid upgrade (weapon or passive, never duplicate, never maxed/unlocked)
   * Fallback: If characterData.weaponTypes is missing/empty, offer all non-class weapons.
   * @returns {UpgradeOption[]} Array of upgrade options for the panel.
   */
  /**
   * Renders upgrade options in the panel with improved card layout.
   * Each card shows icon, name, description, type, and current level.
   */
  public generateOptions(): UpgradeOption[] {
    let allowedWeaponTypes: WeaponType[] = [];
    if (Array.isArray(this.player.characterData?.weaponTypes) && this.player.characterData.weaponTypes.length > 0) {
      allowedWeaponTypes = this.player.characterData.weaponTypes.filter((wt: WeaponType) => WEAPON_SPECS[wt] && !WEAPON_SPECS[wt].isClassWeapon);
    } else {
      // Fallback: allow all non-class weapon types from WEAPON_SPECS
      allowedWeaponTypes = Object.keys(WEAPON_SPECS)
        .map(k => Number(k))
        .filter(k => typeof k === 'number' && WEAPON_SPECS[k as WeaponType] && WEAPON_SPECS[k as WeaponType].maxLevel > 0 && !WEAPON_SPECS[k as WeaponType].isClassWeapon) as WeaponType[];
    }
    // Debug output
    console.debug('[UpgradePanel] allowedWeaponTypes:', allowedWeaponTypes);
    const ownedWeapons = Array.from(this.player.activeWeapons.keys());
    const ownedPassives = this.player.activePassives.map(p => p.type);

    // 1. Weapon option
    let weaponOption: UpgradeOption | undefined;
    for (let i = 0; i < allowedWeaponTypes.length; ++i) {
      const wt = allowedWeaponTypes[i];
      const spec = WEAPON_SPECS[wt];
      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned) {
        weaponOption = {
          type: 'weapon',
          id: wt,
          name: `Unlock ${spec.name}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: 0
        };
        break;
      } else if (owned < spec.maxLevel) {
        weaponOption = {
          type: 'weapon',
          id: wt,
          name: `Upgrade ${spec.name} Lv.${owned + 1}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: owned
        };
        break;
      }
    }
    // After weaponOption assignment
    console.debug('[UpgradePanel] weaponOption:', weaponOption);
    for (let i = 0; i < allowedWeaponTypes.length; ++i) {
      const wt = allowedWeaponTypes[i];
      const spec = WEAPON_SPECS[wt];
      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned) {
        weaponOption = {
          type: 'weapon',
          id: wt,
          name: `Unlock ${spec.name}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: 0
        };
        break;
      } else if (owned < spec.maxLevel) {
        weaponOption = {
          type: 'weapon',
          id: wt,
          name: `Upgrade ${spec.name} Lv.${owned + 1}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: owned
        };
        break;
      }
    }

    // 2. Passive option
    let passiveOption: UpgradeOption | undefined;
    for (let i = 0; i < PASSIVE_SPECS.length; ++i) {
      const p = PASSIVE_SPECS[i];
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!ownedPassives.includes(p.name)) {
        passiveOption = {
          type: 'passive',
          id: p.id,
          name: `Unlock ${p.name}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: 0
        };
        break;
      } else if (existing && existing.level < p.maxLevel) {
        passiveOption = {
          type: 'passive',
          id: p.id,
          name: `Upgrade ${p.name} Lv.${existing.level + 1}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: existing.level
        };
        break;
      }
    }

    // 3. Random valid upgrade (weapon or passive, not duplicate, not maxed/unlocked)
    const validRandomOptions: UpgradeOption[] = [];
    // Weapons
    for (let i = 0; i < allowedWeaponTypes.length; ++i) {
      const wt = allowedWeaponTypes[i];
      const spec = WEAPON_SPECS[wt];
      if (!spec || spec.isClassWeapon) continue; // Strict ban on class weapons
      const owned = this.player.activeWeapons.get(wt) || 0;
      if (!owned && (!weaponOption || wt !== weaponOption.id)) {
        validRandomOptions.push({
          type: 'weapon',
          id: wt,
          name: `Unlock ${spec.name}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: 0
        });
      } else if (owned < spec.maxLevel && (!weaponOption || wt !== weaponOption.id)) {
        validRandomOptions.push({
          type: 'weapon',
          id: wt,
          name: `Upgrade ${spec.name} Lv.${owned + 1}`,
          description: spec.description || '',
          icon: spec.icon ?? '',
          currentLevel: owned
        });
      }
    }
    // Passives
    for (let i = 0; i < PASSIVE_SPECS.length; ++i) {
      const p = PASSIVE_SPECS[i];
      const owned = ownedPassives.includes(p.name);
      const existing = this.player.activePassives.find(ap => ap.type === p.name);
      if (!owned && (!passiveOption || p.id !== passiveOption.id)) {
        validRandomOptions.push({
          type: 'passive',
          id: p.id,
          name: `Unlock ${p.name}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: 0
        });
      } else if (existing && existing.level < p.maxLevel && (!passiveOption || p.id !== passiveOption.id)) {
        validRandomOptions.push({
          type: 'passive',
          id: p.id,
          name: `Upgrade ${p.name} Lv.${existing.level + 1}`,
          description: p.description || '',
          icon: p.icon ?? '',
          currentLevel: existing.level
        });
      }
    }

    // Compose options
    const options: UpgradeOption[] = [];
    if (weaponOption) options.push(weaponOption);
    if (passiveOption) options.push(passiveOption);
    if (validRandomOptions.length > 0) {
      options.push(validRandomOptions[Math.floor(Math.random() * validRandomOptions.length)]);
    }
    // Fill up to 3 if needed
    while (options.length < 3 && options.length > 0) {
      options.push({ ...options[Math.floor(Math.random() * options.length)] });
    }
    this.options = options.slice(0, 3);
    return this.options;
  }
}
