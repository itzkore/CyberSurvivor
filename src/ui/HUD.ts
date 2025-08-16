import { Player } from '../game/Player';
import { AssetLoader } from '../game/AssetLoader';
import { Enemy } from '../game/EnemyManager'; // Import Enemy type

export class HUD {
  private player: Player;
  private loader: AssetLoader | null = null;
  public currentDPS: number = 0; // New property for DPS
  public showMinimap: boolean = false; // New property for minimap toggle

  constructor(player: Player, loader?: AssetLoader) {
    this.player = player;
    this.loader = loader || null;
  }

  public draw(ctx: CanvasRenderingContext2D, gameTime: number, enemies: Enemy[], worldW: number, worldH: number, upgrades: string[]) { // Added upgrades parameter
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    ctx.save();
    ctx.font = '18px Orbitron, sans-serif';
    ctx.fillStyle = '#fff';

    // Timer
    const minutes = Math.floor(gameTime / 60).toString().padStart(2, '0');
    const seconds = Math.floor(gameTime % 60).toString().padStart(2, '0');
    ctx.font = 'bold 32px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, width / 2, 50);

    // Level and Stats
    ctx.textAlign = 'left';
    ctx.font = 'bold 20px Orbitron, sans-serif';
    ctx.fillText(`Level: ${this.player.level}`, 20, 40);
    ctx.fillText(`Strength: ${this.player.strength}`, 20, 65);
    // --- Optimized Stat Display ---
    ctx.save();
    ctx.font = 'bold 20px Orbitron, sans-serif';
    ctx.fillStyle = '#0ff';
    ctx.textAlign = 'left';
    ctx.fillText('STATS', 20, 80);
    ctx.font = '18px Orbitron, sans-serif';
    ctx.fillStyle = '#fff';
    const statStartY = 110;
    const statPad = 32;
    const stats = [
      [`HP`, `${this.player.hp} / ${this.player.maxHp}`],
      [`Speed`, `${this.player.speed.toFixed(2)}`],
      [`Damage`, `${this.player.bulletDamage ?? 0}`],
      [`Strength`, `${this.player.strength ?? 0}`],
      [`Defense`, `${this.player.defense ?? 0}`],
      [`Attack Speed`, `${(this.player.attackSpeed ?? 1).toFixed(2)}`],
      [`Magnet`, `${this.player.magnetRadius ?? 0}`],
      [`Regen`, `${this.player.regen ?? 0}`],
      [`Luck`, `${this.player.luck ?? 0}`],
      [`Intelligence`, `${this.player.intelligence ?? 0}`],
      [`Agility`, `${this.player.agility ?? 0}`],
      [`DPS`, `${this.currentDPS.toFixed(2)}`], // Display DPS
    ];
    for (let i = 0; i < stats.length; i++) {
      ctx.fillText(`${stats[i][0]}: ${stats[i][1]}`, 20, statStartY + i * 24);
    }
    ctx.restore();

    // HP Bar
    const hpBarY = height - 60;
    const hpBarWidth = 320; // Fixed width for HP bar
    this.drawBar(ctx, 20, hpBarY, hpBarWidth, 20, Math.max(0, Math.min(1, this.player.hp / this.player.maxHp)), '#ff0000', '#550000');
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Orbitron, sans-serif';
    ctx.fillText(`HP: ${this.player.hp} / ${this.player.maxHp}`, 30, hpBarY + 15);

    // XP Bar
    const xpBarY = height - 30;
    const nextExp = this.player.getNextExp();
    this.drawBar(ctx, 20, xpBarY, width - 40, 15, this.player.exp / nextExp, '#00ffff', '#005555');
    ctx.fillStyle = '#fff';
    ctx.fillText(`XP: ${this.player.exp} / ${nextExp}`, 30, xpBarY + 12);

    // Minimap
    if (this.showMinimap) {
      this.drawMinimap(ctx, this.player.x, this.player.y, enemies, worldW, worldH);
    }

    // Upgrade History Panel
    this.drawUpgradeHistory(ctx, upgrades);

    ctx.restore();
  }

  private drawBar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, progress: number, fg: string, bg: string) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, width * progress, height);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x, y, width, height);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, playerX: number, playerY: number, enemies: Enemy[], worldW: number, worldH: number): void {
    const minimapSize = 150; // Size of the square minimap
    const minimapX = ctx.canvas.width - minimapSize - 20; // Top right corner
    const minimapY = 20;

    ctx.save();
    ctx.globalAlpha = 0.7; // Semi-transparent background
    ctx.fillStyle = '#000';
    ctx.fillRect(minimapX, minimapY, minimapSize, minimapSize);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(minimapX, minimapY, minimapSize, minimapSize);

    // Calculate scaling factor for minimap
    const scaleX = minimapSize / worldW;
    const scaleY = minimapSize / worldH;

    // Draw player on minimap
    ctx.fillStyle = '#00FFFF'; // Player color
    ctx.beginPath();
    ctx.arc(minimapX + playerX * scaleX, minimapY + playerY * scaleY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Draw enemies on minimap
    ctx.fillStyle = '#FF0000'; // Enemy color
    for (const enemy of enemies) {
      if (enemy.active) {
        ctx.beginPath();
        ctx.arc(minimapX + enemy.x * scaleX, minimapY + enemy.y * scaleY, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawUpgradeHistory(ctx: CanvasRenderingContext2D, upgrades: string[]): void {
    const panelWidth = 240;
    const panelHeight = 300;
    const panelX = 20; // Left side, below stats
    const panelY = 400; // Adjust Y position as needed to not overlap with stats

    ctx.save();
    ctx.globalAlpha = 0.7; // Semi-transparent background
    ctx.fillStyle = '#111';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    ctx.strokeStyle = '#0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

    ctx.fillStyle = '#0ff';
    ctx.font = 'bold 18px Orbitron, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Upgrade History', panelX + 10, panelY + 25);

    ctx.font = '14px Orbitron, sans-serif';
    ctx.fillStyle = '#fff';
    const textStartX = panelX + 10;
    let textStartY = panelY + 50;
    const lineHeight = 18;

    // Display only the highest level for each weapon upgrade
    const upgradeMap: Record<string, string> = {};
    for (const upgrade of upgrades) {
      let upgradeText = upgrade;
      if (upgradeText.startsWith('Weapon Upgrade:')) {
        upgradeText = upgradeText.replace('Weapon Upgrade:', 'Wep:');
      }
      if (upgradeText.startsWith('Passive Unlock:')) {
        upgradeText = upgradeText.replace('Passive Unlock:', 'Pas:');
      }
      // Extract base name and level
      const match = upgradeText.match(/Wep: (.+) Lv\.(\d+)/);
      if (match) {
        const base = match[1].trim();
        const level = parseInt(match[2], 10);
        if (!upgradeMap[base] || parseInt(upgradeMap[base].match(/Lv\.(\d+)/)?.[1] || '0', 10) < level) {
          upgradeMap[base] = upgradeText;
        }
      } else {
        // For upgrades without level, just keep the latest
        upgradeMap[upgradeText] = upgradeText;
      }
    }
    const displayUpgrades = Object.values(upgradeMap);
    for (let i = 0; i < displayUpgrades.length; i++) {
      ctx.fillText(displayUpgrades[i], textStartX, textStartY + i * lineHeight);
    }

    ctx.restore();
  }

  public drawAliveEnemiesCount(ctx: CanvasRenderingContext2D, count: number): void {
    if (!ctx) return;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    const x = Math.max(10, ctx.canvas.width - 140);
    const y = 20;
    ctx.fillText(`Enemies: ${count}`, x, y);
    ctx.restore();
  }
}
