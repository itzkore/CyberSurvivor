#!/usr/bin/env node
/**
 * Procedurally generate elite enemy/projectile/VFX PNGs from simple SVGs.
 * - Pure JS, no native builds: uses @resvg/resvg-js to rasterize SVG.
 * - Transparent backgrounds, top-down silhouettes with neon accents.
 * - Sizes follow scripts/elite-sprite-prompts.md.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

// Output directories
const OUT_ENEMIES = path.resolve(__dirname, '../public/assets/enemies/elite');
const OUT_PROJECTILES = path.resolve(__dirname, '../public/assets/projectiles/elite');
const OUT_VFX = path.resolve(__dirname, '../public/assets/vfx');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

ensureDir(OUT_ENEMIES);
ensureDir(OUT_PROJECTILES);
ensureDir(OUT_VFX);

// Helpers
function svg(docW, docH, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${docW}" height="${docH}" viewBox="0 0 ${docW} ${docH}">\n${body}\n</svg>`;
}

function neon(color, alpha = 1) {
  return color.replace(/\)$/, `, ${alpha})`).replace('rgb(', 'rgba(');
}

function saveSvgToPng(svgStr, outPath, w, h) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: 'width', value: w },
    background: 'rgba(0,0,0,0)'
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  fs.writeFileSync(outPath, pngBuffer);
}

// Palette
const CYAN = 'rgb(0,230,215)';
const MAGENTA = 'rgb(255,77,210)';
const BLUE = 'rgb(49,168,255)';
const VIOLET = 'rgb(155,108,255)';
const GREEN = 'rgb(87,255,176)';
const ORANGE = 'rgb(255,168,77)';
const RED = 'rgb(255,65,54)';

// Primitive builders
function buildTriDroneSVG(size, accent) {
  const s = size;
  const cx = s/2, cy = s/2;
  const r = s*0.42;
  // Triangle points
  const p1 = `${cx},${cy-r}`;
  const p2 = `${cx-r*0.9},${cy+r*0.9}`;
  const p3 = `${cx+r*0.9},${cy+r*0.9}`;
  const body = `
    <defs>
      <radialGradient id="g" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stop-color="#16181d"/>
        <stop offset="100%" stop-color="#0d0f12"/>
      </radialGradient>
    </defs>
    <polygon points="${p1} ${p2} ${p3}" fill="url(#g)" stroke="${neon(accent,0.9)}" stroke-width="3" />
    <line x1="${cx}" y1="${cy-r*0.65}" x2="${cx}" y2="${cy-r*0.95}" stroke="${neon(accent,1)}" stroke-width="3" stroke-linecap="round" />
    <circle cx="${cx}" cy="${cy}" r="${r*0.2}" fill="${neon(accent,0.6)}" />
  `;
  return svg(s, s, body);
}

function buildBeetleSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.42;
  const body = `
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r*0.8}" fill="#121419" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    <line x1="${cx}" y1="${cy-r*0.8}" x2="${cx}" y2="${cy+r*0.8}" stroke="${neon(accent,0.4)}" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="${r*0.22}" fill="${neon(RED,0.75)}" />
  `;
  return svg(s, s, body);
}

function buildArrowheadSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.44;
  const p1 = `${cx},${cy-r}`;
  const p2 = `${cx-r*0.6},${cy+r*0.7}`;
  const p3 = `${cx+r*0.6},${cy+r*0.7}`;
  const body = `
    <polygon points="${p1} ${p2} ${p3}" fill="#111318" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    <polygon points="${cx},${cy-r*0.6} ${cx-r*0.2},${cy+r*0.5} ${cx+r*0.2},${cy+r*0.5}" fill="${neon(accent,0.6)}"/>
  `;
  return svg(s, s, body);
}

function buildTurretSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2;
  const body = `
    <rect x="${cx-s*0.25}" y="${cy-s*0.25}" width="${s*0.5}" height="${s*0.5}" rx="6" ry="6" fill="#13161c" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    <rect x="${cx-s*0.08}" y="${cy-s*0.45}" width="${s*0.16}" height="${s*0.2}" fill="${neon(accent,0.7)}"/>
  `;
  return svg(s, s, body);
}

function buildDiamondSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.42;
  const body = `
    <polygon points="${cx},${cy-r} ${cx-r},${cy} ${cx},${cy+r} ${cx+r},${cy}" fill="#12141a" stroke="${neon(accent,0.9)}" stroke-width="3"/>
  `;
  return svg(s, s, body);
}

function buildSegmentedSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.38;
  const body = `
    <ellipse cx="${cx}" cy="${cy-r*0.6}" rx="${r*0.7}" ry="${r*0.45}" fill="#111417" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r*0.55}" fill="#0f1412" stroke="${neon(accent,0.6)}" stroke-width="2"/>
    <ellipse cx="${cx}" cy="${cy+r*0.6}" rx="${r*0.7}" ry="${r*0.45}" fill="#111417" stroke="${neon(accent,0.9)}" stroke-width="3"/>
  `;
  return svg(s, s, body);
}

function buildSpiderSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.3;
  const legs = Array.from({length:4}, (_,i)=>{
    const off = (i-1.5)*r*0.6;
    return `<line x1="${cx-r}" y1="${cy+off}" x2="${cx+r}" y2="${cy+off}" stroke="${neon(accent,0.6)}" stroke-width="2"/>`;
  }).join('\n');
  const body = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#121519" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    ${legs}
  `;
  return svg(s, s, body);
}

function buildOrbSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.4;
  const body = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#12131a" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${r*0.25}" fill="${neon(accent,0.5)}"/>
  `;
  return svg(s, s, body);
}

// Projectiles / VFX
function buildBoltSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2;
  const body = `
    <ellipse cx="${cx}" cy="${cy}" rx="${s*0.35}" ry="${s*0.18}" fill="${neon(accent,1)}"/>
  `;
  return svg(s, s, body);
}

function buildStreakSVG(size, accent1, accent2) {
  const s = size; const cx = s/2, cy = s/2;
  const body = `
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${accent1}"/>
        <stop offset="100%" stop-color="${accent2}"/>
      </linearGradient>
    </defs>
    <polygon points="${cx-s*0.4},${cy-s*0.2} ${cx+s*0.45},${cy} ${cx-s*0.4},${cy+s*0.2}" fill="url(#lg)" />
  `;
  return svg(s, s, body);
}

function buildRingSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.4;
  const body = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${neon(accent,0.9)}" stroke-width="3"/>
  `;
  return svg(s, s, body);
}

function buildMineSVG(size, accent) {
  const s = size; const cx = s/2, cy = s/2; const r = s*0.35;
  const body = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a1411" stroke="${neon(accent,0.9)}" stroke-width="3"/>
    <polygon points="${cx-r*0.9},${cy} ${cx},${cy-r*0.9} ${cx+r*0.9},${cy} ${cx},${cy+r*0.9}" fill="${neon(accent,0.5)}"/>
  `;
  return svg(s, s, body);
}

// Jobs
const jobs = [
  // Enemies 64x64
  { out: path.join(OUT_ENEMIES, 'elite_gunner.png'), build: () => buildTriDroneSVG(64, CYAN) },
  { out: path.join(OUT_ENEMIES, 'elite_bomber.png'), build: () => buildBeetleSVG(64, ORANGE) },
  { out: path.join(OUT_ENEMIES, 'elite_charger.png'), build: () => buildArrowheadSVG(64, MAGENTA) },
  { out: path.join(OUT_ENEMIES, 'elite_suppressor.png'), build: () => buildTurretSVG(64, BLUE) },
  { out: path.join(OUT_ENEMIES, 'elite_blinker.png'), build: () => buildDiamondSVG(64, VIOLET) },
  { out: path.join(OUT_ENEMIES, 'elite_splicer.png'), build: () => buildSegmentedSVG(64, GREEN) },
  { out: path.join(OUT_ENEMIES, 'elite_mine_layer.png'), build: () => buildSpiderSVG(64, ORANGE) },
  { out: path.join(OUT_ENEMIES, 'elite_siphon.png'), build: () => buildOrbSVG(64, VIOLET) },
  { out: path.join(OUT_ENEMIES, 'elite_splicer_mini.png'), build: () => buildSegmentedSVG(64, GREEN) },

  // Projectiles 24-32
  { out: path.join(OUT_PROJECTILES, 'elite_gunner_bolt.png'), build: () => buildBoltSVG(24, CYAN) },
  { out: path.join(OUT_VFX, 'elite_charger_streak.png'), build: () => buildStreakSVG(32, MAGENTA, MAGENTA) },
  { out: path.join(OUT_VFX, 'elite_suppressor_shield.png'), build: () => buildRingSVG(64, BLUE) },
  { out: path.join(OUT_PROJECTILES, 'elite_bomber_core.png'), build: () => buildOrbSVG(32, ORANGE) },
  { out: path.join(OUT_PROJECTILES, 'elite_mine.png'), build: () => buildMineSVG(32, ORANGE) },

  // Meteor VFX
  { out: path.join(OUT_VFX, 'meteor_streak.png'), build: () => buildStreakSVG(32, ORANGE, RED) },
  { out: path.join(OUT_VFX, 'ground_telegraph.png'), build: () => buildRingSVG(32, ORANGE) }
];

let ok = 0;
for (const job of jobs) {
  try {
    const svgStr = job.build();
    saveSvgToPng(svgStr, job.out, 64, 64);
    ok++;
  } catch (e) {
    console.error('Failed to generate', job.out, e);
  }
}

console.log(`Elite sprites generated: ${ok}/${jobs.length}`);
