/**
 * BalanceSimulator: headless, fixed-timestep combat simulation to compare character balance.
 * It reuses core gameplay systems (Player, EnemyManager, BulletManager, BossManager) without rendering.
 *
 * Design goals
 * - Zero DOM drawing; just logic updates
 * - Minimal global stubs for window/performance/document
 * - Deterministic-ish runs per seed; fast and memory-light
 */
import { Player } from '../game/Player';
import { EnemyManager } from '../game/EnemyManager';
import { BulletManager } from '../game/BulletManager';
import { BossManager } from '../game/BossManager';
import { ExplosionManager } from '../game/ExplosionManager';
import { SpatialGrid } from '../physics/SpatialGrid';
import type { Bullet } from '../game/Bullet';
import type { Enemy } from '../game/EnemyManager';
import { AssetLoader } from '../game/AssetLoader';
import type { CharacterData } from '../data/characters';
import { ParticleManager } from '../game/ParticleManager';
import { UpgradePanel } from '../ui/UpgradePanel';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { WeaponType } from '../game/WeaponType';
import { keyState } from '../game/keyState';

// ---------- Minimal environment stubs (Node-safe) ----------
const g: any = (globalThis as any);
if (typeof g.performance === 'undefined') {
  g.performance = { now: () => Date.now() };
}
if (typeof g.window === 'undefined') {
  g.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
}
// requestAnimationFrame / cancelAnimationFrame stubs for Node
if (typeof g.requestAnimationFrame === 'undefined') {
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
}
if (typeof g.cancelAnimationFrame === 'undefined') {
  g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as NodeJS.Timeout);
}
if (!(g.window as any).requestAnimationFrame) (g.window as any).requestAnimationFrame = g.requestAnimationFrame;
if (!(g.window as any).cancelAnimationFrame) (g.window as any).cancelAnimationFrame = g.cancelAnimationFrame;
if (typeof g.location === 'undefined') {
  g.location = { protocol: 'file:', pathname: '/', href: 'file:///' } as any;
}
if (typeof g.document === 'undefined') {
  // Very tiny createElement stub for canvas usage in a few managers (no drawing).
  const makeNoop2D = () => {
    const handler: ProxyHandler<any> = {
      get: (_t, _p) => {
        // return a no-op function for any method; for properties, return 0/empty
        return (..._args: any[]) => {};
      },
      set: () => true,
    };
    return new Proxy({}, handler);
  };
  g.document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const fakeCanvas: any = {
          width: 0,
          height: 0,
          style: {},
          getContext: (_type?: string) => makeNoop2D(),
          toDataURL: () => 'data:',
        };
        return fakeCanvas as HTMLCanvasElement;
      }
      return { style: {} } as any;
    },
    getElementById: (_id: string) => null,
    body: {
      appendChild: (_el: any) => {},
      removeChild: (_el: any) => {},
    },
    querySelector: () => null,
  } as any;
}
if (typeof g.Image === 'undefined') {
  // Minimal Image stub with src setter, onload/onerror callbacks
  class NodeImage {
    public src: string = '';
    public width: number = 0;
    public height: number = 0;
    public onload: ((this: any, ev?: any) => any) | null = null;
    public onerror: ((this: any, ev?: any) => any) | null = null;
    constructor() {
      // simulate async load success
      setTimeout(() => { try { this.onload && this.onload.call(this, undefined); } catch {} }, 0);
    }
  }
  g.Image = NodeImage as any;
}
// Minimal Event/CustomEvent polyfill for Node
if (typeof g.Event === 'undefined') {
  g.Event = function(this: any, type: string) { this.type = type; } as any;
}
if (typeof g.CustomEvent === 'undefined') {
  g.CustomEvent = function(this: any, type: string, params?: any) {
    (g.Event as any).call(this, type);
    this.detail = params && params.detail;
  } as any;
}

export type SimResult = {
  id: string;
  name?: string;
  seed: number;
  durationSec: number;
  survivalSec: number;
  kills: number;
  level: number;
  damageTaken: number;
  xpOrbsCollected: number;
  peakEnemies: number;
};

