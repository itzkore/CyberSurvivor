import type { AbilityDescriptor } from '../../ability-types';
import { UmbralSurgeSpace } from './umbralsurge_space';

// Lightweight descriptor for RMB to surface HUD meter via manager-provided getter
const PhantomBladesRMBDesc: AbilityDescriptor = { key: 'RMB', id: 'phantom_blades', getMeter: (p:any)=> p?.getShadowRmbMeter?.() ?? null } as any;

export const abilities: AbilityDescriptor[] = [UmbralSurgeSpace, PhantomBladesRMBDesc];
