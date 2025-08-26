// src/leaderboard.ts
export type LeaderEntry = { rank: number; playerId: string; name: string; timeSec: number; kills?: number; level?: number; maxDps?: number; characterId?: string };

// Allow optional late injection via window.__UPSTASH__ (useful in Electron preload or tests)
declare global { interface Window { __UPSTASH__?: { url?: string; token?: string }; } }

function currentConfig() {
  const url = (typeof window !== 'undefined' && window.__UPSTASH__?.url) || import.meta.env.VITE_UPSTASH_REDIS_REST_URL as string | undefined;
  const token = (typeof window !== 'undefined' && window.__UPSTASH__?.token) || import.meta.env.VITE_UPSTASH_REDIS_REST_TOKEN as string | undefined;
  return { url, token };
}

export function isLeaderboardConfigured(): boolean {
  const { url, token } = currentConfig();
  return !!(url && token);
}

let warnedOnce = false;

function requireConfig(): { url: string; token: string } {
  const { url, token } = currentConfig();
  if (!url || !token) {
    if (!warnedOnce) {
      console.warn('[Leaderboard] Missing VITE_UPSTASH_REDIS_* env vars (or window.__UPSTASH__ override). Leaderboard disabled until provided.');
      warnedOnce = true;
    }
    throw new Error('LEADERBOARD_CONFIG_MISSING');
  }
  return { url, token };
}

// --- Instrumentation / debug overlay support ---
interface CmdStats { count: number; totalMs: number; lastMs: number; errors: number; }
const metrics: { [cmd: string]: CmdStats } = Object.create(null);
let totalCalls = 0;
let totalErrors = 0;
let lastErrorMsg = '';
let overlayEl: HTMLDivElement | null = null;
let overlayTimer: number | null = null;

// Verbose logging (disabled by default). Enable via ?lblogs=1 or localStorage lb_logs=1
const LB_LOG_ENABLED = (() => {
  try {
    if (typeof window === 'undefined') return false;
    if (/[?&]lblogs=1/.test(location.search)) return true;
    if (localStorage.getItem('lb_logs') === '1') return true;
  } catch {}
  return false;
})();
function lbLog(...args: any[]) { if (LB_LOG_ENABLED) { try { console.info('[LB]', ...args); } catch {} } }

// --- Lightweight client-side cache & backoff ---
interface TopCacheKey { board: string; limit: number; offset: number; }
interface TopCacheEntry { key: TopCacheKey; data: LeaderEntry[]; ts: number; }
let lastTopCache: TopCacheEntry | null = null;
let lastTopErrorAt = 0;
// Cache TTL (ms)
const TOP_CACHE_TTL = 4000; // within 4s repeated calls reuse
const ERROR_BACKOFF_MS = 5000; // after error wait before hammering


/** Manually invalidate local caches and snapshots (used after nickname rewrite). */
export function invalidateLeaderboardCache(): void {
  lastTopCache = null;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('lb_snapshot_')) keys.push(k);
    }
    for (let i = 0; i < keys.length; i++) localStorage.removeItem(keys[i]);
  } catch {/* ignore */}
}

function record(cmd: string, ms: number, err?: any) {
  totalCalls++;
  const stat = metrics[cmd] || (metrics[cmd] = { count: 0, totalMs: 0, lastMs: 0, errors: 0 });
  stat.count++; stat.totalMs += ms; stat.lastMs = ms; if (err) { stat.errors++; totalErrors++; lastErrorMsg = (err && err.message) || String(err); }
}

function formatMetrics(): string {
  const lines: string[] = [];
  lines.push('LEADERBOARD API (F9)');
  lines.push(`calls:${totalCalls} errors:${totalErrors}`);
  const keys = Object.keys(metrics).sort();
  for (let i=0;i<keys.length;i++) {
    const k = keys[i]; const m = metrics[k];
    const avg = m.totalMs / m.count;
    lines.push(`${k} c=${m.count} avg=${avg.toFixed(1)}ms last=${m.lastMs.toFixed(1)}${m.errors? ' !'+m.errors:''}`);
    if (i>14) { lines.push('…'); break; }
  }
  if (lastErrorMsg) lines.push('lastErr: '+lastErrorMsg.slice(0,50));
  return lines.join('\n');
}

