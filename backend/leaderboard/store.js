// Stubbed leaderboard store (fully removed). Only nickname helpers kept minimal in-memory.
const profiles = new Map();
function randomNickname(){ return 'Runner'+((Math.random()*1000)|0); }
export async function getOrCreateNickname(userId){ let p = profiles.get(userId); if(!p){ p={ nickname: randomNickname(), profileComplete:false }; profiles.set(userId,p);} return p; }
export async function setNickname(userId,nickname){ if(!nickname) return { error:'invalid_nickname' }; let p = profiles.get(userId)||{ nickname, profileComplete:true }; p.nickname = nickname; p.profileComplete = true; profiles.set(userId,p); return { nickname }; }
// No other exports.// Unified leaderboard store (Redis + memory fallback) + nickname/profile helpers.
import { createClient } from 'redis';

// ----------------- Nickname / Profile -----------------
let memoryModeFlag = process.env.TEST_LEADERBOARD_MEMORY === '1';
function memoryMode() { if (!memoryModeFlag && process.env.TEST_LEADERBOARD_MEMORY === '1') memoryModeFlag = true; return memoryModeFlag; }
const memProfiles = new Map(); // userId -> { nickname, profileComplete }

// --------------------------------------------------
// Nickname / Profile persistence helpers
// --------------------------------------------------
const ADJECTIVES = ['Neon','Quantum','Cyber','Ghost','Shadow','Nova','Chrome','Pixel','Viral','Synaptic'];
const NOUNS = ['Runner','Hacker','Wraith','Nomad','Cipher','Rogue','Phantom','Gunner','Weaver','Operative'];

function randomNickname() {
  const adj = ADJECTIVES[(Math.random() * ADJECTIVES.length) | 0];
  const noun = NOUNS[(Math.random() * NOUNS.length) | 0];
  const num = (Math.random() * 99) | 0;
  return `${adj}${noun}${num.toString().padStart(2,'0')}`;
}

function sanitizeNickname(nick) {
  if (!nick || typeof nick !== 'string') return null;
  const trimmed = nick.trim().slice(0, 32);
  if (!trimmed) return null;
  // Allow alphanum + underscore + hyphen
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
  return safe || null;
}

export async function getOrCreateNickname(userId) {
  let prof = memProfiles.get(userId);
  if (!prof) { prof = { nickname: randomNickname(), profileComplete: false }; memProfiles.set(userId, prof); }
  return prof;
}

export async function setNickname(userId, nickname) {
  const safe = sanitizeNickname(nickname);
  if (!safe) return { error: 'invalid_nickname' };
  let prof = memProfiles.get(userId) || { nickname: safe, profileComplete: true };
  prof.nickname = safe; prof.profileComplete = true; memProfiles.set(userId, prof);
  return { nickname: safe };
}

// ----------------- Leaderboard (scores) -----------------
// Redis Data Model:
//  ZSET lb:{mode}:{char} -> member = userId, score = best score
//  HASH lb:entry:{mode}:{char}:{userId} -> nickname, level, durationSec, ts
// Memory fallback uses maps.
const REDIS_URL = process.env.REDIS_URL || '';
let redis; let redisReady = false; let redisInitPromise;
function initRedis() {
  if (redisInitPromise) return redisInitPromise;
  if (!REDIS_URL) return Promise.resolve(false);
  redis = createClient({ url: REDIS_URL });
  redis.on('error', () => { redisReady = false; });
  redisInitPromise = redis.connect().then(()=>{ redisReady = true; return true; }).catch(()=>false);
  return redisInitPromise;
}

const memScores = new Map(); // bucket -> Map(userId, { score, nickname, level, durationSec, ts })
function bucket(mode, characterId) { return `lb:${mode}:${characterId}`; }
function hashKey(mode, characterId, userId) { return `lb:entry:${mode}:${characterId}:${userId}`; }

