import { useMemo, useState } from 'react';
import type { Operative } from './types';
import { CHARACTERS } from '../../data/characters';
import { WEAPON_SPECS } from '../../game/WeaponConfig';

// Map CharacterData.playstyle -> Codex role bucket
const ROLE_MAP: Record<string, Operative['role']> = {
  Aggressive: 'ASSAULT',
  Defensive: 'TANK',
  Balanced: 'ASSAULT',
  Support: 'UTILITY',
  Stealth: 'SNIPER',
  Mobility: 'ASSAULT',
};

// Derive rarity from character powerScore with simple tiering
function deriveRarity(powerScore?: number): Operative['rarity']{
  const p = powerScore ?? 0;
  if (p >= 360) return 'legendary';
  if (p >= 300) return 'epic';
  if (p >= 240) return 'rare';
  return 'common';
}

// Build Operatives list from live character data
const LIVE: Operative[] = CHARACTERS.map(c => {
  const AL: any = (typeof window !== 'undefined' ? (window as any).AssetLoader : null);
  const portrait = AL ? AL.normalizePath(c.icon) : c.icon;
  const spec = WEAPON_SPECS[c.defaultWeapon];
  const wStats = spec?.getLevelStats?.(1) as any | undefined;
  const cdFrames = (wStats?.cooldown ?? spec?.cooldown ?? 60);
  const abilityName = c.specialAbility || 'Class Ability';
  return {
    id: c.id,
    name: c.name,
    role: ROLE_MAP[c.playstyle] || 'ASSAULT',
    rarity: deriveRarity(c.stats.powerScore),
  portrait,
    hp: Math.round(c.stats.hp),
    dmg: Math.round(c.stats.damage),
    spd: Number((c.stats.speed).toFixed(2)),
    signatureWeapon: {
      id: spec?.id ?? (0 as unknown as number),
      name: spec?.name ?? '—',
      rarity: spec?.isClassWeapon ? 'epic' : 'common',
    },
    ability: {
      id: `${c.id}_ability`,
      name: abilityName,
      cooldown: Math.max(6, Math.min(14, Math.round(cdFrames / 10))), // heuristic placeholder
      icon: '/assets/ui/ability_generic.png',
    },
    recommendedPassives: [],
    loreLocked: !c.lore,
    lore: c.lore,
    tips: undefined,
    synergies: undefined,
  };
});

export function useOperatives(){
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name'|'hp'|'dmg'|'spd'|'power'>('name');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = LIVE;
    if (q) arr = arr.filter(o => [o.name, o.role, o.id].some(s => String(s).toLowerCase().includes(q)));
    const by: Record<'name'|'hp'|'dmg'|'spd'|'power', (o:Operative)=>number|string> = {
      name: (o:Operative)=>o.name,
      hp: (o:Operative)=>o.hp,
      dmg: (o:Operative)=>o.dmg,
      spd: (o:Operative)=>o.spd,
      power: (o:Operative)=>{
        const c = CHARACTERS.find(x=>x.id===o.id);
        return c?.stats.powerScore ?? 0;
      }
    } as any;
    const sel = by[sort] as any;
    return [...arr].sort((a,b)=> (sel(a) > sel(b) ? 1 : sel(a) < sel(b) ? -1 : 0));
  }, [query, sort]);
  const getById = (id: string) => LIVE.find(o => o.id === id);
  return { list, query, setQuery, getById, sort, setSort };
}

export default useOperatives;

// Test helpers (pure, no React env required)
export const __test = {
  filter(query: string){
    const q = query.trim().toLowerCase();
    if (!q) return LIVE;
    return LIVE.filter(o => [o.name, o.role, o.id].some(s => String(s).toLowerCase().includes(q)));
  }
}
