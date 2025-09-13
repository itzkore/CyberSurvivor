import type { Player } from '../Player';

/**
 * Descriptor for operative abilities (RMB, special abilities, etc.)
 */
export interface AbilityDescriptor {
  /** Key that triggers this ability (e.g., 'RMB', 'Space', etc.) */
  key: string;
  
  /** Unique identifier for this ability */
  id: string;
  
  /** Get meter data for HUD display (optional) */
  getMeter?: (player: Player) => { value: number; max: number; ready: boolean; active: boolean } | null;
  
  /** Update ability logic each frame */
  update?: (player: Player & any, deltaTime: number) => void;
  
  /** Render ability visuals (optional) */
  render?: (player: Player & any, ctx: CanvasRenderingContext2D) => void;
  
  /** Handle key press events (optional) */
  onKeyPress?: (player: Player & any, key: string) => boolean;
}