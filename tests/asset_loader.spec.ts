import { describe, it, expect, beforeEach } from 'vitest';
import { AssetLoader } from '../src/game/AssetLoader';

describe('AssetLoader.getAsset', () => {
  let al: AssetLoader;

  beforeEach(() => {
    al = new AssetLoader();
    // Reset discovered base prefix for deterministic tests
    (AssetLoader as any).basePrefix = '';
  });

  it('resolves dotted keys like enemies.default from manifest', () => {
    const manifest = {
      enemies: {
        default: { file: '/assets/enemies/enemy_default.png' },
      },
    } as any;
    (al as any).manifest = manifest;
    const path = al.getAsset('enemies.default');
    expect(path).toBe('/assets/enemies/enemy_default.png');
  });

  it('falls back to recursive key search when dotted path not used', () => {
    const manifest = {
      boss: {
        phase1: { file: '/assets/boss/boss_phase1.png' },
      },
    } as any;
    (al as any).manifest = manifest;
    const path = al.getAsset('phase1');
    expect(path).toBe('/assets/boss/boss_phase1.png');
  });
});
