import { WaveManager } from './wave-manager';
import { ShopManager } from './shop-manager';
import { CurrencySystem } from './currency-system';
import { TurretManager } from './turret-manager';
import { eventBus } from '../../core/EventBus';
import { LastStandHUD } from '../../ui/LastStandHUD';
import { LastStandShopOverlay } from '../../ui/LastStandShopOverlay';
import { CoreEntity } from './core-entity';
import { WeaponType } from '../../game/WeaponType';
import { ensureWaveWarningOverlay } from '../../ui/WaveWarningOverlay';

type Phase = 'COMBAT'|'SHOP';

export class LastStandGameMode {
  private phase: Phase = 'COMBAT';
  private wave = new WaveManager();
  private shop = new ShopManager();
  private currency = new CurrencySystem();
  private turrets = new TurretManager();
  private hud = new LastStandHUD();
  private overlay!: LastStandShopOverlay;
  private shopEndsAtMs = 0;
  private shopSkippableUsed = false;
  private skipEl: HTMLDivElement | null = null;
  private core!: CoreEntity;
  private onCompleteHooked = false;
  private corridor: { x:number; y:number; w:number; h:number } | null = null;
  private pads: Array<{x:number;y:number;r:number;occupied?:boolean}> = [];
  private palisades: Array<{x:number;y:number;w:number;h:number}> = [];
  // New: fixed turret holders (blocking tiles) and state
  private holders: Array<{x:number;y:number;w:number;h:number; turretId?:string; level?:number; turretRef?: any}> = [];
  private holderUiEl: HTMLDivElement | null = null;
  // Holder the inline shop is currently associated with (for step-away auto-close)
  private holderUiFor: {x:number;y:number;w:number;h:number; turretId?:string; level?:number; turretRef?: any} | null = null;
  private hasFlashlight: boolean = false;
  private skipRect: { x:number; y:number; w:number; h:number } | null = null;
  // Event handlers so we can clean up on dispose
  private placeTurretHandler?: (e: Event) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;

  constructor(private game: any){
    this.hud.show(); this.hud.setPhase('COMBAT');
    this.currency.onChange(v => this.hud.setScrap(v));
  // Kick off LS asset preloading in background ASAP to avoid first-visibility stalls
  try { setTimeout(() => { this.preloadAssets().catch(()=>{}); }, 0); } catch {}
    // Earn 1 scrap per kill baseline; decrement alive counter
    eventBus.on('enemyDead', () => {
      // Early-wave economy boost: award extra scrap for first waves
      const wv = this.wave.getCurrentWaveNumber() + 1;
      const bonus = (wv <= 5) ? 1 : 0; // 2 scrap/kill in waves 1-5
      this.currency.add(1 + bonus);
      this.wave.onEnemyDefeated();
  try { this.hud.setEnemiesLeft(this.wave.getEnemiesRemaining()); } catch {}
    });
    // Turret placement via event (store handler for later cleanup)
    this.placeTurretHandler = (e: Event) => {
      const d = (e as CustomEvent).detail || {}; const id = d.turretId || 'turret_gun';
      this.turrets.place(id, this.game.player.x, this.game.player.y);
    };
    window.addEventListener('laststand:placeTurret', this.placeTurretHandler);
  try { (this.game as any).lastStand = this; } catch {}
  }

  /** Preload Last Stand assets aggressively in the background. */
  private async preloadAssets() {
    try {
      const al: any = this.game?.assetLoader;
      if (!al) return;
      // Ensure manifest is available, then queue a full image warm-up.
      await al.loadManifest();
      // 1) Bulk: all manifest-declared images (enemies, players, projectiles, UI, VFX)
      const bulk = al.loadAllFromManifest().catch(() => {});
      // 2) Extras not listed in manifest but used in LS rendering paths
      const extras: string[] = [
        '/assets/core/core_1.png'
      ];
      const extraLoads = extras.map(p => {
        try { return al.loadImage(p); } catch { return Promise.resolve(null as any); }
      });
      // Fire and forget; avoid blocking init or a frame
      Promise.allSettled([bulk, ...extraLoads]).catch(() => {});
    } catch { /* ignore */ }
  }

  // Expose turret manager for renderer (read-only usage)
  public getTurretManager(){ return this.turrets; }
  // Expose geometry for renderer (read-only)
  public get palisadesGeom(){ return this.palisades; }
  public get holdersGeom(){ return this.holders; }
  public get padsGeom(){ return this.pads; }
  public getFlashlight(){ return this.hasFlashlight; }
  public getSkipRect(){ return this.skipRect; }
  /** Waves reached so far (current wave number). Used for LS leaderboards. */
  public getWavesReached(): number { return this.wave.getCurrentWaveNumber(); }
  /** External click handler: returns true if the click triggered a shop skip. */
  public tryClickSkipButton(worldX: number, worldY: number): boolean {
    if (this.phase !== 'SHOP') return false;
    if (this.shopSkippableUsed) return false;
    const h = this.skipRect; if (!h) return false;
    if (worldX >= h.x && worldX <= h.x + h.w && worldY >= h.y && worldY <= h.y + h.h) {
      this.shopSkippableUsed = true;
      this.endShopPhase();
      return true;
    }
    return false;
  }

