import { googleAuthService } from './AuthService';

export interface RunResultEntry {
  timeISO: string;
  mode: string;
  characterId: string;
  level: number;
  durationSec: number;
  score: number; // kill count baseline
  nickname: string;
  userId?: string;
}

/**
 * RunHistoryService bridges renderer to Electron preload to persist each completed run.
 * It also provides filtered aggregations for daily / monthly / all-time leaderboards
 * purely from local file (distinct from remote global leaderboard).
 */
class RunHistoryServiceImpl {
  private cache: RunResultEntry[] = [];
  private loaded = false;

  private async ensureLoaded() {
    if (this.loaded) return;
    const anyWindow: any = window as any;
    if (!anyWindow.cs?.getAllRuns) { this.loaded = true; this.cache = []; return; }
    try {
      const res = await anyWindow.cs.getAllRuns();
      if (res?.ok && Array.isArray(res.entries)) {
        this.cache = res.entries;
      }
    } catch {/* ignore */}
    this.loaded = true;
  }

  async append(result: Omit<RunResultEntry,'timeISO'|'nickname'|'userId'>) {
    const user = googleAuthService.getCurrentUser();
    const entry: RunResultEntry = {
      ...result,
      timeISO: new Date().toISOString(),
      nickname: user?.nickname || 'Guest',
      userId: user?.id
    };
    const anyWindow: any = window as any;
    if (anyWindow.cs?.appendGameResult) {
      try { await anyWindow.cs.appendGameResult(entry); } catch {/* ignore */}
    }
    // update local cache immediately
    this.cache.push(entry);
  }

  private filterByRange(start: Date, end: Date, mode: string, characterId: string) {
    return this.cache.filter(e => e.mode === mode && e.characterId === characterId && e.timeISO >= start.toISOString() && e.timeISO <= end.toISOString());
  }

  private bestScores(entries: RunResultEntry[], limit: number) {
    // per user best score
    const grouped = new Map<string, RunResultEntry>();
    for (const e of entries) {
      const key = e.userId || 'guest:' + e.nickname;
      const existing = grouped.get(key);
      if (!existing || e.score > existing.score) grouped.set(key, e);
    }
    return Array.from(grouped.values()).sort((a,b)=> b.score - a.score).slice(0, limit);
  }

  async getBoards(mode: string, characterId: string) {
    await this.ensureLoaded();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daily = this.bestScores(this.filterByRange(todayStart, now, mode, characterId), 5);
    const monthly = this.bestScores(this.filterByRange(monthStart, now, mode, characterId), 5);
    const allTime = this.bestScores(this.cache.filter(e => e.mode === mode && e.characterId === characterId), 5);
    return { daily, monthly, allTime };
  }
}

export const RunHistoryService = new RunHistoryServiceImpl();
