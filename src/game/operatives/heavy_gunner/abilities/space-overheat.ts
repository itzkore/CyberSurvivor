import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';
import { nullMeter } from '../../ability-types';

export const spaceOverheat: AbilityDescriptor = {
  key: 'SPACE',
  id: 'gunner_overheat',
  getMeter: (p: Player) => {
    const h = (p as any).getGunnerHeat?.();
    return h ? { value: h.value, max: h.max, ready: !h.overheated, active: !!h.active } : nullMeter();
  }
};
