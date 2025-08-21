import { ParticleManager } from './ParticleManager';
import { EnemyManager } from './EnemyManager';
import { AoEZone } from './AoEZone';
import { Player } from './Player'; // Import Player type

export class ExplosionManager {
  private particleManager: ParticleManager;
  private enemyManager: EnemyManager;
  private onShake?: (duration: number, intensity: number) => void;
  private player: Player; // Add player reference
  private aoeZones: AoEZone[] = []; // Manage active AoE zones
  // Lightweight shockwave rings (purely visual)
  private shockwaves: { x: number; y: number; startR: number; endR: number; life: number; maxLife: number; color: string }[] = [];

  constructor(particleManager: ParticleManager, enemyManager: EnemyManager, player: Player, onShake?: (duration: number, intensity: number) => void) {
    this.particleManager = particleManager;
    this.enemyManager = enemyManager;
    this.onShake = onShake;
    this.player = player; // Store player reference
  }

  public triggerExplosion(x: number, y: number, damage: number, hitEnemy?: any, radius: number = 100, color: string = '#FFA07A') {
    // SUBTLE VARIANT: smaller / lighter / less damage to reduce perf cost & visual noise
    const scaledRadius = Math.max(30, radius * 0.45); // shrink radius ~55%
    const scaledDamage = damage * 0.5; // half damage
    const zoneLifeMs = 520; // shorter lifetime
    this.aoeZones.push(new AoEZone(x, y, scaledRadius, scaledDamage, zoneLifeMs, color, this.enemyManager, this.player));
    // Single minimal shockwave ring (lighter)
    this.shockwaves.push({
      x,
      y,
      startR: Math.max(4, scaledRadius * 0.5),
      endR: scaledRadius * 1.2,
      life: 180,
      maxLife: 180,
      color
    });
    // Apply reduced damage to enemies inside new smaller radius
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      for (let i=0;i<enemies.length;i++) {
        const enemy = enemies[i];
        const dx = enemy.x - x; const dy = enemy.y - y;
        if (dx*dx + dy*dy <= scaledRadius*scaledRadius) this.enemyManager.takeDamage(enemy, scaledDamage);
      }
    }
    // Removed screen shake for subtle effect
  }

  /**
   * Shockwave-only instant explosion (no lingering filled AoE zone). Applies damage immediately and spawns wave rings.
   */
  public triggerShockwave(x: number, y: number, damage: number, radius: number = 100, color: string = '#FFA07A') {
    // Immediate damage application (single tick)
    if (this.enemyManager && this.enemyManager.getEnemies) {
      const enemies = this.enemyManager.getEnemies();
      for (let i=0;i<enemies.length;i++) {
        const e = enemies[i];
        const dx = e.x - x; const dy = e.y - y;
        if (dx*dx + dy*dy <= radius*radius) this.enemyManager.takeDamage(e, damage);
      }
    }
    // Shockwave visuals (reuse logic path by manually pushing similar rings)
  this.shockwaves.push({ x, y, startR: Math.max(6, radius*0.25), endR: radius*1.1, life: 200, maxLife: 200, color });
  // Removed second ring and screen shake
  }

  public update(deltaMs: number = 16.6667): void {
    // Update all active AoE zones
    for (let i = 0; i < this.aoeZones.length; i++) {
      const zone = this.aoeZones[i];
      if (zone.active) {
  zone.update(deltaMs);
      }
    }
    // Filter out inactive zones
    this.aoeZones = this.aoeZones.filter(zone => zone.active);

    // Update shockwaves
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      sw.life -= deltaMs;
    }
    this.shockwaves = this.shockwaves.filter(sw => sw.life > 0);
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    // Draw all active AoE zones
    for (let i = 0; i < this.aoeZones.length; i++) {
      const zone = this.aoeZones[i];
      if (zone.active) {
        zone.draw(ctx);
      }
    }

    // Draw shockwaves after zones (so rings appear atop)
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      const t = 1 - sw.life / sw.maxLife; // 0..1 progress
      const radius = sw.startR + (sw.endR - sw.startR) * t;
  const alpha = (1 - t) * 0.35; // lower max opacity for subtle visuals
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, 3 * (1 - t));
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
      // Radial gradient stroke effect (simulate inner bright edge)
      const grad = ctx.createRadialGradient(sw.x, sw.y, radius * 0.65, sw.x, sw.y, radius);
      grad.addColorStop(0, `${sw.color}80`); // semi
      grad.addColorStop(0.75, `${sw.color}30`);
      grad.addColorStop(1, `${sw.color}00`);
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.8})`;
      ctx.shadowColor = sw.color;
  ctx.shadowBlur = 10 * (1 - t * 0.7);
      ctx.globalAlpha = alpha;
      ctx.stroke();
      // Soft fill halo
      ctx.fillStyle = grad;
  ctx.globalAlpha = alpha * 0.4;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
