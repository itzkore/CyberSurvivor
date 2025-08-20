import { googleAuthService } from './AuthService';

export interface ScoreLogEntry {
  nickname: string;
  userId?: string;
  score: number;
  mode: string;
  characterId: string;
  level: number;
  durationSec: number;
  timeISO: string;
  source: 'remote' | 'local-fallback';
}

interface ScoreLogShape { entries: ScoreLogEntry[]; version: number; }

class ScoreLogServiceImpl {
  private static LS_KEY = 'cybersurvivor.scorelog.v1';
  private data: ScoreLogShape = { entries: [], version: 1 };
  private maxEntries = 500; // retain recent 500 submissions

  constructor() { this.load(); }

  private load() {
    try {
      const raw = localStorage.getItem(ScoreLogServiceImpl.LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) this.data = parsed;
      }
    } catch {/* ignore */}
  }
  private save() { try { localStorage.setItem(ScoreLogServiceImpl.LS_KEY, JSON.stringify(this.data)); } catch {/* ignore */} }

  log(entry: Omit<ScoreLogEntry,'nickname'|'userId'|'timeISO'> & { nickname?: string; userId?: string; source: 'remote'|'local-fallback' }) {
    const user = googleAuthService.getCurrentUser();
    const e: ScoreLogEntry = {
      nickname: entry.nickname || user?.nickname || 'Guest',
      userId: entry.userId || user?.id,
      score: entry.score,
      mode: entry.mode,
      characterId: entry.characterId,
      level: entry.level,
      durationSec: entry.durationSec,
      source: entry.source,
      timeISO: new Date().toISOString()
    };
    this.data.entries.push(e);
    if (this.data.entries.length > this.maxEntries) {
      this.data.entries.splice(0, this.data.entries.length - this.maxEntries);
    }
    this.save();
  }

  getRecent(limit=50): ScoreLogEntry[] {
    return this.data.entries.slice(-limit).reverse();
  }
}

export const ScoreLogService = new ScoreLogServiceImpl();
