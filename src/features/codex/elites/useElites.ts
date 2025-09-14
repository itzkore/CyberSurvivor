import { useMemo, useState } from 'react';
import type { EliteKind } from '../../../game/elites/types';

export interface EliteInfo {
  id: EliteKind;
  name: string;
  icon: string;
  blurb: string;
  tips: string[];
}

const AL: any = (typeof window !== 'undefined' ? (window as any).AssetLoader : null);
const N = (p: string) => (AL ? AL.normalizePath(p) : p);

const ELITES: EliteInfo[] = [
  {
    id: 'DASHER',
    name: 'Dasher',
    icon: N('/assets/enemies/elite/elite_dasher.png'),
    blurb: 'Telegraphs briefly, then performs a fast dash toward you. Short burst, then recovers.',
    tips: ['Strafe sideways during windup—dash follows a straight line.', 'Knockback or freezes interrupt recovery.'],
  },
  {
    id: 'GUNNER',
    name: 'Gunner',
    icon: N('/assets/enemies/elite/elite_gunner.png'),
    blurb: 'Charges a shot and fires a slow, dodgeable bolt that explodes on impact.',
    tips: ['Watch for the telegraph shake—step off the line.', 'Stay mobile; the projectile is slow but explosive.'],
  },
  {
    id: 'SUPPRESSOR',
    name: 'Suppressor',
    icon: N('/assets/enemies/elite/elite_suppresor.png'),
    blurb: 'Emits a suppression field that briefly slows you if you remain inside.',
    tips: ['Step out of the cyan pulse to avoid the slow.', 'Area and movement speed help you reposition.'],
  },
  {
    id: 'BOMBER',
    name: 'Bomber',
    icon: N('/assets/enemies/elite/elite_bomber.png'),
    blurb: 'Lobs slow arcing bombs that detonate in a large radius.',
    tips: ['Keep distance; bombs have big, readable blast rings.', 'Use knockback to disrupt their windup.'],
  },
  {
    id: 'BLINKER',
    name: 'Blinker',
    icon: N('/assets/enemies/elite/elite_blinker.png'),
    blurb: 'Teleports to a ring around you after a glow, then makes a short slash and may fire a small bolt.',
    tips: ['On glow, keep moving—post-blink slash is short.', 'After teleport, micro‑adjust to break its aim.'],
  },
  {
    id: 'BLOCKER',
    name: 'Blocker',
    icon: N('/assets/enemies/elite/elite_blocker.png'),
    blurb: 'Spawns a temporary barrier perpendicular to your line—forces pathing changes.',
    tips: ['Look for the shockwave; reroute around the wall.', 'Pierce and AoE help clear space when funneled.'],
  },
  {
    id: 'SIPHON',
    name: 'Siphon',
    icon: N('/assets/enemies/elite/elite_siphon.png'),
    blurb: 'Charges a beam toward your snapshotted position; short but punishing if you stand in it.',
    tips: ['Beam aim is locked at the start—sidestep during charge.', 'Don’t backtrack into the beam lane.'],
  },
];

export function useElites(){
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ELITES;
    return ELITES.filter(e => e.name.toLowerCase().includes(s) || e.id.toLowerCase().includes(s));
  }, [q]);
  return { list, q, setQ };
}

export default useElites;
