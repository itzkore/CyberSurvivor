import { Player } from '../game/Player';
import { WeaponType } from '../game/WeaponType';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';

interface UpgradeOption {
  type: 'weapon' | 'passive';
  id: WeaponType | number; // WeaponType for weapon, PassiveSpec.id for passive
  name: string;
  description: string;
  icon: string;
  currentLevel?: number; // For existing upgrades
}

export class UpgradePanel {
  public static showUpgradeList(ctx: CanvasRenderingContext2D, player: Player) {
    // Draw smaller upgrade list panel on the left
    const panelW = 320;
    const panelH = 420;
    const panelX = 40;
    const panelY = 60;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#111';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Upgrades This Run', panelX + 24, panelY + 36);
    ctx.font = '16px Orbitron, sans-serif';
    ctx.fillStyle = '#fff';
    const startY = panelY + 70;
    const x = panelX + 24;
    // Show upgrade levels for weapons and passives
    const weaponLevels = Array.from(player.activeWeapons.entries())
      .map(([type, level]) => {
        const spec = WEAPON_SPECS[type];
        const displayRange = spec && spec.range ? Math.floor(spec.range / 2) : 'N/A';
        return spec ? `${spec.name} Lv.${level} (Range: ${displayRange})` : '';
      });
    const passiveLevels = player.activePassives.map(p => `${p.type} Lv.${p.level}`);
    const allUpgrades = [...weaponLevels, ...passiveLevels];
    allUpgrades.slice(-18).forEach((upg, i) => {
      ctx.fillText(upg, x, startY + i * 22);
    });
    ctx.restore();
  }
  private player: Player;
  public visible: boolean = false;
  private options: UpgradeOption[] = [];

  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onMouseDown: (e: MouseEvent) => void;

