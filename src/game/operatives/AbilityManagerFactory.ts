import type { BaseAbilityManager } from './BaseAbilityManager';
import { TechWarriorAbilityManager } from './tech_warrior/TechWarriorAbilityManager';
import { CyberRunnerAbilityManager } from './cyber_runner/CyberRunnerAbilityManager';
import { HeavyGunnerAbilityManager } from './heavy_gunner/HeavyGunnerAbilityManager';
import { WastelandScavengerAbilityManager } from './wasteland_scavenger/WastelandScavengerAbilityManager';

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
      
      // TODO: Add other operatives as they are refactored
      default:
        return null; // No manager available yet
    }
  }
}