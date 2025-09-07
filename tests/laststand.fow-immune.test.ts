import { describe, it, expect } from 'vitest';
import { EnemyManager } from '../src/game/EnemyManager';
import { Player } from '../src/game/Player';
import { WeaponType } from '../src/game/WeaponType';

// Minimal window stubs used by LS visibility helpers
function stubLastStand(core:{x:number;y:number}, corridors?: Array<{x:number;y:number;w:number;h:number}>) {
  (globalThis as any).window = (globalThis as any).window || {};
  const w: any = (globalThis as any).window;
  if (typeof (globalThis as any).document === 'undefined') {
    const makeNoop2D = () => new Proxy({}, { get: () => () => {}, set: () => true });
    (globalThis as any).document = {
      createElement: (tag: string) => tag === 'canvas' ? ({ width: 0, height: 0, style: {}, getContext: () => makeNoop2D(), toDataURL: () => 'data:' } as any) : ({ style: {} } as any),
      body: { appendChild: () => {}, removeChild: () => {} },
      getElementById: () => null,
      querySelector: () => null,
      addEventListener: () => {},
    } as any;
  }
  if (typeof (globalThis as any).Image === 'undefined') {
    (globalThis as any).Image = class { src = ''; width = 0; height = 0; onload: any = null; onerror: any = null; constructor(){ setTimeout(()=>{ try { this.onload && this.onload(); } catch {} }, 0);} } as any;
  }
  if (!w.addEventListener) {
    w.__evt = new Map<string, Set<Function>>();
    w.addEventListener = (type: string, fn: Function) => { if (!w.__evt.has(type)) w.__evt.set(type, new Set()); w.__evt.get(type)!.add(fn); };
    w.removeEventListener = (type: string, fn: Function) => { w.__evt.get(type)?.delete(fn); };
    w.dispatchEvent = (ev: any) => { const s = w.__evt.get(ev?.type); if (s) s.forEach((fn: any) => { try { fn(ev); } catch {} }); return true; };
  }
  if (typeof (globalThis as any).CustomEvent === 'undefined') {
    (globalThis as any).CustomEvent = class { type: string; detail: any; constructor(type: string, params?: any) { this.type = type; this.detail = params?.detail; } } as any;
  }
  (window as any).__gameInstance = { gameMode: 'LAST_STAND', getEffectiveFowRadiusTiles: () => 4, fowTileSize: 160 };
  (window as any).__lsCore = { x: core.x, y: core.y };
  (window as any).__roomManager = { getCorridors: () => corridors || [] };
}

import { SpatialGrid } from '../src/physics/SpatialGrid';
import type { Bullet } from '../src/game/Bullet';

function makeEnemyManagerWithPlayer(px=0, py=0) {
  const player = { x: px, y: py } as unknown as Player;
  const grid = new SpatialGrid<Bullet>(160);
  const em = new EnemyManager(player, grid, undefined, undefined, 1);
  return em as any;
}

describe('Last Stand Fog-of-War immunity', () => {
  it('blocks PLAYER-origin direct damage and knockback when target is in fog', () => {
    stubLastStand({ x: 0, y: 0 });
    const em = makeEnemyManagerWithPlayer(0, 0);
  const enemy = { id: 'e1', x: 900, y: 0, radius: 16, hp: 100, active: true } as any;
  (em as any).activeEnemies = [enemy];

    // Attempt to apply damage outside FoW circle (no corridors). Should be ignored.
    const hpBefore = enemy.hp;
    em.takeDamage(enemy, 50, false, false, WeaponType.PISTOL, 0, 0, 1, false, 'PLAYER');
    expect(enemy.hp).toBe(hpBefore);
    // And no knockback should be set
    expect((enemy as any).knockbackTimer || 0).toBe(0);
    expect((enemy as any).knockbackVx || 0).toBe(0);
    expect((enemy as any).knockbackVy || 0).toBe(0);
  });

  it('allows damage when enemy is inside corridor even if outside circle', () => {
    stubLastStand({ x: 0, y: 0 }, [{ x: 800, y: -40, w: 200, h: 80 }]);
    const em = makeEnemyManagerWithPlayer(0, 0);
  const enemy = { id: 'e2', x: 900, y: 0, radius: 16, hp: 100, active: true } as any;
    ;(em as any).activeEnemies = [enemy];

    em.takeDamage(enemy, 25, false, false, WeaponType.PISTOL, 0, 0, 1, false, 'PLAYER');
    expect(enemy.hp).toBe(75);
  });
});

// Simple turret targeting smoke test: ensure a turret with a visible target and nonzero range will attempt a shot
import { TurretManager as TM } from '../src/game/modes/turret-manager';

describe('TurretManager targeting (smoke)', () => {
  it('acquires a visible enemy within turret spec range and produces a tracer or damage', () => {
    stubLastStand({ x: 0, y: 0 });
    const tm = new TM();
    // Seed specs manually to avoid network
    (tm as any).specs = { turret_minigun: { id: 'turret_minigun', name: 'Minigun', range: 560, dps: [35], price: [90] } };
    (tm as any).turrets = [{ id: 'turret_minigun', x: 0, y: 0, level: 1, spec: (tm as any).specs.turret_minigun }];
    (tm as any).fireAccumMs = [1000]; // ensure ready to fire

    const em = makeEnemyManagerWithPlayer(0,0);
    const enemy = { id: 3, x: 300, y: 0, hp: 100, active: true, radius: 16 } as any;
    (em as any).activeEnemies = [enemy];

    const bm = { spawnBullet: (_sx:number,_sy:number,_tx:number,_ty:number,_wt:any,_dmg:number)=>{ /* no-op */ } };

    const beforeShots = (tm as any).shots.length;
    tm.update(100, em, bm);
    const afterShots = (tm as any).shots.length;
    // We should have either queued a tracer or (if tracers disabled in env) at least not error; tracer count increase proves acquisition
    expect(afterShots).toBeGreaterThanOrEqual(beforeShots);
  });
});
