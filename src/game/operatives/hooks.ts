import type { Player } from '../Player';
import type { Enemy } from '../EnemyManager';
import { WeaponType } from '../WeaponType';

export type OperativeId = string | undefined;

export interface OriginParams {
  weaponType: WeaponType;
  total: number;
  index: number;
  baseAngle: number;
  baseCos: number;
  baseSin: number;
  perpX: number;
  perpY: number;
  originX: number;
  originY: number;
}

export interface AngleParams {
  weaponType: WeaponType;
  finalAngle: number;
  target: Enemy;
  originX: number;
  originY: number;
}

export interface DamageParams {
  weaponType: WeaponType;
  current: number;
}

export interface BulletParams {
  weaponType: WeaponType;
  bullet: any;
}

export interface OperativeHooks {
  adjustOrigin?(player: Player, p: OriginParams): { originX: number; originY: number; finalAngle?: number } | void;
  adjustAngle?(player: Player, p: AngleParams): number | void;
  preSpawnDamage?(player: Player, p: DamageParams): number | void;
  afterSpawnBullet?(player: Player, p: BulletParams): void;
}

const heavyGunnerHooks: OperativeHooks = {
  adjustAngle(player, p) {
    if (p.weaponType !== WeaponType.GUNNER_MINIGUN) return;
    const t = (player as any).getGunnerBoostT?.() || 0;
    if (t > 0) {
      const j = (player as any).gunnerBoostJitter || 0.02;
      return p.finalAngle + (Math.random() * 2 - 1) * j * t;
    }
  },
  afterSpawnBullet(player, p) {
    if (p.weaponType !== WeaponType.GUNNER_MINIGUN || !p.bullet) return;
    const t = (player as any).getGunnerBoostT?.() || 0;
    const getPowerT = (player as any).getGunnerPowerT;
    const tPow = typeof getPowerT === 'function' ? getPowerT.call(player) : t;
    if (t > 0) {
      const rMul = 1 + (((player as any).gunnerBoostRange ?? 1.0) - 1) * t;
      if ((p.bullet as any).maxDistanceSq != null) (p.bullet as any).maxDistanceSq *= (rMul * rMul);
      if (p.bullet.life != null) p.bullet.life = Math.round(p.bullet.life * rMul);
      const dmgMul = 1 + (((player as any).gunnerBoostDamage ?? 1.0) - 1) * tPow;
      p.bullet.damage = (p.bullet.damage ?? 0) * dmgMul;
      if ((p.bullet as any).pierceRemaining == null) (p.bullet as any).pierceRemaining = 0;
      (p.bullet as any).pierceRemaining += 2;
    }
  }
};

const titanMechHooks: OperativeHooks = {
  adjustOrigin(player, p) {
    if (p.weaponType !== WeaponType.MECH_MORTAR && p.weaponType !== WeaponType.SIEGE_HOWITZER) return;
    const side: number = (player as any).mechMortarSide || 1;
    const barrelOffset = 30;
    let x = p.originX + p.perpX * barrelOffset * side + p.baseCos * 18;
    let y = p.originY + p.perpY * barrelOffset * side + p.baseSin * 18;
    (player as any).mechMortarSide = -side;
    return { originX: x, originY: y };
  },
  preSpawnDamage(player, p) {
    if (p.weaponType !== WeaponType.MECH_MORTAR && p.weaponType !== WeaponType.SIEGE_HOWITZER) return;
    const nerf = (player as any).getTitanOnlyDamageNerf?.() ?? 1;
    const extraTrim = (player as any).fortressActive ? 0.75 : 0.75;
    return Math.max(1, Math.round(p.current * nerf * extraTrim));
  }
};

const cyberRunnerHooks: OperativeHooks = {
  adjustOrigin(player, p) {
    if (p.weaponType !== WeaponType.RUNNER_GUN && p.weaponType !== WeaponType.RUNNER_OVERDRIVE) return;
    const perpX = p.perpX, perpY = p.perpY;
    const sideOffsetBase = 22;
    let sideSign: number;
    if (p.total <= 1) {
      sideSign = (player as any).runnerSide || 1;
      (player as any).runnerSide = -sideSign;
    } else {
      const centeredIndex = (p.index - (p.total - 1) / 2);
      sideSign = centeredIndex < 0 ? -1 : 1;
    }
    return { originX: p.originX + perpX * sideOffsetBase * sideSign, originY: p.originY + perpY * sideOffsetBase * sideSign };
  },
  adjustAngle(player, p) {
    if (p.weaponType === WeaponType.RUNNER_GUN || p.weaponType === WeaponType.RUNNER_OVERDRIVE) {
      // Aim from adjusted origin to target
      let angle = Math.atan2(p.target.y - p.originY, p.target.x - p.originX);
      if (p.weaponType === WeaponType.RUNNER_OVERDRIVE) {
        const vx = (player as any).vx || 0, vy = (player as any).vy || 0;
        const moveMag = Math.hypot(vx, vy);
        const base = (player as any).baseMoveSpeed || (player as any).speed || 1;
        const t = Math.max(0, Math.min(1, (moveMag - 0.6 * base) / Math.max(1e-6, 0.4 * base)));
        if (t > 0) {
          const moveAngle = Math.atan2(vy, vx);
          let d = ((moveAngle - angle + Math.PI) % (Math.PI * 2));
          if (d < 0) d += Math.PI * 2; d -= Math.PI;
          const maxBias = (6 * Math.PI) / 180;
          angle = angle + Math.max(-maxBias, Math.min(maxBias, d)) * t;
        }
      }
      return angle;
    }
  },
  afterSpawnBullet(player, p) {
    if (p.weaponType !== WeaponType.RUNNER_OVERDRIVE || !p.bullet) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now < ((player as any).runnerOverdriveSurgeUntil || 0)) {
      const speedBoost = 1.2;
      p.bullet.vx *= speedBoost; p.bullet.vy *= speedBoost;
      (p.bullet as any).critBonus = (((p.bullet as any).critBonus || 0) + 0.15);
      if (p.bullet.projectileVisual) {
        const vis: any = { ...(p.bullet.projectileVisual as any) };
        if (typeof vis.trailLength === 'number') vis.trailLength = Math.min(48, (vis.trailLength || 20) + 6);
        p.bullet.projectileVisual = vis;
      }
    }
  }
};

export function getOperativeHooks(id: OperativeId): OperativeHooks | null {
  switch (id) {
    case 'heavy_gunner': return heavyGunnerHooks;
    case 'titan_mech': return titanMechHooks;
    case 'cyber_runner': return cyberRunnerHooks;
    default: return null;
  }
}
