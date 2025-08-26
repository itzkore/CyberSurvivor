import { CHARACTERS } from '../data/characters';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { WeaponType } from '../game/WeaponType';
import { Logger } from '../core/Logger';

export class DatabasePanel {
  private el: HTMLElement | null = null;
  private currentTab: 'operatives' | 'weapons' | 'passives' | 'glossary' = 'operatives';

  constructor() {
    this.create();
  }

  public open(): void {
    if (!this.el) this.create();
    (this.el as HTMLElement).style.display = 'block';
    this.renderTab();
  }

  public close(): void {
    if (this.el) (this.el as HTMLElement).style.display = 'none';
  }

  private create(): void {
    // Remove old
    const old = document.getElementById('database-panel');
    if (old) old.remove();

    const root = document.createElement('div');
    root.id = 'database-panel';
    root.className = 'database-panel modal-like';
    root.style.cssText = `
      position: fixed; inset: 0; z-index: 1000; display: none; color: #E6F2FF;
      background: rgba(0,0,0,0.65);
    `;
    root.innerHTML = `
      <div class="db-shell">
        <div class="db-header">
          <div class="db-title">GAME DATABASE</div>
          <button id="db-close" class="nav-btn mini" title="Close">✕</button>
        </div>
        <div class="db-tabs">
          <button class="db-tab" data-tab="operatives">Operatives</button>
          <button class="db-tab" data-tab="weapons">Weapons</button>
          <button class="db-tab" data-tab="passives">Passives</button>
          <button class="db-tab" data-tab="glossary">Glossary</button>
        </div>
        <div id="db-content" class="db-content">Loading…</div>
      </div>
    `;

    // Minimal styling tuned to existing UI
    const style = document.createElement('style');
    style.textContent = `
      .db-shell{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1280px,96vw);height:min(780px,92vh);background:rgba(10,14,20,0.95);border:1px solid #173B61;box-shadow:0 0 24px rgba(0,255,255,0.12);border-radius:10px;display:flex;flex-direction:column}
      .db-header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #173B61;background:linear-gradient(180deg,rgba(20,30,45,0.9),rgba(12,18,28,0.9))}
      .db-title{font-size:18px;letter-spacing:1px;color:#7EE6FF}
      .db-tabs{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #173B61}
      .db-tab{padding:6px 10px;background:#0E1622;color:#A8D7E6;border:1px solid #173B61;border-radius:6px;font-size:12px;cursor:pointer}
      .db-tab.active{background:#0F2533;color:#E6F2FF;border-color:#2E8EB3}
      .db-content{flex:1;overflow:auto;padding:10px 12px}
      .db-table{width:100%;border-collapse:collapse;font-size:12px}
      .db-table th,.db-table td{border-bottom:1px solid #143049;padding:6px 8px;text-align:left}
      .db-table th{position:sticky;top:0;background:#0D1824;z-index:1}
      .badge{display:inline-block;padding:1px 6px;border:1px solid #275A7A;border-radius:999px;color:#9EE6FF;background:#0B1B26;margin-right:4px}
      .dim{color:#8AA7B3}
      .mono{font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace}
      .muted{color:#7A93A1}
      .small{font-size:11px}
      .nowrap{white-space:nowrap}
    `;

    root.appendChild(style);
    document.body.appendChild(root);
    this.el = root;
    this.setupListeners();
  }

