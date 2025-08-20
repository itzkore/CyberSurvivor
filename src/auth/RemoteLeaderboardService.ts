import { googleAuthService } from './AuthService';
import { HighScoreService, HighScoreEntry } from './HighScoreService';
import { ScoreLogService } from './ScoreLogService';

interface LeaderboardResponse { entries: HighScoreEntry[]; }

class RemoteLeaderboardServiceImpl {
  private base: string = '';
  private available = false;
  private cache: { [key:string]: HighScoreEntry[] } = {};
  private lastFetch: { [key:string]: number } = {};
  private ttlMs = 30000; // 30s
  private lastError: string | undefined;

  constructor() {
    // Priority 1: build-time env
    const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_API_BASE) ? import.meta.env.VITE_BACKEND_API_BASE : '';
    // Priority 2: runtime meta tag <meta name="backend-api-base" content="https://api.example.com">
    let metaBase = '';
    try {
      if (typeof document !== 'undefined') {
        const meta = document.querySelector('meta[name="backend-api-base"]') as HTMLMetaElement | null;
        metaBase = meta?.content || '';
      }
    } catch { metaBase = ''; }
    // Priority 3: global variable (can set early: window.__BACKEND_API_BASE = 'https://...')
    const winBase = (typeof window !== 'undefined' && (window as any).__BACKEND_API_BASE) || '';
    // Priority 4: query param ?apiBase=https://...
    let qpBase = '';
    try { if (typeof location !== 'undefined') qpBase = new URLSearchParams(location.search).get('apiBase') || ''; } catch { /* ignore */ }
    this.base = (qpBase || winBase || metaBase || envBase || '').replace(/\/$/, '');
    this.available = !!this.base;
    // Debug panel
    if (!document.getElementById('backend-debug-panel')) {
      const panel = document.createElement('div');
      panel.id = 'backend-debug-panel';
      panel.style.position = 'fixed';
      panel.style.bottom = '8px';
      panel.style.right = '8px';
      panel.style.background = 'rgba(0,0,0,0.85)';
      panel.style.color = '#0ff';
      panel.style.fontSize = '12px';
      panel.style.padding = '8px 14px';
      panel.style.borderRadius = '8px';
      panel.style.zIndex = '9999';
      panel.style.pointerEvents = 'auto';
      panel.innerHTML = `<b>Backend Config Debug</b><br>
        <b>apiBase (query):</b> ${qpBase || '<i>none</i>'}<br>
        <b>window.__BACKEND_API_BASE:</b> ${winBase || '<i>none</i>'}<br>
        <b>meta tag:</b> ${metaBase || '<i>none</i>'}<br>
        <b>VITE_BACKEND_API_BASE:</b> ${envBase || '<i>none</i>'}<br>
        <b>Selected:</b> ${this.base || '<span style="color:#f44">none</span>'}`;
      document.body.appendChild(panel);
    }
    if (!this.available) {
      console.warn('[Leaderboard] Remote backend base not configured. Checked sources: query param, window.__BACKEND_API_BASE, meta tag, VITE_BACKEND_API_BASE. Falling back to local only.');
    }
  }

  configure(base: string) {
    if (!base) return;
    this.base = base.replace(/\/$/, '');
    this.available = true;
    console.info('[Leaderboard] Remote backend configured at runtime:', this.base);
  }

  getBase() { return this.base; }
  getLastError() { return this.lastError; }

  isAvailable() { return this.available; }
  private bucket(mode:string, characterId:string) { return `${mode}:${characterId}`; }

  /** Force invalidate cached leaderboard for a given bucket so next getTop hits backend */
  invalidate(mode:string, characterId:string) {
    const key = this.bucket(mode, characterId);
    delete this.cache[key];
    delete this.lastFetch[key];
  }

  /**
   * Submit a score and log the run to the backend. Always POST to /scorelog for audit, even if not a new high score.
   * @param score Player's score
   * @param stats Run metadata (mode, characterId, level, durationSec)
   */
  async submit(score: number, stats: { mode:string; characterId:string; level:number; durationSec:number }) {
    if (!this.available) { HighScoreService.record(score, stats); ScoreLogService.log({ score, mode: stats.mode, characterId: stats.characterId, level: stats.level, durationSec: stats.durationSec, source: 'local-fallback' }); return; }
    const user = googleAuthService.getCurrentUser();
    await googleAuthService.ensureValidToken();
    const token = user?.idToken;
    // Preallocate log payload for micro-optimization
    const logPayload = {
      idToken: token,
      nickname: user?.nickname,
      userId: user?.id,
      score,
      mode: stats.mode,
      characterId: stats.characterId,
      level: stats.level,
      durationSec: stats.durationSec,
      timeISO: new Date().toISOString(),
      source: 'remote'
    };
    try {
      // Submit score for leaderboard
      // PHP API: submit score via POST to leaderboard.php
      const res = await fetch(this.base + '/api/leaderboard.php', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ score, nickname: user?.nickname, ...stats })
      });
      if (!res.ok) throw new Error('score submit failed');
      // PHP API returns {success:true} on submit, no leaderboard
      // Optionally, fetch updated leaderboard after submit
      const key = this.bucket(stats.mode, stats.characterId);
      const topRes = await fetch(this.base + '/api/leaderboard.php?mode=' + encodeURIComponent(stats.mode) + '&characterId=' + encodeURIComponent(stats.characterId) + '&limit=20');
      if (topRes.ok) {
        const body: LeaderboardResponse = await topRes.json().catch(()=>({ entries:[] }));
        if (body.entries?.length) { this.cache[key] = body.entries; this.lastFetch[key] = Date.now(); }
      }
      // Log locally for redundancy
      ScoreLogService.log({
        nickname: user?.nickname,
        userId: user?.id,
        score,
        mode: stats.mode,
        characterId: stats.characterId,
        level: stats.level,
        durationSec: stats.durationSec,
        source: 'remote'
      });
      // Also log locally for redundancy
      ScoreLogService.log({
        nickname: user?.nickname,
        userId: user?.id,
        score,
        mode: stats.mode,
        characterId: stats.characterId,
        level: stats.level,
        durationSec: stats.durationSec,
        source: 'remote'
      });
    } catch (e) {
      console.warn('[Leaderboard] remote submit failed, fallback local', e);
      this.lastError = (e as Error).message;
      HighScoreService.record(score, stats);
      // Log locally as fallback
      ScoreLogService.log({ score, mode: stats.mode, characterId: stats.characterId, level: stats.level, durationSec: stats.durationSec, source: 'local-fallback' });
    }
  }

  async getTop(mode:string, characterId:string, limit=10): Promise<HighScoreEntry[]> {
    const key = this.bucket(mode, characterId);
    if (!this.available) return HighScoreService.getTop(mode, characterId, limit);
    const now = Date.now();
    if (this.cache[key] && (now - (this.lastFetch[key]||0) < this.ttlMs)) return this.cache[key].slice(0, limit);
    try {
      await googleAuthService.ensureValidToken();
      const user = googleAuthService.getCurrentUser();
      const token = user?.idToken;
  let url = `${this.base}/api/leaderboard.php?mode=${encodeURIComponent(mode)}&characterId=${encodeURIComponent(characterId)}&limit=${limit}`;
  let res = await fetch(url);
  if (!res.ok) throw new Error('fetch failed');
  const body: LeaderboardResponse = await res.json().catch(()=>({ entries:[] }));
      // Deduplicate (some backends may return duplicate rows for same user/score)
      const seen = new Set<string>();
      const dedup: HighScoreEntry[] = [];
      (body.entries||[]).forEach(e => {
        if (!e) return;
        const k = (e.userId || e.nickname) + ':' + e.score;
        if (seen.has(k)) return;
        seen.add(k);
        dedup.push(e);
      });
      // Fallback: if character-specific returned nothing, try global (omit characterId)
      if (!dedup.length && characterId) {
        try {
          const globalUrl = `${this.base}/api/leaderboard.php?mode=${encodeURIComponent(mode)}&limit=${limit}`;
          const res2 = await fetch(globalUrl);
          if (res2.ok) {
            const body2: LeaderboardResponse = await res2.json().catch(()=>({ entries:[] }));
            (body2.entries||[]).forEach(e => {
              if (!e) return;
              const k = (e.userId || e.nickname) + ':' + e.score;
              if (seen.has(k)) return;
              seen.add(k);
              dedup.push(e);
            });
            if (dedup.length) console.info('[Leaderboard] Used global fallback (no per-character results).');
          }
        } catch {/* ignore fallback errors */}
      }
      this.cache[key] = dedup;
      this.lastFetch[key] = now;
      return this.cache[key].slice(0, limit);
    } catch (e) {
      console.warn('[Leaderboard] remote getTop failed, fallback local', e);
      this.lastError = (e as Error).message;
      return HighScoreService.getTop(mode, characterId, limit);
    }
  }
}

export const RemoteLeaderboardService = new RemoteLeaderboardServiceImpl();
