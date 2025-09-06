#!/usr/bin/env node
// Remove generated elite placeholders so we can replace with hand-made art.
const fs = require('fs');
const path = require('path');

const enemyDir = path.resolve(__dirname, '../public/assets/enemies/elite');
const projDir = path.resolve(__dirname, '../public/assets/projectiles/elite');
const vfxDir = path.resolve(__dirname, '../public/assets/vfx');

const enemyFiles = [
  'elite_gunner.png','elite_bomber.png','elite_charger.png','elite_suppressor.png',
  'elite_blinker.png','elite_splicer.png','elite_mine_layer.png','elite_siphon.png','elite_splicer_mini.png'
];
const projFiles = ['elite_gunner_bolt.png','elite_bomber_core.png','elite_mine.png'];
const vfxFiles = ['elite_charger_streak.png','elite_suppressor_shield.png','meteor_streak.png','ground_telegraph.png'];

function rm(dir, files) {
  for (const f of files) {
    const p = path.join(dir, f);
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

rm(enemyDir, enemyFiles);
rm(projDir, projFiles);
rm(vfxDir, vfxFiles);

console.log('Elite placeholder assets removed (if present).');
