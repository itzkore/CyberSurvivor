import { useMemo, useState } from 'react';
import type { AbilityDescriptor } from '../../../game/operatives/ability-types';
// Pull lightweight descriptors from operative ability files
import { BoostShift as BioBoost } from '../../../game/operatives/bio_engineer/abilities/boost_shift';
import { OutbreakSpace as BioOutbreak } from '../../../game/operatives/bio_engineer/abilities/outbreak_space';
import { TechAnchorRMB } from '../../../game/operatives/tech_warrior/abilities/anchor_rmb';
import { GlideShift as TechGlide } from '../../../game/operatives/tech_warrior/abilities/glide_shift';
import { MicroTurretRMB } from '../../../game/operatives/heavy_gunner/abilities/microturret_rmb';
import { OverheatSpace as GunnerOverheat } from '../../../game/operatives/heavy_gunner/abilities/overheat_space';
import { DashShift as RunnerDash } from '../../../game/operatives/cyber_runner/abilities/dash_shift';
import { OvermindSpace as Overmind } from '../../../game/operatives/neural_nomad/abilities/overmind_space';
import { UmbralSurgeSpace as UmbralSurge } from '../../../game/operatives/shadow_operative/abilities/umbralsurge_space';
import { LatticeSpace as LatticeWeave } from '../../../game/operatives/psionic_weaver/abilities/lattice_space';
import { FortressShift as FortressStance } from '../../../game/operatives/titan_mech/abilities/fortress_shift';

export interface Ability { id: string; name: string; cooldown?: number; icon: string; description: string }

function friendlyName(desc: AbilityDescriptor): string {
  switch (desc.id) {
    case 'bio_boost': return 'Boost Shift';
    case 'bio_outbreak': return 'Outbreak';
    case 'tech_anchor': return 'Anchor';
    case 'tech_glide': return 'Glide Dash';
    case 'gunner_micro_turret': return 'Micro Turret';
    case 'gunner_overheat': return 'Overheat';
    case 'runner_dash': return 'Runner Dash';
    case 'overmind_overload': return 'Overmind Overload';
    case 'umbral_surge': return 'Umbral Surge';
    case 'lattice_weave': return 'Lattice Weave';
    case 'fortress_stance': return 'Fortress Stance';
    default: return desc.id.replace(/_/g,' ').replace(/\b\w/g, s=>s.toUpperCase());
  }
}

function iconFor(desc: AbilityDescriptor): string {
  // Use themed generic icons per key as fallback
  const base = '/assets/ui/icons';
  switch (desc.id) {
    case 'gunner_micro_turret': return '/assets/turrets/turret_gunner.png';
    case 'tech_anchor': return `${base}/upgrade_speed.svg`;
    case 'umbral_surge': return `${base}/passive_overclock.svg`;
    case 'lattice_weave': return `${base}/passive_area.svg`;
    case 'bio_outbreak': return `${base}/passive_regen.svg`;
    case 'bio_boost': return `${base}/passive_speed.svg`;
    case 'runner_dash': return `${base}/passive_speed.svg`;
    case 'gunner_overheat': return `${base}/passive_fire.svg`;
    case 'overmind_overload': return `${base}/passive_eye.svg`;
    case 'fortress_stance': return `${base}/passive_armor.svg`;
    default: return `${base}/passive_overclock.svg`;
  }
}

const DESCS: AbilityDescriptor[] = [
  BioBoost, BioOutbreak,
  TechAnchorRMB as any, TechGlide as any,
  MicroTurretRMB as any, GunnerOverheat,
  RunnerDash,
  Overmind,
  UmbralSurge,
  LatticeWeave,
  FortressStance,
];

const LIVE: Ability[] = DESCS.map(d => ({
  id: d.id,
  name: friendlyName(d),
  cooldown: undefined, // Most descriptors expose HUD meters at runtime; static CD unknown here
  icon: iconFor(d),
  description: d.key === 'RMB' ? 'Right-click ability' : d.key === 'SPACE' ? 'Spacebar ability' : `${d.key} ability`,
}));

export function useAbilities(){
  const [q, setQ] = useState('');
  const list = useMemo(()=>{
    const s=q.trim().toLowerCase();
    if (!s) return LIVE;
    return LIVE.filter(a=> (a.name.toLowerCase().includes(s) || a.description.toLowerCase().includes(s)));
  },[q]);
  const getById = (id:string) => LIVE.find(a=>a.id===id);
  return { list, getById, q, setQ };
}

export default useAbilities;
