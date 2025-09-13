import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const CloakSpace: AbilityDescriptor = { key: 'SPACE', id: 'phase_cloak', getMeter: (p: Player) => (p as any).getGhostCloakMeter?.() ?? null };
