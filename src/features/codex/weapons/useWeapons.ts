import { useMemo, useState } from 'react';
import type { Rarity } from '../types';
import { WEAPON_SPECS } from '../../../game/WeaponConfig';

export interface Weapon { id: number; name: string; rarity: Rarity; icon?: string; dmg: number; cd: number; pierce: number; maxLevel: number }

function deriveRarity(spec: any): Rarity{
  if (spec?.isClassWeapon) return 'epic';
  const d = spec?.damage ?? 0;
  if (d >= 40) return 'epic';
  if (d >= 28) return 'rare';
  return 'common';
}

const LIVE: Weapon[] = Object.values(WEAPON_SPECS).map(s => {
  const lvl1 = s.getLevelStats?.(1) as any || {};
  const damage = Math.round(lvl1.damage ?? s.damage ?? 0);
  const cdFrames = lvl1.cooldown ?? s.cooldown ?? 60;
  const cd = s.cooldownMs ? (s.cooldownMs/1000) : (Math.round((cdFrames/60)*100)/100);
  const pierce = lvl1.pierce ?? 1;
  return { id: s.id as number, name: s.name, rarity: deriveRarity(s), icon: s.icon, dmg: damage, cd, pierce, maxLevel: s.maxLevel };
});

export function useWeapons(){
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name'|'dps'|'dmg'|'cd'|'pierce'>('name');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = LIVE;
    if (q) arr = arr.filter(w => [w.name, w.id].some(s => String(s).toLowerCase().includes(q)));
    const dps = (w: Weapon) => (w.cd > 0 ? w.dmg / w.cd : w.dmg);
    const order = [...arr];
    order.sort((a,b) => {
      switch(sort){
        case 'name': return a.name.localeCompare(b.name);
        case 'dps': return dps(b) - dps(a);
        case 'dmg': return b.dmg - a.dmg;
        case 'cd': return a.cd - b.cd; // smaller is better
        case 'pierce': return b.pierce - a.pierce;
        default: return 0;
      }
    });
    return order;
  }, [query, sort]);
  const getById = (id: number) => LIVE.find(w => w.id === id);
  const describe = (w: Weapon) => {
    const dps = w.cd > 0 ? Math.round((w.dmg / w.cd) * 100) / 100 : w.dmg;
    // Light notes: tailor a few special cases by id/name; default empty.
    let notes = '';
    const nm = w.name.toLowerCase();
    if (nm.includes('rail') || nm.includes('beam')) notes = 'Continuous beam scales well with cooldown and crit. Keep enemies aligned.';
    if (nm.includes('launcher') || nm.includes('rocket')) notes = 'Splash damage benefits from Area and Knockback. Beware of overkill on single targets.';
    if (nm.includes('shotgun')) notes = 'Multiple pellets; close range yields higher effective DPS.';
    return { dps, notes };
  };
  return { list, getById, query, setQuery, sort, setSort, describe };
}

export default useWeapons;
