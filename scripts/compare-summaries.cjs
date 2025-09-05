#!/usr/bin/env node
/*
  Compare two JSON summaries produced by summarize-logs.cjs --json=1.
  Usage: node scripts/compare-summaries.cjs --old=baseline.json --new=sim-logs-summary.json [--failKills=2]
*/
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function loadSummary(fp) {
  const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
  return raw.byId || {};
}

function main() {
  const { old, new: newer, failKills } = parseArgs(process.argv);
  if (!old || !newer) {
    console.error('Missing --old or --new');
    process.exit(1);
  }
  const a = loadSummary(old);
  const b = loadSummary(newer);
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  const failThresh = failKills ? Number(failKills) : null;
  let failed = false;

  console.log('id,oldKills,newKills,deltaKills,oldLevel,newLevel,deltaLevel,oldDuration,newDuration,deltaDuration,note');
  for (const id of [...ids].sort()) {
    const A = a[id];
    const B = b[id];
    if (!A) {
      console.log(`${id},,, ,,, ,,, ,added`);
      continue;
    }
    if (!B) {
      console.log(`${id},,, ,,, ,,, ,removed`);
      continue;
    }
    const dKills = (B.meanKills - A.meanKills) || 0;
    const dLevel = (B.meanLevel - A.meanLevel) || 0;
    const dDur = (B.meanDuration - A.meanDuration) || 0;
    const note = (failThresh != null && Math.abs(dKills) > failThresh) ? 'FAIL(kills-drift)' : '';
    if (note) failed = true;
    console.log(`${id},${A.meanKills},${B.meanKills},${dKills.toFixed(2)},${A.meanLevel},${B.meanLevel},${dLevel.toFixed(2)},${A.meanDuration},${B.meanDuration},${dDur.toFixed(2)},${note}`);
  }

  if (failed) process.exit(3);
}

if (require.main === module) main();
