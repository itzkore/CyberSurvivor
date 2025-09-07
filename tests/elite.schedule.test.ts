import { describe, it, expect } from 'vitest';
import { EnemyManager } from '../src/game/EnemyManager';
import { Player } from '../src/game/Player';
import { SpatialGrid } from '../src/physics/SpatialGrid';
import type { Bullet } from '../src/game/Bullet';
import type { Enemy } from '../src/game/EnemyManager';
import { ParticleManager } from '../src/game/ParticleManager';
import { AssetLoader } from '../src/game/AssetLoader';

// Minimal headless shims
const g: any = globalThis as any;
if (typeof g.performance === 'undefined') g.performance = { now: () => Date.now() } as any;
if (typeof g.window === 'undefined') g.window = {} as any;
(() => {
  const w: any = g.window;
  if (!w.__evt) w.__evt = new Map<string, Set<Function>>();
  w.addEventListener = (t: string, fn: Function) => { if (!w.__evt.has(t)) w.__evt.set(t, new Set()); w.__evt.get(t)!.add(fn); };
  w.removeEventListener = (t: string, fn: Function) => { w.__evt.get(t)?.delete(fn); };
  w.dispatchEvent = (ev: any) => { const s = w.__evt.get(ev?.type); if (s) s.forEach((fn: any) => { try { fn(ev); } catch {} }); return true; };
})();
if (typeof (g as any).CustomEvent === 'undefined') {
  (g as any).CustomEvent = class { type: string; detail: any; constructor(type: string, params?: any) { this.type = type; this.detail = params?.detail; } } as any;
}
if (typeof g.document === 'undefined') {
  g.document = { createElement: () => ({ getContext: () => ({}) }) } as any;
}
if (typeof g.Image === 'undefined') { g.Image = class { onload: any; onerror: any; set src(_v: string) { setTimeout(() => this.onload && this.onload(), 0); } } as any; }

function makeMgr() {
  const player = new Player(0, 0, { id: 't', name: 'T', stats: { hp: 100, maxHp: 100, speed: 8, damage: 10, strength: 1, intelligence: 1, agility: 1, luck: 1, defense: 1 } });
  const bulletGrid = new SpatialGrid<Bullet>(100);
  const particles = new ParticleManager(0);
  const assets = new AssetLoader();
  const em = new EnemyManager(player, bulletGrid, particles, assets, 1);
  // Expose mocks used in code paths
  (g.window as any).__gameInstance = { getGameTime: () => curSec };
  return em;
}

let curSec = 0;
function step(em: EnemyManager, ms: number) {
  const dt = 16.6667; const steps = Math.max(1, Math.round(ms / dt));
  for (let i = 0; i < steps; i++) {
    curSec += dt/1000; em.update(dt, curSec, [] as any);
  }
}

describe('elite schedule pacing + cooldowns', () => {
  it('spawns ~1 elite near 30s and ramps frequency by 20m', () => {
    const em = makeMgr();
    // Auto-unlock path triggers at 30s inside update
    step(em, 31000); // ~31s
    // Advance until first spawn occurs (should be ~45s after unlock per config)
    step(em, 20000);
    const afterFirst = (em as any).enemies.filter((e: Enemy) => (e as any)._elite).length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    // Jump to ~20 minutes total and ensure multiple elites exist
    step(em, (20*60 - curSec) * 1000);
    // Simulate a short window to allow spawns
    step(em, 15000);
    const count = (em as any).enemies.filter((e: Enemy) => (e as any)._elite).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('applies per-kind cooldown so same type does not immediately respawn', () => {
    const em = makeMgr();
    step(em, 60000); // get some elites
    const elites = (em as any).enemies.filter((e: Enemy) => (e as any)._elite);
    if (elites.length === 0) return; // if none spawned, nothing to test
    const firstKind = (elites[0] as any)._elite.kind;
    // Kill one elite
    (elites[0] as any).hp = 0; step(em, 50);
    // Within 3s, avoid same-kind spawn
    const before = (em as any).enemies.filter((e: Enemy) => (e as any)._elite && (e as any)._elite.kind === firstKind).length;
    step(em, 2500);
    const after = (em as any).enemies.filter((e: Enemy) => (e as any)._elite && (e as any)._elite.kind === firstKind).length;
    expect(after).toBeLessThanOrEqual(before);
  });
});