  /** Internal: set by Shop purchase when flashlight item is bought. */
  public grantFlashlight(){ this.hasFlashlight = true; }

  async init(){
    // Load data sets, but don’t block gameplay if any fail (waves have built-in fallback)
    try {
      const results = await Promise.allSettled([ this.wave.load(), this.shop.load(), this.turrets.load() ] as const);
      // Optional: light debug via logger if available (no console in prod)
      try {
        const Logger = (window as any).Logger;
        if (Logger && typeof Logger.warn === 'function') {
          results.forEach((r, idx) => { if (r.status === 'rejected') Logger.warn(`[LastStand] load step ${idx} failed: ${(r as any).reason?.message || r}`); });
        }
      } catch { /* ignore */ }
    } catch { /* ignore: proceed with fallbacks */ }
    // Restrict shop weapons to this operative's kit (class + compatible types)
    try {
      const char = (this.game as any).selectedCharacterData as { defaultWeapon?: number; weaponTypes?: number[] } | undefined;
      const def = char?.defaultWeapon;
      const list = Array.from(new Set([ ...(char?.weaponTypes || []), ...(typeof def === 'number' ? [def] : []) ])) as number[];
      // Also always include currently owned weapon types so upgrades can appear
      const owned: number[] = Array.from((this.game.player?.activeWeapons || new Map()).keys()) as number[];
  // Allow baseline classics in Last Stand for variety (Deagle, Shotgun, Crossbow) plus iconic beams/ricochet
  const classics = [
    WeaponType.PISTOL,
    // Exclude evolved DUAL_PISTOLS from direct rolls; evolution only via PISTOL L7 + Crit
    WeaponType.SHOTGUN,
    WeaponType.TRI_SHOT,
    WeaponType.RAILGUN,
    WeaponType.RICOCHET,
    WeaponType.LASER
  ] as number[];
  const allow = Array.from(new Set<number>([ ...list, ...owned, ...classics ])) as number[];
      (this.shop as any).setAllowedWeapons(allow as any);
    } catch { /* ignore */ }
    // Configure a simple horizontal corridor and a defense core on the left
    this.setupCorridorAndCore();
  // Prime LS visibility cache once (center/radius/corridors) to avoid first-frame cost at reveal
  try { this.updateLsAimCache(); } catch {}
  // LS tuning: make small enemies significantly faster so they lead the charge
  try { const EM:any = this.game.getEnemyManager(); EM.setLastStandSmallSpeedMultiplier?.(1.8); } catch { /* ignore */ }
  // LS tuning: increase enemy knockback resistance by +300% (3x) so pushes are substantially reduced
  try { const EM:any = this.game.getEnemyManager(); EM.setLastStandEnemyKbResistMultiplier?.(3.0); } catch { /* ignore */ }
    // Clamp player to corridor start area
    try {
      const rm:any = (window as any).__roomManager;
      if (rm && typeof rm.clear === 'function') {
        rm.clear(); rm.setOpenWorld(false);
        const c = this.corridor!; rm.getCorridors?.().push?.(c); // if manager exposes the array
        // Re-register blockers after clear
        this.registerBlockers();
      }
      // Spawn player next to core (slightly to the right inside the corridor)
      try {
        const p = this.game.player;
        const pr = p?.radius || 20;
        p.x = this.core.x + this.core.radius + pr + 24;
        p.y = this.core.y;
      } catch { /* ignore */ }
      // Clamp player to corridor in case of edge overlap
      if (rm && typeof rm.clampToWalkable === 'function') {
        const cl = rm.clampToWalkable(this.game.player.x, this.game.player.y, this.game.player.radius||20);
        this.game.player.x = cl.x; this.game.player.y = cl.y;
      }
    } catch { /* ignore */ }
    this.hud.setWave(this.wave.getCurrentWaveNumber()+1);
    this.overlay = new LastStandShopOverlay(this.shop, this.currency, (off) => {
      this.shop.purchase(off, this.game, this.currency);
    }, () => {
      // Exit shop early
      this.endShopPhase();
    });
    this.startCombatPhase(true);
    // Snap turret placements to nearest pad when shop emits place event
    window.addEventListener('laststand:placeTurret', (e: Event) => {
      const d = (e as CustomEvent).detail || {}; const id = d.turretId || 'turret_gun';
      const p = this.game.player;
      let best:any=null; let bd=1e9;
      for (const pad of this.pads){ if (pad.occupied) continue; const dx=pad.x-p.x, dy=pad.y-p.y; const d2=dx*dx+dy*dy; if (d2<bd){bd=d2; best=pad;} }
      if (best && bd <= (420*420)) { this.turrets.place(id, best.x, best.y); best.occupied = true; }
    }, { once: true });
  }

