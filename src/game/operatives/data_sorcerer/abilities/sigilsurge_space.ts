import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const SigilSurgeSpace: AbilityDescriptor = { key: 'SPACE', id: 'sigil_surge', getMeter: (p: Player) => (p as any).getSorcererSigilMeter?.() ?? null };