export async function submitScore({ userId, nickname, score, mode, characterId, level=0, durationSec=0 }) {
  if (!userId || !nickname || typeof score !== 'number' || score < 0) return { error:'invalid_payload' };
  await initRedis();
  const b = bucket(mode, characterId);
  const ts = Date.now();
  if (redisReady) {
    const prev = await redis.zScore(b, userId).catch(()=>null);
    if (prev === null || score > prev) {
      const multi = redis.multi();
      multi.zAdd(b, [{ score, value: userId }]);
      multi.hSet(hashKey(mode, characterId, userId), { nickname, level: level.toString(), durationSec: durationSec.toString(), ts: ts.toString() });
      await multi.exec();
      return { ok:true, updated:true, score };
    }
    return { ok:true, updated:false, score: prev };
  }
  let m = memScores.get(b); if (!m) { m = new Map(); memScores.set(b, m); }
  const existing = m.get(userId);
  if (!existing || score > existing.score) { m.set(userId, { score, nickname, level, durationSec, ts }); return { ok:true, updated:true, score }; }
  return { ok:true, updated:false, score: existing.score };
}

export async function getTop(mode, characterId, limit=20, start=0) {
  await initRedis();
  const b = bucket(mode, characterId);
  if (redisReady) {
    const stop = start + limit - 1;
    const idsWithScores = await redis.zRangeWithScores(b, start, stop, { REV:true }).catch(()=>[]);
    if (!idsWithScores.length) return [];
    const pipeline = redis.multi();
    for (const r of idsWithScores) pipeline.hGetAll(hashKey(mode, characterId, r.value));
    const meta = await pipeline.exec();
    return idsWithScores.map((r,i)=> { const h = meta[i] || {}; return { userId:r.value, nickname:h.nickname||'Player', score:r.score, level:+(h.level||0), durationSec:+(h.durationSec||0) }; });
  }
  const m = memScores.get(b); if (!m) return [];
  const arr = Array.from(m.entries()).map(([uid,v])=> ({ userId:uid, nickname:v.nickname, score:v.score, level:v.level, durationSec:v.durationSec }));
  arr.sort((a,b)=> b.score - a.score);
  return arr.slice(start, start+limit);
}

export async function getRank(mode, characterId, userId) {
  await initRedis();
  const b = bucket(mode, characterId);
  if (redisReady) {
    const revRank = await redis.zRevRank(b, userId).catch(()=>null);
    if (revRank === null || revRank === undefined) return null;
    return revRank + 1;
  }
  const m = memScores.get(b); if (!m) return null;
  const arr = Array.from(m.values()).map(v=>v.score).sort((a,b)=> b-a);
  const score = m.get(userId)?.score; if (score==null) return null;
  return arr.indexOf(score)+1;
}

export async function getAround(mode, characterId, userId, radius=2) {
  await initRedis();
  if (radius < 1) radius = 1; if (radius > 10) radius = 10;
  const b = bucket(mode, characterId);
  if (redisReady) {
    const rank = await redis.zRevRank(b, userId).catch(()=>null);
    if (rank === null || rank === undefined) return { rank:null, entries:[] };
    const start = Math.max(0, rank - radius);
    const stop = rank + radius;
    const idsWithScores = await redis.zRangeWithScores(b, start, stop, { REV:true }).catch(()=>[]);
    const pipeline = redis.multi();
    for (const r of idsWithScores) pipeline.hGetAll(hashKey(mode, characterId, r.value));
    const meta = await pipeline.exec();
    const entries = idsWithScores.map((r,i)=> { const h=meta[i]||{}; return { userId:r.value, nickname:h.nickname||'Player', score:r.score, level:+(h.level||0), durationSec:+(h.durationSec||0), self: r.value===userId }; });
    return { rank: rank+1, entries };
  }
  const top = await getTop(mode, characterId, 1000, 0);
  const idx = top.findIndex(e=> e.userId===userId);
  if (idx === -1) return { rank:null, entries:[] };
  return { rank: idx+1, entries: top.slice(Math.max(0, idx-radius), idx+radius+1).map(e=> ({...e, self:e.userId===userId})) };
}

export function backendStatus() { return { backend: redisReady ? 'redis' : 'memory' }; }
