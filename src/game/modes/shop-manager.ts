import { loadJSON, lastStandData } from './config-loader';
import { CurrencySystem } from './currency-system';
import { WeaponType } from '../../game/WeaponType';
import { PASSIVE_SPECS } from '../../game/PassiveConfig';

type Item = { id: string; kind: 'weapon'|'passive'|'turret'|'perk'; price: number; weight?: number; data?: any };

export class ShopManager {
  private items: Item[] = [];
  private rng(seed = Math.random()) { return () => (seed = (seed*9301+49297)%233280) / 233280; }

  async load(): Promise<void> {
    try {
      const url = lastStandData.items();
      const json = await loadJSON<{ items: Item[] }>(url);
      this.items = json?.items || [];
    } catch {
      // Fallback minimal offer list
      this.items = [
        { id:'w_railgun', kind:'weapon', price:120, data:{ weaponType: WeaponType.RAILGUN }, weight: 1 },
        { id:'w_mortar', kind:'weapon', price:120, data:{ weaponType: WeaponType.MECH_MORTAR }, weight: 1 },
        { id:'p_vision', kind:'passive', price:80, data:{ passiveName: PASSIVE_SPECS.find(p=>p.id===16)?.name || 'Vision' }, weight: 1 },
        { id:'perk_hp', kind:'perk', price:60, data:{ hp:+40 }, weight: 1 }
      ];
    }
  }

  rollOffers(count = 4, seed?: number): Item[] {
    const r = this.rng(seed);
    // weight-aware random sample without replacement
    const pool = [...this.items];
    const out: Item[] = [];
    for (let i=0;i<count && pool.length;i++) {
      const total = pool.reduce((s,it)=> s + (it.weight ?? 1), 0);
      let pick = r()*total;
      let idx = 0;
      for (; idx<pool.length; idx++) {
        pick -= (pool[idx].weight ?? 1);
        if (pick <= 0) break;
      }
      out.push(pool[idx] || pool[pool.length-1]);
      pool.splice(idx,1);
    }
    return out;
  }

  purchase(item: Item, game: any, currency: CurrencySystem): boolean {
    if (!currency.spend(item.price)) return false;
    // Route purchase to systems
    try {
      switch (item.kind) {
        case 'weapon': {
          const t = item.data?.weaponType as WeaponType | undefined;
          if (t !== undefined) game.player.addWeapon(t);
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