  update(deltaMs: number){
  // Update LS aim cache (core-centered FoW + corridors) first, so all systems read fresh data this frame
  try { this.updateLsAimCache(); } catch {}
  // Update turrets after cache so visibility gates are correct for targeting
  this.turrets.update(deltaMs, this.game.getEnemyManager(), this.game.getBulletManager?.());
    // Unstick from turret holders: if player overlaps a holder rect (including radius), nudge out along shortest axis
    try {
      const p = this.game.player; const pr = p?.radius || 20;
      if (p) {
        // If a holder shop is open, auto-close it when stepping away beyond interaction range
        if (this.holderUiEl && this.holderUiFor) {
          const h = this.holderUiFor;
          const cx = Math.max(h.x, Math.min(p.x, h.x + h.w));
          const cy = Math.max(h.y, Math.min(p.y, h.y + h.h));
          const dx = p.x - cx, dy = p.y - cy; const d2 = dx*dx + dy*dy;
          const thresh = (pr + 36);
          if (d2 > (thresh*thresh)) {
            this.hideTurretHolderShop();
          }
        }
        if (this.holders && this.holders.length) {
          for (let i=0;i<this.holders.length;i++) {
            const h = this.holders[i]; if (!h) continue;
            const l = h.x - pr, r = h.x + h.w + pr, t = h.y - pr, b = h.y + h.h + pr;
            if (p.x > l && p.x < r && p.y > t && p.y < b) {
              const dxL = Math.abs(p.x - l), dxR = Math.abs(r - p.x);
              const dyT = Math.abs(p.y - t), dyB = Math.abs(b - p.y);
              if (Math.min(dxL, dxR) < Math.min(dyT, dyB)) {
                p.x += (dxL < dxR) ? -(dxL + 0.5) : (dxR + 0.5);
              } else {
                p.y += (dyT < dyB) ? -(dyT + 0.5) : (dyB + 0.5);
              }
            }
          }
        }
        if (this.skipRect) {
          const h = this.skipRect;
          const l = h.x - pr, r = h.x + h.w + pr, t = h.y - pr, b = h.y + h.h + pr;
          if (p.x > l && p.x < r && p.y > t && p.y < b) {
            const dxL = Math.abs(p.x - l), dxR = Math.abs(r - p.x);
            const dyT = Math.abs(p.y - t), dyB = Math.abs(b - p.y);
            if (Math.min(dxL, dxR) < Math.min(dyT, dyB)) {
              p.x += (dxL < dxR) ? -(dxL + 0.5) : (dxR + 0.5);
            } else {
              p.y += (dyT < dyB) ? -(dyT + 0.5) : (dyB + 0.5);
            }
          }
        }
      }
    } catch { /* ignore */ }
    // Shop countdown
    if (this.phase === 'SHOP'){
      const remain = Math.max(0, Math.ceil((this.shopEndsAtMs - performance.now())/1000));
      this.hud.setTimer(remain);
      this.overlay?.setTimer(remain);
      if (performance.now() >= this.shopEndsAtMs) this.endShopPhase();
    }
    // Debug: show wave and remaining count faintly for diagnostics (auto-fades after 30s)
    try {
      const now = performance.now();
      const start = ((window as any).__lsDbgStart ||= now);
      const t = (now - start) / 1000;
      if (t <= 30) {
        const cnv = ((window as any).__gameCanvas || document.querySelector('canvas')) as HTMLCanvasElement | null;
        const ctx = cnv?.getContext('2d'); if (cnv && ctx) {
          ctx.save(); ctx.resetTransform?.();
          ctx.globalAlpha = Math.max(0, 0.5 * (1 - t/30));
          ctx.fillStyle = '#9ff'; ctx.font = '600 12px Orbitron, monospace';
          const wave = this.wave.getCurrentWaveNumber()+1; const rem = this.wave.getEnemiesRemaining();
          ctx.fillText(`LS Debug · Wave ${wave} · Remaining ${rem}`, 12, cnv.height - 12);
          ctx.restore();
        }
      }
    } catch { /* ignore */ }
    // Core defeat check
    if (this.core && this.core.isDestroyed()) {
      try { this.game.setState?.('GAME_OVER'); } catch {}
      try { window.dispatchEvent(new CustomEvent('showGameOverOverlay')); } catch {}
    }
    // Brief guidance overlay for first ~25s
    try {
      const w:any = window as any; const start = (w.__lsGuideStart ||= performance.now());
      const t = (performance.now() - start) / 1000;
      if (t <= 25) {
        const cnv = (w.__gameCanvas || document.querySelector('canvas')) as HTMLCanvasElement | null;
        const ctx = cnv?.getContext('2d'); if (cnv && ctx) {
          ctx.save();
          ctx.resetTransform?.();
          ctx.globalAlpha = 0.85 * Math.min(1, Math.max(0, 1 - Math.abs(t - 12)/12));
          ctx.fillStyle = 'rgba(0,10,14,0.55)';
          const pad = 14; const wBox = Math.min(520, cnv.width - 40);
          ctx.translate(cnv.width - wBox - 20, 20);
          ctx.fillRect(0,0,wBox,120);
          ctx.fillStyle = '#7dffea'; ctx.font = '600 16px Orbitron, monospace';
          ctx.fillText('Last Stand: Defend the Core', 12, 28);
          ctx.fillStyle = '#dff'; ctx.font = '600 12px Orbitron, monospace';
          ctx.fillText('• Enemies attack from the right. Clear waves to open the Shop.', 12, 52);
          ctx.fillText('• Place turrets on glowing pads. Buy palisades to hold the choke.', 12, 72);
          ctx.fillText('• Spend Scrap wisely. Elites escalate pressure; bosses come later.', 12, 92);
          ctx.restore();
        }
      }
    } catch { /* ignore */ }
  }

