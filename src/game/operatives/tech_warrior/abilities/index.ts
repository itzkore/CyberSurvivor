import type { AbilityDescriptor, PassiveHooks } from '../../ability-types';
import { GlideShift } from './glide_shift';
import { AnchorRMB } from './anchor_rmb';

export const abilities: AbilityDescriptor[] = [GlideShift, AnchorRMB];
// Deprecated aggregator; use abilities_registry.ts instead.
