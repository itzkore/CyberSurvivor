import { runBatch, summarize, runCharacterSim, computePowerFactors, type SimEvent } from './BalanceSimulator';
import { CHARACTERS } from '../data/characters';
import { writeFileSync, mkdirSync, existsSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';

// Parse tiny args: --sec=90 --seeds=1,2,3 [--mode=NORMAL|SHOWDOWN] [--loadout=inline|path.json] [--autoUpgrade=1|0] [--pressure=key:val,key:val] [--minutes=15,20,25,30]
const args = (process.argv.slice(2) || []).reduce<Record<string, string>>((m, a) => {
  const [k, v] = a.split('=');
  if (k && v) m[k.replace(/^--/, '')] = v;
  return m;
}, {});

const durationSec = args.sec ? parseFloat(args.sec) : 60;
const seeds = args.seeds ? args.seeds.split(',').map((s) => parseInt(s, 10)) : [1, 2, 3];
const log = args.log === '1' || args.log === 'true';
const logDir = args.logdir || 'sim-logs';
const outFile = args.out; // optional JSON summary output
const wantPower = args.power === '1' || args.power === 'true';
const gameMode = (args.mode as any) || 'NORMAL';
const autoUpgrade = args.autoUpgrade === undefined ? true : (args.autoUpgrade === '1' || args.autoUpgrade === 'true');
// Parse pressure inline as comma-separated key:val (e.g., enabled:1,spawnRateMul:2,packSize:8,hpMul:1.5,rampPerMin:0.5)
let pressure: any = undefined;
if (args.pressure) {
  pressure = {} as any;
  const pairs = args.pressure.split(',');
  for (const pair of pairs) {
    const [k, v] = pair.split(':'); if (!k) continue;
    const key = k.trim(); const val = (v || '').trim();
    if (val === '' || val === undefined) continue;
    const num = Number(val);
    (pressure as any)[key] = isNaN(num) ? (val === 'true' ? true : (val === 'false' ? false : val)) : num;
  }
  if ((pressure as any).enabled === undefined) pressure.enabled = true;
}

type Scenario = { name?: string; initialWeapons?: Array<string|number>; initialPassives?: Array<string|number>; };
let scenarios: Scenario[] | null = null;
if (args.loadout) {
  if (/\.json$/i.test(args.loadout)) {
    const raw = JSON.parse(readFileSync(args.loadout, 'utf-8'));
    scenarios = Array.isArray(raw) ? raw : [raw];
  } else {
    // inline: weapons=...;passives=...
    const parts = args.loadout.split(';');
    const sc: Scenario = {};
    for (const p of parts) {
      const [k, v] = p.split('=');
      if (!k || !v) continue;
      const list = v.split(',').map(s => s.trim()).filter(Boolean);
      if (k === 'weapons' || k === 'w') sc.initialWeapons = list;
      if (k === 'passives' || k === 'p') sc.initialPassives = list;
    }
    scenarios = [sc];
  }
}

let results;
const runOnce = (extraCfg?: any) => {
  if (!log) {
    return runBatch(CHARACTERS, { durationSec, seeds, gameMode, autoUpgrade, pressure, ...extraCfg });
  }
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const out: any[] = [];
  for (const c of CHARACTERS) {
    for (const seed of seeds) {
      const file = join(logDir, `${c.id}__seed-${seed}.ndjson`);
      // truncate
      writeFileSync(file, '', 'utf-8');
      const onEvent = (e: SimEvent) => {
        appendFileSync(file, JSON.stringify(e) + "\n", 'utf-8');
      };
  const res = runCharacterSim(c, seed, { durationSec, logEvents: true, onEvent, gameMode, autoUpgrade, pressure, ...extraCfg });
      out.push(res);
    }
  }
  return out;
};

// If minutes snapshots requested, run per-minute windows with a startAtMin offset (pressure ramp alignment)
if (args.minutes) {
  const mins = args.minutes.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  const collated: Record<string, any> = {};
  for (const m of mins) {
    const tag = `${m}min`;
    const extra = { pressure: pressure ? { ...pressure, startAtMin: m } : { enabled: true, startAtMin: m } };
    const res = runOnce(extra);
  const s = summarize(res as any);
  const p = wantPower ? computePowerFactors(res as any) : undefined;
  collated[tag] = wantPower ? { summary: s, power: p } : s;
    console.log(`# ${tag}`);
    const ids = Object.keys(s).sort();
    console.log(wantPower ? 'id,meanSurvival,meanKills,meanLevel,power' : 'id,meanSurvival,meanKills,meanLevel');
    for (const id of ids) {
      const r = (s as any)[id];
      const pow = wantPower ? (p as any)?.[id]?.power ?? NaN : undefined;
      console.log(wantPower
        ? `${id},${r.meanSurvival.toFixed(2)},${r.meanKills.toFixed(1)},${r.meanLevel.toFixed(1)},${isNaN(pow as any) ? '' : (pow as number).toFixed(1)}`
        : `${id},${r.meanSurvival.toFixed(2)},${r.meanKills.toFixed(1)},${r.meanLevel.toFixed(1)}`
      );
    }
    console.log('');
  }
  if (outFile) {
    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), windowSec: durationSec, seeds, mode: gameMode, autoUpgrade, snapshots: collated, power: wantPower }, null, 2), 'utf-8');
  }
  process.exit(0);
}

