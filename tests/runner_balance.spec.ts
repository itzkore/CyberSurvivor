import { describe, it, expect } from 'vitest';
import { WEAPON_SPECS } from '../src/game/WeaponConfig';
import { WeaponType } from '../src/game/WeaponType';
import { runPowerFactor } from '../src/sim/PowerModel';

describe('Runner balance sanity', () => {
  it('Runner Gun L7 stats are as expected (damage 32, cd 4, salvo 2)', () => {
    const spec: any = WEAPON_SPECS[WeaponType.RUNNER_GUN];
    const s = spec.getLevelStats ? spec.getLevelStats(7) : {};
    expect(s.damage).toBe(32);
    expect(s.cooldown).toBe(4);
    expect(s.salvo).toBe(2);
  });

  it('Cyber Runner PF is within the nerfed target band at L7 (BOSS ST < 1000, totalPF < 720)', () => {
    const out = runPowerFactor({ level: 7, timeMinutes: 15 });
    const runner = out.results.find(r => r.operativeId === 'cyber_runner');
    expect(runner).toBeTruthy();
    if (!runner) return; // type narrowing for TS; test would have failed above
    // BOSS ST should be below previous ~1254 baseline; sanity cap 1000
    expect(runner.scenarios.BOSS.ST).toBeLessThan(1000);
    // Keep total PF under a soft cap to avoid dominating the board
    expect(runner.totalPF).toBeLessThan(720);
  });
});
