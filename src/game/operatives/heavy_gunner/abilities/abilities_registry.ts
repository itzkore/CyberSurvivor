import type { AbilityDescriptor, PassiveHooks } from '../../ability-types';
import { OverheatSpace } from './overheat_space';
import { MicroTurretRMB } from './microturret_rmb';

export const abilities: AbilityDescriptor[] = [OverheatSpace, MicroTurretRMB];
export const passiveHooks: PassiveHooks = {};