  private startCombatPhase(first=false){
    this.phase = 'COMBAT';
    this.hud.setPhase('COMBAT'); this.hud.setTimer(0);
    const EM:any = this.game.getEnemyManager();
  // Ensure spawns are active and enemies chase the core
  try { (EM as any).spawnFreezeUntilMs = 0; } catch {}
  try { (EM as any).setChaseTargetProvider?.(() => ({ x: this.core.x, y: this.core.y })); } catch {}
  // Start next wave; bosses are handled at specific milestone waves by LS controller
    const bm:any = (window as any).__bossManager;
    const nextWave = this.wave.getCurrentWaveNumber()+1;
    this.hud.setWave(nextWave);
    // Show big wave warning depending on wave number
    try {
      const warn = ensureWaveWarningOverlay();
      if (this.isBossWave(nextWave)) warn.show('BOSS');
      else if (nextWave % 5 === 0) warn.show('ELITE');
      else warn.show('ENEMIES');
    } catch { /* ignore */ }
    // Spawn enemies so they walk toward the core and enter visibility ~10s in wave 1
  const cor = this.corridor!;
  const core = this.core;
      this.wave.startNextWave(EM, this.game.player, {
        spawnPositionFn: (_i,_t) => {
          const margin = 40;
          const y = cor.y + margin + Math.random()*(cor.h - margin*2);
          // IMPORTANT: World is huge; corridor width ~80% of world (tens of thousands px).
          // Spawning "near corridor right edge" makes enemies minutes away. Instead, place
          // them at a fixed offset from the core to target ~5–10s arrival.
          const base = (nextWave === 1)
            ? (1000 + Math.random()*400)   // 1000..1400 px from core on wave 1
            : (900 + Math.random()*400);   // 900..1300 px on later waves (slightly quicker)
          const rightInner = cor.x + cor.w - 20; // stay inside corridor
          const leftInner = cor.x + 20;
          const rawX = core.x + base;
          const x = Math.min(rightInner, Math.max(leftInner, Math.floor(rawX)));
          return { x, y };
        }
      });
  try { this.hud.setEnemiesLeft(this.wave.getEnemiesRemaining()); } catch {}
  // Boss appears much later to keep early waves elite-focused
  if (this.isBossWave(nextWave) && bm && typeof bm['spawnBoss'] === 'function') {
      const margin = 60;
      const bx = cor.x + cor.w - margin - 200; // a bit inward
      const by = cor.y + cor.h/2;
      bm['spawnBoss']({ cinematic: false, x: bx, y: by });
    } else {
      // Promote a few elites mid‑wave for pressure (if EnemyManager exposes API)
      try {
        const EM:any = this.game.getEnemyManager();
        if (EM && typeof (EM as any).ensureEliteSchedule === 'function') {
          // Nudge elite schedule forward by setting unlock time slightly earlier
          (EM as any).elitesUnlocked = true;
          (EM as any).elitesUnlockedAtSec = (this.game.getGameTime?.() || 0);
        }
        // Guarantee elites in ELITE waves: ensure at least 1-2 are present immediately
        if (nextWave % 5 === 0 && typeof EM.ensureElitePresence === 'function') {
          const t = this.game.getGameTime?.() || 0;
          const min = nextWave >= 20 ? 2 : 1;
          EM.ensureElitePresence(min, t);
        }
      } catch { /* ignore */ }
    }
    // When wave completes, open shop
    if (!this.onCompleteHooked) { this.wave.onWaveComplete(()=> this.startShopPhase()); this.onCompleteHooked = true; }
  if (first) this.currency.add(100); // seed more initial scrap for first shop
  }

  /** True for LS boss waves: first at 15, then every 15 (15, 30, 45, ...). */
  private isBossWave(waveNum: number): boolean {
    return waveNum >= 15 && ((waveNum - 15) % 15 === 0);
  }

