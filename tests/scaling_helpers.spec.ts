import { describe, it, expect } from 'vitest';
import { getDamageMul, getAreaMul, scaleDamage, scaleRadius } from '../src/game/scaling';

describe('scaling helpers', () => {
  it('uses player methods when available', () => {
    const player = {
      getGlobalDamageMultiplier: () => 1.5,
      getGlobalAreaMultiplier: () => 1.2,
      globalDamageMultiplier: 0, // should be ignored when method exists
      globalAreaMultiplier: 0,
    } as any;
    expect(getDamageMul(player)).toBe(1.5);
    expect(getAreaMul(player)).toBe(1.2);
    expect(scaleDamage(100, player)).toBe(150);
    expect(scaleRadius(100, player)).toBe(120);
  });

  it('falls back to player properties when methods are missing', () => {
    const player = { globalDamageMultiplier: 1.3, globalAreaMultiplier: 1.4 } as any;
    expect(getDamageMul(player)).toBe(1.3);
    expect(getAreaMul(player)).toBe(1.4);
    expect(scaleDamage(100, player)).toBe(130);
    expect(scaleRadius(100, player)).toBe(140);
  });

  it('returns 1 for multipliers when player missing or invalid', () => {
    expect(getDamageMul(undefined as any)).toBe(1);
    expect(getAreaMul(null as any)).toBe(1);
  });

  it('rounds results and enforces non-negative outputs', () => {
    const player = { getGlobalDamageMultiplier: () => 1.2345, getGlobalAreaMultiplier: () => 0.5 } as any;
    expect(scaleDamage(101, player)).toBe(Math.round(101 * 1.2345));
    expect(scaleRadius(101, player)).toBe(Math.round(101 * 0.5));
    expect(scaleDamage(-10, player)).toBe(0);
    expect(scaleRadius(-10, player)).toBe(0);
  });
});
