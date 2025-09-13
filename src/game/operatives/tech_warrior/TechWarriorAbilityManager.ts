import { BaseAbilityManagerImpl } from '../BaseAbilityManager';
import { WeaponType } from '../../WeaponType';
import { WEAPON_SPECS } from '../../WeaponConfig';
import '../../keyState'; // Ensure mouseState is available globally

/**
 * Tech Warrior Ability Manager
 * Handles Glide Dash (Shift) and Tachyon Charge (Space) abilities
 */
export class TechWarriorAbilityManager extends BaseAbilityManagerImpl {
  // Tachyon meter (Space ability)
  private techMeter: number = 0;
  private techMeterMax: number = 5;
  private lastTechTriggerMs: number = 0;
  private techCharged: boolean = false;

  // Glide Dash (Shift ability)
  private techDashCooldownMsMax: number = 6000;
  private techDashCooldownMs: number = 0;
  private techDashPrevKey: boolean = false;
  private techDashActive: boolean = false;
  private techDashTimeMs: number = 0;
  private techDashDurationMs: number = 360;
  private techDashStartX: number = 0;
  private techDashStartY: number = 0;
  private techDashEndX: number = 0;
  private techDashEndY: number = 0;
  private techDashEmitAccum: number = 0;
  private techDashImpactDamage: number = 0;
  private techDashHitRadius: number = 0;
  private techDashHitIds: Set<string> = new Set();
  private techDashBossHit: boolean = false;
  private techDashDirX: number = 0;
  private techDashDirY: number = 0;
  private techDashWeaponLevel: number = 1;

  // Anchor RMB ability
  private anchorCooldownMs: number = 0;
  private anchorCooldownMsMax: number = 12000;
  private anchorActive: boolean = false;
  private anchorX: number = 0;
  private anchorY: number = 0;
  private anchorSpawnTime: number = 0;
  private anchorDurationMs: number = 3000;
  private anchorPrevRightMouse: boolean = false;
  
  // Teleport timing
  private teleportCharging: boolean = false;
  private teleportChargeStart: number = 0;
  private teleportChargeDuration: number = 300; // 300ms charge time
  private teleportTargetX: number = 0;
  private teleportTargetY: number = 0;

  constructor() {
    super('tech_warrior');
  }

  update(deltaTime: number, keyState: any, inputLocked: boolean): void {
    const dt = deltaTime;

    // Update Glide Dash cooldown
    if (this.techDashCooldownMs > 0) {
      this.techDashCooldownMs = Math.max(0, this.techDashCooldownMs - dt);
    }

    // Handle Glide Dash input (Shift)
    if (!inputLocked) {
      const shiftNow = !!keyState['shift'];
      if (shiftNow && !this.techDashPrevKey && this.techDashCooldownMs <= 0 && !this.techDashActive) {
        this.performTechGlide();
      }
      this.techDashPrevKey = shiftNow;
    }

    // Update active glide
    if (this.techDashActive) {
      this.updateGlideDash(dt);
    }

    // Update Anchor RMB ability
    this.updateAnchorAbility(dt, keyState, inputLocked);
    
    // Update teleport charging
    this.updateTeleportCharging(dt);
  }