  private startShopPhase(){
    this.phase = 'SHOP';
    this.hud.setPhase('SHOP');
    const EM:any = this.game.getEnemyManager();
    // Freeze dynamic spawns for the duration
    try {
      const until = performance.now() + 30000; // 30s shop timer
      (EM as any).spawnFreezeUntilMs = Math.max((EM as any).spawnFreezeUntilMs || 0, until);
    } catch {}
    // Balance: ensure the player can afford at least one turret upgrade per shop
    try {
      const ensureCost = this.getCheapestNextUpgradeCost();
      if (ensureCost > 0) {
        const bal = this.currency.getBalance();
        if (bal < ensureCost) this.currency.add(ensureCost - bal);
      }
    } catch { /* ignore */ }
  this.shopEndsAtMs = performance.now() + 30000;
  this.shopSkippableUsed = false;
    this.overlay.setTimer(30);
    this.overlay.show();
  this.showSkipControl();
  }

  private endShopPhase(){
    this.overlay.hide();
    this.hideSkipControl();
    this.startCombatPhase();
  }

  /** Show a minimal turret shop at the nearest holder when pressing F */
  private showTurretHolderShop(holder: {x:number;y:number;w:number;h:number; turretId?:string; level?:number; turretRef?: any}){
    const el = this.holderUiEl || document.createElement('div');
    this.holderUiEl = el;
  this.holderUiFor = holder;
    el.className = 'ls-holder-shop';
    Object.assign(el.style, { position:'fixed', left:'50%', top:'14%', transform:'translateX(-50%)', zIndex:'70', padding:'10px 12px', borderRadius:'10px', background:'rgba(0,18,22,0.95)', color:'#eaffff', border:'1px solid rgba(120,255,235,0.25)', boxShadow:'0 10px 40px rgba(0,255,220,0.22)', font:'600 14px Orbitron, monospace' } as CSSStyleDeclaration);
    const owned = !!holder.turretId; const level = holder.level||0;
    const opts: Array<{id:string; label:string}> = owned ? [] : [
      { id:'turret_minigun', label:'Minigun' },
      { id:'turret_crossbow3', label:'Triple Crossbow' },
      { id:'turret_heavy_mortar', label:'Heavy Mortar' }
    ];
    const tSpec = owned ? this.turrets.getSpec(holder.turretId!) : null;
    const maxLv = owned && tSpec ? tSpec.dps.length : 7;
    const price = owned && tSpec ? (tSpec.price[Math.min(level, tSpec.price.length-1)] || 0) :  0;
    const scrap = this.currency.getBalance();
    el.innerHTML = '';
    const title = document.createElement('div'); title.textContent = 'Turret Holder'; Object.assign(title.style, { fontSize:'16px', color:'#7dffea', marginBottom:'6px' } as CSSStyleDeclaration);
    el.appendChild(title);
  if (!owned) {
      const row = document.createElement('div'); Object.assign(row.style, { display:'flex', gap:'8px' } as CSSStyleDeclaration);
      for (const o of opts){
    const cost = this.getTurretPlacementCost(o.id);
    const btn = document.createElement('button'); btn.textContent = `${o.label} — ${cost} Scrap`; Object.assign(btn.style, { padding:'8px 10px', borderRadius:'8px', border:'1px solid #0aa', background:'#042126', color:'#cffffa', cursor:'pointer' } as CSSStyleDeclaration);
    if (scrap < cost) { btn.disabled = true; btn.style.opacity = '0.7'; }
    btn.onclick = () => {
          if (this.currency.spend(cost)) {
      holder.turretId = o.id; holder.level = 1;
      const inst = this.turrets.place(o.id, holder.x + holder.w/2, holder.y + holder.h/2);
      try { holder.turretRef = inst; } catch {}
            this.hideTurretHolderShop();
          }
        };
        row.appendChild(btn);
      }
      el.appendChild(row);
  // Removed Esc tooltip per request
    } else {
      const line = document.createElement('div'); line.textContent = `${tSpec?.name || 'Turret'} — Lv ${level}/${maxLv}`; Object.assign(line.style, { marginBottom:'6px' } as CSSStyleDeclaration);
      el.appendChild(line);
      const btn = document.createElement('button');
      const nextCost = tSpec?.price[Math.min(level, (tSpec?.price.length||1)-1)] || 0;
      btn.textContent = level < maxLv ? `Upgrade (${nextCost})` : 'Max Level';
      btn.disabled = level >= maxLv || scrap < nextCost;
      Object.assign(btn.style, { padding:'8px 10px', borderRadius:'8px', border:'1px solid #0aa', background:'#042126', color:'#cffffa', cursor:'pointer', opacity: btn.disabled ? '0.7':'1' } as CSSStyleDeclaration);
      btn.onclick = () => {
        if (!tSpec) return; if (holder.level! >= maxLv) return;
        const cost = tSpec.price[Math.min(holder.level!, tSpec.price.length-1)] || 0;
        if (this.currency.spend(cost)) {
          // Prefer upgrading the turret linked to this holder
          let upgraded = false;
          if (holder.turretRef) {
            try { this.turrets.upgrade(holder.turretRef); upgraded = true; } catch { upgraded = false; }
          }
          if (!upgraded) {
            const near = this.turrets.findNearest(holder.x+holder.w/2, holder.y+holder.h/2, 80);
            if (near) { this.turrets.upgrade(near); holder.turretRef = near; upgraded = true; }
          }
          holder.level = Math.min(maxLv, (holder.level||1) + 1);
          this.hideTurretHolderShop(); this.showTurretHolderShop(holder); // refresh
        }
      };
      el.appendChild(btn);
  // Removed Esc tooltip per request
    }
  document.body.appendChild(el);
  }

