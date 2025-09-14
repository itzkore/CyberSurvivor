import { useMemo, useState } from 'react';
import { PASSIVE_SPECS } from '../../../game/PassiveConfig';

export interface Passive {
  id: string;
  name: string;
  description: string;
  icon?: string;
  maxLevel: number;
}

const LIVE: Passive[] = PASSIVE_SPECS.map(p => ({
  id: String(p.id),
  name: p.name,
  description: p.description || '',
  icon: p.icon,
  maxLevel: p.maxLevel,
}));

export function usePassives(){
  const [q, setQ] = useState('');
  const list = useMemo(()=>{
    const s=q.trim().toLowerCase();
    if (!s) return LIVE;
    return LIVE.filter(p=> (p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s)));
  },[q]);
  return { list, q, setQ };
}

export default usePassives;