export type SimConfig = {
  durationSec?: number; // maximum simulated seconds (default 90)
  seeds?: number[];     // list of seeds for multiple runs
  worldSize?: number;   // logical world extents (square), default 4000*20
  difficulty?: number;  // enemy difficulty scaling (1 = base)
  gameMode?: 'NORMAL' | 'SHOWDOWN' | string; // allow choosing gameplay mode hint for systems
  // Loadout controls
  initialWeapons?: Array<WeaponType | string>;
  initialPassives?: Array<number | string>;
  autoUpgrade?: boolean; // default true; set false to disable auto-upgrade selection on level up
  // Pressure/stress test controls (sim-only)
  pressure?: Partial<{
    enabled: boolean;           // master switch
    spawnRateMul: number;       // packs per second multiplier (1 = baseline)
    packSize: number;           // enemies per pack
    hpMul: number;              // enemy hp multiplier on spawn
    speedMul: number;           // enemy speed multiplier on spawn
    rampPerMin: number;         // linear spawn multiplier ramp per minute (e.g., 0.5 => +50% per minute)
    eliteChance: number;        // 0..1 probability each spawned enemy becomes an elite
    eliteHpMul: number;         // additional hp multiplier for elites
    eliteSpeedMul: number;      // additional speed multiplier for elites
    ringRadius: number;         // spawn radius around player
    tickMs: number;             // how often to inject pressure packs
  }>;
  // Logging controls
  logEvents?: boolean;                // when true, emit detailed events
  onEvent?: (e: SimEvent) => void;    // sink for events (e.g., file writer)
  captureEventsInResult?: boolean;    // include events in returned SimResult (can be large)
};

export type SimEvent = {
  t: number; // seconds since start
  type: 'start' | 'tick' | 'levelup' | 'upgrade' | 'xp' | 'damage' | 'bossSpawn' | 'bossStart' | 'bossDefeated' | 'end';
  data?: any;
};

/**
 * Run a single headless simulation for a character and seed.
 * Inputs:
 *  - char: Character data (from CHARACTERS)
 *  - seed: number used to seed Math.random (LCG)
 *  - cfg: optional config
 * Output: SimResult with survival time, kills, level, etc.
 */