  private hideTurretHolderShop(){
    if (this.holderUiEl) {
      try { this.holderUiEl.remove(); } catch {}
      this.holderUiEl = null;
    }
    this.holderUiFor = null;
  }

  /** Effective first-buy discount and escalating placement cost per owned turret. */
  private getTurretPlacementCost(id: string): number {
    const spec = this.turrets.getSpec(id);
    const base = spec?.price?.[0] ?? 100;
    const ownedCount = (this.turrets as any).list?.().length ?? 0;
    if (ownedCount <= 0) return 20; // very cheap first turret
    // Progressive tax: +35% per existing turret, rounded to nearest 10
    const scaled = base * (1 + 0.35 * ownedCount);
    return Math.max(30, Math.round(scaled / 10) * 10);
  }

  /** Compute the cheapest available next upgrade across all placed turrets. */
  private getCheapestNextUpgradeCost(): number {
    const list = (this.turrets as any).list?.() as Array<{ level:number; spec:{ price:number[] } }>|undefined;
    if (!list || !list.length) return 0;
    let best = Infinity;
    for (let i=0;i<list.length;i++){
      const t = list[i];
      const idx = Math.min(t.level, (t.spec.price.length-1));
      const cost = t.spec.price[idx] || 0;
      if (t.level < t.spec.price.length && cost > 0 && cost < best) best = cost;
    }
    return Number.isFinite(best) ? best : 0;
  }

  /** Register palisades and holders as solid block rectangles with the RoomManager. */
  private registerBlockers(){
    try {
      const rm:any = (window as any).__roomManager;
      if (!rm) return;
  // Replace any existing Last Stand blockers to avoid duplicates
  if (typeof rm.clearBlockRects === 'function') rm.clearBlockRects();
      if (typeof rm.addBlockRects === 'function') {
        // Core as a solid blocker (approximate circle with square)
        if (this.core) {
          const r = Math.max(8, Math.floor(this.core.radius * 0.95));
          rm.addBlockRects([{ x: Math.round(this.core.x - r), y: Math.round(this.core.y - r), w: Math.round(r*2), h: Math.round(r*2) }]);
        }
        if (this.palisades?.length) rm.addBlockRects(this.palisades.map(ps => ({ x: Math.round(ps.x), y: Math.round(ps.y), w: Math.round(ps.w), h: Math.round(ps.h) })));
        if (this.holders?.length) rm.addBlockRects(this.holders.map(h => ({ x: Math.round(h.x), y: Math.round(h.y), w: Math.round(h.w), h: Math.round(h.h) })));
        if (this.skipRect) rm.addBlockRects([{ x: Math.round(this.skipRect.x), y: Math.round(this.skipRect.y), w: Math.round(this.skipRect.w), h: Math.round(this.skipRect.h) }]);
      } else {
        // Fallback: stash into first room's doorRects
        const rooms:any = rm?.getRooms?.();
        if (rooms && rooms.length) {
          const room = rooms[0]; if (!room.doorRects) room.doorRects = [];
          if (this.core) {
            const r = Math.max(8, Math.floor(this.core.radius * 0.95));
            room.doorRects.push({ x: Math.round(this.core.x - r), y: Math.round(this.core.y - r), w: Math.round(r*2), h: Math.round(r*2) });
          }
          for (const ps of this.palisades) room.doorRects.push({ x: Math.round(ps.x), y: Math.round(ps.y), w: Math.round(ps.w), h: Math.round(ps.h) });
          for (const hld of this.holders) room.doorRects.push({ x: Math.round(hld.x), y: Math.round(hld.y), w: Math.round(hld.w), h: Math.round(hld.h) });
          if (this.skipRect) room.doorRects.push({ x: Math.round(this.skipRect.x), y: Math.round(this.skipRect.y), w: Math.round(this.skipRect.w), h: Math.round(this.skipRect.h) });
        }
      }
    } catch { /* ignore */ }
  }

