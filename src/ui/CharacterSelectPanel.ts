import { AssetLoader } from '../game/AssetLoader';
import { WeaponType } from '../game/WeaponType';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { Logger } from '../core/Logger';

type Shape = 'circle'|'square'|'triangle';
interface Stats {
  hp?: number;
  speed?: number;
  damage?: number;
  strength?: number;
  intelligence?: number;
  agility?: number;
  luck?: number;
  defense?: number;
  [key: string]: number | undefined;
}
export interface CharacterData {
  id: string;
  sprite?: string;
  name: string;
  description: string;
  icon?: string; // Add icon property
  stats: Stats;
  look?: string;
  shape: Shape;
  color?: string;
  traits?: string[];
  initialHp?: number;
  initialSpeed?: number;
  statModifiers?: { [key: string]: number };
  defaultWeapon?: WeaponType; // Add defaultWeapon property
  weaponTypes?: WeaponType[]; // Allowed weapon types for upgrades
}
export type Character = CharacterData;

export class CharacterSelectPanel {
  private characters: CharacterData[] = [];
  private selectedCharacterIndex: number = 0;
  private hoveredCharacterIndex: number | null = null;
  private gridCols: number = 4;
  private gridRows: number = 3;
  private charBoxSize: number = 150;

  private backButton = {
    x: 0, y: 0, width: 180, height: 40,
    isHovered: false
  };

  private assetLoader: AssetLoader;

  private currentFrame: number = 0;
  private frameTimer: number = 0;
  private animationSpeed: number = 8;
  private fadeAlpha: number = 0;
  private panelElement: HTMLElement | null; // Reference to the main HTML panel
  private characterGrid: HTMLElement | null;
  private detailName: HTMLElement | null;
  private detailDescription: HTMLElement | null;
  private detailHp: HTMLElement | null;
  private detailSpeed: HTMLElement | null;
  private detailDamage: HTMLElement | null;
  private selectButton: HTMLButtonElement | null;
  private characterPortraitPreview: HTMLImageElement | null;
  private detailWeapon: HTMLElement | null;
  private backButtonEl: HTMLButtonElement | null;

  private _matrixChars?: string[]; // Preallocated array for matrix characters
  private characterSelectCanvas: HTMLCanvasElement | null;

  private matrixDrops?: number[]; // For matrix background effect

  constructor(assetLoader: AssetLoader) {
    this.assetLoader = assetLoader;
    this.panelElement = document.getElementById('character-select-panel');
    this.characterGrid = document.getElementById('character-grid');
    this.detailName = document.getElementById('detail-name');
    this.detailDescription = document.getElementById('detail-description');
    this.detailHp = document.getElementById('detail-hp');
    this.detailSpeed = document.getElementById('detail-speed');
    this.detailDamage = document.getElementById('detail-damage');
    this.selectButton = document.getElementById('select-character-btn') as HTMLButtonElement;
    this.characterPortraitPreview = document.getElementById('character-portrait-preview') as HTMLImageElement;
    this.characterSelectCanvas = document.getElementById('character-select-canvas') as HTMLCanvasElement;
    this.detailWeapon = document.getElementById('detail-weapon');
    this.backButtonEl = document.getElementById('back-to-main-btn') as HTMLButtonElement;

    this.initializeCharacters();
    this.render();

    this.selectButton?.addEventListener('click', () => this.handleSelect());
    this.backButtonEl?.addEventListener('click', () => this.handleBack());
  }

