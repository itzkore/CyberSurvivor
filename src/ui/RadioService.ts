import { SoundManager } from '../game/SoundManager';

export interface RadioTrack {
  title: string;
  src: string; // relative to public root (e.g., /assets/music/track.mp3)
}

type RadioListener = (state: {
  playing: boolean;
  index: number;
  track: RadioTrack | null;
  shuffle: boolean;
}) => void;

/**
 * RadioService: lightweight playlist controller over SoundManager.
 * - Supports play/pause, next/prev, shuffle.
 * - Dispatches 'radio:update' CustomEvent on window and notifies subscribers.
 */
export class RadioService {
  private playlist: RadioTrack[] = [];
  private index = 0;
  private playing = false;
  private shuffle = false;
  private listeners: RadioListener[] = [];
  private initialized = false;

  /** Provide default playlist using three provided tracks. */
  private buildDefaultPlaylist(): RadioTrack[] {
    const AL: any = (window as any).AssetLoader;
    const norm = (p: string) => (AL ? AL.normalizePath(p) : p);
    return [
  { title: 's1monbeatz — gucci flip flops', src: norm('/assets/music/s1monbeatz - gucci flip flops.mp3') },
  { title: 'itzKORE — Breakthrough', src: norm('/assets/music/itzKORE - Breakthrough.mp3') },
      { title: 'itzKORE — Obsidian', src: norm('/assets/music/itzKORE - Obsidian.mp3') },
      { title: 'sorchski — fih', src: norm('/assets/music/sorchski - fih.mp3') },
  { title: 'sorchski — yuzu tree', src: norm('/assets/music/sorchski - yuzu tree.mp3') },
  { title: 'itzKORE — spirit realm', src: norm('/assets/music/itzKORE - spirit realm.mp3') },
      { title: 'Prnold — Dubstep Fet', src: norm('/assets/music/Prnold - Dubstep Fet.mp3') },
    ];
  }

  /** Initialize radio with optional custom playlist. */
  init(playlist?: RadioTrack[]) {
    if (this.initialized) return;
    this.playlist = (playlist && playlist.length ? playlist : this.buildDefaultPlaylist()).slice();
    this.index = 0;
    this.playing = false;
    this.shuffle = false;
    this.initialized = true;
    // Mark radio present so main.ts can avoid auto music
    try { (window as any).__radioEnabled = true; } catch {}
    this.emit();
  }

  subscribe(l: RadioListener): () => void {
    this.listeners.push(l);
    // fire once
    l({ playing: this.playing, index: this.index, track: this.current(), shuffle: this.shuffle });
    return () => { const i = this.listeners.indexOf(l); if (i >= 0) this.listeners.splice(i, 1); };
  }

  private emit() {
    const payload = { playing: this.playing, index: this.index, track: this.current(), shuffle: this.shuffle };
    for (let i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](payload); } catch {}
    }
    try { window.dispatchEvent(new CustomEvent('radio:update', { detail: payload })); } catch {}
  }

  setShuffle(v: boolean) { this.shuffle = !!v; this.emit(); }
  toggleShuffle() { this.shuffle = !this.shuffle; this.emit(); }

  current(): RadioTrack | null { return this.playlist[this.index] || null; }

  play(index?: number) {
    if (typeof index === 'number') {
      this.index = (index % this.playlist.length + this.playlist.length) % this.playlist.length;
    }
    const t = this.current();
    if (!t) return;
    this.playing = true;
    SoundManager.playTrack(t.src, {
      loop: false,
      volume: 0.5,
      forceReload: true,
      onend: () => { this.onTrackEnd(); }
    });
    this.emit();
  }

  private onTrackEnd() {
    if (!this.playing) return; // paused/stopped mid-end
    if (this.shuffle) this.index = Math.floor(Math.random() * this.playlist.length);
    else this.index = (this.index + 1) % this.playlist.length;
    this.play(this.index);
  }

  pause() { SoundManager.pauseMusic(); this.playing = false; this.emit(); }
  resume() { if (!this.playing) { this.play(this.index); } }
  toggle() { if (this.playing) this.pause(); else this.resume(); }
  next() { this.index = this.shuffle ? Math.floor(Math.random() * this.playlist.length) : (this.index + 1) % this.playlist.length; this.play(this.index); }
  prev() { this.index = (this.index - 1 + this.playlist.length) % this.playlist.length; this.play(this.index); }

  isPlaying() { return this.playing; }
  getIndex() { return this.index; }
  getPlaylist() { return this.playlist.slice(); }
}

export const radioService = new RadioService();
