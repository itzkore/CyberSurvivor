import { describe, it, expect } from 'vitest';
import { EnemyManager } from '../src/game/EnemyManager';

// Minimal LS stubs
function stubLastStand(core:{x:number;y:number}, corridors?: Array<{x:number;y:number;w:number;h:number}>){
  const w:any = (global as any).window;
  w.__gameInstance = { gameMode: 'LAST_STAND', getEffectiveFowRadiusTiles: () => 4, fowTileSize: 160 };
  w.__lsCore = { x: core.x, y: core.y };
  w.__lsCorridors = corridors || [];
}

describe('Last Stand treasure immunity respects FoW', () => {
  it('treasure does not lose HP when outside LS visibility', () => {
    stubLastStand({ x: 0, y: 0 });
    const em:any = new (EnemyManager as any)({} as any, {} as any, {} as any, {} as any);
    // spawn treasure far outside core radius and no corridors
    (em as any).spawnTreasure?.(1200, 0, 200);
    const ts = (em as any).getTreasures?.() || (em.treasures || []);
    expect(ts.length).toBeGreaterThan(0);
    const t = ts[0];
    const before = t.hp;
    (em as any).damageTreasure(t, 50);
    expect(t.hp).toBe(before);
  });

  it('treasure can be damaged when inside a corridor', () => {
    stubLastStand({ x: 0, y: 0 }, [{ x: 1000, y: -100, w: 300, h: 200 }]);
    const em:any = new (EnemyManager as any)({} as any, {} as any, {} as any, {} as any);
    (em as any).spawnTreasure?.(1100, 0, 200);
    const ts = (em as any).getTreasures?.() || (em.treasures || []);
    expect(ts.length).toBeGreaterThan(0);
    const t = ts[0];
    const before = t.hp;
    (em as any).damageTreasure(t, 50);
    expect(t.hp).toBeLessThan(before);
  });
});
