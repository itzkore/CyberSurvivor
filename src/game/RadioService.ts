/**
 * RadioService
 * Lightweight playlist controller for menu/background music.
 * Uses SoundManager for playback.
 */
import { SoundManager } from './SoundManager';

export interface RadioTrack { title: string; src: string; }

export class RadioService {
  private playlist: RadioTrack[] = [];
  private idx = 0;
  private playing = false;
  private onChange?: (t: RadioTrack, playing: boolean) => void;

  setOnChange(cb: (t: RadioTrack, playing: boolean) => void) { this.onChange = cb; }
  setPlaylist(list: RadioTrack[], startIndex = 0) {
    this.playlist = list.slice();
    this.idx = Math.max(0, Math.min(startIndex, Math.max(0, this.playlist.length - 1)));
    this.emit();
  }
  getCurrent(): RadioTrack | null { return this.playlist[this.idx] || null; }
  isPlaying(): boolean { return this.playing && SoundManager.isPlaying(); }

  play(index?: number) {
    if (!this.playlist.length) return;
    if (typeof index === 'number') this.idx = (index % this.playlist.length + this.playlist.length) % this.playlist.length;
    const t = this.playlist[this.idx];
    const src = this.norm(t.src);
    SoundManager.playTrack(src, { loop: false, onend: () => this.nextRandom() });
    this.playing = true; this.emit();
  }
  pause() { SoundManager.pause(); this.playing = false; this.emit(); }
  toggle() { this.isPlaying() ? this.pause() : this.play(); }
  next() { if (!this.playlist.length) return; this.idx = (this.idx + 1) % this.playlist.length; this.play(); }
  prev() { if (!this.playlist.length) return; this.idx = (this.idx - 1 + this.playlist.length) % this.playlist.length; this.play(); }
  nextRandom() {
    if (!this.playlist.length) return;
    let n = this.idx;
    if (this.playlist.length > 1) {
      for (let i = 0; i < 6; i++) { const r = (Math.random() * this.playlist.length) | 0; if (r !== this.idx) { n = r; break; } }
    }
    this.idx = n; this.play();
  }
  setVolume(v: number) { SoundManager.setVolume(v); }

  private emit() { const t = this.getCurrent(); if (t && this.onChange) this.onChange(t, this.isPlaying()); }
  private norm(path: string): string {
    const AL: any = (window as any).AssetLoader;
    if (AL?.normalizePath) return AL.normalizePath(path);
    if (location.protocol === 'file:') return path.replace(/^\//, './');
    const parts = location.pathname.split('/').filter(Boolean);
    const base = parts.length ? '/' + parts[0] : '';
    return path.startsWith('/') ? base + path : path;
  }
}

export const radioService = new RadioService();
