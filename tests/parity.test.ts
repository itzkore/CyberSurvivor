import { describe, it, expect } from 'vitest';
import { Player } from '../src/game/Player';
import { EnemyManager } from '../src/game/EnemyManager';
import { BulletManager } from '../src/game/BulletManager';
import { BossManager } from '../src/game/BossManager';
import { ExplosionManager } from '../src/game/ExplosionManager';
import { SpatialGrid } from '../src/physics/SpatialGrid';
import { ParticleManager } from '../src/game/ParticleManager';
import type { Bullet } from '../src/game/Bullet';
import type { Enemy } from '../src/game/EnemyManager';
import { AssetLoader } from '../src/game/AssetLoader';
import { WEAPON_SPECS } from '../src/game/WeaponConfig';
import { WeaponType } from '../src/game/WeaponType';

// Minimal environment stubs for headless tests (inspired by BalanceSimulator)
const g: any = globalThis as any;
if (typeof g.performance === 'undefined') g.performance = { now: () => Date.now() };
// Drive performance.now() from a deterministic source when provided
if (typeof (g as any).__headlessNowMs === 'undefined') (g as any).__headlessNowMs = undefined as number | undefined;
g.performance.now = (() => {
  const fallback = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now.bind(performance) : Date.now;
  return () => (typeof (g as any).__headlessNowMs === 'number' ? (g as any).__headlessNowMs! : fallback());
})();
if (typeof g.window === 'undefined') g.window = {} as any;
// Minimal event bus to support addEventListener/dispatchEvent in headless mode
(() => {
  const w: any = g.window as any;
  if (!w.__evt) w.__evt = new Map<string, Set<Function>>();
  w.addEventListener = (type: string, fn: Function) => {
    if (!w.__evt.has(type)) w.__evt.set(type, new Set());
    w.__evt.get(type)!.add(fn);
  };
  w.removeEventListener = (type: string, fn: Function) => { w.__evt.get(type)?.delete(fn); };
  w.dispatchEvent = (ev: any) => { const s = w.__evt.get(ev?.type); if (s) s.forEach((fn: any) => { try { fn(ev); } catch {} }); return true; };
})();
// CustomEvent polyfill for Node
if (typeof (g as any).CustomEvent === 'undefined') {
  (g as any).CustomEvent = class {
    type: string; detail: any;
    constructor(type: string, params?: any) { this.type = type; this.detail = params?.detail; }
  } as any;
}
if (typeof g.requestAnimationFrame === 'undefined') g.requestAnimationFrame = (cb: (t:number)=>void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
if (typeof g.cancelAnimationFrame === 'undefined') g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout);
if (!(g.window as any).requestAnimationFrame) (g.window as any).requestAnimationFrame = g.requestAnimationFrame;
if (!(g.window as any).cancelAnimationFrame) (g.window as any).cancelAnimationFrame = g.cancelAnimationFrame;
if (typeof g.location === 'undefined') g.location = { protocol: 'file:', pathname: '/', href: 'file:///' } as any;
if (typeof g.document === 'undefined') {
  const makeNoop2D = () => new Proxy({}, { get: () => () => {}, set: () => true });
  g.document = {
    createElement: (tag: string) => tag === 'canvas' ? ({ width: 0, height: 0, style: {}, getContext: () => makeNoop2D(), toDataURL: () => 'data:' } as any) : ({ style: {} } as any),
    getElementById: () => null,
    body: { appendChild: () => {}, removeChild: () => {} },
    querySelector: () => null,
  } as any;
}
if (typeof g.Image === 'undefined') {
  class NodeImage { src = ''; width = 0; height = 0; onload: any = null; onerror: any = null; constructor(){ setTimeout(()=>{ try { this.onload && this.onload(); } catch {} }, 0);} }
  g.Image = NodeImage as any;
}

