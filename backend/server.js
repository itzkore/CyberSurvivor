// CyberSurvivor Backend (stripped): Only auth profile endpoints retained. All leaderboard APIs removed.
import express from 'express';
import cors from 'cors';
import { OAuth2Client } from 'google-auth-library';
// Leaderboard functionality removed. Only auth/profile endpoints remain.
import { getOrCreateNickname, setNickname } from './leaderboard/store.js';

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

// Health endpoint (leaderboard removed)
app.get('/health', (req, res) => { res.json({ ok: true, msg: 'ok', leaderboard: 'removed' }); });

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`CyberSurvivor stripped backend running on port ${PORT}`);
  });
}

export default app;
