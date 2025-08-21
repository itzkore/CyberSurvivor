interface LeaderboardContext { mode:string; characterId:string; level?:number; durationSec?:number; userId?:string; nickname?:string; }
interface LeaderboardEntry { userId?:string; nickname:string; score:number; level?:number; durationSec?:number; self?:boolean; }

class RemoteLB {
  private base = '';
  private available = false;
  private lastError: string | null = null;
  private cache: Record<string, { ts:number; entries:LeaderboardEntry[] }> = {};
  private ttlMs = 10000;
  constructor() {
    const env = (import.meta as any).env?.VITE_BACKEND_API_BASE || (typeof window!=='undefined' && (window as any).__BACKEND_API_BASE) || '';
    if (env) { this.base = env.replace(/\/$/,''); this.available = true; }
  }
  getBase(){ return this.base; }
  isAvailable(){ return this.available; }
  getLastError(){ return this.lastError; }
  configure(b:string){ this.base = b.replace(/\/$/,''); this.available = true; }
  private bucket(mode:string,char:string){ return mode+':'+char; }
  async ensureBackend(){
    if (this.available) return true;
    try { const r = await fetch('/api/leaderboard/health'); if (r.ok) { this.base=''; this.available=true; return true; } } catch {}
    return this.available;
  }
  async submit(score:number, ctx:LeaderboardContext) {
    if (!(await this.ensureBackend())) return;
    try {
      await fetch(this.base+'/api/leaderboard/submit', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ userId:ctx.userId, nickname:ctx.nickname, score, mode:ctx.mode, characterId:ctx.characterId, level:ctx.level||0, durationSec:ctx.durationSec||0 }) });
      delete this.cache[this.bucket(ctx.mode, ctx.characterId)];
    } catch(e:any){ this.lastError = e?.message||'submit_failed'; }
  }
  async getTop(mode:string, characterId:string, limit=20) {
    const b = this.bucket(mode, characterId);
    const now = Date.now();
    const c = this.cache[b];
    if (c && (now - c.ts) < this.ttlMs) return c.entries.slice(0,limit);
    if (!(await this.ensureBackend())) return [];
    try {
      const r = await fetch(`${this.base}/api/leaderboard/top?mode=${encodeURIComponent(mode)}&characterId=${encodeURIComponent(characterId)}&limit=${limit}`);
      if (!r.ok) throw new Error('status '+r.status);
      const js = await r.json();
      const entries:LeaderboardEntry[] = (js.entries||[]);
      this.cache[b] = { ts: now, entries };
      return entries.slice(0,limit);
    } catch(e:any){ this.lastError = e?.message||'fetch_failed'; return []; }
  }
  async getAround(mode:string, characterId:string, userId:string, radius=2) {
    if (!(await this.ensureBackend())) return { rank:null, entries:[] };
    try {
      const r = await fetch(`${this.base}/api/leaderboard/around?mode=${encodeURIComponent(mode)}&characterId=${encodeURIComponent(characterId)}&userId=${encodeURIComponent(userId)}&radius=${radius}`);
      if (!r.ok) throw new Error('status '+r.status);
      return await r.json();
    } catch(e:any){ this.lastError = e?.message||'around_failed'; return { rank:null, entries:[] }; }
  }
  async getRank(mode:string, characterId:string, userId:string){
    if (!(await this.ensureBackend())) return null;
    try { const r = await fetch(`${this.base}/api/leaderboard/rank?mode=${mode}&characterId=${characterId}&userId=${encodeURIComponent(userId)}`); if(!r.ok) return null; const js=await r.json(); return js.rank||null; } catch { return null; }
  }
  invalidate(){ this.cache = {}; }
}

export const RemoteLeaderboardService = new RemoteLB();
