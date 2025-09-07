import { loadJSON, lastStandData } from './config-loader';
import { WeaponType } from '../../game/WeaponType';
import { WEAPON_SPECS } from '../../game/WeaponConfig';

type TurretSpec = { id:string; name:string; range:number; dps:number[]; price:number[] };
type TurretInst = { id:string; x:number; y:number; level:number; spec:TurretSpec };
type TurretShot = { x:number; y:number; x2:number; y2:number; life:number; maxLife:number; color:string; width:number };

export class TurretManager {
  private specs: Record<string, TurretSpec> = Object.create(null);
  private turrets: TurretInst[] = [];
  private shots: TurretShot[] = [];
  private fireAccumMs: number[] = [];
  /** Visual shot tracers; disabled to avoid laser-like lines for minigun. */
  private enableTracers: boolean = false;

  async load(): Promise<void> {
    try {
      const url = lastStandData.turrets();
      const json = await loadJSON<Record<string, Omit<TurretSpec,'id'> & {id?:string}>>(url);
      const out: Record<string, TurretSpec> = Object.create(null);
      for (const k of Object.keys(json||{})) {
        const v = json[k] as any;
        const id = v.id || k;
        out[id] = { id, name: v.name || id, range: v.range || 420, dps: v.dps || [25,40,60,90], price: v.price || [80,120,180,260] };
      }
      this.specs = out;
    } catch {
      this.specs = {
        'turret_gun': { id:'turret_gun', name:'Gun Turret', range: 520, dps: [30,48,72,110], price:[80,120,180,260] }
      };
    }
  }

  list(): TurretInst[] { return this.turrets; }
  listShots(): TurretShot[] { return this.shots; }
  getSpec(id:string){ return this.specs[id]; }
  getMaxLevel(id:string){ const s=this.specs[id]; return s ? s.dps.length : 1; }
  findNearest(x:number,y:number, maxDist=80): TurretInst | null {
    let best:TurretInst|null=null; let bd2 = maxDist*maxDist;
    for (let i=0;i<this.turrets.length;i++){
      const t=this.turrets[i]; const dx=t.x-x, dy=t.y-y; const d2=dx*dx+dy*dy; if (d2<=bd2){ bd2=d2; best=t; }
    }
    return best;
  }

  place(id: string, x: number, y: number) {
    const spec = this.specs[id]; if (!spec) return false;
  this.turrets.push({ id, x, y, level: 1, spec });
  this.fireAccumMs.push(0);
    return true;
  }

  upgrade(t: TurretInst) { if (t.level < t.spec.dps.length) t.level++; }
  remove(t: TurretInst) {
    const i = this.turrets.indexOf(t);
    if (i>=0) {
      this.turrets.splice(i,1);
      // Keep fire accumulator indices aligned with turret indices
      if (i < this.fireAccumMs.length) this.fireAccumMs.splice(i,1);
    }
  }

