import { describe, it, expect } from 'vitest';
import { Player } from '../src/game/Player';
import { EnemyManager, type Enemy } from '../src/game/EnemyManager';
import { BulletManager } from '../src/game/BulletManager';
import { BossManager } from '../src/game/BossManager';
import { ExplosionManager } from '../src/game/ExplosionManager';
import { SpatialGrid } from '../src/physics/SpatialGrid';
import type { Bullet } from '../src/game/Bullet';
import { ParticleManager } from '../src/game/ParticleManager';
import { AssetLoader } from '../src/game/AssetLoader';
import { WeaponType } from '../src/game/WeaponType';

// Minimal LS stubs
function stubLastStand(core:{x:number;y:number}, corridors?: Array<{x:number;y:number;w:number;h:number}>){
  (globalThis as any).window = (globalThis as any).window || {};
  const w: any = (globalThis as any).window;
  if (!w.__evt) w.__evt = new Map<string, Set<Function>>();
  w.addEventListener = (type: string, fn: Function) => { if (!w.__evt.has(type)) w.__evt.set(type, new Set()); w.__evt.get(type)!.add(fn); };
  w.removeEventListener = (type: string, fn: Function) => { w.__evt.get(type)?.delete(fn); };
  w.dispatchEvent = (ev: any) => { const s = w.__evt.get(ev?.type); if (s) s.forEach((fn: any) => { try { fn(ev); } catch {} }); return true; };
  if (typeof (globalThis as any).CustomEvent === 'undefined') {
    (globalThis as any).CustomEvent = class { type: string; detail: any; constructor(type: string, params?: any) { this.type = type; this.detail = params?.detail; } } as any;
  }
  // Basic DOM/canvas shims
  if (typeof (globalThis as any).document === 'undefined') {
    const makeNoop2D = () => new Proxy({}, { get: () => () => {}, set: () => true });
    (globalThis as any).document = {
      createElement: (tag: string) => tag === 'canvas' ? ({ width: 0, height: 0, style: {}, getContext: () => makeNoop2D(), toDataURL: () => 'data:' } as any) : ({ style: {} } as any),
      body: { appendChild: () => {}, removeChild: () => {} },
      getElementById: () => null,
      querySelector: () => null,
    } as any;
  }
  if (typeof (globalThis as any).Image === 'undefined') {
    (globalThis as any).Image = class { src = ''; width = 0; height = 0; onload: any = null; onerror: any = null; constructor(){ setTimeout(()=>{ try { this.onload && this.onload(); } catch {} }, 0);} } as any;
  }
  (w as any).__gameInstance = { gameMode: 'LAST_STAND', getEffectiveFowRadiusTiles: () => 4, fowTileSize: 160 };
  (w as any).__lsCore = { x: core.x, y: core.y };
  (w as any).__roomManager = { getCorridors: () => corridors || [] };
}

function buildLsWorld(px=0, py=0){
  const char: any = { id: 'test_dummy', name: 'Tester', stats: { hp: 100, maxHp: 100, speed: 8, damage: 20 } };
  const player = new Player(px, py, char);
  const particleManager = new ParticleManager(0);
  const enemySpatial = new SpatialGrid<Enemy>(200);
  const bulletSpatial = new SpatialGrid<Bullet>(100);
  const assetLoader = new AssetLoader();
  const enemyMgr = new EnemyManager(player, bulletSpatial, particleManager, assetLoader, 1);
  const bossMgr = new BossManager(player, particleManager, 1, assetLoader);
  const bulletMgr = new BulletManager(assetLoader, enemySpatial, particleManager, enemyMgr, player);
  const explosionMgr = new ExplosionManager(particleManager, enemyMgr, player, bulletMgr);
  const time = { sec: 0 };
  (player as any).setEnemyProvider(() => enemyMgr.getEnemies());
  (player as any).setGameContext({ bulletManager: bulletMgr, assetLoader, explosionManager: explosionMgr, enemyManager: enemyMgr, bossManager: bossMgr, particleManager, getGameTime: () => time.sec });
  const w: any = (globalThis as any).window as any;
  w.__bossManager = bossMgr;
  w.__designWidth = 1280; w.__designHeight = 720; w.__camX = player.x - 640; w.__camY = player.y - 360;
  return { player, enemyMgr, bulletMgr, time, enemySpatial };
}

async function step(world: ReturnType<typeof buildLsWorld>, ms: number){
  const dt = 16.6667; const steps = Math.max(1, Math.round(ms / dt));
  for (let i = 0; i < steps; i++){
    world.time.sec += dt / 1000;
    world.player.update(dt);
    world.enemyMgr.update(dt, world.time.sec, world.bulletMgr.bullets);
    // mirror Game.ts: rebuild shared enemy spatial grid
    world.enemySpatial.clear();
    const enemies = world.enemyMgr.getEnemies();
    for (let ei=0; ei<enemies.length; ei++){ const e = enemies[ei]; if (e && e.active) world.enemySpatial.insert(e); }
    world.bulletMgr.update(dt);
  }
}

function addEnemy(world: ReturnType<typeof buildLsWorld>, x:number, y:number, hp=120, radius=14){
  const e: Enemy = { x, y, hp, maxHp: hp, radius, speed: 0, active: true, type: 'small', damage: 0, id: 'e_' + Math.random().toString(36).slice(2) };
  (world.enemyMgr as any).enemies.push(e);
  return e;
}

describe('Last Stand selection gating (no shooting into fog)', () => {
  it('does not auto-fire at an enemy outside LS visibility (no circle/no corridor)', async () => {
    stubLastStand({ x: 0, y: 0 }); // no corridors
    const w = buildLsWorld(0, 0);
    // Give player an auto-firing weapon
    w.player.activeWeapons.clear();
    w.player.addWeapon(WeaponType.PISTOL);
    // Place an enemy well outside the core-centered visibility circle (~608px radius)
    const enemy = addEnemy(w, 900, 0, 200);
    await step(w, 1200);
    // No bullets should have spawned and enemy should be unharmed
    expect(w.bulletMgr.bullets.filter(b => b.active).length).toBe(0);
    expect(enemy.hp).toBe(200);
  });

  it('auto-fires when enemy is visible via corridor and within weapon range', async () => {
    // Corridor exposes [400..600] x [-40..40]
    stubLastStand({ x: 0, y: 0 }, [{ x: 400, y: -40, w: 200, h: 80 }]);
    const w = buildLsWorld(0, 0);
    w.player.activeWeapons.clear();
    w.player.addWeapon(WeaponType.PISTOL);
    // Put enemy at x=500 (within corridor and within typical pistol range ~520)
    const enemy = addEnemy(w, 500, 0, 200);
    const hpBefore = enemy.hp;
    await step(w, 2200);
    // Expect at least one projectile fired or enemy HP reduced
    const anyBullets = w.bulletMgr.bullets.some(b => b.active && b.weaponType === WeaponType.PISTOL);
    const tookDamage = enemy.hp < hpBefore;
    expect(anyBullets || tookDamage).toBe(true);
  });
});