  constructor(player: Player) {
    this.player = player;
    this._onKeyDown = (e: KeyboardEvent) => {
      if (!this.visible) return;
      if (e.key === '1') this.applyUpgrade(0);
      if (e.key === '2') this.applyUpgrade(1);
      if (e.key === '3') this.applyUpgrade(2);
      if (e.key === 'Escape') this.close();
    };
    this._onMouseDown = (e: MouseEvent) => {
      if (!this.visible) return;
      // Find which upgrade was clicked
      const panelW = 600;
      const panelH = 400;
      const panelX = (window.innerWidth - panelW) / 2;
      const panelY = (window.innerHeight - panelH) / 2;
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      // Each upgrade option is 110px tall, with 3 options
      for (let i = 0; i < this.options.length; i++) {
        const optY = panelY + 80 + i * 110;
        if (mouseY >= optY && mouseY <= optY + 100 && mouseX >= panelX + 40 && mouseX <= panelX + panelW - 40) {
          this.applyUpgrade(i);
          return;
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('levelup', () => this.show());
  }

  public show() {
    this.generateOptions();
    this.visible = true;
    window.dispatchEvent(new CustomEvent('upgradeOpen'));
  }

  public get isVisible() {
    return this.visible;
  }

  public update() {
    // No longer needed to check for level up here
  }

  private generateOptions() {
    this.options = [];
    const availableUpgrades: UpgradeOption[] = [];

    // Limit to 5 weapons per run
    const maxWeapons = 5;
    const ownedWeapons = Array.from(this.player.activeWeapons.keys());
    let classWeapon = undefined;
    if (this.player.characterData && this.player.characterData.defaultWeapon !== undefined) {
      classWeapon = this.player.characterData.defaultWeapon;
      if (!ownedWeapons.includes(classWeapon)) ownedWeapons.push(classWeapon);
    }

    // List of all class-unique weapons
    const allClassDefaults = [10,11,12,13,14,15,16,17,18,19,20,21];

    // Build allowedWeapons: all weapons except forbidden class-unique weapons (unless it's your own)
    const allowedWeapons: number[] = [];
    for (const w of Object.values(WeaponType).filter(v => typeof v === 'number') as number[]) {
      if (!allClassDefaults.includes(w) || w === classWeapon) {
        allowedWeapons.push(w);
      }
    }

    // If player has less than maxWeapons, offer unlocks for any allowed weapon not owned
    if (ownedWeapons.length < maxWeapons) {
      for (const w of allowedWeapons) {
        if (!ownedWeapons.includes(w)) {
          const spec = WEAPON_SPECS[w as WeaponType];
          if (spec) {
            availableUpgrades.push({
              type: 'weapon',
              id: w,
              name: spec.name,
              description: `Unlock ${spec.name}`,
              icon: spec.icon || '',
              currentLevel: 0,
            });
          }
        }
      }
    }

    // For owned weapons, offer upgrades if not at max level
    for (const weaponType of ownedWeapons) {
      const spec = WEAPON_SPECS[weaponType];
      if (!spec) continue;
      const currentLevel = this.player.activeWeapons.get(weaponType) || 0;
      if (currentLevel < spec.maxLevel) {
        if (!availableUpgrades.some(u => u.type === 'weapon' && u.id === weaponType)) {
          if (ownedWeapons.length >= maxWeapons && currentLevel === 0) continue;
          availableUpgrades.push({
            type: 'weapon',
            id: weaponType,
            name: `${spec.name} ${currentLevel > 0 ? `Lv.${currentLevel + 1}` : ''}`,
            description: currentLevel > 0 ? `Upgrade ${spec.name}` : `Unlock ${spec.name}`,
            icon: spec.icon || '',
            currentLevel: currentLevel,
          });
        }
      }
    }

    // Only allow upgrades for weapons if player has less than maxWeapons, otherwise only upgrades for owned weapons
    for (const weaponType of ownedWeapons) {
      const spec = WEAPON_SPECS[weaponType];
      if (!spec) continue;
      const currentLevel = this.player.activeWeapons.get(weaponType) || 0;
      // Only offer upgrade if not at max level
      if (currentLevel < spec.maxLevel) {
        // Prevent duplicate upgrades for weapons already at max level
        if (!availableUpgrades.some(u => u.type === 'weapon' && u.id === weaponType)) {
          // If already have max weapons, only allow upgrades, not unlocks
          if (ownedWeapons.length >= maxWeapons && currentLevel === 0) continue;
          availableUpgrades.push({
            type: 'weapon',
            id: weaponType,
            name: `${spec.name} ${currentLevel > 0 ? `Lv.${currentLevel + 1}` : ''}`,
            description: currentLevel > 0 ? `Upgrade ${spec.name}` : `Unlock ${spec.name}`,
            icon: spec.icon || '',
            currentLevel: currentLevel,
          });
        }
      }
    }

    // Limit to 5 passives per run
    const maxPassives = 5;
    const ownedPassives = this.player.activePassives.map(p => p.type);
    for (const passiveSpec of PASSIVE_SPECS) {
      const currentPassive = this.player.activePassives.find(p => p.type === passiveSpec.name);
      const currentLevel = currentPassive ? currentPassive.level : 0;
      // Only allow new passives if less than maxPassives
      if (ownedPassives.length < maxPassives || currentLevel > 0) {
        if (currentLevel < passiveSpec.maxLevel) {
          availableUpgrades.push({
            type: 'passive',
            id: passiveSpec.id,
            name: `${passiveSpec.name} ${currentLevel > 0 ? `Lv.${currentLevel + 1}` : ''}`,
            description: currentLevel > 0 ? `Upgrade ${passiveSpec.name}` : `Unlock ${passiveSpec.name}`,
            icon: passiveSpec.icon || '',
            currentLevel: currentLevel,
          });
        }
      }
    }

    // Passive upgrades
    for (const passiveSpec of PASSIVE_SPECS) {
      const currentPassive = this.player.activePassives.find(p => p.type === passiveSpec.name);
      const currentLevel = currentPassive ? currentPassive.level : 0;
      if (currentLevel < passiveSpec.maxLevel) {
        availableUpgrades.push({
          type: 'passive',
          id: passiveSpec.id,
          name: `${passiveSpec.name} ${currentLevel > 0 ? `Lv.${currentLevel + 1}` : ''}`,
          description: currentLevel > 0 ? `Upgrade ${passiveSpec.name}` : `Unlock ${passiveSpec.name}`,
          icon: passiveSpec.icon || '',
          currentLevel: currentLevel,
        });
      }
    }

    // If no weapon upgrades are present, forcibly add PISTOL or HOMING as fallback
    if (!availableUpgrades.some(u => u.type === 'weapon')) {
      const fallbackWeapon = WEAPON_SPECS[WeaponType.PISTOL] || WEAPON_SPECS[WeaponType.HOMING];
      availableUpgrades.unshift({
        type: 'weapon',
        id: fallbackWeapon.id,
        name: fallbackWeapon.name,
        description: `Unlock ${fallbackWeapon.name}`,
        icon: fallbackWeapon.icon || '',
        currentLevel: 0,
      });
    }
    // Shuffle and pick 3
    const shuffled = availableUpgrades.sort(() => 0.5 - Math.random());
    this.options = shuffled.slice(0, 3);
  }

  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.visible) return;

    // Dark overlay
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();

  // Panel background (make it bigger)
  const panelW = 600;
  const panelH = 400;
  const panelX = (ctx.canvas.width - panelW) / 2;
  const panelY = (ctx.canvas.height - panelH) / 2;
  ctx.save();
  ctx.fillStyle = '#222';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#0ff';
  ctx.lineWidth = 4;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 24px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CHOOSE UPGRADE', ctx.canvas.width / 2, panelY + 40);

    // Draw options
    ctx.font = '18px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    this.options.forEach((option, index) => {
  const yOffset = panelY + 100 + (index * 90);
  const xOffset = panelX + 40;

  // Draw option background
  ctx.fillStyle = '#333';
  ctx.fillRect(xOffset, yOffset - 30, panelW - 80, 80);
  ctx.strokeStyle = '#0ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(xOffset, yOffset - 30, panelW - 80, 80);

  // Draw icon (placeholder for now)
  ctx.fillStyle = '#fff'; // Icon color
  ctx.fillRect(xOffset + 10, yOffset - 10, 50, 50); // Bigger icon

  ctx.fillStyle = '#0ff';
  ctx.font = 'bold 22px Orbitron, sans-serif';
  ctx.fillText(`${index + 1}. ${option.name}`, xOffset + 70, yOffset);
  ctx.font = '16px Orbitron, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(option.description, xOffset + 70, yOffset + 28);
    });

