import type { AbilityDescriptor, PassiveHooks } from './ability-types';
import { getOperativeAbilities as _get } from './ability-registry';

/**
 * Central abilities resolver.
 * Thin wrapper over per-operative registries so Game.ts can remain decoupled.
 */
export function getOperativeAbilities(operativeId?: string): { abilities: AbilityDescriptor[]; passive?: PassiveHooks } {
	return _get(operativeId);
}
