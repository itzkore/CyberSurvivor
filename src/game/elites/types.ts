// Minimal shared types for elite enemies
// Elites piggyback on Enemy objects and store state in opaque fields on the instance

export type EliteKind = 'DASHER' | 'GUNNER' | 'SUPPRESSOR' | 'BOMBER' | 'BLINKER' | 'BLOCKER' | 'SIPHON';

export interface EliteRuntime {
  kind: EliteKind;
  // generic timers/state buckets to avoid many fields on Enemy type
  cdUntil?: number; // next available action timestamp (ms)
  phase?: 'IDLE' | 'WINDUP' | 'ACTION' | 'RECOVER';
  phaseUntil?: number; // timestamp (ms) when current phase ends
  seed?: number; // deterministic wobbles
}

export type SpawnProjectileFn = (x: number, y: number, vx: number, vy: number, opts: { radius?: number; damage?: number; ttlMs?: number; spriteKey?: string; color?: string; explodeRadius?: number; explodeDamage?: number; explodeColor?: string }) => void;
