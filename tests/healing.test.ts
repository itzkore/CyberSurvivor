import { describe, it, expect, beforeEach } from 'vitest';
import { getHealEfficiency } from '../src/game/Balance';
import { Player } from '../src/game/Player';
import { EnemyManager, type Enemy } from '../src/game/EnemyManager';
import { SpatialGrid } from '../src/physics/SpatialGrid';
import { ParticleManager } from '../src/game/ParticleManager';
import { AssetLoader } from '../src/game/AssetLoader';
import { applyPassive } from '../src/game/PassiveConfig';

// Minimal window polyfills used in constructors
(global as any).window = Object.assign((global as any).window || {}, {
  addEventListener: () => {},
  dispatchEvent: () => {},
  __gameInstance: { getGameTime: () => 0 },
});
// Minimal document shim for any canvas or image creation invoked indirectly
(global as any).document = (global as any).document || {
  createElement: (tag: string) => {
    if (tag === 'canvas') {
      return { getContext: () => ({
        canvas: { width: 0, height: 0 },
        save: () => {}, restore: () => {}, beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
        createRadialGradient: () => ({ addColorStop: () => {} }), fillRect: () => {}, strokeRect: () => {},
        drawImage: () => {},
        font: '', textAlign: '', fillStyle: '', shadowColor: '', shadowBlur: 0, globalAlpha: 1,
      }), width: 0, height: 0 } as any;
    }
    if (tag === 'img' || tag === 'image') return {} as any;
    return {} as any;
  },
  getElementById: () => null,
};
// Global Image stub for Node test env (simulate async onload)
class ImageStub {
  onload?: () => void;
  onerror?: (e?: any) => void;
  set src(_v: string) {
    setTimeout(() => { try { this.onload && this.onload(); } catch (e) { this.onerror && this.onerror(e); } }, 0);
  }
}
(global as any).Image = ImageStub as any;
if ((global as any).window) (global as any).window.Image = (global as any).Image;

describe('heal efficiency curve', () => {
  it('is 1.0 at <=15m, reaches 0.01 at 30m, and clamps', () => {
    expect(getHealEfficiency(0)).toBeCloseTo(1.0, 6);
    expect(getHealEfficiency(15*60)).toBeCloseTo(1.0, 6);
    expect(getHealEfficiency(30*60)).toBeCloseTo(0.01, 6);
    expect(getHealEfficiency(60*60)).toBeCloseTo(0.01, 6);
  });
});

describe('regen + lifesteal with AoE', () => {
  let player: Player;
  let enemyMgr: EnemyManager;

  beforeEach(() => {
    const char = { stats: { speed: 10 } } as any;
    player = new Player(0, 0, char);
    const bulletGrid = new SpatialGrid<any>(100);
    const particles = new ParticleManager(0);
    const assets = new AssetLoader();
    enemyMgr = new EnemyManager(player, bulletGrid, particles, assets, 1);
    (player as any).setEnemyProvider(() => enemyMgr.getEnemies());
    (player as any).setGameContext({ getGameTime: () => 0 });
  });

  it('applies regen over time using efficiency', () => {
    applyPassive(player as any, 9, 4); // regen level 4 => 1.0 hp/s
    player.hp = 50; player.maxHp = 100;
    (global as any).window.__gameInstance.getGameTime = () => 0; // eff=1
    player.update(1000);
    expect(player.hp).toBeGreaterThanOrEqual(50.9);
    expect(player.hp).toBeLessThanOrEqual(51.1);
    (global as any).window.__gameInstance.getGameTime = () => 30*60; // eff=0.01
    const before = player.hp;
    player.update(1000);
    expect(player.hp - before).toBeGreaterThanOrEqual(0.009);
    expect(player.hp - before).toBeLessThanOrEqual(0.011);
  });

  it('lifesteal triggers on direct damage more than indirect AoE', () => {
    applyPassive(player as any, 15, 5); // lifesteal 0.5%
    // Insert a minimal dummy enemy directly into the manager for testing
    const e: Enemy = {
      id: 't1',
      type: 'small' as any,
      x: player.x + 10,
      y: player.y,
      vx: 0,
      vy: 0,
      hp: 1000,
      radius: 14,
      active: true,
      speed: 0,
      lastDamageTime: 0,
      knockbackTimer: 0,
      knockbackVx: 0,
      knockbackVy: 0,
    } as any;
    (enemyMgr as any).enemies.push(e);
  // Ensure headroom for healing
  player.maxHp = 100; player.hp = 50;
  const hp0 = player.hp;
    // Direct hit: pass a weapon type to mark direct; deal 1000 dmg
    enemyMgr.takeDamage(e as any, 1000, false, false, (1 as any));
    const healDirect = player.hp - hp0; // 1000 * 0.005 * eff(=1) = 5
    expect(healDirect).toBeGreaterThanOrEqual(4.9);
    expect(healDirect).toBeLessThanOrEqual(5.1);
  });
});