  private performTechGlide(): void {
    if (this.techDashCooldownMs > 0 || this.techDashActive) return;
    
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const baseDistance = 240;
    const durationMs = this.techDashDurationMs;
    
    // Direction: follow current move input
    const mvMag = Math.hypot(this.player.vx || 0, this.player.vy || 0);
    if (mvMag < 0.01) return;
    
    const ang = Math.atan2(this.player.vy, this.player.vx);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    
    this.techDashDirX = dx;
    this.techDashDirY = dy;
    this.techDashStartX = this.player.x;
    this.techDashStartY = this.player.y;
    this.techDashEndX = this.player.x + dx * baseDistance;
    this.techDashEndY = this.player.y + dy * baseDistance;
    this.techDashTimeMs = 0;
    this.techDashActive = true;
    this.techDashEmitAccum = 0;
    this.techDashHitIds.clear();
    this.techDashBossHit = false;

    // Precompute damage and radius
    this.computeGlideDamage();
    
    // Brief i-frames
    this.player.invulnerableUntilMs = Math.max(this.player.invulnerableUntilMs || 0, now + Math.min(durationMs - 40, 300));
    
    // Feedback
    try { 
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 70, intensity: 1.6 } })); 
    } catch {}
  }

  private computeGlideDamage(): void {
    try {
      const aw = this.player.activeWeapons;
      const tsLvl = Math.max(1, Math.min(7, (aw?.get(WeaponType.TACHYON_SPEAR) ?? 1)));
      const tsSpec = WEAPON_SPECS[WeaponType.TACHYON_SPEAR];
      const sgSpec = WEAPON_SPECS[WeaponType.SINGULARITY_SPEAR];
      
      const tsStats = tsSpec?.getLevelStats ? tsSpec.getLevelStats(tsLvl) : { damage: tsSpec?.damage ?? 42, cooldown: tsSpec?.cooldown ?? 38, salvo: 1 };
      const sgStats = sgSpec?.getLevelStats ? sgSpec.getLevelStats(1) : { damage: sgSpec?.damage ?? 66, cooldown: sgSpec?.cooldown ?? 68, salvo: 1 };
      
      const tsDps = ((tsStats.damage || 0) * (tsStats.salvo || 1) * 60) / Math.max(1, (tsStats.cooldown || 38));
      const sgDps = ((sgStats.damage || 0) * (sgStats.salvo || 1) * 60) / Math.max(1, (sgStats.cooldown || 68));
      
      const gdm = this.player.getGlobalDamageMultiplier?.() ?? (this.player.globalDamageMultiplier ?? 1);
      const fraction = 0.65;
      const budget = Math.min(tsDps, sgDps) * fraction * (gdm || 1);
      this.techDashImpactDamage = Math.max(1, Math.round(budget));
      
      const areaMul = this.player.getGlobalAreaMultiplier?.() ?? (this.player.globalAreaMultiplier ?? 1);
      const baseR = Math.max(80, Math.min(160, Math.round(90 + tsLvl * 12)));
      this.techDashHitRadius = Math.max(48, Math.round(baseR * (areaMul || 1)));
      this.techDashWeaponLevel = tsLvl;
    } catch {
      this.techDashImpactDamage = 60;
      this.techDashHitRadius = 52;
      this.techDashWeaponLevel = 1;
    }
  }

  private updateGlideDash(dt: number): void {
    this.techDashTimeMs += dt;
    const t = Math.max(0, Math.min(1, this.techDashTimeMs / this.techDashDurationMs));
    
    // easeInOutQuad
    const ease = t < 0.5 ? (2 * t * t) : (1 - Math.pow(-2 * t + 2, 2) / 2);
    this.player.x = this.techDashStartX + (this.techDashEndX - this.techDashStartX) * ease;
    this.player.y = this.techDashStartY + (this.techDashEndY - this.techDashStartY) * ease;
    
    // Emit afterimages
    this.techDashEmitAccum += dt;
    const emitStep = 18;
    while (this.techDashEmitAccum >= emitStep) {
      this.techDashEmitAccum -= emitStep;
      this.emitAfterimage(t);
    }

    // End dash
    if (this.techDashTimeMs >= this.techDashDurationMs) {
      this.techDashActive = false;
      this.techDashTimeMs = 0;
      this.techDashEmitAccum = 0;
      this.techDashCooldownMs = this.techDashCooldownMsMax;
    }
  }

  private updateTeleportCharging(dt: number): void {
    if (!this.teleportCharging) return;
    
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const elapsed = now - this.teleportChargeStart;
    
    if (elapsed >= this.teleportChargeDuration) {
      // Complete teleport
      this.player.x = this.teleportTargetX;
      this.player.y = this.teleportTargetY;
      
      // Spawn explosion at target location
      console.log('Spawning teleport explosion at:', this.teleportTargetX, this.teleportTargetY);
      this.spawnTeleportExplosion(this.teleportTargetX, this.teleportTargetY);
      
      // Deal teleport damage
      this.dealAnchorDamage(this.teleportTargetX, this.teleportTargetY, false, true);
      
      // Reset teleport state
      this.teleportCharging = false;
      this.anchorActive = false;
      this.anchorCooldownMs = this.anchorCooldownMsMax;
      
      console.log('Teleport completed!');
    }
  }

  private emitAfterimage(t: number): void {
    const flipNow = this.player.lastDirX < 0;
    const alpha = 0.4 * (1 - t) + 0.2;
    const afx = this.player.x;
    const afy = this.player.y;
    
    // Use the same afterimage system as the player's dash
    if (this.player.runnerAfterimagesPool && this.player.runnerAfterimagesPool.length > 0) {
      const ai = this.player.runnerAfterimagesPool.pop();
      if (ai) {
        ai.x = afx; 
        ai.y = afy; 
        ai.alpha = alpha; 
        ai.flip = flipNow; 
        ai.lifeMs = 300;
        ai.ageMs = 0;
        ai.rotation = this.player.rotation - Math.PI/2;
        if (!this.player.runnerAfterimages) this.player.runnerAfterimages = [];
        this.player.runnerAfterimages.push(ai);
      }
    } else {
      // Create new afterimage if pool is empty
      const newAi = {
        x: afx,
        y: afy,
        rotation: this.player.rotation - Math.PI/2,
        flip: flipNow,
        ageMs: 0,
        lifeMs: 300,
        alpha: alpha
      };
      if (!this.player.runnerAfterimages) this.player.runnerAfterimages = [];
      this.player.runnerAfterimages.push(newAi);
    }
  }

  public addTechHits(count: number = 1): boolean {
    this.techMeter = Math.max(0, Math.min(this.techMeterMax, this.techMeter + count));
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    
    if (this.techMeter >= this.techMeterMax) {
      this.techMeter = 0;
      this.lastTechTriggerMs = now;
      this.techCharged = true;
      try { 
        window.dispatchEvent(new CustomEvent('techMeter', { detail: { value: 0, max: this.techMeterMax } })); 
      } catch {}
      return true;
    } else {
      try { 
        window.dispatchEvent(new CustomEvent('techMeter', { detail: { value: this.techMeter, max: this.techMeterMax } })); 
      } catch {}
      return false;
    }
  }

  private updateAnchorAbility(dt: number, keyState: any, inputLocked: boolean): void {
  // DEBUG: Log anchor state on RMB
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Update anchor cooldown
    if (this.anchorCooldownMs > 0) {
      this.anchorCooldownMs = Math.max(0, this.anchorCooldownMs - dt);
    }
    // Update anchor TTL
    if (this.anchorActive && now >= this.anchorSpawnTime + this.anchorDurationMs) {
      this.anchorActive = false;
    }
    // Handle RMB input directly
    if (!inputLocked && this.player) {
      const mouseState = (window as any).mouseState;
      if (!mouseState) return;
      const rightNow = !!mouseState.right;
      const rightPressed = rightNow && !this.anchorPrevRightMouse;
      this.anchorPrevRightMouse = rightNow;
      // Debug logging
      if (rightPressed) {
        console.log('Tech Warrior RMB: RMB edge detected');
      }
      if (rightPressed && this.anchorCooldownMs <= 0) {
  console.log('[Anchor] RMB pressed, anchorActive:', this.anchorActive, 'anchorX:', this.anchorX, 'anchorY:', this.anchorY);
        console.log('Tech Warrior RMB pressed, anchor active:', this.anchorActive);
        if (!this.anchorActive) {
          // Spawn new anchor at mouse position
          let anchorX = this.player.x;
          let anchorY = this.player.y;
          
          if (typeof mouseState.worldX === 'number' && typeof mouseState.worldY === 'number') {
            anchorX = mouseState.worldX;
            anchorY = mouseState.worldY;
          }
          
          this.anchorX = anchorX;
          this.anchorY = anchorY;
          this.anchorSpawnTime = now;
          this.anchorActive = true;
          
          // Deal spawn damage to nearby enemies
          this.dealAnchorDamage(this.anchorX, this.anchorY, true, false);
        } else {
          // Start teleport charge sequence
          console.log('Tech Warrior: Starting teleport charge to anchor at', this.anchorX, this.anchorY);
          
          // Store teleport target
          this.teleportTargetX = this.anchorX;
          this.teleportTargetY = this.anchorY;
          
          // Start charging
          this.teleportCharging = true;
          this.teleportChargeStart = now;
          
          console.log('Tech Warrior: Teleport charging started, will complete in', this.teleportChargeDuration, 'ms');
        }
      }
    }
  }

  private spawnTeleportExplosion(x: number, y: number): void {
    console.log('spawnTeleportExplosion called at:', x, y);
    try {
      const gameInstance = (this.player as any).gameContext || (window as any).__gameInstance;
      console.log('gameInstance:', gameInstance);
      console.log('particleManager:', gameInstance?.particleManager);
      
      if (!gameInstance?.particleManager) {
        console.warn('No particle manager found!');
        return;
      }
      
      const pm = gameInstance.particleManager;
      
      // Spawn multiple bursts of particles for a big explosion effect
      if (pm.spawn) {
        console.log('Spawning particles...');
        // Main cyan explosion burst
        pm.spawn(x, y, 15, '#00FFFF');
        
        // Secondary blue burst
        pm.spawn(x, y, 10, '#0080FF');
        
        // White sparkle burst
        pm.spawn(x, y, 8, '#FFFFFF');
        
        // Additional cyan particles for more intensity
        pm.spawn(x, y, 12, '#40E0D0');
        console.log('Particles spawned successfully!');
      } else {
        console.warn('pm.spawn method not found!');
      }
      
      // Add screen shake effect using the correct event system
      try {
        console.log('Triggering screen shake...');
        window.dispatchEvent(new CustomEvent('screenShake', { 
          detail: { durationMs: 200, intensity: 8 } 
        }));
        console.log('Screen shake triggered!');
      } catch (shakeError) {
        console.warn('Screen shake error:', shakeError);
      }
      
    } catch (error) {
      console.warn('spawnTeleportExplosion error:', error);
    }
  }

  private getTachyonSpearDamage(): number {
    try {
      const aw = this.player.activeWeapons;
      const tsLvl = Math.max(1, Math.min(7, (aw?.get(WeaponType.TACHYON_SPEAR) ?? 1)));
      const tsSpec = WEAPON_SPECS[WeaponType.TACHYON_SPEAR];
      
      if (!tsSpec) return 42; // Fallback damage
      
      const tsStats = tsSpec.getLevelStats ? tsSpec.getLevelStats(tsLvl) : { damage: tsSpec.damage ?? 42 };
      const gdm = this.player.getGlobalDamageMultiplier?.() ?? (this.player.globalDamageMultiplier ?? 1);
      
      return (tsStats.damage || 42) * (gdm || 1);
    } catch (error) {
      console.warn('Error calculating Tachyon Spear damage:', error);
      return 42; // Fallback
    }
  }

  private dealAnchorDamage(x: number, y: number, isSpawnDamage: boolean, knockback: boolean): void {
    try {
      const gameInstance = (this.player as any).gameContext || (window as any).__gameInstance;
      if (!gameInstance?.enemyManager?.enemies) return;
      
      // Get weapon-based damage
      const baseDamage = this.getTachyonSpearDamage();
      // Spawn damage is 25% of weapon hit, teleport damage is 1.5x weapon hit
      const damage = isSpawnDamage ? baseDamage * 0.25 : baseDamage * 1.5;
      
      console.log(`Anchor damage: ${isSpawnDamage ? 'spawn' : 'teleport'} = ${damage} (base weapon: ${baseDamage})`);
      
      const enemies = gameInstance.enemyManager.enemies;
      const DAMAGE_RADIUS = 120;
      
      for (const enemy of enemies) {
        if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') continue;
        
        const dx = enemy.x - x;
        const dy = enemy.y - y;
        const dist = Math.hypot(dx, dy);
        
        if (dist <= DAMAGE_RADIUS) {
          // Deal damage with falloff
          const actualDamage = damage * (1 - dist / DAMAGE_RADIUS * 0.5);
          
          // Use EnemyManager.takeDamage for proper damage text handling
          gameInstance.enemyManager.takeDamage(
            enemy, 
            actualDamage, 
            false, // isCritical
            false, // ignoreActiveCheck
            WeaponType.TACHYON_SPEAR, // sourceWeaponType
            x, // sourceX 
            y, // sourceY
            undefined, // weaponLevel
            true, // isIndirect (AoE damage)
            'PLAYER' // origin
          );
          
          // Apply knockback if needed
          if (knockback && dist > 0) {
            const knockDir = Math.atan2(dy, dx);
            const KNOCKBACK_FORCE = 300;
            const knockForce = KNOCKBACK_FORCE * (1 - dist / DAMAGE_RADIUS);
            if (typeof enemy.vx === 'number') enemy.vx = (enemy.vx || 0) + Math.cos(knockDir) * knockForce * 0.01;
            if (typeof enemy.vy === 'number') enemy.vy = (enemy.vy || 0) + Math.sin(knockDir) * knockForce * 0.01;
          }
        }
      }
    } catch (error) {
      console.warn('dealAnchorDamage error:', error);
    }
  }

  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } } {
    return {
      tech_glide: {
        value: this.techDashCooldownMsMax - this.techDashCooldownMs,
        max: this.techDashCooldownMsMax,
        ready: this.techDashCooldownMs <= 0 && !this.techDashActive,
        active: this.techDashActive
      },
      tachyon_charge: {
        value: this.techMeter,
        max: this.techMeterMax,
        ready: this.techCharged,
        active: false
      },
      tech_anchor: {
        value: this.anchorCooldownMsMax - this.anchorCooldownMs,
        max: this.anchorCooldownMsMax,
        ready: this.anchorCooldownMs <= 0,
        active: this.anchorActive
      }
    };
  }

  handleKeyPress(key: string, keyState: any): boolean {
    // Abilities are handled in update() method
    return false;
  }

  render(ctx: CanvasRenderingContext2D, player: any): void {
    try {
      // Render teleport charging effect
      if (this.teleportCharging) {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const elapsed = now - this.teleportChargeStart;
        const chargeProgress = Math.min(1, elapsed / this.teleportChargeDuration);
        
        // Charging effect around player
        ctx.save();
        ctx.globalAlpha = 0.6;
        const playerX = this.player.x;
        const playerY = this.player.y;
        
        // Spinning charge ring
        const chargeRadius = 20 + chargeProgress * 15;
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -now * 0.01;
        ctx.beginPath();
        ctx.arc(playerX, playerY, chargeRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Progress indicator
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(playerX, playerY, chargeRadius + 5, 0, Math.PI * 2 * chargeProgress);
        ctx.stroke();
        
        ctx.restore();
      }
      
      // ALWAYS render anchor if active, regardless of other conditions
      if (this.anchorActive) {
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const timeLeft = Math.max(0, (this.anchorSpawnTime + this.anchorDurationMs) - now);
        const progress = 1 - (timeLeft / this.anchorDurationMs);
        
        // Draw anchor visual - tech device with glowing effects
        ctx.save();
        
        // Use world coordinates directly (anchor's absolute position)
        const worldX = this.anchorX;
        const worldY = this.anchorY;
        
        // Pulsing glow effect
        const pulseSpeed = 0.003;
        const pulse = Math.sin(now * pulseSpeed) * 0.3 + 0.7;
        
        // Outer glow
        ctx.globalAlpha = 0.4 * pulse;
        const glowGradient = ctx.createRadialGradient(worldX, worldY, 0, worldX, worldY, 30);
        glowGradient.addColorStop(0, '#00FFFF');
        glowGradient.addColorStop(0.5, '#0080FF');
        glowGradient.addColorStop(1, 'transparent');
        ctx.fillStyle = glowGradient;
        ctx.fillRect(worldX - 30, worldY - 30, 60, 60);
        
        // Main device body (smaller)
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(worldX - 8, worldY - 8, 16, 16);
        
        // Tech border
        ctx.strokeStyle = '#00FFFF';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(worldX - 8, worldY - 8, 16, 16);
        
        // Inner core (smaller)
        ctx.fillStyle = `rgba(0, 255, 255, ${pulse})`;
        ctx.fillRect(worldX - 4, worldY - 4, 8, 8);
        
        // Corner accents (smaller)
        const accentSize = 2;
        ctx.fillStyle = '#FFFFFF';
        // Top-left
        ctx.fillRect(worldX - 8, worldY - 8, accentSize, 1);
        ctx.fillRect(worldX - 8, worldY - 8, 1, accentSize);
        // Top-right
        ctx.fillRect(worldX + 8 - accentSize, worldY - 8, accentSize, 1);
        ctx.fillRect(worldX + 8 - 1, worldY - 8, 1, accentSize);
        // Bottom-left
        ctx.fillRect(worldX - 8, worldY + 8 - 1, accentSize, 1);
        ctx.fillRect(worldX - 8, worldY + 8 - accentSize, 1, accentSize);
        // Bottom-right
        ctx.fillRect(worldX + 8 - accentSize, worldY + 8 - 1, accentSize, 1);
        ctx.fillRect(worldX + 8 - 1, worldY + 8 - accentSize, 1, accentSize);
        
        // Rotating energy rings (smaller)
        ctx.strokeStyle = `rgba(0, 255, 255, ${pulse * 0.6})`;
        ctx.lineWidth = 1;
        const ringRotation = (now * 0.002) % (Math.PI * 2);
        
        for (let i = 0; i < 2; i++) {
          const radius = 12 + i * 6;
          const rotation = ringRotation + (i * Math.PI / 3);
          
          ctx.beginPath();
          for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
            const x = worldX + Math.cos(angle + rotation) * radius;
            const y = worldY + Math.sin(angle + rotation) * radius;
            const nextAngle = angle + Math.PI / 12;
            const nextX = worldX + Math.cos(nextAngle + rotation) * radius;
            const nextY = worldY + Math.sin(nextAngle + rotation) * radius;
            
            ctx.moveTo(x, y);
            ctx.lineTo(nextX, nextY);
          }
          ctx.stroke();
        }

        ctx.restore();
      }
    } catch (error) {
      console.error('Anchor render error:', error);
    }
  }

  getMovementModifiers(): { speedMultiplier: number; moveMultiplier: number } {
    return { speedMultiplier: 1, moveMultiplier: 1 };
  }

  getWeaponModifiers(weaponType: number): { cooldownMultiplier: number; damageMultiplier: number; spreadMultiplier: number } {
    return { cooldownMultiplier: 1, damageMultiplier: 1, spreadMultiplier: 1 };
  }

  getRenderData(): { shouldRender: boolean; alpha?: number; effects?: any[] } {
    return { shouldRender: true };
  }
}