/*
  Deterministic Power Factor model (no simulation).
  Computes scenario-weighted power from weapon/character data.

  Notes:
  - Focuses on default weapon per operative. Includes special handling for Scavenger (Scrap Lash + Surge).
  - Designed to be extended: add per-weapon adapters for AoE/control as needed.
*/

import { CHARACTERS } from '../data/characters';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { WeaponType } from '../game/WeaponType';

export type ScenarioKey = 'BOSS' | 'ELITE' | 'HORDE';

export interface ScenarioWeights {
  BOSS: number;
  ELITE: number;
  HORDE: number;
}

export interface ReliabilityKnobs {
  pHit: Record<ScenarioKey, number>;         // generic hit probability
  pChain?: Record<ScenarioKey, number>;      // for chain/bounce weapons
  overlapEff: Record<ScenarioKey, number>;   // AoE overlap efficiency
  uptime: Record<ScenarioKey, number>;       // fraction of time weapon can apply damage
}

export interface DensityModel {
  // expected active enemies per pixel^2 for each scenario
  rho: Record<ScenarioKey, number>;
  // average enemy radius in px (used for corridor width)
  enemyRadiusPx: number;
}

export interface SurvivabilityKnobs {
  kSurv: number;
  kSustain: number;
  ehpRef: number;
  hpmRef: number;
  clampMin: number;
  clampMax: number;
}

export interface PowerConfig {
  level: number; // weapon level to evaluate at (1..7)
  weights: ScenarioWeights;
  reliability: ReliabilityKnobs;
  density: DensityModel;
  survivability: SurvivabilityKnobs;
  timeMinutes?: number; // for heal efficiency shaping (0..)
}

export interface Breakdown {
  ST: number;        // single-target component
  AOE: number;       // aoe component
  Control: number;   // control/debuff value converted to dps-equivalent
  SurviveScale: number; // multiplicative gate
  PF: number;        // (ST+AOE+Control)*SurviveScale
}

export interface PFResult {
  operativeId: string;
  operativeName: string;
  defaultWeapon: WeaponType;
  scenarios: Record<ScenarioKey, Breakdown>;
  totalPF: number; // weighted sum across scenarios
}

// --- Helpers from repo balance behavior ---

function getHealEfficiency(gameTimeSec: number): number {
  const minutes = gameTimeSec / 60;
  if (minutes <= 15) return 1.0;
  if (minutes >= 30) return 0.01;
  const t = (minutes - 15) / 15; // 0..1 across 15->30m
  return 1.0 - 0.99 * t; // 1.0 -> 0.01
}

function computeEHP(hp: number, defense: number): number {
  return hp * (1 + defense / 50);
}

