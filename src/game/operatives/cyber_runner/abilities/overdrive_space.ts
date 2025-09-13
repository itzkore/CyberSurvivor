import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const OverdriveSpace: AbilityDescriptor = {
  key: 'SPACE',
  id: 'runner_overdrive',
  getMeter: (p: Player) => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const until = (p as any).runnerOverdriveSurgeUntil || 0;
    return { value: until > now ? until - now : 0, max: 1500, ready: true, active: until > now };
  }
};
