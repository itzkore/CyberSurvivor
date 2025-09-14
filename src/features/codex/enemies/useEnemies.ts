import { useMemo, useState } from 'react';
import { AssetLoader } from '../../../game/AssetLoader';
import { configureSmallSpawn } from '../../../game/enemies/Small';
import { configureMediumSpawn } from '../../../game/enemies/Medium';
import { configureLargeSpawn } from '../../../game/enemies/Large';

export interface Enemy { id: string; name: string; hp: number; dmg: number; sprite: string; radius: number }
export interface Boss {
  id: string;
  name: string;
  splash: string;
  behavior: 'balanced' | 'nova' | 'summoner' | 'dasher';
  hpMul: number;
  baseHp: number;
  drops: string[];
  phases: Array<{ name: string; abilities: string[] }>;
}

// Lightweight EnemyManager stub to evaluate spawn configurators without constructing the real system
function makeEmStub(){
  const enemySpeedScale = 0.55; // mirrors EnemyManager default
  const ghostCap = (() => { try { return 9.0 * ((window as any)?.SPEED_SCALE || 0.45); } catch { return 9.0 * 0.45; } })();
  const clampToTypeCaps = (speed: number, type: 'small'|'medium'|'large') => {
    let cap = Infinity;
    if (type === 'small') cap = 0.36 * enemySpeedScale;
    else if (type === 'medium') cap = 0.34 * enemySpeedScale;
    else cap = 0.26 * enemySpeedScale;
    const c = Math.min(speed, cap, ghostCap);
    return Number.isFinite(c) ? c : speed;
  };
  return { enemySpeedScale, lsSmallSpeedMul: 1, clampToTypeCaps } as any;
}

function snapshotEnemy(type: 'small'|'medium'|'large'): Enemy {
  const e: any = { x:0, y:0, hp:0, maxHp:0, radius:0, speed:0, active:true, type, damage:0, id: type };
  const em = makeEmStub();
  const t0 = 0; // early-game snapshot
  if (type === 'small') configureSmallSpawn(em, e, t0);
  else if (type === 'medium') configureMediumSpawn(em, e, t0);
  else configureLargeSpawn(em, e, t0);
  // Choose sprite consistent with EnemyManager overrides
  const sprite = type === 'small'
    ? AssetLoader.normalizePath('/assets/enemies/enemy_spider.png')
    : type === 'large'
      ? AssetLoader.normalizePath('/assets/enemies/enemy_eye.png')
      : AssetLoader.normalizePath('/assets/enemies/enemy_default.png');
  return { id: type, name: type.charAt(0).toUpperCase() + type.slice(1), hp: e.hp|0, dmg: e.damage|0, sprite, radius: e.radius|0 };
}

// Build enemies list from live configurators
const ENEMIES: Enemy[] = [snapshotEnemy('small'), snapshotEnemy('medium'), snapshotEnemy('large')];

// Mirror BossManager bossDefs (ids, images, behaviors, hpMul), add baseHp, drops, and phases for UI
const BOSS_BASE_HP = 12000; // BossManager base before scaling
const bossDefs = [
  { id: 'alpha', img: 'boss_phase1.png', hpMul: 1.0, behavior: 'balanced' as const },
  { id: 'beta',  img: 'boss_2.png',      hpMul: 1.1, behavior: 'nova' as const },
  { id: 'gamma', img: 'boss_3.png',      hpMul: 1.2, behavior: 'summoner' as const },
  { id: 'omega', img: 'boss_4.png',      hpMul: 1.3, behavior: 'dasher' as const },
];

function bossPhasesFor(behavior: Boss['behavior']): Array<{ name: string; abilities: string[] }>{
  switch (behavior) {
    case 'nova':
      return [
        { name: 'Core kit', abilities: ['Supernova', 'Multi‑Nova', 'Shock‑Nova', 'Volley'] },
      ];
    case 'summoner':
      return [
        { name: 'Core kit', abilities: ['Summon Rifts', 'Rift Barrage', 'Volley'] },
      ];
    case 'dasher':
      return [
        { name: 'Core kit', abilities: ['Dash', 'Cross Slash', 'Earthshatter', 'Volley'] },
      ];
    default:
      return [
        { name: 'Core kit', abilities: ['Volley', 'Shock‑Nova'] },
      ];
  }
}

const BOSSES: Boss[] = bossDefs.map(d => ({
  id: d.id,
  name: d.id.toUpperCase(),
  splash: AssetLoader.normalizePath(`/assets/boss/${d.img}`),
  behavior: d.behavior,
  hpMul: d.hpMul,
  baseHp: Math.round(BOSS_BASE_HP * d.hpMul),
  drops: ['XP Orbs', 'Treasure Chest'],
  phases: bossPhasesFor(d.behavior),
}));

export function useEnemies(){
  const [q,setQ] = useState('');
  const enemies = useMemo(()=>{ const s=q.trim().toLowerCase(); return s? ENEMIES.filter(e=>e.name.toLowerCase().includes(s) || e.id.includes(s)) : ENEMIES; },[q]);
  const bosses = BOSSES;
  return { enemies, bosses, q, setQ };
}

export default useEnemies;