// BulletManager crit usage for Lash baseline: +0.08 base
function computeCritMult(agi: number, luck: number, baseOffset: number = 0): number {
  const p = Math.min(0.6, (agi * 0.5 + luck * 0.7) / 100 + baseOffset);
  const critMult = 2.0;
  return 1 + p * (critMult - 1);
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Expected targets hit by a radial blast (instant)
function expectedTargetsInRadius(rho: number, radius: number, cap: number = Number.POSITIVE_INFINITY): number {
  const e = rho * Math.PI * radius * radius;
  return Math.max(0, Math.min(cap, e));
}

// Expected unique hits along a path (line-sweep)
function expectedUniqueHitsLine(rho: number, pathLen: number, corridorWidth: number, cap: number = Number.POSITIVE_INFINITY): number {
  const area = pathLen * corridorWidth;
  const e = rho * area;
  return Math.max(0, Math.min(cap, e));
}

// Extract per-level damage/cooldown/speed/range from WEAPON_SPECS
function getWeaponLevelStats(weapon: WeaponType, level: number): { damage: number; cooldown: number; speed?: number; range?: number; projectileSize?: number; salvo?: number } {
  const spec: any = (WEAPON_SPECS as any)[weapon];
  if (!spec) return { damage: 0, cooldown: 60 };
  if (typeof spec.getLevelStats === 'function') {
    const s = spec.getLevelStats(level);
    return {
      damage: s.damage ?? spec.damage ?? 0,
      cooldown: s.cooldown ?? spec.cooldown ?? 60,
      speed: s.speed ?? spec.speed,
      range: s.range ?? spec.range,
    projectileSize: s.projectileSize,
    salvo: s.salvo ?? spec.salvo
    };
  }
  return { damage: spec.damage ?? 0, cooldown: spec.cooldown ?? 60, speed: spec.speed, range: spec.range, projectileSize: undefined, salvo: spec.salvo };
}

// Generic ST component (per-target contact cap optional)
function computeST(dmg: number, cooldownFrames: number, critMult: number, knobs: { uptime: number; pHit: number; targetAvailability: number; perTargetHitHzCap?: number; salvo?: number }): number {
  const salvo = knobs.salvo ?? 1;
  const rate = (60 / Math.max(1, cooldownFrames)) * salvo; // shots per sec
  const dpsRate = dmg * rate;
  const dpsCap = knobs.perTargetHitHzCap ? dmg * knobs.perTargetHitHzCap : Number.POSITIVE_INFINITY;
  const base = Math.min(dpsRate, dpsCap);
  const eff = base * critMult * knobs.uptime * knobs.pHit * knobs.targetAvailability;
  return eff;
}

// AoE component from surge-like instantaneous shocks
function computeAOEShockPair(params: { rho: number; radius: number; dmgPrimary: number; dmgSecondary: number; secondaryRadius: number; eventsPerSec: number; critMult: number; overlapEff: number; uptime: number; pHit: number }): number {
  const E1 = expectedTargetsInRadius(params.rho, params.radius);
  const E2 = expectedTargetsInRadius(params.rho, params.secondaryRadius);
  const perEvent = params.dmgPrimary * E1 + params.dmgSecondary * E2;
  const dps = perEvent * params.eventsPerSec * params.critMult * params.overlapEff * params.uptime * params.pHit;
  return dps;
}

// Control value from Armor Shred (+12% dmg taken for 0.6s)
function computeArmorShredValue(stWithoutShred: number, uptimeFrac: number): number {
  const bonus = 0.12;
  return stWithoutShred * bonus * clamp(uptimeFrac, 0, 1);
}

// Survivability scaling factor
function computeSurviveScale(hp: number, def: number, hpm: number, knobs: SurvivabilityKnobs): number {
  const ehp = computeEHP(hp, def);
  const part1 = knobs.kSurv * (ehp / Math.max(1e-6, knobs.ehpRef));
  const part2 = knobs.kSustain * (hpm / Math.max(1e-6, knobs.hpmRef));
  return clamp(part1 + part2, knobs.clampMin, knobs.clampMax);
}

// Lash-specific metrics
const LASH_PER_TARGET_HZ_CAP = 2.0; // 500ms per-target cooldown
const LASH_CRIT_OFFSET = 0.08;      // base offset used in BulletManager for Lash
const SURGE_THRESHOLD = 25;         // stacks per surge
const SURGE_RADIUS = 220;           // px
const SURGE_SECONDARY_FRAC = 0.20;
const SURGE_SECONDARY_RADIUS_FRAC = 0.65;
const AVG_ENEMY_RADIUS = 20;        // px (used in corridor width)

function buildOperativePF(operativeId: string, cfg: PowerConfig): PFResult {
  const char = CHARACTERS.find(c => c.id === operativeId);
  if (!char) throw new Error(`Unknown operative: ${operativeId}`);
  const level = clamp(Math.round(cfg.level), 1, 7);
  const defWeapon = char.defaultWeapon;
  const wStats = getWeaponLevelStats(defWeapon, level);

  const scenarios: Record<ScenarioKey, Breakdown> = { BOSS: null as any, ELITE: null as any, HORDE: null as any };

  // Crit multiplier baseline
  const critMultGeneric = computeCritMult(char.stats.agility, char.stats.luck, 0);
  const critMultLash = computeCritMult(char.stats.agility, char.stats.luck, LASH_CRIT_OFFSET);

  // Estimate UniqueHits_per_shot for Lash using a corridor around the path
  const range = wStats.range ?? 0;
  // Assume return travels similar distance; add 20% shrink from early catch for safety
  const pathLen = range * 2 * 0.8;
  const projRadius = (wStats.projectileSize ?? 18) * 0.5;
  const corridorWidth = (projRadius + AVG_ENEMY_RADIUS) * 2; // full width

  (['BOSS','ELITE','HORDE'] as ScenarioKey[]).forEach(scen => {
    const rho = cfg.density.rho[scen];
    const rel = cfg.reliability;
    const pHit = rel.pHit[scen] ?? 1;
    const overlapEff = rel.overlapEff[scen] ?? 1;
    const uptime = rel.uptime[scen] ?? 1;
    const targetAvailability = (scen === 'BOSS') ? 1 : (scen === 'ELITE' ? 0.85 : 0.5);

    let ST = 0, AOE = 0, Control = 0;
    let critMult = critMultGeneric;

  // Generic ST baseline
    const perTargetCapHz = undefined;
  ST = computeST(wStats.damage, wStats.cooldown, critMult, { uptime, pHit, targetAvailability, perTargetHitHzCap: perTargetCapHz, salvo: (wStats as any).salvo });

    // Specialize for scrap lash
    if (defWeapon === WeaponType.SCRAP_LASH) {
      // ST with per-target cap and Lash crit offset
      critMult = critMultLash;
  const ST_noCrit_noShred = computeST(wStats.damage, wStats.cooldown, 1, { uptime, pHit, targetAvailability, perTargetHitHzCap: LASH_PER_TARGET_HZ_CAP, salvo: (wStats as any).salvo });
      ST = ST_noCrit_noShred * critMult; // apply crit

      // Armor shred control value (on the focus target). Assume high uptime vs boss, less in crowds
      const shredUptime = (scen === 'BOSS') ? 0.9 : (scen === 'ELITE' ? 0.6 : 0.35);
      Control += computeArmorShredValue(ST_noCrit_noShred, shredUptime);

      // Scrap Surge AoE: surge every SURGE_THRESHOLD unique hits
      const uniqueHitsPerShot = expectedUniqueHitsLine(rho, pathLen, corridorWidth);
  const shotsPerSec = 60 / Math.max(1, wStats.cooldown);
      const eventsPerSec = (uniqueHitsPerShot * shotsPerSec) / SURGE_THRESHOLD;
      const dmgPrimary = Math.round(wStats.damage * 1.25); // globalDamageMultiplier assumed 1 here
      const dmgSecondary = Math.round(dmgPrimary * SURGE_SECONDARY_FRAC);
      const radius1 = SURGE_RADIUS;
      const radius2 = SURGE_RADIUS * SURGE_SECONDARY_RADIUS_FRAC;
      AOE += computeAOEShockPair({ rho, radius: radius1, dmgPrimary, dmgSecondary, secondaryRadius: radius2, eventsPerSec, critMult, overlapEff, uptime, pHit });
    }

    // Tachyon Spear: treat as a piercing dash-lance; model expected unique hits along lane
    if (defWeapon === WeaponType.TACHYON_SPEAR) {
  const shotsPerSec = (60 / Math.max(1, wStats.cooldown)) * ((wStats as any).salvo || 1);
      const spearWidth = 24; // approximate spear hit corridor
      const hits = Math.max(1, expectedUniqueHitsLine(rho, range || 680, spearWidth));
      const baseDps = wStats.damage * shotsPerSec * critMult * uptime * pHit;
      // Single-target portion stays in ST; extra hits contribute to AoE pressure
      const extraHits = Math.max(0, hits - 1);
      AOE += baseDps * extraHits;
    }

    // Psionic Wave: beam that sweeps a lane with pierce and thickness
    if (defWeapon === WeaponType.PSIONIC_WAVE) {
      // Pull beam params from level stats when present
      const len = (wStats as any).length ?? 132;
      const thick = (wStats as any).thickness ?? 12;
      const pierce = (wStats as any).pierce ?? 1;
  const shotsPerSec = (60 / Math.max(1, wStats.cooldown)) * ((wStats as any).salvo || 1);
      const hitsRaw = expectedUniqueHitsLine(rho, len, Math.max(8, thick));
      const hits = Math.max(1, Math.min(pierce + 1, hitsRaw));
      const perShot = wStats.damage * hits;
      const dps = perShot * shotsPerSec * critMult * overlapEff * uptime * pHit;
      // Allocate 1 target to ST and the rest to AoE to avoid double counting
      const singleDps = wStats.damage * shotsPerSec * critMult * uptime * pHit;
      ST = Math.max(ST, singleDps);
      AOE += Math.max(0, dps - singleDps);
      // Minor control from slow/mark (valued at 8% of ST on uptime)
      Control += singleDps * 0.08 * 0.6;
    }

    // Glyph Compiler: predictive pierce lances; cap by pierce
    if (defWeapon === WeaponType.GLYPH_COMPILER) {
      const pierce = (wStats as any).pierce ?? 1;
  const shotsPerSec = (60 / Math.max(1, wStats.cooldown)) * ((wStats as any).salvo || 1);
      const laneWidth = 20; // narrow lance width
      const hitsRaw = expectedUniqueHitsLine(rho, range || 760, laneWidth);
      const hits = Math.max(1, Math.min(pierce, hitsRaw));
      const perShot = wStats.damage * hits;
      const dps = perShot * shotsPerSec * critMult * overlapEff * uptime * pHit;
      const singleDps = wStats.damage * shotsPerSec * critMult * uptime * pHit;
      ST = Math.max(ST, singleDps);
      AOE += Math.max(0, dps - singleDps);
    }

    // Neural Threader (Nomad): threads anchor targets and pulse; model pulses as AoE over time
    if (defWeapon === WeaponType.NOMAD_NEURAL) {
  const shotsPerSec = (60 / Math.max(1, wStats.cooldown)) * ((wStats as any).salvo || 1);
      const anchors = (wStats as any).anchors ?? 2;
      const threadLifeSec = Math.max(0.5, ((wStats as any).threadLifeMs ?? 3000) / 1000);
      const pulseIntervalSec = Math.max(0.1, ((wStats as any).pulseIntervalMs ?? 500) / 1000);
      const pulsePct = Math.max(0, (wStats as any).pulsePct ?? 0.6);
      const expectedAnchors = Math.min(anchors, Math.max(1, expectedUniqueHitsLine(rho, range || 720, 24)));
      const pulsesPerSec = shotsPerSec * (threadLifeSec / pulseIntervalSec);
      const dps = (wStats.damage * pulsePct) * expectedAnchors * pulsesPerSec * critMult * overlapEff * uptime * pHit;
      AOE += dps;
      // Small control value for tethering effect
      Control += dps * 0.05;
    }

  // Bio Toxin: model boss DoT as ST; mobs via puddle AoE proportional to area and density
    if (defWeapon === WeaponType.BIO_TOXIN) {
      // Use EnemyManager poison model rough constants
      const poisonDpsPerStack = 6.4; // synced with EnemyManager after buff
      // For boss: density is 0, but poison stacks still deal ST damage over time
      if (scen === 'BOSS') {
    // Unlimited stacking on boss (no artificial cap):
    // Steady-state expected stacks ≈ stackAddRatePerSec * stackDurationSec.
    // From EnemyManager:
    //  - poisonTickIntervalMs = 500ms (2 Hz)
    //  - applyBossPoison(boss, 2) per BIO_TOXIN damage tick
    //  - poisonDurationMs = 4000ms (refresh per add)
    const tickHz = 2; // 500ms cadence
    const stacksPerTick = 2; // applyBossPoison(..., 2)
    const durationSec = 4; // 4000ms
    // Contact uptime: fraction of time boss is actually inside damaging puddles
    // Scales gently with level to reflect larger/longer puddles and better control
    const contactUptime = clamp(0.55 + 0.06 * (level - 1), 0.5, 0.95);
    const stackAddRatePerSec = stacksPerTick * tickHz * contactUptime;
    const avgBossStacks = stackAddRatePerSec * durationSec; // no cap
    // Mirror EnemyManager base level scaling (non-evolved): 1 + (level-1)*0.35
    const baseLevelMul = 1 + Math.max(0, (level - 1)) * 0.35;
    const evolvedMul = 1.0; // default weapon, not modeling evolved sludge here
    const inSludgeAmp = 1.0; // neutral by default
    const bossDps = poisonDpsPerStack * avgBossStacks * baseLevelMul * evolvedMul * inSludgeAmp;
    ST += bossDps * uptime * pHit;
      } else {
        // Puddle spawn per shot on expiration: approximate 1 puddle per shot
        const shotsPerSec = (60 / Math.max(1, wStats.cooldown)) * ((wStats as any).salvo || 1);
        // Puddle geometry proxy (from BulletManager defaults)
        const baseRadius = 32 + (level - 1) * 4; // slightly larger puddles
        const lifeSec = (3000 + (level - 1) * 300) / 1000; // longer life
        const puddlesActive = shotsPerSec * lifeSec * 1.2; // some mergers create larger zones
        const expectedTargets = expectedTargetsInRadius(rho, baseRadius);
        // Expected average stacks per enemy while standing in puddle; increase with level
        const avgStacks = Math.min(20, 6 + (level - 1) * 2.0);
        const dpsPerEnemy = poisonDpsPerStack * avgStacks;
        const dpsPerPuddle = dpsPerEnemy * expectedTargets;
        const aoeDps = dpsPerPuddle * puddlesActive * overlapEff * uptime * pHit;
        AOE += aoeDps;
      }
      // Tiny control valuation from slow (1% per stack up to 20% -> treat 10% avg as 10% ST value on availability)
      const controlUptime = 0.6;
      Control += ST * 0.10 * controlUptime * 0.25; // scaled down to avoid double-counting
    }

    // Survivability gate
    const timeSec = Math.max(0, (cfg.timeMinutes ?? 0) * 60);
    const healEff = getHealEfficiency(timeSec);
    let hpm = 0;
    if (defWeapon === WeaponType.SCRAP_LASH) {
      // Heal 5 HP per Surge event
      const uniqueHitsPerShot = expectedUniqueHitsLine(rho, pathLen, corridorWidth);
      const shotsPerSec = 60 / Math.max(1, wStats.cooldown);
      const eventsPerMin = (uniqueHitsPerShot * shotsPerSec * 60) / SURGE_THRESHOLD;
      hpm += eventsPerMin * 5 * healEff;
    }
    if (defWeapon === WeaponType.BIO_TOXIN) {
      // No innate healing; slight survivability from slows -> emulate +3 HPM equivalent
      hpm += 3 * healEff;
    }
    const surviveScale = computeSurviveScale(char.stats.hp, char.stats.defense, hpm, cfg.survivability);

    const PF = (ST + AOE + Control) * surviveScale;
    scenarios[scen] = { ST, AOE, Control, SurviveScale: surviveScale, PF };
  });

  const totalPF = (cfg.weights.BOSS * scenarios.BOSS.PF)
                + (cfg.weights.ELITE * scenarios.ELITE.PF)
                + (cfg.weights.HORDE * scenarios.HORDE.PF);

  return {
    operativeId: char.id,
    operativeName: char.name,
    defaultWeapon: defWeapon,
    scenarios,
    totalPF
  };
}

export interface RunOptions {
  level?: number;
  timeMinutes?: number;
}

export interface PowerRunResult {
  results: PFResult[];
  config: PowerConfig;
}

export function runPowerFactor(opts: RunOptions = {}): PowerRunResult {
  const level = clamp(Math.round(opts.level ?? 7), 1, 7);
  const timeMinutes = opts.timeMinutes ?? 15; // mid-run default

  const cfg: PowerConfig = {
    level,
    timeMinutes,
    weights: { BOSS: 0.35, ELITE: 0.25, HORDE: 0.40 },
    reliability: {
      pHit: { BOSS: 0.95, ELITE: 0.92, HORDE: 0.90 },
      pChain: { BOSS: 0.2, ELITE: 0.6, HORDE: 0.9 },
      overlapEff: { BOSS: 1.0, ELITE: 0.9, HORDE: 0.8 },
      uptime: { BOSS: 0.9, ELITE: 0.9, HORDE: 0.85 }
    },
    density: {
      // Choose rho so that within 220px radius, expected enemies ~10 in HORDE
      // area = pi*r^2 ≈ 152053 px^2; rho ≈ 10/152053 ≈ 6.58e-5
      rho: { BOSS: 0.0, ELITE: 2.5e-5, HORDE: 6.6e-5 },
      enemyRadiusPx: AVG_ENEMY_RADIUS
    },
    survivability: { kSurv: 0.5, kSustain: 0.5, ehpRef: 110, hpmRef: 20, clampMin: 0.9, clampMax: 1.1 }
  };

  const results: PFResult[] = [];
  for (const c of CHARACTERS) {
    try {
      results.push(buildOperativePF(c.id, cfg));
    } catch (e) {
      // Ignore operatives that cannot be evaluated
    }
  }
  return { results, config: cfg };
}

export function sortResults(res: PFResult[]): PFResult[] {
  return [...res].sort((a,b) => b.totalPF - a.totalPF);
}
