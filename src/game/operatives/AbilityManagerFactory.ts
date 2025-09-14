import type { BaseAbilityManager } from './BaseAbilityManager';
import { TechWarriorAbilityManager } from './tech_warrior/TechWarriorAbilityManager';
import { CyberRunnerAbilityManager } from './cyber_runner/CyberRunnerAbilityManager';
import { HeavyGunnerAbilityManager } from './heavy_gunner/HeavyGunnerAbilityManager';
import { WastelandScavengerAbilityManager } from './wasteland_scavenger/WastelandScavengerAbilityManager';
import { BioEngineerAbilityManager } from './bio_engineer/BioEngineerAbilityManager';
import { DataSorcererAbilityManager } from './data_sorcerer/DataSorcererAbilityManager';
import { GhostOperativeAbilityManager } from './ghost_operative/GhostOperativeAbilityManager';
import { NeuralNomadAbilityManager } from './neural_nomad/NeuralNomadAbilityManager';
import { PsionicWeaverAbilityManager } from './psionic_weaver/PsionicWeaverAbilityManager';
import { RogueHackerAbilityManager } from './rogue_hacker/RogueHackerAbilityManager';
import { ShadowOperativeAbilityManager } from './shadow_operative/ShadowOperativeAbilityManager';
import { TitanMechAbilityManager } from './titan_mech/TitanMechAbilityManager';

/**
 * Factory for creating ability managers based on operative ID
 */
export class AbilityManagerFactory {
  static createManager(operativeId: string): BaseAbilityManager | null {
    switch (operativeId) {
      case 'tech_warrior':
        return new TechWarriorAbilityManager();
      
      case 'cyber_runner':
        return new CyberRunnerAbilityManager();
      
      case 'heavy_gunner':
        return new HeavyGunnerAbilityManager();
      
      case 'wasteland_scavenger':
        return new WastelandScavengerAbilityManager();
      case 'bio_engineer':
        return new BioEngineerAbilityManager();
      case 'data_sorcerer':
        return new DataSorcererAbilityManager();
      case 'ghost_operative':
        return new GhostOperativeAbilityManager();
      case 'rogue_hacker':
        return new RogueHackerAbilityManager();
      case 'shadow_operative':
        return new ShadowOperativeAbilityManager();
      case 'titan_mech':
        return new TitanMechAbilityManager();
      case 'neural_nomad':
        return new NeuralNomadAbilityManager();
      case 'psionic_weaver':
        return new PsionicWeaverAbilityManager();
      
      // TODO: Add other operatives as they are refactored
      default:
        return null; // No manager available yet
    }
  }
}