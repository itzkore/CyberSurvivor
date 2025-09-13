/**
 * Base interface for operative ability managers
 * Each operative has its own AbilityManager that handles all operative-specific logic
 */
export interface BaseAbilityManager {
  /** Operative ID this manager handles */
  operativeId: string;
  
  /** Initialize the manager with player reference */
  init(player: any): void;
  
  /** Update logic called every frame */
  update(deltaTime: number, keyState: any, inputLocked: boolean): void;
  
  /** Get ability meter data for HUD display */
  getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } };
  
  /** Handle key press events for abilities */
  handleKeyPress(key: string, keyState: any): boolean;
  
  /** Render ability-specific visuals */
  render?(ctx: CanvasRenderingContext2D, player: any): void;
  
  /** Add tachyon charge hits (Tech Warrior specific) */
  addTachyonHits?(count: number): boolean;
  
  /** Apply operative-specific movement modifiers */
  getMovementModifiers(): { speedMultiplier: number; moveMultiplier: number };
  
  /** Apply operative-specific weapon modifiers */
  getWeaponModifiers(weaponType: number): { cooldownMultiplier: number; damageMultiplier: number; spreadMultiplier: number };
  
  /** Get operative-specific rendering data */
  getRenderData(): { shouldRender: boolean; alpha?: number; effects?: any[] };
  
  /** Cleanup when switching operatives */
  destroy(): void;

  /**
   * Called when the game resumes from an auto-pause/blur and absolute timers must be shifted forward by deltaMs.
   * Implementations should update any internal `*Until`, `*At`, or scheduled timestamps so cooldowns/effects do not progress while unfocused.
   */
  onTimeShift?(deltaMs: number): void;
}

/**
 * Base class with common functionality
 */
export abstract class BaseAbilityManagerImpl implements BaseAbilityManager {
  public operativeId: string;
  protected player: any;
  
  constructor(operativeId: string) {
    this.operativeId = operativeId;
  }
  
  init(player: any): void {
    this.player = player;
  }
  
  abstract update(deltaTime: number, keyState: any, inputLocked: boolean): void;
  abstract getAbilityMeters(): { [abilityId: string]: { value: number; max: number; ready: boolean; active: boolean } };
  abstract handleKeyPress(key: string, keyState: any): boolean;
  
  getMovementModifiers(): { speedMultiplier: number; moveMultiplier: number } {
    return { speedMultiplier: 1, moveMultiplier: 1 };
  }
  
  getWeaponModifiers(weaponType: number): { cooldownMultiplier: number; damageMultiplier: number; spreadMultiplier: number } {
    return { cooldownMultiplier: 1, damageMultiplier: 1, spreadMultiplier: 1 };
  }
  
  getRenderData(): { shouldRender: boolean; alpha?: number; effects?: any[] } {
    return { shouldRender: true };
  }
  
  destroy(): void {
    // Override in subclasses if cleanup is needed
  }
}