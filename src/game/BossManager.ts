import { Player } from './Player';
import { ParticleManager } from './ParticleManager';

export type Boss = { x: number; y: number; hp: number; maxHp: number; radius: number; active: boolean; telegraph: number; state: 'TELEGRAPH' | 'ACTIVE' | 'DEAD'; attackTimer: number; _damageFlash?: number; specialCharge?: number; specialReady?: boolean } | null;

export class BossManager {
  private player: Player;
  private boss: Boss = null;
  private spawnTimer: number = 0; // Use gameTime directly
  private particleManager: ParticleManager | null = null;
  private difficulty: number = 1;
  private lastBossSpawnTime: number = 0; // Track last spawn time

  constructor(player: Player, particleManager?: ParticleManager, difficulty = 1) {
    this.player = player;
    this.particleManager = particleManager || null;
    this.difficulty = difficulty;
    this.lastBossSpawnTime = 0; // Initialize to 0
  }

  public update(deltaTime: number, gameTime: number) { // Added gameTime parameter
    if (!this.boss) {
      // Spawn boss every 60 seconds of game time
      if (gameTime - this.lastBossSpawnTime >= 60) {
        this.spawnBoss();
        this.lastBossSpawnTime = gameTime;
      }
    } else if (this.boss.state === 'TELEGRAPH') {
      this.boss.telegraph--;
      if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#f55');
      if (this.boss.telegraph <= 0) {
        this.boss.state = 'ACTIVE';
        this.boss.attackTimer = 60;
      }
    } else if (this.boss && this.boss.state === 'ACTIVE') {
      const dx = this.player.x - this.boss.x;
      const dy = this.player.y - this.boss.y;
      const dist = Math.hypot(dx, dy);
      // Special attack logic
      if (this.boss.specialCharge == null) this.boss.specialCharge = 0;
      if (this.boss.specialReady == null) this.boss.specialReady = false;
      if (!this.boss.specialReady) {
        // Move slower
        if (dist > 0) {
          this.boss.x += (dx / dist) * 0.7;
          this.boss.y += (dy / dist) * 0.7;
        }
        this.boss.specialCharge++;
        if (this.boss.specialCharge > 360) { // Charge for 6 seconds
          this.boss.specialReady = true;
          this.boss.specialCharge = 0;
        }
      } else {
        // Telegraph special attack: stop and charge for 3 seconds
        this.boss.specialCharge++;
        if (this.boss.specialCharge < 180) {
          // Show telegraph effect (spawn particles less frequently)
          if (this.particleManager && this.boss.specialCharge % 5 === 0) this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#FF00FF'); // Spawn fewer particles every 5 frames
        } else {
          // Unleash special attack (e.g., massive area damage)
          if (dist < this.boss.radius + 120) {
            this.player.hp -= 80; // Massive damage if close
            if (this.particleManager) this.particleManager.spawn(this.player.x, this.player.y, 2, '#FF0000'); // Reduced particles
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 300, intensity: 10 } })); // Screen shake on special attack
          }
          this.boss.specialReady = false;
          this.boss.specialCharge = 0;
        }
      }
      this.boss.attackTimer--;
      if (this.boss.attackTimer <= 0) {
        this.launchAttackWave();
        this.boss.attackTimer = Math.max(30, 60 - (this.difficulty - 1) * 10);
      }
      // Player-boss collision and damage
      if (dist < this.player.radius + this.boss.radius) {
        this.player.hp -= 20; // Boss deals damage on contact
        this.boss.hp -= 30; // Player deals damage to boss on contact
        this.boss._damageFlash = 12; // Boss flash effect
        // Knockback effect
        this.player.x -= (dx / dist) * 32;
        this.player.y -= (dy / dist) * 32;
        this.boss.x += (dx / dist) * 16;
        this.boss.y += (dy / dist) * 16;
        // Visual feedback
        if (this.particleManager) {
          this.particleManager.spawn(this.player.x, this.player.y, 1, '#f00'); // Reduced particles
          this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#FFD700'); // Reduced particles
        }
      }
      if (this.boss._damageFlash && this.boss._damageFlash > 0) {
        this.boss._damageFlash--;
      }
      if (this.boss.hp <= 0) {
        this.boss.state = 'DEAD';
        this.spawnChest(this.boss.x, this.boss.y); // Spawn chest on boss defeat
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 500, intensity: 15 } })); // Stronger shake on boss defeat
      }
    }
  }

  private spawnBoss() {
    // Spawn boss close to player
    const px = this.player.x;
    const py = this.player.y;
    const angle = Math.random() * Math.PI * 2;
    const dist = 220 + Math.random() * 80;
    const bx = px + Math.cos(angle) * dist;
    const by = py + Math.sin(angle) * dist;
    // Oppenheimer-style cinematic entrance: screen shake, slow-motion, flash, sound event
    if (window && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('bossSpawn', { detail: { x: bx, y: by, cinematic: true } }));
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 200, intensity: 8 } })); // Initial shake on boss spawn
    }
    const bossHp = 3000 + (this.difficulty - 1) * 1000;
    this.boss = {
      x: bx,
      y: by,
      hp: bossHp,
  maxHp: bossHp, // Set maxHp for HP bar drawing
      radius: 160,
      active: true,
      telegraph: 180,
      state: 'TELEGRAPH',
      attackTimer: 0,
      _damageFlash: 0
    };
    // Immediately activate boss fight overlay
    if (window && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('bossFightStart', { detail: { boss: this.boss } }));
    }
  }

  private spawnChest(x: number, y: number): void {
    // Dispatch an event that EnemyManager (or a new ChestManager) can listen to
    window.dispatchEvent(new CustomEvent('spawnChest', { detail: { x, y } }));
  }

  private launchAttackWave() {
    if (!this.boss) return;
    // spawn telegraph pulses before actual projectiles
    if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#f90'); // Reduced particles
    // Boss spawns minions every 3rd attack
    if (Math.random() < 0.33) {
      if (window && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('bossMinionSpawn', { detail: { x: this.boss.x, y: this.boss.y, count: 3 + this.difficulty } }));
      }
    }
    // create projectiles that will be handled by Game-level projectile system
    const event = new CustomEvent('bossAttack', { detail: { x: this.boss.x, y: this.boss.y, intensity: this.difficulty } });
    window.dispatchEvent(event);
    // Visual effect: flash
    if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#fff'); // Reduced particles
  }
 
   public draw(ctx: CanvasRenderingContext2D) {
    if (!this.boss) return;
    if (this.boss.state === 'TELEGRAPH') {
      // Oppenheimer-style telegraph: slow-motion, intense glow, cinematic overlay
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.font = 'bold 64px Orbitron, Arial';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#FF00FF';
      ctx.shadowBlur = 32;
      ctx.fillText('BOSS APPROACHING', ctx.canvas.width/2, ctx.canvas.height/2 - 80);
      ctx.font = 'bold 32px Orbitron, Arial';
      ctx.fillStyle = '#FF00FF';
      ctx.fillText('Prepare for Impact', ctx.canvas.width/2, ctx.canvas.height/2 - 20);
      ctx.restore();
      // Massive glowing telegraph ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.8)';
      ctx.lineWidth = 24;
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 64;
      ctx.beginPath();
      ctx.arc(this.boss.x, this.boss.y, this.boss.radius + 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (this.boss.state === 'ACTIVE') {
      // Large HP bar above boss
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#222';
      ctx.fillRect(this.boss.x - 120, this.boss.y - this.boss.radius - 38, 240, 22);
      ctx.fillStyle = '#f00';
      const hpPct = Math.max(0, this.boss.hp) / (3000 + (this.difficulty - 1) * 1000);
      ctx.fillRect(this.boss.x - 120, this.boss.y - this.boss.radius - 38, 240 * hpPct, 22);
      ctx.font = 'bold 18px Orbitron, Arial';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS HP', this.boss.x, this.boss.y - this.boss.radius - 44);
      ctx.restore();
      // Boss body with damage flash and shake
      ctx.save();
      if (this.boss._damageFlash && this.boss._damageFlash > 0) {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(this.boss._damageFlash * 2);
        ctx.translate((Math.random()-0.5)*8, (Math.random()-0.5)*8);
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 48;
      }
      ctx.beginPath();
      ctx.arc(this.boss.x, this.boss.y, this.boss.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
      ctx.restore();
      // Monster eyes, now glowing and animated
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.boss.x-48, this.boss.y-32, 24, 0, Math.PI*2);
      ctx.arc(this.boss.x+48, this.boss.y-32, 24, 0, Math.PI*2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = '#FF00FF';
      ctx.shadowBlur = 32;
      ctx.globalAlpha = 0.9 + 0.1*Math.sin(Date.now()/200);
      ctx.fill();
      ctx.restore();
    }
  }

  public getActiveBoss() {
    return this.boss && this.boss.state === 'ACTIVE' ? this.boss : null;
  }

  public setDifficulty(d: number) {
    this.difficulty = d;
    this.spawnTimer = Math.max(600, 1800 - (d - 1) * 300);
  }
}
