import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const OvermindSpace: AbilityDescriptor = { key: 'SPACE', id: 'overmind_overload', getMeter: (p: Player) => (p as any).getOvermindMeter?.() ?? null };
