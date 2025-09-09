// CyberSurvivor UI UpgradePanel
import { Player } from '../game/Player';
import { WeaponType } from '../game/WeaponType';
import { WEAPON_SPECS } from '../game/WeaponConfig';
import { PASSIVE_SPECS } from '../game/PassiveConfig';
import { Logger } from '../core/Logger';

export interface UpgradeOption {
  type: 'weapon' | 'passive' | 'skip' | 'buff';
  id: number | WeaponType;
  name: string;
  description: string;
  icon: string;
  currentLevel?: number;
}

export class UpgradePanel {
  private player: Player;
  private game: any;
  private panelElement: HTMLElement | null = null;
  private visible = false;
  private rerollLimit = 3;
  private rerollsUsed = 0;
  private options: UpgradeOption[] = [];

  constructor(player: Player, game: any) {
    this.player = player;
    this.game = game;
    this.createHTML();
    this.setupEventListeners();
  }

  private createHTML(): void {
    // Avoid duplicating panel
    const existing = document.getElementById('upgrade-panel');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'upgrade-panel';
    overlay.className = 'upgrade-panel-overlay hidden';
    overlay.innerHTML = `
      <div class="upgrade-panel ui-panel">
        <div class="upgrade-panel-header">
          <div class="upgrade-panel-title">UPGRADES</div>
          <div class="upgrade-hint">1·2·3 = Select   R = Reroll (3 left)   ESC = Skip</div>
        </div>
        <div class="upgrade-options-grid fixed-three" data-upgrade-options></div>
        <div class="upgrade-actions">
          <button class="btn-reroll" data-reroll>Reroll (3 left)</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.panelElement = overlay;
  }

  private setupEventListeners(): void {
    // Global key handler while panel visible
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.visible) return;
      const rawKey = e.key;
      const key = rawKey.toLowerCase();
      const keyMap: Record<string, number> = { '1': 0, '+': 0, '2': 1, '3': 2, ',': 2, 'š': 2 };
      if (key in keyMap) {
        const targetIdx = keyMap[key];
        if (targetIdx < this.options.length) {
          this.applyUpgrade(targetIdx);
          e.preventDefault();
          return;
        }
      }
      if (key === 'r') {
        if (this.rerollsUsed < this.rerollLimit) this.reroll();
        e.preventDefault();
        return;
      }
      const idxNum = parseInt(rawKey, 10);
      if (!isNaN(idxNum) && idxNum >= 1 && idxNum <= this.options.length) {
        this.applyUpgrade(idxNum - 1);
      } else if (key === 'escape') {
        this.hide();
        if (this.game && typeof this.game.setState === 'function') {
          this.game.setState('GAME');
        }
      }
    });

    // Delegate reroll button click
    document.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      if (!target) return;
      if (target.matches('[data-reroll]')) {
        if (this.visible && this.rerollsUsed < this.rerollLimit) this.reroll();
      }
    });

    // Reset reroll counter on new game run
    window.addEventListener('startGame', () => {
      this.rerollsUsed = 0;
      this.updateRerollUI();
    });

    // Allow external event to open panel
    window.addEventListener('showUpgradePanel', () => {
      this.show();
    });
  }

  /** Show the upgrade selector panel and render options. */
  public show(): void {
    this.visible = true;
    this.options = this.generateOptions();
    this.renderOptions();
    if (this.panelElement) {
  // Apply uniform scale BEFORE showing so there is no size pop
  this.applyScale();
  this.panelElement.classList.remove('hidden');
  // Keep flex container from CSS for perfect centering
  this.panelElement.style.display = 'flex';
  this.panelElement.style.zIndex = '9999';
  this.panelElement.style.pointerEvents = 'auto';
      // Ensure grid forced to 3 columns (no wrapping to 2/1) regardless of media queries
      const grid = this.panelElement.querySelector('.upgrade-options-grid');
      if (grid) grid.classList.add('fixed-three');
    }
    // Update hint/button with remaining rerolls
    this.updateRerollUI();
  }

  /** Rerolls (regenerates) the upgrade options without closing the panel. */
  private reroll(): void {
    if (!this.visible) return;
    if (this.rerollsUsed >= this.rerollLimit) return;
    this.rerollsUsed++;
    this.options = this.generateOptions();
    this.renderOptions();
    try { window.dispatchEvent(new CustomEvent('upgradeRerolled')); } catch {}
    this.updateRerollUI();
  }

  /** Hide the upgrade selector panel. */
  public hide(): void {
    this.visible = false;
    if (this.panelElement) {
      this.panelElement.classList.add('hidden');
      this.panelElement.style.display = 'none';
      this.panelElement.style.pointerEvents = 'none';
    }
  }

  /** Render upgrade options in the panel. */
  private renderOptions(): void {
    if (!this.panelElement) return;
    const container = this.panelElement.querySelector('[data-upgrade-options]');
    if (!container) return;

    container.innerHTML = '';

    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const isClassWeapon = opt.type === 'weapon' && opt.id === this.player.characterData?.defaultWeapon;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'upgrade-card';
      if (opt.type === 'weapon') card.classList.add('is-weapon');
      if (opt.type === 'passive') card.classList.add('is-passive');
      if (isClassWeapon) card.classList.add('is-class');

      // Progress (only for non-skip options)
      let progressHtml = '';
      if (opt.type !== 'skip' && opt.currentLevel !== undefined) {
        const spec = opt.type === 'weapon' ? WEAPON_SPECS[opt.id as WeaponType] : PASSIVE_SPECS.find(p => p.id === opt.id);
        const max = spec ? (spec as any).maxLevel ?? 1 : 1;
        const current = Math.min(opt.currentLevel, max);
        const pct = Math.min(100, Math.round(((current) / max) * 100));
        progressHtml = `<div class="upgrade-progress" aria-label="Progress ${current}/${max}">
          <div class="upgrade-progress-bar" data-progress="${pct}"></div>
          <div class="upgrade-progress-text">Lv ${current}/${max}</div>
        </div>`;
      }

      // Decide icon markup
      let iconHtml = '';
  if (opt.type === 'weapon') {
        try {
          const spec = WEAPON_SPECS[opt.id as WeaponType];
          const pv: any = spec?.projectileVisual;
          const bv: any = (spec as any)?.beamVisual;
          if (pv && pv.sprite) {
    const raw = pv.sprite as string;
    const src = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath(raw.startsWith('/') ? raw : ('/' + raw.replace(/^\.\//, ''))) : (typeof location!== 'undefined' && location.protocol === 'file:' && raw.startsWith('/assets/') ? ('.' + raw) : raw);
    iconHtml = `<img src="${src}" alt="${opt.name}" />`;
          } else if (pv && pv.type === 'plasma' && (/orbit|halo|ring/i.test(String(spec?.name||'')) || (spec?.id === WeaponType.QUANTUM_HALO))) {
            const core = pv.color || '#FFFBEA';
            const glow = pv.glowColor || '#FFEFA8';
            const fid = `halo-${String(opt.id)}-${i}`;
            iconHtml = (
              `<svg viewBox="0 0 64 64" width="52" height="52" role="img" aria-label="${opt.name}" class="weapon-halo-icon">`+
                `<defs>`+
                  `<radialGradient id="${fid}-g" cx="50%" cy="50%" r="50%">`+
                    `<stop offset="0%" stop-color="${core}" stop-opacity="1"/>`+
                    `<stop offset="60%" stop-color="${glow}" stop-opacity="0.55"/>`+
                    `<stop offset="100%" stop-color="${glow}" stop-opacity="0"/>`+
                  `</radialGradient>`+
                `</defs>`+
                `<circle cx="32" cy="32" r="18" fill="none" stroke="${glow}" stroke-width="3" />`+
                `<circle cx="32" cy="32" r="12" fill="url(#${fid}-g)" opacity="0.85" />`+
              `</svg>`
            );
          } else if (bv || (pv && (pv.type === 'laser' || pv.type === 'beam'))) {
            const beamColor = (bv?.color || pv?.color || '#FFFFFF');
            const thickness = Math.max(4, Math.min(18, (bv?.thickness || pv?.thickness || 12)));
            const orbColor = pv?.color || '#00FFFF';
            const fid = `glow-${String(opt.id)}-${i}`;
            iconHtml = (
              `<svg viewBox="0 0 64 64" width="52" height="52" role="img" aria-label="${opt.name}" class="weapon-beam-icon">`+
                `<defs>`+
                  `<filter id="${fid}" x="-50%" y="-50%" width="200%" height="200%">`+
                    `<feGaussianBlur stdDeviation="2.5" result="coloredBlur" />`+
                    `<feMerge>`+
                      `<feMergeNode in="coloredBlur"/>`+
                      `<feMergeNode in="SourceGraphic"/>`+
                    `</feMerge>`+
                  `</filter>`+
                `</defs>`+
                `<circle cx="10" cy="32" r="6" fill="${orbColor}" opacity="0.9" filter="url(#${fid})"/>`+
                `<rect x="16" y="${32 - thickness/2}" width="40" height="${thickness}" fill="${beamColor}" rx="${Math.min(8, thickness/2)}" filter="url(#${fid})"/>`+
              `</svg>`
            );
          } else {
            const raw = (spec?.icon || opt.icon || '/assets/projectiles/bullet_cyan.png') as string;
            const src = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath(raw.startsWith('/') ? raw : ('/' + raw.replace(/^\.\//, ''))) : (typeof location!== 'undefined' && location.protocol === 'file:' && raw.startsWith('/assets/') ? ('.' + raw) : raw);
            if (src) iconHtml = `<img src="${src}" alt="${opt.name}" />`;
          }
        } catch {
          const raw = (opt.icon || '/assets/projectiles/bullet_cyan.png') as string;
          const src = (window as any).AssetLoader ? (window as any).AssetLoader.normalizePath(raw.startsWith('/') ? raw : ('/' + raw.replace(/^\.\//, ''))) : (typeof location!== 'undefined' && location.protocol === 'file:' && raw.startsWith('/assets/') ? ('.' + raw) : raw);
          iconHtml = src ? `<img src="${src}" alt="${opt.name}" />` : '';
        }
  } else if (opt.type === 'passive') {
        const pSpec = PASSIVE_SPECS.find(p => p.id === opt.id);
        const raw = pSpec?.icon || '';
        const src = raw ? ((window as any).AssetLoader ? (window as any).AssetLoader.normalizePath(raw.startsWith('/') ? raw : ('/' + raw.replace(/^\.\//, ''))) : (typeof location!== 'undefined' && location.protocol === 'file:' && raw.startsWith('/assets/') ? ('.' + raw) : raw)) : '';
        if (src) {
          iconHtml = `<img src="${src}" alt="${opt.name}" width="52" height="52" />`;
        } else {
          iconHtml = `<svg viewBox='0 0 64 64' width='52' height='52' role='img' aria-label='Passive Upgrade' class='passive-arrow'>
            <defs>
              <linearGradient id='gradPassive' x1='0' y1='1' x2='0' y2='0'>
                <stop offset='0%' stop-color='#00a85a'/>
                <stop offset='50%' stop-color='#00ff88'/>
                <stop offset='100%' stop-color='#b6ffd9'/>
              </linearGradient>
            </defs>
            <path d='M30.9 7.2 10.4 30.1c-1.6 1.8-1.6 4.6.1 6.3 1.7 1.7 4.4 1.7 6.1 0l9.9-10.6v29.5c0 2.4 2 4.3 4.4 4.3s4.4-1.9 4.4-4.3V25.8l9.9 10.6c1.7 1.7 4.4 1.7 6.1 0 1.7-1.7 1.7-4.5.1-6.3L31.9 7.2a1.4 1.4 0 0 0-1-.4c-.4 0-.8.1-1 .4Z' fill='url(#gradPassive)' stroke='#00ff99' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' />
          </svg>`;
  }
  } else if (opt.type === 'buff') {
        const label = opt.name || 'Buff';
        iconHtml = `
          <svg viewBox="0 0 64 64" width="52" height="52" role="img" aria-label="${label}">
            <defs>
              <linearGradient id="gradBuff" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stop-color="#66ffcc"/>
                <stop offset="100%" stop-color="#22aaff"/>
              </linearGradient>
            </defs>
            <circle cx="32" cy="32" r="18" fill="none" stroke="url(#gradBuff)" stroke-width="3" />
            <path d="M32 15 L36 27 L50 27 L39 35 L43 49 L32 41 L21 49 L25 35 L14 27 L28 27 Z" fill="url(#gradBuff)" opacity="0.75"/>
          </svg>`;
  }

      // Build supplemental info rows: unlock/evolution/deltas
      let infoHtml = '';
      if (opt.type === 'weapon') {
        const spec = WEAPON_SPECS[opt.id as WeaponType];
        if (spec) {
          const ownedLv = this.player.activeWeapons.get(opt.id as WeaponType) || 0;
          const infoParts: string[] = [];
          const isEvolvedCard = (spec.maxLevel || 1) === 1;

          // Base weapon evolution readiness
          if (!isEvolvedCard && spec.evolution && (spec.maxLevel || 1) > 1) {
            const evo = spec.evolution;
            const evoSpec = WEAPON_SPECS[evo.evolvedWeaponType];
            const minPassive = 1; // All evolutions require only passive at Lv.1
            const reqPassive = evo.requiredPassive;
            const passiveOwned = this.player.activePassives.find(p => p.type === reqPassive);
            const hasPassive = !!passiveOwned && passiveOwned.level >= minPassive;
            const atMax = ownedLv >= (spec.maxLevel || 1);
            if (!evoSpec?.disabled) {
              const ready = hasPassive && atMax;
              const status = ready ? `<span style=\"color:#57ffb0\">Ready</span>`
                                   : `<span style=\"color:#ffd166\">Needs ${reqPassive} Lv.1${atMax ? '' : ' + Max Lv.'}</span>`;
              infoParts.push(`<div class=\"upgrade-info\" style=\"opacity:.9\"><strong>Evolve:</strong> ${evoSpec?.name || 'Evolution'} — ${status}</div>`);
            }
          }

          // Evolved weapon: show combo tip
          if (isEvolvedCard) {
            const parent = Object.values(WEAPON_SPECS).find(s => s.evolution && s.evolution.evolvedWeaponType === spec.id);
            const req = parent?.evolution?.requiredPassive;
            const baseName = parent?.name;
            if (baseName) {
              const reqLabel = req ? `${req} Lv.1` : 'Prereq Lv.1';
              infoParts.push(`<div class=\"upgrade-info emph\" style=\"color:#ff6666; text-shadow:0 0 8px rgba(255,0,0,.55)\"><strong>Evolution:</strong> ${baseName} + ${reqLabel} → ${spec.name}</div>`);
            }
          }

          // Unlock/delta info (skip for evolved cards to keep the combo tip clean)
          if (!isEvolvedCard) {
            if (ownedLv === 0) {
              infoParts.push(`<div class=\"upgrade-info emph\" style=\"font-weight:700;letter-spacing:.2px;\"><strong>Unlocks:</strong> ${spec.traits?.slice(0,3).join(' • ') || 'Weapon unlocked'}</div>`);
            } else {
              try {
                const next = spec.getLevelStats ? spec.getLevelStats(ownedLv + 1) : undefined;
                const cur = spec.getLevelStats ? spec.getLevelStats(ownedLv) : undefined;
                if (next && cur) {
                  // Show clear level-up preview using the actual current level → next level
                  const maxLv = spec.maxLevel || 1;
                  if (ownedLv < maxLv) {
                    infoParts.push(`<div class=\"upgrade-info emph\" style=\"font-weight:700;letter-spacing:.2px;\"><span class=\"delta good\" style=\"color:#57ffb0;\">Lv ${ownedLv} → <strong>${ownedLv + 1}</strong></span></div>`);
                  }
                  const parts: string[] = [];
                  const addDelta = (label: string, a?: number, b?: number, inv = false) => {
                    if (typeof a !== 'number' || typeof b !== 'number') return;
                    const d = a - b;
                    const dInt = Math.round(d);
                    if (dInt === 0) return;
                    const shown = inv ? -dInt : dInt;
                    const valStr = shown > 0 ? `+${shown}` : `${shown}`;
                    const isBetter = inv ? d < 0 : d > 0;
                    const arrow = inv ? (d < 0 ? '↓' : '↑') : (d > 0 ? '↑' : '↓');
                    const color = isBetter ? '#57ffb0' : '#ff7b7b';
                    parts.push(`<span class=\"delta ${isBetter ? 'good' : 'bad'}\" style=\"color:${color};font-weight:700;\"><span class=\"k\">${label}</span> <span class=\"v\">${valStr}</span> <span class=\"arrow\">${arrow}</span></span>`);
                  };
                  addDelta('dmg', next.damage as number, cur.damage as number);
                  addDelta('cd', next.cooldown as number, cur.cooldown as number, true);
                  addDelta('spd', (next as any).speed as number, (cur as any).speed as number);
                  addDelta('len', (next as any).length as number, (cur as any).length as number);
                  if (parts.length) infoParts.push(`<div class=\"upgrade-info emph\" style=\"font-weight:700;letter-spacing:.2px;\">${parts.join(' · ')}</div>`);
                }
              } catch { /* ignore */ }
            }
          }

          if (infoParts.length) infoHtml += infoParts.join('');
        }
      } else if (opt.type === 'passive') {
        const pSpec = PASSIVE_SPECS.find(p => p.id === opt.id);
        const existing = this.player.activePassives.find(ap => ap.type === pSpec?.name);
        if (pSpec) {
          if (!existing) {
            infoHtml += `<div class="upgrade-info emph" style="font-weight:700;letter-spacing:.2px;"><strong>Unlocks:</strong> ${pSpec.name}</div>`;
          } else if (existing.level < pSpec.maxLevel) {
            const nextLv = Math.min(existing.level + 1, pSpec.maxLevel);
            infoHtml += `<div class="upgrade-info emph" style="font-weight:700;letter-spacing:.2px;"><span class="delta good" style="color:#57ffb0;">Lv +1 → <strong>${nextLv}</strong></span></div>`;
          }
          // Key evolution highlight: if this passive is required for any evolution for a currently owned base weapon at max level
          try {
            const reqName = pSpec.name;
            if (reqName) {
              const ownedBases = Array.from(this.player.activeWeapons.entries());
              let isKey = false;
              for (let i = 0; i < ownedBases.length && !isKey; i++) {
                const [wt, lvl] = ownedBases[i] as [WeaponType, number];
                const spec = WEAPON_SPECS[wt];
                if (!spec || !spec.evolution) continue;
                const evo = spec.evolution;
                if (evo.requiredPassive !== reqName) continue;
                const maxLv = spec.maxLevel || 1;
                const evolvedOwned = (this.player.activeWeapons.get(evo.evolvedWeaponType) || 0) > 0;
                if (!evolvedOwned && lvl >= maxLv) {
                  const have = this.player.activePassives.find(pp => pp.type === reqName);
                  if (!have || have.level < (evo.minPassiveLevel || 1)) isKey = true;
                }
              }
              if (isKey) infoHtml += `<div class="upgrade-info" style="color:#57ffb0;font-weight:700;">Key to Evolve</div>`;
            }
          } catch { /* ignore */ }
        }
      }

      card.innerHTML = `
        <div class="upgrade-key-indicator">${i + 1}</div>
        <div class="upgrade-icon top-right">${iconHtml}</div>
        <div class="upgrade-body">
          <div class="upgrade-row">
            <div class="upgrade-title-line">
              <span class="upgrade-title">${opt.name}</span>
              ${isClassWeapon && (opt.currentLevel||0) === 0 ? '<span class="badge badge-class" title="Class Weapon">C</span>' : ''}
            </div>
            <div class="upgrade-type-line">${
              opt.type === 'weapon' ? '<span class="badge badge-weapon">Weapon</span>' :
              opt.type === 'passive' ? '<span class="badge badge-passive">Passive</span>' :
              opt.type === 'buff' ? '<span class="badge" style="background:#2dbd8b;color:#012;">Buff</span>' :
              '<span class="badge badge-skip">Skip</span>'
            }</div>
          </div>
          <div class="upgrade-desc">${opt.description}</div>
          ${infoHtml}
        </div>
        ${progressHtml ? `<div class="upgrade-progress-wrapper">${progressHtml}</div>` : ''}
      `;

      // Adaptive sizing flags
      const titleLen = opt.name.length;
      const descLen = opt.description?.length || 0;
      if (titleLen > 24 || descLen > 140) card.setAttribute('data-text-small','1');
      if (titleLen > 32 || descLen > 200) card.setAttribute('data-text-small','2');

      // Mark evolved options for special styling
      if (opt.type === 'weapon') {
        const spec = WEAPON_SPECS[opt.id as WeaponType];
        if (spec && (spec.maxLevel || 1) === 1) {
          card.classList.add('is-evolved');
          card.setAttribute('data-evolved','1');
          card.title = (card.title ? card.title + ' • ' : '') + 'Evolution option';
        }
      }

      card.addEventListener('click', () => this.applyUpgrade(i));
      container.appendChild(card);
    }

  // Progress widths are set via CSS using the data-progress attribute; no JS needed here.
  }

  /** Update reroll hint and button state */
  private updateRerollUI(): void {
    if (!this.panelElement) return;
    const left = Math.max(0, this.rerollLimit - this.rerollsUsed);
    const hint = this.panelElement.querySelector('.upgrade-hint') as HTMLElement | null;
    if (hint) hint.textContent = `1·2·3 = Select   R = Reroll (${left} left)   ESC = Skip`;
    const btn = this.panelElement.querySelector('.btn-reroll') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = left <= 0;
      btn.title = left > 0 ? `Reroll upgrade options (${left} left)` : 'Reroll limit reached';
      if (left <= 0) btn.classList.add('disabled'); else btn.classList.remove('disabled');
      btn.textContent = left > 0 ? `Reroll (${left} left)` : 'Reroll (0 left)';
    }
  }

  /** Apply the selected upgrade and hide panel. */
  private applyUpgrade(index: number): void {
    const chosen = this.options[index];
    if (!chosen) return;

    if (chosen.type === 'weapon') {
      const weaponType = chosen.id as WeaponType;
      const beforeLevel = this.player.activeWeapons.get(weaponType) || 0;
      this.player.addWeapon(weaponType);
      const afterLevel = this.player.activeWeapons.get(weaponType) || 0;
      void beforeLevel; void afterLevel; // reserved for telemetry
    } else if (chosen.type === 'passive') {
      const passiveSpec = PASSIVE_SPECS.find(ps => ps.id === chosen.id);
      if (passiveSpec) this.player.addPassive(passiveSpec.name);
    } else if (chosen.type === 'buff') {
      // Apply lightweight permanent buffs when all upgrades are exhausted
      switch (chosen.id) {
        case -1001: // Damage +10%
          (this.player as any).globalDamageMultiplier = Math.max(0, ((this.player as any).globalDamageMultiplier || 1) * 1.10);
          break;
        case -1002: // Attack Speed +10%
          this.player.attackSpeed = Math.max(0.05, (this.player.attackSpeed || 1) * 1.10);
          break;
        case -1003: // Max HP +10 (and heal +10, capped)
          this.player.maxHp = Math.max(1, Math.round((this.player.maxHp || 0) + 10));
          this.player.hp = Math.min(this.player.maxHp, Math.round((this.player.hp || 0) + 10));
          break;
        default:
          break;
      }
    }

    try { window.dispatchEvent(new CustomEvent('playerUpgraded')); } catch {}
    this.hide();
    if (this.game && typeof this.game.setState === 'function') this.game.setState('GAME');
  }

  /** Fisher-Yates shuffle */
  private shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Generates upgrade options for the panel, strictly enforcing:
   * 1. Option 1: Evolution if available; otherwise class weapon or random weapon; else passive; else skip.
   * 2. Option 2: Prefer passive; else weapon; else skip.
   * 3. Option 3: Unique random from remaining pools; else skip.
   */
  public generateOptions(): UpgradeOption[] {
    const options: UpgradeOption[] = [];

  // Precompute which evolved weapons are actually available right now
  const availableEvolutions = this.getAvailableEvolutions();
  const evolvedTargets = this.getEvolvedTargetSet();

    // Only allow non-class weapons and the player's own class weapon
    const playerClassWeapon = this.player.characterData?.defaultWeapon;
  const allowedWeaponTypes: WeaponType[] = Object.keys(WEAPON_SPECS)
      .map(wt => Number(wt))
      .filter(wt => {
        const spec = WEAPON_SPECS[wt as WeaponType];
        if (!spec) return false;
        if (spec.disabled) return false;
        // Allow only player's class weapon among class-only weapons; include all non-class weapons
        if (spec.isClassWeapon && playerClassWeapon !== wt) return false;
    // Do not include evolved weapons in general pool unless prerequisites are met right now
    if (evolvedTargets.has(wt as WeaponType) && !availableEvolutions.includes(wt as WeaponType)) return false;
        // If this base weapon has an evolution and the player already owns the evolved weapon, do not offer the base again
        if (spec.evolution) {
          const evolvedOwned = (this.player.activeWeapons.get(spec.evolution.evolvedWeaponType) || 0) > 0;
          if (evolvedOwned) return false;
        }
        // Hide if already at max level
        const curLv = this.player.activeWeapons.get(wt as WeaponType) || 0;
        const maxLv = spec.maxLevel || 1;
        return curLv < maxLv;
      }) as unknown as WeaponType[];

  // Evolutions immediately available (already computed above)

    // Build randomized pools
    // Capacity-aware filtering
    const MAX_WEAPONS = 5;
    const MAX_PASSIVES = 5;
    const haveWeapons = this.player.activeWeapons.size;
    const havePassives = this.player.activePassives.length;

  // Build weapon pool with capacity constraints: when at cap, only upgrades to owned weapons
  // and immediately-available evolutions (which replace base) are allowed.
    let weaponPool: WeaponType[] = allowedWeaponTypes.slice();
    if (haveWeapons >= MAX_WEAPONS) {
      const evolvedTargets = this.getEvolvedTargetSet();
      const evolvables = new Set(this.getAvailableEvolutions());
      weaponPool = weaponPool.filter(wt => {
        const owned = this.player.activeWeapons.has(wt);
        const isEvolvedAndReady = evolvedTargets.has(wt) && evolvables.has(wt);
        return owned || isEvolvedAndReady; // no brand-new base weapons at cap
      });
    }
    weaponPool = this.shuffle(weaponPool);

    // Build passive pool with capacity constraints: when at cap, only upgrades to owned passives allowed
    const passivePool: number[] = this.shuffle(
      PASSIVE_SPECS
        .filter(p => {
          // In Last Stand, Magnet has no use—remove it from shop offerings
          if (this.game && this.game.gameMode === 'LAST_STAND' && p.name === 'Magnet') return false;
          const existing = this.player.activePassives.find(ap => ap.type === p.name);
          if (havePassives >= MAX_PASSIVES) {
            // At cap: only include if already owned and not maxed
            return !!existing && existing.level < p.maxLevel;
          }
          // Below cap: include new unlocks or upgrades if not maxed
          return !existing || existing.level < p.maxLevel;
        })
        .map(p => p.id)
    );

    // If no weapons/passives/evolutions are available, return Buff choices instead of Skip
    const noUpgrades = (weaponPool.length === 0) && (passivePool.length === 0) && (availableEvolutions.length === 0);
    if (noUpgrades) {
      return [
        { type: 'buff', id: -1001, name: 'Damage +10%', description: 'Permanent +10% global damage', icon: '' },
        { type: 'buff', id: -1002, name: 'Attack Speed +10%', description: 'Permanent +10% attack speed', icon: '' },
        { type: 'buff', id: -1003, name: 'Max HP +10', description: 'Increase max HP by 10 and heal for 10', icon: '' }
      ];
    }

    // Ensure options are unique by (type:id)
    const used = new Set<string>();
    const pushUnique = (opt: UpgradeOption | null | undefined): boolean => {
      if (!opt) return false;
      const key = `${opt.type}:${opt.id}`;
      if (used.has(key)) return false;
      used.add(key);
      options.push(opt);
      return true;
    };

    // Slot 1: Evolution > (class OR other weapon) > passive > skip
    let picked = false;
    if (availableEvolutions.length) {
      picked = pushUnique(this.makeWeaponOption(availableEvolutions[0]));
    }
    if (!picked) {
      // Evaluate class weapon eligibility
      let classEligible = false;
      let classOption: UpgradeOption | null = null;
      if (typeof playerClassWeapon === 'number') {
        const classSpec = WEAPON_SPECS[playerClassWeapon as WeaponType];
        const cur = this.player.activeWeapons.get(playerClassWeapon as WeaponType) || 0;
        const evoOwned = classSpec && classSpec.evolution ? ((this.player.activeWeapons.get(classSpec.evolution.evolvedWeaponType) || 0) > 0) : false;
        const canOfferNew = this.player.activeWeapons.size < MAX_WEAPONS || this.player.activeWeapons.has(playerClassWeapon as WeaponType);
        classEligible = !!(classSpec && !evoOwned && cur < (classSpec.maxLevel || 1) && canOfferNew);
        if (classEligible) classOption = this.makeWeaponOption(playerClassWeapon as WeaponType);
      }
      // Find a non-class additional weapon candidate from the pool (already shuffled)
      let otherIdx = weaponPool.findIndex(wt => wt !== (playerClassWeapon as WeaponType));
      let otherOption: UpgradeOption | null = null;
      if (otherIdx >= 0) {
        otherOption = this.makeWeaponOption(weaponPool[otherIdx] as WeaponType);
        // If the constructed option was rejected (e.g., disabled/evolved-gated), try subsequent entries
        if (!otherOption) {
          for (let i = otherIdx + 1; i < weaponPool.length; i++) {
            if (weaponPool[i] === (playerClassWeapon as WeaponType)) continue;
            const opt = this.makeWeaponOption(weaponPool[i] as WeaponType);
            if (opt) { otherIdx = i; otherOption = opt; break; }
          }
          if (!otherOption) otherIdx = -1;
        }
      }
      // Decide which to pick: class or other additional weapon
      if (classOption && otherOption) {
        const pickClass = Math.random() < 0.5;
        const chosen = pickClass ? classOption : otherOption;
        picked = pushUnique(chosen);
        // If we consumed an entry from weaponPool (otherOption), remove it to avoid duplication later
        if (!pickClass && otherIdx >= 0) weaponPool.splice(otherIdx, 1);
      } else if (classOption) {
        picked = pushUnique(classOption);
      } else if (otherOption) {
        picked = pushUnique(otherOption);
        if (otherIdx >= 0) weaponPool.splice(otherIdx, 1);
      }
    }
    if (!picked) {
      // Fallbacks
      while (weaponPool.length && !picked) {
        picked = pushUnique(this.makeWeaponOption(weaponPool.shift() as WeaponType));
      }
    }
    if (!picked) {
      if (passivePool.length) picked = pushUnique(this.makePassiveOption(passivePool.shift()!));
    }
    if (!picked) {
      pushUnique({ type: 'skip', id: -1, name: 'Skip', description: 'Skip upgrades this time', icon: '' });
    }

    // Slot 2: Passive > weapon > skip
    picked = false;
    while (passivePool.length && !picked) picked = pushUnique(this.makePassiveOption(passivePool.shift()!));
    if (!picked) while (weaponPool.length && !picked) picked = pushUnique(this.makeWeaponOption(weaponPool.shift() as WeaponType));
    if (!picked) pushUnique({ type: 'skip', id: -2, name: 'Skip', description: 'Skip upgrades this time', icon: '' });

    // Slot 3: Unique random remaining; prefer variety
    picked = false;
    const tryPassiveFirst = Math.random() < 0.5;
    if (tryPassiveFirst) {
      while (passivePool.length && !picked) picked = pushUnique(this.makePassiveOption(passivePool.shift()!));
    }
    while (weaponPool.length && !picked) picked = pushUnique(this.makeWeaponOption(weaponPool.shift() as WeaponType));
    if (!picked && !tryPassiveFirst) while (passivePool.length && !picked) picked = pushUnique(this.makePassiveOption(passivePool.shift()!));
    if (!picked) pushUnique({ type: 'skip', id: -3, name: 'Skip', description: 'Skip upgrades this time', icon: '' });

    return options;
  }

  /** Return evolved weapon types immediately available based on maxed base + required passive */
  private getAvailableEvolutions(): WeaponType[] {
    const list: WeaponType[] = [];
    for (const [wt, lvl] of this.player.activeWeapons.entries()) {
      const base = WEAPON_SPECS[wt];
      if (!base || !base.evolution) continue;
      const maxLv = base.maxLevel || 1;
      if (lvl < maxLv) continue;
      const evo = base.evolution;
      const evolved = WEAPON_SPECS[evo.evolvedWeaponType];
      if (!evolved || evolved.disabled) continue;
      const already = this.player.activeWeapons.get(evo.evolvedWeaponType) || 0;
      if (already > 0) continue;
  const needLevel = 1; // normalized: only Lv.1 required
  const hasReq = this.player.activePassives.some(p => p.type === evo.requiredPassive && p.level >= needLevel);
      if (hasReq) list.push(evo.evolvedWeaponType);
    }
    return list;
  }

  /** Build weapon option */
  private makeWeaponOption(wt: WeaponType): UpgradeOption | null {
    const spec = WEAPON_SPECS[wt];
    if (!spec || spec.disabled) return null;
    // Block offering evolved weapons unless evolution prerequisites are satisfied right now
    const evolvedTargets = this.getEvolvedTargetSet();
    if (evolvedTargets.has(wt)) {
      const avail = this.getAvailableEvolutions();
      if (!avail.includes(wt)) return null;
    }
    const curLv = this.player.activeWeapons.get(wt) || 0;
    return {
      type: 'weapon',
      id: wt,
      name: spec.name,
      description: spec.description || (spec.traits ? spec.traits.join(' • ') : 'Weapon upgrade'),
      icon: spec.icon || '',
      currentLevel: curLv
    };
  }

  /** Compute the set of evolved weapon types (targets of any base evolution). */
  private getEvolvedTargetSet(): Set<WeaponType> {
    const set = new Set<WeaponType>();
    try {
      for (const key of Object.keys(WEAPON_SPECS)) {
        const spec = (WEAPON_SPECS as any)[key];
        const evo = spec && spec.evolution;
        if (evo && typeof evo.evolvedWeaponType === 'number') {
          set.add(evo.evolvedWeaponType as WeaponType);
        }
      }
    } catch { /* ignore */ }
    return set;
  }

  /** Build passive option */
  private makePassiveOption(pid: number): UpgradeOption | null {
    const p = PASSIVE_SPECS.find(x => x.id === pid);
    if (!p) return null;
    const existing = this.player.activePassives.find(ap => ap.type === p.name);
    return {
      type: 'passive',
      id: pid,
      name: p.name,
      description: p.description || 'Passive bonus',
      icon: p.icon || '',
      currentLevel: existing ? existing.level : 0
    };
  }

  /** Uniformly scale the panel to keep the fixed 3-column layout consistent */
  private applyScale(): void {
    if (!this.panelElement) return;
    const baseWidth = 1440;
    const w = Math.max(640, Math.min(window.innerWidth || baseWidth, 3840));
    const scale = Math.max(0.6, Math.min(1.15, w / baseWidth));
    const el = this.panelElement.querySelector('.upgrade-panel') as HTMLElement | null;
    if (!el) return;
    el.style.setProperty('--panel-scale', String(scale));
    el.style.transformOrigin = 'center center';
  }
}
