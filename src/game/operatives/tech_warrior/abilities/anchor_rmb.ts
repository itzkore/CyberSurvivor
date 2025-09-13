import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

interface AnchorState {
  x: number;
  y: number;
  spawnTime: number;
  ttl: number;
  level: number;
  active: boolean;
}

const COOLDOWN_MS = 12000; // 12s cooldown
const ANCHOR_DURATION_MS = 3000; // 3s anchor duration
const SPAWN_DAMAGE = 80;
const TELEPORT_DAMAGE = 120;
const KNOCKBACK_FORCE = 300;
const DAMAGE_RADIUS = 120;

function ensureHudGetter(p: any, getRemain: () => number, isActive: () => boolean) {
  if (!p.getTechAnchor) {
    p.getTechAnchor = function() {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const max = COOLDOWN_MS; 
      const remain = Math.max(0, getRemain());
      return { 
        value: (max - remain), 
        max, 
        ready: remain <= 0, 
        active: !!isActive() 
      };
    };
  }
}

/**
 * Tech Warrior Anchor RMB Ability
 * - First RMB: Spawns anchor at mouse position for 3s, deals damage in radius
 * - Second RMB: Teleports to anchor position, deals damage + knockback, consumes anchor
 */
export const TechAnchorRMB: AbilityDescriptor = {
  key: 'RMB',
  id: 'tech_anchor',
  getMeter: (p: Player) => (p as any).getTechAnchor?.() ?? null,
  
  update: (p: Player & any, dtMs: number) => {
    try {
      const g: any = (p as any).gameContext || (window as any).__gameInstance;
      if (!g) return;
      
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      
      // Initialize state
      if (!(p as any).__techAnchor) {
        (p as any).__techAnchor = { 
          anchor: null as AnchorState | null, 
          cooldownUntil: 0,
          prevRightMouse: false
        };
      }
      
      const S = (p as any).__techAnchor as { 
        anchor: AnchorState | null; 
        cooldownUntil: number;
        prevRightMouse: boolean;
      };
      
      // Setup HUD getter
      ensureHudGetter(p, 
        () => Math.max(0, S.cooldownUntil - now),
        () => !!S.anchor?.active
      );
      
      // Update anchor TTL
      if (S.anchor && S.anchor.active) {
        if (now >= S.anchor.spawnTime + S.anchor.ttl) {
          S.anchor = null; // Anchor expired
        }
      }
      
      // Handle RMB input - safer approach
      const mouseState = (window as any).mouseState;
      if (!mouseState) return; // No mouse state available
      
      const rightNow = !!mouseState.right;
      const rightPressed = rightNow && !S.prevRightMouse;
      S.prevRightMouse = rightNow;
      
      if (rightPressed && now >= S.cooldownUntil) {
        if (!S.anchor || !S.anchor.active) {
          // Spawn new anchor at mouse world position (fallback to player pos), clamped to walkable
          let worldX = p.x;
          let worldY = p.y;
          try {
            const ms: any = (window as any).mouseState;
            if (ms && typeof ms.worldX === 'number' && typeof ms.worldY === 'number') {
              worldX = ms.worldX; worldY = ms.worldY;
            }
            const rm: any = g?.roomManager || (window as any).__roomManager;
            if (rm && typeof rm.clampToWalkable === 'function') {
              const rad = (p as any)?.radius ?? 16;
              const clamped = rm.clampToWalkable(worldX, worldY, rad, 'player');
              if (clamped && typeof clamped.x === 'number' && typeof clamped.y === 'number') {
                worldX = clamped.x; worldY = clamped.y;
              }
            }
          } catch {}
          
          S.anchor = {
            x: worldX,
            y: worldY,
            spawnTime: now,
            ttl: ANCHOR_DURATION_MS,
            level: 1,
            active: true
          };
          
          // Deal spawn damage (with safety checks)
          try {
            dealAnchorDamage(g, worldX, worldY, SPAWN_DAMAGE, false);
          } catch (err) {
            console.warn('Anchor spawn damage failed:', err);
          }
          
          // Visual effect for spawn (with safety checks)
          try {
            spawnAnchorEffect(g, worldX, worldY);
          } catch (err) {
            console.warn('Anchor spawn effect failed:', err);
          }
        } else {
          // Teleport to anchor and deal damage
          const anchor = S.anchor;
          
          // Teleport player
          p.x = anchor.x;
          p.y = anchor.y;
          
          // Deal teleport damage with knockback (with safety checks)
          try {
            dealAnchorDamage(g, anchor.x, anchor.y, TELEPORT_DAMAGE, true);
          } catch (err) {
            console.warn('Anchor teleport damage failed:', err);
          }
          
          // Visual effect for teleport (with safety checks)
          try {
            spawnTeleportEffect(g, anchor.x, anchor.y);
          } catch (err) {
            console.warn('Anchor teleport effect failed:', err);
          }
          
          // Consume anchor and start cooldown
          S.anchor = null;
          S.cooldownUntil = now + COOLDOWN_MS;
        }
      }
    } catch (error) {
      console.error('Tech Warrior Anchor RMB error:', error);
    }
  },
  
  render: (p: Player & any, ctx: CanvasRenderingContext2D) => {
    try {
      const S = (p as any).__techAnchor;
      if (!S?.anchor?.active) return;
      
      const anchor = S.anchor;
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const timeLeft = Math.max(0, (anchor.spawnTime + anchor.ttl) - now);
      const alpha = Math.min(1, timeLeft / 1000); // Fade out in last second
      
      // Draw anchor visual
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(anchor.x - p.x, anchor.y - p.y);
      
      // Pulsing anchor point
      const pulsePhase = (now / 200) % (Math.PI * 2);
      const pulseSize = 8 + Math.sin(pulsePhase) * 3;
      
      // Outer glow
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, pulseSize * 2);
      gradient.addColorStop(0, 'rgba(65, 105, 225, 0.8)');
      gradient.addColorStop(0.5, 'rgba(65, 105, 225, 0.4)');
      gradient.addColorStop(1, 'rgba(65, 105, 225, 0)');
      
      ctx.fillStyle = gradient;
      ctx.fillRect(-pulseSize * 2, -pulseSize * 2, pulseSize * 4, pulseSize * 4);
      
      // Core anchor
      ctx.fillStyle = '#4169E1';
      ctx.fillRect(-pulseSize, -pulseSize, pulseSize * 2, pulseSize * 2);
      
      // Inner highlight
      ctx.fillStyle = '#87CEEB';
      ctx.fillRect(-pulseSize * 0.5, -pulseSize * 0.5, pulseSize, pulseSize);
      
      ctx.restore();
    } catch (error) {
      console.warn('Anchor render error:', error);
    }
  }
};

