import type { AbilityDescriptor } from '../../ability-types';
import { UmbralSurgeSpace } from './umbralsurge_space';

const PhantomBladesRMBDesc: AbilityDescriptor = { key: 'RMB', id: 'phantom_blades', getMeter: (p:any)=> p?.getShadowRmbMeter?.() ?? null } as any;

export const abilities: AbilityDescriptor[] = [UmbralSurgeSpace, PhantomBladesRMBDesc];
// Deprecated aggregator; use abilities_registry.ts instead.
