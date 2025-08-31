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
  // Optional onend callback for radio/playlist behavior
  private static onEndCb: (() => void) | null = null;
  // Lightweight shared AudioContext for UI SFX (fallbacks to Howler.ctx when available)
  private static uiCtx: (AudioContext | null) = null;
  // Global music volume (0..1)
  private static musicVolume = 0.5;

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
  volume: SoundManager.musicVolume,
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
  volume: SoundManager.musicVolume,
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
        onend: () => { try { SoundManager.onEndCb?.(); } catch {/* ignore */} },
        onloaderror: (id, err) => Logger.error('[SoundManager] Music load error: ' + err)
      });
      Logger.debug('[SoundManager] playMusic sources=', sources, 'forceReload=', forceReload);
    }
    try { if (SoundManager.bgMusic && !SoundManager.bgMusic.playing()) SoundManager.bgMusic.play(); } catch { /* ignore */ }
  }

  /** Play an arbitrary track with optional loop/volume and end callback (used by RadioService). */
  public static playTrack(src: string, opts?: { loop?: boolean; volume?: number; forceReload?: boolean; onend?: ()=>void }) {
    const relSrc = src.startsWith('/') ? src.slice(1) : src;
  const loop = opts?.loop ?? true;
  const volume = Math.max(0, Math.min(1, opts?.volume ?? SoundManager.musicVolume));
    const forceReload = !!opts?.forceReload;
    SoundManager.onEndCb = opts?.onend || null;
    if (!SoundManager.bgMusic || forceReload || (SoundManager.currentSrc && SoundManager.currentSrc !== relSrc) || (SoundManager.bgMusic && SoundManager.bgMusic.loop() !== loop)) {
      if (SoundManager.bgMusic) { try { SoundManager.bgMusic.unload(); } catch { /* ignore */ } }
      SoundManager.currentSrc = relSrc;
      const versioned = relSrc + (forceReload ? ('?v=' + Date.now()) : '');
      const sources = [versioned.startsWith('assets/') ? '/' + versioned : versioned, versioned];
  SoundManager.bgMusic = new Howl({
        src: sources,
        loop,
        volume,
        html5: true,
        onend: () => { try { SoundManager.onEndCb?.(); } catch {/* ignore */} },
        onplayerror: () => {
          const retry = () => {
            document.removeEventListener('pointerdown', retry);
            document.removeEventListener('keydown', retry);
            setTimeout(()=>{ try { SoundManager.bgMusic?.play(); } catch {/* ignore */} }, 50);
          };
          document.addEventListener('pointerdown', retry, { once: true });
          document.addEventListener('keydown', retry, { once: true });
        },
        onloaderror: (id, err) => Logger.error('[SoundManager] Track load error: ' + err)
      });
    } else {
      try { SoundManager.bgMusic.volume(volume); } catch { /* ignore */ }
    }
    try { if (SoundManager.bgMusic && !SoundManager.bgMusic.playing()) SoundManager.bgMusic.play(); } catch { /* ignore */ }
  }

  /** Pause current music if playing */
  public static pause() {
    try { if (SoundManager.bgMusic && SoundManager.bgMusic.playing()) SoundManager.bgMusic.pause(); } catch { /* ignore */ }
  }

  /** Resume current music if paused */
  public static resume() {
    try { if (SoundManager.bgMusic && !SoundManager.bgMusic.playing()) SoundManager.bgMusic.play(); } catch { /* ignore */ }
  }

  /** Toggle play/pause */
  public static togglePlay() {
    try {
      if (!SoundManager.bgMusic) return;
      if (SoundManager.bgMusic.playing()) SoundManager.bgMusic.pause(); else SoundManager.bgMusic.play();
    } catch { /* ignore */ }
  }

  /** Returns true if any bg music is currently playing */
  public static isPlaying(): boolean {
    try { return !!SoundManager.bgMusic && SoundManager.bgMusic.playing(); } catch { return false; }
  }

  /** Set bg music volume (0..1) */
  public static setVolume(v: number) {
    const vol = Math.max(0, Math.min(1, v));
    SoundManager.musicVolume = vol;
    try { if (SoundManager.bgMusic) SoundManager.bgMusic.volume(vol); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('volumechange', { detail: vol })); } catch { /* ignore */ }
  }

  /** Get current global music volume (0..1) */
  public static getVolume(): number { return SoundManager.musicVolume; }

  /**
   * Stops background music playback.
   */
  public static stopMusic() {
    if (SoundManager.bgMusic && SoundManager.bgMusic.playing()) {
      try { SoundManager.bgMusic.stop(); } catch { /* ignore */ }
    }
  }

  // Back-compat wrappers used in UI/services
  public static pauseMusic() { SoundManager.pause(); }
  public static resumeMusic() { SoundManager.resume(); }

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

  /** Plays a subtle UI click/glitch blip without requiring an audio asset. */
  public static playUiClick(opts?: { volume?: number; durationMs?: number; freq?: number }) {
    try {
      const volume = Math.max(0, Math.min(1, opts?.volume ?? 0.18));
      const durationMs = Math.max(20, Math.min(300, opts?.durationMs ?? 110));
      const freq = Math.max(120, Math.min(4000, opts?.freq ?? 1400));
      // Prefer Howler's context if available, else keep our own
      const anyHowler: any = (Howl as any);
      const ctx: AudioContext = (anyHowler?._howler?._audioCtx) || (anyHowler?._audioCtx) || (Howl as any)?._audioCtx || (SoundManager.uiCtx ||= (new (window.AudioContext || (window as any).webkitAudioContext)()));
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      // Gentle quick envelope to avoid pop
      const g = gain.gain;
      g.setValueAtTime(0.0001, now);
      g.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + 0.01);
      // Tiny downward pitch glide for a satisfying blip
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.6), now + durationMs / 1000 * 0.8);
      // Fast release
      g.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + durationMs / 1000 + 0.01);
    } catch (e) {
      // Non-fatal; UI sfx is optional
      Logger.debug('[SoundManager] playUiClick error/suppressed:', e as any);
    }
  }
}
