import { WEAPON_SPECS } from '../game/WeaponConfig';
import { WeaponType } from '../game/WeaponType';
import { PASSIVE_SPECS } from '../game/PassiveConfig';

/** Ensures a single SandboxOverlay instance; returns it. */
export function ensureSandboxOverlay(game: any): SandboxOverlay {
  const existing = (window as any).__sandboxOverlay as SandboxOverlay | undefined;
  if (existing) { existing.bindGame(game); return existing; }
  const created = new SandboxOverlay(game);
  (window as any).__sandboxOverlay = created;
  return created;
}

export class SandboxOverlay {
  private root: HTMLElement;
  private bg: HTMLElement; // grid background layer
  private open: boolean = false;
  private game: any;
  private autoApplyTimer: number | undefined;

  constructor(game: any) {
    this.game = game;
    this.bg = this.createBackground();
    this.root = this.createUI();
    document.body.appendChild(this.bg);
    document.body.appendChild(this.root);
    this.hide();
  }

  bindGame(game: any) { this.game = game; }

  // Expose open state for UI bindings
  isOpen(): boolean { return this.open; }
  // Convenience toggle for keybinds
  toggle() { this.open ? this.hide() : this.show(); }

  private createBackground(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'sandbox-bg-grid';
    el.style.position = 'fixed';
    el.style.inset = '0';
  el.style.zIndex = '5'; // below canvas (10), below overlay (20)
    el.style.pointerEvents = 'none';
  // Default hidden to reduce overdraw; can be toggled via BG button
  el.style.display = 'none';
    el.style.background = `radial-gradient(circle at 50% 45%, rgba(0,15,20,0.9), rgba(0,0,0,0.95) 60%),
      linear-gradient(transparent 23px, rgba(0,255,255,0.06) 24px),
      linear-gradient(90deg, transparent 23px, rgba(0,255,255,0.06) 24px)`;
    el.style.backgroundSize = 'auto, 24px 24px, 24px 24px';
    return el;
  }

