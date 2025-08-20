import { googleAuthService } from './AuthService';

export interface HighScoreEntry {
  nickname: string;
  userId?: string; // hashed or raw google sub (local only)
  score: number;
  timeISO: string;
  mode: string;
  characterId: string;
  level: number;
  durationSec: number;
}

interface HighScoreStoreShape {
  entries: HighScoreEntry[];
  version: number;
}

/**
 * Local high score persistence (client-side only). Future: sync to backend.
 */
class HighScoreServiceImpl {
  private static LS_KEY = 'cybersurvivor.highscores.v1';
  private data: HighScoreStoreShape = { entries: [], version: 1 };
  private maxPerBucket = 25;

  constructor() { this.load(); }

  private load() {
    try {
      const raw = localStorage.getItem(HighScoreServiceImpl.LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.entries)) this.data = parsed;
      }
    } catch {/* ignore */}
  }
  private save() { try { localStorage.setItem(HighScoreServiceImpl.LS_KEY, JSON.stringify(this.data)); } catch {/* ignore */} }

  /** Record a score; returns true if it's a new high score for that bucket. */
  record(score: number, stats: { mode: string; characterId: string; level: number; durationSec: number }): boolean {
    const user = googleAuthService.getCurrentUser();
    const nickname = user?.nickname || 'Guest';
    const entry: HighScoreEntry = {
      nickname,
      userId: user?.id,
      score,
      timeISO: new Date().toISOString(),
      mode: stats.mode,
      characterId: stats.characterId,
      level: stats.level,
      durationSec: stats.durationSec
    };
    const bucket = this.getBucketKey(stats.mode, stats.characterId);
    const bucketEntries = this.data.entries.filter(e => this.getBucketKey(e.mode, e.characterId) === bucket);
    const userKey = (entry.userId || 'guest:' + entry.nickname);
    const existingForUser = bucketEntries.filter(e => (e.userId || 'guest:' + e.nickname) === userKey);

    // Determine if this is a new overall high for the bucket
    const wasHigh = bucketEntries.length === 0 || score > Math.max(...bucketEntries.map(e => e.score));

    // If user already has an equal or better score in bucket, skip adding duplicate
    if (existingForUser.length) {
      const bestExisting = Math.max(...existingForUser.map(e => e.score));
      if (score <= bestExisting) {
        return wasHigh; // nothing changes
      }
      // Remove all previous entries for this user in this bucket (we'll replace with better score)
      this.data.entries = this.data.entries.filter(e => !((e.userId || 'guest:' + e.nickname) === userKey && this.getBucketKey(e.mode, e.characterId) === bucket));
    }

    this.data.entries.push(entry);

    // Re-trim + ensure one entry per user per bucket (keep highest)
    const perBucket = this.data.entries.filter(e => this.getBucketKey(e.mode, e.characterId) === bucket)
      .sort((a,b)=> b.score - a.score);
    const seenUsers = new Set<string>();
    const dedup: HighScoreEntry[] = [];
    for (const e of perBucket) {
      const k = (e.userId || 'guest:' + e.nickname);
      if (seenUsers.has(k)) continue;
      seenUsers.add(k);
      dedup.push(e);
      if (dedup.length >= this.maxPerBucket) break;
    }
    // Keep other buckets + deduped bucket
    this.data.entries = this.data.entries.filter(e => this.getBucketKey(e.mode, e.characterId) !== bucket).concat(dedup);
    this.save();
    return wasHigh;
  }

  getTop(mode: string, characterId: string, limit = 10): HighScoreEntry[] {
    // Sorted highest first, dedup by user
    const bucket = this.getBucketKey(mode, characterId);
    const perBucket = this.data.entries
      .filter(e => this.getBucketKey(e.mode, e.characterId) === bucket)
      .sort((a,b)=> b.score - a.score);
    const seen = new Set<string>();
    const out: HighScoreEntry[] = [];
    for (const e of perBucket) {
      const k = (e.userId || 'guest:' + e.nickname);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  getRecent(limit=15): HighScoreEntry[] {
    return this.data.entries
      .slice()
      .sort((a,b)=> b.timeISO.localeCompare(a.timeISO))
      .slice(0, limit);
  }

  private getBucketKey(mode:string, characterId:string) { return mode + ':' + characterId; }
}

export const HighScoreService = new HighScoreServiceImpl();
