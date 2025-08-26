import { CHARACTERS } from '../data/characters';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { WeaponType } from '../game/WeaponType';
import { AssetLoader } from '../game/AssetLoader';
import { matrixBackground } from './MatrixBackground';

type Tab = 'operatives' | 'weapons' | 'passives' | 'enemies' | 'bosses' | 'abilities';

/**
 * Codex
 * Fullscreen cyberpunk-styled database with tabs for Operatives, Weapons, Passives, and Enemies.
 * - Weapons include per-level scaling using getLevelStats if available.
 * - Enemies panel lists archetypes used by the dynamic spawner.
 */
export class Codex {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private search: HTMLInputElement;
  private currentTab: Tab = 'operatives';
  private mounted = false;
  private bossItems: Array<{ key: string; name: string; file: string; w?: number; h?: number; frames?: number; telegraph?: boolean }> | null = null;
  private bossLoading = false;
  private expandedWeapons: Set<string> = new Set();
  private pendingScrollToWeapon: string | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'codex-panel';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div class="codex-shell" id="codex-shell">
        <header class="codex-header">
          <div class="codex-title">CODEX <span>DATABASE</span></div>
          <div class="codex-actions">
            <input id="codex-search" type="text" placeholder="Search…" aria-label="Search Codex" />
            <button id="codex-back" class="codex-btn">BACK</button>
          </div>
        </header>
        <nav class="codex-tabs">
          <button class="codex-tab active" data-tab="operatives">Operatives</button>
          <button class="codex-tab" data-tab="weapons">Weapons</button>
          <button class="codex-tab" data-tab="passives">Passives</button>
          <button class="codex-tab" data-tab="enemies">Enemies</button>
          <button class="codex-tab" data-tab="bosses">Bosses</button>
          <button class="codex-tab" data-tab="abilities">Abilities</button>
        </nav>
        <main class="codex-body" id="codex-body"></main>
      </div>`;

    document.body.appendChild(this.root);
    this.body = this.root.querySelector('#codex-body') as HTMLDivElement;
    this.search = this.root.querySelector('#codex-search') as HTMLInputElement;
    this.installStyles();
    this.bindEvents();
    this.render();
  }

  private installStyles() {
    if (document.getElementById('codex-styles')) return;
    const style = document.createElement('style');
    style.id = 'codex-styles';
    style.textContent = `
      #codex-panel{position:fixed;inset:0;display:flex;align-items:stretch;justify-content:center;background:radial-gradient(circle at 50% 40%,#041116 0%, #01070a 75%);z-index:20}
      .codex-shell{display:flex;flex-direction:column;gap:10px;flex:1 1 auto;padding:16px;max-width:1600px}
      .codex-header{display:flex;align-items:center;justify-content:space-between}
      .codex-title{font:700 24px Orbitron, sans-serif;letter-spacing:1.2px;color:#5EEBFF;text-shadow:0 0 10px #0ff}
      .codex-title span{font-weight:400;opacity:.85}
      .codex-actions{display:flex;gap:10px;align-items:center}
      .codex-actions input{background:rgba(0,35,45,.7);border:1px solid rgba(0,255,255,.35);color:#c8f7ff;border-radius:6px;padding:8px 10px;min-width:220px}
      .codex-btn{background:rgba(0,35,45,.7);border:1px solid rgba(0,255,255,.5);color:#9fe;letter-spacing:.8px;border-radius:6px;padding:8px 12px}
      .codex-tabs{display:flex;gap:8px}
      .codex-tab{padding:8px 12px;border:1px solid rgba(0,255,255,.35);background:rgba(0,25,38,.6);color:#b8faff;border-radius:6px}
      .codex-tab.active{background:rgba(0,255,255,.12);box-shadow:inset 0 0 10px rgba(0,255,255,.18)}
      .codex-body{flex:1 1 auto;overflow:auto;border:1px solid rgba(0,255,255,.35);background:rgba(0,35,48,.35);padding:12px;border-radius:8px}
      .cdx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .cdx-card{border:1px solid rgba(0,255,255,.25);background:rgba(0,18,24,.55);border-radius:8px;padding:10px;display:flex;gap:10px;overflow:hidden}
      .cdx-card .icon{width:64px;height:64px;flex:0 0 auto;border:1px solid rgba(0,255,255,.25);border-radius:6px;background:#03222b;display:flex;align-items:center;justify-content:center}
  .cdx-card .icon img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated}
  .cdx-card .icon.boss{width:128px;height:128px;background:#02161b}
      .cdx-card .meta{flex:1 1 auto}
      .cdx-card .name{font:700 14px/1 Orbitron, sans-serif;color:#5EEBFF;margin-bottom:4px}
  .cdx-card .desc{font:12px/1.4 Inter, system-ui, sans-serif;color:#bfe9ff;opacity:.9;word-break:break-word;overflow-wrap:anywhere}
      .cdx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
      .cdx-stat{font:11px/1.3 Inter;color:#c8f7ff;background:rgba(0,255,255,.06);border:1px solid rgba(0,255,255,.18);padding:4px;border-radius:4px}
  .cdx-table{width:100%;border-collapse:collapse;margin-top:6px;font:12px/1.4 Inter;color:#c8f7ff;display:block;overflow:auto}
      .cdx-table th,.cdx-table td{border:1px solid rgba(0,255,255,.18);padding:4px 6px;text-align:right}
      .cdx-table th{text-align:center;color:#5EEBFF;background:rgba(0,255,255,.08)}
      .cdx-note{font:11px/1.5 Inter;color:#a9e9ff;opacity:.85;margin-top:4px}
  .cdx-compact-head{display:flex;gap:10px;align-items:flex-start}
  .cdx-compact-head .meta{display:flex;flex-direction:column;gap:4px}
  .cdx-compact-actions{display:flex;gap:8px;margin-top:6px}
  .cdx-toggle{padding:6px 10px;border:1px solid rgba(0,255,255,.35);background:rgba(0,25,38,.6);color:#b8faff;border-radius:6px;cursor:pointer}
  .cdx-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .cdx-badge{font:10px/1.4 Inter;color:#9fe;background:rgba(0,255,255,.06);border:1px solid rgba(0,255,255,.18);padding:2px 6px;border-radius:999px}
  .cdx-highlight{outline:2px solid rgba(94,235,255,.9);box-shadow:0 0 12px rgba(94,235,255,.6) inset;border-radius:8px}
    `;
    document.head.appendChild(style);
  }

  private bindEvents() {
    this.root.querySelector('#codex-back')?.addEventListener('click', () => {
      this.hide();
      window.dispatchEvent(new CustomEvent('showMainMenu'));
    });
    this.root.querySelectorAll('.codex-tab').forEach(el => {
      el.addEventListener('click', (e) => {
        const t = (e.currentTarget as HTMLElement).getAttribute('data-tab') as Tab | null;
        if (!t) return;
        this.currentTab = t;
        this.root.querySelectorAll('.codex-tab').forEach(b => b.classList.toggle('active', (b as HTMLElement).getAttribute('data-tab') === t));
        this.render();
      });
    });
    this.search.addEventListener('input', () => this.render());
    // Toggle expand/collapse for weapon details using event delegation
    this.body.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest('.cdx-toggle') as HTMLElement | null;
      if (!el) return;
      const key = el.getAttribute('data-key');
      if (!key) return;
      if (this.expandedWeapons.has(key)) this.expandedWeapons.delete(key);
      else this.expandedWeapons.add(key);
      this.render();
    });

    // Open a specific weapon entry from Operatives and scroll to it
    this.body.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest('.cdx-open-weapon') as HTMLElement | null;
      if (!el) return;
      const key = el.getAttribute('data-target');
      if (!key) return;
      this.openWeaponEntry(key);
    });
  }

  public show() {
    if (!this.mounted) this.render();
    this.root.style.display = 'flex';
    matrixBackground.start();
    this.mounted = true;
  }

  public hide() {
    this.root.style.display = 'none';
    matrixBackground.stop();
  }

  private render() {
    const q = (this.search?.value || '').trim().toLowerCase();
    switch (this.currentTab) {
      case 'operatives':
        this.body.innerHTML = this.renderOperatives(q);
        break;
      case 'weapons':
        this.body.innerHTML = this.renderWeapons(q);
        // If a pending weapon scroll target exists (from cross-navigation), perform it now
        if (this.pendingScrollToWeapon) {
          const id = `weapon-${this.pendingScrollToWeapon}`;
          const node = document.getElementById(id);
          if (node) {
            node.scrollIntoView({ behavior: 'smooth', block: 'start' });
            node.classList.add('cdx-highlight');
            setTimeout(() => node.classList.remove('cdx-highlight'), 1200);
          }
          this.pendingScrollToWeapon = null;
        }
        break;
      case 'passives':
        this.body.innerHTML = this.renderPassives(q);
        break;
      case 'enemies':
        this.body.innerHTML = this.renderEnemies(q);
        break;
      case 'bosses':
        this.body.innerHTML = this.renderBosses(q);
        break;
      case 'abilities':
        this.body.innerHTML = this.renderAbilities();
        break;
    }
  }

  private renderOperatives(q: string): string {
    const items = CHARACTERS.filter(c => !q || (c.name?.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || c.playstyle?.toLowerCase().includes(q)));
    const parts: string[] = ['<div class="cdx-grid">'];
    for (let i = 0; i < items.length; i++) {
      const c:any = items[i];
      const s:any = c.stats || {};
      const wKey: any = c.defaultWeapon;
      const spec: any = (WEAPON_SPECS as any)[wKey];
      const cdLabel = spec ? ((typeof spec.cooldownMs === 'number') ? (spec.cooldownMs + 'ms') : (typeof spec.cooldown === 'number' ? (Math.round(spec.cooldown * (1000/60)) + 'ms') : '—')) : '—';
      const badges = spec ? this.buildWeaponBadges(spec) : '';
      parts.push(`
        <div class="cdx-card">
          <div class="icon"><img src="${c.icon}" alt="${this.escape(c.name)}"/></div>
          <div class="meta">
            <div class="name">${this.escape(c.name)} <span style="opacity:.6;font-weight:400">— ${this.escape(c.playstyle||'')}</span></div>
            <div class="desc">${this.escape(c.description||'')}</div>
            <div class="cdx-stats">
              <div class="cdx-stat">HP ${s.hp}</div>
              <div class="cdx-stat">DMG ${s.damage}</div>
              <div class="cdx-stat">SPEED ${s.speed}</div>
              <div class="cdx-stat">DEF ${s.defense}</div>
              <div class="cdx-stat">LCK ${s.luck}</div>
              <div class="cdx-stat">Power ${s.powerScore ?? '—'}</div>
            </div>
            <div class="cdx-note">Class Weapon: ${this.escape(spec?.name || String(wKey))}</div>
            ${spec ? `
            <div class="cdx-embedded-weapon" style="margin-top:8px">
              <div class="cdx-compact-head">
                <div class="icon">${this.weaponPreview(wKey)}</div>
                <div class="meta" style="flex:1">
                  <div class="name">${this.escape(spec?.name || String(wKey))}</div>
                  <div class="cdx-stats" style="grid-template-columns:repeat(3,1fr)">
                    <div class="cdx-stat">DMG ${spec?.damage ?? '—'}</div>
                    <div class="cdx-stat">CD ${cdLabel}</div>
                    <div class="cdx-stat">MAX L ${spec?.maxLevel ?? '—'}</div>
                  </div>
                  ${badges ? `<div class="cdx-badges">${badges}</div>` : ''}
                  <div class="cdx-compact-actions">
                    <button class="cdx-open-weapon" data-target="${this.escape(String(wKey))}">View in Weapons</button>
                  </div>
                </div>
              </div>
            </div>` : ''}
          </div>
        </div>`);
    }
    parts.push('</div>');
    return parts.join('');
  }

  private renderWeapons(q: string): string {
    const entries = Object.entries(WEAPON_SPECS) as Array<[string, any]>;
    const parts: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [key, spec] = entries[i];
      const name = spec?.name || String(key);
      const desc = spec?.description || '';
      if (q && !(name.toLowerCase().includes(q) || desc.toLowerCase().includes(q))) continue;
      const cd = (typeof spec?.cooldownMs === 'number') ? (spec.cooldownMs + 'ms') : (typeof spec?.cooldown === 'number' ? (spec.cooldown + 'f') : '—');
      const expanded = this.expandedWeapons.has(String(key));
  const badges = this.buildWeaponBadges(spec);
  parts.push(`<div class="cdx-card" id="weapon-${String(key)}" style="flex-direction:column">
        <div class="cdx-compact-head">
          <div class="icon">${this.weaponPreview(key as any)}</div>
          <div class="meta" style="flex:1">
            <div class="name">${this.escape(name)}</div>
            <div class="cdx-stats" style="grid-template-columns:repeat(3,1fr)">
              <div class="cdx-stat">DMG ${spec?.damage ?? '—'}</div>
              <div class="cdx-stat">CD ${cd}</div>
              <div class="cdx-stat">MAX L ${spec?.maxLevel ?? '—'}</div>
            </div>
    ${badges ? `<div class="cdx-badges">${badges}</div>` : ''}
            <div class="cdx-compact-actions">
              <button class="cdx-toggle" data-key="${this.escape(String(key))}">${expanded ? 'Hide details' : 'Show details'}</button>
            </div>
          </div>
        </div>
    ${expanded ? `<div class="desc">${this.escape(desc)}</div>` : ''}
    ${expanded ? this.renderWeaponDetails(spec) : ''}
      </div>`);
    }
    if (!parts.length) return '<div class="cdx-note">No weapons match your search.</div>';
    return parts.join('');
  }

  // Build small badges for quick effect visibility (AoE, DoT, Pierce, Bounce, Pulse, Orbit, etc.)
  private buildWeaponBadges(spec: any): string {
    const badges: string[] = [];
    if (spec?.explosionRadius || spec?.projectileVisual?.type === 'explosive') badges.push('<span class="cdx-badge">AoE</span>');
    if (/(burn|DoT|poison|virus|tick|paralysis|mark)/i.test(String(spec?.description||'') + ' ' + String(spec?.traits||[]))) badges.push('<span class="cdx-badge">DoT</span>');
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    try {
      const l1 = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(1)||{}) : {};
      const lM = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(max)||{}) : {};
      if (l1.pierce || lM.pierce) badges.push(`<span class="cdx-badge">Pierce ${lM.pierce||l1.pierce}</span>`);
      if (l1.bounces || lM.bounces) badges.push(`<span class="cdx-badge">Bounce ${lM.bounces||l1.bounces}</span>`);
      if (l1.explosionRadius || lM.explosionRadius || spec?.explosionRadius) badges.push(`<span class="cdx-badge">AoE ${lM.explosionRadius||l1.explosionRadius||spec.explosionRadius}</span>`);
      if (l1.pulseDamage || lM.pulseDamage) badges.push('<span class="cdx-badge">Pulse</span>');
      if (l1.orbCount || lM.orbCount || spec?.projectileVisual?.type==='plasma' && /orbit|halo/i.test(String(spec?.name||''))) badges.push('<span class="cdx-badge">Orbit</span>');
      if (spec?.projectileVisual?.type==='drone') badges.push('<span class="cdx-badge">Drone</span>');
      if (/homing|guided|smart/i.test(String(spec?.description||'') + ' ' + String(spec?.traits||[]))) badges.push('<span class="cdx-badge">Homing</span>');
    } catch {}
    return badges.join('');
  }

  // Detailed weapon effects section (expanded view)
  private renderWeaponDetails(spec: any): string {
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    const l1 = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(1)||{}) : {};
    const lM = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(max)||{}) : {};
    const cdTable = this.renderWeaponLevels(spec);
    const lines: string[] = [];
    // Explosions
    const aoe = lM.explosionRadius || l1.explosionRadius || spec?.explosionRadius;
    if (aoe) lines.push(`Explosion radius: ${aoe}px (on hit or trigger).`);
    // Pierce
    if (l1.pierce || lM.pierce) lines.push(`Pierce: up to ${lM.pierce||l1.pierce} targets.`);
    // Bounces
    if (l1.bounces || lM.bounces) lines.push(`Bounces: up to ${lM.bounces||l1.bounces} hops between targets.`);
    // Pulses/Area
    if (l1.pulseDamage || lM.pulseDamage) {
      const pulses = lM.pulseCount || l1.pulseCount;
      const dmg = lM.pulseDamage || l1.pulseDamage;
      const rad = lM.sigilRadius || l1.sigilRadius;
      lines.push(`Pulses: ${pulses||'?'} × ${dmg||'?'} dmg in ${rad||'?'}px radius.`);
    }
    // Orbits
    if (l1.orbCount || lM.orbCount) {
      lines.push(`Orbits: ${lM.orbCount||l1.orbCount} orbs, radius ~${lM.orbitRadius||l1.orbitRadius}px.`);
    }
    // Drones
    if (spec?.projectileVisual?.type==='drone') lines.push('Drone seeks target and explodes on contact.');
    // Burn/DoT (heuristic via description/traits)
    if (/(burn|DoT|poison|virus|tick|paralysis|mark)/i.test(String(spec?.description||'') + ' ' + String(spec?.traits||[]))) {
      const ticks = lM.ticks || l1.ticks;
      const interval = lM.tickIntervalMs || l1.tickIntervalMs;
      if (ticks && interval) lines.push(`Damage over time: ${ticks} ticks every ${interval}ms.`);
      else lines.push('Applies damage over time effect.');
    }
    // Melee sweep specifics
    if (lM.arcDegrees || l1.arcDegrees) {
      const arc = lM.arcDegrees || l1.arcDegrees;
      const dur = lM.sweepDurationMs || l1.sweepDurationMs;
      lines.push(`Melee sweep: ${arc}° arc over ${dur}ms; can trigger scrap/shrapnel effects.`);
    }
    const details = lines.length ? `<div class="cdx-note">${this.escape(lines.join(' '))}</div>` : '';
    const expl = this.renderExplosionTable(spec);
    return `${details}${expl}${cdTable}`;
  }

  // Render a dedicated Explosion table when a weapon detonates or creates AoE on hit.
  private renderExplosionTable(spec: any): string {
    const hasExpl = !!(spec?.explosionRadius
      || /explosive|detonate|mortar|kamikaze|aoe|drone|ion field/i.test(String(spec?.traits||'') + ' ' + String(spec?.name||'') + ' ' + String(spec?.description||'')));
    if (!hasExpl || typeof spec?.getLevelStats !== 'function') return '';
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    const rows: string[] = [];
    rows.push('<table class="cdx-table"><thead><tr><th colspan="5">Explosion</th></tr><tr><th>L</th><th>RADIUS</th><th>DMG</th><th>FIRE RATE</th><th>DURATION</th></tr></thead><tbody>');
    for (let lvl = 1; lvl <= max; lvl++) {
      const st = spec.getLevelStats(lvl) || {};
      const radius = st.explosionRadius ?? spec.explosionRadius ?? this.inferExplosionRadiusFallback(spec);
      const dmg = st.damage ?? spec.damage ?? '—';
      const ms: number | undefined = (typeof st.cooldownMs === 'number') ? st.cooldownMs : (typeof st.cooldown === 'number' ? Math.round(st.cooldown * (1000/60)) : undefined);
      const rate = (typeof ms === 'number' && ms > 0) ? `${(1000 / ms).toFixed(2)}/s` : '—';
      const dur = this.inferExplosionDuration(spec);
      rows.push(`<tr><td style="text-align:center">${lvl}</td><td>${fmt(radius)}</td><td>${fmt(dmg)}</td><td>${rate}</td><td>${dur}</td></tr>`);
    }
    rows.push('</tbody></table>');
    return rows.join('');

    function fmt(v: any){ return (v===0 || (typeof v==='number' && isFinite(v))) ? String(v) : '—'; }
  }

  // Heuristic: provide a sensible explosion radius when not declared in spec/levels
  private inferExplosionRadiusFallback(spec: any): number | undefined {
    const name = String(spec?.name||'').toLowerCase();
    const traits = String(spec?.traits||'').toLowerCase();
    if (name.includes('mortar') || traits.includes('aoe')) return 200;
    if (name.includes('plasma') || traits.includes('detonate')) return 120;
    if (traits.includes('kamikaze') || (spec?.projectileVisual?.type === 'drone')) return 190; // ≈ 110 * sqrt(3)
    return undefined;
  }

  // Heuristic: map weapon to explosion effect duration as seen in ExplosionManager visuals
  private inferExplosionDuration(spec: any): string {
    const name = String(spec?.name||'').toLowerCase();
    const traits = String(spec?.traits||'').toLowerCase();
    if (name.includes('mortar')) return '600ms (burn)';
    if (name.includes('plasma') || traits.includes('ion field') || traits.includes('detonate')) return '120ms (residual)';
    if (traits.includes('kamikaze') || (spec?.projectileVisual?.type === 'drone')) return '500ms (residual)';
    return 'Instant';
  }

  private renderWeaponLevels(spec: any): string {
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    const has = typeof spec?.getLevelStats === 'function';
    if (!has) return '<div class="cdx-note">No per-level table available.</div>';
    const rows: string[] = [];
    rows.push('<table class="cdx-table"><thead><tr><th>L</th><th>DMG</th><th>CD</th><th>SALVO</th><th>SPD</th><th>RANGE</th><th>AOE</th></tr></thead><tbody>');
    for (let lvl = 1; lvl <= max; lvl++) {
      const st = spec.getLevelStats(lvl) || {};
      const cd = (typeof st.cooldownMs === 'number') ? (st.cooldownMs + 'ms') : (typeof st.cooldown === 'number' ? (st.cooldown + 'f') : '—');
      rows.push(`<tr><td style="text-align:center">${lvl}</td><td>${fmtNum(st.damage)}</td><td>${cd}</td><td>${fmtNum(st.salvo)}</td><td>${fmtNum(st.speed)}</td><td>${fmtNum(st.range)}</td><td>${fmtNum(st.explosionRadius)}</td></tr>`);
    }
    rows.push('</tbody></table>');
    return rows.join('');

    function fmtNum(v:any){ return (v===0 || (typeof v==='number' && isFinite(v))) ? String(v) : '—'; }
  }

  private renderPassives(q: string): string {
    const parts: string[] = ['<div class="cdx-grid">'];
    for (let i = 0; i < PASSIVE_SPECS.length; i++) {
      const p = PASSIVE_SPECS[i];
      if (q && !(p.name.toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q))) continue;
      const icon = p.icon ? `<img src="${p.icon}" alt="${this.escape(p.name)}"/>` : '';
      parts.push(`
        <div class="cdx-card">
          <div class="icon">${icon||'<span style=\"font-size:18px;color:#5EEBFF\">P</span>'}</div>
          <div class="meta">
            <div class="name">${this.escape(p.name)}</div>
            <div class="desc">${this.escape(p.description||'')}</div>
            <div class="cdx-stats" style="grid-template-columns:repeat(2,1fr)">
              <div class="cdx-stat">MAX L ${p.maxLevel}</div>
              <div class="cdx-stat">ID ${p.id}</div>
            </div>
          </div>
        </div>`);
    }
    parts.push('</div>');
    return parts.join('');
  }

  private renderEnemies(q: string): string {
    // Mirror archetype base stats used by EnemyManager.spawnEnemy (early vs late HP)
    const archetypes = [
      { id: 'small', name: 'Small', hpEarly: 100, hpLate: 160, radius: 20, damage: 4, speedNote: 'Fastest class (capped below player speed)' },
      { id: 'medium', name: 'Medium', hpEarly: 220, hpLate: 380, radius: 30, damage: 7, speedNote: 'Balanced chaser' },
      { id: 'large', name: 'Large', hpEarly: 480, hpLate: 900, radius: 38, damage: 10, speedNote: 'Slow, heavy hitter' }
    ];
    const list = archetypes.filter(a => !q || a.name.toLowerCase().includes(q) || a.id.includes(q));
    const parts: string[] = ['<div class="cdx-grid">'];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      parts.push(`
        <div class="cdx-card">
          <div class="icon"><span style="color:#ff6a6a;font-weight:700">${a.name.charAt(0)}</span></div>
          <div class="meta">
            <div class="name">${a.name} <span style="opacity:.6;font-weight:400">— Archetype</span></div>
            <div class="cdx-stats" style="grid-template-columns:repeat(4,1fr)">
              <div class="cdx-stat">HP E ${a.hpEarly}</div>
              <div class="cdx-stat">HP L ${a.hpLate}</div>
              <div class="cdx-stat">DMG ${a.damage}</div>
              <div class="cdx-stat">RADIUS ${a.radius}</div>
            </div>
            <div class="cdx-note">${this.escape(a.speedNote)}</div>
            <div class="cdx-note">Spawns scale dynamically over time; late-game budgets bias toward medium/large enemies.</div>
          </div>
        </div>`);
    }
    parts.push('</div>');
    return parts.join('');
  }

  /** Abilities tab: lists hero unique abilities and detailed stacked passives behavior. */
  private renderAbilities(): string {
    const parts: string[] = [];
    // Hero abilities
    parts.push('<div class="cdx-note" style="margin-bottom:8px">Hero Abilities</div>');
    parts.push('<div class="cdx-grid">');
    for (let i = 0; i < CHARACTERS.length; i++) {
      const c: any = CHARACTERS[i];
      parts.push(`
        <div class="cdx-card">
          <div class="icon"><img src="${c.icon}" alt="${this.escape(c.name)}"/></div>
          <div class="meta">
            <div class="name">${this.escape(c.name)}</div>
            <div class="desc">${this.escape(c.specialAbility || '—')}</div>
            <div class="cdx-stats" style="grid-template-columns:repeat(3,1fr)">
              <div class="cdx-stat">Role ${this.escape(c.playstyle||'—')}</div>
              <div class="cdx-stat">Default ${this.escape(String(c.defaultWeapon))}</div>
              <div class="cdx-stat">Power ${c.stats?.powerScore ?? '—'}</div>
            </div>
          </div>
        </div>`);
    }
    parts.push('</div>');

    // Passive stacking details
    parts.push('<div class="cdx-note" style="margin:12px 0 4px">Passive Stacking</div>');
    parts.push('<div class="cdx-grid">');
    for (let i = 0; i < PASSIVE_SPECS.length; i++) {
      const p: any = PASSIVE_SPECS[i];
      const table = this.renderPassiveLevels(p);
      const icon = p.icon ? `<img src="${p.icon}" alt="${this.escape(p.name)}"/>` : '<span style="font-size:18px;color:#5EEBFF">P</span>';
      parts.push(`
        <div class="cdx-card" style="flex-direction:column">
          <div class="cdx-compact-head">
            <div class="icon">${icon}</div>
            <div class="meta" style="flex:1">
              <div class="name">${this.escape(p.name)}</div>
              <div class="desc">${this.escape(p.description||'')}</div>
              <div class="cdx-stats" style="grid-template-columns:repeat(2,1fr)">
                <div class="cdx-stat">MAX L ${p.maxLevel}</div>
                <div class="cdx-stat">ID ${p.id}</div>
              </div>
            </div>
          </div>
          ${table}
        </div>`);
    }
    parts.push('</div>');

    return parts.join('');
  }

  // Build a per-level effect table for passives to show stacking behavior.
  private renderPassiveLevels(p: any): string {
    const max = Math.max(1, Number(p?.maxLevel || 1));
    const rows: string[] = [];
    rows.push('<table class="cdx-table"><thead><tr><th>L</th><th>Effect</th></tr></thead><tbody>');
    for (let lvl = 1; lvl <= max; lvl++) {
      rows.push(`<tr><td style="text-align:center">${lvl}</td><td>${this.describePassiveEffect(p.id, lvl)}</td></tr>`);
    }
    rows.push('</tbody></table>');
    return rows.join('');
  }

  // Human-readable description of a passive’s effects at a specific level, matching PassiveConfig.
  private describePassiveEffect(id: number, level: number): string {
    switch (id) {
      case 0: return `+${(level * 0.5).toFixed(1)} move speed over base`;
      case 1: {
        const inc = Math.min(level,5) * 20 + Math.max(0, level-5) * 15;
        const heal = Math.round(inc * 0.55);
        return `Max HP +${inc}; on pickup, heal +${heal} (55% of increase)`;
      }
      case 2: return `Global damage ×${(1 + level * 0.14).toFixed(2)} (${(level*14)}%)`;
      case 3: return `Fire rate ×${(1 + level * 0.13).toFixed(2)} (${Math.round(level*13)}% faster)`;
      case 10: return `Area radius ×${(1 + Math.min(level,3)*0.10).toFixed(2)} (cap at L3)`;
      case 4: return `On-kill explosion enabled`;
      case 5: return `Pickup radius ${120 + level*36}px`;
      case 6: return `Shield proc chance ${(Math.min(0.5, level*0.055)*100).toFixed(1)}%`;
      case 7: return `Crit chance +${(Math.min(0.55, level*0.0375)*100).toFixed(1)}%, crit mult ×${Math.min(3.1, 1.5 + level*0.095).toFixed(2)}`;
      case 8: return `Piercing +${level} extra enemies`;
      case 9: {
        const rate = Math.min(level,5) * 0.125 + Math.max(0, level-5) * 0.09;
        return `Regen ${rate.toFixed(3)} HP/s (taper after L5)`;
      }
    }
    return '—';
  }

  private iconForWeapon(type: any): string {
    // Fallback: initial badge
    const label = String(type);
    const two = label.substring(0,2).toUpperCase();
    return `<span style=\"color:#5EEBFF;font-weight:700\">${this.escape(two)}</span>`;
  }

  /** Small projectile preview: prefers sprite path; otherwise draws a simple SVG according to visual type. */
  private weaponPreview(type: keyof typeof WEAPON_SPECS | string): string {
    try {
      const spec: any = (WEAPON_SPECS as any)[type as any];
      const vis: any = spec?.projectileVisual;
      if (vis?.sprite) {
        // Normalize path when it looks like a public asset
        const path = /^(\/|assets\/)/.test(String(vis.sprite)) ? AssetLoader.normalizePath(String(vis.sprite).startsWith('/') ? String(vis.sprite) : '/' + String(vis.sprite)) : String(vis.sprite);
        return `<img src="${this.escape(path)}" alt="${this.escape(spec?.name||String(type))}"/>`;
      }
      // Simple SVG fallback for plasma/bullets/beams
      const color = this.escape(vis?.color || '#5EEBFF');
      const size = Math.max(6, Math.min(24, Number(vis?.size || 10)));
      const kind = String(vis?.type || 'bullet');
      if (kind === 'bullet') {
        return `<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${color}" stop-opacity="0.9"/><stop offset="100%" stop-color="${color}" stop-opacity="0.2"/></radialGradient></defs>
          <circle cx="24" cy="24" r="${size}" fill="url(#g)"/></svg>`;
      }
      if (kind === 'plasma' || kind === 'slime') {
        return `<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <defs><radialGradient id="p" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="100%" stop-color="${color}" stop-opacity="0.65"/></radialGradient></defs>
          <circle cx="24" cy="24" r="${size}" fill="url(#p)"/></svg>`;
      }
      if (kind === 'laser' || kind === 'beam') {
        const thick = Math.max(2, Math.min(10, Number(vis?.thickness || 4)));
        const len = Math.max(20, Math.min(40, Number(vis?.length || 28)));
        return `<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <rect x="${24 - len/2}" y="${24 - thick/2}" width="${len}" height="${thick}" rx="${thick/2}" fill="${color}" opacity="0.85"/></svg>`;
      }
    } catch {}
    return this.iconForWeapon(type);
  }

  private escape(s: string): string { return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'} as any)[c] || c); }

  /** Render Bosses tab; lazy-loads manifest and enumerates all boss PNGs */
  private renderBosses(q: string): string {
    // If not loaded, kick off async fetch and show loading placeholder
    if (!this.bossItems && !this.bossLoading) {
      this.bossLoading = true;
      // Resolve manifest URL using AssetLoader.normalizePath to respect base prefix and file://
      const url = (typeof location !== 'undefined' && location.protocol === 'file:')
        ? AssetLoader.normalizePath('assets/manifest.json')
        : AssetLoader.normalizePath('/assets/manifest.json');
      fetch(url).then(r => r.ok ? r.json() : null).then((manifest) => {
        const items: Array<{ key: string; name: string; file: string; w?: number; h?: number; frames?: number; telegraph?: boolean }> = [];
        if (manifest && manifest.boss) {
          for (const key in manifest.boss) {
            const info = manifest.boss[key];
            if (!info || !info.file) continue;
            items.push({ key, name: key, file: info.file, w: info.w, h: info.h, frames: info.frames, telegraph: info.telegraph });
          }
        }
        // Fallback: if manifest missing or empty, attempt known default
        if (!items.length) {
          items.push({ key: 'phase1', name: 'phase1', file: 'assets/boss/boss_phase1.png' });
        }
        // Normalize file paths per hosting mode
        this.bossItems = items.map(it => ({ ...it, file: AssetLoader.normalizePath(it.file.startsWith('/') ? it.file : '/' + it.file.replace(/^\.\//, '')) }));
      }).catch(() => {
        // Fallback: single known boss asset path
        this.bossItems = [{ key: 'phase1', name: 'phase1', file: AssetLoader.normalizePath('/assets/boss/boss_phase1.png') }];
      }).finally(() => {
        this.bossLoading = false;
        // Re-render once data is ready
        this.render();
      });
    }

    if (!this.bossItems) {
      return '<div class="cdx-note">Loading bosses…</div>';
    }

    const list = this.bossItems.filter(b => !q || b.name.toLowerCase().includes(q) || b.key.toLowerCase().includes(q));
    if (!list.length) return '<div class="cdx-note">No bosses match your search.</div>';
    const parts: string[] = ['<div class="cdx-grid">'];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      parts.push(this.renderBossCard(b));
    }
    parts.push('</div>');
    return parts.join('');
  }

  /**
   * Build a single Boss card including image, base stats, scaling table, and abilities.
   * Mirrors BossManager values; update if gameplay numbers change.
   */
  private renderBossCard(b: { key: string; name: string; file: string; w?: number; h?: number; frames?: number; telegraph?: boolean }): string {
    const title = 'Boss — ' + this.escape(b.name);
    const specs = this.getBossSpecs();
    const metaBits: string[] = [];
    if (b.w && b.h) metaBits.push(`${b.w}×${b.h}`);
    if (b.frames) metaBits.push(`${b.frames}f`);
    if (b.telegraph) metaBits.push('telegraph');
    const table = this.renderBossScalingTable(specs);
    const abilities = this.renderBossAbilities(specs);
  const firstBossNote = /phase ?1|^p?1$|first/i.test(b.key) ? '<div class="cdx-note">First boss in the series. More bosses will be added.</div>' : '';
  return `
      <div class="cdx-card" style="flex-direction:column">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div class="icon boss"><img src="${b.file}" alt="${this.escape(title)}"/></div>
          <div class="meta" style="flex:1">
            <div class="name">${this.escape(title)}</div>
            <div class="cdx-stats" style="grid-template-columns:repeat(4,1fr)">
              <div class="cdx-stat">Base HP ${specs.baseHp}</div>
              <div class="cdx-stat">Radius ${specs.radius}</div>
              <div class="cdx-stat">Contact ${specs.contactBase}</div>
              <div class="cdx-stat">Nova Rmax ${specs.novaMaxRadius}</div>
            </div>
            ${metaBits.length ? `<div class="cdx-note">${this.escape(metaBits.join(' · '))}</div>` : ''}
            <div class="cdx-note">Phases at 70% and 40% HP; attack cadence increases each phase.</div>
            <div class="cdx-note">Boss respawns infinitely; per-spawn scaling applies.</div>
      ${firstBossNote}
          </div>
        </div>
        ${table}
        ${abilities}
      </div>`;
  }

  /** Stats used for Boss codex; keep in sync with BossManager. */
  private getBossSpecs() {
    return {
      baseHp: 1500,
      radius: 80,
      contactBase: 30,
      contactScalePerSpawn: 0.18, // 30 * (1 + 0.18*(n-1))
      specialScaleBase: 1.22, // damages scaled by 1.22^(n-1)
      shockInner: 45,
      shockRing: 35,
      specialBlast: 80,
      dashHit: 25,
      novaMaxRadius: 320,
      hpScaleBase: 1.40, // (1 + 0.40*(n-1))^1.12
      hpScalePow: 1.12
    };
  }

  /** Render table of scaled HP and damages for spawns 1..5. */
  private renderBossScalingTable(specs: ReturnType<Codex['getBossSpecs']>): string {
    const rows: string[] = new Array(7);
    rows[0] = '<table class="cdx-table"><thead><tr><th>Spawn</th><th>HP</th><th>Contact</th><th>Shock Inner</th><th>Shock Ring</th><th>Special</th><th>Dash</th></tr></thead><tbody>';
    let r = 1;
    for (let n = 1; n <= 5; n++) {
      const hpScale = Math.pow(1 + 0.40 * (n - 1), specs.hpScalePow);
      const hp = Math.round(specs.baseHp * hpScale);
      const contact = Math.round(specs.contactBase * (1 + specs.contactScalePerSpawn * (n - 1)));
      const scale = Math.pow(specs.specialScaleBase, n - 1);
      const inner = Math.round(specs.shockInner * scale);
      const ring = Math.round(specs.shockRing * scale);
      const special = Math.round(specs.specialBlast * scale);
      const dash = specs.dashHit;
      rows[r++] = `<tr><td style="text-align:center">${n}</td><td>${hp}</td><td>${contact}</td><td>${inner}</td><td>${ring}</td><td>${special}</td><td>${dash}</td></tr>`;
    }
    rows[r++] = '</tbody></table>';
    return rows.join('');
  }

  /** Describe boss abilities, timings, and mechanics. */
  private renderBossAbilities(specs: ReturnType<Codex['getBossSpecs']>): string {
    return `
      <div class="cdx-note" style="margin-top:8px">
        Abilities:
        <ul style="margin:6px 0 0 16px;padding:0;color:#c8f7ff">
          <li><b>Shock Nova</b>: 900ms charge, then expanding ring to ~${specs.novaMaxRadius}px. Inner blast deals ${specs.shockInner} (scaled), ring deals ${specs.shockRing} (scaled). One hit per cast.</li>
          <li><b>Line Dash</b>: 750ms lineup telegraph along a line, then ${specs.dashHit} contact damage during a ~420ms dash at 0.75 px/ms. Post-dash short recovery reduces body-checks.</li>
          <li><b>Overcharge Special</b>: Builds for 6s, telegraphs for 3s, then deals ${specs.specialBlast} (scaled) if you’re within boss radius + 120px.</li>
          <li><b>Contact Damage</b>: Base ${specs.contactBase} with per-spawn scaling; 1s cooldown between hits.</li>
          <li><b>Attack Waves</b>: Periodic attack waves with a chance to spawn minions; XP sprays at 20% HP intervals.</li>
        </ul>
      </div>`;
  }

  /** Switch to Weapons tab, expand target weapon, and schedule scroll/highlight. */
  private openWeaponEntry(key: string) {
    this.currentTab = 'weapons';
  // Clear search to guarantee target visibility
  if (this.search) this.search.value = '';
    // Update tab active states
    this.root.querySelectorAll('.codex-tab').forEach(b => {
      const t = (b as HTMLElement).getAttribute('data-tab');
      b.classList.toggle('active', t === 'weapons');
    });
    // Expand the weapon in question
    this.expandedWeapons.add(String(key));
    // Schedule scroll after render
    this.pendingScrollToWeapon = String(key);
    this.render();
  }
}
