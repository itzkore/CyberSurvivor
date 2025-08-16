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

  constructor(particleManager: ParticleManager, enemyManager: EnemyManager, player: Player, onShake?: (duration: number, intensity: number) => void) {
    this.particleManager = particleManager;
    this.enemyManager = enemyManager;
    this.onShake = onShake;
    this.player = player; // Store player reference
  }

  public triggerExplosion(x: number, y: number, damage: number, hitEnemy?: any, radius: number = 100, color: string = '#FFA07A') {
    // Create and add a new AoEZone instead of spawning particles directly
    const zoneLife = 60; // 1 second at 60 FPS
    this.aoeZones.push(new AoEZone(x, y, radius, damage, zoneLife, color, this.enemyManager, this.player)); // Pass player to AoEZone

    if (hitEnemy && typeof hitEnemy.takeDamage === 'function') {
      hitEnemy.takeDamage(damage);
    }
    if (this.enemyManager && typeof this.enemyManager.getEnemies === 'function') {
      for (const enemy of this.enemyManager.getEnemies()) {
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius) {
          // Apply damage via EnemyManager's centralized takeDamage method
          this.enemyManager.takeDamage(enemy, damage * 1.0);
        }
      }
    }
    if (this.onShake) this.onShake(150, 5);
  }

  public update(): void {
    // Update all active AoE zones
    for (let i = 0; i < this.aoeZones.length; i++) {
      const zone = this.aoeZones[i];
      if (zone.active) {
        zone.update();
      }
    }
    // Filter out inactive zones
    this.aoeZones = this.aoeZones.filter(zone => zone.active);
  }

  public draw(ctx: CanvasRenderingContext2D): void {
    // Draw all active AoE zones
    for (let i = 0; i < this.aoeZones.length; i++) {
      const zone = this.aoeZones[i];
      if (zone.active) {
        zone.draw(ctx);
      }
    }
  }
}