  update(deltaMs: number, enemyManager: any, bulletManager?: any) {
    // Fade existing shot tracers (always tick list; we add only for whitelisted weapons)
    if (this.shots.length) {
      for (let i=0;i<this.shots.length;i++) this.shots[i].life -= deltaMs;
      // prune
      let w = 0; for (let i=0;i<this.shots.length;i++){ const s = this.shots[i]; if (s.life > 0) this.shots[w++] = s; } this.shots.length = w;
    }
    if (!this.turrets.length) return;
    // Precompute Last Stand visibility parameters once per tick to gate targeting into fog.
    // We mirror Game.ts FOW render logic minimally: circular radius around Core plus corridor rectangles.
    let lsMode = false;
    let visCx = 0, visCy = 0, visR2 = 0;
    let corridors: any[] | null = null;
    try {
      const gi: any = (window as any).__gameInstance;
      lsMode = gi && gi.gameMode === 'LAST_STAND';
      if (lsMode) {
        // Prefer the per-frame cache authored by Last Stand mode; it’s the single source of truth used by Player and bullets.
        const cache: any = (window as any).__lsAimCache;
        if (cache && typeof cache.cx === 'number' && typeof cache.cy === 'number' && typeof cache.r2 === 'number') {
          visCx = cache.cx; visCy = cache.cy; visR2 = cache.r2;
          const cs = cache.corridors as any[] | undefined;
          corridors = (cs && cs.length) ? cs : null;
        } else {
          // Fallback: compute from Core or player and RoomManager corridors
          const core: any = (window as any).__lsCore;
          if (core && core.x != null) { visCx = core.x; visCy = core.y; }
          else if (gi && gi.player) { visCx = gi.player.x; visCy = gi.player.y; }
          let radiusPx = 640; // fallback
          try {
            const tiles = typeof gi?.getEffectiveFowRadiusTiles === 'function' ? gi.getEffectiveFowRadiusTiles() : 4;
            const ts = (gi && typeof gi.fowTileSize === 'number') ? gi.fowTileSize : 160;
            radiusPx = Math.floor(tiles * ts * 0.95);
          } catch {}
          visR2 = radiusPx * radiusPx;
          const rm: any = (window as any).__roomManager;
          const corrs = rm?.getCorridors?.();
          corridors = (corrs && corrs.length) ? corrs : null;
        }
      }
    } catch { /* ignore visibility precompute errors */ }
    // Helper: LS visibility test. Enemies on the corridor or within the core radius are considered visible.
    const isVisibleLS = (ex: number, ey: number): boolean => {
      if (!lsMode) return true;
      // If visibility cache is expected but not initialized yet this frame, be conservative: consider nothing visible
      if (visR2 <= 0) return false;
      // Circle around core
      const dx = ex - visCx; const dy = ey - visCy;
      if (dx*dx + dy*dy <= visR2) return true;
      // Corridor rectangles
      if (corridors) {
        for (let i=0;i<corridors.length;i++) {
          const c = corridors[i];
          // Use inclusive bounds; coordinates are world-space
          if (ex >= c.x && ex <= c.x + c.w && ey >= c.y && ey <= c.y + c.h) return true;
        }
      }
      return false;
    };
    // Apply weapon-like cadence per turret (spawn real bullets using BulletManager)
  const enemies = enemyManager.getEnemies?.() || [];
  for (let i=0;i<this.turrets.length;i++) {
      const t = this.turrets[i];
      // Map turret id to an actual weapon type
      const wType = this.getWeaponTypeForTurret(t.id);
      // Resolve weapon spec and level-scaled params
      const wSpec: any = (WEAPON_SPECS as any)[wType];
      const lvl = Math.max(1, Math.min(t.level, (wSpec?.maxLevel || 7)));
      const scaled = wSpec?.getLevelStats ? wSpec.getLevelStats(lvl) : {};
  let cooldown = (scaled.cooldown != null ? scaled.cooldown : wSpec?.cooldown) || 30; // frames
  // Heavy mortar fires at half the fire rate (double cooldown frames)
  if (t.id === 'turret_heavy_mortar') cooldown = Math.max(1, cooldown * 2);
      const salvo = (scaled.salvo != null ? scaled.salvo : (wSpec?.salvo ?? 1)) || 1;
      const spread = (scaled.spread != null ? scaled.spread : (wSpec?.spread ?? 0)) || 0;
      const bulletDamage = (scaled.damage != null ? scaled.damage : (wSpec?.damage ?? 5)) || 5;
  // Use turret spec range for targeting to match design sheets (do not clamp to weapon's base range)
  const weaponRange = t.spec.range || (scaled.range != null ? scaled.range : (wSpec?.range ?? 520));
      const range2 = weaponRange * weaponRange;
      // Convert cooldown frames to milliseconds (game runs at 60fps cadence for cooldowns)
      const periodMs = Math.max(5, (cooldown / 60) * 1000);
      this.fireAccumMs[i] = (this.fireAccumMs[i] || 0) + deltaMs;
      while (this.fireAccumMs[i] >= periodMs) {
        this.fireAccumMs[i] -= periodMs;
        // Pick closest target in range at fire time
        let best:any = null; let bestD2 = Infinity;
        // Prefer boss when visible and in range
        try {
          const bm:any = (window as any).__bossManager; const boss = bm?.getActiveBoss?.();
          if (boss && boss.active && boss.hp > 0 && boss.state === 'ACTIVE' && isVisibleLS(boss.x, boss.y)) {
            const dxB = boss.x - t.x, dyB = boss.y - t.y; const d2B = dxB*dxB + dyB*dyB;
            if (d2B <= range2) { best = boss; bestD2 = d2B; }
          }
        } catch { /* ignore boss lookup */ }
        // Query within range for efficiency and reliability; fallback to full list if API not available
        const cand = (typeof enemyManager.queryEnemies === 'function') ? enemyManager.queryEnemies(t.x, t.y, weaponRange) : enemies;
        for (let j=0;j<cand.length;j++) {
          const e = cand[j]; if (!e || !e.active || e.hp<=0) continue;
          if (!isVisibleLS(e.x, e.y)) continue; // LS gate
          const dx = e.x - t.x, dy = e.y - t.y; const d2 = dx*dx + dy*dy; if (d2 > range2) continue;
          if (d2 < bestD2) { best = e; bestD2 = d2; }
        }
        if (!best) break;
        const baseDx = best.x - t.x, baseDy = best.y - t.y; const baseA = Math.atan2(baseDy, baseDx);
        // Fire salvo with weapon spread; spawn real bullets
        for (let k=0;k<salvo;k++) {
          const ang = baseA + (spread * (k - (salvo-1)/2));
          // Optional visual helper — add tracers for select weapons (e.g., Minigun)
          if (this.enableTracers && this.shouldDrawTracer(wType)) {
            const len = Math.min(Math.hypot(baseDx, baseDy), weaponRange);
            const x2 = t.x + Math.cos(ang) * len;
            const y2 = t.y + Math.sin(ang) * len;
            const vis = this.getTracerForWeapon(wType);
            this.shots.push({ x: t.x, y: t.y, x2, y2, life: vis.life, maxLife: vis.life, color: vis.color, width: vis.width });
          }
          if (bulletManager && typeof bulletManager.spawnBullet === 'function') {
            const dmg = Math.max(1, Math.round(bulletDamage));
            const b = bulletManager.spawnBullet(t.x, t.y, t.x + Math.cos(ang) * 100, t.y + Math.sin(ang) * 100, wType, dmg, lvl, 'TURRET');
            // Ensure turret bullets can travel up to the turret's own spec range (not the base weapon range)
            try {
              if (b) {
                const sp = Math.max(0.0001, Math.hypot(b.vx || 0, b.vy || 0));
                const desired = weaponRange; // turret targeting range in px
                // Lifetime in frames ~= distance/speed (clamped like BulletManager)
                const lifeFrames = Math.min(Math.max(Math.round(desired / sp), 8), 624);
                (b as any).life = lifeFrames;
                (b as any).maxDistanceSq = desired * desired;
              }
            } catch { /* ignore bullet lifetime tuning errors */ }
          } else {
            // Fallback: apply direct damage if bulletManager not available
            const perBolt = Math.max(1, Math.round(bulletDamage));
            // Provide source coords and origin so knockback direction and scaling are correct
            enemyManager.takeDamage?.(best, perBolt, false, true, wType, t.x, t.y, lvl, false, 'TURRET');
          }
        }
        // Cap tracer history to avoid buildup
        if (this.shots.length > 140) this.shots.splice(0, this.shots.length - 140);
      }
    }
  }

  /** Only draw tracers for high-cadence weapons that benefit from visual feedback. */
  private shouldDrawTracer(wt: WeaponType): boolean {
  return false; // No tracers for any turret (minigun included)
  }

  private getWeaponTypeForTurret(id: string): WeaponType {
  if (id === 'turret_minigun') return WeaponType.GUNNER_MINIGUN;
  if (id === 'turret_mortar' || id === 'turret_heavy_mortar') return WeaponType.MECH_MORTAR;
    if (id === 'turret_crossbow3') return (WeaponType as any).TRI_SHOT ?? (WeaponType as any).CROSSBOW ?? WeaponType.PISTOL;
    return WeaponType.PISTOL; // generic fallback
  }

  private getTracerForWeapon(wt: WeaponType): { color: string; width: number; life: number } {
    switch (wt) {
  case WeaponType.GUNNER_MINIGUN: return { color: '#1AFFD5', width: 2, life: 55 };
      default: return { color: '#FFB357', width: 3, life: 110 };
    }
  }
}