    ctx.restore();
  }

  private applyUpgrade(choiceIndex: number) {
    const chosen = this.options[choiceIndex];
    if (!chosen) return;

    if (chosen.type === 'weapon') {
      // Only apply upgrade if not at max level
      const currentLevel = this.player.activeWeapons.get(chosen.id as WeaponType) || 0;
      const spec = WEAPON_SPECS[chosen.id as WeaponType];
      if (spec && currentLevel < spec.maxLevel) {
        this.player.addWeapon(chosen.id as WeaponType);
      }
    } else if (chosen.type === 'passive') {
      const passiveSpec = PASSIVE_SPECS.find(p => p.id === chosen.id);
      if (passiveSpec) {
        if (passiveSpec.name.toLowerCase().includes('regen')) {
          // Regen upgrade: increase player regen stat
          this.player.regen = (this.player.regen || 0) + 1;
        } else if (passiveSpec.name.toLowerCase().includes('hp')) {
          // HP upgrade: increase max HP and heal
          this.player.maxHp += 10;
          this.player.hp = Math.min(this.player.hp + 10, this.player.maxHp);
        }
        this.player.addPassive(passiveSpec.name);
      }
    }

    this.close();
  }

  public close() {
    if (!this.visible) return;
    this.visible = false;
    window.dispatchEvent(new CustomEvent('upgradeClose'));
  }
}
