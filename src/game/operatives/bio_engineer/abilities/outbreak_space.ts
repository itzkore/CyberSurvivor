import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const OutbreakSpace: AbilityDescriptor = { key: 'SPACE', id: 'bio_outbreak', getMeter: (p: Player) => (p as any).getBioOutbreakMeter?.() ?? null };
