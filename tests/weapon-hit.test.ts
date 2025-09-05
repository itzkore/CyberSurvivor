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
import { WEAPON_SPECS } from '../src/game/WeaponConfig';
import { WeaponType } from '../src/game/WeaponType';

// Headless environment shims (mirror parity.test.ts)
const g: any = globalThis as any;
if (typeof g.performance === 'undefined') g.performance = { now: () => Date.now() };
if (typeof (g as any).__headlessNowMs === 'undefined') (g as any).__headlessNowMs = undefined as number | undefined;
g.performance.now = (() => {
  const fallback = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now.bind(performance) : Date.now;
  return () => (typeof (g as any).__headlessNowMs === 'number' ? (g as any).__headlessNowMs! : fallback());
})();
if (typeof g.window === 'undefined') g.window = {} as any;
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
if (typeof (g as any).CustomEvent === 'undefined') {
  (g as any).CustomEvent = class { type: string; detail: any; constructor(type: string, params?: any) { this.type = type; this.detail = params?.detail; } } as any;
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
  const time = { sec: 0 };
  (player as any).setEnemyProvider(() => enemyMgr.getEnemies());
  (player as any).setGameContext({ bulletManager: bulletMgr, assetLoader, explosionManager: explosionMgr, enemyManager: enemyMgr, bossManager: bossMgr, particleManager, getGameTime: () => time.sec });
  const w: any = g.window as any;
  w.__bossManager = bossMgr;
  w.__gameInstance = { gameMode: 'SANDBOX', getGameTime: () => time.sec };
  w.__designWidth = 1280; w.__designHeight = 720; w.__camX = player.x - 640; w.__camY = player.y - 360;
  // Bridge explosion events to ExplosionManager so tests can assert AoE paths without a full Game instance
  const explosionEvents = { mortar: 0, drone: 0, enemyDeath: 0 };
  const onMortar = (e: any) => { const d = e.detail || {}; explosionEvents.mortar++; try { explosionMgr.triggerTitanMortarExplosion(d.x, d.y, d.damage ?? 0, d.radius ?? 200); } catch {} };
  const onDrone = (e: any) => { const d = e.detail || {}; explosionEvents.drone++; try { explosionMgr.triggerDroneExplosion(d.x, d.y, d.damage ?? 0, d.radius ?? 110, '#00BFFF'); } catch {} };
  const onEnemyDeath = (e: any) => { const d = e.detail || {}; explosionEvents.enemyDeath++; try { explosionMgr.triggerExplosion(d.x, d.y, d.damage ?? 0, undefined, d.radius ?? 50, d.color ?? '#FF4500'); } catch {} };
  w.addEventListener('mortarExplosion', onMortar as any);
  w.addEventListener('droneExplosion', onDrone as any);
  w.addEventListener('enemyDeathExplosion', onEnemyDeath as any);
  return { player, enemyMgr, bossMgr, bulletMgr, explosionMgr, particleManager, time, explosionEvents, enemySpatial };
}

