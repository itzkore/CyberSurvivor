// CyberSurvivor Backend (stripped): Only auth profile endpoints retained. All leaderboard APIs removed.
import express from 'express';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
import { getOrCreateNickname, setNickname, submitScore, getTop, getRank, getAround, backendStatus } from './leaderboard/store.js';

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(cors());
app.use(express.json());

async function verifyToken(idToken) {
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

app.post('/verify', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    let payload; try { payload = await verifyToken(idToken); } catch { return res.status(401).json({ error: 'invalid token' }); }
    const userId = payload.sub;
    const prof = await getOrCreateNickname(userId);
    res.json({ userId, nickname: prof.nickname, profileComplete: !!prof.profileComplete });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'internal' }); }
});

app.post('/profile', async (req, res) => {
  try {
    const { idToken, nickname } = req.body || {};
    if (!idToken || !nickname) return res.status(400).json({ error: 'idToken and nickname required' });
    let payload; try { payload = await verifyToken(idToken); } catch { return res.status(401).json({ error: 'invalid token' }); }
    const userId = payload.sub;
    const r = await setNickname(userId, nickname);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, nickname: r.nickname });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : 'internal' }); }
});

// Minimal health endpoint (no leaderboard presence implied)
// Leaderboard endpoints
app.post('/api/leaderboard/submit', async (req,res) => {
  try {
    const { userId, nickname, score, mode='SHOWDOWN', characterId='runner', level=0, durationSec=0 } = req.body||{};
    const r = await submitScore({ userId, nickname, score, mode, characterId, level, durationSec });
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch { res.status(500).json({ error:'internal' }); }
});
app.get('/api/leaderboard/top', async (req,res) => {
  try {
    const { mode='SHOWDOWN', characterId='runner' } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const start = Math.max(parseInt(req.query.start) || 0, 0);
    const entries = await getTop(mode, characterId, limit, start);
    res.json({ entries });
  } catch { res.status(500).json({ error:'internal' }); }
});
app.get('/api/leaderboard/rank', async (req,res) => {
  try { const { mode='SHOWDOWN', characterId='runner', userId } = req.query; if (!userId) return res.status(400).json({ error:'userId required' }); const rank = await getRank(mode, characterId, userId); res.json({ rank }); } catch { res.status(500).json({ error:'internal' }); }
});
app.get('/api/leaderboard/around', async (req,res) => {
  try { const { mode='SHOWDOWN', characterId='runner', userId } = req.query; if (!userId) return res.status(400).json({ error:'userId required' }); const radius = Math.min(Math.max(parseInt(req.query.radius) || 2,1),10); const data = await getAround(mode, characterId, userId, radius); res.json(data); } catch { res.status(500).json({ error:'internal' }); }
});
app.get('/api/leaderboard/health', (req,res) => { res.json({ ok:true, ...backendStatus(), ts: Date.now() }); });
app.get('/health', (req, res) => { res.json({ ok: true, msg: 'ok', ...backendStatus() }); });

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`CyberSurvivor stripped backend running on port ${PORT}`);
  });
}

export default app;