export function runCharacterSim(char: CharacterData, seed: number, cfg: SimConfig = {}): SimResult {
  // --- Config defaults
  const durationSec = Math.max(10, Math.min(cfg.durationSec ?? 90, 1800));
  const world = Math.floor(cfg.worldSize ?? (4000 * 20));
  const difficulty = Math.max(0.5, cfg.difficulty ?? 1);
  const gameMode = (cfg.gameMode as any) || 'NORMAL';

  // --- Deterministic RNG (simple LCG) to reduce variance between runs without changing game code
  let lcg = (seed >>> 0) || 1;
  const rand = () => { lcg = (1103515245 * lcg + 12345) & 0x7fffffff; return (lcg >>> 0) / 0x7fffffff; };
  const origRandom = Math.random;
  Math.random = rand; // override temporarily

  // --- Event helpers
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => {
    if (cfg.logEvents && typeof cfg.onEvent === 'function') cfg.onEvent(e);
    if (cfg.captureEventsInResult) events.push(e);
  };

  // --- Core managers (no rendering)
  const particleManager = new ParticleManager(0); // zero initial particles; we don't draw
  const enemySpatial = new SpatialGrid<Enemy>(200);
  const bulletSpatial = new SpatialGrid<Bullet>(100);
  const assetLoader = new AssetLoader();
  // Player spawn at center
  const player = new Player(world / 2, world / 2, char);
  const enemyMgr = new EnemyManager(player, bulletSpatial, particleManager, assetLoader, difficulty);
  const bossMgr = new BossManager(player, particleManager, difficulty, assetLoader);
  const bulletMgr = new BulletManager(assetLoader, enemySpatial, particleManager, enemyMgr, player);
  const explosionMgr = new ExplosionManager(particleManager, enemyMgr, player, bulletMgr);

  // Wire up cross-refs the way Game does
  (player as any).setEnemyProvider(() => enemyMgr.getEnemies());
  (player as any).setGameContext({
    bulletManager: bulletMgr,
    assetLoader,
    explosionManager: explosionMgr,
  enemyManager: enemyMgr,
    getGameTime: () => elapsedSec,
  });

  // Minimal globals a few systems check
  try {
  const w: any = window as any;
    w.__bossManager = bossMgr;
    // Minimal game instance and viewport for systems that rely on them
  w.__gameInstance = { gameMode };
    w.__designWidth = 1280; w.__designHeight = 720;
    w.__camX = Math.max(0, player.x - (w.__designWidth >> 1));
    w.__camY = Math.max(0, player.y - (w.__designHeight >> 1));
  // Signal start of game (treasures, some systems latch onto this)
  try { w.dispatchEvent(new CustomEvent('startGame')); } catch {}
  // Hook boss-related events for logs
  try { w.addEventListener('bossSpawn', (ev: Event) => emit({ t: 0, type: 'bossSpawn', data: (ev as CustomEvent).detail })); } catch {}
  try { w.addEventListener('bossFightStart', (ev: Event) => emit({ t: 0, type: 'bossStart', data: (ev as CustomEvent).detail })); } catch {}
  try { w.addEventListener('bossDefeated', () => emit({ t: 0, type: 'bossDefeated' })); } catch {}
  } catch {}

  // --- Apply initial loadout (weapons/passives) if provided
  const applyInitialLoadout = () => {
    try {
      if (cfg.initialWeapons && cfg.initialWeapons.length) {
        for (let i = 0; i < cfg.initialWeapons.length; i++) {
          const w = cfg.initialWeapons[i];
          let wt: any = w as any;
          if (typeof w === 'string') {
            const key = w.trim();
            if ((WeaponType as any)[key] != null) wt = (WeaponType as any)[key];
          }
          try { if (typeof wt === 'number') player.addWeapon(wt as WeaponType); } catch {}
        }
      }
      if (cfg.initialPassives && cfg.initialPassives.length) {
        for (let i = 0; i < cfg.initialPassives.length; i++) {
          const p = cfg.initialPassives[i] as any;
          let spec = null as any;
          if (typeof p === 'number') spec = PASSIVE_SPECS.find(s => s.id === p);
          else if (typeof p === 'string') {
            const name = p.trim().toLowerCase();
            spec = PASSIVE_SPECS.find(s => s.name.toLowerCase() === name);
          }
          if (spec) { try { player.addPassive(spec.name); } catch {} }
        }
      }
    } catch {}
  };
  applyInitialLoadout();

  // --- Simulation state
  const dtMs = 16.6667; // 60 Hz fixed
  const maxSteps = Math.round((durationSec * 1000) / dtMs);
  let elapsedSec = 0;
  let damageTaken = 0;
  let peakEnemies = 0;
  let xpOrbsCollected = 0;
  let lastKills = 0;
  let nextTickLog = 1;
  // Emit run start event
  emit({ t: 0, type: 'start', data: { id: char.id, name: (char as any).name, seed, durationSec, difficulty } });
  // Hook into damage to player by monkey patching set hp or tracking before/after
  const origUpdatePlayer = player.update.bind(player);
  player.update = (delta: number) => {
    const hpBefore = player.hp;
    origUpdatePlayer(delta);
    const diff = hpBefore - player.hp;
    if (diff > 0) { damageTaken += diff; emit({ t: elapsedSec, type: 'damage', data: { amount: diff, hp: player.hp } }); }
  };

  // --- Input-driven autopilot (WASD) for realistic XP pickup and kiting
  const isGhost = (char as any)?.id === 'ghost_operative';
  const autopilot = () => {
    // Reset inputs each frame
    keyState['w'] = keyState['a'] = keyState['s'] = keyState['d'] = false;

    const anyP: any = player as any;
    // Detect Ghost sniper charging
    let charging = false;
    try {
      if (isGhost && typeof anyP.getGhostSniperCharge === 'function') {
        const s = anyP.getGhostSniperCharge();
        charging = (s?.state === 'charging');
        // Auto‑cloak at charge start when available
        if (charging && !anyP.cloakActive && (anyP.cloakCdMs || 0) <= 0) {
          try { if (typeof anyP.activateAbility === 'function') anyP.activateAbility(); } catch {}
        }
      }
    } catch {}

    // While charging the sniper: stay still to avoid canceling charge
    if (charging) return;

    // Compute a desired direction from XP attraction and enemy repulsion
    const enemies = enemyMgr.getEnemies?.() || (enemyMgr as any).enemies || [];
    const gems = enemyMgr.getActiveGems?.() || (enemyMgr as any).getGems?.() || [];

    // Nearest gem within seek range
    let gx = 0, gy = 0; let hasGem = false;
    let bestD2 = Infinity; const seekR = 720; const seekR2 = seekR * seekR;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i]; if (!g || !g.active) continue;
      const dx = g.x - player.x; const dy = g.y - player.y; const d2 = dx*dx + dy*dy;
      if (d2 < bestD2 && d2 <= seekR2) { bestD2 = d2; gx = g.x; gy = g.y; hasGem = true; }
    }

    // Enemy center-of-mass inside danger radius
    let ex = 0, ey = 0, en = 0; const dangerR = 260; const dangerR2 = dangerR * dangerR;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]; if (!e || !e.active || e.hp <= 0) continue;
      const dx = e.x - player.x; const dy = e.y - player.y; const d2 = dx*dx + dy*dy;
      if (d2 <= dangerR2) { ex += e.x; ey += e.y; en++; }
    }
    let vx = 0, vy = 0;
    if (hasGem) {
      let dx = gx - player.x; let dy = gy - player.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      vx += dx * 1.0; vy += dy * 1.0; // attraction weight
    }
    if (en > 0) {
      ex /= en; ey /= en; let dx = player.x - ex; let dy = player.y - ey; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      vx += dx * 1.4; vy += dy * 1.4; // stronger repulsion when crowded
    }
    // Default idle drift: slow rightward circle to keep spawn churn and orb pickup realistic
    if (!hasGem && en === 0) { vx = Math.cos(elapsedSec * 0.7); vy = Math.sin(elapsedSec * 0.7); }

    // Convert desired vector into WASD booleans
    const eps = 0.15; // deadzone
    if (vy < -eps) keyState['w'] = true; else if (vy > eps) keyState['s'] = true;
    if (vx < -eps) keyState['a'] = true; else if (vx > eps) keyState['d'] = true;
  };
  // Count XP orbs collected by intercepting gainExp (also catches chest EXP but acceptable)
  const origGainExp = player.gainExp.bind(player);
  player.gainExp = (amount: number) => { xpOrbsCollected++; emit({ t: elapsedSec, type: 'xp', data: { amount, level: player.level } }); origGainExp(amount); };

  // Auto-upgrade on levelup using UpgradePanel's option generator (no UI shown)
  if (cfg.autoUpgrade !== false) {
    try {
      const gameStub = { setState: (_s: any) => {} } as any;
      const panel = new UpgradePanel(player as any, gameStub);
      const pickAndApplyUpgrade = () => {
        const opts = panel.generateOptions();
        if (!opts || !opts.length) return;
        // Priority: evolved weapon > class weapon > passive > any weapon > skip
        let chosen = opts.find(o => o.type === 'weapon' && (WEAPON_SPECS[o.id as WeaponType]?.maxLevel || 1) === 1)
                   || opts.find(o => o.type === 'weapon' && (player.characterData?.defaultWeapon === (o.id as number)))
                   || opts.find(o => o.type === 'passive')
                   || opts.find(o => o.type === 'weapon')
                   || opts[0];
        if (!chosen) return;
        if (chosen.type === 'weapon') {
          player.addWeapon(chosen.id as WeaponType);
        } else if (chosen.type === 'passive') {
          const spec = PASSIVE_SPECS.find(p => p.id === (chosen!.id as number));
          if (spec) player.addPassive(spec.name);
        }
      };
      // Listen directly to levelup events the Player dispatches
      (window as any).addEventListener('levelup', () => { emit({ t: elapsedSec, type: 'levelup', data: { level: player.level + 1 } }); pickAndApplyUpgrade(); });
    } catch { /* ignore auto-upgrade wiring issues in headless */ }
  }

  // --- High-pressure spawner (simulation-only)
  const px = Object.assign({
    enabled: false,
    spawnRateMul: 1.0,
    packSize: 6,
    hpMul: 1.0,
    speedMul: 1.0,
    rampPerMin: 0.0,
    eliteChance: 0.0,
    eliteHpMul: 2.0,
    eliteSpeedMul: 1.3,
    ringRadius: 360,
    tickMs: 1000,
  }, cfg.pressure || {});
  let pxAccMs = 0;
  const spawnPack = (count: number) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = px.ringRadius + (Math.random() * 60 - 30);
      const x = player.x + Math.cos(a) * r;
      const y = player.y + Math.sin(a) * r;
      let spawned: any = null;
      try { spawned = (enemyMgr as any).spawnEnemyAt(x, y, { type: 'small' }); } catch {}
      if (spawned && typeof spawned === 'object') {
        const isElite = Math.random() < (px.eliteChance || 0);
        const hpMul = (px.hpMul || 1) * (isElite ? (px.eliteHpMul || 1) : 1);
        const spdMul = (px.speedMul || 1) * (isElite ? (px.eliteSpeedMul || 1) : 1);
        if (typeof spawned.hp === 'number') spawned.hp = Math.max(1, Math.floor(spawned.hp * hpMul));
        if (typeof spawned.maxHp === 'number') spawned.maxHp = Math.max(spawned.hp || 1, Math.floor(spawned.maxHp * hpMul));
        if (typeof spawned.speed === 'number') spawned.speed *= spdMul;
        if (typeof spawned.moveSpeed === 'number') spawned.moveSpeed *= spdMul;
        if (isElite) { try { spawned.color = '#FF4444'; spawned.radius = (spawned.radius || 12) * 1.2; } catch {} }
      }
    }
  };

  // Simple fallback spawner: if no dynamic spawns yet, inject a few near the player every 1.5s
  let injectTimerMs = 0;
  const injectEveryMs = 1500;
  const tryInject = () => {
    const enemies = enemyMgr.getEnemies?.() || (enemyMgr as any).enemies || [];
    if (enemies.length > 8) return; // already busy
    const baseR = 280;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = player.x + Math.cos(a) * baseR;
      const y = player.y + Math.sin(a) * baseR;
      try { (enemyMgr as any).spawnEnemyAt(x, y, { type: 'small', hp: 60 }); } catch {}
    }
  };

  // --- Loop
  for (let step = 0; step < maxSteps; step++) {
    // advance time
    elapsedSec += dtMs / 1000;
  injectTimerMs += dtMs;
  if (px.enabled) pxAccMs += dtMs;
    // core order mirrors Game.update GAME state
  // Step autopilot before update so movement and ability choices affect this frame
  autopilot();
  player.update(dtMs);
    // Managers
    explosionMgr.update?.(dtMs as any);
    enemyMgr.update(dtMs, elapsedSec, bulletMgr.bullets);
    bossMgr.update(dtMs, elapsedSec);
    bulletMgr.update(dtMs);
    particleManager.update(dtMs);

    // Maintain spatial grids similar to Game
    enemySpatial.clear();
    const enemies = enemyMgr.getEnemies?.() || (enemyMgr as any).enemies || [];
    for (let i = 0, len = enemies.length; i < len; i++) { const e = enemies[i]; if (e.active) enemySpatial.insert(e); }
    bulletSpatial.clear();
    const bullets = bulletMgr.bullets;
    for (let i = 0, len = bullets.length; i < len; i++) { const b = bullets[i]; if (b.active) bulletSpatial.insert(b); }

    // Clamp player within world (no rooms in sim) and update camera to follow
    if (player.x < 0) player.x = 0; else if (player.x > world) player.x = world;
    if (player.y < 0) player.y = 0; else if (player.y > world) player.y = world;
    try {
      const w: any = window as any; const halfW = (w.__designWidth >> 1); const halfH = (w.__designHeight >> 1);
      w.__camX = Math.max(0, Math.min(world - w.__designWidth, player.x - halfW));
      w.__camY = Math.max(0, Math.min(world - w.__designHeight, player.y - halfH));
    } catch {}

  // Track metrics
    if (enemies.length > peakEnemies) peakEnemies = enemies.length;
  // Kill deltas
  try { const kc = (enemyMgr as any)?.getKillCount?.() ?? (enemyMgr as any)?.killCount ?? 0; if (kc !== lastKills) { emit({ t: elapsedSec, type: 'tick', data: { kills: kc, delta: kc - lastKills, level: player.level, enemies: enemies.length } }); lastKills = kc; } } catch {}
  // Per-second heartbeat
  if (elapsedSec >= nextTickLog) { emit({ t: elapsedSec, type: 'tick', data: { level: player.level, hp: player.hp, enemies: enemies.length, kills: lastKills } }); nextTickLog = Math.ceil(elapsedSec + 1); }

  // End condition: player dead
    if (player.hp <= 0) break;

  // Early safety injection only during the first few seconds if dynamic spawns lag (skip if pressure mode is on)
  if (!px.enabled && elapsedSec < 5 && injectTimerMs >= injectEveryMs) { injectTimerMs = 0; tryInject(); }
  // Pressure-mode injection: ramp spawn multiplier over time and inject packs at cadence
  if (px.enabled && pxAccMs >= (px.tickMs || 1000)) {
    pxAccMs = 0;
  const minutes = (elapsedSec / 60) + (((px as any).startAtMin as number) || 0);
    const ramp = 1 + Math.max(0, px.rampPerMin || 0) * minutes;
    const packs = Math.max(1, Math.floor((px.spawnRateMul || 1) * ramp));
    const perPack = Math.max(1, Math.floor(px.packSize || 6));
    for (let p = 0; p < packs; p++) spawnPack(perPack);
  }
  }

  const survivalSec = elapsedSec;
  const kills = (enemyMgr as any)?.getKillCount?.() ?? 0;
  // Emit end event
  emit({ t: survivalSec, type: 'end', data: { kills, level: player.level, damageTaken, xpOrbsCollected, peakEnemies } });
  const result: SimResult = {
    id: char.id,
    name: (char as any).name,
    seed,
    durationSec,
    survivalSec,
    kills,
    level: player.level,
    damageTaken,
  xpOrbsCollected,
    peakEnemies,
  };

  // restore RNG
  Math.random = origRandom;
  return result;
}

