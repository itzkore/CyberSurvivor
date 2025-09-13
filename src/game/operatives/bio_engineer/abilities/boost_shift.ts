import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const BoostShift: AbilityDescriptor = { key: 'SHIFT', id: 'bio_boost', getMeter: (p: Player) => (p as any).getBioBoostMeter?.() ?? null };
