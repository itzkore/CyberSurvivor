/**
 * Tech Warrior Glide Dash (Shift) — short, smooth dash with brief i-frames and afterimages
 */
export const GlideShift = {
  key: 'SHIFT',
  id: 'tech_glide',
  getMeter: (p: any) => {
    const manager = p.abilityManager;
    if (manager && manager.operativeId === 'tech_warrior') {
      const meters = manager.getAbilityMeters();
      return meters.tech_glide ?? null;
    }
    return null;
  }
};