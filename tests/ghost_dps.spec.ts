import { describe, it, expect } from 'vitest';
import { WEAPON_SPECS } from '../src/game/WeaponConfig';
import { WeaponType } from '../src/game/WeaponType';

// Mirror Player.applyNonClassWeaponBuff class weapon branch (0.6x)
function applyClassNerf(damage: number) {
  return damage * 0.6;
}

function dpsFromSpec(spec: any, level: number) {
  const st = spec.getLevelStats ? spec.getLevelStats(level) : spec;
  const cd = typeof st.cooldown === 'number' ? st.cooldown : (st.cooldownMs ? st.cooldownMs / (1000/60) : 60);
  const dmg = st.damage ?? spec.damage ?? 0;
  const perShot = applyClassNerf(dmg);
  const dps = (perShot * 60) / Math.max(1, cd);
  return { dps, cd, perShot };
}

describe('Ghost DPS rails', () => {
  it('Ghost Sniper L1 ≈ 50 DPS after nerf', () => {
    const spec = WEAPON_SPECS[WeaponType.GHOST_SNIPER] as any;
    const { dps } = dpsFromSpec(spec, 1);
    expect(dps).toBeGreaterThanOrEqual(48);
    expect(dps).toBeLessThanOrEqual(52);
  });

  it('Ghost Sniper L7 ≈ 700 DPS after nerf', () => {
    const spec = WEAPON_SPECS[WeaponType.GHOST_SNIPER] as any;
    const { dps } = dpsFromSpec(spec, 7);
    expect(dps).toBeGreaterThanOrEqual(680);
    expect(dps).toBeLessThanOrEqual(720);
  });

  it('Spectral Executioner L1 ≈ 1200 DPS after nerf', () => {
    const spec = WEAPON_SPECS[WeaponType.SPECTRAL_EXECUTIONER] as any;
    const { dps } = dpsFromSpec(spec, 1);
    expect(dps).toBeGreaterThanOrEqual(1160);
    expect(dps).toBeLessThanOrEqual(1240);
  });
});
