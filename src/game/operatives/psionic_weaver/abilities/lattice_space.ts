import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const LatticeSpace: AbilityDescriptor = { key: 'SPACE', id: 'lattice_weave', getMeter: (p: Player) => (p as any).getWeaverLatticeMeter?.() ?? null };
