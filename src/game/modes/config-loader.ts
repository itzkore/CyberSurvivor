/**
 * Lightweight JSON loader for game data (normalizes paths via AssetLoader when available).
 */
import { AssetLoader } from '../../game/AssetLoader';

/** Normalize a public path using AssetLoader if present. */
function norm(path: string): string {
  try { return AssetLoader.normalizePath(path); } catch { return path; }
}

/** Load JSON data from a public URL.
 * Paths should be under '/data/...' so AssetLoader can apply basePrefix in production builds.
 */
export async function loadJSON<T = any>(path: string): Promise<T> {
  const url = norm(path);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load JSON: ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

/** Convenience: build Last Stand data file URLs. */
export const lastStandData = {
  waves: () => norm('/data/laststand/waves.json'),
  items: () => norm('/data/laststand/items.json'),
  turrets: () => norm('/data/laststand/turrets.json'),
  config: () => norm('/data/laststand/config.json'),
};
