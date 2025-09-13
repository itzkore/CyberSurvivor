import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const OverheatSpace: AbilityDescriptor = {
  key: 'SPACE',
  id: 'gunner_overheat',
  getMeter: (p: Player) => (p as any).getGunnerHeat?.() ?? null
};
