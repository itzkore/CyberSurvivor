import { loadJSON, lastStandData } from './config-loader';
import { CurrencySystem } from './currency-system';
import { WeaponType } from '../../game/WeaponType';
import { PASSIVE_SPECS } from '../../game/PassiveConfig';

type Item = { id: string; kind: 'weapon'|'passive'|'turret'|'perk'|'bonus'; price: number; weight?: number; data?: any };

export class ShopManager {
  private items: Item[] = [];
  private rng(seed = Math.random()) { return () => (seed = (seed*9301+49297)%233280) / 233280; }
  private allowedWeapons: Set<WeaponType> | null = null;

  /** Limit weapon offers to the provided list (by WeaponType). Pass null to allow all. */
  public setAllowedWeapons(list: WeaponType[] | null | undefined) {
    if (!list || list.length === 0) { this.allowedWeapons = null; return; }
    // Normalize and store in a Set for O(1) checks
    const norm: WeaponType[] = list.filter(v => typeof v === 'number') as WeaponType[];
    this.allowedWeapons = new Set(norm);
  }

  async load(): Promise<void> {
    try {
      const url = lastStandData.items();
      const json = await loadJSON<{ items: Item[] }>(url);
      this.items = json?.items || [];
      // Ensure flashlight bonus exists (append if missing)
      if (!this.items.some(i => i.id === 'bonus_flashlight')) {
        this.items.push({ id:'bonus_flashlight', kind:'bonus', price:70, weight: 0.9, data:{ name:'Flashlight' } });
      }
    } catch {
      // Fallback minimal offer list
      this.items = [
        { id:'w_railgun', kind:'weapon', price:120, data:{ weaponType: WeaponType.RAILGUN }, weight: 1 },
        { id:'w_mortar', kind:'weapon', price:120, data:{ weaponType: WeaponType.MECH_MORTAR }, weight: 1 },
        { id:'p_vision', kind:'passive', price:80, data:{ passiveName: PASSIVE_SPECS.find(p=>p.id===16)?.name || 'Vision' }, weight: 1 },
        { id:'perk_hp', kind:'perk', price:60, data:{ hp:+40 }, weight: 1 },
        { id:'bonus_flashlight', kind:'bonus', price:70, data:{ name:'Flashlight' }, weight: 1 }
      ];
    }
  }

  rollOffers(count = 6, seed?: number): Item[] {
    const r = this.rng(seed);
    // Detect loadout state to bias/limit offers when capped
    let ownedWeaponTypes = new Set<number>();
    let ownedPassiveNames = new Set<string>();
    // Track weapon levels for evolution gating (best-effort)
    const weaponLevels: Record<number, number> = Object.create(null);
    try {
      const g:any = (window as any).__gameInstance || (window as any).game || {};
      const aw: Map<number, number> | undefined = g?.player?.activeWeapons;
      if (aw && typeof (aw as any).forEach === 'function') {
        (aw as any).forEach((v:number,k:number)=> { ownedWeaponTypes.add(k); weaponLevels[k] = v|0; });
      }
      const ap: Array<{type:string,level:number}> | undefined = g?.player?.activePassives;
      if (Array.isArray(ap)) { for (const p of ap) { if (p?.type) ownedPassiveNames.add(p.type); } }
    } catch { /* ignore */ }
    const weaponCapReached = ownedWeaponTypes.size >= 3;
    const passiveCapReached = ownedPassiveNames.size >= 3;
    // Build weighted pool with soft class filtering: allowed weapons are favored; others still possible at reduced weight
    type WItem = { item: Item; weight: number };
    const basePool: WItem[] = [];
    const perkPool: WItem[] = [];
    for (let i=0;i<this.items.length;i++) {
      const it = this.items[i];
  // Exclude turret items entirely (turrets sold via holders)
  if (it.kind === 'turret') continue;
  // Bonus items like Flashlight are allowed regardless of caps
      // Only include weapons that match the allowed class kit; if none configured, suppress weapons
      if (it.kind === 'weapon') {
        const wt = it.data?.weaponType as WeaponType | undefined;
        if (!this.allowedWeapons || wt === undefined || !this.allowedWeapons.has(wt)) continue;
        // If at weapon cap, only allow upgrades of already owned weapons
        if (weaponCapReached) {
          if (!ownedWeaponTypes.has(wt as any)) continue; // block new unlocks
        }
        // Evolution gating: don't offer evolved weapons (e.g., Dual Pistols) unless base is level 7 and required passive is owned
        // Known evolved examples in this project: DUAL_PISTOLS (from PISTOL + Crit), RUNIC_ENGINE (from DATA_SIGIL + Area Up)
        const isEvolved = (wt === WeaponType.DUAL_PISTOLS) || (wt === WeaponType.RUNIC_ENGINE);
        if (isEvolved) {
          let base: number | null = null; let passive: string | null = null;
          if (wt === WeaponType.DUAL_PISTOLS) { base = WeaponType.PISTOL; passive = 'Crit'; }
          else if (wt === WeaponType.RUNIC_ENGINE) { base = WeaponType.DATA_SIGIL; passive = 'Area Up'; }
          if (base != null) {
            const lvl = weaponLevels[base] || 0;
            const hasPassive = passive ? ownedPassiveNames.has(passive) : true;
            if (!(lvl >= 7 && hasPassive)) continue; // block evolved until prerequisites
          }
        }
      }
      let w = it.weight ?? 1;
      // Slightly favor passives to lean into upgrades
      if (it.kind === 'passive') {
        // If at passive cap, only allow upgrades of already owned passives
        const name = it.data?.passiveName as string | undefined;
        if (passiveCapReached && name && !ownedPassiveNames.has(name)) {
          continue; // block new passive unlocks
        }
        w *= 1.25;
      }
      if (it.kind === 'perk') {
        if (w > 0) perkPool.push({ item: it, weight: w });
      } else if (it.kind === 'bonus') {
        if (w > 0) perkPool.push({ item: it, weight: w * 0.9 }); // treat bonus like perk for filler
      } else {
        if (w > 0) basePool.push({ item: it, weight: w });
      }
    }
    let pool: WItem[] = basePool.slice();
    const out: Item[] = [];
    // Light guarantees: try to include at least two weapons and two passives when available
    const pickOneByKind = (kind: Item['kind']) => {
      const candidates = pool.filter(p => p.item.kind === kind);
      if (!candidates.length) return false;
      const total = candidates.reduce((s,p)=> s + p.weight, 0);
      let pick = r()*total; let idx = -1; let chosen: WItem | null = null;
      for (let i=0;i<candidates.length;i++) { pick -= candidates[i].weight; if (pick <= 0) { idx = i; chosen = candidates[i]; break; } }
      if (!chosen) { chosen = candidates[candidates.length-1]; }
      out.push(chosen.item);
      const poolIdx = pool.findIndex(p => p.item === chosen!.item);
      if (poolIdx >= 0) pool.splice(poolIdx,1);
      return true;
    };
    if (count >= 4) {
      pickOneByKind('weapon');
      pickOneByKind('weapon');
      pickOneByKind('passive');
      pickOneByKind('passive');
    }
    // Fill with weighted random without replacement; no refills to avoid duplicates
    while (out.length < count && pool.length) {
      const total = pool.reduce((s,p)=> s + p.weight, 0);
      let pick = r()*total; let idx = 0;
      for (; idx<pool.length; idx++) { pick -= pool[idx].weight; if (pick <= 0) break; }
      const chosen = pool[idx] || pool[pool.length-1];
      out.push(chosen.item);
      pool.splice(idx,1);
    }
    // If not enough items to reach count, use unique perks as a fallback to fill up to count
    while (out.length < count && perkPool.length) {
      const total = perkPool.reduce((s,p)=> s + p.weight, 0);
      let pick = r()*total; let idx = 0;
      for (; idx<perkPool.length; idx++) { pick -= perkPool[idx].weight; if (pick <= 0) break; }
      const chosen = perkPool[idx] || perkPool[perkPool.length-1];
      out.push(chosen.item);
      perkPool.splice(idx,1);
    }
    return out;
  }

