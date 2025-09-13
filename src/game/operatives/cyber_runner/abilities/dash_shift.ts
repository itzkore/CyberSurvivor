import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const DashShift: AbilityDescriptor = {
  key: 'SHIFT',
  id: 'runner_dash',
  getMeter: (p: Player) => (p as any).getRunnerDash?.() ?? null
};