  private setupListeners(): void {
    if (!this.el) return;
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t && t.id === 'db-close') { this.close(); return; }
      if (t && t.classList.contains('db-tab')) {
        const tab = t.getAttribute('data-tab') as any;
        if (tab) { this.currentTab = tab; this.renderTab(); }
      }
    });
  }

  private setActiveTabButton(): void {
    if (!this.el) return;
    this.el.querySelectorAll('.db-tab').forEach(btn => btn.classList.remove('active'));
    const active = this.el.querySelector(`.db-tab[data-tab="${this.currentTab}"]`);
    if (active) active.classList.add('active');
  }

  private renderTab(): void {
    if (!this.el) return;
    this.setActiveTabButton();
    const content = this.el.querySelector('#db-content') as HTMLElement;
    if (!content) return;
    try {
      switch (this.currentTab) {
        case 'operatives': content.innerHTML = this.renderOperatives(); break;
        case 'weapons': content.innerHTML = this.renderWeapons(); break;
        case 'passives': content.innerHTML = this.renderPassives(); break;
        case 'glossary': content.innerHTML = this.renderGlossary(); break;
      }
    } catch (err) {
      Logger.warn('DatabasePanel render error', err as any);
      content.innerHTML = '<div class="muted">Failed to render. See logs.</div>';
    }
  }

  private renderOperatives(): string {
    // Build rows from CHARACTERS and default weapon L1 damage
    const rows: string[] = [];
    for (const c of CHARACTERS) {
      const s: any = c.stats as any;
      // Default weapon damage at L1 (derived if function present)
      const spec = WEAPON_SPECS[c.defaultWeapon as keyof typeof WEAPON_SPECS];
      const wName = spec?.name ?? WeaponType[c.defaultWeapon] ?? String(c.defaultWeapon);
      let wDmg = spec?.damage as number | undefined;
      try { if (spec?.getLevelStats) { const ls = spec.getLevelStats(1) as any; if (typeof ls?.damage === 'number') wDmg = ls.damage; } } catch {}
      const icon = (c.icon || '').startsWith('/assets/') && typeof location !== 'undefined' && location.protocol === 'file:' ? ('.' + c.icon) : c.icon;
      rows.push(`
        <tr>
          <td class="nowrap"><img src="${icon}" alt="" style="width:28px;height:28px;object-fit:contain;vertical-align:middle;margin-right:6px">${c.name}</td>
          <td>${wName}${wDmg!=null?` <span class=\"dim\">(L1 ${wDmg})</span>`:''}</td>
          <td class="mono">HP ${s.hp} / DEF ${s.defense}</td>
          <td class="mono">DMG ${s.damage} <span class="dim">→ Index ${s.damageIndex ?? '—'}</span></td>
          <td class="mono">SPD ${s.speed} <span class="dim">→ Move ${s.movementIndex ?? '—'}</span></td>
          <td class="mono">CRIT ${s.critChance ?? '—'}%</td>
          <td class="mono">SURV ${s.survivability ?? '—'}</td>
          <td class="mono">POWER ${s.powerScore ?? '—'}</td>
        </tr>
      `);
    }
    return `
      <table class="db-table">
        <thead><tr>
          <th>Operative</th><th>Default Weapon</th><th>Defense</th><th>Damage</th><th>Movement</th><th>Crit</th><th>Survive</th><th>Power</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  }

  private renderWeapons(): string {
    const sections: string[] = [];
    const entries = Object.values(WEAPON_SPECS) as any[];
    for (const spec of entries) {
      const name = spec?.name ?? 'Unknown';
      const base = `DMG ${spec?.damage ?? '?'} · CD ${spec?.cooldown ?? '?'}f · Salvo ${spec?.salvo ?? 1}${spec?.range?` · Range ${spec.range}`:''}`;
      const traits = Array.isArray(spec?.traits) ? spec.traits.map((t:string)=>`<span class="badge">${t}</span>`).join(' ') : '';
      // Level table (1..maxLevel if getLevelStats provided)
      let levels = '';
      try {
        const maxL = Math.max(1, Number(spec?.maxLevel ?? 7));
        if (typeof spec?.getLevelStats === 'function') {
          const rows: string[] = [];
          for (let lvl=1; lvl<=maxL; lvl++) {
            const ls = spec.getLevelStats(lvl) || {};
            const dmg = (ls as any).damage ?? '—';
            const cd = (ls as any).cooldown ?? '—';
            const salvo = (ls as any).salvo ?? spec.salvo ?? '—';
            rows.push(`<tr><td>${lvl}</td><td class="mono">${dmg}</td><td class="mono">${cd}</td><td class="mono">${salvo}</td></tr>`);
          }
          levels = `
            <table class="db-table small" style="margin:6px 0 10px">
              <thead><tr><th style="width:44px">Lv</th><th>Dmg</th><th>Cooldown</th><th>Salvo</th></tr></thead>
              <tbody>${rows.join('')}</tbody>
            </table>
          `;
        }
      } catch {}
      sections.push(`
        <div class="weapon-block" style="padding:8px 6px;border:1px solid #123047;border-radius:8px;margin:8px 0;background:#0B141E">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
            <div><div style="font-size:14px;color:#E6F2FF">${name}</div>
            <div class="muted small">${base}</div></div>
            <div>${traits}</div>
          </div>
          ${levels}
          ${spec?.description?`<div class="small muted" style="margin-top:4px">${spec.description}</div>`:''}
        </div>
      `);
    }
    return `<div>${sections.join('')}</div>`;
  }

  private renderPassives(): string {
    const rows: string[] = [];
    for (const p of PASSIVE_SPECS) {
      rows.push(`
        <tr>
          <td>${p.icon?`<img src="${(typeof location!=='undefined'&&location.protocol==='file:'&&p.icon.startsWith('/assets/')?'.'+p.icon:p.icon)}" alt="" style="width:20px;height:20px;vertical-align:middle;margin-right:6px">`:''}${p.name}</td>
          <td class="mono">${p.maxLevel}</td>
          <td class="small">${p.description ?? ''}</td>
          <td class="small dim">${this.describePassive(p.name)}</td>
        </tr>
      `);
    }
    return `
      <table class="db-table">
        <thead><tr><th>Passive</th><th>Max Lv</th><th>Description</th><th>Scaling</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    `;
  }

  private describePassive(name: string): string {
    switch (name) {
      case 'Speed Boost': return '+0.5 movement per level (additive)';
      case 'Max HP': return '+20 HP/level (L1–5), then +15 (L6–7); heal 55% of gained HP';
      case 'Damage Up': return '+14% global damage per level';
      case 'Fire Rate': return '+13% weapon fire rate per level';
      case 'AOE On Kill': return 'Gain small explosion on enemy death (fixed)';
      case 'Magnet': return '+36 pickup radius per level (to L5)';
      case 'Shield': return '+5.5% block chance per level (cap 50%)';
      case 'Crit': return '+3.75% crit chance and +0.095x crit multiplier per level (soft cap 3.1x)';
      case 'Piercing': return 'Bullets pierce +1/+2/+3 enemies (levels 1–3)';
      case 'Regen': return 'Regen per second: 0.125×level (to L5), then +0.09 each (L6–7)';
      default: return '';
    }
  }

  private renderGlossary(): string {
    return `
      <div class="small">
        <p class="muted">Formulas are for display; gameplay uses per-weapon stats and systems.</p>
        <ul style="line-height:1.6">
          <li><b>Survivability</b>: hp × (1 + defense/50)</li>
          <li><b>Damage</b> (index): round(damage × (1 + (strength×0.6 + intelligence×0.8)/50))</li>
          <li><b>Movement</b> (index): round(speed × (1 + agility/20))</li>
          <li><b>Crit Chance</b> (display): round((agility×0.8 + luck×1.2) × 0.5), capped at 60%</li>
          <li><b>Power</b> (index): weighted blend of offense/utility, see code for weights</li>
          <li><b>Note</b>: Operative “damage” is not per-shot; real hit damage comes from the weapon (see Weapons tab).</li>
        </ul>
      </div>
    `;
  }
}
