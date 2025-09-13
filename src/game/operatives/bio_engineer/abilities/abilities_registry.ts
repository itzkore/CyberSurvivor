import type { AbilityDescriptor, PassiveHooks } from '../../ability-types';
import { BoostShift } from './boost_shift';
import { OutbreakSpace } from './outbreak_space';

export const abilities: AbilityDescriptor[] = [BoostShift, OutbreakSpace];
export const passiveHooks: PassiveHooks = {};
