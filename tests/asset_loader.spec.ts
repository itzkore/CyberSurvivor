import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import lazily inside tests when we need the environment set
import type { AssetLoader as AssetLoaderType } from '../src/game/AssetLoader';

describe('AssetLoader.normalizePath', () => {
  let originalLocation: any;
  let AssetLoader: typeof AssetLoaderType;

  const reloadModule = async () => {
    // Re-import module fresh to avoid cached references if needed
    const mod = await import('../src/game/AssetLoader');
    AssetLoader = mod.AssetLoader as unknown as typeof AssetLoaderType;
  };

  beforeEach(async () => {
    originalLocation = (globalThis as any).location;
  });

  afterEach(() => {
    // Restore original location
    (globalThis as any).location = originalLocation;
    // Also clean document base effects are not needed here
  });

  it('normalizes http(s) paths: assets/ -> /assets/', async () => {
    (globalThis as any).location = { protocol: 'http:', pathname: '/' };
    await reloadModule();
    // Ensure no base prefix
    AssetLoader.basePrefix = '';

    expect(AssetLoader.normalizePath('assets/enemies/enemy_default.png'))
      .toBe('/assets/enemies/enemy_default.png');
    expect(AssetLoader.normalizePath('/assets/enemies/enemy_default.png'))
      .toBe('/assets/enemies/enemy_default.png');
    expect(AssetLoader.normalizePath('data/levels/laststand.json'))
      .toBe('/data/levels/laststand.json');
    expect(AssetLoader.normalizePath('/data/levels/laststand.json'))
      .toBe('/data/levels/laststand.json');
  });

  it('applies basePrefix for http(s) paths', async () => {
    (globalThis as any).location = { protocol: 'https:', pathname: '/cs/app/' };
    await reloadModule();
    AssetLoader.basePrefix = '/cs';

    expect(AssetLoader.normalizePath('assets/enemies/enemy_default.png'))
      .toBe('/cs/assets/enemies/enemy_default.png');
    expect(AssetLoader.normalizePath('/assets/enemies/enemy_default.png'))
      .toBe('/cs/assets/enemies/enemy_default.png');
    expect(AssetLoader.normalizePath('data/levels/laststand.json'))
      .toBe('/cs/data/levels/laststand.json');
    expect(AssetLoader.normalizePath('/data/levels/laststand.json'))
      .toBe('/cs/data/levels/laststand.json');
  });

  it('normalizes file:// paths to relative ./assets and ./data', async () => {
    (globalThis as any).location = { protocol: 'file:', pathname: 'C:/games/CyberSurvivor/index.html' };
    await reloadModule();
    // basePrefix is not used for file protocol
    AssetLoader.basePrefix = '.';

    expect(AssetLoader.normalizePath('assets/enemies/enemy_default.png'))
      .toBe('./assets/enemies/enemy_default.png');
    expect(AssetLoader.normalizePath('/assets/enemies/enemy_default.png'))
      .toBe('./assets/enemies/enemy_default.png');
    expect(AssetLoader.normalizePath('data/levels/laststand.json'))
      .toBe('./data/levels/laststand.json');
    expect(AssetLoader.normalizePath('/data/levels/laststand.json'))
      .toBe('./data/levels/laststand.json');
  });
});

describe('AssetLoader.getAsset', () => {
  let al: InstanceType<typeof AssetLoader>;
  let AssetLoader: any;
  let originalLocation: any;

  const reloadModule = async () => {
    const mod = await import('../src/game/AssetLoader');
    AssetLoader = mod.AssetLoader;
  };

  beforeEach(async () => {
    originalLocation = (globalThis as any).location;
    (globalThis as any).location = { protocol: 'http:', pathname: '/' };
    await reloadModule();
    // Reset discovered base prefix for deterministic tests
    AssetLoader.basePrefix = '';
    al = new AssetLoader();
  });

  afterEach(() => {
    (globalThis as any).location = originalLocation;
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
