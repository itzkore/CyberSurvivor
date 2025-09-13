import type { AbilityDescriptor, PassiveHooks } from '../../ability-types';
import { DashShift } from './dash_shift';
import { OverdriveSpace } from './overdrive_space';
import { VectorBoomerangRMB } from './vector_boomerang_rmb';

export const abilities: AbilityDescriptor[] = [DashShift, OverdriveSpace, VectorBoomerangRMB];
export const passiveHooks: PassiveHooks = {};