export function enableLeaderboardDebugOverlay() {
  if (overlayEl) return;
  overlayEl = document.createElement('div');
  overlayEl.id = 'lb-debug-overlay';
  overlayEl.style.cssText = [
    'position:fixed','top:4px','right:4px','background:rgba(0,0,0,0.55)','font:11px/13px monospace',
    'padding:4px 6px','color:#0ff','z-index:9999','border:1px solid #033','border-radius:4px','white-space:pre','max-width:260px'
  ].join(';');
  overlayEl.textContent = 'Leaderboard debug…';
  document.body.appendChild(overlayEl);
  const tick = () => { if (!overlayEl) return; overlayEl.textContent = formatMetrics(); overlayTimer = window.setTimeout(tick, 1000); };
  tick();
  window.addEventListener('keydown', (e)=>{ if (e.key==='F9') { if (!overlayEl) return; const v = overlayEl.style.display !== 'none'; overlayEl.style.display = v? 'none':'block'; } });
}

// Auto-enable via query param ?lbdebug=1
if (typeof window !== 'undefined' && /[?&]lbdebug=1/.test(location.search)) {
  window.addEventListener('load', ()=>{ try { enableLeaderboardDebugOverlay(); } catch {} });
}

// expose metrics for external inspection
if (typeof window !== 'undefined') { (window as any).__leaderboardMetrics = { metrics, enableLeaderboardDebugOverlay }; }

