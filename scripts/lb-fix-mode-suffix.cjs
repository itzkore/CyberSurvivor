#!/usr/bin/env node
// Backfill legacy period boards into mode-scoped keys using Upstash REST.
// Usage (Windows cmd):
//   node .\scripts\lb-fix-mode-suffix.cjs --period=weekly:2025-W37 --mode=LAST_STAND [--dryrun=1]
//   node .\scripts\lb-fix-mode-suffix.cjs --period=monthly:2025-09 --mode=DUNGEON
// Requires env: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

const args = Object.fromEntries(process.argv.slice(2).map(a=>{ const [k,v] = a.replace(/^--/,'').split('='); return [k, v ?? '1']; }));
const PERIOD = args.period; // e.g., weekly:2025-W37 or monthly:2025-09
const MODE = (args.mode||'').toUpperCase(); // LAST_STAND | DUNGEON | SHOWDOWN
const DRYRUN = args.dryrun === '1' || args.dryrun === 'true';

if (!PERIOD || !/^weekly:|^monthly:/.test(PERIOD) || !MODE) {
  console.error('Usage: --period=weekly:YYYY-Www|monthly:YYYY-MM --mode=LAST_STAND|DUNGEON|SHOWDOWN [--dryrun=1]');
  process.exit(2);
}

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!BASE || !TOKEN) {
  console.error('Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN');
  process.exit(2);
}

async function redis(cmd, ...parts) {
  const url = `${BASE}/${[cmd, ...parts].map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return j.result;
}

function legacyKey(period) {
  // lb:weekly:YYYY-Www or lb:monthly:YYYY-MM (no suffix)
  const [kind, rest] = period.split(':');
  return `lb:${kind}:${rest}`;
}

function destKey(period, mode) {
  const [kind, rest] = period.split(':');
  return `lb:${kind}:${rest}:mode:${mode}`;
}

(async () => {
  const src = legacyKey(PERIOD);
  const srcMeta = `${src}:meta`;
  const dst = destKey(PERIOD, MODE);
  const dstMeta = `${dst}:meta`;
  console.log(`Scanning ${src} -> ${dst} (mode=${MODE})`);
  // Pull a large window (first 1000 entries)
  const flat = await redis('ZREVRANGE', src, '0', '999', 'WITHSCORES').catch(()=>[]);
  if (!flat || !flat.length) { console.log('No entries in source.'); return; }
  const ids = []; const scores = [];
  for (let i=0;i<flat.length;i+=2){ ids.push(flat[i]); scores.push(Number(flat[i+1])); }
  const metas = await redis('HMGET', srcMeta, ...ids).catch(()=>[]);
  let moved = 0;
  for (let i=0;i<ids.length;i++){
    const pid = ids[i]; const score = scores[i];
    let metaOk = false; let meta;
    try { meta = metas[i] ? JSON.parse(metas[i]) : null; } catch {}
    if (meta && meta.mode && String(meta.mode).toUpperCase() === MODE) metaOk = true;
    if (!metaOk) continue; // only migrate entries with exact mode tag
    if (DRYRUN) {
      console.log(`[dryrun] would migrate ${pid}@${score} to ${dst}`);
      moved++; continue;
    }
    // Write to dest zset + meta
    await redis('ZADD', dst, 'GT', String(score), pid).catch(()=>{});
    if (meta) await redis('HSET', dstMeta, pid, JSON.stringify(meta)).catch(()=>{});
    moved++;
  }
  console.log(`${DRYRUN?'[dryrun] ':''}migrated ${moved} entries to ${dst}`);
})();