  /**
   * Displays the character selection panel UI.
   */
  public show(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'flex'; // Or 'block', depending on desired layout
      Logger.debug('CharacterSelectPanel: show() called, panelElement display set to flex.');
      if (this.characterSelectCanvas) {
        // Set canvas dimensions to match window size
        this.characterSelectCanvas.width = window.innerWidth;
        this.characterSelectCanvas.height = window.innerHeight;
        window.addEventListener('resize', this.handleResize);
        console.log('CharacterSelectPanel: Canvas resized and resize listener added.');
      }
      if (this.characterSelectCanvas) {
        this.drawMatrixBackground(this.characterSelectCanvas.getContext('2d')!, this.characterSelectCanvas);
        console.log('CharacterSelectPanel: Matrix background drawn.');
      }
      this.render(); // Re-render when shown
      console.log('CharacterSelectPanel: render() called from show().');

      // Log computed styles after rendering
      setTimeout(() => {
        if (this.panelElement) {
          const panelStyle = window.getComputedStyle(this.panelElement);
          console.log('Computed Style - .character-select-panel:', {
            display: panelStyle.display,
            flexDirection: panelStyle.flexDirection,
            alignItems: panelStyle.alignItems,
            justifyContent: panelStyle.justifyContent,
            width: panelStyle.width,
            height: panelStyle.height,
            zIndex: panelStyle.zIndex,
          });
        }
        const characterSelectContent = document.querySelector('.character-select-content');
        if (characterSelectContent) {
          const contentStyle = window.getComputedStyle(characterSelectContent);
          console.log('Computed Style - .character-select-content:', {
            display: contentStyle.display,
            flexDirection: contentStyle.flexDirection,
            alignItems: contentStyle.alignItems,
            justifyContent: contentStyle.justifyContent,
            gap: contentStyle.gap,
            width: contentStyle.width,
            maxWidth: contentStyle.maxWidth,
            flexWrap: contentStyle.flexWrap,
            zIndex: contentStyle.zIndex,
          });
        }
        if (this.characterGrid) {
          const gridStyle = window.getComputedStyle(this.characterGrid);
          console.log('Computed Style - .character-grid:', {
            display: gridStyle.display,
            gridTemplateColumns: gridStyle.gridTemplateColumns,
            gridTemplateRows: gridStyle.gridTemplateRows,
            gap: gridStyle.gap,
            minWidth: gridStyle.minWidth,
            maxWidth: gridStyle.maxWidth,
            padding: gridStyle.padding,
            zIndex: gridStyle.zIndex,
          });
        }
        const characterInfoBox = document.querySelector('.character-info-box');
        if (characterInfoBox) {
          const infoBoxStyle = window.getComputedStyle(characterInfoBox);
          console.log('Computed Style - .character-info-box:', {
            display: infoBoxStyle.display,
            flexDirection: infoBoxStyle.flexDirection,
            alignItems: infoBoxStyle.alignItems,
            justifyContent: infoBoxStyle.justifyContent,
            minWidth: infoBoxStyle.minWidth,
            maxWidth: infoBoxStyle.maxWidth,
            minHeight: infoBoxStyle.minHeight,
            alignSelf: infoBoxStyle.alignSelf,
            zIndex: infoBoxStyle.zIndex,
          });
        }
        console.log('Number of characters rendered:', this.characterGrid?.children.length);
      }, 500); // Delay to ensure styles are applied
    }
  }

  /**
   * Hides the character selection panel UI.
   */
  public hide(): void {
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
      if (this.characterSelectCanvas) {
        window.removeEventListener('resize', this.handleResize);
      }
    }
  }

  private render() {
    console.log('CharacterSelectPanel: render() called.');
    if (!this.characterGrid) {
      Logger.error('CharacterSelectPanel: characterGrid element not found!');
      return;
    }

    this.characterGrid.innerHTML = ''; // Clear existing grid
    console.log('CharacterSelectPanel: characterGrid cleared.');

    this.characters.slice(0, 12).forEach((char, index) => { // Limit to 12 characters for 2x6 grid
      const charBox = document.createElement('div');
      charBox.className = 'character-box';
      if (index === this.selectedCharacterIndex) {
        charBox.classList.add('selected');
      }
      charBox.textContent = char.name;
      charBox.addEventListener('click', () => {
        this.selectedCharacterIndex = index;
        this.render(); // Re-render to update selection highlight
      });

      if (this.characterGrid) {
        this.characterGrid.appendChild(charBox);
        console.log(`CharacterSelectPanel: Appended character box for ${char.name}.`);
      }
    });

    this.updateDetailsPanel();
    console.log('CharacterSelectPanel: updateDetailsPanel() called from render().');
  }

  private updateDetailsPanel() {
    const selectedChar = this.characters[this.selectedCharacterIndex];
    if (!selectedChar || !this.detailName || !this.detailDescription || !this.detailHp || !this.detailSpeed || !this.detailDamage) return;

    this.detailName.textContent = selectedChar.name;
    this.detailDescription.textContent = selectedChar.description;
    this.detailHp.textContent = selectedChar.stats.hp?.toString() || 'N/A';
    this.detailSpeed.textContent = selectedChar.stats.speed?.toString() || 'N/A';
    this.detailDamage.textContent = selectedChar.stats.damage?.toString() || 'N/A';

    if (this.characterPortraitPreview) {
      this.characterPortraitPreview.src = selectedChar.icon || ''; // Use the icon path directly
    }
    if (this.detailWeapon) {
      this.detailWeapon.textContent = selectedChar.defaultWeapon?.toString() || 'N/A';
    }
  }

  private handleSelect() {
    const selectedChar = this.characters[this.selectedCharacterIndex];
    if (selectedChar) {
      // Dispatch 'startGame' event with selected character data
      window.dispatchEvent(new CustomEvent('startGame', { detail: selectedChar }));
      this.hide();
    }
  }

  private handleBack() {
    this.hide();
    window.dispatchEvent(new CustomEvent('showMainMenu'));
  }

  private initializeCharacters() {
  const baseStats = { hp: 100, speed: 2.0, damage: 10, strength: 5, intelligence: 5, agility: 5, luck: 5, defense: 5, attackSpeed: 0.5 } as Stats;

    const characterTemplates = [
      {
        name: 'Cyber Runner',
        description: 'A fast and agile character with high evasion.',
  statModifiers: { speed: 0.4, agility: 3, luck: 2, hp: -20, defense: -2, attackSpeed: 0.54 },
        uniqueTraits: ['Quick Reflexes', 'Evasive Maneuvers'],
        shape: 'circle',
        color: '#00FFFF', // Cyan
        defaultWeapon: WeaponType.RUNNER_GUN,
        weaponTypes: [WeaponType.RUNNER_GUN, WeaponType.PISTOL, WeaponType.SHOTGUN]
      },
      {
        name: 'Tech Warrior',
        description: 'A durable character with strong defenses.',
  statModifiers: { hp: 50, defense: 4, strength: 3, speed: -0.4, agility: -1, attackSpeed: 0.475 },
        uniqueTraits: ['Reinforced Plating', 'Taunt'],
        shape: 'square',
        color: '#FF0000', // Red
        defaultWeapon: WeaponType.WARRIOR_CANNON,
        weaponTypes: [WeaponType.WARRIOR_CANNON, WeaponType.PISTOL, WeaponType.LASER]
      },
      {
        name: 'Data Sorcerer',
        description: 'A character specializing in powerful ranged attacks.',
  statModifiers: { intelligence: 5, damage: 10, hp: -10, strength: -2, defense: -1, attackSpeed: 0.525 },
        uniqueTraits: ['Arcane Blast', 'Mana Shield'],
        shape: 'triangle',
        color: '#FFFF00', // Yellow
        defaultWeapon: WeaponType.SORCERER_ORB,
        weaponTypes: [WeaponType.SORCERER_ORB, WeaponType.RICOCHET, WeaponType.HOMING]
      },
      {
        name: 'Shadow Operative',
        description: 'Stealthy and precise, excels in critical strikes.',
  statModifiers: { agility: 4, luck: 3, damage: 5, hp: -30, defense: -3, attackSpeed: 0.56 },
        uniqueTraits: ['Stealth Field', 'Critical Strike'],
        shape: 'circle',
        color: '#800080', // Purple
        defaultWeapon: WeaponType.SHADOW_DAGGER,
        weaponTypes: [WeaponType.SHADOW_DAGGER, WeaponType.PISTOL, WeaponType.RAPID]
      },
      {
        name: 'Bio-Engineer',
        description: 'Supports allies and debuffs enemies.',
  statModifiers: { intelligence: 3, hp: 20, defense: 2, damage: -2, attackSpeed: 0.49 },
        uniqueTraits: ['Healing Drone', 'Poison Cloud'],
        shape: 'square',
        color: '#00FF00', // Green
        defaultWeapon: WeaponType.BIO_TOXIN,
        weaponTypes: [WeaponType.BIO_TOXIN, WeaponType.PLASMA, WeaponType.TRI_SHOT]
      },
      {
        name: 'Rogue Hacker',
        description: 'Disrupts enemy systems and controls the battlefield.',
  statModifiers: { intelligence: 4, agility: 2, luck: 1, damage: 2, defense: -1, attackSpeed: 0.535 },
        uniqueTraits: ['System Overload', 'EMP Burst'],
        shape: 'triangle',
        color: '#FFA500', // Orange
        defaultWeapon: WeaponType.HACKER_VIRUS,
        weaponTypes: [WeaponType.HACKER_VIRUS, WeaponType.BEAM, WeaponType.HOMING]
      },
      {
        name: 'Heavy Gunner',
        description: 'Unloads a barrage of sustained fire.',
  statModifiers: { strength: 5, hp: 30, damage: 7, speed: -0.5, agility: -2, attackSpeed: 0.46 },
        uniqueTraits: ['Suppressive Fire', 'Heavy Armor'],
        shape: 'square',
        color: '#A52A2A', // Brown
        defaultWeapon: WeaponType.GUNNER_MINIGUN,
        weaponTypes: [WeaponType.GUNNER_MINIGUN, WeaponType.SHOTGUN, WeaponType.RAILGUN]
      },
      {
  id: 'psionic_weaver',
  name: 'Psionic Weaver',
        description: 'Manipulates psychic energy for devastating effects.',
  statModifiers: { intelligence: 6, damage: 12, hp: -15, strength: -3, attackSpeed: 0.52 },
        uniqueTraits: ['Mind Control', 'Psychic Nova'],
        shape: 'circle',
        color: '#FFC0CB', // Pink
        defaultWeapon: WeaponType.PSIONIC_WAVE,
        weaponTypes: [WeaponType.PSIONIC_WAVE, WeaponType.BEAM, WeaponType.PLASMA]
      },
      {
        name: 'Wasteland Scavenger',
        description: 'Resourceful and adaptable, thrives in harsh environments.',
  statModifiers: { luck: 4, defense: 3, hp: 10, speed: -0.1, attackSpeed: 0.505 },
        uniqueTraits: ['Jury-Rig', 'Scavenge'],
        shape: 'square',
        color: '#808080', // Gray
        defaultWeapon: WeaponType.SCAVENGER_SLING,
        weaponTypes: [WeaponType.SCAVENGER_SLING, WeaponType.RICOCHET, WeaponType.SHOTGUN]
      },
      {
        name: 'Neural Nomad',
        description: 'A wanderer with enhanced cognitive abilities.',
  statModifiers: { intelligence: 3, agility: 3, speed: 0.2, hp: -10, attackSpeed: 0.515 },
        uniqueTraits: ['Data Stream', 'Cognitive Boost'],
        shape: 'triangle',
        color: '#008080', // Teal
        defaultWeapon: WeaponType.NOMAD_NEURAL,
        weaponTypes: [WeaponType.NOMAD_NEURAL, WeaponType.LASER, WeaponType.BEAM]
      },
      {
        name: 'Ghost Operative',
        description: 'A master of stealth and precision, striking from the shadows.',
  statModifiers: { agility: 5, luck: 5, damage: 15, hp: -40, defense: -5, attackSpeed: 0.575 },
        uniqueTraits: ['Invisibility Cloak', 'One-Shot Kill'],
        shape: 'circle',
        color: '#FFFFFF', // White
        defaultWeapon: WeaponType.GHOST_SNIPER,
        weaponTypes: [WeaponType.GHOST_SNIPER, WeaponType.RAILGUN, WeaponType.PISTOL]
      },
      {
        name: 'Titan Mech',
        description: 'A heavily armored war machine, slow but incredibly resilient.',
  statModifiers: { hp: 70, strength: 6, defense: 6, speed: -0.8, agility: -3, attackSpeed: 0.45 },
        uniqueTraits: ['Siege Mode', 'Self-Repair'],
        shape: 'square',
        color: '#444444', // Dark gray
        defaultWeapon: WeaponType.MECH_MORTAR, // Ensure this is still Mech Mortar
        weaponTypes: [WeaponType.MECH_MORTAR, WeaponType.RAILGUN, WeaponType.SHOTGUN]
      }
    ];

    this.characters = characterTemplates.map((template): CharacterData => {
      const stats = { ...baseStats } as Stats;
      if (template.statModifiers) {
        for (const key in template.statModifiers) {
          if (Object.prototype.hasOwnProperty.call(template.statModifiers, key)) {
            const modVal = (template.statModifiers as any)[key] as number;
            const current = (stats as any)[key] ?? 0;
            (stats as any)[key] = current + modVal;
          }
        }
      }

      const characterData: CharacterData = {
  id: (template.id ?? template.name?.toLowerCase().replace(/\s+/g, '_') ?? "").replace(/-/g, "_"),
  sprite: (template.id ?? template.name?.toLowerCase().replace(/\s+/g, '_') ?? "").replace(/-/g, "_"),
  name: template.name,
  description: template.description,
  stats: stats as Stats,
  traits: template.uniqueTraits,
  shape: template.shape as Shape,
  color: template.color,
  defaultWeapon: template.defaultWeapon, // Ensure defaultWeapon is copied
  weaponTypes: template.weaponTypes // Ensure weaponTypes is copied
      };
      return characterData;
    });
  }

  draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.save();

    // Background
    ctx.fillStyle = '#1a1a2e'; // Dark background, inspired by cyberpunk theme
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Title
    ctx.fillStyle = '#00FFFF'; // Cyber-cyan
    ctx.font = 'bold 48px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#00FFFF';
    ctx.shadowBlur = 20;
    ctx.fillText('CHARACTER SELECTION', canvas.width / 2, 80);
    ctx.shadowBlur = 0; // Reset shadow

    const padding = 30; // Padding around the grid
    const totalGridWidth = this.gridCols * this.charBoxSize;
    const totalGridHeight = this.gridRows * this.charBoxSize;

    const startX = (canvas.width - totalGridWidth) / 2;
    const startY = 150; // Adjusted startY to give space for title

    // Draw character grid
    this.characters.forEach((char, index) => {
      const col = index % this.gridCols;
      const row = Math.floor(index / this.gridCols);
      const x = startX + col * this.charBoxSize;
      const y = startY + row * this.charBoxSize;

      // Box styling
      ctx.strokeStyle = '#00FFFF'; // Default border cyan
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(25, 25, 40, 0.8)'; // Darker background for character box

      const isSelected = index === this.selectedCharacterIndex;
      if (isSelected) {
        ctx.strokeStyle = '#FF0000'; // Red for selected
        ctx.lineWidth = 5; // Thicker border for selected
        ctx.shadowColor = '#FF0000';
        ctx.shadowBlur = 25; // More intense shadow for selected
      } else if (index === this.hoveredCharacterIndex) {
        ctx.strokeStyle = '#ADD8E6'; // Light Blue for hovered
        ctx.shadowColor = '#ADD8E6';
        ctx.shadowBlur = 6; // Simple light shadow for hover
      } else {
        // default
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 0;
        ctx.shadowColor = '' as any;
      }

      ctx.strokeRect(x, y, this.charBoxSize, this.charBoxSize);
      // Extra outer border to guarantee a full 4-sided highlight on selection
      if (isSelected) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#FF0000';
        ctx.strokeRect(x - 4, y - 4, this.charBoxSize + 8, this.charBoxSize + 8);
        ctx.restore();
      }

      // Neon gradient background for character card
      const g = ctx.createLinearGradient(x + 3, y + 3, x + this.charBoxSize - 6, y + this.charBoxSize - 6);
      g.addColorStop(0, 'rgba(0,255,255,0.35)');
      g.addColorStop(1, 'rgba(0,0,255,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 3, y + 3, this.charBoxSize - 6, this.charBoxSize - 6);
      ctx.shadowBlur = 0; // Reset shadow

      // Draw custom shape
      ctx.fillStyle = char.color ?? '#888';
      ctx.strokeStyle = char.color ?? '#00FFFF';
      ctx.lineWidth = 2;
      // Optional: highlight on hover by drawing a faint glow around the shape
      if (this.hoveredCharacterIndex === index) {
        ctx.shadowColor = '#FFFFFF';
        ctx.shadowBlur = 6;
      } else {
        ctx.shadowBlur = 0;
      }

      const shapeSize = this.charBoxSize * 0.3;
      const centerX = x + this.charBoxSize / 2;
      const centerY = y + this.charBoxSize / 2 - 10; // Adjusted Y position for shape

      ctx.beginPath();
      switch (char.shape) {
        case 'circle':
          ctx.arc(centerX, centerY, shapeSize, 0, Math.PI * 2);
          break;
        case 'square':
          ctx.rect(centerX - shapeSize, centerY - shapeSize, shapeSize * 2, shapeSize * 2);
          break;
        case 'triangle':
          ctx.moveTo(centerX, centerY - shapeSize);
          ctx.lineTo(centerX + shapeSize, centerY + shapeSize);
          ctx.lineTo(centerX - shapeSize, centerY + shapeSize);
          ctx.closePath();
          break;
      }
      ctx.fill();
      ctx.stroke();

      // Draw character name
      ctx.fillStyle = '#FFFFFF'; // White for name
      ctx.font = '16px Orbitron, sans-serif'; // Slightly smaller font for name
      ctx.textAlign = 'center';

      let displayName = char.name;
      const maxNameWidth = this.charBoxSize * 0.9; // 90% of box width
      const textMetrics = ctx.measureText(displayName);

      if (textMetrics.width > maxNameWidth) {
        let tempName = displayName;
        while (ctx.measureText(tempName + '...').width > maxNameWidth && tempName.length > 0) {
          tempName = tempName.substring(0, tempName.length - 1);
        }
        displayName = tempName + '...';
      }
      ctx.fillText(displayName, x + this.charBoxSize / 2, y + this.charBoxSize - 25); // Adjusted Y position
    });

    // --- Static Weapon Info Box (right of main grid) ---
    const staticBoxX = startX + totalGridWidth + 40;
    const staticBoxY = startY;
    const staticBoxW = 340;
    const staticBoxH = 320;
    ctx.save();
    ctx.globalAlpha = 0.98;
    ctx.fillStyle = 'rgba(10,40,60,0.97)';
    ctx.strokeStyle = '#00FFFF';
    ctx.lineWidth = 3;
    ctx.fillRect(staticBoxX, staticBoxY, staticBoxW, staticBoxH);
    ctx.strokeRect(staticBoxX, staticBoxY, staticBoxW, staticBoxH);
    ctx.restore();

    // Weapon info for hovered or selected character
    let weaponCharIndex = this.selectedCharacterIndex;
    if (this.hoveredCharacterIndex !== null && this.hoveredCharacterIndex >= 0) {
      weaponCharIndex = this.hoveredCharacterIndex;
    }
    const weaponChar = this.characters[weaponCharIndex];
    const weaponType = weaponChar.defaultWeapon;
    const weaponSpec = weaponType !== undefined ? WEAPON_SPECS[weaponType] : undefined;
    ctx.save();
    ctx.fillStyle = '#00FFFF';
    ctx.font = 'bold 28px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Weapon Info', staticBoxX + staticBoxW / 2, staticBoxY + 44);
    if (weaponSpec) {
      // Modern neon panel style
      ctx.font = 'bold 22px Orbitron, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(weaponSpec.name, staticBoxX + 24, staticBoxY + 84);
      if (weaponSpec.icon) {
        const img = this.assetLoader.getImage(weaponSpec.icon);
        if (img) ctx.drawImage(img, staticBoxX + 24, staticBoxY + 54, 64, 64);
      }
      ctx.font = '18px Orbitron, sans-serif';
      ctx.fillStyle = '#CCCCFF';
      let statY = staticBoxY + 134;
      // Only show most important stats, grouped and padded
      const statPad = 24;
      ctx.fillText(`Type: ${weaponSpec.projectileVisual.type}`, staticBoxX + statPad, statY); statY += 26;
      ctx.fillText(`Damage: ${weaponSpec.salvo}x`, staticBoxX + statPad, statY); statY += 26;
      ctx.fillText(`Cooldown: ${weaponSpec.cooldown}`, staticBoxX + statPad, statY); statY += 26;
      ctx.fillText(`Speed: ${weaponSpec.speed}`, staticBoxX + statPad, statY); statY += 26;
      ctx.fillText(`Range: ${weaponSpec.range}`, staticBoxX + statPad, statY); statY += 26;
      // Traits with word wrapping
      if (weaponSpec.traits && weaponSpec.traits.length > 0) {
        ctx.font = '18px Orbitron, sans-serif';
        ctx.fillStyle = '#66FF88';
        let traitsText = `Traits: ${weaponSpec.traits.join(', ')}`;
        let traitsLines = [];
        while (traitsText.length > 0) {
          let i = traitsText.length;
          while (ctx.measureText(traitsText.substring(0, i)).width > staticBoxW - 2 * statPad && i > 0) i--;
          traitsLines.push(traitsText.substring(0, i));
          traitsText = traitsText.substring(i).trim();
        }
        for (const line of traitsLines) {
          ctx.fillText(line, staticBoxX + statPad, statY);
          statY += 22;
        }
      }
      // Quick lore info with word wrapping
      ctx.font = 'italic 16px Orbitron, sans-serif';
      ctx.fillStyle = '#FFD700';
      let lore = '';
      switch (weaponSpec.id) {
        case WeaponType.PISTOL:
          lore = 'Standard issue sidearm. Reliable, but not flashy.';
          break;
        case WeaponType.SHOTGUN:
          lore = 'Close-range devastation. Favored by enforcers.';
          break;
        case WeaponType.TRI_SHOT:
          lore = 'Triple-barrel tech for maximum spread.';
          break;
        case WeaponType.RAPID:
          lore = 'High rate of fire, low stopping power.';
          break;
        case WeaponType.LASER:
          lore = 'Energy beam, precise and deadly.';
          break;
        case WeaponType.BEAM:
          lore = 'Heavy plasma beam, melts through armor.';
          break;
        case WeaponType.RICOCHET:
          lore = 'Bounces off surfaces, unpredictable.';
          break;
        case WeaponType.HOMING:
          lore = 'Autonomous drone seeks out targets.';
          break;
        case WeaponType.RAILGUN:
          lore = 'Accelerates projectiles to hypersonic speeds.';
          break;
        case WeaponType.PLASMA:
          lore = 'Superheated plasma, burns on contact.';
          break;
        case WeaponType.RUNNER_GUN:
          lore = 'Lightweight, designed for speed.';
          break;
        case WeaponType.WARRIOR_CANNON:
          lore = 'Heavy cannon, built for brute force.';
          break;
        case WeaponType.SORCERER_ORB:
          lore = 'Arcane energy, unpredictable flight.';
          break;
        case WeaponType.SHADOW_DAGGER:
          lore = 'Silent, deadly, and precise.';
          break;
        case WeaponType.BIO_TOXIN:
          lore = 'Releases toxic clouds, weakens foes.';
          break;
        case WeaponType.HACKER_VIRUS:
          lore = 'Disrupts enemy systems, EMP payload.';
          break;
        case WeaponType.GUNNER_MINIGUN:
          lore = 'Suppressive fire, relentless barrage.';
          break;
        case WeaponType.PSIONIC_WAVE:
          lore = 'Psychic energy, pierces defenses.';
          break;
        case WeaponType.SCAVENGER_SLING:
          lore = 'Improvised weapon, unpredictable.';
          break;
        case WeaponType.NOMAD_NEURAL:
          lore = 'Neural pulse, stuns and disrupts.';
          break;
        case WeaponType.GHOST_SNIPER:
          lore = 'One shot, one kill. Stealthy.';
          break;
        case WeaponType.MECH_MORTAR:
          lore = 'Siege weapon, massive explosions.';
          break;
        default:
          lore = 'A weapon of unknown origin.';
      }
      ctx.fillText(lore, staticBoxX + 20, statY + 18);
    } else {
      ctx.font = 'bold 22px Orbitron, sans-serif';
      ctx.fillText('No Weapon', staticBoxX + staticBoxW / 2, staticBoxY + 84);
    }
    ctx.restore();

    // Draw selected character details
    const previewIndex = this.hoveredCharacterIndex ?? this.selectedCharacterIndex;
    const selectedChar = this.characters[previewIndex] as CharacterData;
    const detailX = canvas.width / 2;
    const detailY = startY + totalGridHeight + padding * 2; // Position below grid with padding

    // Bottom info panel backdrop and structured content
    const bottomPanelX = 40;
    const bottomPanelY = canvas.height - 320;
    const bottomPanelW = canvas.width - 80;
    const bottomPanelH = 300;
    ctx.fillStyle = 'rgba(10,12,40,0.95)';
    ctx.fillRect(bottomPanelX, bottomPanelY, bottomPanelW, bottomPanelH);
    ctx.strokeStyle = '#00FFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(bottomPanelX, bottomPanelY, bottomPanelW, bottomPanelH);

    // Structured layout inside panel
    const pad = 24;
    const colGap = 36;
    const leftColX = bottomPanelX + pad;
    const rightColX = bottomPanelX + bottomPanelW / 2 + pad;
    const nameY = bottomPanelY + 40;
    // Name
    ctx.fillStyle = '#00FFFF';
    ctx.font = 'bold 32px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(selectedChar.name, bottomPanelX + bottomPanelW / 2, nameY);

    // Description (wrapped) under name
    ctx.fillStyle = '#CCCCFF';
    ctx.font = '18px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    const descX = leftColX;
    const descY = nameY + 28;
    const descMaxW = bottomPanelW - pad * 2;
    const descLines = this.wrapText(ctx, selectedChar.description, Math.floor(descMaxW / 10));
    for (let i = 0; i < descLines.length; i++) {
      ctx.fillText(descLines[i], descX, descY + i * 22);
    }

    // Stats table (left column) and Traits (right column)
    ctx.fillStyle = '#FFFF66';
    ctx.font = '18px Orbitron, sans-serif';
    const stats = selectedChar.stats as any;
    const statsList = [
      ['HP', stats.hp ?? 0],
      ['Speed', stats.speed ?? 0],
      ['Damage', stats.damage ?? 0],
      ['Strength', stats.strength ?? 0],
      ['Intelligence', stats.intelligence ?? 0]
    ];
    const statsRight = [
      ['Defense', stats.defense ?? 0],
      ['Agility', stats.agility ?? 0],
      ['Luck', stats.luck ?? 0],
      ['Attack Speed', stats.attackSpeed ?? 1],
      ['Magnet Radius', stats.magnetRadius ?? 0]
    ];
    const statsStartY = descY + descLines.length * 22 + 12;
    const statLineH = 24;
    for (let i = 0; i < statsList.length; i++) {
      ctx.fillText(`${statsList[i][0]}: ${statsList[i][1]}`, leftColX, statsStartY + i * statLineH);
      ctx.fillText(`${statsRight[i][0]}: ${statsRight[i][1]}`, rightColX, statsStartY + i * statLineH);
    }

    // Traits in right column below stats
    ctx.fillStyle = '#66FF88';
    ctx.font = '18px Orbitron, sans-serif';
    const traitsStartY = statsStartY + statsList.length * statLineH + 8;
    ctx.fillText('Unique Traits:', rightColX, traitsStartY);
    let tY = traitsStartY + statLineH;
    (selectedChar.traits ?? []).forEach((trait: string) => {
      ctx.fillText(`- ${trait}`, rightColX, tY);
      tY += statLineH;
    });

    // Back button inside panel
    this.backButton.x = bottomPanelX + 12;
    this.backButton.y = bottomPanelY + bottomPanelH - this.backButton.height - 12;
    ctx.strokeStyle = this.backButton.isHovered ? '#FF00FF' : '#00FFFF';
    ctx.lineWidth = 2;
    ctx.fillStyle = this.backButton.isHovered ? 'rgba(255,0,255,0.12)' : 'rgba(0,255,255,0.06)';
    if (this.backButton.isHovered) { ctx.shadowColor = '#FF00FF'; ctx.shadowBlur = 12; }
    ctx.strokeRect(this.backButton.x, this.backButton.y, this.backButton.width, this.backButton.height);
    ctx.fillRect(this.backButton.x, this.backButton.y, this.backButton.width, this.backButton.height);
    ctx.shadowBlur = 0;
    ctx.fillStyle = this.backButton.isHovered ? '#FF00FF' : '#00FFFF';
    ctx.font = 'bold 18px Orbitron, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('BACK TO MAIN MENU', this.backButton.x + this.backButton.width / 2, this.backButton.y + this.backButton.height / 2 + 6);

    ctx.restore();
  }

  handleInput(e: KeyboardEvent) {
    let newIndex = this.selectedCharacterIndex;
    if (e.key === 'ArrowLeft') {
      newIndex--;
    }
    else if (e.key === 'ArrowRight') {
      newIndex++;
    }
    else if (e.key === 'ArrowUp') {
      newIndex -= this.gridCols;
    }
    else if (e.key === 'ArrowDown') {
      newIndex += this.gridCols;
    }

    // Wrap around logic for grid navigation
    if (newIndex < 0) {
      newIndex = this.characters.length + newIndex;
    }
    else if (newIndex >= this.characters.length) {
      newIndex = newIndex - this.characters.length;
    }
    this.selectedCharacterIndex = newIndex;
  }

  handleMouseMove(mouseX: number, mouseY: number, canvas: HTMLCanvasElement) {
    const startX = (canvas.width - (this.gridCols * this.charBoxSize)) / 2;
    const startY = 150; // Adjusted startY

    let newHoveredIndex: number | null = null;
    this.characters.forEach((char, index) => {
      const col = index % this.gridCols;
      const row = Math.floor(index / this.gridCols);
      const x = startX + col * this.charBoxSize;
      const y = startY + row * this.charBoxSize;

      if (mouseX >= x && mouseX <= x + this.charBoxSize &&
          mouseY >= y && mouseY <= y + this.charBoxSize) {
        newHoveredIndex = index;
      }
    });
    this.hoveredCharacterIndex = newHoveredIndex;

    // Check for hover on Back to Main Menu button
    const backButtonX = 20;
    const backButtonY = canvas.height - 60; // Must match draw method's Y position

    if (mouseX >= backButtonX && mouseX <= backButtonX + this.backButton.width &&
        mouseY >= backButtonY && mouseY <= backButtonY + this.backButton.height) {
      this.backButton.isHovered = true;
    } else {
      this.backButton.isHovered = false;
    }
  }

  handleClick(mouseX: number, mouseY: number, canvas: HTMLCanvasElement): Character | 'backToMainMenu' | null {
    const startX = (canvas.width - (this.gridCols * this.charBoxSize)) / 2;
    const startY = 150; // Adjusted startY

    // Check for character box clicks
    for (let i = 0; i < this.characters.length; i++) {
      const col = i % this.gridCols;
      const row = Math.floor(i / this.gridCols);
      const x = startX + col * this.charBoxSize;
      const y = startY + row * this.charBoxSize;

      if (mouseX >= x && mouseX <= x + this.charBoxSize &&
          mouseY >= y && mouseY <= y + this.charBoxSize) {
        this.selectedCharacterIndex = i;
        return this.characters[i]; // Return the selected character data
      }
    }

    // Check for "Back to Main Menu" button click
    // Use the stored backButton properties for click detection
    if (mouseX >= this.backButton.x && mouseX <= this.backButton.x + this.backButton.width &&
        mouseY >= this.backButton.y && mouseY <= this.backButton.y + this.backButton.height) {
      return 'backToMainMenu';
    }

    return null;
  }

  getSelectedCharacter() {
    return this.characters[this.selectedCharacterIndex];
  }

  update() {
    // Advance animation frame for character select display
    this.frameTimer++;
    if (this.frameTimer >= (60 / this.animationSpeed)) { // Assuming 60 FPS
      this.currentFrame++;
      this.frameTimer = 0;
    }
  }

  /**
   * Draws the animated matrix background effect on the character select canvas.
   * Slower, smoother, and glitchy: slow drops, random glitch columns, color flicker.
   * @param ctx Canvas 2D context
   * @param canvas Canvas element
   */
  private drawMatrixBackground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // Matrix effect parameters
    const fontSize = 32;
    const columns = Math.floor(canvas.width / fontSize);

    // Preallocate drops array only once per resize
    if (!this.matrixDrops || this.matrixDrops.length !== columns) {
      this.matrixDrops = new Array(columns);
      for (let i = 0; i < columns; i++) this.matrixDrops[i] = 1;
    }

    // Force solid black background first
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Semi-transparent trail for smoothness
    ctx.fillStyle = 'rgba(0,32,48,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = `${fontSize}px monospace`;

    // Use a preallocated array for chars
    if (!this._matrixChars || this._matrixChars.length !== columns) {
      this._matrixChars = new Array(columns);
    }

    for (let i = 0; i < columns; i++) {
      // Glitch effect: random columns flicker and change color/char rapidly
      let isGlitch = Math.random() < 0.08;
      if (isGlitch) {
        ctx.fillStyle = Math.random() < 0.5 ? '#00eaff' : '#fff'; // cyan or white flicker
        this._matrixChars[i] = String.fromCharCode(0x30A0 + (Math.random() * 96) | 0);
      } else {
        ctx.fillStyle = '#00eaff';
        if (!this._matrixChars[i] || this.matrixDrops[i] % 18 === 0) {
          this._matrixChars[i] = String.fromCharCode(0x30A0 + (Math.random() * 96) | 0);
        }
      }
      ctx.fillText(this._matrixChars[i], i * fontSize, this.matrixDrops[i] * fontSize);

      // Slow down drop speed for smoothness
      if (this.matrixDrops[i] * fontSize > canvas.height && Math.random() > 0.99) {
        this.matrixDrops[i] = 0;
      }
      // Move drops much slower
      this.matrixDrops[i] += isGlitch ? 1.5 : 0.25;
    }

    // Request next frame
    requestAnimationFrame(() => this.drawMatrixBackground(ctx, canvas));
  }
  private wrapText(ctx: CanvasRenderingContext2D, text: string, maxCharLength: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if ((currentLine + word).length <= maxCharLength) {
        currentLine += (currentLine === '' ? '' : ' ') + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine); // Add the last line
    return lines;
  }

  private handleResize = () => {
    if (this.characterSelectCanvas) {
      this.characterSelectCanvas.width = window.innerWidth;
      this.characterSelectCanvas.height = window.innerHeight;
    }
  };
}