/**
 * Run a batch across provided characters and seeds; returns results matrix.
 */
export function runBatch(chars: CharacterData[], cfg: SimConfig = {}): SimResult[] {
  const seeds = (cfg.seeds && cfg.seeds.length) ? cfg.seeds : [1, 2, 3];
  const out: SimResult[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    for (let s = 0; s < seeds.length; s++) {
      out.push(runCharacterSim(c, seeds[s], cfg));
    }
  }
  return out;
}

/**
 * Utility: Aggregate simple per-character stats (mean survival, mean kills).
 */
export function summarize(results: SimResult[]): Record<string, { meanSurvival: number; meanKills: number; meanLevel: number }>{
  const acc: Record<string, { t: number; s: number; k: number; l: number }> = {};
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const a = acc[r.id] || (acc[r.id] = { t: 0, s: 0, k: 0, l: 0 });
    a.t++;
    a.s += r.survivalSec;
    a.k += r.kills;
    a.l += r.level;
  }
  const out: Record<string, { meanSurvival: number; meanKills: number; meanLevel: number }> = {};
  const ids = Object.keys(acc);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const a = acc[id];
    out[id] = { meanSurvival: a.s / a.t, meanKills: a.k / a.t, meanLevel: a.l / a.t };
  }
  return out;
}

