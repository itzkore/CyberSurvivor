import { loadJSON, lastStandData } from './config-loader';

type TurretSpec = { id:string; name:string; range:number; dps:number[]; price:number[] };
type TurretInst = { id:string; x:number; y:number; level:number; spec:TurretSpec };

export class TurretManager {
  private specs: Record<string, TurretSpec> = Object.create(null);
  private turrets: TurretInst[] = [];

  async load(): Promise<void> {
    try {
      const url = lastStandData.turrets();
      const json = await loadJSON<Record<string, Omit<TurretSpec,'id'> & {id?:string}>>(url);
      const out: Record<string, TurretSpec> = Object.create(null);
      for (const k of Object.keys(json||{})) {
        const v = json[k] as any;
        const id = v.id || k;
        out[id] = { id, name: v.name || id, range: v.range || 420, dps: v.dps || [25,40,60,90], price: v.price || [80,120,180,260] };
      }
      this.specs = out;
    } catch {
      this.specs = {
        'turret_gun': { id:'turret_gun', name:'Gun Turret', range: 520, dps: [30,48,72,110], price:[80,120,180,260] }
      };
    }
  }

  list(): TurretInst[] { return this.turrets; }
  getSpec(id:string){ return this.specs[id]; }

  place(id: string, x: number, y: number) {
    const spec = this.specs[id]; if (!spec) return false;
    this.turrets.push({ id, x, y, level: 1, spec });
    return true;
  }

  upgrade(t: TurretInst) { if (t.level < t.spec.dps.length) t.level++; }
  remove(t: TurretInst) { const i = this.turrets.indexOf(t); if (i>=0) this.turrets.splice(i,1); }

  update(deltaMs: number, enemyManager: any) {
    if (!this.turrets.length) return;
    // Apply damage per second to closest enemy in range for each turret
    for (let i=0;i<this.turrets.length;i++) {
      const t = this.turrets[i];
      const dps = t.spec.dps[Math.min(t.level-1, t.spec.dps.length-1)];
      const dmg = dps * (deltaMs/1000);
      // Find closest enemy
      const enemies = enemyManager.getEnemies?.() || [];
      let best:any = null; let bestD2 = Infinity;
      for (let j=0;j<enemies.length;j++) {
        const e = enemies[j]; if (!e.active || e.hp<=0) continue;
        const dx = e.x - t.x, dy = e.y - t.y; const d2 = dx*dx + dy*dy;
        if (d2 < bestD2 && d2 <= t.spec.range*t.spec.range) { best = e; bestD2 = d2; }
      }
      if (best) enemyManager.takeDamage?.(best, dmg, false, true);
    }
  }
}
