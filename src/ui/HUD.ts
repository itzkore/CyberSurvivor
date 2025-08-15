import { Player } from '../game/Player';
import { AssetLoader } from '../game/AssetLoader';

export class HUD {
  private player: Player;
  private loader: AssetLoader | null = null;

  constructor(player: Player, loader?: AssetLoader) {
    this.player = player;
    this.loader = loader || null;
  }

  public draw(ctx: CanvasRenderingContext2D, gameTime: number) {
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
      [`Agility`, `${this.player.agility ?? 0}`]
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
