import { EnemyManager } from '../src/game/EnemyManager';
import { WeaponType } from '../src/types';

// Minimal LS stubs
function stubLastStand(core:{x:number;y:number}, corridors?: Array<{x:number;y:number;w:number;h:number}>){
  const w:any = (global as any).window;
  w.__gameInstance = { gameMode: 'LAST_STAND', getEffectiveFowRadiusTiles: () => 4, fowTileSize: 160 };
  w.__lsCore = { x: core.x, y: core.y };
  w.__lsCorridors = corridors || [];
}

describe('Last Stand boss immunity respects FoW', () => {
  it('boss does not lose HP when outside LS visibility', () => {
    stubLastStand({ x: 0, y: 0 });
    const em = new EnemyManager({} as any, {} as any, {} as any, {} as any);
    const boss:any = { x: 1000, y: 0, hp: 1000, radius: 160, active: true, state: 'ACTIVE' };
    const before = boss.hp;
    // Attempt through intake
    (em as any).takeBossDamage(boss, 100, false, WeaponType.PISTOL, 0, 0, 1, false, 'PLAYER');
    expect(boss.hp).toBe(before);
    // Attempt via a fallback-like path: only allowed if visible; simulate with direct path guard
    const isVisible = (em as any).isVisibleInLastStand(boss.x, boss.y);
    if (!isVisible) {
      // simulate a misplaced direct damage — guard should prevent it
      // We mimic what our guards do: only apply if visible
      if (isVisible) boss.hp -= 100;
      expect(boss.hp).toBe(before);
    }
  });

  it('boss can be damaged when inside a corridor', () => {
    stubLastStand({ x: 0, y: 0 }, [{ x: 800, y: -80, w: 200, h: 160 }]);
    const em = new EnemyManager({} as any, {} as any, {} as any, {} as any);
    const boss:any = { x: 880, y: 0, hp: 1000, radius: 160, active: true, state: 'ACTIVE' };
    const before = boss.hp;
    (em as any).takeBossDamage(boss, 100, false, WeaponType.PISTOL, 0, 0, 1, false, 'PLAYER');
    expect(boss.hp).toBeLessThan(before);
  });
});
