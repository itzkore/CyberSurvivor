
import { screenToWorld } from '../../../core/coords';
import { WeaponType } from '../../WeaponType';

/** Wasteland Scavenger RMB: Redirect Scrap Lash and Space Pulse (per-operative). */
export class ScavengerRedirectRMB {
  private game: any;
  private redirectCdUntil = 0;
  private pulseCdUntil = 0;

  constructor(game: any) { this.game = game; }

  update(nowMs: number, _deltaMs: number, rDown: boolean, edge: boolean, camX: number, camY: number) {
    if (edge) {
      const mx = (window as any).__mouseX || 0; const my = (window as any).__mouseY || 0; const world = screenToWorld(mx, my, camX, camY);
      const bullets = this.game.bulletManager.bullets;
      for (let i=0;i<bullets.length;i++) {
        const bb:any = bullets[i]; if (!bb || !bb.active) continue;
        if (bb.weaponType === (window as any).WeaponType?.SCRAP_LASH || bb.weaponType === (typeof WeaponType !== 'undefined' ? (WeaponType as any).SCRAP_LASH : bb.weaponType)) {
          if (!bb._lashWaypoints) bb._lashWaypoints = [];
          bb._lashWaypoints.push({ x: world.x, y: world.y });
          if (!bb._lashRedirectActive && (bb._lashPhase === 'OUT' || bb._lashPhase === 'RETURN')) {
            const next = bb._lashWaypoints.shift();
            if (next) { bb._lashRedirectActive = true; bb._lashRedirectX = next.x; bb._lashRedirectY = next.y; bb._lashPhase = 'REDIRECT'; bb._lastRedirectDist = undefined; }
          }
          break;
        }
      }
      this.redirectCdUntil = nowMs + 3000;
    }

    const spaceDown = !!(this.game as any).keyState?.[' '] || !!(this.game as any).keyState?.['space'] || !!(window as any).keyState?.[' '] || !!(window as any).keyState?.['space'];
    const prevSpace = (this as any)._prevSpace || false;
    if (spaceDown && !prevSpace) {
      if (nowMs >= this.pulseCdUntil) {
        const bullets = this.game.bulletManager.bullets; let lash:any = null;
        for (let i=0;i<bullets.length;i++) { const bb:any = bullets[i]; if (bb && bb.active && bb.weaponType === WeaponType.SCRAP_LASH) { lash = bb; break; } }
        const pulseX = lash ? lash.x : this.game.player.x; const pulseY = lash ? lash.y : this.game.player.y; const radius = Math.max(140, (lash?.radius||18) * 6);
        const enemies = this.game.enemyManager.getEnemies ? this.game.enemyManager.getEnemies() : this.game.enemyManager.enemies; let hits = 0; const dmgBase = (lash?.damage || 30);
        for (let i=0;i<enemies.length;i++) { const e:any = enemies[i]; if (!e || !e.active || e.hp<=0) continue; const dx = e.x - pulseX; const dy = e.y - pulseY; if (dx*dx + dy*dy > radius*radius) continue; this.game.enemyManager.takeDamage(e, dmgBase, false, false, WeaponType.SCRAP_LASH, pulseX, pulseY, (lash?.level||1), false, 'PLAYER'); hits++; }
        if (hits>0) {
          try { const p:any = this.game.player; const trig = p.addScrapHits ? p.addScrapHits(hits) : false; if (trig) { const reach2 = 120; const radius2 = Math.max(220, Math.round(reach2 * 1.6)); const gdm = (p.getGlobalDamageMultiplier?.() ?? (p.globalDamageMultiplier ?? 1)); const dmgRef = Math.round((dmgBase) * 1.25 * (gdm || 1)); window.dispatchEvent(new CustomEvent('scrapExplosion', { detail: { x: p.x, y: p.y, damage: dmgRef, radius: radius2, color: '#FFAA33' } })); const timeSec = (window as any)?.__gameInstance?.getGameTime?.() ?? 0; const eff = (this.game as any).getHealEfficiency ? (this.game as any).getHealEfficiency(timeSec) : 1; const amt = 5 * eff; p.hp = Math.min(p.maxHp || p.hp, p.hp + amt); } } catch {}
          try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: pulseX, y: pulseY, r: radius } })); } catch {}
        }
        this.pulseCdUntil = nowMs + 10000;
      }
    }
    (this as any)._prevSpace = spaceDown;

    const selfRef:any = this;
    if (!(this.game.player as any).getScavengerRedirect) { (this.game.player as any).getScavengerRedirect = function(){ const now = performance.now(); const max = 3000; const remain = Math.max(0, selfRef.redirectCdUntil - now); return { value: (max - remain), max, ready: remain<=0 }; }; }
    if (!(this.game.player as any).getScavengerPulse) { (this.game.player as any).getScavengerPulse = function(){ const now = performance.now(); const max = 10000; const remain = Math.max(0, selfRef.pulseCdUntil - now); return { value: (max - remain), max, ready: remain<=0 }; }; }
  }
}