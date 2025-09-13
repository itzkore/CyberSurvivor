import type { Enemy } from '../EnemyManager';
import type { EnemyManager } from '../EnemyManager';

export type EnemyConfigurator = (em: EnemyManager, enemy: Enemy, gameTime: number) => void;
