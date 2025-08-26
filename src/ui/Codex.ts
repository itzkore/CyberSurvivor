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
  // Lightweight ability descriptions per operative (no hard numbers to avoid drift)
  private readonly abilityInfo: Record<string, {
    title?: string;
    summary?: string;
    effects?: string[];
    scaling?: string[];
    tips?: string[];
  }> = {
    wasteland_scavenger: {
      title: 'Scrap Surge',
      summary: 'Trigger a protective scrap blast and repair a small amount of HP.',
      effects: ['Instant radial blast around the player', 'Brief knockback/space-maker', 'Heals a small amount on use'],
      scaling: ['Area', 'Damage', 'Cooldown'],
      tips: ['Cast when surrounded to push space and heal', 'Area/Cooldown passives improve safety uptime']
    },
    tech_warrior: {
      title: 'Glide Dash',
      summary: 'Short, smooth dash with brief i-frames and afterimages.',
      effects: ['Temporarily invulnerable during the glide frames', 'Pairs with dash‑lance weapons for precision pierce'],
      scaling: ['Cooldown', 'Distance (indirect via Speed)'],
      tips: ['Use to line up lanes for Tachyon/Singularity Spears', 'Weave dashes between volleys to stay safe']
    },
    heavy_gunner: {
      title: 'Overdrive / Suppression Matrix',
      summary: 'Temporary overdrive window; sustained fire suppresses enemies.',
      effects: ['Boosted rate of fire and stability during window', 'Suppression slows enemies under sustained hits'],
      scaling: ['Fire Rate', 'Damage', 'Cooldown'],
      tips: ['Hold ground during overdrive; funnel mobs into lanes', 'Pair with Piercing to capitalize on suppression']
    },
    cyber_runner: {
      title: 'Vector Dash',
      summary: 'Level‑scaled dash with brief i‑frames and afterimages.',
      effects: ['Burst reposition with short invulnerability', 'Cancels many contact threats if timed well'],
      scaling: ['Cooldown', 'Distance (indirect via Speed)'],
      tips: ['Dash through gaps; keep fire cadence with Runner Gun', 'Avoid dashing into fresh spawns—read the flow']
    },
    bio_engineer: {
      title: 'Bio Hazard',
      summary: 'Weapons apply damage‑over‑time effects to tagged enemies.',
      effects: ['Adds stacking DoT to affected targets', 'Pairs well with area control and pulls'],
      scaling: ['Damage', 'Duration', 'Cooldown'],
      tips: ['Keep enemies inside zones to maximize ticks', 'Crit/Attack Speed increases tag application rate']
    },
    data_sorcerer: {
      title: 'Sigilweave',
      summary: 'Place a rotating glyph that emits pulsing shockwaves.',
      effects: ['Stationary zone that pulses AoE damage', 'Excellent at chokepoints and kiting paths'],
      scaling: ['Area', 'Cooldown', 'Duration'],
      tips: ['Plant ahead of enemy flow for maximum overlap', 'Combine with slows/pulls to keep targets in radius']
    },
    ghost_operative: {
      title: 'Phase Cloak',
      summary: 'Temporary invisibility and damage immunity.',
      effects: ['Grants brief full damage immunity', 'Drop aggro and reposition for a clean snipe'],
      scaling: ['Cooldown', 'Duration'],
      tips: ['Cloak before a charged shot to line up safely', 'Break line of sight to reset pursuit']
    },
    neural_nomad: {
      title: 'Neural Storm',
      summary: 'Area‑effect psychic blast; excels versus crowds.',
      effects: ['Periodic or triggered AoE bursts', 'Strong lane control and pack finishing'],
      scaling: ['Area', 'Damage', 'Cooldown'],
      tips: ['Pull packs tight, then trigger the blast', 'Area/Cooldown amplify map control']
    },
    psionic_weaver: {
      title: 'Energy Weave',
      summary: 'Projectiles gain homing and piercing properties temporarily.',
      effects: ['Improves aim reliability and multi‑hit potential', 'Great for clearing evasive or scattered mobs'],
      scaling: ['Duration', 'Piercing (synergy)', 'Cooldown'],
      tips: ['Fire into packs; homing finds stragglers', 'Pair with Pierce/Crit for reliable chains']
    },
    rogue_hacker: {
      title: 'System Hack',
      summary: 'EMP‑like hack: damages in a large radius and briefly paralyzes enemies.',
      effects: ['Large AoE damage pulse', 'Short paralysis / disable on affected enemies'],
      scaling: ['Area', 'Cooldown', 'Duration'],
      tips: ['Use as a panic button or to start boss burst windows', 'Follow up with high‑DPS weapons during the stun']
    },
    shadow_operative: {
      title: 'Ebon Bleed',
      summary: 'Critical hits apply stacking void DoT with vicious secondary effects.',
      effects: ['Stacks DoT on crits; stacks refresh independently', 'Excellent boss shred with sustained crit uptime'],
      scaling: ['Crit', 'Damage', 'Duration'],
      tips: ['Build Crit and Attack Speed to ramp stacks', 'Keep pressure—stacks thrive on hit frequency']
    },
    titan_mech: {
      title: 'Armor Plating',
      summary: 'Reduced damage from all sources; becomes a walking fortress.',
      effects: ['Flat or percent damage reduction (contextual)', 'Pairs well with explosive zoning and taunt‑like play'],
      scaling: ['Duration (if timed)', 'Cooldown (if timed)'],
      tips: ['Anchor lanes and let mortars clean packs', 'Invest in Area/Cooldown for bigger/steadier clears']
    }
  };

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
          <button class="codex-tab" data-tab="abilities">Abilities</button>
          <button class="codex-tab" data-tab="weapons">Weapons</button>
          <button class="codex-tab" data-tab="passives">Passives</button>
          <button class="codex-tab" data-tab="enemies">Enemies</button>
          <button class="codex-tab" data-tab="bosses">Bosses</button>
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
  /* Base button styling for all Codex buttons */
  #codex-panel button{background:rgba(0,35,45,.7);border:1px solid rgba(0,255,255,.45);color:#b8faff;letter-spacing:.8px;border-radius:6px;padding:8px 12px;cursor:pointer}
  #codex-panel button:hover{background:rgba(0,255,255,.10);box-shadow:0 0 8px rgba(0,255,255,.25) inset}
  #codex-panel button:active{transform:translateY(1px);filter:brightness(1.05)}
  .codex-btn{background:rgba(0,35,45,.7);border:1px solid rgba(0,255,255,.5);color:#9fe;letter-spacing:.8px;border-radius:6px;padding:8px 12px}
      .codex-tabs{display:flex;gap:8px}
      .codex-tab{padding:8px 12px;border:1px solid rgba(0,255,255,.35);background:rgba(0,25,38,.6);color:#b8faff;border-radius:6px}
      .codex-tab.active{background:rgba(0,255,255,.12);box-shadow:inset 0 0 10px rgba(0,255,255,.18)}
      .codex-body{flex:1 1 auto;overflow:auto;border:1px solid rgba(0,255,255,.35);background:rgba(0,35,48,.35);padding:12px;border-radius:8px}
      .cdx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .cdx-card{border:1px solid rgba(0,255,255,.25);background:rgba(0,18,24,.55);border-radius:8px;padding:10px;display:flex;gap:8px;overflow:hidden}
      .cdx-card .icon{width:60px;height:60px;flex:0 0 auto;border:1px solid rgba(0,255,255,.25);border-radius:6px;background:#03222b;display:flex;align-items:center;justify-content:center}
  .cdx-card .icon img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated}
  .cdx-card .icon.boss{width:128px;height:128px;background:#02161b}
      .cdx-card .meta{flex:1 1 auto}
      .cdx-card .name{font:700 14px/1 Orbitron, sans-serif;color:#5EEBFF;margin-bottom:4px}
  .cdx-card .desc{font:12px/1.4 Inter, system-ui, sans-serif;color:#bfe9ff;opacity:.9;word-break:break-word;overflow-wrap:anywhere}
  .cdx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
  .cdx-stats.auto-fit{grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}
  .cdx-stat{font:11px/1.3 Inter;color:#c8f7ff;background:rgba(0,255,255,.06);border:1px solid rgba(0,255,255,.18);padding:3px 4px;border-radius:4px}
  @media (max-width: 860px){ .cdx-stats.auto-fit{grid-template-columns:repeat(auto-fit,minmax(100px,1fr))} }
    .cdx-table{width:100%;border-collapse:collapse;margin-top:6px;font:12px/1.4 Inter;color:#c8f7ff;display:block;overflow:auto}
      .cdx-table th,.cdx-table td{border:1px solid rgba(0,255,255,.18);padding:4px 6px;text-align:right}
      .cdx-table th{text-align:center;color:#5EEBFF;background:rgba(0,255,255,.08)}
      .cdx-note{font:11px/1.5 Inter;color:#a9e9ff;opacity:.85;margin-top:4px}
  .cdx-compact-head{display:flex;gap:10px;align-items:flex-start}
  .cdx-compact-head .meta{display:flex;flex-direction:column;gap:4px}
  .cdx-compact-actions{display:flex;gap:8px;margin-top:6px}
  .cdx-toggle,.cdx-open-weapon{padding:6px 10px;border:1px solid rgba(0,255,255,.35);background:rgba(0,25,38,.6);color:#b8faff;border-radius:6px;cursor:pointer}
  .cdx-toggle:hover,.cdx-open-weapon:hover{background:rgba(0,255,255,.10)}
  .cdx-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .cdx-badge{font:10px/1.4 Inter;color:#9fe;background:rgba(0,255,255,.06);border:1px solid rgba(0,255,255,.18);padding:2px 6px;border-radius:999px}
  .cdx-highlight{outline:2px solid rgba(94,235,255,.9);box-shadow:0 0 12px rgba(94,235,255,.6) inset;border-radius:8px}
  /* Enhanced weapon layout */
  .cdx-section{margin-top:8px;padding-top:6px;border-top:1px dashed rgba(0,255,255,.18)}
  .cdx-section h4{margin:0 0 6px 0;font:600 12px Orbitron, sans-serif;letter-spacing:.8px;color:#5EEBFF}
  .cdx-kv{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
  .cdx-pill{font:11px/1.4 Inter;color:#c8f7ff;background:rgba(0,255,255,.06);border:1px solid rgba(0,255,255,.18);padding:4px 6px;border-radius:999px;display:inline-flex;gap:6px;align-items:center}
  .cdx-list{margin:0;padding-left:16px}
  .cdx-list li{margin:2px 0;color:#c8f7ff;font:12px/1.5 Inter}
  .cdx-guide{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  /* Ensure evolved weapon icons (subcards) stay small thumbnails */
  .cdx-subcard .icon{width:48px;height:48px;flex:0 0 auto;border:1px solid rgba(0,255,255,.25);border-radius:6px;background:#03222b;display:flex;align-items:center;justify-content:center}
  .cdx-subcard .icon img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated}
  /* Neon highlight for evolved weapon header */
  .cdx-subcard .name{color:#FF4D4D;text-shadow:0 0 8px rgba(255,77,77,.95),0 0 16px rgba(255,77,77,.6),0 0 24px rgba(255,77,77,.4)}
  /* Themed range slider for any controls used inside Codex */
  #codex-panel input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;background:rgba(0,255,255,.12);border:1px solid rgba(0,255,255,.18);box-shadow:inset 0 0 6px rgba(0,255,255,.12);border-radius:999px;outline:none}
  #codex-panel input[type=range]::-webkit-slider-runnable-track{height:4px;background:rgba(0,255,255,.12);border-radius:999px}
  #codex-panel input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;background:#3ED1E4;border:1px solid rgba(0,255,255,.55);box-shadow:0 0 6px rgba(62,209,228,.55);margin-top:-6px}
  #codex-panel input[type=range]::-moz-range-track{height:4px;background:rgba(0,255,255,.12);border-radius:999px;border:1px solid rgba(0,255,255,.18)}
  #codex-panel input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#3ED1E4;border:1px solid rgba(0,255,255,.55);box-shadow:0 0 6px rgba(62,209,228,.55)}
  /* Enemy icon variants */
  .enemy-icon{image-rendering:pixelated}
  .enemy-large{filter:hue-rotate(160deg) saturate(1.6) brightness(1.08) drop-shadow(0 0 10px rgba(94,235,255,.45))}
  /* Boss hero layout */
  .cdx-boss-card{position:relative;border:1px solid rgba(0,255,255,.28);background:linear-gradient(180deg, rgba(0,22,28,.75), rgba(0,12,16,.85));border-radius:10px;padding:12px;overflow:hidden;grid-column:span 2}
  .cdx-boss-hero{display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:center}
  .cdx-boss-image{width:200px;height:200px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,255,255,.25);border-radius:10px;background:radial-gradient(circle at 50% 45%, rgba(0,120,140,.35), rgba(0,0,0,.6));box-shadow:0 14px 40px rgba(0,255,255,.10)}
  .cdx-boss-image img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 0 18px rgba(94,235,255,.45))}
  .cdx-boss-title{font:800 18px Orbitron, sans-serif;letter-spacing:1px;color:#5EEBFF;text-shadow:0 0 10px rgba(0,255,255,.45)}
  .cdx-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
  .cdx-chip{font:11px/1.2 Inter;color:#c8f7ff;background:rgba(0,255,255,.08);border:1px solid rgba(0,255,255,.25);padding:6px 10px;border-radius:999px}
  .cdx-table.sticky thead th{position:sticky;top:0;z-index:1}
  @media (max-width: 980px){ .cdx-boss-hero{grid-template-columns:1fr} .cdx-boss-image{width:160px;height:160px;margin:0 auto} .cdx-boss-card{grid-column:span 1} }
  @media (max-width: 980px){ .cdx-kv{grid-template-columns:repeat(2,1fr)} .cdx-guide{grid-template-columns:1fr} }
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
            <div class="cdx-stats auto-fit">
              <div class="cdx-stat" title="Total health">Health ${s.hp}</div>
              <div class="cdx-stat" title="Base damage">Damage ${s.damage}</div>
              <div class="cdx-stat" title="Movement speed">Speed ${s.speed}</div>
              <div class="cdx-stat" title="Damage reduction or armor">Defense ${s.defense}</div>
              <div class="cdx-stat" title="Affects drops, crits, and rerolls (varies)">Luck ${s.luck}</div>
              <div class="cdx-stat" title="Overall power rating">Power ${s.powerScore ?? '—'}</div>
            </div>
            <div class="cdx-note">Starting weapon: ${this.escape(spec?.name || String(wKey))}</div>
            ${spec ? `
      <div class="cdx-embedded-weapon" style="margin-top:8px">
              <div class="cdx-compact-head">
                <div class="icon">${this.weaponPreview(wKey)}</div>
                <div class="meta" style="flex:1">
                  <div class="name">${this.escape(spec?.name || String(wKey))}</div>
                  <div class="cdx-stats auto-fit" style="grid-template-columns:repeat(3,1fr)">
        ${(() => { try { const l1 = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(1)||{}) : {}; const dmg = (typeof l1.damage==='number' ? l1.damage : spec?.damage); return `<div class=\"cdx-stat\" title=\"Damage per hit at level 1\">Damage ${this.fmtNum(dmg)}</div>`; } catch { return `<div class=\"cdx-stat\" title=\"Damage per hit at level 1\">Damage ${this.fmtNum(spec?.damage)}</div>`; } })()}
        ${(() => { try { const ms = this.computeCooldownMs(spec, 1); return `<div class=\"cdx-stat\" title=\"Time between attacks at level 1\">Cooldown ${typeof ms==='number'? (ms+'ms') : cdLabel}</div>`; } catch { return `<div class=\"cdx-stat\" title=\"Time between attacks at level 1\">Cooldown ${cdLabel}</div>`; } })()}
                    <div class="cdx-stat" title="Highest upgrade level">Max Lv ${spec?.maxLevel ?? '—'}</div>
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
    const childToParent = new Map<string,string>();
    // Build child->parent evolution map
    for (let i = 0; i < entries.length; i++) {
      const [key, spec] = entries[i];
      const evo = (spec && spec.evolution) as any;
      if (evo && evo.evolvedWeaponType != null) {
        childToParent.set(String(evo.evolvedWeaponType), String(key));
      }
    }
    const isRoot = (key: string) => !childToParent.has(String(key));

    // Helper to check if a weapon matches the search
    const matches = (spec: any): boolean => {
      if (!q) return true;
      const name = String(spec?.name||'').toLowerCase();
      const desc = String(spec?.description||'').toLowerCase();
      const qq = q.toLowerCase();
      return name.includes(qq) || desc.includes(qq);
    };

    // Helper to render a single weapon card
    const renderCard = (key: string, spec: any): string => {
  const name = spec?.name || String(key);
  const cd = (() => { const ms = this.computeCooldownMs(spec,1); return (typeof ms==='number')? (ms+'ms') : this.formatCooldown(spec); })();
      const expanded = this.expandedWeapons.has(String(key));
      const badges = this.buildWeaponBadges(spec);
      const quick = this.renderWeaponQuickStats(spec);
      const tipsPreview = this.buildWeaponUsage(spec).slice(0,2).map(t=>this.escape(t)).join(' • ');
      return `<div class="cdx-card" id="weapon-${this.escape(String(key))}" style="flex-direction:column">
        <div class="cdx-compact-head">
          <div class="icon">${this.weaponPreview(key as any)}</div>
          <div class="meta" style="flex:1">
            <div class="name">${this.escape(name)}</div>
    <div class="cdx-stats" style="grid-template-columns:repeat(4,1fr)">
  ${(() => { try { const l1 = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(1)||{}) : {}; const dmg = (typeof l1.damage==='number' ? l1.damage : spec?.damage); return `<div class=\"cdx-stat\" title=\"Damage per hit at level 1\">Damage ${this.fmtNum(dmg)}</div>`; } catch { return `<div class=\"cdx-stat\" title=\"Damage per hit at level 1\">Damage ${this.fmtNum(spec?.damage)}</div>`; } })()}
      <div class="cdx-stat" title="Time between attacks">Cooldown ${cd}</div>
      <div class="cdx-stat" title="Effective reach before despawn">Range ${this.fmtNum(spec?.range)}</div>
      <div class="cdx-stat" title="Highest upgrade level">Max Lv ${spec?.maxLevel ?? '—'}</div>
            </div>
            ${badges ? `<div class="cdx-badges">${badges}</div>` : ''}
            ${quick}
            ${tipsPreview ? `<div class="cdx-note">${tipsPreview}</div>` : ''}
            <div class="cdx-compact-actions">
              <button class="cdx-toggle" data-key="${this.escape(String(key))}">${expanded ? 'Hide details' : 'Show details'}</button>
            </div>
          </div>
        </div>
        ${expanded ? this.renderWeaponDetailsEnhanced(spec, spec?.description||'') : ''}
      </div>`;
    };

    // Iterate in original order but only over roots; render their evolutions nested
    for (let i = 0; i < entries.length; i++) {
      const [rootKey, rootSpec] = entries[i];
      if (!isRoot(rootKey)) continue; // skip evolved children as top-level

      // Build evolution chain for this root
      const chain: Array<{ key: string, spec: any, requiredPassive?: string }> = [];
      let currentKey: string = String(rootKey);
      let currentSpec: any = rootSpec;
      let safety = 0;
      while (currentSpec) {
        chain.push({ key: currentKey, spec: currentSpec });
        const evo = currentSpec.evolution as any;
        if (!evo || evo.evolvedWeaponType == null) break;
        const nextKey = String(evo.evolvedWeaponType);
        const nextSpec = (WEAPON_SPECS as any)[evo.evolvedWeaponType];
        if (!nextSpec) break;
        // attach required passive info to the child entry (for display)
        chain.push({ key: nextKey, spec: nextSpec, requiredPassive: String(evo.requiredPassive||'') });
        // prepare for potential further chaining
        currentKey = nextKey;
        currentSpec = nextSpec;
        // prevent accidental infinite loops
        if (++safety > 8) break;
        // Only support single-step chain insertion (avoid double-pushing current entry)
        break;
      }

      // Filter by search: include root if root or any child matches
      const chainMatches = chain.some(entry => matches(entry.spec));
      if (!chainMatches) continue;

      // Render root
      parts.push(renderCard(rootKey, rootSpec));

      // Render evolved children (skip the first element which is the root)
      for (let c = 1; c < chain.length; c++) {
        const child = chain[c];
        if (q && !matches(child.spec)) continue;
  const cd = (() => { const ms = this.computeCooldownMs(child.spec,1); return (typeof ms==='number')? (ms+'ms') : this.formatCooldown(child.spec); })();
        const expanded = this.expandedWeapons.has(String(child.key));
        const badges = this.buildWeaponBadges(child.spec);
        const quick = this.renderWeaponQuickStats(child.spec);
        const tipsPreview = this.buildWeaponUsage(child.spec).slice(0,2).map(t=>this.escape(t)).join(' • ');
        const req = child.requiredPassive ? `<div class=\"cdx-note\">Evolves via passive: <b>${this.escape(child.requiredPassive)}</b></div>` : '';
        parts.push(`
          <div class="cdx-subcard" id="weapon-${this.escape(String(child.key))}" style="margin:8px 0 0 28px;padding:10px;border-left:2px solid rgba(0,255,255,.25);border-radius:6px;background:rgba(0,35,45,.28)">
            <div class="cdx-compact-head">
              <div class="icon">${this.weaponPreview(child.key as any)}</div>
              <div class="meta" style="flex:1">
                <div class="name">${this.escape(child.spec?.name||String(child.key))} <span style="opacity:.65;font-weight:400">— Evolution</span></div>
                <div class="cdx-stats" style="grid-template-columns:repeat(4,1fr)">
      ${(() => { try { const l1 = typeof child.spec?.getLevelStats==='function' ? (child.spec.getLevelStats(1)||{}) : {}; const dmg = (typeof l1.damage==='number' ? l1.damage : child.spec?.damage); return `<div class=\"cdx-stat\" title=\"Damage per hit at level 1\">Damage ${this.fmtNum(dmg)}</div>`; } catch { return `<div class=\"cdx-stat\" title=\"Damage per hit at level 1\">Damage ${this.fmtNum(child.spec?.damage)}</div>`; } })()}
                  <div class="cdx-stat" title="Time between attacks">Cooldown ${cd}</div>
                  <div class="cdx-stat" title="Effective reach before despawn">Range ${this.fmtNum(child.spec?.range)}</div>
                  <div class="cdx-stat" title="Highest upgrade level">Max Lv ${child.spec?.maxLevel ?? '—'}</div>
                </div>
                ${badges ? `<div class="cdx-badges">${badges}</div>` : ''}
                ${req}
                ${quick}
                ${tipsPreview ? `<div class="cdx-note">${tipsPreview}</div>` : ''}
                <div class="cdx-compact-actions">
                  <button class="cdx-toggle" data-key="${this.escape(String(child.key))}">${expanded ? 'Hide details' : 'Show details'}</button>
                </div>
              </div>
            </div>
            ${expanded ? this.renderWeaponDetailsEnhanced(child.spec, child.spec?.description||'') : ''}
          </div>`);
      }
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

  // Detailed weapon effects section (expanded view, enhanced)
  private renderWeaponDetailsEnhanced(spec: any, descText?: string): string {
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
    const usage = this.buildWeaponUsage(spec);
    const passives = this.recommendPassives(spec);
    const dpsL1 = this.computeDps(spec, 1);
    const dpsLM = this.computeDps(spec, max);
    const kgrid = this.renderWeaponKeyValues(spec);
    const guide = this.renderUseCaseGuide(spec);
    const desc = descText ? `<div class="cdx-section"><h4>Overview</h4><div class="cdx-note">${this.escape(descText)}</div></div>` : '';
    return `
      ${desc}
      <div class="cdx-section"><h4>Quick Guide</h4>
        <ul class="cdx-list">${usage.map(t=>`<li>${this.escape(t)}</li>`).join('')}</ul>
        ${passives ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px">${passives}</div>` : ''}
      </div>
      <div class="cdx-section"><h4>Key Stats</h4>${kgrid}
        <div class="cdx-kv" style="margin-top:6px">
          <div class="cdx-pill">DPS (Lv 1): <strong>${dpsL1}</strong></div>
          <div class="cdx-pill">DPS (Lv ${max}): <strong>${dpsLM}</strong></div>
        </div>
      </div>
      ${guide}
      ${details}
      ${expl}
      <div class="cdx-section"><h4>Level Scaling</h4>${cdTable}</div>
    `;
  }

  // Render a dedicated Explosion table when a weapon detonates or creates AoE on hit.
  private renderExplosionTable(spec: any): string {
    const hasExpl = !!(spec?.explosionRadius
      || /explosive|detonate|mortar|kamikaze|aoe|drone|ion field/i.test(String(spec?.traits||'') + ' ' + String(spec?.name||'') + ' ' + String(spec?.description||'')));
    if (!hasExpl || typeof spec?.getLevelStats !== 'function') return '';
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    const rows: string[] = [];
  rows.push('<table class="cdx-table"><thead><tr><th colspan="5">Explosion</th></tr><tr><th>Level</th><th>Radius (px)</th><th>Damage</th><th>Rate (per s)</th><th>Duration</th></tr></thead><tbody>');
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
  rows.push('<table class="cdx-table"><thead><tr><th>Level</th><th>Damage</th><th>Cooldown</th><th>Shots/Salvo</th><th>Proj. Speed</th><th>Range (px)</th><th>Area (px)</th></tr></thead><tbody>');
    for (let lvl = 1; lvl <= max; lvl++) {
      const st = spec.getLevelStats(lvl) || {};
      const cd = (typeof st.cooldownMs === 'number') ? (st.cooldownMs + 'ms') : (typeof st.cooldown === 'number' ? (st.cooldown + 'f') : '—');
      rows.push(`<tr><td style="text-align:center">${lvl}</td><td>${fmtNum(st.damage)}</td><td>${cd}</td><td>${fmtNum(st.salvo)}</td><td>${fmtNum(st.speed)}</td><td>${fmtNum(st.range)}</td><td>${fmtNum(st.explosionRadius)}</td></tr>`);
    }
    rows.push('</tbody></table>');
    return rows.join('');

    function fmtNum(v:any){ return (v===0 || (typeof v==='number' && isFinite(v))) ? String(v) : '—'; }
  }

  // --- Helpers: formatting and computation ---
  private fmtNum(v:any){ return (v===0 || (typeof v==='number' && isFinite(v))) ? String(v) : '—'; }
  private formatCooldown(spec:any): string {
    if (typeof spec?.cooldownMs === 'number') return spec.cooldownMs + 'ms';
    if (typeof spec?.cooldown === 'number') return spec.cooldown + 'f';
    return '—';
  }
  private computeCooldownMs(spec:any, lvl:number): number | undefined {
    const st = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(lvl)||{}) : {};
    if (typeof st.cooldownMs === 'number') return st.cooldownMs;
    if (typeof st.cooldown === 'number') return Math.round(st.cooldown * (1000/60));
    if (typeof spec?.cooldownMs === 'number') return spec.cooldownMs;
    if (typeof spec?.cooldown === 'number') return Math.round(spec.cooldown * (1000/60));
    return undefined;
  }
  private computeDps(spec:any, lvl:number): string {
    const st = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(lvl)||{}) : {};
    const dmg = (st.damage ?? spec?.damage);
    const salvo = (st.salvo ?? spec?.salvo ?? 1);
    const ms = this.computeCooldownMs(spec, lvl);
    if (typeof dmg==='number' && typeof ms==='number' && ms>0){
      const dps = (dmg * (salvo||1)) * (1000 / ms);
      return dps.toFixed(1);
    }
    return '—';
  }
  private renderWeaponQuickStats(spec:any): string {
    const bits: string[] = [];
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    const l1 = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(1)||{}) : {};
    const lM = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(max)||{}) : {};
    const pierce = lM.pierce || l1.pierce;
    const bounces = lM.bounces || l1.bounces;
    const aoe = lM.explosionRadius || l1.explosionRadius || spec?.explosionRadius;
    const salvo = l1.salvo ?? spec?.salvo;
    const spread = l1.spread ?? spec?.spread;
    const speed = l1.speed ?? spec?.speed;
  if (pierce) bits.push(`<span class="cdx-pill">Pierce ${pierce}</span>`);
  if (bounces) bits.push(`<span class="cdx-pill">Bounces ${bounces}</span>`);
  if (aoe) bits.push(`<span class="cdx-pill">Area ${aoe}px</span>`);
  if (typeof salvo==='number') bits.push(`<span class="cdx-pill">Shots/Salvo ${salvo}</span>`);
  if (typeof spread==='number') bits.push(`<span class="cdx-pill">Spread ${(spread*100).toFixed(0)}%</span>`);
  if (typeof speed==='number') bits.push(`<span class="cdx-pill">Projectile Speed ${speed}</span>`);
    return bits.length ? `<div class="cdx-section">${bits.join(' ')}</div>` : '';
  }
  private renderWeaponKeyValues(spec:any): string {
    const max = Math.max(1, Number(spec?.maxLevel || 1));
    const l1 = typeof spec?.getLevelStats==='function' ? (spec.getLevelStats(1)||{}) : {};
    const rows: string[] = [];
    const push = (k:string, v:any) => rows.push(`<div class="cdx-pill"><span style="opacity:.7">${k}</span> <strong>${this.fmtNum(v)}</strong></div>`);
  push('Range (px)', (l1.range ?? spec?.range));
  push('Cooldown', (typeof l1.cooldownMs==='number' ? l1.cooldownMs+'ms' : (typeof l1.cooldown==='number' ? l1.cooldown+'f' : this.formatCooldown(spec))));
  if (l1.salvo ?? spec?.salvo) push('Shots per Salvo', (l1.salvo ?? spec?.salvo));
  if (l1.speed ?? spec?.speed) push('Projectile Speed', (l1.speed ?? spec?.speed));
  if (l1.turnRate ?? spec?.turnRate) push('Turn Rate', (l1.turnRate ?? spec?.turnRate));
  if (l1.thickness ?? spec?.thickness) push('Beam Thickness', (l1.thickness ?? spec?.thickness));
  if (l1.length ?? spec?.length) push('Beam Length', (l1.length ?? spec?.length));
  if (l1.orbitRadius ?? spec?.orbitRadius) push('Orbit Radius', (l1.orbitRadius ?? spec?.orbitRadius));
    return `<div class="cdx-kv">${rows.join('')}</div>`;
  }
  private buildWeaponUsage(spec:any): string[] {
    const tips: string[] = [];
    const src: string[] = (spec?.usageTips as string[]) || [];
    for (let i=0;i<src.length;i++) if (src[i]) tips.push(src[i]);
    const traitsText = (String(spec?.traits||'') + ' ' + String(spec?.description||'') + ' ' + String(spec?.name||'')).toLowerCase();
    // Heuristics
    if (traitsText.includes('spray') || (spec?.spread && spec.spread>0.12)) tips.push('Feather movement and fire in short bursts to tighten spread.');
    if (traitsText.includes('explosive') || spec?.explosionRadius) tips.push('Aim at dense packs or walls to maximize explosion overlap.');
    if (traitsText.includes('pierce')) tips.push('Kite enemies into a line; piercing shots reward straight funnels.');
    if (traitsText.includes('bounce') || (typeof (spec?.getLevelStats?.(1)?.bounces) === 'number')) tips.push('Fight near groups; each bounce seeks a fresh victim.');
    if (traitsText.includes('homing') || traitsText.includes('smart')) tips.push('Maintain distance; homing covers aim, you focus on positioning.');
    if (traitsText.includes('orbit') || traitsText.includes('halo')) tips.push('Stay close to targets; orbit contact deals consistent chip damage.');
    if (traitsText.includes('beam')) tips.push('Sweep the beam across enemies; avoid over-tracking a single target at low ramp.');
    if (traitsText.includes('poison') || traitsText.includes('dot')) tips.push('Keep enemies inside zones; DoT stacks do the heavy lifting.');
    if (spec?.range) tips.push(`Operate within ~${Math.round(spec.range)}px; outside that, uptime drops.`);
    return tips;
  }
  private recommendPassives(spec:any): string {
    const pcs: string[] = [];
    const t = (String(spec?.traits||'') + ' ' + String(spec?.description||'') + ' ' + String(spec?.name||'')).toLowerCase();
    const add = (name:string) => pcs.push(`<span class="cdx-pill">${this.escape(name)}</span>`);
    // Generic always-good
    add('Damage');
    // Heuristic picks
    if (t.includes('explosive') || spec?.explosionRadius) add('Area');
    if (t.includes('spray') || (spec?.spread && spec.spread>0.12)) add('Attack Speed');
    if (t.includes('pierce')) add('Pierce');
    if (t.includes('crit') || t.includes('dagger') || t.includes('sniper')) add('Crit');
    if (t.includes('drone') || t.includes('kamikaze')) add('Cooldown');
    if (t.includes('orbit') || t.includes('halo')) add('Duration');
    return pcs.join(' ');
  }
  private renderUseCaseGuide(spec:any): string {
    const boss: string[] = [];
    const crowd: string[] = [];
    const t = (String(spec?.traits||'') + ' ' + String(spec?.description||'') + ' ' + String(spec?.name||'')).toLowerCase();
    if (t.includes('burst') || t.includes('sniper') || t.includes('railgun') || t.includes('beam')) {
      boss.push('Wait for clean shots; burst windows chunk bosses.');
      boss.push('Stack Damage/Crit/Attack Speed for higher burst per window.');
    }
    if (spec?.explosionRadius || t.includes('aoe') || t.includes('mortar') || t.includes('plasma')) {
      crowd.push('Pull packs tight, then detonate inside the cluster.');
      crowd.push('Area/Cooldown passives massively increase map clear.');
    }
    if (t.includes('pierce')) {
      crowd.push('Kite in lanes; piercing shots reward lines of enemies.');
    }
    if (t.includes('bounce') || (typeof (spec?.getLevelStats?.(1)?.bounces) === 'number')) {
      crowd.push('Bounce chains excel in mid-density waves; avoid isolated targets.');
    }
    if (!boss.length && !crowd.length) return '';
    return `<div class="cdx-section"><h4>Use Cases</h4><div class="cdx-guide">
      ${boss.length ? `<div><div class="cdx-note" style="margin-bottom:4px">Boss</div><ul class="cdx-list">${boss.map(x=>`<li>${this.escape(x)}</li>`).join('')}</ul></div>` : ''}
      ${crowd.length ? `<div><div class="cdx-note" style="margin-bottom:4px">Crowd</div><ul class="cdx-list">${crowd.map(x=>`<li>${this.escape(x)}</li>`).join('')}</ul></div>` : ''}
    </div></div>`;
  }

  private renderPassives(q: string): string {
    const parts: string[] = [];
    parts.push('<div class="cdx-note" style="margin-bottom:8px">Passive Scaling & Stacking</div>');
    parts.push('<div class="cdx-grid">');
    for (let i = 0; i < PASSIVE_SPECS.length; i++) {
      const p = PASSIVE_SPECS[i];
      if (q && !(p.name.toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q))) continue;
      // Placeholder passive icon for all passives (uniform look in Codex)
      const icon = `
        <svg viewBox='0 0 64 64' width='52' height='52' role='img' aria-label='Passive Icon'>
          <defs>
            <linearGradient id='cdxPassiveGrad' x1='0' y1='1' x2='0' y2='0'>
              <stop offset='0' stop-color='#00A3CC'/>
              <stop offset='1' stop-color='#79F2FF'/>
            </linearGradient>
          </defs>
          <rect x='6' y='6' width='52' height='52' rx='10' ry='10' fill='rgba(0,50,64,0.55)' stroke='rgba(0,255,255,0.35)' stroke-width='2'/>
          <path d='M30.9 7.2 10.4 30.1c-1.6 1.8-1.6 4.6.1 6.3 1.7 1.7 4.4 1.7 6.1 0l9.9-10.6v29.5c0 2.4 2 4.3 4.4 4.3s4.4-1.9 4.4-4.3V25.8l9.9 10.6c1.7 1.7 4.4 1.7 6.1 0 1.7-1.7 1.7-4.5.1-6.3L31.9 7.2a1.4 1.4 0 0 0-1-.4c-.4 0-.8.1-1 .4Z' fill='url(#cdxPassiveGrad)' stroke='#00ffcc' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' />
        </svg>`;
      const table = this.renderPassiveLevels(p);
      parts.push(`
        <div class="cdx-card" style="flex-direction:column">
          <div class="cdx-compact-head">
            <div class="icon">${icon}</div>
            <div class="meta" style="flex:1">
              <div class="name">${this.escape(p.name)}</div>
              <div class="desc">${this.escape(p.description||'')}</div>
              <div class="cdx-stats" style="grid-template-columns:repeat(2,1fr)">
                <div class="cdx-stat" title="Highest upgrade level">Max Lv ${p.maxLevel}</div>
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
      // Select image per archetype
      const imgSrc = a.id === 'small'
        ? AssetLoader.normalizePath('/assets/enemies/enemy_spider.png')
        : AssetLoader.normalizePath('/assets/enemies/enemy_default.png');
      const cls = a.id === 'large' ? 'enemy-icon enemy-large' : 'enemy-icon';
      parts.push(`
        <div class="cdx-card">
          <div class="icon"><img class="${cls}" src="${imgSrc}" alt="${this.escape(a.name)}"/></div>
          <div class="meta">
            <div class="name">${a.name} <span style="opacity:.6;font-weight:400">— Archetype</span></div>
            <div class="cdx-stats" style="grid-template-columns:repeat(4,1fr)">
              <div class="cdx-stat" title="Typical early-wave health">Early HP ${a.hpEarly}</div>
              <div class="cdx-stat" title="Typical late-wave health">Late HP ${a.hpLate}</div>
              <div class="cdx-stat" title="Contact damage">Damage ${a.damage}</div>
              <div class="cdx-stat" title="Collision radius in pixels">Radius ${a.radius}</div>
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
      const info = this.abilityInfo[c.id] || {};
      parts.push(`
        <div class="cdx-card">
          <div class="icon"><img src="${c.icon}" alt="${this.escape(c.name)}"/></div>
          <div class="meta">
            <div class="name">${this.escape(c.name)}</div>
            <div class="desc">${this.escape(info.title || (c.specialAbility ? String(c.specialAbility).split(' — ')[0] : '—'))} — ${this.escape(info.summary || (c.specialAbility || ''))}</div>
            <div class="cdx-stats" style="grid-template-columns:repeat(3,1fr)">
              <div class="cdx-stat">Role ${this.escape(c.playstyle||'—')}</div>
              <div class="cdx-stat">Default ${this.escape(String(c.defaultWeapon))}</div>
              <div class="cdx-stat">Power ${c.stats?.powerScore ?? '—'}</div>
            </div>
            ${info.scaling && info.scaling.length ? `<div class="cdx-badges" style="margin-top:6px">${info.scaling.map(s=>`<span class='cdx-badge'>${this.escape(s)}</span>`).join(' ')}</div>` : ''}
            ${info.effects && info.effects.length ? `<div class="cdx-section"><h4>Mechanics</h4><ul class="cdx-list">${info.effects.map(e=>`<li>${this.escape(e)}</li>`).join('')}</ul></div>` : ''}
            ${info.tips && info.tips.length ? `<div class="cdx-section"><h4>Tips</h4><ul class="cdx-list">${info.tips.map(t=>`<li>${this.escape(t)}</li>`).join('')}</ul></div>` : ''}
          </div>
        </div>`);
    }
    parts.push('</div>');

  // Passive stacking section moved to Passives tab

    return parts.join('');
  }

  // Build a per-level effect table for passives to show stacking behavior.
  private renderPassiveLevels(p: any): string {
    const max = Math.max(1, Number(p?.maxLevel || 1));
    const rows: string[] = [];
  rows.push('<table class="cdx-table"><thead><tr><th>Level</th><th>Effect</th></tr></thead><tbody>');
    for (let lvl = 1; lvl <= max; lvl++) {
      rows.push(`<tr><td style="text-align:center">${lvl}</td><td>${this.describePassiveEffect(p.id, lvl)}</td></tr>`);
    }
    rows.push('</tbody></table>');
    return rows.join('');
  }

  // Human-readable description of a passive’s effects at a specific level, matching PassiveConfig.
  private describePassiveEffect(id: number, level: number): string {
    switch (id) {
      case 0: return `+${(level * 0.7).toFixed(1)} move speed over base`;
      case 1: {
        const inc = level * 26;
        const heal = Math.round(inc * 0.55);
        return `Max HP +${inc}; on pickup, heal +${heal} (55% of increase)`;
      }
      case 2: return `Global damage ×${(1 + level * 0.196).toFixed(2)} (${(level*19.6).toFixed(1)}%)`;
      case 3: return `Fire rate ×${(1 + level * 0.182).toFixed(2)} (${(level*18.2).toFixed(1)}% faster)`;
      case 10: return `Area radius ×${(1 + Math.min(level,3)*0.10).toFixed(2)} (cap at L3)`;
      case 4: return `On-kill explosion enabled`;
      case 5: return `Pickup radius ${120 + level*36}px`;
  case 6: return `Shield proc chance ${(Math.min(0.5, level*0.055)*100).toFixed(1)}%`;
      case 7: return `Crit chance +${(Math.min(0.55, level*0.0525)*100).toFixed(1)}%, crit mult ×${Math.min(3.1, 1.5 + level*0.133).toFixed(2)}`;
      case 8: return `Piercing +${level} extra enemies`;
  case 9: return `Regen ${(level * 0.25).toFixed(3)} HP/s`;
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
        // Robustly normalize any sprite path to a canonical '/assets/...' before passing through AssetLoader
        // Handles cases like './assets/...', 'assets/...', '/assets/...', or '/cs/assets/...'
        const raw = String(vis.sprite);
        let canonical: string;
        const idx = raw.indexOf('assets/');
        if (idx >= 0) {
          canonical = '/' + raw.substring(idx); // force '/assets/...'
        } else if (raw.startsWith('./')) {
          canonical = '/' + raw.replace(/^\.\//, '');
        } else if (raw.startsWith('/')) {
          canonical = raw; // already absolute; may be fine if not assets-based
        } else {
          canonical = '/' + raw; // relative -> absolute root for normalizePath
        }
        const path = AssetLoader.normalizePath(canonical);
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
      <div class="cdx-boss-card">
        <div class="cdx-boss-hero">
          <div class="cdx-boss-image"><img src="${this.escape(b.file)}" alt="${this.escape(title)}"/></div>
          <div class="meta">
            <div class="cdx-boss-title">${this.escape(title)}</div>
            <div class="cdx-chips">
              <div class="cdx-chip">Base HP ${specs.baseHp}</div>
              <div class="cdx-chip">Radius ${specs.radius}</div>
              <div class="cdx-chip">Contact ${specs.contactBase}</div>
              <div class="cdx-chip" title="Maximum radius of the shockwave nova">Nova Radius Max ${specs.novaMaxRadius}</div>
            </div>
            ${metaBits.length ? `<div class="cdx-note" style="margin-top:6px">${this.escape(metaBits.join(' · '))}</div>` : ''}
            <div class="cdx-note">Phases at 70% and 40% HP; attack cadence increases each phase.</div>
            <div class="cdx-note">Boss respawns infinitely; per-spawn scaling applies.</div>
            ${firstBossNote}
          </div>
        </div>
        <div style="margin-top:10px">${table.replace('<table','<table class=\"cdx-table sticky\"')}</div>
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
