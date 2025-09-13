import type { AbilityDescriptor, PassiveHooks } from '../../ability-types';
import { GlideShift } from './glide_shift';
import { AnchorRMB } from './anchor_rmb';

export const abilities: AbilityDescriptor[] = [GlideShift, AnchorRMB];
export const passiveHooks: PassiveHooks = {};
