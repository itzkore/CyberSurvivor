import { describe, it, expect } from 'vitest';
import { SPEED_SCALE } from '../src/game/Balance';
import { applyPassive } from '../src/game/PassiveConfig';
import { Player } from '../src/game/Player';

// Polyfill minimal window used in Player constructor
(global as any).window = { addEventListener: () => {} };

describe('Balance constants', () => {
  it('SPEED_SCALE within tuned band', () => {
    expect(SPEED_SCALE).toBeGreaterThan(0.3);
    expect(SPEED_SCALE).toBeLessThan(0.6);
  });
});

describe('Speed passive additive behavior', () => {
  it('adds +0.5 per level over innate base speed', () => {
    const character = { stats: { speed: 10 } };
    const p = new Player(0, 0, character);
    const innate = p.getBaseMoveSpeed();
    applyPassive(p as any, 0, 2); // level 2 => +1.0
    expect(p.speed).toBeCloseTo(innate + 1.0, 5);
  });

  it('preserves ordering between faster and slower base characters', () => {
    const fastChar = { stats: { speed: 16 } };
    const slowChar = { stats: { speed: 8 } };
    const fastP = new Player(0, 0, fastChar);
    const slowP = new Player(0, 0, slowChar);
    applyPassive(fastP as any, 0, 3); // +1.5
    applyPassive(slowP as any, 0, 3); // +1.5
    expect(fastP.speed).toBeGreaterThan(slowP.speed);
  });
});
