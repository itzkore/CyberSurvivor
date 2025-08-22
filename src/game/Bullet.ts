import { ProjectileVisual } from './WeaponConfig';
import { WeaponType } from './WeaponType';

export type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number; // deprecated frame-based life
  lifeMs?: number; // ms-based lifetime
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
  /** Starting X position for range tracking */
  startX?: number;
  /** Starting Y position for range tracking */
  startY?: number;
  /** Squared max travel distance (pixels^2) for efficient checks */
  maxDistanceSq?: number;
  /** Remaining enemies the bullet can pierce after the current one */
  pierceRemaining?: number;
  /** Recent positions for a lightweight trail */
  trail?: { x: number; y: number }[];
  /** Enemies already damaged by this bullet (prevents double-hit consuming pierce on same target) */
  hitIds?: string[];
  /** Locked target id for homing (Smart Rifle) */
  targetId?: string;
  /** Timestamp (ms, performance.now) when spawned; used for visual time-based effects */
  _spawnTime?: number;
  /** Drone phased behavior */
  phase?: 'ASCEND' | 'HOVER' | 'DIVE' | 'CHARGING' | 'TRAVEL';
  phaseStartTime?: number;
  orbitAngle?: number;
  orbitRadius?: number;
  targetX?: number;
  targetY?: number;
  searchCooldownMs?: number;
  altitudeScale?: number;
  // Orbiting (Quantum Halo) metadata
  isOrbiting?: boolean;
  orbitIndex?: number; // index among current orbit set
  orbitCount?: number; // total orbits
  orbitRadiusBase?: number; // base radius (scaled by level)
  spinSpeed?: number; // radians per second
  angleOffset?: number; // persistent starting offset
  lastPulseAngle?: number; // track last full rotation for pulse
  contactCooldownMap?: Record<string, number>; // enemyId -> ms timestamp next allowed hit
};
