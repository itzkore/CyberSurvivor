import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';

export const UmbralSurgeSpace: AbilityDescriptor = { key: 'SPACE', id: 'umbral_surge', getMeter: (p: Player) => (p as any).getShadowSurgeMeter?.() ?? null };