// Obecný REST helper pro Upstash (command-path styl)
async function redis(cmd: string[], body?: string): Promise<any> {
  const start = performance.now();
  let primary = 'UNKNOWN';
  try {
    primary = cmd[0] || 'UNKNOWN';
    const { url: base, token } = requireConfig();
    const url = `${base}/${cmd.map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body
    });

  // 429 = rate limit – zobrazíme varování a vyhodíme error
    if (res.status === 429) {
      console.warn('Rate limited by Upstash');
    }

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json ? JSON.stringify(json) : `HTTP ${res.status}`);
      record(primary, performance.now()-start, err);
      throw err;
    }
    record(primary, performance.now()-start);
    return json.result;
  } catch (e) {
    if ((e as any)?.message === 'LEADERBOARD_CONFIG_MISSING') {
      record(primary, performance.now()-start, e);
    } else if (!(e instanceof Error)) {
      record(primary, performance.now()-start, new Error('Unknown error'));
    }
    throw e;
  }
}

function boardKey(board: string) {
  if (!board || board === 'global') return 'lb:global';
  if (board.startsWith('daily:')) return `lb:daily:${board.split(':')[1]}`;
  if (board.startsWith('weekly:')) return `lb:weekly:${board.split(':')[1]}`;
  if (board.startsWith('monthly:')) return `lb:monthly:${board.split(':')[1]}`;
  return `lb:${board}`;
}

/** Rewrite the displayed nickname for a player across all boards by updating the global name hash. */
/** Check if a nickname is available (or already owned by the given player). */
export async function isNicknameAvailable(newNickname: string, playerId?: string): Promise<boolean> {
  if (!isLeaderboardConfigured()) return true;
  const name = sanitizeName(newNickname || '');
  if (!name) return false;
  const lower = name.toLowerCase();
  try {
    const owner = await redis(['HGET', 'name:index', lower]).catch(()=>null);
    if (!owner) return true;
    if (playerId && owner === playerId) return true;
    return false;
  } catch {
    return true; // be permissive on check errors
  }
}

/** Atomically claim a nickname for a player, updating indices and previous mapping. Returns true on success. */
export async function claimNickname(playerId: string, newNickname: string): Promise<boolean> {
  if (!isLeaderboardConfigured()) return true; // allow in offline/misconfig mode
  const name = sanitizeName(newNickname || '');
  if (!name) return false;
  const lower = name.toLowerCase();
  // Fetch previous name for cleanup
  let prevLower: string | undefined;
  try {
    const prev = await redis(['HGET', `name:${playerId}`, 'name']).catch(()=>null);
    if (prev) prevLower = String(prev).toLowerCase();
  } catch {/* ignore */}
  // Try to reserve via HSETNX; if exists and owned by me, allow; if owned by different user, fail
  try {
    const setnx = await redis(['HSETNX', 'name:index', lower, playerId]).catch(()=>0);
    if (setnx === 0) {
      const owner = await redis(['HGET', 'name:index', lower]).catch(()=>null);
      if (owner && owner !== playerId) return false; // taken by someone else
    }
    // Persist pretty name for this player
    await redis(['HSET', `name:${playerId}`, 'name', name]).catch(()=>{});
    // Clean up old index mapping if different
    if (prevLower && prevLower !== lower) {
      await redis(['HDEL', 'name:index', prevLower]).catch(()=>{});
    }
    invalidateLeaderboardCache();
    return true;
  } catch {
    return false;
  }
}

/** Back-compat wrapper to set nickname without availability checks (now routes through claimNickname). */
export async function rewriteNickname(playerId: string, newNickname: string): Promise<void> {
  await claimNickname(playerId, newNickname).catch(()=>{});
}

// Sanitizace zobrazovaného jména – krátké, bez HTML
export function sanitizeName(name: string) {
  return (name ?? '')
    .toString()
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
}

// Stabilní playerId (localStorage), aby si hráč držel pozici
// Player identity is provided exclusively by Google account (AuthService); no local fallback id.

// Vypočti název boardu dle volby "daily:auto" / "weekly:auto"
export function resolveBoard(input: string): { board: string; ttlSeconds?: number } {
  if (input === 'daily:auto') {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // TTL na 3 dny (zbytkové pro jistotu)
    return { board: `daily:${today}`, ttlSeconds: 3 * 24 * 60 * 60 };
  }
  if (input === 'weekly:auto') {
    const now = new Date();
    const year = now.getUTCFullYear();
    const week = isoWeek(now);
    return { board: `weekly:${year}-W${String(week).padStart(2,'0')}`, ttlSeconds: 8 * 24 * 60 * 60 };
  }
  if (input === 'monthly:auto') {
    const now = new Date();
    const ym = now.toISOString().slice(0,7); // YYYY-MM
    // TTL ~ 40 dní (měsíční + rezerva)
    return { board: `monthly:${ym}`, ttlSeconds: 40 * 24 * 60 * 60 };
  }
  return { board: input || 'global' };
}

// ISO týden v roce
function isoWeek(d: Date): number {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Zápis skóre (bere jen vyšší – ZADD GT). Jméno ukládáme zvlášť (hash).
export async function submitScore(opts: {
  board?: string;
  playerId: string;
  name: string;
  timeSec: number;
  kills: number;
  level: number;
  maxDps: number;
  ttlSeconds?: number;
  characterId?: string;
}) {
  if (!isLeaderboardConfigured()) return; // silent no-op when not configured
  // Validate required fields to avoid backend 400s
  if (!opts.playerId || !opts.name) return;
  lbLog('submitScore:start', { board: opts.board||'global', timeSec: opts.timeSec, kills: opts.kills, level: opts.level, maxDps: opts.maxDps });
  const board = opts.board ?? 'global';
  const key = boardKey(board);
  const metaKey = `${key}:meta`;
  const pid = opts.playerId;
  const name = sanitizeName(opts.name);
  const timeSec = Math.max(0, Math.floor(opts.timeSec));
  const meta: any = { kills: opts.kills|0, level: opts.level|0, maxDps: Math.round(opts.maxDps), timeSec };
  if (opts.characterId) meta.char = opts.characterId;

  // Zjistit současné nejlepší skóre a aktualizovat meta pouze při zlepšení
  let currentBest = 0;
  try {
    const s = await redis(['ZSCORE', key, pid]).catch(()=>null);
    if (s !== null && s !== undefined) currentBest = Number(s) || 0;
  } catch {/* ignore */}

  // Pokud je toto skóre lepší než dosavadní NA TOMTO BOARDU, aktualizujeme per‑board meta
  if (timeSec > currentBest) {
    try {
      // Always keep latest nickname globally
      await redis(['HSET', `name:${pid}`, 'name', name]);
      // Per‑board meta: field=pid, value=JSON(meta), so each board locks metadata to its best run
      await redis(['HSET', metaKey, pid, JSON.stringify(meta)]);
  // Cleanup: remove legacy global meta field if present to avoid stale reads by older clients
  await redis(['HDEL', `name:${pid}`, 'meta']).catch(()=>{});
    } catch {/* ignore meta persist errors */}
  } else {
    // Always keep nickname fresh even when not improving score
    try { await redis(['HSET', `name:${pid}`, 'name', name]); } catch {/* ignore */}
  }

  // Zapsat survival time jen když je vyšší než aktuální (GT) => delší přežití
  await redis(['ZADD', key, 'GT', String(timeSec), pid]);

  if (opts.ttlSeconds && opts.ttlSeconds > 0) {
    await redis(['EXPIRE', key, String(opts.ttlSeconds)]);
    // Keep meta hash in sync with board lifecycle
    await redis(['EXPIRE', metaKey, String(opts.ttlSeconds)]).catch(()=>{});
  }
  lbLog('submitScore:done', { pid, board, timeSec });
}

/**
 * Convenience helper: submit one run to global + daily/weekly/monthly rotating boards.
 * Accepts the same fields as submitScore (minus board) and resolves period boards automatically.
 * All submissions fire sequentially to preserve ordering in logs; failures per-board are isolated.
 */
export async function submitScoreAllPeriods(opts: {
  playerId: string;
  name: string;
  timeSec: number;
  kills: number;
  level: number;
  maxDps: number;
  /** Optional: when provided, also submit to per‑operative boards (e.g., global:op:shadow_operative) */
  characterId?: string;
}) {
  if (!isLeaderboardConfigured()) return;
  if (!opts.playerId || !opts.name) return;
  const base = { playerId: opts.playerId, name: opts.name, timeSec: opts.timeSec, kills: opts.kills, level: opts.level, maxDps: opts.maxDps };
  const periods = [
    { board: 'global' as string, ttlSeconds: undefined as number | undefined },
    resolveBoard('daily:auto'),
    resolveBoard('weekly:auto'),
    resolveBoard('monthly:auto')
  ];
  // Build list of boards to submit to, including per‑operative variants when characterId provided
  const boards: { board: string; ttlSeconds?: number }[] = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    boards.push({ board: p.board, ttlSeconds: p.ttlSeconds });
    if (opts.characterId) {
      boards.push({ board: `${p.board}:op:${opts.characterId}`, ttlSeconds: p.ttlSeconds });
    }
  }
  for (let i=0;i<boards.length;i++) {
    const b = boards[i];
    try {
      await submitScore({ ...base, board: b.board, ttlSeconds: b.ttlSeconds, characterId: opts.characterId });
    } catch {/* ignore individual board failure */}
  }
}

// Načtení TOP N
export async function fetchTop(board = 'global', limit = 10, offset = 0): Promise<LeaderEntry[]> {
  if (!isLeaderboardConfigured()) return []; // treat as empty list if misconfigured
  if (!board) board = 'global';
  if (limit <= 0) return [];
  lbLog('fetchTop:start', { board, limit, offset });
  const now = performance.now();
  // Error backoff: if last attempt errored very recently, serve cache (if any) or skip
  if (lastTopErrorAt && (now - lastTopErrorAt) < ERROR_BACKOFF_MS) {
    if (lastTopCache && lastTopCache.key.board === board && lastTopCache.key.limit === limit && lastTopCache.key.offset === offset) {
      return lastTopCache.data;
    }
    return []; // silent during backoff
  }
  // Cache hit
  if (lastTopCache && (now - lastTopCache.ts) < TOP_CACHE_TTL && lastTopCache.key.board === board && lastTopCache.key.limit === limit && lastTopCache.key.offset === offset) {
    return lastTopCache.data;
  }
  const key = boardKey(board);
  const metaKey = `${key}:meta`;
  // If this is a per‑operative board, capture operative id from board name (e.g., global:op:neural_nomad)
  const boardOpMatch = /:op:([a-z0-9_\-]+)/i.exec(board);
  const boardOpId = boardOpMatch ? boardOpMatch[1] : undefined;

  // Helper to fetch a page and hydrate metadata
  const fetchPage = async (pageOffset: number, pageSize: number): Promise<LeaderEntry[]> => {
    const flat: string[] = await redis(['ZREVRANGE', key, String(pageOffset), String(pageOffset + pageSize - 1), 'WITHSCORES']);
    const page: LeaderEntry[] = new Array(Math.ceil(flat.length / 2));
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      ((idx: number) => {
        const playerId = flat[idx];
        const timeSecRaw = Number(flat[idx + 1]);
        tasks.push((async () => {
          let name = playerId;
          let kills: number | undefined;
          let level: number | undefined;
          let maxDps: number | undefined;
          let characterId: string | undefined;
          const timeSec = timeSecRaw; // ZSET score is authoritative best run time
          try {
            const fetchedName = await redis(['HGET', `name:${playerId}`, 'name']);
            if (fetchedName) name = fetchedName;
            // Use only per‑board meta to lock data to the best run on this board (no legacy fallback to avoid stale char)
            let metaStr = await redis(['HGET', metaKey, playerId]).catch(()=>null);
            if (metaStr) {
              const meta = JSON.parse(metaStr);
              const matches = (typeof meta.timeSec === 'number' && meta.timeSec === timeSec);
              if (matches) {
                if (typeof meta.kills === 'number') kills = meta.kills;
                if (typeof meta.level === 'number') level = meta.level;
                if (typeof meta.maxDps === 'number') maxDps = meta.maxDps;
                if (typeof meta.char === 'string') characterId = meta.char;
              } else {
                // Do not read fields from a different run
                characterId = undefined;
              }
            }
          } catch {/* ignore per-player meta errors */}
          const effectiveCharId = boardOpId || characterId;
          page[idx/2] = { rank: pageOffset + idx / 2 + 1, playerId, name, timeSec, kills, level, maxDps, characterId: effectiveCharId };
        })());
      })(i);
    }
    await Promise.all(tasks);
    return page.filter(Boolean) as LeaderEntry[];
  };

  // Only-one-entry-per-name applies to non per‑operative boards ("all operatives" boards)
  const enforceUniqueByName = !boardOpId;
  if (!enforceUniqueByName) {
    // Simple one-shot fetch (original path)
    const page = await fetchPage(offset, limit);
    lastTopCache = { key: { board, limit, offset }, data: page, ts: performance.now() };
    lbLog('fetchTop:done', { board, count: page.length });
    return page;
  }

  // Unique-by-name collection with paging
  const seen = new Set<string>();
  const out: LeaderEntry[] = [];
  let pageOffset = offset;
  const pageSize = Math.max(limit, 10);
  let guard = 0;
  while (out.length < limit && guard++ < 20) { // safety cap to avoid infinite loop
    const page = await fetchPage(pageOffset, pageSize);
    if (!page.length) break;
    for (let i = 0; i < page.length && out.length < limit; i++) {
      const e = page[i];
      const keyName = (e.name || '').toLowerCase();
      if (!seen.has(keyName)) { seen.add(keyName); out.push({ ...e, rank: (offset + out.length + 1) }); }
    }
    pageOffset += page.length; // advance through the underlying ZSET
    if (page.length < pageSize) break; // end reached
  }
  lastTopCache = { key: { board, limit, offset }, data: out, ts: performance.now() };
  lbLog('fetchTop:done(unique)', { board, count: out.length });
  return out;
}

// Fetch a single player's best entry (even if not in current top window)
export async function fetchPlayerEntry(board: string, playerId: string): Promise<LeaderEntry | null> {
  if (!isLeaderboardConfigured()) return null;
  if (!playerId) return null;
  lbLog('fetchPlayerEntry:start', { board, playerId });
  const key = boardKey(board);
  const metaKey = `${key}:meta`;
  // If this is a per‑operative board, capture operative id from board name
  const boardOpMatch = /:op:([a-z0-9_\-]+)/i.exec(board);
  const boardOpId = boardOpMatch ? boardOpMatch[1] : undefined;
  try {
    const rankIdx = await redis(['ZREVRANK', key, playerId]).catch(()=>null);
    const rawScore = await redis(['ZSCORE', key, playerId]).catch(()=>null);
    if (rankIdx === null || rankIdx === undefined || rawScore === null || rawScore === undefined) return null;
  // ZSET score je autoritativní BEST RUN čas
  const timeSec = Number(rawScore) || 0;
  let name = playerId;
  let kills: number | undefined; let level: number | undefined; let maxDps: number | undefined; let characterId: string | undefined;
    try {
  const fetchedName = await redis(['HGET', `name:${playerId}`, 'name']);
      if (fetchedName) name = fetchedName;
  // Use only per‑board meta (best-run locked) to avoid stale operative from legacy global meta
  let metaStr = await redis(['HGET', metaKey, playerId]).catch(()=>null);
      if (metaStr) {
        const meta = JSON.parse(metaStr);
        const matches = (typeof meta.timeSec === 'number' && meta.timeSec === timeSec);
        if (matches) {
          if (typeof meta.kills === 'number') kills = meta.kills;
          if (typeof meta.level === 'number') level = meta.level;
          if (typeof meta.maxDps === 'number') maxDps = meta.maxDps;
          if (typeof meta.char === 'string') characterId = meta.char;
        } else {
          characterId = undefined;
        }
      }
    } catch {/* ignore meta errors */}
  // Prefer board-derived operative id on per-operative boards to guarantee consistent labeling.
  const effectiveCharId = boardOpId || characterId;
  return { rank: (rankIdx as number) + 1, playerId, name, timeSec, kills, level, maxDps, characterId: effectiveCharId };
  } catch {
    return null;
  }
}
