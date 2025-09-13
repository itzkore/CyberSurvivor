import type { AbilityDescriptor, PassiveHooks } from './ability-types';

export function getOperativeAbilities(id?: string): { abilities: AbilityDescriptor[]; passive?: PassiveHooks } {
  switch (id) {
    case 'heavy_gunner':
  return { abilities: require('./heavy_gunner/abilities/abilities_registry').abilities, passive: require('./heavy_gunner/abilities/abilities_registry').passiveHooks };
    case 'cyber_runner':
  return { abilities: require('./cyber_runner/abilities/abilities_registry').abilities, passive: require('./cyber_runner/abilities/abilities_registry').passiveHooks };
    case 'tech_warrior':
  return { abilities: require('./tech_warrior/abilities/abilities_registry').abilities, passive: require('./tech_warrior/abilities/abilities_registry').passiveHooks };
    case 'titan_mech':
  return { abilities: require('./titan_mech/abilities/abilities_registry').abilities, passive: require('./titan_mech/abilities/abilities_registry').passiveHooks };
    case 'rogue_hacker':
  return { abilities: require('./rogue_hacker/abilities/abilities_registry').abilities, passive: require('./rogue_hacker/abilities/abilities_registry').passiveHooks };
    case 'bio_engineer':
  return { abilities: require('./bio_engineer/abilities/abilities_registry').abilities, passive: require('./bio_engineer/abilities/abilities_registry').passiveHooks };
    case 'data_sorcerer':
  return { abilities: require('./data_sorcerer/abilities/abilities_registry').abilities, passive: require('./data_sorcerer/abilities/abilities_registry').passiveHooks };
    case 'neural_nomad':
  return { abilities: require('./neural_nomad/abilities/abilities_registry').abilities, passive: require('./neural_nomad/abilities/abilities_registry').passiveHooks };
    case 'psionic_weaver':
  return { abilities: require('./psionic_weaver/abilities/abilities_registry').abilities, passive: require('./psionic_weaver/abilities/abilities_registry').passiveHooks };
    case 'ghost_operative':
  return { abilities: require('./ghost_operative/abilities/abilities_registry').abilities, passive: require('./ghost_operative/abilities/abilities_registry').passiveHooks };
    case 'shadow_operative':
  return { abilities: require('./shadow_operative/abilities/abilities_registry').abilities, passive: require('./shadow_operative/abilities/abilities_registry').passiveHooks };
    case 'wasteland_scavenger':
  return { abilities: require('./wasteland_scavenger/abilities/abilities_registry').abilities, passive: require('./wasteland_scavenger/abilities/abilities_registry').passiveHooks };
    default:
      return { abilities: [] };
  }
}
