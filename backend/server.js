// CyberSurvivor Backend: Minimal Leaderboard API
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { OAuth2Client } from 'google-auth-library';
import mysql from 'mysql2';

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '156752381672-vidmkis66cs201c39ps9vac3230bv6rl.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Připojení k MySQL (forpsi.cz)
const db = mysql.createConnection({
  host: 'a066um.forpsi.com',
  user: 'f190888',
  password: 'fHaFme9W',
  database: 'f190888',
  port: 3306
});

db.connect(err => {
  if (err) {
    console.error('Chyba připojení k MySQL:', err);
  } else {
    console.log('Připojeno k MySQL!');
  }
});

app.use(cors());
app.use(bodyParser.json());

// In-memory storage (replace with DB for production)
let scores = [];
let logs = [];

async function verifyToken(idToken) {
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

// Submit score (MySQL)
app.post('/score', async (req, res) => {
  try {
    const { score, nickname, mode, characterId, level, durationSec } = req.body;
    // Zápis skóre do tabulky (přepíše staré skóre stejného hráče pro stejný mode/character)
    const sql = `REPLACE INTO leaderboard (userId, nickname, score, mode, characterId, level, durationSec, timeISO) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
    // userId můžeš doplnit z Google auth nebo použít nickname jako identifikátor
    db.query(sql, [nickname, nickname, score, mode, characterId, level, durationSec], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      // Načti top skóre
      const topSql = `SELECT * FROM leaderboard WHERE mode=? AND characterId=? ORDER BY score DESC LIMIT 20`;
      db.query(topSql, [mode, characterId], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ entries: results });
      });
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get leaderboard (MySQL)
app.get('/leaderboard', (req, res) => {
  const { mode = 'SHOWDOWN', characterId = '', limit = 20 } = req.query;
  const sql = `SELECT * FROM leaderboard WHERE mode=? AND characterId=? ORDER BY score DESC LIMIT ?`;
  db.query(sql, [mode, characterId, Number(limit)], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ entries: results });
  });
});

// Log every run
app.post('/scorelog', async (req, res) => {
  try {
    const { idToken, nickname, userId, score, mode, characterId, level, durationSec, timeISO, source } = req.body;
    const user = await verifyToken(idToken);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    logs.push({ nickname, userId: user.sub, score, mode, characterId, level, durationSec, timeISO, source });
    if (logs.length > 1000) logs = logs.slice(-1000);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get all logs (global)
app.get('/scorelog', (req, res) => {
  res.json({ entries: logs.slice(-500).reverse() });
});

function getTopScores(mode, characterId, limit = 20) {
  // Filter and dedup by userId, keep highest score
  const filtered = scores.filter(s => s.mode === mode && (characterId ? s.characterId === characterId : true));
  const best = {};
  for (const s of filtered) {
    if (!best[s.userId] || s.score > best[s.userId].score) best[s.userId] = s;
  }
  return Object.values(best).sort((a, b) => b.score - a.score).slice(0, limit);
}

app.listen(PORT, () => {
  console.log(`CyberSurvivor backend running on port ${PORT}`);
});
