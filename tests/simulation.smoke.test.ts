import { describe, it, expect } from 'vitest';
import { runBatch, summarize } from '../src/sim/BalanceSimulator';
// Import characters after simulator to ensure window/document/Image stubs exist
import { CHARACTERS } from '../src/data/characters';

describe('BalanceSimulator headless run', () => {
  it('runs a short batch and produces summary metrics', () => {
    const small = CHARACTERS.slice(0, Math.min(3, CHARACTERS.length));
    const results = runBatch(small, { durationSec: 2, seeds: [1] });
    expect(results.length).toBeGreaterThan(0);
    const summary = summarize(results);
    const ids = Object.keys(summary);
    expect(ids.length).toBe(small.length);
    // Print concise table for developer visibility in CI logs
    // eslint-disable-next-line no-console
    console.log('id,meanSurvival,meanKills,meanLevel');
    for (const id of ids) {
      const s = summary[id];
      // eslint-disable-next-line no-console
      console.log(`${id},${s.meanSurvival.toFixed(2)},${s.meanKills.toFixed(1)},${s.meanLevel.toFixed(1)}`);
    }
  }, 15000);
});
