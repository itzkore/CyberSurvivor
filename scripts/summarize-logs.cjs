#!/usr/bin/env node
/*
  Summarize NDJSON sim logs.
  Usage:
    CSV (default): node scripts/summarize-logs.cjs --dir=sim-logs
    JSON summary:  node scripts/summarize-logs.cjs --dir=sim-logs --json=1 [--out=summary.json]
*/
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function summarizeFile(fp) {
  const base = path.basename(fp, '.ndjson');
  const [id, seedPart] = base.split('__');
  const seed = seedPart ? Number(seedPart.replace('seed-','')) : undefined;
  let start, end;
  let kills = 0, level = 1, damageTaken = 0, xpOrbsCollected = 0, peakEnemies = 0;
  let levelUps = 0, upgrades = 0, bossSpawns = 0, bossesDefeated = 0;
  const upgradeCounts = Object.create(null);

  const data = fs.readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  for (const line of data) {
    if (!line) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (evt.type === 'start') start = evt.t;
    else if (evt.type === 'end') {
      end = evt.t;
      kills = evt.data.kills;
      level = evt.data.level;
      damageTaken = evt.data.damageTaken;
      xpOrbsCollected = evt.data.xpOrbsCollected ?? xpOrbsCollected;
      peakEnemies = evt.data.peakEnemies ?? peakEnemies;
    } else if (evt.type === 'tick') {
      if (evt.data.enemies > peakEnemies) peakEnemies = evt.data.enemies;
    } else if (evt.type === 'levelup') levelUps++;
    else if (evt.type === 'upgrade') {
      upgrades++;
      const name = evt.data?.name || evt.data?.id || 'unknown';
      upgradeCounts[name] = (upgradeCounts[name] || 0) + 1;
    } else if (evt.type === 'bossSpawn') bossSpawns++;
    else if (evt.type === 'bossDefeated') bossesDefeated++;
  }
  const duration = (end ?? start ?? 0) - (start ?? 0);
  return { id, seed, duration, kills, level, damageTaken, xpOrbsCollected, peakEnemies, levelUps, upgrades, bossSpawns, bossesDefeated, upgradeCounts };
}

function main() {
  const { dir = 'sim-logs', json, out } = parseArgs(process.argv);
  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ndjson'));
  if (files.length === 0) {
    console.error('No .ndjson files found');
    process.exit(2);
  }

  const perRun = files.map(f => summarizeFile(path.join(dir, f)));

  // Aggregate by character id
  const byId = new Map();
  for (const r of perRun) {
    if (!byId.has(r.id)) byId.set(r.id, []);
    byId.get(r.id).push(r);
  }

  if (json === '1' || json === 'true') {
    const summary = {};
    for (const [id, runs] of byId) {
      const n = runs.length;
      const sum = runs.reduce((a, r) => ({
        duration: a.duration + r.duration,
        kills: a.kills + r.kills,
        level: a.level + r.level,
        peakEnemies: a.peakEnemies + r.peakEnemies,
        bossSpawns: a.bossSpawns + r.bossSpawns,
        bossesDefeated: a.bossesDefeated + r.bossesDefeated,
        upgradeCounts: (function(){
          for (const [k, v] of Object.entries(r.upgradeCounts || {})) {
            a.upgradeCounts[k] = (a.upgradeCounts[k] || 0) + v;
          }
          return a.upgradeCounts;
        })(),
      }), { duration:0, kills:0, level:0, peakEnemies:0, bossSpawns:0, bossesDefeated:0, upgradeCounts:{} });
      summary[id] = {
        runs: n,
        meanDuration: Number((sum.duration / n).toFixed(4)),
        meanKills: Number((sum.kills / n).toFixed(4)),
        meanLevel: Number((sum.level / n).toFixed(4)),
        meanPeakEnemies: Number((sum.peakEnemies / n).toFixed(4)),
        bossSpawns: sum.bossSpawns,
        bossesDefeated: sum.bossesDefeated,
        upgradeCounts: sum.upgradeCounts,
      };
    }
    const outStr = JSON.stringify({ dir, generatedAt: new Date().toISOString(), perRun, byId: summary }, null, 2);
    if (out) {
      fs.writeFileSync(out, outStr);
    } else {
      console.log(outStr);
    }
  } else {
    console.log('id,runs,meanDuration,meanKills,meanLevel,meanPeakEnemies,bossSpawns,bossesDefeated');
    for (const [id, runs] of byId) {
      const n = runs.length;
      const sum = runs.reduce((a, r) => ({
        duration: a.duration + r.duration,
        kills: a.kills + r.kills,
        level: a.level + r.level,
        peakEnemies: a.peakEnemies + r.peakEnemies,
        bossSpawns: a.bossSpawns + r.bossSpawns,
        bossesDefeated: a.bossesDefeated + r.bossesDefeated,
      }), { duration:0, kills:0, level:0, peakEnemies:0, bossSpawns:0, bossesDefeated:0 });
      const mean = {
        duration: (sum.duration / n).toFixed(2),
        kills: (sum.kills / n).toFixed(2),
        level: (sum.level / n).toFixed(2),
        peakEnemies: (sum.peakEnemies / n).toFixed(2),
      };
      console.log(`${id},${n},${mean.duration},${mean.kills},${mean.level},${mean.peakEnemies},${sum.bossSpawns},${sum.bossesDefeated}`);
    }
  }
}

if (require.main === module) main();