function buildWorld() {
  const world = 4000 * 10;
  const char: any = { id: 'test_dummy', name: 'Tester', stats: { hp: 100, maxHp: 100, speed: 8, damage: 20, strength: 5, intelligence: 5, agility: 5, luck: 5, defense: 5 } };
  const player = new Player(world/2, world/2, char);
  const particleManager = new ParticleManager(0);
  const enemySpatial = new SpatialGrid<Enemy>(200);
  const bulletSpatial = new SpatialGrid<Bullet>(100);
  const assetLoader = new AssetLoader();
  const enemyMgr = new EnemyManager(player, bulletSpatial, particleManager, assetLoader, 1);
  const bossMgr = new BossManager(player, particleManager, 1, assetLoader);
  const bulletMgr = new BulletManager(assetLoader, enemySpatial, particleManager, enemyMgr, player);
  const explosionMgr = new ExplosionManager(particleManager, enemyMgr, player, bulletMgr);
  // Monotonic game time (seconds)
  const time = { sec: 0 };

  (player as any).setEnemyProvider(() => enemyMgr.getEnemies());
  (player as any).setGameContext({ bulletManager: bulletMgr, assetLoader, explosionManager: explosionMgr, enemyManager: enemyMgr, bossManager: bossMgr, particleManager, getGameTime: () => time.sec });
  const w: any = g.window as any;
  w.__bossManager = bossMgr;
  w.__gameInstance = { gameMode: 'SANDBOX', getGameTime: () => time.sec };
  w.__designWidth = 1280; w.__designHeight = 720; w.__camX = player.x - 640; w.__camY = player.y - 360;
  // Bridge explosion events (as Game.ts does) so bullets that dispatch events actually cause damage in tests
  const onMortar = (e: any) => { const d = e.detail || {}; try { explosionMgr.triggerTitanMortarExplosion(d.x, d.y, d.damage ?? 0, d.radius ?? 200); } catch {} };
  const onDrone = (e: any) => { const d = e.detail || {}; try { explosionMgr.triggerDroneExplosion(d.x, d.y, d.damage ?? 0, d.radius ?? 110, '#00BFFF'); } catch {} };
  const onEnemyDeath = (e: any) => { const d = e.detail || {}; try { explosionMgr.triggerExplosion(d.x, d.y, d.damage ?? 0, undefined, d.radius ?? 50, d.color ?? '#FF4500'); } catch {} };
  w.addEventListener('mortarExplosion', onMortar as any);
  w.addEventListener('droneExplosion', onDrone as any);
  w.addEventListener('enemyDeathExplosion', onEnemyDeath as any);
  return { player, enemyMgr, bossMgr, bulletMgr, explosionMgr, enemySpatial, particleManager, time };
}

async function step(world: ReturnType<typeof buildWorld>, ms: number) {
  const dt = 16.6667; const steps = Math.max(1, Math.round(ms / dt));
  for (let i = 0; i < steps; i++) {
    // Advance monotonic game time first so all systems read the new nowMs
    world.time.sec += dt / 1000;
    (g as any).__headlessNowMs = Math.floor(world.time.sec * 1000);
    world.player.update(dt);
    world.enemyMgr.update(dt, world.time.sec, world.bulletMgr.bullets);
    world.bossMgr.update(dt, world.time.sec);
    // Rebuild the shared enemy spatial grid used by BulletManager for broadphase
    try {
      world.enemySpatial.clear();
      const enemies = world.enemyMgr.getEnemies();
      for (let ei = 0; ei < enemies.length; ei++) { const e = enemies[ei]; if (e && e.active) world.enemySpatial.insert(e); }
    } catch {}
    world.bulletMgr.update(dt);
    world.explosionMgr.update(dt);
    (world.particleManager as any).update?.(dt);
  }
}

async function waitUntil(world: ReturnType<typeof buildWorld>, predicate: () => boolean, timeoutMs = 6000, stepMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await step(world, stepMs);
  }
  return predicate();
}

function spawnBossAt(_world: ReturnType<typeof buildWorld>, x: number, y: number) {
  (global as any).window.dispatchEvent(new (global as any).CustomEvent('sandboxSpawnBoss', { detail: { x, y, cinematic: false, id: 'beta' } }));
}

function spawnTreasureAt(_world: ReturnType<typeof buildWorld>, x: number, y: number, hp = 200) {
  (global as any).window.dispatchEvent(new (global as any).CustomEvent('spawnTreasure', { detail: { x, y, hp } }));
}

