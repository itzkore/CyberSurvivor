import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const SystemHackSpace: AbilityDescriptor = {
  key: 'SPACE', id: 'system_hack', getMeter: (p: Player) => (p as any).getHackerHackMeter?.() ?? null
};
