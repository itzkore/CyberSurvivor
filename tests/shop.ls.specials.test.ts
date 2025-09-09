import { describe, it, expect, beforeEach } from 'vitest';
import { ShopManager } from '../src/game/modes/shop-manager';

describe('Last Stand shop specials', () => {
  beforeEach(() => {
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.__gameInstance = {
      gameMode: 'LAST_STAND',
      lastStand: {
        getTowerPlusNextCost: () => 150,
        getGateNextCost: () => 250,
      },
    };
  });

  it('includes both Tower+ and Gate when eligible', () => {
    const shop = new ShopManager();
    // Do not call load(); we want a minimal pool so only LS injections appear deterministically
    const offers = shop.rollOffers(6, 12345);
    const ids = offers.map(o => o.id);
    expect(ids).toContain('ls_tower_plus');
    expect(ids).toContain('ls_gate');
  });
});
