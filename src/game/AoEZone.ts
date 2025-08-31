import type { Enemy } from './EnemyManager';
import { EnemyManager } from './EnemyManager';
import type { Player } from './Player'; // Import Player type

export class AoEZone {
  x: number;
  y: number;
  radius: number;
  damage: number;
  life: number; // Current life in ms
  maxLife: number; // Total life in ms
  active: boolean;
  color: string;
  private enemyManager: EnemyManager;
  private player: Player; // Add player reference

  constructor(x: number, y: number, radius: number, damage: number, lifeMs: number, color: string, enemyManager: EnemyManager, player: Player) {
    this.x = x;
    this.y = y;
    this.radius = radius;
    this.damage = damage;
  this.life = lifeMs;
  this.maxLife = lifeMs;
    this.active = true;
    this.color = color;
    this.enemyManager = enemyManager;
    this.player = player; // Store player reference
    this._applyDamage(); // Apply damage immediately on creation
  }

  update(deltaMs: number = 16.6667): void {
    if (!this.active) return;
    this.life -= deltaMs;
    if (this.life <= 0) {
      this.active = false;
      return;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.active) return;

  // If color is fully transparent, skip rendering (still applies damage ticks already applied on creation)
  if (this.color === 'rgba(0,0,0,0)') return;
  ctx.save();
  const alpha = Math.max(0, this.life / this.maxLife); // Fade out based on remaining life (ms)
  ctx.globalAlpha = alpha * 0.35; // Lower opacity for subtle effect
  ctx.beginPath();
  ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
  ctx.fillStyle = this.color;
  ctx.shadowColor = this.color;
  ctx.shadowBlur = 8; // Softer glow
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
    // Also apply to boss if within radius
    try {
      const bm: any = (window as any).__bossManager;
      const boss = bm && bm.getActiveBoss ? bm.getActiveBoss() : (bm && bm.getBoss ? bm.getBoss() : null);
      if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE') {
        const dxB = (boss.x ?? 0) - this.x; const dyB = (boss.y ?? 0) - this.y;
        const rB = (boss.radius || 160);
        if (dxB*dxB + dyB*dyB <= (this.radius + rB) * (this.radius + rB)) {
          (this.enemyManager as any).takeBossDamage?.(boss, this.damage, false, undefined, this.x, this.y);
        }
      }
    } catch { /* ignore boss AoE errors */ }
    // Also apply to treasures within radius
    try {
      const emAny: any = this.enemyManager as any;
      if (emAny && typeof emAny.getTreasures === 'function') {
        const treasures = emAny.getTreasures() as Array<{ x:number; y:number; radius:number; active:boolean; hp:number }>;
        const r2 = this.radius * this.radius;
        for (let i = 0; i < treasures.length; i++) {
          const t = treasures[i]; if (!t || !t.active || (t as any).hp <= 0) continue;
          const dx = t.x - this.x; const dy = t.y - this.y;
          if (dx*dx + dy*dy <= r2 && typeof emAny.damageTreasure === 'function') {
            emAny.damageTreasure(t, this.damage);
          }
        }
      }
    } catch { /* ignore treasure AoE errors */ }
   }
 }
