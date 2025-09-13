import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const GlideShift: AbilityDescriptor = {
  key: 'SHIFT', id: 'tech_glide', getMeter: (p: Player) => (p as any).getTechGlide?.() ?? null
};