function dealAnchorDamage(gameInstance: any, x: number, y: number, damage: number, knockback: boolean) {
  try {
    const enemies = gameInstance.enemyManager?.enemies || [];
    
    for (const enemy of enemies) {
      if (!enemy || typeof enemy.x !== 'number' || typeof enemy.y !== 'number') continue;
      
      const dx = enemy.x - x;
      const dy = enemy.y - y;
      const dist = Math.hypot(dx, dy);
      
      if (dist <= DAMAGE_RADIUS) {
        // Deal damage
        const actualDamage = damage * (1 - dist / DAMAGE_RADIUS * 0.5); // Falloff
        if (typeof enemy.hp === 'number') {
          enemy.hp = Math.max(0, enemy.hp - actualDamage);
        }
        
        // Knockback effect
        if (knockback && dist > 0) {
          const knockDir = Math.atan2(dy, dx);
          const knockForce = KNOCKBACK_FORCE * (1 - dist / DAMAGE_RADIUS);
          if (typeof enemy.vx === 'number') enemy.vx = (enemy.vx || 0) + Math.cos(knockDir) * knockForce * 0.01;
          if (typeof enemy.vy === 'number') enemy.vy = (enemy.vy || 0) + Math.sin(knockDir) * knockForce * 0.01;
        }
        
        // Damage text
        try {
          if (gameInstance.damageTextManager && gameInstance.damageTextManager.addDamageText) {
            gameInstance.damageTextManager.addDamageText(
              enemy.x, enemy.y - 20, 
              Math.round(actualDamage), 
              '#4169E1'
            );
          }
        } catch (textError) {
          // Ignore damage text errors
        }
      }
    }
  } catch (error) {
    console.warn('dealAnchorDamage error:', error);
  }
}

function spawnAnchorEffect(gameInstance: any, x: number, y: number) {
  try {
    // Spawn particle effect for anchor placement
    if (gameInstance.particleManager && gameInstance.particleManager.addParticle) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const speed = 50 + Math.random() * 30;
        gameInstance.particleManager.addParticle({
          x: x + Math.cos(angle) * 10,
          y: y + Math.sin(angle) * 10,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 800 + Math.random() * 400,
          size: 3 + Math.random() * 2,
          color: '#4169E1',
          alpha: 0.8
        });
      }
    }
  } catch (error) {
    console.warn('spawnAnchorEffect error:', error);
  }
}

function spawnTeleportEffect(gameInstance: any, x: number, y: number) {
  try {
    // Spawn particle effect for teleport
    if (gameInstance.particleManager && gameInstance.particleManager.addParticle) {
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 50;
        gameInstance.particleManager.addParticle({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1200 + Math.random() * 600,
          size: 4 + Math.random() * 3,
          color: '#87CEEB',
          alpha: 1.0
        });
      }
    }
  } catch (error) {
    console.warn('spawnTeleportEffect error:', error);
  }
}