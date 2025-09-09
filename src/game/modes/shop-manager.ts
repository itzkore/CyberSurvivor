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
    if (!list || list?.length === 0) { this.allowedWeapons = null; return; }
    const norm: WeaponType[] = list.filter(v => typeof v === 'number') as WeaponType[];
    this.allowedWeapons = new Set(norm);
  }

  async load(): Promise<void> {
    try {
      const url = lastStandData.items();
      const json = await loadJSON<{ items: Item[] }>(url);
      this.items = json?.items || [];
      if (!this.items.some(i => i.id === 'bonus_flashlight')) {
        this.items.push({ id:'bonus_flashlight', kind:'bonus', price:70, weight: 0.9, data:{ name:'Flashlight' } });
      }
    } catch {
      this.items = [
        { id:'w_railgun', kind:'weapon', price:120, data:{ weaponType: WeaponType.RAILGUN }, weight: 1 },
        { id:'w_mortar', kind:'weapon', price:120, data:{ weaponType: WeaponType.MECH_MORTAR }, weight: 1 },
        { id:'p_vision', kind:'passive', price:80, data:{ passiveName: PASSIVE_SPECS.find(p=>p.id===16)?.name || 'Vision' }, weight: 1 },
        { id:'perk_hp', kind:'perk', price:60, data:{ hp:+40 }, weight: 1 },
        { id:'bonus_flashlight', kind:'bonus', price:70, data:{ name:'Flashlight' }, weight: 1 }
      ];
    }
  }

  rollOffers(count = 8, seed?: number): Item[] {
    const r = this.rng(seed);
    let ownedWeaponTypes = new Set<number>();
    let ownedPassiveNames = new Set<string>();
    let classWeaponType: number | null = null;
    const weaponLevels: Record<number, number> = Object.create(null);
    try {
      const g:any = (window as any).__gameInstance || (window as any).game || {};
      if (g?.selectedCharacterData && typeof g.selectedCharacterData.defaultWeapon === 'number') {
        classWeaponType = g.selectedCharacterData.defaultWeapon | 0;
      }
      const aw: Map<number, number> | undefined = g?.player?.activeWeapons;
      if (aw && typeof (aw as any).forEach === 'function') {
        (aw as any).forEach((v:number,k:number)=> { ownedWeaponTypes.add(k); weaponLevels[k] = v|0; });
      }
      const ap: Array<{type:string,level:number}> | undefined = g?.player?.activePassives;
      if (Array.isArray(ap)) { for (const p of ap) { if (p?.type) ownedPassiveNames.add(p.type); } }
    } catch { /* ignore */ }
    const weaponCapReached = ownedWeaponTypes.size >= 3;
    const passiveCapReached = ownedPassiveNames.size >= 3;
    type WItem = { item: Item; weight: number };
    const basePool: WItem[] = [];
    const perkPool: WItem[] = [];
    for (let i=0;i<this.items.length;i++) {
      const it = this.items[i];
      if (it.kind === 'turret') continue;
      if (it.kind === 'weapon') {
        const wt = it.data?.weaponType as WeaponType | undefined;
        if (!this.allowedWeapons || wt === undefined || !this.allowedWeapons.has(wt)) continue;
        if (weaponCapReached) {
          if (!ownedWeaponTypes.has(wt as any)) continue;
        }
        const isEvolved = (wt === WeaponType.DUAL_PISTOLS) || (wt === WeaponType.RUNIC_ENGINE);
        if (isEvolved) {
          let base: number | null = null; let passive: string | null = null;
          if (wt === WeaponType.DUAL_PISTOLS) { base = WeaponType.PISTOL; passive = 'Crit'; }
          else if (wt === WeaponType.RUNIC_ENGINE) { base = WeaponType.DATA_SIGIL; passive = 'Area Up'; }
          if (base != null) {
            const lvl = weaponLevels[base] || 0;
            const hasPassive = passive ? ownedPassiveNames.has(passive) : true;
            if (!(lvl >= 7 && hasPassive)) continue;
          }
        }
      }
      let w = it.weight ?? 1;
      if (it.kind === 'passive') {
        const name = it.data?.passiveName as string | undefined;
        if (passiveCapReached && name && !ownedPassiveNames.has(name)) continue;
        w *= 1.25;
      }
      if (it.kind === 'perk') {
        if (w > 0) perkPool.push({ item: it, weight: w });
      } else if (it.kind === 'bonus') {
        if (w > 0) perkPool.push({ item: it, weight: w * 0.9 });
      } else {
        if (w > 0) basePool.push({ item: it, weight: w });
      }
    }
    let pool: WItem[] = basePool.slice();
    const out: Item[] = [];
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
    while (out.length < count && pool.length) {
      const total = pool.reduce((s,p)=> s + p.weight, 0);
      let pick = r()*total; let idx = 0;
      for (; idx<pool.length; idx++) { pick -= pool[idx].weight; if (pick <= 0) break; }
      const chosen = pool[idx] || pool[pool.length-1];
      out.push(chosen.item);
      pool.splice(idx,1);
    }
    while (out.length < count && perkPool.length) {
      const total = perkPool.reduce((s,p)=> s + p.weight, 0);
      let pick = r()*total; let idx = 0;
      for (; idx<perkPool.length; idx++) { pick -= perkPool[idx].weight; if (pick <= 0) break; }
      const chosen = perkPool[idx] || perkPool[perkPool.length-1];
      out.push(chosen.item);
      perkPool.splice(idx,1);
    }
    try {
      const gm = (window as any).__gameInstance?.gameMode;
      const isLS = gm === 'LAST_STAND';
      if (isLS && typeof classWeaponType === 'number' && classWeaponType != null) {
        const wt = classWeaponType as any;
        const allowed = !this.allowedWeapons || this.allowedWeapons.has(wt);
        const owned = ownedWeaponTypes.has(wt);
        const atCap = ownedWeaponTypes.size >= 3;
        if (allowed && (!atCap || owned)) {
          let existing = out.find(i => i.kind === 'weapon' && i.data?.weaponType === wt);
          const level = (weaponLevels[wt] || 0) | 0;
          const price = Math.max(120, (owned ? (220 + 60 * level) : 260));
          if (existing) existing.price = price; else {
            const guaranteed: Item = { id: `w_class_${wt}`, kind: 'weapon', price, data: { weaponType: wt }, weight: 0.01 };
            if (out.length < count) out.push(guaranteed); else {
              let repIdx = out.findIndex(i => i.kind === 'perk');
              if (repIdx < 0) repIdx = out.findIndex(i => i.kind === 'bonus');
              if (repIdx < 0) repIdx = out.findIndex(i => i.kind === 'passive');
              if (repIdx < 0) repIdx = out.length - 1;
              out[repIdx] = guaranteed;
            }
          }
        }
      }
    } catch {}
    try {
      const gi: any = (window as any).__gameInstance;
      if (gi && gi.gameMode === 'LAST_STAND') {
        const ls: any = gi.lastStand || (gi as any).getLastStand?.();
        if (ls) {
          try {
            const next = typeof ls.getTowerPlusNextCost === 'function' ? (ls.getTowerPlusNextCost() as number) : 0;
            const card: Item = { id: 'ls_tower_plus', kind: 'bonus', price: next, weight: 0.01, data: { name: 'Tower+' } };
            if (out.length < count) out.push(card); else {
              let repIdx = out.findIndex(i => i.kind === 'perk');
              if (repIdx < 0) repIdx = out.findIndex(i => i.kind === 'bonus' && i.id !== 'ls_gate' && i.id !== 'ls_tower_plus');
              if (repIdx < 0) repIdx = out.findIndex(i => i.kind === 'passive');
              if (repIdx < 0) {
                for (let k = out.length - 1; k >= 0; k--) {
                  const it = out[k];
                  if (!(it.kind === 'bonus' && (it.id === 'ls_gate' || it.id === 'ls_tower_plus'))) { repIdx = k; break; }
                }
                if (repIdx < 0) repIdx = out.length - 1;
              }
              out[repIdx] = card;
            }
          } catch {}
          try {
            const nextG = typeof ls.getGateNextCost === 'function' ? (ls.getGateNextCost() as number) : 0;
            const card: Item = { id: 'ls_gate', kind: 'bonus', price: nextG, weight: 0.01, data: { name: 'Gate' } };
            if (out.length < count) out.push(card); else {
              let repIdx = out.findIndex(i => i.kind === 'perk');
              if (repIdx < 0) repIdx = out.findIndex(i => i.kind === 'bonus' && i.id !== 'ls_gate' && i.id !== 'ls_tower_plus');
              if (repIdx < 0) repIdx = out.findIndex(i => i.kind === 'passive');
              if (repIdx < 0) {
                for (let k = out.length - 1; k >= 0; k--) {
                  const it = out[k];
                  if (!(it.kind === 'bonus' && (it.id === 'ls_gate' || it.id === 'ls_tower_plus'))) { repIdx = k; break; }
                }
                if (repIdx < 0) repIdx = out.length - 1;
              }
              out[repIdx] = card;
            }
          } catch {}
        }
      }
    } catch {}
    return out;
  }

  purchase(item: Item, game: any, currency: CurrencySystem, useFree: boolean = false): boolean {
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
          const ownedP = (Array.isArray(game?.player?.activePassives) ? game.player.activePassives.length : 0) as number;
          const already = (() => { try { const n = item.data?.passiveName; return !!game?.player?.activePassives?.find((p:any)=>p.type===n); } catch { return false; } })();
          if (!already && ownedP >= 3) {
            try { window.dispatchEvent(new CustomEvent('upgradeNotice', { detail: { type: 'passive-cap', message: 'Passive slots full (3/3). Upgrade existing passives.' } })); } catch {}
            return false;
          }
        }
      }
    } catch { /* ignore */ }
    if (useFree && currency.hasFreeUpgrade()) {
      currency.consumeFreeUpgrade();
    } else {
      if (!currency.spend(item.price)) return false;
    }
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
          } else if (item.id === 'ls_tower_plus') {
            try { (game?.lastStand || (window as any).__gameInstance?.lastStand)?.grantTowerPlus?.(); } catch {}
          } else if (item.id === 'ls_gate') {
            try { (game?.lastStand || (window as any).__gameInstance?.lastStand)?.upgradeGate?.(); } catch {}
          }
          break;
        }
        case 'passive': {
          const name = item.data?.passiveName as string | undefined;
          if (name) game.player.addPassive(name);
          break;
        }
        case 'perk': {
          const hp = item.data?.hp as number | undefined;
          if (hp) game.player.maxHp += hp, game.player.hp += hp;
          break;
        }
        case 'turret': {
          window.dispatchEvent(new CustomEvent('laststand:placeTurret', { detail: { turretId: item.id } }));
          break;
        }
      }
      return true;
    } catch { return false; }
  }
}
