import type { Enemy } from './EnemyManager';
import { EnemyManager } from './EnemyManager';
import type { Player } from './Player'; // Import Player type

export class AoEZone {
  x: number;
  y: number;
  radius: number;
  damage: number;
  life: number; // Current life in frames
  maxLife: number; // Total life in frames (e.g., 60 frames for 1 second)
  active: boolean;
  color: string;
  private enemyManager: EnemyManager;
  private player: Player; // Add player reference

  constructor(x: number, y: number, radius: number, damage: number, life: number, color: string, enemyManager: EnemyManager, player: Player) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.damage = damage;
    this.life = life;
    this.maxLife = life;
    this.active = true;
    this.color = color;
    this.enemyManager = enemyManager;
    this.player = player; // Store player reference
    this._applyDamage(); // Apply damage immediately on creation
  }

  update(): void {
    if (!this.active) return;

    this.life--;
    if (this.life <= 0) {
      this.active = false;
      return;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.active) return;

    ctx.save();
    const alpha = Math.max(0, this.life / this.maxLife); // Fade out based on remaining life
    ctx.globalAlpha = alpha * 0.6; // Max 60% opacity for the zone
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 20; // Stronger glow for the zone
    ctx.fill();
    ctx.restore();
  }

  private _applyDamage(): void {
    if (this.enemyManager && this.enemyManager.enemies) { // Access enemies array directly
       for (const enemy of this.enemyManager.enemies) { // Iterate over all enemies, let takeDamage handle active/hp check
         const dx = enemy.x - this.x;
         const dy = enemy.y - this.y;
         const dist = Math.hypot(dx, dy);

         if (dist <= this.radius) {
           if (enemy.id === (this.player as any).id) continue; // Skip player by ID (cast to any to resolve type error)
           this.enemyManager.takeDamage(enemy, this.damage, false, true); // Apply damage, ignoring active check
         }
       }
     }
   }
 }
