import { describe, it, expect } from 'vitest';
import { runPowerFactor } from '../src/sim/PowerModel';

describe('Power Factor sanity', () => {
  it('has sane bounds at L7 15m (no runaway totals)', () => {
    const { results, config } = runPowerFactor({ level: 7, timeMinutes: 15 });
    // Basic shape checks
    expect(results.length).toBeGreaterThan(0);
    // Weights should sum to ~1
    const w = config.weights;
    const sumW = w.BOSS + w.ELITE + w.HORDE;
    expect(Math.abs(sumW - 1)).toBeLessThan(1e-6);

  const totals = results.map(r => r.totalPF);
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    // Upper bound to catch runaway AoE modeling; wide enough to avoid false positives
    expect(max).toBeLessThanOrEqual(900);
  // Lower bound just to ensure non-zero meaningful PF (relaxed to 180 to allow conservative damping)
  expect(min).toBeGreaterThan(180);
    // All PF must be finite numbers
    for (const r of results) {
      expect(Number.isFinite(r.totalPF)).toBe(true);
      expect(r.totalPF).toBeGreaterThan(0);
      for (const scen of ['BOSS', 'ELITE', 'HORDE'] as const) {
        const s = r.scenarios[scen];
        expect(Number.isFinite(s.PF)).toBe(true);
        expect(s.PF).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('Titan Mech and Neural Nomad stay within expected PF band', () => {
    const { results } = runPowerFactor({ level: 7, timeMinutes: 15 });
    const titan = results.find(r => r.operativeId === 'titan_mech');
    const nomad = results.find(r => r.operativeId === 'neural_nomad');
    expect(titan).toBeTruthy();
    expect(nomad).toBeTruthy();
    // Caps chosen slightly above current leaderboard to allow small future buffs
    expect(titan!.totalPF).toBeLessThanOrEqual(800);
    expect(nomad!.totalPF).toBeLessThanOrEqual(900);
  });
});
