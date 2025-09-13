import type { Player } from '../Player';

export type AbilityKey = 'SHIFT' | 'SPACE' | 'RMB';

export interface AbilityMeter {
  value: number;
  max: number;
  ready?: boolean;
  active?: boolean;
}

export interface AbilityDescriptor {
  key: AbilityKey;
  /** Optional stable id for the ability (e.g., 'ghost_protocol'). */
  id?: string;
  /** Returns current meter stats for HUD. */
  getMeter?: (player: Player) => AbilityMeter | null;
  /** Optional activator hook if ability is triggered programmatically. */
  activate?: (player: Player) => void;
  /** Optional per-frame tick if this ability manages its own state. */
  update?: (player: Player, dt: number) => void;
  /** Optional world and overlay draws for ability-specific visuals. */
  drawWorld?: (player: Player, ctx: CanvasRenderingContext2D) => void;
  drawOverlay?: (player: Player, ctx: CanvasRenderingContext2D) => void;
}

export interface PassiveHooks {
  /** Called when a passive is applied; can adjust or extend behavior. */
  onApplyPassive?: (player: Player, passiveId: number, level: number) => void;
  /** Optional per-tick hook for passive-derived effects. */
  onTick?: (player: Player, dt: number) => void;
}

export function nullMeter(): AbilityMeter {
  return { value: 0, max: 1, ready: false, active: false };
}
