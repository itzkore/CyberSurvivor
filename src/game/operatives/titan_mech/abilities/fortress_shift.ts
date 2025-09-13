import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const FortressShift: AbilityDescriptor = {
  key: 'SHIFT', id: 'fortress_stance', getMeter: (p: Player) => (p as any).getFortressMeter?.() ?? null
};
