import type { AbilityDescriptor, PassiveHooks } from '../../ability-types';
import { GhostProtocolShift } from './ghostprotocol_shift';
import { SystemHackSpace } from './systemhack_space';
import { ManualHackRMB } from './manualhack_rmb';

export const abilities: AbilityDescriptor[] = [GhostProtocolShift, SystemHackSpace, ManualHackRMB];
export const passiveHooks: PassiveHooks = {};
