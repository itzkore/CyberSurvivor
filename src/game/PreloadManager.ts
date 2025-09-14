import { AssetLoader } from './AssetLoader';
import { Logger } from '../core/Logger';

type ProgressFn = (p: number, label: string) => void;

export class PreloadManager {
  /** Preload all critical assets (images from manifest, bg music, radio tracks, and MP4 effects). */
  static async preloadAll(assetLoader: AssetLoader, onProgress?: ProgressFn) {
    const progress = (p: number, label: string) => { try { onProgress?.(Math.max(0, Math.min(1, p)), label); } catch {} };

    // 1) Manifest and images
    progress(0.02, 'Loading manifest');
    try { await assetLoader.loadManifest(); } catch (e) { Logger.warn('[Preload] Manifest load failed (continuing)', e as any); }

  progress(0.06, 'Preloading images');
  try { await assetLoader.loadAllFromManifest(); } catch (e) { Logger.warn('[Preload] Image preloads had issues', e as any); }
  // Warm explicit extras used across modes but not guaranteed in manifest
  try { await assetLoader.loadImage('/assets/core/core_1.png'); } catch {/* ignore */}

    // 2) Background music + radio tracks (optional but recommended)
    const AL: any = (window as any).AssetLoader;
    const norm = (p: string) => (AL ? AL.normalizePath(p) : p);
    const audioList = [
      // Use only tracks that are present in public/assets/music
      '/assets/music/s1monbeatz - gucci flip flops.mp3',
      '/assets/music/itzKORE - Breakthrough.mp3',
      '/assets/music/itzKORE - Obsidian.mp3',
      '/assets/music/sorchski - fih.mp3',
      '/assets/music/sorchski - yuzu tree.mp3',
      '/assets/music/itzKORE - spirit realm.mp3',
      '/assets/music/Prnold - Dubstep Fet.mp3'
    ].map(norm);

    if ((window as any).__preloadAudio !== false) {
      progress(0.16, 'Priming audio');
      await PreloadManager.preloadAudioBatch(audioList, (done, total) => {
        const base = 0.16, span = 0.20; // 16% -> 36%
        const frac = total ? done / total : 1;
        progress(base + span * frac, `Priming audio ${done}/${total}`);
      });
    }

    // 3) Effects video (Umbral Surge)
    progress(0.38, 'Priming effects');
    try { await PreloadManager.preloadVideoFirst([norm('/assets/ui/umbral_surge.mp4.mp4'), norm('/assets/ui/umbral_surge.mp4')]); } catch {/* ignore */}

    progress(0.92, 'Finalizing');
  }

  /** Preload a list of audio files using HTMLAudio to warm the cache (autoplay-safe). */
  private static preloadAudioBatch(urls: string[], onStep?: (done: number, total: number) => void) {
    const total = urls.length;
    let done = 0;
    const tick = () => { try { onStep?.(done, total); } catch {} };
    return new Promise<void>((resolve) => {
      if (total === 0) { resolve(); return; }
      const next = (i: number) => {
        if (i >= urls.length) { resolve(); return; }
        const src = urls[i];
        const a = new Audio();
        a.preload = 'auto';
        a.oncanplaythrough = a.onloadeddata = a.onloadedmetadata = () => { cleanup(); finish(); };
        a.onerror = () => { cleanup(); finish(); };
        const cleanup = () => { a.oncanplaythrough = a.onloadeddata = a.onloadedmetadata = a.onerror = null; };
        const finish = () => { done++; tick(); next(i + 1); };
        try { a.src = src; a.load(); } catch { finish(); }
      };
      tick();
      next(0);
    });
  }

  /** Resolve once the first playable variant is warmed (metadata loaded or canplay). */
  private static preloadVideoFirst(candidates: string[]): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!candidates.length) { resolve(); return; }
      const vid = document.createElement('video');
      (vid as any).playsInline = true; vid.muted = true; vid.preload = 'auto'; vid.crossOrigin = 'anonymous';
      let idx = 0; let settle = false;
      const tryNext = () => {
        if (settle) return;
        if (idx >= candidates.length) { resolve(); return; }
        const src = candidates[idx++];
        const onOk = () => { if (settle) return; settle = true; cleanup(); resolve(); };
        const onErr = () => { cleanup(); setTimeout(tryNext, 0); };
        const cleanup = () => {
          vid.removeEventListener('loadedmetadata', onOk);
          vid.removeEventListener('canplay', onOk);
          vid.removeEventListener('error', onErr);
        };
        vid.addEventListener('loadedmetadata', onOk, { once: true });
        vid.addEventListener('canplay', onOk, { once: true });
        vid.addEventListener('error', onErr, { once: true });
        try { vid.src = src; vid.load(); } catch { onErr(); }
        setTimeout(() => { if (!settle) onErr(); }, 2000);
      };
      tryNext();
    });
  }
}