  purchase(item: Item, game: any, currency: CurrencySystem): boolean {
    // Enforce Last Stand specific caps: max 3 weapons, max 3 passives
    try {
      const isLastStand = ((window as any).__gameInstance?.gameMode) === 'LAST_STAND';
      if (isLastStand) {
        if (item.kind === 'weapon') {
          const ownedW = (game?.player?.activeWeapons?.size ?? 0) as number;
          const hasWeapon = (() => { try { return game?.player?.activeWeapons?.has(item.data?.weaponType) === true; } catch { return false; } })();
          if (!hasWeapon && ownedW >= 3) {
            try { window.dispatchEvent(new CustomEvent('upgradeNotice', { detail: { type: 'weapon-cap', message: 'Weapon slots full (3/3). Upgrade existing weapons.' } })); } catch {}
            return false;
          }
        } else if (item.kind === 'passive') {
          // Count unique passives (not levels)
          const ownedP = (Array.isArray(game?.player?.activePassives) ? game.player.activePassives.length : 0) as number;
          const already = (() => { try { const n = item.data?.passiveName; return !!game?.player?.activePassives?.find((p:any)=>p.type===n); } catch { return false; } })();
          if (!already && ownedP >= 3) {
            try { window.dispatchEvent(new CustomEvent('upgradeNotice', { detail: { type: 'passive-cap', message: 'Passive slots full (3/3). Upgrade existing passives.' } })); } catch {}
            return false;
          }
        }
      }
    } catch { /* ignore */ }
    if (!currency.spend(item.price)) return false;
    // Route purchase to systems
    try {
      switch (item.kind) {
        case 'weapon': {
          const t = item.data?.weaponType as WeaponType | undefined;
          if (t !== undefined) game.player.addWeapon(t);
          break;
        }
        case 'bonus': {
          if (item.id === 'bonus_flashlight') {
            try { (game?.lastStand || (window as any).__gameInstance?.lastStand)?.grantFlashlight?.(); } catch {}
          }
          break;
        }
        case 'passive': {
          const name = item.data?.passiveName as string | undefined;
          if (name) game.player.addPassive(name);
          break;
        }
        case 'perk': {
          // Simple stat perks
          const hp = item.data?.hp as number | undefined;
          if (hp) game.player.maxHp += hp, game.player.hp += hp;
          break;
        }
        case 'turret': {
          // Placement performed by UI/LastStand controller via event
          window.dispatchEvent(new CustomEvent('laststand:placeTurret', { detail: { turretId: item.id } }));
          break;
        }
      }
      return true;
    } catch { return false; }
  }
}