async function step(world: ReturnType<typeof buildWorld>, ms: number) {
  const dt = 16.6667; const steps = Math.max(1, Math.round(ms / dt));
  for (let i = 0; i < steps; i++) {
    world.time.sec += dt / 1000;
    (globalThis as any).__headlessNowMs = Math.floor(world.time.sec * 1000);
    world.player.update(dt);
    world.enemyMgr.update(dt, world.time.sec, world.bulletMgr.bullets);
    world.bossMgr.update(dt, world.time.sec);
    // Mirror Game.ts: rebuild the shared enemy spatial grid used by BulletManager
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

function spawnEnemyNear(world: ReturnType<typeof buildWorld>, x: number, y: number, hp = 200, radius = 12) {
  const e: Enemy = { x, y, hp, maxHp: hp, radius, speed: 0, active: true, type: 'small', damage: 0, id: 'e_' + Math.random().toString(36).slice(2) };
  (world.enemyMgr as any).enemies.push(e);
  // One update to rebuild activeEnemies and enemy spatial grid
  return e;
}

const orbitOrZoneWeapons = new Set<WeaponType>([
  WeaponType.RESONANT_WEB,
  WeaponType.QUANTUM_HALO,
  WeaponType.INDUSTRIAL_GRINDER,
]);

// Some weapons have non-immediate impact (e.g., BIO_TOXIN/LIVING_SLUDGE). Allow longer window.
const slowTickWeapons = new Set<WeaponType>([
  WeaponType.BIO_TOXIN,
  WeaponType.LIVING_SLUDGE,
  WeaponType.DATA_SIGIL,
  WeaponType.RUNIC_ENGINE,
]);

async function assertHitEnemy(specId: WeaponType) {
  const spec: any = (WEAPON_SPECS as any)[specId];
  if (!spec || spec.disabled) return; // skip disabled
  const world = buildWorld();
  const { player, bulletMgr, enemyMgr } = world;
  const ex = player.x + 120, ey = player.y; // in front
  const enemy = spawnEnemyNear(world, ex, ey, 240, 14);
  // Ensure grid rebuild contains the enemy
  await step(world, 50);

  const before = enemy.hp;

  let hit = false;
  if (!orbitOrZoneWeapons.has(specId)) {
    // Try direct projectile overlap
    const b = bulletMgr.spawnBullet(enemy.x, enemy.y, enemy.x + 1, enemy.y, specId, spec.damage || 1, 1);
    if (b) {
      // Step frames to process collision
      await step(world, 50);
      hit = enemy.hp < before || (enemy as any)._lastHitByWeapon === specId;
    }
  }
  if (!hit) {
    // Fallback: enable weapon on player and let systems do their thing
    player.activeWeapons.clear();
    player.addWeapon(specId);
    const timeout = slowTickWeapons.has(specId) ? 9000 : 6000;
    await waitUntil(world, () => enemy.hp < before || (enemy as any)._lastHitByWeapon === specId, timeout, 100);
    hit = enemy.hp < before || (enemy as any)._lastHitByWeapon === specId;
  }
  if (!hit) throw new Error(`Weapon ${spec.name || WeaponType[specId]} (${WeaponType[specId]}) failed to hit ENEMY`);
}

async function assertHitBoss(specId: WeaponType) {
  const spec: any = (WEAPON_SPECS as any)[specId];
  if (!spec || spec.disabled) return; // skip disabled
  const world = buildWorld();
  const { player, bulletMgr } = world;
  const bx = player.x + 160, by = player.y;
  spawnBossAt(world, bx, by);
  // Wait boss becomes ACTIVE
  await waitUntil(world, () => { const bm:any = (global as any).window.__bossManager; const b = bm?.getActiveBoss?.() || bm?.getBoss?.(); return !!(b && b.hp > 0 && b.state === 'ACTIVE'); }, 2000);
  const boss = (() => { const bm:any = (global as any).window.__bossManager; return bm?.getActiveBoss?.() || bm?.getBoss?.(); })();
  const before = boss.hp;

  let hit = false;
  if (!orbitOrZoneWeapons.has(specId)) {
    const b = bulletMgr.spawnBullet(boss.x, boss.y, boss.x + 2, boss.y, specId, spec.damage || 1, 1);
    if (b) {
      await step(world, 50);
      const cur = (() => { const bm:any = (global as any).window.__bossManager; const bb = bm?.getActiveBoss?.() || bm?.getBoss?.(); return bb?.hp ?? before; })();
      hit = cur < before;
    }
  }
  if (!hit) {
    player.activeWeapons.clear();
    player.addWeapon(specId);
    const timeout = slowTickWeapons.has(specId) ? 9000 : 6000;
    await waitUntil(world, () => { const bm:any = (global as any).window.__bossManager; const bb = bm?.getActiveBoss?.() || bm?.getBoss?.(); return (bb?.hp ?? before) < before; }, timeout);
    const after = (() => { const bm:any = (global as any).window.__bossManager; const bb = bm?.getActiveBoss?.() || bm?.getBoss?.(); return bb?.hp ?? before; })();
    hit = after < before;
  }
  if (!hit) throw new Error(`Weapon ${spec.name || WeaponType[specId]} (${WeaponType[specId]}) failed to hit BOSS`);
}

async function assertHitTreasure(specId: WeaponType) {
  const spec: any = (WEAPON_SPECS as any)[specId];
  if (!spec || spec.disabled) return; // skip disabled
  const world = buildWorld();
  const { player, bulletMgr, enemyMgr } = world;
  const tx = player.x + 140, ty = player.y;
  spawnTreasureAt(world, tx, ty, 160);
  await waitUntil(world, () => { const emAny:any = enemyMgr as any; const ts = emAny.getTreasures?.() || []; return ts.length > 0 && ts[0].hp > 0; }, 2000);
  const tRef = (() => { const emAny:any = enemyMgr as any; const ts = emAny.getTreasures?.() || []; return ts[0]; })();
  const before = tRef.hp;

  let hit = false;
  if (!orbitOrZoneWeapons.has(specId)) {
    const b = bulletMgr.spawnBullet(tRef.x, tRef.y, tRef.x + 1, tRef.y, specId, spec.damage || 1, 1);
    if (b) {
      // Treasure collision happens inside enemyMgr.updateTreasures; ensure that runs first
      await step(world, 50);
      const cur = (() => { const emAny:any = enemyMgr as any; const ts = emAny.getTreasures?.() || []; return ts.length ? ts[0].hp : before; })();
      hit = cur < before;
    }
  }
  if (!hit) {
    // Fallback: enable weapon and wait for pulses/zone/contact to reduce HP
    player.activeWeapons.clear();
    player.addWeapon(specId);
    const timeout = slowTickWeapons.has(specId) ? 9000 : 6000;
    await waitUntil(world, () => { const emAny:any = enemyMgr as any; const ts = emAny.getTreasures?.() || []; const hp = ts.length ? ts[0].hp : before; return hp < before; }, timeout);
    const after = (() => { const emAny:any = enemyMgr as any; const ts = emAny.getTreasures?.() || []; return ts.length ? ts[0].hp : before; })();
    hit = after < before;
  }
  if (!hit) throw new Error(`Weapon ${spec.name || WeaponType[specId]} (${WeaponType[specId]}) failed to hit CHEST/TREASURE`);
}

describe('weapon collisions: every weapon hits enemy, boss, treasure', () => {
  const allWeaponIds: WeaponType[] = Object.values(WEAPON_SPECS).map((s: any) => s.id).filter((id: any) => typeof id === 'number');

  it('hits a normal enemy (registry-driven)', async () => {
    for (const wid of allWeaponIds) {
      const spec: any = (WEAPON_SPECS as any)[wid];
      if (!spec || spec.disabled) continue;
      await assertHitEnemy(wid as WeaponType);
    }
  }, 180000);

  it('hits the boss (registry-driven)', async () => {
    for (const wid of allWeaponIds) {
      const spec: any = (WEAPON_SPECS as any)[wid];
      if (!spec || spec.disabled) continue;
      await assertHitBoss(wid as WeaponType);
    }
  }, 180000);

  it('hits a chest/treasure (registry-driven)', async () => {
    for (const wid of allWeaponIds) {
      const spec: any = (WEAPON_SPECS as any)[wid];
      if (!spec || spec.disabled) continue;
      await assertHitTreasure(wid as WeaponType);
    }
  }, 180000);
});

describe('environment spawns: puddles and explosions (registry-driven)', () => {
  const allSpecs: any[] = Object.values(WEAPON_SPECS).filter((s: any) => s && typeof s.id === 'number');
  const poisonWeapons: WeaponType[] = allSpecs.filter(s => (s.traits || []).includes('Poison') && !s.disabled).map(s => s.id);
  const explosionWeapons = new Set<WeaponType>([WeaponType.MECH_MORTAR, WeaponType.SIEGE_HOWITZER, WeaponType.HOMING, WeaponType.SINGULARITY_SPEAR]);

  it('poison weapons spawn puddles that can corrode targets', async () => {
    for (const wid of poisonWeapons) {
      const spec: any = (WEAPON_SPECS as any)[wid];
      if (!spec || spec.disabled) continue;
      const world = buildWorld();
      const { player, enemyMgr } = world;
      // Place an enemy near the player to attract shots and puddles
      const ex = player.x + 120, ey = player.y;
      const enemy = spawnEnemyNear(world, ex, ey, 200, 14);
      await step(world, 50);
      const emAny: any = enemyMgr as any;
      const before = enemy.hp;
      player.activeWeapons.clear();
      player.addWeapon(wid);
      // Wait up to 9s for any active puddle to appear and affect the target/treasure
      const sawPuddle = await waitUntil(world, () => (emAny.poisonPuddles || []).some((p: any) => p && p.active), 9000, 100);
      expect(sawPuddle).toBe(true);
      // Either enemy took damage from poison or treasure corrosion works – spawn a treasure on top to ensure coverage
      spawnTreasureAt(world, ex + 10, ey, 160);
      await waitUntil(world, () => { const ts = emAny.getTreasures?.() || []; return ts.length > 0; }, 2000);
      const t0 = (() => { const ts = emAny.getTreasures?.() || []; return ts.length ? ts[ts.length-1].hp : 160; })();
      const gotEffect = await waitUntil(world, () => {
        const took = enemy.hp < before;
        const ts = emAny.getTreasures?.() || []; const thp = ts.length ? ts[ts.length-1].hp : t0;
        return took || thp < t0;
      }, 9000, 100);
      expect(gotEffect).toBe(true);
    }
  }, 120000);

  it('explosion weapons dispatch explosions and damage clustered enemies', async () => {
    const ids: WeaponType[] = allSpecs.map(s => s.id).filter((id: WeaponType) => explosionWeapons.has(id));
    for (const wid of ids) {
      const spec: any = (WEAPON_SPECS as any)[wid];
      if (!spec || spec.disabled) continue;
      const world = buildWorld();
      const { player, explosionEvents } = world;
      // Cluster 3 enemies where explosions will occur
      const cx = player.x + 140, cy = player.y;
      const e1 = spawnEnemyNear(world, cx, cy, 220, 16);
      const e2 = spawnEnemyNear(world, cx + 12, cy + 6, 220, 16);
      const e3 = spawnEnemyNear(world, cx - 10, cy - 8, 220, 16);
      await step(world, 50);
      const hp0 = e1.hp + e2.hp + e3.hp;
      player.activeWeapons.clear();
      player.addWeapon(wid);
      // Wait for an explosion event to be bridged
      const gotExplosion = await waitUntil(world, () => (explosionEvents.mortar + explosionEvents.drone + explosionEvents.enemyDeath) > 0, 9000, 100);
      expect(gotExplosion).toBe(true);
      // After explosion, total HP should drop
      const hpDrop = await waitUntil(world, () => (e1.hp + e2.hp + e3.hp) < hp0, 4000, 100);
      expect(hpDrop).toBe(true);
    }
  }, 120000);
});