  private createUI(): HTMLElement {
    const panel = document.createElement('div');
  // Set root early so helper methods can safely query within it
  this.root = panel;
    panel.id = 'sandbox-overlay';
    panel.style.position = 'fixed';
    panel.style.top = '10px';
    panel.style.right = '10px';
    panel.style.width = '360px';
    panel.style.maxHeight = '92vh';
    panel.style.overflow = 'auto';
    panel.style.zIndex = '20';
    panel.style.border = '1px solid rgba(0,255,255,0.35)';
    panel.style.background = 'rgba(0,25,38,0.72)';
    panel.style.backdropFilter = 'blur(6px)';
    panel.style.padding = '10px';
    panel.style.font = '12px Orbitron, sans-serif';
    panel.style.color = '#b8faff';
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="font-weight:700;color:#5EEBFF;text-shadow:0 0 6px #0ff">SANDBOX</div>
        <div style="display:flex;gap:6px">
          <button id="sb-change-op" class="btn sm">OPERATIVE</button>
          <button id="sb-toggle-bg" class="btn sm">BG</button>
          <button id="sb-close" class="btn sm">×</button>
        </div>
      </div>
      <style>
        #sandbox-overlay .btn{padding:4px 8px;border:1px solid rgba(0,255,255,0.4);background:rgba(0,60,80,0.5);color:#b8faff;border-radius:4px;cursor:pointer}
        #sandbox-overlay .btn.sm{font-size:11px;padding:3px 6px}
        #sandbox-overlay .row{display:flex;gap:6px;align-items:center;margin:6px 0}
        #sandbox-overlay select,#sandbox-overlay input[type=number]{background:rgba(0,25,38,0.9);color:#b8faff;border:1px solid rgba(0,255,255,0.35);border-radius:4px;padding:3px 6px}
        #sandbox-overlay .section{border-top:1px solid rgba(0,255,255,0.2);margin-top:8px;padding-top:6px}
        #sandbox-overlay .mini{font-size:11px;opacity:0.9}
  #sandbox-overlay .grid{display:grid;grid-template-columns:1fr auto auto auto auto;gap:4px;align-items:center}
        #sandbox-overlay .hdr{font-weight:700;color:#5EEBFF;margin:4px 0 2px}
      </style>

      <div class="section">
        <div class="hdr">Targets</div>
        <div class="row">
          <button id="sb-spawn-1" class="btn">Spawn 1</button>
          <button id="sb-spawn-5" class="btn">Spawn 5</button>
          <button id="sb-spawn-all-types" class="btn">All Types</button>
          <button id="sb-clear" class="btn">Clear</button>
        </div>
      </div>

      <div class="section">
        <div class="hdr">Special Items</div>
        <div class="row" style="justify-content:space-between">
          <button id="sb-item-heal" class="btn">Spawn HEAL</button>
          <button id="sb-item-magnet" class="btn">Spawn MAGNET</button>
          <button id="sb-item-nuke" class="btn">Spawn NUKE</button>
        </div>
  <div class="mini" style="margin-top:4px;opacity:0.8">Items spawn on the fixed pad (does not follow the operative).</div>
      </div>

      <div class="section">
        <div class="hdr">Items Test Tools</div>
        <div class="row" style="flex-wrap:wrap;gap:6px">
          <button id="sb-xp-scatter" class="btn">Scatter 30 XP (View)</button>
          <button id="sb-xp-clear" class="btn">Clear XP (View)</button>
          <button id="sb-hurt-self" class="btn">Hurt Self 30%</button>
          <button id="sb-enemies-view" class="btn">Spawn 10 Enemies (View)</button>
          <button id="sb-clear-view" class="btn">Clear Enemies (View)</button>
        </div>
      </div>

      <div class="section">
        <div class="hdr">Boss</div>
        <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:space-between">
          <button id="sb-spawn-boss" class="btn">Spawn Boss (← 500px)</button>
        </div>
        <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:space-between">
          <button id="sb-boss-1" class="btn sm" title="Alpha — balanced">Boss 1</button>
          <button id="sb-boss-2" class="btn sm" title="Beta — nova">Boss 2</button>
          <button id="sb-boss-3" class="btn sm" title="Gamma — summoner">Boss 3</button>
          <button id="sb-boss-4" class="btn sm" title="Omega — dasher">Boss 4</button>
        </div>
        <div class="mini" style="margin-top:4px;opacity:0.8">Spawns identical to game rules, positioned 500px left of the operative.</div>
      </div>

      <div class="section">
        <div class="hdr">Elites</div>
        <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:space-between">
          <button id="sb-elite-dasher" class="btn">Spawn Dasher (← 380px)</button>
          <button id="sb-elite-gunner" class="btn">Spawn Gunner (← 380px)</button>
          <button id="sb-elite-suppressor" class="btn">Spawn Suppressor (← 380px)</button>
          <button id="sb-elite-bomber" class="btn">Spawn Bomber (← 380px)</button>
          <button id="sb-elite-blinker" class="btn">Spawn Blinker (← 380px)</button>
          <button id="sb-elite-blocker" class="btn">Spawn Blocker (← 380px)</button>
          <button id="sb-elite-siphon" class="btn">Spawn Siphon (← 380px)</button>
        </div>
        <div class="mini" style="margin-top:4px;opacity:0.8">Spawns near the operative; use Clear Enemies (View) to remove.</div>
      </div>

      <div class="section">
        <div class="hdr">Weapons</div>
        <div id="sb-weapons" class="grid"></div>
        <div class="row" style="justify-content:flex-end;margin-top:6px">
          <button id="sb-apply-weapons" class="btn">Apply Weapons</button>
        </div>
      </div>

      <div class="section">
        <div class="hdr">Passives</div>
        <div id="sb-passives" class="grid"></div>
        <div class="row" style="justify-content:flex-end;margin-top:6px">
          <button id="sb-apply-passives" class="btn">Apply Passives</button>
        </div>
      </div>

      <div class="section">
        <div class="row" style="justify-content:space-between">
          <button id="sb-reset-all" class="btn">Full Reset</button>
          <button id="sb-apply-all" class="btn">Apply All</button>
        </div>
        <div class="mini" style="margin-top:4px;opacity:0.8">Apply resets the player and re-adds your selections.</div>
      </div>
    `;

    // Wire basic actions
    panel.querySelector('#sb-close')?.addEventListener('click', () => this.hide());
    panel.querySelector('#sb-toggle-bg')?.addEventListener('click', () => this.toggleBg());
    panel.querySelector('#sb-change-op')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('showCharacterSelect'));
    });
    panel.querySelector('#sb-spawn-1')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxSpawnDummy', { detail: { count: 1, radius: 32, hp: 5000 } }));
    });
    panel.querySelector('#sb-spawn-5')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxSpawnDummy', { detail: { count: 5, radius: 32, hp: 5000 } }));
    });
    panel.querySelector('#sb-spawn-all-types')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxSpawnAllTypes'));
    });
    panel.querySelector('#sb-clear')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxClearDummies'));
    });

    // Special Item spawners (spawn at designated pad above the player)
    const spawnAtPad = (type: 'HEAL' | 'MAGNET' | 'NUKE') => {
      const pos = this.getSpawnPadPosition();
      window.dispatchEvent(new CustomEvent('spawnSpecialItem', { detail: { x: pos.x, y: pos.y, type } }));
    };
    panel.querySelector('#sb-item-heal')?.addEventListener('click', () => spawnAtPad('HEAL'));
    panel.querySelector('#sb-item-magnet')?.addEventListener('click', () => spawnAtPad('MAGNET'));
    panel.querySelector('#sb-item-nuke')?.addEventListener('click', () => spawnAtPad('NUKE'));

    // Build weapons and passives grids
    this.populateWeapons();
    this.populatePassives();
  // Initial sync from current player state if available
  this.syncFromPlayer();

    // Auto-apply on any input change (weapons or passives)
    const onInput = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // Only react to our numeric level inputs
      if (t.matches?.('#sb-weapons input[data-weapon],#sb-passives input[data-passive]')) {
        this.scheduleAutoApply();
      }
    };
    panel.addEventListener('input', onInput);

  panel.querySelector('#sb-apply-weapons')?.addEventListener('click', () => this.applyWeaponsOnly());
  panel.querySelector('#sb-apply-passives')?.addEventListener('click', () => this.applyPassivesOnly());
    panel.querySelector('#sb-reset-all')?.addEventListener('click', () => { this.resetPlayerOnly(); });
    panel.querySelector('#sb-apply-all')?.addEventListener('click', () => this.applyAll());

    // Items test tool actions
    panel.querySelector('#sb-xp-scatter')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxScatterGems', { detail: { count: 30, area: 'view' } }));
    });
    panel.querySelector('#sb-xp-clear')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxClearGemsInView'));
    });
    panel.querySelector('#sb-hurt-self')?.addEventListener('click', () => {
      try {
        const p = this.game?.player;
        if (p) { p.hp = Math.max(1, Math.round(p.hp - p.maxHp * 0.30)); }
      } catch {}
    });
    panel.querySelector('#sb-enemies-view')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxSpawnViewEnemies', { detail: { count: 10, radius: 28, hp: 2000 } }));
    });
    panel.querySelector('#sb-clear-view')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('sandboxClearViewEnemies'));
    });

    // Boss spawn (Sandbox)
    panel.querySelector('#sb-spawn-boss')?.addEventListener('click', () => {
      try {
        const px = this.game?.player?.x ?? 0;
        const py = this.game?.player?.y ?? 0;
        window.dispatchEvent(new CustomEvent('sandboxSpawnBoss', { detail: { x: px - 500, y: py, cinematic: false } }));
      } catch {}
    });
    const spawnSpecific = (id: string) => {
      try {
        const px = this.game?.player?.x ?? 0;
        const py = this.game?.player?.y ?? 0;
        window.dispatchEvent(new CustomEvent('sandboxSpawnBoss', { detail: { x: px - 500, y: py, cinematic: false, id } }));
      } catch {}
    };
    panel.querySelector('#sb-boss-1')?.addEventListener('click', () => spawnSpecific('alpha'));
    panel.querySelector('#sb-boss-2')?.addEventListener('click', () => spawnSpecific('beta'));
    panel.querySelector('#sb-boss-3')?.addEventListener('click', () => spawnSpecific('gamma'));
    panel.querySelector('#sb-boss-4')?.addEventListener('click', () => spawnSpecific('omega'));

    // Elite spawns (Sandbox)
  const spawnElite = (kind: 'DASHER'|'GUNNER'|'SUPPRESSOR'|'BOMBER'|'BLINKER'|'BLOCKER'|'SIPHON') => {
      try {
        const px = this.game?.player?.x ?? 0;
        const py = this.game?.player?.y ?? 0;
        // Default angle: left of player (pi radians), distance ~380px
        window.dispatchEvent(new CustomEvent('sandboxSpawnElite', { detail: { kind, x: px - 380, y: py, angle: Math.PI, dist: 380 } }));
      } catch {}
    };
    panel.querySelector('#sb-elite-dasher')?.addEventListener('click', () => spawnElite('DASHER'));
    panel.querySelector('#sb-elite-gunner')?.addEventListener('click', () => spawnElite('GUNNER'));
    panel.querySelector('#sb-elite-suppressor')?.addEventListener('click', () => spawnElite('SUPPRESSOR'));
  panel.querySelector('#sb-elite-bomber')?.addEventListener('click', () => spawnElite('BOMBER'));
  panel.querySelector('#sb-elite-blinker')?.addEventListener('click', () => spawnElite('BLINKER'));
  panel.querySelector('#sb-elite-blocker')?.addEventListener('click', () => spawnElite('BLOCKER'));
  panel.querySelector('#sb-elite-siphon')?.addEventListener('click', () => spawnElite('SIPHON'));

    return panel;
  }

  /** World-space position of the sandbox spawn pad (fixed; seeded on first show). */
  private getSpawnPadPosition(): { x: number; y: number } {
    try {
      const g: any = window as any;
      if (g.__sandboxPad && Number.isFinite(g.__sandboxPad.x) && Number.isFinite(g.__sandboxPad.y)) {
        return g.__sandboxPad;
      }
      const px = this.game?.player?.x ?? 0;
      const py = this.game?.player?.y ?? 0;
      g.__sandboxPad = { x: px, y: py - 140 };
      return g.__sandboxPad;
    } catch {
      return { x: 0, y: -140 };
    }
  }

  private populateWeapons() {
    const container = this.root.querySelector('#sb-weapons') as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '';
    // Use generic string keys from Object.entries; at runtime these are numeric enum keys as strings
    const entries = Object.entries(WEAPON_SPECS) as Array<[string, any]>;
    // Precompute set of evolved weapon type keys so we can clamp them to level 1
    const evolvedSet = new Set<string>();
    for (const [k, spec] of entries) {
      if (spec && spec.evolution && typeof spec.evolution.evolvedWeaponType === 'number') {
        evolvedSet.add(String(spec.evolution.evolvedWeaponType));
      }
    }
    for (let i=0;i<entries.length;i++) {
      const [key, spec] = entries[i];
      // Clamp evolved weapons to a single level (evolutions are always only 1 level)
      const isEvolved = evolvedSet.has(String(key));
      const max = isEvolved ? 1 : Math.max(1, spec?.maxLevel ?? 7);
      const row = document.createElement('div');
      row.className = 'row';
      row.style.display = 'contents';
      const label = document.createElement('div');
      label.textContent = spec?.name || String(key);
      const level = document.createElement('input');
      level.type = 'number';
      level.min = '0';
      level.max = String(max);
      level.value = '0';
      level.setAttribute('data-weapon', String(key));
      // Minus button
      const minusBtn = document.createElement('button');
      minusBtn.className = 'btn sm';
      minusBtn.textContent = '−';
      minusBtn.addEventListener('click', () => {
        const maxVal = parseInt(level.max || '0', 10) || 0;
        const cur = Math.max(0, Math.min(parseInt(level.value||'0',10)||0, maxVal));
        const next = Math.max(0, cur - 1);
        if (next !== cur) { level.value = String(next); this.scheduleAutoApply(); }
      });
      // Plus button
      const plusBtn = document.createElement('button');
      plusBtn.className = 'btn sm';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => {
        const maxVal = parseInt(level.max || '0', 10) || 0;
        const cur = Math.max(0, Math.min(parseInt(level.value||'0',10)||0, maxVal));
        const next = Math.min(maxVal, cur + 1);
        if (next !== cur) { level.value = String(next); this.scheduleAutoApply(); }
      });
      // Apply button (kept for explicit apply of this row)
      const addBtn = document.createElement('button');
      addBtn.className = 'btn sm';
      addBtn.textContent = 'Lv';
      addBtn.addEventListener('click', () => { this.scheduleAutoApply(); });
      container.appendChild(label);
      container.appendChild(level);
      container.appendChild(minusBtn);
      container.appendChild(plusBtn);
      container.appendChild(addBtn);
    }
  }

  private populatePassives() {
    const container = this.root.querySelector('#sb-passives') as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '';
    for (let i=0;i<PASSIVE_SPECS.length;i++) {
      const p = PASSIVE_SPECS[i];
      const label = document.createElement('div');
      label.textContent = p.name;
      const level = document.createElement('input');
      level.type = 'number';
      level.min = '0';
      level.max = String(p.maxLevel ?? 7);
      level.value = '0';
      level.setAttribute('data-passive', p.name);
      // Minus button
      const minusBtn = document.createElement('button');
      minusBtn.className = 'btn sm';
      minusBtn.textContent = '−';
      minusBtn.addEventListener('click', () => {
        const maxVal = parseInt(level.max || '0', 10) || 0;
        const cur = Math.max(0, Math.min(parseInt(level.value||'0',10)||0, maxVal));
        const next = Math.max(0, cur - 1);
        if (next !== cur) { level.value = String(next); this.scheduleAutoApply(); }
      });
      // Plus button
      const plusBtn = document.createElement('button');
      plusBtn.className = 'btn sm';
      plusBtn.textContent = '+';
      plusBtn.addEventListener('click', () => {
        const maxVal = parseInt(level.max || '0', 10) || 0;
        const cur = Math.max(0, Math.min(parseInt(level.value||'0',10)||0, maxVal));
        const next = Math.min(maxVal, cur + 1);
        if (next !== cur) { level.value = String(next); this.scheduleAutoApply(); }
      });
      // Apply button
      const addBtn = document.createElement('button');
      addBtn.className = 'btn sm';
      addBtn.textContent = 'Lv';
      addBtn.addEventListener('click', () => { this.scheduleAutoApply(); });
      container.appendChild(label);
      container.appendChild(level);
      container.appendChild(minusBtn);
      container.appendChild(plusBtn);
      container.appendChild(addBtn);
    }
  }

  private collectWeaponLoadout(): Array<{ type: WeaponType, level: number }> {
    const list: Array<{type: WeaponType, level: number}> = [];
    const inputs = this.root.querySelectorAll('#sb-weapons input[data-weapon]') as NodeListOf<HTMLInputElement>;
    // Compute evolved types set for extra safety (inputs already clamp but double-guard collection)
    const evolvedSet = new Set<string>();
    const entries = Object.entries(WEAPON_SPECS) as Array<[string, any]>;
    for (let i=0;i<entries.length;i++) {
      const [k, spec] = entries[i];
      if (spec && spec.evolution && typeof spec.evolution.evolvedWeaponType === 'number') {
        evolvedSet.add(String(spec.evolution.evolvedWeaponType));
      }
    }
    inputs.forEach(inp => {
      const keyStr = inp.getAttribute('data-weapon');
      if (!keyStr) return;
      const typeNum = Number(keyStr);
      const type = typeNum as WeaponType;
      const spec = (WEAPON_SPECS as any)[typeNum];
      const isEvolved = evolvedSet.has(String(keyStr));
      const maxLvl = isEvolved ? 1 : Math.max(1, spec?.maxLevel ?? 7);
      const lvl = Math.max(0, Math.min(parseInt(inp.value||'0',10)||0, maxLvl));
      if (!Number.isNaN(typeNum) && lvl > 0) list.push({ type, level: lvl });
    });
    return list.slice(0, 5); // enforce max 5 weapons
  }

  private collectPassives(): Array<{ name: string, level: number }> {
    const list: Array<{ name: string, level: number }> = [];
    const inputs = this.root.querySelectorAll('#sb-passives input[data-passive]') as NodeListOf<HTMLInputElement>;
    inputs.forEach(inp => {
      const name = inp.getAttribute('data-passive') || '';
      const spec = PASSIVE_SPECS.find(p => p.name === name);
      if (!spec) return;
      const lvl = Math.max(0, Math.min(parseInt(inp.value||'0',10)||0, spec.maxLevel ?? 7));
      if (lvl > 0) list.push({ name, level: lvl });
    });
    // Respect max passive slots (5)
    return list.slice(0, 5);
  }

  private resetPlayerOnly() {
    if (!this.game?.player) return;
    this.game.player.resetState();
  }

  private applyWeaponsOnly() {
    const weapons = this.collectWeaponLoadout();
    if (!this.game?.player) return;
    // Reset first to avoid mixed states
    this.game.player.resetState();
    // ResetState re-adds the class default weapon; clear to make UI the single source of truth
    if (this.game.player.activeWeapons && typeof this.game.player.activeWeapons.clear === 'function') {
      this.game.player.activeWeapons.clear();
    }
    for (let i=0;i<weapons.length;i++) {
      const w = weapons[i];
      for (let l=0;l<w.level;l++) this.game.player.addWeapon(w.type);
    }
  this.syncFromPlayer();
  }

  private applyPassivesOnly() {
    const pass = this.collectPassives();
    if (!this.game?.player) return;
    // Keep current weapons; add passives up to requested levels
    for (let i=0;i<pass.length;i++) {
      const p = pass[i];
      for (let l=0;l<p.level;l++) this.game.player.addPassive(p.name);
    }
  this.syncFromPlayer();
  }

  private applyAll() {
    const weapons = this.collectWeaponLoadout();
    const pass = this.collectPassives();
    if (!this.game?.player) return;
    this.game.player.resetState();
    // Prevent double-adding the class default weapon when applying from UI
    if (this.game.player.activeWeapons && typeof this.game.player.activeWeapons.clear === 'function') {
      this.game.player.activeWeapons.clear();
    }
    for (let i=0;i<weapons.length;i++) {
      const w = weapons[i];
      for (let l=0;l<w.level;l++) this.game.player.addWeapon(w.type);
    }
    for (let i=0;i<pass.length;i++) {
      const p = pass[i];
      for (let l=0;l<p.level;l++) this.game.player.addPassive(p.name);
    }
  this.syncFromPlayer();
  }

  /** Debounced auto-apply to avoid excessive resets while editing. */
  private scheduleAutoApply(delayMs: number = 100) {
    if (this.autoApplyTimer !== undefined) {
      clearTimeout(this.autoApplyTimer);
    }
    this.autoApplyTimer = window.setTimeout(() => {
      this.autoApplyTimer = undefined;
      this.applyAll();
    }, delayMs);
  }

  show() {
    this.open = true;
    this.root.style.display = 'block';
    this.bg.style.display = 'block';
    // Re-seed fixed spawn pad each time sandbox overlay is shown so it is always near the current operative
    try {
      const g: any = window as any;
      const px = this.game?.player?.x ?? 0;
      const py = this.game?.player?.y ?? 0;
      g.__sandboxPad = { x: px, y: py - 140 };
    } catch {}
  // Reflect current applied levels whenever shown
  this.syncFromPlayer();
    // Spawn a few targets to get started
    try {
      window.dispatchEvent(new CustomEvent('sandboxSpawnDummy', { detail: { count: 3, radius: 32, hp: 5000 } }));
    } catch {}
  }
  hide() {
    this.open = false;
    this.root.style.display = 'none';
    this.bg.style.display = 'none';
  }
  toggleBg() {
    const vis = this.bg.style.display !== 'none';
    this.bg.style.display = vis ? 'none' : 'block';
  }

  /** Synchronize selector inputs to match the player's currently applied loadout. */
  private syncFromPlayer() {
    try {
      const player = this.game?.player;
      // Weapons: zero all, then set active ones
      const wInputs = this.root.querySelectorAll('#sb-weapons input[data-weapon]') as NodeListOf<HTMLInputElement>;
      wInputs.forEach(inp => { inp.value = '0'; });
      if (player?.activeWeapons && player.activeWeapons.size) {
        for (const [wt, lvl] of player.activeWeapons as Map<number, number>) {
          const inp = this.root.querySelector(`#sb-weapons input[data-weapon="${String(wt)}"]`) as HTMLInputElement | null;
          if (inp) {
            const maxVal = parseInt(inp.max || '0', 10) || 0;
            const setLvl = Math.max(0, Math.min(lvl || 0, maxVal));
            inp.value = String(setLvl);
          }
        }
      }
      // Passives: zero all, then set levels
      const pInputs = this.root.querySelectorAll('#sb-passives input[data-passive]') as NodeListOf<HTMLInputElement>;
      pInputs.forEach(inp => { inp.value = '0'; });
      if (player?.activePassives && player.activePassives.length) {
        for (let i=0;i<player.activePassives.length;i++) {
          const ap = player.activePassives[i];
          const inp = this.root.querySelector(`#sb-passives input[data-passive="${ap.type}"]`) as HTMLInputElement | null;
          if (inp) {
            const maxVal = parseInt(inp.max || '0', 10) || 0;
            const setLvl = Math.max(0, Math.min(ap.level || 0, maxVal));
            inp.value = String(setLvl);
          }
        }
      }
    } catch {}
  }
}
