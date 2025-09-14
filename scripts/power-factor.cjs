#!/usr/bin/env node
/* eslint-disable */
// Simple Node runner for deterministic power factor model.
// Usage: node scripts/power-factor.cjs [--level=7] [--timeMin=15] [--out=pf.json]
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function loadTSModule(relPath) {
  // Vite/TS build outputs to ESM; but here we can require TS source through ts-node/register if present.
  // To avoid extra deps, we import the compiled JS if available, else use esbuild-register fallback.
  const full = path.resolve(__dirname, '..', relPath);
  try {
    return require(full);
  } catch (e) {
    // Try ES module dynamic import as last resort
    return import(full.replace(/\\/g, '/'));
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const level = args.level ? parseInt(args.level, 10) : 7;
  const timeMinutes = args.timeMin ? parseFloat(args.timeMin) : 15;
  const outFile = args.out || 'pf-output.json';
  const shouldPrint = args.print === '1' || args.print === 'true';

  // Register ts-node for on-the-fly TS transpilation if available, else proceed with native loader for ESM TS (Node 20+ may still fail).
  try {
    // Force CommonJS transpilation to allow require() of TS sources even when tsconfig uses ESNext
    const tsnode = require('ts-node');
    tsnode.register({
      transpileOnly: true,
      files: true,
      compilerOptions: { module: 'commonjs', moduleResolution: 'node' }
    });
    console.log('[pf] ts-node.register applied');
  } catch (e) {
    console.warn('[pf] ts-node/register failed (continuing):', e && e.message);
  }
  const tsPath = path.resolve(process.cwd(), 'src/sim/PowerModel.ts');
  if (!fs.existsSync(tsPath)) {
    throw new Error(`[pf] Missing TS module at ${tsPath}`);
  }
  let mod;
  try {
    // Bust require cache to avoid stale cached module between runs
    // Delete all cached modules under the project src/ directory to avoid stale imports
    const srcRoot = path.resolve(process.cwd(), 'src');
    for (const k of Object.keys(require.cache)) {
      try {
        if (k && k.startsWith(srcRoot + path.sep)) {
          delete require.cache[k];
        }
      } catch {}
    }
    delete require.cache[tsPath];
    mod = require(tsPath);
    console.log('[pf] required TS module ok');
  } catch (e) {
    console.warn('[pf] require TS module failed, trying dynamic import:', e && e.message);
    const url = 'file:///' + tsPath.replace(/\\/g, '/');
    mod = await import(url);
  }
  const runPowerFactor = mod.runPowerFactor || (mod.default && mod.default.runPowerFactor);
  const sortResults = mod.sortResults || (mod.default && mod.default.sortResults);
  if (!runPowerFactor || !sortResults) {
    throw new Error('[pf] Missing exports from PowerModel.ts (runPowerFactor/sortResults)');
  }

  console.log('[pf] invoking runPowerFactor with', { level, timeMinutes });
  const { results, config } = runPowerFactor({ level, timeMinutes });
  const sorted = sortResults(results);

  const payload = { generatedAt: new Date().toISOString(), level, timeMinutes, config, results: sorted };
  const outPath = path.resolve(process.cwd(), outFile);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Power factor results written to ${outPath}`);
  if (shouldPrint) {
    const f = v => Math.round(v * 100) / 100;
    for (const r of sorted) {
      const s = r.scenarios;
      console.log(`${String(r.operativeName).padEnd(20)} total=${f(r.totalPF).toFixed(2)}  B=${f(s.BOSS.PF).toFixed(2)} E=${f(s.ELITE.PF).toFixed(2)} H=${f(s.HORDE.PF).toFixed(2)}`);
    }
  }
}

main().catch(err => {
  try {
    const logPath = path.resolve(process.cwd(), 'pf-error.log');
    fs.writeFileSync(logPath, String(err && (err.stack || err.message || err)));
    console.error('[pf] failed, see pf-error.log');
  } catch {}
  console.error(err);
  process.exit(1);
});
