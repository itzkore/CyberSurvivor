// SoundManager.ts - Handles background music and sound effects
// Uses Howler.js for audio playback
import { Howl } from 'howler';
import { Logger } from '../core/Logger';

/**
 * Manages background music and sound effects for CyberSurvivor.
 * @group Audio
 */
export class SoundManager {
  private static bgMusic: Howl | null = null;
  // Track attempted src for cache busting / reloads
  private static currentSrc: string | null = null;

  /**
   * Loads and starts background music. Only plays if not already playing.
   * @param src Path to music file (e.g., 'assets/music/bg-music.mp3')
   */
  /**
   * Preload music without attempting to play (avoids autoplay policy block setting a bad state).
   */
  public static preloadMusic(src: string) {
    if (SoundManager.bgMusic) return;
    const relSrc = src.startsWith('/') ? src.slice(1) : src;
    SoundManager.currentSrc = relSrc;
    // Provide both root-absolute and relative variants to survive differing base paths
    const sources = [relSrc.startsWith('assets/') ? '/' + relSrc : relSrc, relSrc];
    SoundManager.bgMusic = new Howl({
      src: sources,
      loop: true,
      volume: 0.5,
      html5: true,
      preload: true,
      onloaderror: (id, err) => {
        Logger.error('Music preload error: ' + err);
      }
    });
    Logger.debug('[SoundManager] preloadMusic sources=', sources);
  }

  /**
   * Play (or resume) background music. Will retry if previous autoplay was blocked.
   * @param src path to music; if different from currently loaded, reloads.
   * @param forceReload set true to force Howl unload + recreate (e.g., replaced file with same name).
   */
  public static playMusic(src: string, forceReload: boolean = false) {
    const relSrc = src.startsWith('/') ? src.slice(1) : src;
    if (!SoundManager.bgMusic || forceReload || (SoundManager.currentSrc && SoundManager.currentSrc !== relSrc)) {
      if (SoundManager.bgMusic) {
        try { SoundManager.bgMusic.unload(); } catch { /* ignore */ }
      }
      SoundManager.currentSrc = relSrc;
      const versioned = relSrc + (forceReload ? ('?v=' + Date.now()) : '');
      const sources = [versioned.startsWith('assets/') ? '/' + versioned : versioned, versioned];
      SoundManager.bgMusic = new Howl({
        src: sources,
        loop: true,
        volume: 0.5,
        html5: true,
        onplay: () => Logger.debug('[SoundManager] Background music playing src=', sources),
        onplayerror: (id, err) => {
          Logger.warn('[SoundManager] Music play blocked/error (' + err + '). Retrying on next user gesture.');
          // Attach one-time user gesture listeners to retry
          const retry = () => {
            document.removeEventListener('pointerdown', retry);
            document.removeEventListener('keydown', retry);
            setTimeout(()=>{ try { SoundManager.bgMusic?.play(); } catch {/* ignore */} }, 50);
          };
          document.addEventListener('pointerdown', retry, { once: true });
          document.addEventListener('keydown', retry, { once: true });
        },
        onloaderror: (id, err) => Logger.error('[SoundManager] Music load error: ' + err)
      });
      Logger.debug('[SoundManager] playMusic sources=', sources, 'forceReload=', forceReload);
    }
    try { if (SoundManager.bgMusic && !SoundManager.bgMusic.playing()) SoundManager.bgMusic.play(); } catch { /* ignore */ }
  }

  /**
   * Stops background music playback.
   */
  public static stopMusic() {
    if (SoundManager.bgMusic && SoundManager.bgMusic.playing()) {
      try { SoundManager.bgMusic.stop(); } catch { /* ignore */ }
    }
  }

  /** Quick status for console debugging */
  public static debugStatus() {
    const sm: any = SoundManager.bgMusic;
    Logger.debug('[SoundManager] status', {
      loaded: !!sm && sm.state && sm.state(),
      playing: !!sm && sm.playing && sm.playing(),
      src: SoundManager.currentSrc,
      volume: !!sm && sm.volume && sm.volume()
    });
  }
}
