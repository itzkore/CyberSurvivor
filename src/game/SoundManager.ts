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
  private static isPlaying: boolean = false;

  /**
   * Loads and starts background music. Only plays if not already playing.
   * @param src Path to music file (e.g., 'assets/music/bg-music.mp3')
   */
  public static playMusic(src: string) {
    if (SoundManager.bgMusic && SoundManager.isPlaying) return;
    if (!SoundManager.bgMusic) {
      // Use relative path for compatibility
      const relSrc = src.startsWith('/') ? src.slice(1) : src;
      SoundManager.bgMusic = new Howl({
        src: [relSrc],
        loop: true,
        volume: 0.5,
        html5: true,
        onplay: () => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('debugLog', { detail: 'Background music started.' }));
          }
        },
        onloaderror: (id, err) => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('debugLog', { detail: 'Music load error: ' + err }));
          }
        }
      });
    }
    try {
      SoundManager.bgMusic.play();
      SoundManager.isPlaying = true;
    } catch (e) {
    }
  }

  /**
   * Stops background music playback.
   */
  public static stopMusic() {
    if (SoundManager.bgMusic && SoundManager.isPlaying) {
      SoundManager.bgMusic.stop();
      SoundManager.isPlaying = false;
    }
  }
}