/**
 * Compute a composite "power factor" per character from raw SimResults.
 * The score combines normalized KPM, survival%, level rate, and XP orb rate,
 * with a small penalty for high damage taken per second. Output is 0..100-ish.
 */
export function computePowerFactors(results: SimResult[]): Record<string, {
  power: number;
  components: { kpmN: number; survivalN: number; levelN: number; orbN: number; dmgN: number };
  raw: { durationSec: number; survivalSec: number; kills: number; level: number; xpOrbsCollected: number; damageTaken: number };
}> {
  // Aggregate per id across runs (take means of raw metrics first, then normalize across ids)
  const acc: Record<string, { t: number; duration: number; survival: number; kills: number; level: number; orbs: number; dmg: number }> = {};
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const a = acc[r.id] || (acc[r.id] = { t: 0, duration: 0, survival: 0, kills: 0, level: 0, orbs: 0, dmg: 0 });
    a.t++;
    a.duration += r.durationSec;
    a.survival += r.survivalSec;
    a.kills += r.kills;
    a.level += r.level;
    a.orbs += (r as any).xpOrbsCollected || 0;
    a.dmg += r.damageTaken || 0;
  }
  const ids = Object.keys(acc);
  // Compute means and derived rates
  const means = ids.map((id) => {
    const a = acc[id];
    const t = Math.max(1, a.t);
    const duration = a.duration / t;
    const survival = a.survival / t;
    const kills = a.kills / t;
    const level = a.level / t;
    const orbs = a.orbs / t;
    const dmg = a.dmg / t;
    const kpm = kills / Math.max(1e-6, duration) * 60;
    const survivalPct = Math.min(1, survival / Math.max(1e-6, duration));
    const levelRate = level / Math.max(1e-6, duration);
    const orbRate = orbs / Math.max(1e-6, duration);
    const dmgPerSec = dmg / Math.max(1, survival); // only while alive
    return { id, duration, survival, kills, level, orbs, dmg, kpm, survivalPct, levelRate, orbRate, dmgPerSec };
  });
  // Min/max for normalization
  const mm = (sel: (x: any) => number) => {
    let mn = Infinity, mx = -Infinity; for (let i = 0; i < means.length; i++) { const v = sel(means[i]); if (v < mn) mn = v; if (v > mx) mx = v; }
    return { mn, mx };
  };
  const mmKpm = mm(m => m.kpm);
  const mmSurv = mm(m => m.survivalPct);
  const mmLvl = mm(m => m.levelRate);
  const mmOrb = mm(m => m.orbRate);
  const mmDmg = mm(m => m.dmgPerSec);
  const norm = (v: number, mn: number, mx: number) => { if (!isFinite(v)) return 0; if (mx <= mn) return 0.5; const n = (v - mn) / (mx - mn); return n < 0 ? 0 : (n > 1 ? 1 : n); };
  // Weights: must sum to 1 for positives; damage is a penalty applied after
  const wKpm = 0.40, wSurv = 0.35, wLvl = 0.15, wOrb = 0.10; const dmgPenalty = 0.15; // overall scale later to 0..100
  const out: Record<string, { power: number; components: { kpmN: number; survivalN: number; levelN: number; orbN: number; dmgN: number }; raw: any }> = {};
  for (let i = 0; i < means.length; i++) {
    const m = means[i];
    const kpmN = norm(m.kpm, mmKpm.mn, mmKpm.mx);
    const survivalN = norm(m.survivalPct, mmSurv.mn, mmSurv.mx);
    const levelN = norm(m.levelRate, mmLvl.mn, mmLvl.mx);
    const orbN = norm(m.orbRate, mmOrb.mn, mmOrb.mx);
    const dmgN = norm(m.dmgPerSec, mmDmg.mn, mmDmg.mx);
    const positive = wKpm * kpmN + wSurv * survivalN + wLvl * levelN + wOrb * orbN; // 0..1
    const score = Math.max(0, (positive - dmgPenalty * dmgN)) * 100; // scale to ~0..100
    out[m.id] = {
      power: score,
      components: { kpmN, survivalN, levelN, orbN, dmgN },
      raw: { durationSec: m.duration, survivalSec: m.survival, kills: m.kills, level: m.level, xpOrbsCollected: m.orbs, damageTaken: m.dmg },
    };
  }
  return out;
}