describe('Class weapon parity: boss and treasure damage', () => {
  it('Each class weapon damages the boss within 6 seconds when in range', async () => {
    const classWeapons = Object.values(WEAPON_SPECS)
      .filter(s => s && s.isClassWeapon && !s.disabled)
      .map(s => s.id);
    for (const w of classWeapons) {
      const world = buildWorld();
      const { player } = world;
      player.activeWeapons.clear();
      spawnBossAt(world, player.x + 180, player.y);
    // Wait for boss to become ACTIVE and capture HP
    await waitUntil(world, () => { const bm:any = (global as any).window.__bossManager; const b = bm?.getActiveBoss?.() || bm?.getBoss?.(); return !!(b && b.hp > 0); }, 2000);
    const bossBefore = (() => { const bm:any = (global as any).window.__bossManager; const b = bm?.getActiveBoss?.() || bm?.getBoss?.(); return b?.hp ?? 0; })();
      player.addWeapon(w as WeaponType);
    await waitUntil(world, () => { const bm:any = (global as any).window.__bossManager; const b = bm?.getActiveBoss?.() || bm?.getBoss?.(); return (b?.hp ?? bossBefore) < bossBefore; }, 6000);
    const bossAfter = (() => { const bm:any = (global as any).window.__bossManager; const b = bm?.getActiveBoss?.() || bm?.getBoss?.(); return b?.hp ?? bossBefore; })();
    expect(bossAfter).toBeLessThan(bossBefore);
    }
  }, 120000);

  it('Each class weapon can damage a treasure within 8 seconds when in range', async () => {
    const classWeapons = Object.values(WEAPON_SPECS)
      .filter(s => s && s.isClassWeapon && !s.disabled)
      .map(s => s.id);
    for (const w of classWeapons) {
      const world = buildWorld();
      const { player } = world;
      player.activeWeapons.clear();
      spawnTreasureAt(world, player.x + 140, player.y, 150);
      const emAny: any = world.enemyMgr as any;
    await waitUntil(world, () => { const ts = emAny.getTreasures?.() || []; return ts.length > 0 && ts[ts.length-1]?.hp > 0; }, 2000);
    const treBefore = (() => { const ts = emAny.getTreasures?.() || []; return ts.length ? ts[ts.length-1].hp : 0; })();
      player.addWeapon(w as WeaponType);
    await waitUntil(world, () => { const ts = emAny.getTreasures?.() || []; const hp = ts.length ? ts[ts.length-1].hp : treBefore; return hp < treBefore; }, 8000);
    const treAfter = (() => { const ts = emAny.getTreasures?.() || []; return ts.length ? ts[ts.length-1].hp : treBefore; })();
    expect(treAfter).toBeLessThan(treBefore);
    }
  }, 120000);
});

describe('Bio Engineer parity: puddle on boss hit and treasure corrosion', () => {
  it('Bio Toxin spawns a puddle on boss hit and corrodes nearby treasure', async () => {
    const world = buildWorld();
    const { player } = world;
    // Equip Bio Toxin
    player.addWeapon(WeaponType.BIO_TOXIN);
    // Spawn boss and treasure clustered together
    const bx = player.x + 140, by = player.y;
    spawnBossAt(world, bx, by);
    spawnTreasureAt(world, bx + 12, by, 160);
    const emAny: any = world.enemyMgr as any;
    // Wait for a puddle to appear near boss
    const gotPuddle = await waitUntil(world, () => {
      const arr = (emAny.poisonPuddles || []).filter((p: any) => p.active);
      return arr.some((p: any) => ((p.x - bx) ** 2 + (p.y - by) ** 2) <= ((p.radius + 120) ** 2));
    }, 8000);
    expect(gotPuddle).toBe(true);
    // Verify treasure hp reduced due to corrosion ticks (or destroyed)
    await waitUntil(world, () => { const ts = emAny.getTreasures?.() || []; return ts.length > 0; }, 2000);
    const t0 = (() => { const ts = emAny.getTreasures?.() || []; return ts.length ? ts[ts.length-1].hp : 160; })();
    const corroded = await waitUntil(world, () => { const ts = emAny.getTreasures?.() || []; const cur = ts.length ? ts[ts.length-1].hp : t0; return cur < t0; }, 6000);
    expect(corroded).toBe(true);
  }, 40000);
});
