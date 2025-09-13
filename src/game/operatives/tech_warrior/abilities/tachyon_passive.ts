/**
 * Tech Warrior Tachyon Passive — builds up charge on spear hits for supercharged volleys
 */
export const TachyonPassive = {
  key: 'SPACE',
  id: 'tachyon_charge',
  getMeter: (p: any) => {
    const manager = p.abilityManager;
    if (manager && manager.operativeId === 'tech_warrior') {
      const meters = manager.getAbilityMeters();
      return meters.tachyon_charge ?? null;
    }
    return null;
  }
};