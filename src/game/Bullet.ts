import { ProjectileVisual } from './WeaponConfig';
import { WeaponType } from './WeaponType';

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  active: boolean;
  damage: number;
  speed?: number;
  weaponType: WeaponType | number;
  projectileImageKey?: string;
  projectileVisual?: ProjectileVisual;
  snakeTargets?: Array<{ x: number; y: number }>;
  snakeBounceCount?: number;
  snakeRetarget?: { x: number; y: number } | null;
  _exploded?: boolean;
  _explosionStartTime?: number;
  _maxExplosionDuration?: number;
  _hit?: boolean;
  explosionRadius?: number;
};
