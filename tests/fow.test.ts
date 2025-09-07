import { describe, it, expect } from 'vitest';
import { FogOfWarSystem, FowTileState } from '../src/systems/FogOfWarSystem';

describe('FogOfWarSystem', () => {
  it('marks visible around player and keeps explored after moving out of radius', () => {
    const fow = new FogOfWarSystem();
    fow.setGrid(undefined as any, undefined as any, 100); // tile size irrelevant for logic here

    const px = 10, py = 10, r = 2; // radius in tiles
    fow.compute(px, py, r);

    // Center must be visible
    expect(fow.getTileState(px, py)).toBe(FowTileState.Visible);
    // A border tile within radius should be visible
    expect(fow.getTileState(px + 2, py)).toBe(FowTileState.Visible);

  // Move beyond radius so previous center exits the visible circle
  fow.compute(px + r + 1, py, r);

    // New center visible
    expect(fow.getTileState(px + 1, py)).toBe(FowTileState.Visible);
  // Previous center should have downgraded to explored (no longer within visible radius)
    expect(fow.getTileState(px, py)).toBe(FowTileState.Explored);
  });
});