if (scenarios && scenarios.length) {
  const collated: Record<string, any> = {};
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    const tag = sc.name || `scenario_${i+1}`;
    const res = runOnce({ initialWeapons: sc.initialWeapons, initialPassives: sc.initialPassives });
  const s = summarize(res as any);
  const p = wantPower ? computePowerFactors(res as any) : undefined;
  collated[tag] = wantPower ? { summary: s, power: p } : s;
    // Print section header
    console.log(`# ${tag}`);
    const ids = Object.keys(s).sort();
    console.log(wantPower ? 'id,meanSurvival,meanKills,meanLevel,power' : 'id,meanSurvival,meanKills,meanLevel');
    for (let j = 0; j < ids.length; j++) {
      const id = ids[j];
      const r = (s as any)[id];
      const pow = wantPower ? (p as any)?.[id]?.power ?? NaN : undefined;
      console.log(wantPower
        ? `${id},${r.meanSurvival.toFixed(2)},${r.meanKills.toFixed(1)},${r.meanLevel.toFixed(1)},${isNaN(pow as any) ? '' : (pow as number).toFixed(1)}`
        : `${id},${r.meanSurvival.toFixed(2)},${r.meanKills.toFixed(1)},${r.meanLevel.toFixed(1)}`
      );
    }
    console.log('');
  }
  if (outFile) {
    writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), durationSec, seeds, mode: gameMode, autoUpgrade, scenarios: collated, power: wantPower }, null, 2), 'utf-8');
  }
  process.exit(0);
}

results = runOnce();

const summary = summarize(results as any);
const power = wantPower ? computePowerFactors(results as any) : undefined;

// Optionally write JSON summary for machine consumption
if (outFile) {
  writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    durationSec,
    seeds,
    mode: gameMode,
  summary,
  power,
  }, null, 2), 'utf-8');
}

// Print concise table
const ids = Object.keys(summary).sort();
console.log(wantPower ? 'id,meanSurvival,meanKills,meanLevel,power' : 'id,meanSurvival,meanKills,meanLevel');
for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const s = summary[id];
  const pow = wantPower ? (power as any)?.[id]?.power ?? NaN : undefined;
  console.log(wantPower
    ? `${id},${s.meanSurvival.toFixed(2)},${s.meanKills.toFixed(1)},${s.meanLevel.toFixed(1)},${isNaN(pow as any) ? '' : (pow as number).toFixed(1)}`
    : `${id},${s.meanSurvival.toFixed(2)},${s.meanKills.toFixed(1)},${s.meanLevel.toFixed(1)}`
  );
}