  /** Create a horizontal corridor and place a defense core at the left end. */
  private setupCorridorAndCore(){
    // Corridor spans 80% width at mid-height
    const worldW = this.game.worldW || 8000; const worldH = this.game.worldH || 6000;
    const w = Math.floor(worldW * 0.80);
    const h = 360; // fixed comfortable width
    const x = Math.floor((worldW - w) * 0.10);
    const y = Math.floor(worldH * 0.5 - h/2);
    this.corridor = { x, y, w, h };
    const coreX = x + Math.floor(h * 0.5);
    const coreY = y + Math.floor(h / 2);
    this.core = new CoreEntity(coreX, coreY, 60, 2000);
    // Inform HUD of core HP (reuse scrap field for now via appended text)
    try { (this.hud as any).setCoreHp?.(this.core.hp, this.core.maxHp); } catch {}
    // Redirect enemy aggression to core and damage core on contact
    this.installCoreAggroHooks();
  // Visual core marker: draw via lightweight DOM canvas overlay event (consumed in Game draw loop if desired)
  try { (window as any).__lsCore = this.core; } catch {}
  // Create persistent skip structure (holder-like) to the left of the core (always present)
  // Small square; we only render it during SHOP. Position slightly left of core.
  const skipW = 28, skipH = 28;
  this.skipRect = { x: coreX - 60 - skipW, y: coreY - Math.floor(skipH/2), w: skipW, h: skipH };

  // Create 4 turret pads near core and simple palisades as low barricades
    const padR = 26; const padDX = 140; const padDY = 90;
    this.pads = [
      { x: coreX + padDX, y: coreY - padDY, r: padR },
      { x: coreX + padDX, y: coreY + padDY, r: padR },
      { x: coreX + padDX*2.0, y: coreY - padDY, r: padR },
      { x: coreX + padDX*2.0, y: coreY + padDY, r: padR }
    ];
    // Turret holders: a vertical wall a short distance before the core, with a wide central walkable gap
    const holdW = 36, holdH = 56; // smaller footprint per feedback
    const spacing = 8;
    const cor = this.corridor!;
    const wallX = coreX + Math.floor(padDX * 2.2) - Math.floor(holdW/2); // wall location relative to core
    // Compute symmetric positions with a wider center entrance
    const margin = 12;
    const desiredGap = Math.min(220, Math.max(140, Math.floor(h * 0.42))); // widen central entrance
    const gapTop = coreY - Math.floor(desiredGap/2);
    const gapBot = coreY + Math.floor(desiredGap/2);
    // Place two holders stacked just above the gap (clamped to top margin)
    let top2 = Math.max(cor.y + margin, gapTop - (holdH*2 + spacing + 6));
    const topY1 = top2;
    const topY2 = top2 + holdH + spacing;
    // Place two holders stacked just below the gap (clamped to bottom margin)
    let bot1 = Math.min(cor.y + cor.h - margin - (holdH*2 + spacing), gapBot + 6);
    const botY3 = bot1;
    const botY4 = bot1 + holdH + spacing;
    this.holders = [
      { x: wallX, y: topY1, w: holdW, h: holdH },
      { x: wallX, y: topY2, w: holdW, h: holdH },
      // central wide gap here (walkable)
      { x: wallX, y: botY3, w: holdW, h: holdH },
      { x: wallX, y: botY4, w: holdW, h: holdH }
    ];
    // Palisades: exactly 4 posts, spaced across a forward band, keeping central lane clear
    const palW = 10, palL = 72; // slimmer posts
    const bandX1 = wallX + holdW + 40;
    const bandX2 = Math.min(cor.x + cor.w - 20 - palW, wallX + holdW + 320);
    const slots = 4;
    this.palisades = [];
    for (let i=0;i<slots;i++){
      const t = (i + 0.5) / slots; // evenly spaced along band
      const px = Math.floor(bandX1 + t * Math.max(10, (bandX2 - bandX1)));
      // Alternate above/below gap to distribute
      const placeTop = (i % 2 === 0);
      const yMin = placeTop ? (y + 10) : (gapBot + 10);
      const yMax = placeTop ? (gapTop - palL - 10) : (y + h - palL - 10);
      const py = Math.floor((yMin + yMax) / 2);
      if (yMax > yMin) this.palisades.push({ x: px, y: py, w: palW, h: palL });
    }
  // Register blockers (includes palisades, holders, and the persistent skip rect)
  this.registerBlockers();

    // Interaction: press F near a holder to open turret shop
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'f') return;
      const p = this.game.player; if (!p) return;
      const px = p.x, py = p.y; const pr = (p.radius||20);
      // If SHOP phase and near skip rect, allow one skip
      if (this.phase === 'SHOP' && !this.shopSkippableUsed && this.skipRect) {
        const h = this.skipRect;
        const cx = Math.max(h.x, Math.min(px, h.x + h.w));
        const cy = Math.max(h.y, Math.min(py, h.y + h.h));
        const dx = px - cx, dy = py - cy; const d2 = dx*dx + dy*dy;
        if (d2 <= ((pr+36)*(pr+36))) {
          this.shopSkippableUsed = true;
          this.endShopPhase();
          e.preventDefault();
          return;
        }
      }
      let best: any = null; let bd2 = Infinity;
      for (const h of this.holders){
        // Compute rect distance
        const cx = Math.max(h.x, Math.min(px, h.x + h.w));
        const cy = Math.max(h.y, Math.min(py, h.y + h.h));
        const dx = px - cx, dy = py - cy; const d2 = dx*dx + dy*dy;
        if (d2 < bd2) { bd2 = d2; best = h; }
      }
      if (best && bd2 <= ( (pr+36)*(pr+36) )) {
        this.showTurretHolderShop(best);
      }
    };
    window.addEventListener('keydown', this.keydownHandler);
  }

  /** Tear down LS UI and listeners so returning to main menu doesn't leave UI visible. */
  public dispose(){
    try { this.hud.hide(); } catch {}
    try { this.overlay?.hide(); } catch {}
    try { this.hideTurretHolderShop(); } catch {}
    try { this.hideSkipControl(); } catch {}
  try { const rm:any = (window as any).__roomManager; rm?.clearBlockRects?.(); } catch {}
    if (this.placeTurretHandler) {
      try { window.removeEventListener('laststand:placeTurret', this.placeTurretHandler); } catch {}
      this.placeTurretHandler = undefined;
    }
    if (this.keydownHandler) {
      try { window.removeEventListener('keydown', this.keydownHandler); } catch {}
      this.keydownHandler = undefined;
    }
  // Reset LS-specific enemy KB resist tuning
  try { const EM:any = this.game.getEnemyManager(); EM.setLastStandEnemyKbResistMultiplier?.(1.0); } catch { /* ignore */ }
  // Reset LS-specific enemy speed tuning
  try { const EM:any = this.game.getEnemyManager(); EM.setLastStandSmallSpeedMultiplier?.(1.0); } catch { /* ignore */ }
    // Clear shared globals used by Game draw helpers
    try { (window as any).__lsCore = null; } catch {}
  }

  /** Show a big red skip-to-next-wave button behind the core during SHOP phase. */
  private showSkipControl(){
    // Visual/interaction handled elsewhere; structure is persistent
  }
  private hideSkipControl(){ try { this.skipEl?.remove(); } catch {} this.skipEl = null; }

  /** Override minimal EnemyManager hooks so enemies march along the corridor toward the core and damage it on contact. */
  private installCoreAggroHooks(){
    const EM:any = this.game.getEnemyManager(); if (!EM) return;
  // Patch a light touch into the update loop by adding a contact damage handler
    const core = this.core; const game = this.game; const self = this;
    if (!EM.__lsCoreInjected) {
      EM.__lsCoreInjected = true;
      const origUpdate = EM.update?.bind(EM);
      if (typeof origUpdate === 'function') {
        EM.update = function(deltaTime:number){
          const result = origUpdate(deltaTime);
          try {
            const enemies = EM.getEnemies ? EM.getEnemies() : EM.enemies;
            if (enemies && enemies.length && core && core.hp > 0) {
              const r2 = (core.radius + 18) * (core.radius + 18);
              for (let i=0;i<enemies.length;i++){
                const e = enemies[i]; if (!e || !e.active || e.hp <= 0) continue;
                const dx = e.x - core.x; const dy = e.y - core.y; if (dx*dx + dy*dy <= r2) {
                  // Deal contact damage to core and apply small pushback to enemy
                  const dmg = Math.max(1, Math.round((e.damage||1) * (e.type==='small'?1: e.type==='medium'?2:3)));
                  core.takeDamage(dmg);
                  const d = Math.hypot(dx, dy) || 1; e.x += (dx/d) * 6; e.y += (dy/d) * 6;
                }
              }
            }
          } catch {/* ignore */}
          // Update HUD core HP if available
          try { (self.hud as any).setCoreHp?.(core.hp, core.maxHp); } catch {}
          // If core destroyed, end game
          if (core.isDestroyed()) { try { game.endGame?.(); } catch {} }
          return result;
        };
      }
    }
  // Use chase target provider so enemies pursue the core
  try { EM.setChaseTargetProvider?.(() => ({ x: core.x, y: core.y })); } catch { /* ignore */ }
  }

  /** Cache core-centered FoW circle and corridor rectangles for fast aim checks across systems. */
  private updateLsAimCache() {
    const w: any = window as any;
    const gi: any = w.__gameInstance;
    if (!gi || gi.gameMode !== 'LAST_STAND') return;
    const core = this.core;
    const rm: any = w.__roomManager;
    const tiles = typeof gi.getEffectiveFowRadiusTiles === 'function' ? gi.getEffectiveFowRadiusTiles() : 4;
    const ts = (typeof gi.fowTileSize === 'number') ? gi.fowTileSize : 160;
    const r = Math.floor(tiles * ts * 0.95);
    const cx = core?.x ?? (gi.player?.x ?? 0);
    const cy = core?.y ?? (gi.player?.y ?? 0);
    // Read corridors (prefer stable array reference if provided by manager)
    let corridors: any[] | undefined;
    try { corridors = rm?.getCorridors?.() || rm?.corridors || []; } catch { corridors = []; }
    const cache = w.__lsAimCache || (w.__lsAimCache = {});
    cache.cx = cx; cache.cy = cy; cache.r2 = r * r; cache.corridors = corridors;
    cache.updatedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }
}
