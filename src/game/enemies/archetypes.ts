// Centralized enemy archetype defs (non-elite) for hygiene and reuse.
// Minimal export to avoid behavior changes.

export type EnemyType = 'small' | 'medium' | 'large';

export interface EnemySpriteDef { type: EnemyType; radius: number; color: string; flashColor: string; }
export interface EnemyRadiusDef { type: EnemyType; radius: number; }

export const ENEMY_SPRITE_DEFS: EnemySpriteDef[] = [
  { type: 'small',  radius: 20, color: '#f00',    flashColor: '#ff8080' },
  { type: 'medium', radius: 28, color: '#d40000', flashColor: '#ff9090' },
  { type: 'large',  radius: 36, color: '#b00000', flashColor: '#ff9999' },
];

export const ENEMY_RADIUS_DEFS: EnemyRadiusDef[] = [
  { type: 'small',  radius: 20 },
  { type: 'medium', radius: 28 },
  { type: 'large',  radius: 36 },
];
