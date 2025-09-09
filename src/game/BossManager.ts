import { Player } from './Player';
import { ParticleManager } from './ParticleManager';
import { AssetLoader } from './AssetLoader';
import { BOSS_SPAWN_INTERVAL_SEC } from './Balance';
import { WeaponType } from './WeaponType';

export type Boss = { x: number; y: number; hp: number; maxHp: number; radius: number; active: boolean; telegraph: number; state: 'TELEGRAPH' | 'ACTIVE' | 'DEAD'; attackTimer: number; _damageFlash?: number; specialCharge?: number; specialReady?: boolean; lastContactHitTime?: number; id?: string } | null;

export class BossManager {
  private player: Player;
  private boss: Boss = null;
  private spawnTimer: number = 0; // Use gameTime directly
  private particleManager: ParticleManager | null = null;
  private assetLoader: AssetLoader | null = null;
  private bossImage: HTMLImageElement | null = null;
  private bossImageCache: Record<string, HTMLImageElement | null> = Object.create(null);
  private bossCycleIndex: number = 0; // rotate across four bosses
  private difficulty: number = 1;
  private lastBossSpawnTime: number = 0; // Track last spawn time
  private bossSpawnCount: number = 0; // Infinite scaling counter
  // Visual walk-cycle for boss: 1s flip interval
  private bossWalkFlip: boolean = false;
  private bossWalkFlipTimerMs: number = 0;
  private readonly bossWalkIntervalMs: number = 1000;
  // Spells state
  private spellCooldownMs: number = 7000; // tighter cadence to reduce idle windows
  private nextSpellAtMs: number = 0;
  private spellState: 'IDLE'
    | 'NOVA_CHARGE' | 'NOVA_RELEASE'
    | 'MULTINOVA_CHARGE' | 'MULTINOVA_RELEASE'
    | 'LINEUP' | 'DASH'
    | 'CONE_WINDUP' | 'CONE_RELEASE'
    | 'RIFTS_WINDUP' | 'RIFTS_RELEASE'
    // New epic spells per-boss
    | 'SUPERNOVA_CHARGE' | 'SUPERNOVA_RELEASE'    // Beta (nova)
    | 'EARTH_WINDUP' | 'EARTH_RELEASE'            // Alpha (balanced)
    | 'RIFT_BARRAGE_WINDUP' | 'RIFT_BARRAGE_RELEASE' // Gamma (summoner)
    | 'CROSS_WINDUP' | 'CROSS_RELEASE'            // Omega (dasher)
    | 'VOLLEY_WINDUP' | 'VOLLEY_RELEASE'          // Beta: mortar bullet volley
    = 'IDLE';
  private spellTimerMs: number = 0;
  private novaRadius: number = 0;
  private novaMaxRadius: number = 320; // slightly reduced for fairness
  private novaHitApplied: boolean = false;
  private dashDirX: number = 0;
  private dashDirY: number = 0;
  private dashSpeedPxPerMs: number = 0.6; // slower dash speed
  private dashDurationMs: number = 600; // longer duration for readability
  private dashElapsedMs: number = 0;
  // Dash fairness controls
  private dashDidHitOnce: boolean = false; // limit dash contact to a single hit
  private postDashRecoverUntilMs: number = 0; // brief recovery where boss can't body-check
  // Frame->ms migration helpers
  private readonly MS_PER_FRAME = 1000 / 60; // fixed-timestep baseline
  private telegraphFxAccMs: number = 0;
  // Telegraph consistency helpers
  private readonly novaChargeMs: number = 1800; // longer, clearer windup
  private readonly specialWindupMs: number = 3000;
  private readonly novaHitBand: number = 12; // exact hit band thickness used in both draw and damage
  // New spell timings
  private readonly superNovaChargeMs: number = 3600; // give more time to run
  private readonly superNovaReleaseMs: number = 1400; // slower, smoother expansion
  private readonly earthWindupMs: number = 1200;
  private readonly riftBarrageWindupMs: number = 1200;
  private readonly crossWindupMs: number = 800;
  // Previous-frame radii for robust hit detection across low-FPS frames
  private lastNovaR: number = 0;
  private lastSuperNovaR: number = 0;
  // Enhanced spells state
  private multiNovaIndex: number = 0;
  private multiNovaCount: number = 0;
  private multiNovaSpacing: number = 90; // px between rings (clearer gaps yet fewer, larger rings)
  private multiNovaGaps: Array<Array<{ start: number; end: number }>> = [];
  // Continuous outward motion across the entire Multi‑Nova release (prevents visual resets)
  private multiNovaGlobalT: number = 0; // cumulative ring offset progressing over time
  private multiNovaHit: boolean[] = []; // per-ring hit flags to avoid multi-tick damage
  // Beta boss Supernova pity system (guarantee Supernova within a few casts)
  private betaNovaPity: number = 0; // counts Multi‑Nova casts since last Supernova
  private readonly betaPityThreshold: number = 2; // force Supernova after 2 Multi‑Novas (i.e., within 3 casts)
  // Cone slam parameters
  private coneDirX: number = 1;
  private coneDirY: number = 0;
  private coneArcRad: number = Math.PI / 3; // 60° half-angle
  private coneRange: number = 420;
  private coneWindupMs: number = 1200;
  // Summoner rifts
  private riftPoints: Array<{x:number;y:number}> = [];
  private riftRadius: number = 90;
  private riftWindupMs: number = 1400;
  // Lightweight hazards (e.g., dash trail, rift pops)
  private hazards: Array<{ kind:'aoe'|'line'|'proj'; x:number; y:number; x2?:number; y2?:number; radius?:number; width?:number; windupMs:number; activeMs:number; elapsedMs:number; color:string; damage:number; vx?:number; vy?:number; sprite?:string }> = [];
  // Cinematic alerts queue
  private alerts: Array<{ text: string; color: string; born: number; until: number }>= [];
  // Supernova rumble accumulator (small shakes during charge)
  private superNovaRumbleAccMs: number = 0;
  private _extraCooldownMs: number = 0; // optional extra cooldown injection for specific spells
  // Screen-space overlays (computed during draw, rendered by Game in screen space)
  private screenDarkenAlpha: number = 0; // 0..1, used to darken screen during Supernova
  // Sticky banner (center-screen) shown during critical boss phases like Supernova
  private bannerText: string | null = null;
  private bannerColor: string = '#FFAA00';
  private bannerUntil: number = 0;
  // Beta volley (mortar) fields
  private volleyCount: number = 0;
  private volleyIndex: number = 0;
  private volleyIntervalMs: number = 120;
  private volleyTimerMs: number = 0;
  private readonly volleyWindupMs: number = 600;
  private readonly mortarSpritePath: string = AssetLoader.normalizePath('/assets/projectiles/bullet_mortar.png');
  private readonly volleySpeed: number = 500; // px/s (500 * 3s ≈ 1500px travel)
  private readonly volleyLifeMs: number = 3000; // projectile lifespan
  // Fan spread arc for volley shots (radians). Wide arc for better readability
  private readonly volleyFanArcRad: number = Math.PI * 0.6; // ~108°
  // LS visibility gating: boss cannot cast or apply spell effects while hidden by FoW in Last Stand
  private lsBossCanAct(): boolean {
    try {
      const gi: any = (window as any).__gameInstance; if (!gi || gi.gameMode !== 'LAST_STAND') return true;
      const em: any = gi.enemyManager; const boss = this.boss; if (!boss) return false;
      const vis = em?.isVisibleInLastStand?.(boss.x, boss.y);
      return (vis !== false);
    } catch { return true; }
  }
  // --- Player damage routing helpers ---
  /** True if player should currently take damage (not during revive cinematic or i-frames). */
  private isPlayerVulnerable(): boolean {
    try {
      const now = performance.now();
      const anyP: any = this.player as any;
      if (anyP.invulnerableUntilMs && now < anyP.invulnerableUntilMs) return false;
      if ((window as any).__reviveCinematicActive) return false;
    } catch { /* ignore */ }
    return true;
  }
  /** Apply damage to player via Player.takeDamage when available, else subtract HP directly. */
  private damagePlayer(amount: number) {
    if (amount <= 0) return;
    try {
      if (!this.isPlayerVulnerable()) return;
      const p: any = this.player as any;
      if (typeof p.takeDamage === 'function') { p.takeDamage(amount); }
      else { this.player.hp -= amount; }
    } catch {
      this.player.hp -= amount;
    }
  }
  private showAlert(text: string, color = '#5EEBFF', durationMs = 1800) {
    const now = performance.now();
    this.alerts.push({ text, color, born: now, until: now + durationMs });
    // Keep last 4 alerts
    if (this.alerts.length > 4) this.alerts.splice(0, this.alerts.length - 4);
  }

  // Four-boss roster: id, sprite file, HP multiplier, and behavior flavor
  private readonly bossDefs = [
    { id: 'alpha', img: 'boss_phase1.png', hpMul: 1.0, behavior: 'balanced' as const },
    { id: 'beta',  img: 'boss_2.png',      hpMul: 1.1, behavior: 'nova' as const },
    { id: 'gamma', img: 'boss_3.png',      hpMul: 1.2, behavior: 'summoner' as const },
    { id: 'omega', img: 'boss_4.png',      hpMul: 1.3, behavior: 'dasher' as const }
  ];

  /** Compute exact special (overcharge) AoE radius used for both draw and damage. */
  private getSpecialRadius(): number {
    const r = this.boss?.radius || 80;
    return r + 120;
  }

  /** Inner radius where nova starts expanding from. */
  private getNovaInnerRadius(): number {
    const r = this.boss?.radius || 80;
    return r + 60;
  }

  /** Nova radius at normalized time t in [0,1]. */
  private getNovaRadiusAt(t: number): number {
    const inner = this.getNovaInnerRadius();
    return inner + (this.novaMaxRadius - inner) * Math.min(1, Math.max(0, t));
  }

  constructor(player: Player, particleManager?: ParticleManager, difficulty = 1, assetLoader?: AssetLoader) {
    this.player = player;
    this.particleManager = particleManager || null;
    this.difficulty = difficulty;
    this.lastBossSpawnTime = 0; // Initialize to 0
  this.assetLoader = assetLoader || null;
  this.loadBossImageFor('alpha');
  // Preload mortar sprite for volley projectiles (non-fatal if missing)
  try { this.assetLoader?.loadImage(this.mortarSpritePath); } catch {}
  // Expose globally for systems that need boss reference
  try { (window as any).__bossManager = this; } catch {}
    // Sandbox hook: allow forced boss spawn even in SANDBOX
    try {
      window.addEventListener('sandboxSpawnBoss', (e: Event) => {
        const ce = e as CustomEvent<{ x?: number; y?: number; cinematic?: boolean; id?: string }>;
        const dx = ce?.detail?.x;
        const dy = ce?.detail?.y;
        const id = ce?.detail?.id;
        const payload = (typeof dx === 'number' && typeof dy === 'number')
          ? { x: dx, y: dy, cinematic: ce.detail?.cinematic !== false, id }
          : (id ? { id } as any : undefined);
        this.spawnBoss(payload);
      });
      // Sandbox hook: force-cast a specific boss spell if possible
      window.addEventListener('sandboxForceBossSpell', (e: Event) => {
        const ce = e as CustomEvent<{ spell: 'supernova' | 'multinova' | 'shocknova' | 'dash' | 'cross' | 'earth' | 'rifts' | 'rift_barrage' | 'volley' }>
        if (!this.boss || this.boss.state !== 'ACTIVE' || this.spellState !== 'IDLE') return;
        const sp = ce?.detail?.spell;
        switch (sp) {
          case 'supernova': this.startSuperNova(); break;
          case 'multinova': this.startMultiNova(); break;
          case 'shocknova': this.startShockNova(); break;
          case 'dash': {
            const dx = this.player.x - this.boss.x; const dy = this.player.y - this.boss.y; const d = Math.hypot(dx, dy) || 1;
            this.startLineDash(dx, dy, d); break;
          }
          case 'cross': this.startCrossSlash(); break;
          case 'earth': this.startEarthshatter(); break;
          case 'rifts': this.startSummonRifts(); break;
          case 'rift_barrage': this.startRiftBarrage(); break;
          case 'volley': this.startVolley(); break;
        }
      });
    } catch {}
  }

  private loadBossImageFor(id: string) {
    // Cache-aware loader
  if (Object.prototype.hasOwnProperty.call(this.bossImageCache, id)) { this.bossImage = this.bossImageCache[id]; return; }
    const def = this.bossDefs.find(b => b.id === id) || this.bossDefs[0];
  const file = def.img;
  // Normalize path via AssetLoader to support subfolder hosting
  const raw = `/assets/boss/${file}`;
  const path = AssetLoader.normalizePath(raw);
    const img = new Image();
    img.onload = () => { this.bossImageCache[id] = img; this.bossImage = img; };
    img.onerror = () => { this.bossImageCache[id] = null; this.bossImage = null; };
    img.src = path;
  }

  public update(deltaTime: number, gameTime: number) { // Added gameTime parameter
    // Suppress boss logic entirely in Sandbox mode
    try {
      const gm = (window as any).__gameInstance?.gameMode;
  // In sandbox, still update if a boss was explicitly spawned
  if (gm === 'SANDBOX' && !this.boss) return;
    } catch {}
    if (!this.boss) {
      // In Last Stand, boss spawns are coordinated by the LS controller at milestone waves.
      // In other modes, spawn on paced interval (default 180s) to stretch run length.
      let shouldAutoSpawn = true;
      try {
        const gm = (window as any).__gameInstance?.gameMode;
        if (gm === 'LAST_STAND') shouldAutoSpawn = false;
      } catch {}
      if (shouldAutoSpawn) {
        if (gameTime - this.lastBossSpawnTime >= BOSS_SPAWN_INTERVAL_SEC) {
          this.spawnBoss();
          this.lastBossSpawnTime = gameTime;
        }
      }
    } else if (this.boss.state === 'TELEGRAPH') {
      // In Last Stand, pause telegraph countdown while boss is hidden by FoW
      let canTick = true;
      try {
        const gi: any = (window as any).__gameInstance; if (gi && gi.gameMode === 'LAST_STAND') {
          const em: any = gi.enemyManager;
          const vis = em?.isVisibleInLastStand?.(this.boss.x, this.boss.y);
          if (vis === false) canTick = false;
        }
      } catch { /* ignore */ }
      // Telegraph counts down in ms
      if (canTick) this.boss.telegraph -= deltaTime; else this.boss.telegraph -= 0;
      // Particle throttle ~ every 50ms
      if (this.particleManager) {
        this.telegraphFxAccMs += deltaTime;
        while (this.telegraphFxAccMs >= 50) {
          this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#f55');
          this.telegraphFxAccMs -= 50;
        }
      }
  if (this.boss.telegraph <= 0) {
        this.boss.state = 'ACTIVE';
        const hasteFrames = Math.min(12, (this.bossSpawnCount - 1) * 2);
        const nextFrames = 60 - hasteFrames;
        this.boss.attackTimer = nextFrames * this.MS_PER_FRAME;
        try {
          const id = (this.boss as any).id || 'alpha';
          const label = id === 'alpha' ? 'ALPHA' : id === 'beta' ? 'BETA' : id === 'gamma' ? 'GAMMA' : 'OMEGA';
          this.showAlert(`BOSS ${label} ENGAGED`, '#FFD700', 2200);
        } catch {}
      }
  } else if (this.boss && this.boss.state === 'ACTIVE') {
  const canAct = this.lsBossCanAct();
    const dx = this.player.x - this.boss.x;
      const dy = this.player.y - this.boss.y;
      const dist = Math.hypot(dx, dy);
      const isSpellActive = this.spellState !== 'IDLE';
      // Special attack logic
  if (this.boss.specialCharge == null) this.boss.specialCharge = 0;
  if (this.boss.specialReady == null) this.boss.specialReady = false;
  // Defer building and executing special while a spell is active to avoid interruptions
  if (!this.boss.specialReady) {
        // Move slower
        if (!isSpellActive && dist > 0) {
          // Base boss chase speed (px/frame)
          let speed = 0.7;
          // Status effects affecting boss movement
          const bAny: any = this.boss as any;
          const now = performance.now();
          // Rogue Hacker paralysis: hard stop
          if (bAny._paralyzedUntil && bAny._paralyzedUntil > now) {
            speed = 0;
          } else {
            // Poison slow + evolved Bio (Living Sludge) 20% floor when poisoned or in sludge
            let slow = 0;
            const stacks = (bAny._poisonStacks | 0) || 0;
            if (stacks > 0) slow = Math.max(slow, Math.min(0.20, stacks * 0.01));
            try {
              const hasSludge = (this.player?.activeWeapons?.has(WeaponType.LIVING_SLUDGE)) === true;
              if (hasSludge) {
                if (stacks > 0 || ((bAny._inSludgeUntil || 0) > now)) slow = Math.max(slow, 0.20);
              }
            } catch { /* ignore */ }
            speed *= (1 - slow);
          }
          const stepX = (dx / dist) * speed;
          const stepY = (dy / dist) * speed;
          this.boss.x += stepX;
          this.boss.y += stepY;
          // Track last non-zero horizontal direction for facing
          if (Math.abs(stepX) > 0.0001) bAny._facingX = stepX < 0 ? -1 : 1;
          // Walk-cycle flip at fixed interval while moving
          const mvMag = Math.hypot(stepX, stepY);
          if (mvMag > 0.01) {
            this.bossWalkFlipTimerMs += deltaTime;
            while (this.bossWalkFlipTimerMs >= this.bossWalkIntervalMs) {
              this.bossWalkFlip = !this.bossWalkFlip;
              this.bossWalkFlipTimerMs -= this.bossWalkIntervalMs;
            }
          }
        }
        // Build charge only while idle (no active spell) to avoid mid-spell special pop
        if (!isSpellActive && canAct) {
          this.boss.specialCharge = (this.boss.specialCharge || 0) + deltaTime;
          if (this.boss.specialCharge > 6000) { // Charge for 6 seconds
            this.boss.specialReady = true;
            this.boss.specialCharge = 0;
          }
        }
      } else {
        // Telegraph special attack: stop and charge for 3 seconds
        // Only telegraph/execute special when idle and visible; if hidden or a spell is active, pause
        if (!isSpellActive && canAct) this.boss.specialCharge = (this.boss.specialCharge || 0) + deltaTime;
        if (this.boss.specialCharge < this.specialWindupMs) {
          // Show telegraph effect (spawn particles less frequently)
          if (this.particleManager && canAct) {
            // piggyback on telegraph FX cadence: drop a pulse every 120ms during special charge
            this.telegraphFxAccMs += deltaTime;
            while (this.telegraphFxAccMs >= 120) {
              this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#FF00FF');
              this.telegraphFxAccMs -= 120;
            }
          }
        } else if (!isSpellActive && canAct) {
          // Unleash special attack (e.g., massive area damage)
          if (dist < this.getSpecialRadius()) {
            const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
            this.damagePlayer(Math.round(80 * specialScale)); // Scaled special damage
            if (this.particleManager) this.particleManager.spawn(this.player.x, this.player.y, 2, '#FF0000'); // Reduced particles
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 300, intensity: 10 } })); // Screen shake on special attack
          }
          this.boss.specialReady = false;
          this.boss.specialCharge = 0;
        }
      }
      // Clamp boss to walkable after movement
      const rm = (window as any).__roomManager;
      if (rm && typeof rm.clampToWalkable === 'function') {
        const c = rm.clampToWalkable(this.boss.x, this.boss.y, this.boss.radius || 80);
        this.boss.x = c.x; this.boss.y = c.y;
      }
      // Attack wave timer in ms
      this.boss.attackTimer -= deltaTime;
      if (this.boss.attackTimer <= 0) {
        if (canAct) {
          this.launchAttackWave();
        } else {
          // Delay basic attacks while hidden in LS
          this.boss.attackTimer = 120;
        }
        const spawnHasteFrames = Math.min(20, (this.bossSpawnCount - 1) * 2);
        const baseFrames = 52;
        const nextFrames = Math.max(22, baseFrames - (this.difficulty - 1) * 10 - spawnHasteFrames);
        this.boss.attackTimer = nextFrames * this.MS_PER_FRAME;
      }
      // Decide and advance spells when not in boss special telegraph
      if (!this.boss.specialReady) {
        if (performance.now() >= this.nextSpellAtMs && this.spellState === 'IDLE') {
          if (!canAct) { this.nextSpellAtMs = performance.now() + 250; }
          else {
          const identity = (this.boss as any).id as string | undefined;
          const beh = this.bossDefs.find(b => b.id === identity)?.behavior || 'balanced';
          // Exclusive kits per boss
          if (beh === 'nova') {
            // Beta: Volley, Multi‑Nova or Supernova (no dash). Pity enforces Supernova periodically.
            if (this.betaNovaPity >= this.betaPityThreshold) {
              this.startSuperNova();
            } else {
              const r = Math.random();
              if (r < 0.36) this.startVolley();
              else if (r < 0.72) this.startMultiNova();
              else this.startSuperNova();
            }
          } else if (beh === 'summoner') {
            // Gamma: Rifts or Rift Barrage (no nova/dash)
            if (Math.random() < 0.6) this.startSummonRifts(); else this.startRiftBarrage();
          } else if (beh === 'dasher') {
            // Omega: Chain dashes, and sometimes Cross Slash as a standalone
            if (Math.random() < 0.75) this.startLineDash(dx, dy, dist); else this.startCrossSlash();
          } else {
            // Alpha: Cone Slam or Earthshatter
            if (Math.random() < 0.55) this.startConeSlam(dx, dy, dist); else this.startEarthshatter();
          }
          }
        }
        if (this.spellState !== 'IDLE') this.updateSpells(deltaTime);
      }
      // Hazards must update every frame regardless of spell state
      this.updateHazards(deltaTime);
        // Player-boss collision with 1s cooldown contact damage (30 fixed damage to player)
      if (dist < this.player.radius + this.boss.radius) {
        const now = performance.now();
        // During post-dash recovery, suppress general contact damage
        if (now < this.postDashRecoverUntilMs) {
          // still apply tiny positional separation to avoid sticking
          if (dist > 0) {
            const nx = dx / dist; const ny = dy / dist;
            if (!(window as any).__reviveCinematicActive) { this.player.x -= nx * 6; this.player.y -= ny * 6; }
            this.boss.x += nx * 4; this.boss.y += ny * 4;
          }
        } else {
        if (canAct && (!this.boss.lastContactHitTime || now - this.boss.lastContactHitTime >= 1000)) {
          this.boss.lastContactHitTime = now;
          this.damagePlayer(30); // fixed contact damage base
          this.damagePlayer(Math.round(30 * (1 + 0.18 * (this.bossSpawnCount - 1))) - 30); // additional scaled damage over base
          this.boss._damageFlash = 12; // flash when successful hit
          // Knockback only when damage actually applied
          if (dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const playerKb = 64 * (this.player.getKnockbackMultiplier ? this.player.getKnockbackMultiplier() : 1); // respect player KB resistance
            const bossKb = 24;
            if (!(window as any).__reviveCinematicActive) { this.player.x -= nx * playerKb; this.player.y -= ny * playerKb; }
            this.boss.x += nx * bossKb;
            this.boss.y += ny * bossKb;
          }
          if (this.particleManager) {
            this.particleManager.spawn(this.player.x, this.player.y, 2, '#f00');
          }
        }
        }
      }
      if (this.boss._damageFlash && this.boss._damageFlash > 0) {
        this.boss._damageFlash--;
      }
      // Phase thresholds
      const hpPct = this.boss.hp / this.boss.maxHp;
      if (hpPct < 0.4 && (this.boss as any)._phase < 3) {
        (this.boss as any)._phase = 3;
  this.boss.attackTimer = 30 * this.MS_PER_FRAME; // faster (~500ms)
        if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#FF00FF');
      } else if (hpPct < 0.7 && (this.boss as any)._phase < 2) {
        (this.boss as any)._phase = 2;
  this.boss.attackTimer = 45 * this.MS_PER_FRAME; // (~750ms)
        if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 2, '#C400FF');
      }
      if (this.boss.hp <= 0) {
        // Mark dead and dispatch rewards/FX
        this.boss.state = 'DEAD';
        this.spawnChest(this.boss.x, this.boss.y); // Spawn chest on boss defeat
        window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 500, intensity: 15 } })); // Stronger shake on boss defeat
        // Vacuum gems QoL
        window.dispatchEvent(new CustomEvent('bossGemVacuum'));
        // Special drops: guaranteed Magnet item and a destructible treasure that yields a random special
        try {
          // Magnet near player
          const px = this.player.x, py = this.player.y;
          const ang = Math.random() * Math.PI * 2;
          const r = 80;
          window.dispatchEvent(new CustomEvent('spawnSpecialItem', { detail: { x: px + Math.cos(ang) * r, y: py + Math.sin(ang) * r, type: 'MAGNET' } }));
        } catch {}
        try {
          // Treasure at boss death spot
          window.dispatchEvent(new CustomEvent('spawnTreasure', { detail: { x: this.boss.x, y: this.boss.y, hp: 250 } }));
        } catch {}
        // Notify game systems for reward handling (double upgrade)
        window.dispatchEvent(new CustomEvent('bossDefeated'));
        // Despawn immediately and start interval timer for next spawn
        this.boss = null;
        this.spellState = 'IDLE';
        this.spellTimerMs = 0;
        this.novaHitApplied = false;
  this.nextSpellAtMs = 0;
  this.hazards.length = 0;
  // Do not reset lastBossSpawnTime here; keep interval anchored to original schedule
  // This ensures if a boss dies late (after the next interval), the next boss spawns immediately.
      }
    }
  }

  private spawnBoss(pos?: { x?: number; y?: number; cinematic?: boolean; id?: string }) {
    // Spawn boss close to player
    const px = this.player.x;
    const py = this.player.y;
    let bx = px, by = py;
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      bx = pos.x; by = pos.y;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const dist = 300 + Math.random() * 160; // spawn slightly farther to reduce immediate crowding
      bx = px + Math.cos(angle) * dist;
      by = py + Math.sin(angle) * dist;
    }
    // In Last Stand, bias spawn into the corridor center line to avoid off-path or off-screen entries
    try {
      const gi: any = (window as any).__gameInstance; const ls = gi?.lastStand; const gm = gi?.gameMode;
      if (gm === 'LAST_STAND' && ls && typeof ls.getGate === 'function') {
        const cor: any = (ls as any).corridor || null;
        const core: any = (window as any).__lsCore;
        const cy = core?.y ?? this.player.y;
        if (cor && cy != null) {
          // Push X inside corridor and close to gate x+ (so boss arrives fairly)
          const wallX = (ls as any).holders?.[0]?.x ?? (cor.x + Math.floor(cor.w * 0.35));
          const holdW = (ls as any).holders?.[0]?.w ?? 36;
          const minX = cor.x + 40, maxX = cor.x + cor.w - 120;
          bx = Math.min(maxX, Math.max(minX, Math.max(bx, wallX + holdW + 140)));
          by = cy;
        }
      }
    } catch { /* ignore */ }
    // Choose boss definition
    // In standard modes (SHOWDOWN/DUNGEON), always spawn Boss 2 (Beta) for now.
    // In SANDBOX, keep rotation and allow forced id via payload.
    const gm = (() => { try { return (window as any).__gameInstance?.gameMode as string | undefined; } catch { return undefined; } })();
    const beta = this.bossDefs.find(b => b.id === 'beta') || this.bossDefs[0];
    let def = beta;
    if (gm === 'SANDBOX') {
      // Sandbox: honor rotation and any explicit id
      def = this.bossDefs[this.bossCycleIndex % this.bossDefs.length];
      if (pos?.id) {
        const forced = this.bossDefs.find(b => b.id === pos.id);
        if (forced) def = forced;
      }
    } else {
      // Non-sandbox: ignore forced id and rotation; always Beta
      def = beta;
    }
    // Oppenheimer-style cinematic entrance: screen shake, and announce boss identity for UI
    if (window && window.dispatchEvent) {
      const cinematic = pos?.cinematic !== false; // default true if not provided
      window.dispatchEvent(new CustomEvent('bossSpawn', { detail: { x: bx, y: by, cinematic, id: def.id } }));
      if (cinematic) window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 200, intensity: 8 } }));
    }
  const bossHp = 12000; // Tripled base boss HP per request
    let spawnX = bx, spawnY = by;
    const rm = (window as any).__roomManager;
    if (rm && typeof rm.clampToWalkable === 'function') {
      const c = rm.clampToWalkable(bx, by, 80);
      spawnX = c.x; spawnY = c.y;
    }
  this.bossSpawnCount++;
  // Reset boss walk-cycle state on new spawn
  this.bossWalkFlip = false;
  this.bossWalkFlipTimerMs = 0;
  const n = this.bossSpawnCount;
  const hpScale = Math.pow(1 + 0.55 * (n - 1), 1.18);
  // Maintain rotation index only in SANDBOX (for variety/testing)
  if (gm === 'SANDBOX') {
    if (!pos?.id) {
      def = this.bossDefs[this.bossCycleIndex % this.bossDefs.length];
    }
    this.bossCycleIndex = (this.bossCycleIndex + 1) % this.bossDefs.length;
  }
  this.loadBossImageFor(def.id);
  const scaledHp = Math.round(bossHp * hpScale * def.hpMul);
    const isSandbox = (() => { try { return (window as any).__gameInstance?.gameMode === 'SANDBOX'; } catch { return false; } })();
    this.boss = {
      x: spawnX,
      y: spawnY,
      hp: scaledHp,
  maxHp: scaledHp, // Set maxHp for HP bar drawing
      radius: 80, // half previous size
      active: true,
      telegraph: isSandbox ? 600 : 3000, // shorter delay in SANDBOX so boss becomes attackable quickly
      state: 'TELEGRAPH',
      attackTimer: 0, // ms
      _damageFlash: 0
    };
  // Mark identity for codex and future multi-boss support
  try { (this.boss as any).id = def.id; } catch {}
  (this.boss as any)._phase = 1;
  // Prime spells after brief delay to let player orient (shorter idle)
  this.nextSpellAtMs = performance.now() + 1200;
  this.spellState = 'IDLE';
  this.spellTimerMs = 0;
  this.novaHitApplied = false;
  this.telegraphFxAccMs = 0;
  this.hazards.length = 0; // clear lingering hazards between bosses
    // Immediately activate boss fight overlay
    if (window && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('bossFightStart', { detail: { boss: this.boss } }));
    }
    // Reset pity counters on spawn (only relevant for Beta behavior)
    try {
      const identity = (this.boss as any)?.id as string | undefined;
      const beh = this.bossDefs.find(b => b.id === identity)?.behavior;
      if (beh === 'nova') this.betaNovaPity = 0; else this.betaNovaPity = 0;
    } catch { this.betaNovaPity = 0; }
  }

  private spawnChest(x: number, y: number): void {
    // Dispatch an event that EnemyManager (or a new ChestManager) can listen to
    window.dispatchEvent(new CustomEvent('spawnChest', { detail: { x, y } }));
  }

  private launchAttackWave() {
    if (!this.boss) return;
    // spawn telegraph pulses before actual projectiles
    if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#f90'); // Reduced particles
    // Boss spawns minions every 3rd attack
    if (Math.random() < 0.33) {
      if (window && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('bossMinionSpawn', { detail: { x: this.boss.x, y: this.boss.y, count: 3 + this.difficulty } }));
      }
    }
    // create projectiles that will be handled by Game-level projectile system
    const event = new CustomEvent('bossAttack', { detail: { x: this.boss.x, y: this.boss.y, intensity: this.difficulty } });
    window.dispatchEvent(event);
    // Visual effect: flash
    if (this.particleManager) this.particleManager.spawn(this.boss.x, this.boss.y, 1, '#fff'); // Reduced particles
    // XP spray at 20% HP chunks
    if (this.boss && this.boss.state === 'ACTIVE') {
      const pct = this.boss.hp / this.boss.maxHp;
      const lastPct = (this.boss as any)._lastSprayPct ?? 1;
      if (pct < lastPct - 0.20) {
        (this.boss as any)._lastSprayPct = pct;
        window.dispatchEvent(new CustomEvent('bossXPSpray', { detail: { x: this.boss.x, y: this.boss.y } }));
      }
    }
  }
 
  public draw(ctx: CanvasRenderingContext2D) {
    if (!this.boss) return;
   // Reset per-frame screen overlay alpha; specific spells may raise it during their draw blocks.
   this.screenDarkenAlpha = 0;
    if (this.boss.state === 'TELEGRAPH') {
      // Oppenheimer-style telegraph: slow-motion, intense glow, cinematic overlay
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.font = 'bold 64px Orbitron, Arial';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#FF00FF';
      ctx.shadowBlur = 32;
      ctx.fillText('BOSS APPROACHING', ctx.canvas.width/2, ctx.canvas.height/2 - 80);
      ctx.font = 'bold 32px Orbitron, Arial';
      ctx.fillStyle = '#FF00FF';
      ctx.fillText('Prepare for Impact', ctx.canvas.width/2, ctx.canvas.height/2 - 20);
      ctx.restore();
      // Massive glowing telegraph ring
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.8)';
      ctx.lineWidth = 24;
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 64;
      ctx.beginPath();
      ctx.arc(this.boss.x, this.boss.y, this.boss.radius + 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
  } else if (this.boss.state === 'ACTIVE') {
      // Large HP bar above boss
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#222';
      ctx.fillRect(this.boss.x - 120, this.boss.y - this.boss.radius - 38, 240, 22);
  ctx.fillStyle = '#f00';
  // Use dynamic maxHp instead of a hard-coded denominator so bar reflects real progress
  const hpPctRaw = this.boss.maxHp > 0 ? this.boss.hp / this.boss.maxHp : 0;
  const hpPct = Math.min(1, Math.max(0, hpPctRaw));
  ctx.fillRect(this.boss.x - 120, this.boss.y - this.boss.radius - 38, 240 * hpPct, 22);
      ctx.font = 'bold 18px Orbitron, Arial';
      ctx.fillStyle = '#FFD700';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS HP', this.boss.x, this.boss.y - this.boss.radius - 44);
      ctx.restore();
      // Boss body with damage flash and shake
      ctx.save();
      if (this.boss._damageFlash && this.boss._damageFlash > 0) {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(this.boss._damageFlash * 2);
        ctx.translate((Math.random()-0.5)*8, (Math.random()-0.5)*8);
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 48;
      }
      if (this.bossImage) {
  const size = this.boss.radius*2;
  const bAny: any = this.boss as any;
  const faceLeft = (bAny._facingX ?? ((this.player.x < this.boss.x) ? -1 : 1)) < 0;
        ctx.save();
        ctx.translate(this.boss.x, this.boss.y);
  // Compose movement-facing flip with walk-cycle flip
  const flipX = (faceLeft ? -1 : 1) * (this.bossWalkFlip ? -1 : 1);
  if (flipX < 0) ctx.scale(-1, 1);
        ctx.drawImage(this.bossImage, -size/2, -size/2, size, size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(this.boss.x, this.boss.y, this.boss.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#FFD700';
        ctx.fill();
      }
      ctx.restore();
      // Eye overlay suppressed when using boss image (eyes baked into PNG)
      if (!this.bossImage) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.boss.x-48, this.boss.y-32, 24, 0, Math.PI*2);
        ctx.arc(this.boss.x+48, this.boss.y-32, 24, 0, Math.PI*2);
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#FF00FF';
        ctx.shadowBlur = 32;
        ctx.globalAlpha = 0.9 + 0.1*Math.sin(Date.now()/200);
        ctx.fill();
        ctx.restore();
      }
  // Spell telegraphs and effects
      // Overcharge special telegraph (3s): visualize exact AoE when charging
      if (this.boss.specialReady) {
  const sc = this.boss.specialCharge || 0;
  const t = Math.min(1, sc / this.specialWindupMs);
        const r = (this.boss.radius || 80) + 120;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.18 + 0.32 * t;
        // Fill glow
        const grad = ctx.createRadialGradient(this.boss.x, this.boss.y, r * 0.75, this.boss.x, this.boss.y, r);
        grad.addColorStop(0, 'rgba(255,0,255,0.05)');
        grad.addColorStop(1, 'rgba(255,0,255,0.15)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r, 0, Math.PI * 2); ctx.fill();
        // Edge ring
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#FF00FF';
        ctx.shadowColor = '#FF66FF';
        ctx.shadowBlur = 24;
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r, 0, Math.PI * 2); ctx.stroke();
        // Countdown ticks around ring
        const ticks = 12;
        for (let i = 0; i < Math.floor(t * ticks); i++) {
          const ang = (i / ticks) * Math.PI * 2;
          const ix = this.boss.x + Math.cos(ang) * (r - 14);
          const iy = this.boss.y + Math.sin(ang) * (r - 14);
          const ox = this.boss.x + Math.cos(ang) * (r + 6);
          const oy = this.boss.y + Math.sin(ang) * (r + 6);
          ctx.beginPath();
          ctx.moveTo(ix, iy);
          ctx.lineTo(ox, oy);
          ctx.stroke();
        }
        ctx.restore();
      }
  if (this.spellState === 'NOVA_CHARGE' || this.spellState === 'NOVA_RELEASE') {
        const tRaw = this.spellTimerMs / this.novaChargeMs;
        const t = Math.min(1, Math.max(0, tRaw));
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        // Charge glow
        ctx.globalAlpha = 0.18 + 0.22 * t;
        ctx.fillStyle = '#B266FF';
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, this.boss.radius + 40 + 10 * Math.sin(performance.now()*0.02), 0, Math.PI*2); ctx.fill();
        // Exact damage ring at true radius (center of hit band). Use thicker lineWidth to visualize full band.
        const r = (this.spellState === 'NOVA_RELEASE') ? this.novaRadius : this.getNovaRadiusAt(t);
        ctx.globalAlpha = 0.38;
        ctx.lineWidth = this.novaHitBand * 2; // match band thickness
        ctx.strokeStyle = '#CC66FF';
        ctx.shadowColor = '#CC66FF';
        ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r, 0, Math.PI*2); ctx.stroke();
        // Crisp core edge to reduce perception mismatch
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r + this.novaHitBand, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
      }
      // Supernova telegraph and explosion (simplified fiery flash)
      if (this.spellState === 'SUPERNOVA_CHARGE' || this.spellState === 'SUPERNOVA_RELEASE') {
        const easeInOutCubic = (x:number)=> x<0.5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2;
        const tRaw = this.spellTimerMs / (this.spellState==='SUPERNOVA_CHARGE'? this.superNovaChargeMs : this.superNovaReleaseMs);
        const t = Math.min(1, Math.max(0, tRaw));
        const te = easeInOutCubic(t);
        const base = (this.boss.radius || 80) + 90;
        const maxR = base + 440;
        const r = base + (maxR - base) * te;
        // Request a screen-space darken overlay (drawn by Game after world restore)
        this.screenDarkenAlpha = Math.max(this.screenDarkenAlpha, 0.20 + 0.25 * te);
        ctx.save();
        // Fiery core and shockwave fill
        ctx.globalCompositeOperation = 'screen';
        const grad = ctx.createRadialGradient(this.boss.x, this.boss.y, r*0.2, this.boss.x, this.boss.y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.25, 'rgba(255,120,60,0.75)');
        grad.addColorStop(0.55, 'rgba(220,30,30,0.55)');
        grad.addColorStop(0.85, 'rgba(120,0,0,0.3)');
        grad.addColorStop(1, 'rgba(0,0,0,0.0)');
        ctx.globalAlpha = (this.spellState==='SUPERNOVA_CHARGE') ? 0.35*te : 0.8;
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
      }
      // Earthshatter telegraph (radial sectors)
      if (this.spellState === 'EARTH_WINDUP' || this.spellState === 'EARTH_RELEASE') {
        const t = Math.min(1, this.spellTimerMs / this.earthWindupMs);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.15 + 0.35 * t;
        ctx.strokeStyle = '#FF5533';
        ctx.lineWidth = 3;
        const rays = 8;
        const len = 380;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(this.boss.x, this.boss.y);
          ctx.lineTo(this.boss.x + Math.cos(a) * len, this.boss.y + Math.sin(a) * len);
          ctx.stroke();
        }
        ctx.restore();
      }
      // Rift barrage telegraph (ring pips)
      if (this.spellState === 'RIFT_BARRAGE_WINDUP') {
        const t = Math.min(1, this.spellTimerMs / this.riftBarrageWindupMs);
        const cx = this.player.x, cy = this.player.y;
        const rad = 280;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.14 + 0.26 * t;
        ctx.strokeStyle = '#FFA733'; ctx.fillStyle = 'rgba(255,167,51,0.10)';
        const dots = 12;
        for (let i = 0; i < dots; i++) {
          const a = (i/dots) * Math.PI*2;
          const x = cx + Math.cos(a) * rad;
          const y = cy + Math.sin(a) * rad;
          ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI*2); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 18 * t, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }
      // Volley windup telegraph (cone beads toward player)
      if (this.spellState === 'VOLLEY_WINDUP') {
        const t = Math.min(1, this.spellTimerMs / this.volleyWindupMs);
  const bx = this.boss!.x, by = this.boss!.y;
  const baseA = Math.atan2(this.player.y - by, this.player.x - bx);
        const arc = this.volleyFanArcRad;
        const aL = baseA - arc/2;
        const aR = baseA + arc/2;
        const rMax = 220;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        // Wedge fill
        ctx.globalAlpha = 0.10 + 0.18 * t;
        ctx.fillStyle = 'rgba(255,220,100,0.14)';
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.arc(bx, by, rMax, aL, aR);
        ctx.closePath();
        ctx.fill();
        // Edge guides
        ctx.globalAlpha = 0.24 + 0.26 * t;
        ctx.strokeStyle = '#FFDD66';
        ctx.lineWidth = 2;
        const drawRay = (ang:number) => {
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ang) * rMax, by + Math.sin(ang) * rMax);
          ctx.stroke();
        };
        drawRay(aL); drawRay(aR);
        // Five shot indicators spaced across arc corresponding to each shell
        const shots = 5;
        for (let i = 0; i < shots; i++) {
          const tt = shots > 1 ? (i / (shots - 1)) : 0.5;
          const ang = aL + arc * tt;
          const r = 80 + 80 * t; // grow outward slightly during windup
          const x = bx + Math.cos(ang) * r;
          const y = by + Math.sin(ang) * r;
          ctx.globalAlpha = 0.25 + 0.45 * t;
          ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2); ctx.stroke();
          ctx.globalAlpha = 0.10 + 0.30 * t;
          ctx.beginPath(); ctx.arc(x, y, 10 * t, 0, Math.PI*2); ctx.fill();
        }
        ctx.restore();
      }
      // Cross slash telegraph
      if (this.spellState === 'CROSS_WINDUP' || this.spellState === 'CROSS_RELEASE') {
        const t = Math.min(1, this.spellTimerMs / this.crossWindupMs);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.16 + 0.34 * t;
        ctx.strokeStyle = '#FF3366';
        ctx.lineWidth = 5;
        const L = 420;
        const drawLine = (ax:number) => {
          const dx = Math.cos(ax), dy = Math.sin(ax);
          ctx.beginPath();
          ctx.moveTo(this.boss!.x - dx * L, this.boss!.y - dy * L);
          ctx.lineTo(this.boss!.x + dx * L, this.boss!.y + dy * L);
          ctx.stroke();
        };
        drawLine(0);
        drawLine(Math.PI/2);
        drawLine(Math.PI/4);
        drawLine(-Math.PI/4);
        ctx.restore();
      }
      // Multi‑nova: rings appear one-by-one and continue moving outward until the sequence ends
      if (this.spellState === 'MULTINOVA_CHARGE' || this.spellState === 'MULTINOVA_RELEASE') {
        const baseInner = this.getNovaInnerRadius();
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.28;
        const ringCountToDraw = (this.spellState === 'MULTINOVA_CHARGE') ? 1 : this.multiNovaCount;
        for (let i = 0; i < ringCountToDraw; i++) {
          const offset = (this.spellState === 'MULTINOVA_RELEASE') ? Math.max(0, this.multiNovaGlobalT - i) : 0;
          const r = baseInner + offset * this.multiNovaSpacing;
          ctx.lineWidth = this.novaHitBand * 2.2;
          ctx.strokeStyle = (this.spellState === 'MULTINOVA_RELEASE') ? '#FF66CC' : '#8844FF';
          ctx.shadowColor = '#CC66FF'; ctx.shadowBlur = 10;
          const gaps = this.multiNovaGaps[i] || [];
          let start = 0;
          for (let g = 0; g <= gaps.length; g++) {
            const s = g < gaps.length ? gaps[g].start : Math.PI*2;
            const e = g < gaps.length ? gaps[g].end : Math.PI*2;
            if (s > start + 0.001) { ctx.beginPath(); ctx.arc(this.boss.x, this.boss.y, r, start, s); ctx.stroke(); }
            start = e;
          }
        }
        ctx.restore();
      }
      // Cone slam telegraph
      if (this.spellState === 'CONE_WINDUP' || this.spellState === 'CONE_RELEASE') {
        const t = Math.min(1, this.spellTimerMs / this.coneWindupMs);
        const a = Math.atan2(this.coneDirY, this.coneDirX);
        const r = this.coneRange;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.20 + 0.30 * t;
        ctx.fillStyle = 'rgba(255,80,60,0.15)';
        ctx.strokeStyle = '#FF5533';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.boss.x, this.boss.y);
        ctx.arc(this.boss.x, this.boss.y, r, a - this.coneArcRad, a + this.coneArcRad);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      // (Cinematic alerts moved to screen-space layer; see drawScreenFX/drawAlerts)
      // Draw lightweight hazards (telegraphs/lines/projectiles) so boss attacks are visible
      if (this.hazards.length) {
        const now = this.spellTimerMs; // not used directly; keep local for future effects
        for (let i = 0; i < this.hazards.length; i++) {
          const hz = this.hazards[i];
          // Visualize windup as faint outline/fill, then brighter when active
          const live = hz.elapsedMs < hz.windupMs + hz.activeMs;
          if (!live) continue;
          const active = hz.elapsedMs >= hz.windupMs;
          const alpha = active ? 0.9 : 0.35;
          if (hz.kind === 'aoe' && hz.radius) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = active ? 0.22 : 0.12;
            ctx.fillStyle = hz.color;
            ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI*2); ctx.fill();
            ctx.globalAlpha = alpha;
            ctx.lineWidth = active ? 3 : 2;
            ctx.strokeStyle = hz.color;
            ctx.shadowColor = hz.color; ctx.shadowBlur = active ? 16 : 8;
            ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.radius, 0, Math.PI*2); ctx.stroke();
            ctx.restore();
          } else if (hz.kind === 'line' && hz.x2 != null && hz.y2 != null && hz.width) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = active ? 0.26 : 0.14;
            ctx.strokeStyle = hz.color;
            ctx.lineWidth = hz.width;
            ctx.shadowColor = hz.color; ctx.shadowBlur = active ? 14 : 8;
            ctx.beginPath();
            ctx.moveTo(hz.x, hz.y);
            ctx.lineTo(hz.x2, hz.y2);
            ctx.stroke();
            ctx.restore();
          } else if (hz.kind === 'proj') {
            // Draw mortar shell as sprite if available, else circle
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = Math.max(0.25, Math.min(1, alpha));
            const img = this.assetLoader?.getImage(hz.sprite || this.mortarSpritePath);
            if (img) {
              // Orient sprite to velocity direction
              const ang = Math.atan2(hz.vy || 0, hz.vx || 1);
              const size = 20;
              ctx.translate(hz.x, hz.y);
              ctx.rotate(ang);
              ctx.drawImage(img, -size/2, -size/2, size, size);
            } else {
              // Fallback: glowing orb
              ctx.globalCompositeOperation = 'screen';
              ctx.fillStyle = hz.color || '#FFDD66';
              ctx.beginPath(); ctx.arc(hz.x, hz.y, (hz.radius || 10), 0, Math.PI*2); ctx.fill();
            }
            ctx.restore();
          }
        }
      }
    }
  }

  /**
   * Draws screen-space darkening effects (e.g., Supernova black overlay).
   * Call from Game AFTER world restore and BEFORE HUD so UI stays readable.
   */
  public drawScreenFX(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.screenDarkenAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, this.screenDarkenAlpha));
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  /**
   * Draws cinematic alerts in screen space. Call last, after HUD, to ensure visibility.
   */
  public drawAlerts(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const now = performance.now();
    // Draw big sticky banner first if active
    if (this.bannerText && now < this.bannerUntil) {
      ctx.save();
      const t = Math.max(0, Math.min(1, (this.bannerUntil - now) / 300)); // slight fade near end
      ctx.globalAlpha = 0.8 * (0.7 + 0.3 * t);
      ctx.font = 'bold 54px Orbitron, Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.bannerColor;
      ctx.shadowColor = this.bannerColor; ctx.shadowBlur = 28;
      ctx.fillText(this.bannerText, width / 2, Math.round(height * 0.18));
      ctx.restore();
    } else {
      this.bannerText = null; // clear inactive banner
    }
    if (!this.alerts.length) return;
    ctx.save();
    const cx = width / 2;
    let y = 28; // slight padding from top
    for (let i = 0; i < this.alerts.length; i++) {
      const a = this.alerts[i];
      if (now > a.until) continue;
      const life = a.until - a.born;
      const t = Math.max(0, Math.min(1, (now - a.born) / life));
      const alpha = (t < 0.15) ? t / 0.15 : (t > 0.85 ? (1 - t) / 0.15 : 1);
      ctx.globalAlpha = Math.max(0, Math.min(1, 0.15 + 0.85 * alpha));
      ctx.font = 'bold 22px Orbitron, Arial';
      ctx.textAlign = 'center';
      ctx.fillStyle = a.color;
      ctx.shadowColor = a.color; ctx.shadowBlur = 18;
      ctx.fillText(a.text, cx, y);
      y += 26;
    }
    ctx.restore();
    // Prune expired alerts
    for (let i = this.alerts.length - 1; i >= 0; i--) if (performance.now() > this.alerts[i].until) this.alerts.splice(i,1);
  }

  // --- Spells ---
  private startShockNova() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    this.spellState = 'NOVA_CHARGE';
    this.spellTimerMs = 0;
    this.novaRadius = 0;
    this.novaHitApplied = false;
  // Initialize previous radius to inner radius for crossing detection
  this.lastNovaR = this.getNovaInnerRadius();
  }

  private startMultiNova() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    this.spellState = 'MULTINOVA_CHARGE';
    this.spellTimerMs = 0;
    this.multiNovaIndex = -1; // none launched yet
  this.multiNovaGlobalT = 0; // continuous progress timer
  // Increment pity for Beta behavior
  try { const id = (this.boss as any)?.id as string|undefined; const beh = this.bossDefs.find(b=>b.id===id)?.behavior; if (beh==='nova') this.betaNovaPity++; } catch {}
    // Determine count and spacing to cover viewport, but keep only a few waves
    // Fill the whole viewport: compute farthest needed radius and derive ring count with cap 3..4
    const baseInner = this.getNovaInnerRadius();
    let vw = 1280, vh = 720;
    try { vw = Math.max(640, window.innerWidth || vw); vh = Math.max(360, window.innerHeight || vh); } catch {}
    // Distance from boss to farthest corner is approximated by half-diagonal plus margin; camera offset doesn't change relative spacing need
    const halfDiag = Math.hypot(vw, vh) * 0.5;
    const margin = 160; // ensure outer ring exceeds edges
    const targetR = baseInner + halfDiag + margin;
  // Exactly 5 waves, expire after sequence
  this.multiNovaCount = 5;
  this.multiNovaSpacing = Math.max(140, (targetR - baseInner) / this.multiNovaCount);
  this.multiNovaHit = new Array(this.multiNovaCount).fill(false);
    // Precompute per-ring safe gaps (holes) — 2–3 gaps, wide
    const TWOPI = Math.PI * 2;
    this.multiNovaGaps = new Array(this.multiNovaCount);
    for (let i = 0; i < this.multiNovaCount; i++) {
      const gaps: Array<{ start:number; end:number }> = [];
      const gapCount = 2 + ((i % 2) ^ (this.bossSpawnCount % 2)); // 2 or 3 depending on ring/spawn
      const width = 0.7 + Math.random() * 0.35; // 40°–60° wide
      const offset = Math.random() * TWOPI;
      for (let k = 0; k < gapCount; k++) {
        const center = offset + k * (TWOPI / gapCount);
        let s = center - width / 2;
        let e = center + width / 2;
        // Normalize and split wrap-around
        const ns = ((s % TWOPI) + TWOPI) % TWOPI;
        const ne = ((e % TWOPI) + TWOPI) % TWOPI;
        if (ne < ns) {
          gaps.push({ start: ns, end: TWOPI });
          gaps.push({ start: 0, end: ne });
        } else {
          gaps.push({ start: ns, end: ne });
        }
      }
      // Sort and lightly merge overlaps
      gaps.sort((a,b)=>a.start-b.start);
      const merged: Array<{start:number;end:number}> = [];
      for (let g of gaps) {
        if (!merged.length || g.start > merged[merged.length-1].end) merged.push({ ...g });
        else merged[merged.length-1].end = Math.max(merged[merged.length-1].end, g.end);
      }
      this.multiNovaGaps[i] = merged;
    }
    this.novaHitApplied = false;
    this.showAlert('BETA: MULTI‑NOVA INCOMING', '#CC66FF', 1600);
  }

  // New spells
  private startSuperNova() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    this.spellState = 'SUPERNOVA_CHARGE';
    this.spellTimerMs = 0;
    this.novaHitApplied = false;
  // Reset previous radius and any residual overlays from prior casts
  this.lastSuperNovaR = 0;
  this.screenDarkenAlpha = 0;
  this.superNovaRumbleAccMs = 0;
  // Clear any lingering hazards specific to beta nova visuals (none currently), keep others
  // Reserve: if future hazards should be cleared, filter here
  // Reset pity on Supernova
  this.betaNovaPity = 0;
  // Activate sticky banner for full charge+release window (charge + release + buffer)
  const total = this.superNovaChargeMs + this.superNovaReleaseMs + 600;
  this.bannerText = 'SUPERNOVA INBOUND';
  this.bannerColor = '#FFAA00';
  this.bannerUntil = performance.now() + total;
    this.showAlert('BETA: SUPERNOVA — BRACE', '#FFAA00', 2000);
  }

  private startLineDash(dx: number, dy: number, dist: number) {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    if (dist < 0.0001) { dx = 1; dy = 0; dist = 1; }
    this.dashDirX = dx / dist;
    this.dashDirY = dy / dist;
    this.spellState = 'LINEUP';
    this.spellTimerMs = 0;
    this.dashElapsedMs = 0;
  this.dashDidHitOnce = false;
  }

  private startConeSlam(dx: number, dy: number, dist: number) {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    if (dist < 0.0001) { dx = 1; dy = 0; dist = 1; }
    this.coneDirX = dx / dist; this.coneDirY = dy / dist;
    this.spellState = 'CONE_WINDUP';
    this.spellTimerMs = 0;
  }

  private startEarthshatter() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    this.spellState = 'EARTH_WINDUP';
    this.spellTimerMs = 0;
    this.showAlert('ALPHA: EARTHSHATTER', '#FF5533', 1400);
  }

  private startSummonRifts() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    // Pick rift positions in a ring around the player
    const count = 4 + Math.min(3, this.difficulty); // 4-7 rifts
    const radius = 260;
    this.riftPoints = [];
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const x = this.player.x + Math.cos(ang) * radius;
      const y = this.player.y + Math.sin(ang) * radius;
      this.riftPoints.push({ x, y });
    }
    this.spellState = 'RIFTS_WINDUP';
    this.spellTimerMs = 0;
  }

  private startRiftBarrage() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    this.spellState = 'RIFT_BARRAGE_WINDUP';
    this.spellTimerMs = 0;
    this.showAlert('GAMMA: RIFT BARRAGE', '#FFA733', 1400);
  }

  private startCrossSlash() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
    this.spellState = 'CROSS_WINDUP';
    this.spellTimerMs = 0;
    this.showAlert('OMEGA: CROSS SLASH', '#FF3366', 1200);
  }

  private updateSpells(dtMs: number) {
    if (!this.boss) return;
    const canAct = this.lsBossCanAct();
    // While hidden in Last Stand, freeze spell timers and skip transitions/damage
    if (!canAct) {
      // Allow visual telegraphs to continue drawing but don't progress timers
      return;
    }
    switch (this.spellState) {
      case 'NOVA_CHARGE': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.novaChargeMs) {
          this.spellState = 'NOVA_RELEASE';
          this.spellTimerMs = 0;
          // Inner blast damage near boss center
          const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
          if (d <= this.getNovaInnerRadius()) {
            const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
            this.damagePlayer(Math.round(45 * specialScale)); // reduced inner blast damage
            window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 180, intensity: 6 } }));
          }
        }
        break;
      }
      case 'NOVA_RELEASE': {
        this.spellTimerMs += dtMs;
        const t = Math.min(1, this.spellTimerMs / this.novaChargeMs);
        const inner = this.getNovaInnerRadius();
  const prevR = this.novaRadius || this.lastNovaR || inner;
  this.novaRadius = this.getNovaRadiusAt(t);
        const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
        const band = this.novaHitBand; // exact same band used for draw
  // Robust crossing check: if the ring passed over the player between frames
  if (!this.novaHitApplied && d >= (prevR - band) && d <= (this.novaRadius + band)) {
          this.novaHitApplied = true;
          const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
          this.damagePlayer(Math.round(35 * specialScale)); // reduced ring damage
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 140, intensity: 5 } }));
        }
  this.lastNovaR = this.novaRadius;
        if (t >= 1) this.endSpellCooldown();
        break;
      }
      case 'MULTINOVA_CHARGE': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.novaChargeMs) {
          this.spellState = 'MULTINOVA_RELEASE';
          this.spellTimerMs = 0;
          // Launch all rings together; use multiNovaGlobalT to animate outward
          this.multiNovaIndex = this.multiNovaCount - 1;
          this.multiNovaGlobalT = 0;
          this.novaHitApplied = false;
        }
        break;
      }
      case 'MULTINOVA_RELEASE': {
        // All rings move outward together; check player against each ring once
        this.spellTimerMs += dtMs;
        const baseInner = this.getNovaInnerRadius();
        this.multiNovaGlobalT += dtMs / this.novaChargeMs;
        const band = this.novaHitBand;
        const px = this.player.x, py = this.player.y;
        const d = Math.hypot(px - this.boss.x, py - this.boss.y);
        for (let i = 0; i < this.multiNovaCount; i++) {
          const r = baseInner + Math.max(0, this.multiNovaGlobalT - i) * this.multiNovaSpacing;
          if (!this.multiNovaHit[i] && d >= r - band && d <= r + band) {
            // Check if player is within a safe angular gap for ring i
            const gaps = this.multiNovaGaps[i] || [];
            let angle = Math.atan2(py - this.boss.y, px - this.boss.x);
            if (angle < 0) angle += Math.PI*2;
            let inGap = false;
            for (let g = 0; g < gaps.length; g++) { const gg = gaps[g]; if (angle >= gg.start && angle <= gg.end) { inGap = true; break; } }
            if (!inGap) {
              this.multiNovaHit[i] = true;
              const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
              this.damagePlayer(Math.round(40 * specialScale));
              window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 160, intensity: 6 } }));
            }
          }
        }
        // Finish once the last ring has moved past max distance window
        if (this.multiNovaGlobalT >= this.multiNovaCount + 1) {
          this.multiNovaGlobalT = 0;
          this.endSpellCooldown();
        }
        break;
      }
      case 'SUPERNOVA_CHARGE': {
        this.spellTimerMs += dtMs;
        // Periodic subtle screen rumbles to sell menace
        this.superNovaRumbleAccMs += dtMs;
        while (this.superNovaRumbleAccMs >= 240) {
          this.superNovaRumbleAccMs -= 240;
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 2 } }));
        }
        if (this.spellTimerMs >= this.superNovaChargeMs) {
          this.spellState = 'SUPERNOVA_RELEASE';
          this.spellTimerMs = 0;
          this.novaHitApplied = false;
          // Initialize previous radius to starting base for crossing detection
          const base = (this.boss.radius || 80) + 90;
          this.lastSuperNovaR = base;
        }
        break;
      }
      case 'SUPERNOVA_RELEASE': {
        // Single massive ring — slower, smoother expansion
        this.spellTimerMs += dtMs;
        const base = (this.boss.radius || 80) + 90;
        const maxR = base + 440;
        const tRaw = Math.min(1, this.spellTimerMs / this.superNovaReleaseMs);
        const t = tRaw < 0.5 ? 4*tRaw*tRaw*tRaw : 1 - Math.pow(-2*tRaw+2,3)/2; // cubic ease
        const rPrev = this.lastSuperNovaR || base;
        const r = base + (maxR - base) * t;
        const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
        const band = this.novaHitBand * 2.0;
        // Robust crossing check to avoid misses on large frame steps
        if (!this.novaHitApplied && d >= (rPrev - band) && d <= (r + band)) {
          this.novaHitApplied = true;
          const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
          this.damagePlayer(Math.round(72 * specialScale));
          // Strong knockback
          if (!(window as any).__reviveCinematicActive) { if (d > 0) { const nx = (this.player.x - this.boss.x)/d, ny=(this.player.y - this.boss.y)/d; const mul = (this.player.getKnockbackMultiplier ? this.player.getKnockbackMultiplier() : 1); this.player.x += nx*120*mul; this.player.y += ny*120*mul; } }
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 320, intensity: 9 } }));
        }
        this.lastSuperNovaR = r;
  if (t >= 1) { this._extraCooldownMs = 800; this.endSpellCooldown(); }
        break;
      }
      case 'EARTH_WINDUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.earthWindupMs) {
          this.spellState = 'EARTH_RELEASE';
          this.spellTimerMs = 0;
          // Spawn radial AOEs (spikes)
          const rays = 8;
          const steps = 4; // rings outward
          const stepDist = 90;
          for (let i = 0; i < rays; i++) {
            const a = (i / rays) * Math.PI * 2;
            for (let s = 1; s <= steps; s++) {
              const x = this.boss.x + Math.cos(a) * (s * stepDist);
              const y = this.boss.y + Math.sin(a) * (s * stepDist);
              this.hazards.push({ kind:'aoe', x, y, radius: 48, windupMs: 120, activeMs: 220, elapsedMs: 0, color: '#FF5533', damage: 18 });
            }
          }
        }
        break;
      }
      case 'EARTH_RELEASE': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 360) this.endSpellCooldown();
        break;
      }
      case 'RIFT_BARRAGE_WINDUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.riftBarrageWindupMs) {
          this.spellState = 'RIFT_BARRAGE_RELEASE';
          this.spellTimerMs = 0;
          // 3 waves of 8 small AOEs around player
          const waves = 3, dots = 8, rad = 280;
          for (let w = 0; w < waves; w++) {
            const delay = 120 + w * 180;
            // schedule hazards (approximate via windupMs skew)
            for (let i = 0; i < dots; i++) {
              const a = (i/dots) * Math.PI*2 + (w*0.25);
              const x = this.player.x + Math.cos(a) * rad;
              const y = this.player.y + Math.sin(a) * rad;
              this.hazards.push({ kind:'aoe', x, y, radius: 42, windupMs: delay, activeMs: 180, elapsedMs: 0, color: '#FFA733', damage: 20 });
            }
          }
        }
        break;
      }
      case 'RIFT_BARRAGE_RELEASE': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 720) this.endSpellCooldown();
        break;
      }
      case 'CROSS_WINDUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.crossWindupMs) {
          this.spellState = 'CROSS_RELEASE';
          this.spellTimerMs = 0;
          const L = 480;
          const lines = [0, Math.PI/2, Math.PI/4, -Math.PI/4];
          for (let i = 0; i < lines.length; i++) {
            const a = lines[i];
            const dx = Math.cos(a), dy = Math.sin(a);
            const sx = this.boss.x - dx * L, sy = this.boss.y - dy * L;
            const ex = this.boss.x + dx * L, ey = this.boss.y + dy * L;
            this.hazards.push({ kind:'line', x: sx, y: sy, x2: ex, y2: ey, width: 36, windupMs: 100, activeMs: 700, elapsedMs: 0, color: '#FF3366', damage: 16 });
          }
        }
        break;
      }
      case 'CROSS_RELEASE': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 300) this.endSpellCooldown();
        break;
      }
      case 'LINEUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 1000) { // longer telegraph for clarity
          this.spellState = 'DASH';
          this.spellTimerMs = 0;
          this.dashElapsedMs = 0;
          this.dashDidHitOnce = false;
        }
        break;
      }
      case 'DASH': {
        const step = this.dashSpeedPxPerMs * dtMs;
        this.boss.x += this.dashDirX * step;
        this.boss.y += this.dashDirY * step;
        this.dashElapsedMs += dtMs;
        // Clamp to walkable area
        const rm = (window as any).__roomManager;
        if (rm && typeof rm.clampToWalkable === 'function') {
          const c = rm.clampToWalkable(this.boss.x, this.boss.y, this.boss.radius || 80);
          this.boss.x = c.x; this.boss.y = c.y;
        }
        // Contact damage during dash
        const d = Math.hypot(this.player.x - this.boss.x, this.player.y - this.boss.y);
        if (!this.dashDidHitOnce && d < this.player.radius + this.boss.radius) {
          this.dashDidHitOnce = true; // only once per dash
          this.damagePlayer(40); // stronger dash contact damage
          // Apply a moderate knockback to give recovery space
          if (d > 0) {
            const nx = (this.player.x - this.boss.x) / d;
            const ny = (this.player.y - this.boss.y) / d;
            if (!(window as any).__reviveCinematicActive) { const mul = (this.player.getKnockbackMultiplier ? this.player.getKnockbackMultiplier() : 1); this.player.x += nx * 72 * mul; this.player.y += ny * 72 * mul; }
          }
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 120, intensity: 5 } }));
        }
        if (this.dashElapsedMs >= this.dashDurationMs) {
          // Start short recovery: suppress body-checks right after dash
          this.postDashRecoverUntilMs = performance.now() + 380;
          // Behavior: dasher chains extra dashes (up to 2)
          const identity = (this.boss as any).id as string | undefined;
          const isDasher = this.bossDefs.find(b => b.id === identity)?.behavior === 'dasher';
          const chainLeft = (this as any)._dashChainLeft ?? (isDasher ? 2 : 0);
          if (isDasher && chainLeft > 0) {
            (this as any)._dashChainLeft = chainLeft - 1;
            const dx = this.player.x - this.boss.x; const dy = this.player.y - this.boss.y; let dist = Math.hypot(dx, dy); if (dist < 0.0001) dist = 1;
            this.dashDirX = dx / dist; this.dashDirY = dy / dist;
            this.spellState = 'LINEUP';
            this.spellTimerMs = 600; // quick re-lineup
            this.dashElapsedMs = 0;
          } else {
            (this as any)._dashChainLeft = 0;
            // Leave burning trail hazard along last dash path for 1.2s
            const totalLen = this.dashSpeedPxPerMs * this.dashDurationMs;
            const endX = this.boss.x, endY = this.boss.y;
            const startX = endX - this.dashDirX * totalLen;
            const startY = endY - this.dashDirY * totalLen;
            this.hazards.push({ kind:'line', x: startX, y: startY, x2: endX, y2: endY, width: 50, windupMs: 150, activeMs: 1200, elapsedMs: 0, color: '#FF4466', damage: 12 });
            this.endSpellCooldown();
          }
        }
        break;
      }
      case 'CONE_WINDUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.coneWindupMs) {
          this.spellState = 'CONE_RELEASE';
          this.spellTimerMs = 0;
          // Apply cone damage instantly once
          const a = Math.atan2(this.coneDirY, this.coneDirX);
          const dx = this.player.x - this.boss.x; const dy = this.player.y - this.boss.y;
          const d = Math.hypot(dx, dy);
          if (d <= this.coneRange) {
            const ang = Math.atan2(dy, dx);
            let da = Math.abs(((ang - a + Math.PI) % (Math.PI*2)) - Math.PI);
            if (da <= this.coneArcRad) {
              const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
              this.damagePlayer(Math.round(55 * specialScale));
              if (!(window as any).__reviveCinematicActive) { const mul = (this.player.getKnockbackMultiplier ? this.player.getKnockbackMultiplier() : 1); const kb = 90 * mul; this.player.x += Math.cos(a) * kb; this.player.y += Math.sin(a) * kb; }
              window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 220, intensity: 7 } }));
            }
          }
        }
        break;
      }
      case 'CONE_RELEASE': {
        // Brief lingering visual only
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 300) this.endSpellCooldown();
        break;
      }
      case 'RIFTS_WINDUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.riftWindupMs) {
          this.spellState = 'RIFTS_RELEASE';
          this.spellTimerMs = 0;
          // Spawn minions and small AOE at each rift
          for (let i = 0; i < this.riftPoints.length; i++) {
            const p = this.riftPoints[i];
            window.dispatchEvent(new CustomEvent('bossMinionSpawn', { detail: { x: p.x, y: p.y, count: 1 + Math.floor(this.difficulty/2) } }));
            this.hazards.push({ kind:'aoe', x: p.x, y: p.y, radius: this.riftRadius, windupMs: 100, activeMs: 200, elapsedMs: 0, color: '#FFAA33', damage: 25 });
          }
        }
        break;
      }
      case 'RIFTS_RELEASE': {
        // linger a short moment then finish
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= 300) this.endSpellCooldown();
        break;
      }
      case 'VOLLEY_WINDUP': {
        this.spellTimerMs += dtMs;
        if (this.spellTimerMs >= this.volleyWindupMs) {
          this.startVolleyRelease();
        }
        break;
      }
      case 'VOLLEY_RELEASE': {
        // Timed burst of projectiles aimed at the player
        this.spellTimerMs += dtMs;
        this.volleyTimerMs += dtMs;
        while (this.volleyIndex < this.volleyCount && this.volleyTimerMs >= this.volleyIntervalMs) {
          this.volleyTimerMs -= this.volleyIntervalMs;
          this.spawnVolleyProjectile();
          this.volleyIndex++;
        }
        if (this.volleyIndex >= this.volleyCount) {
          // End the spell; projectiles persist independently
          this.endSpellCooldown();
        }
        break;
      }
    }
    // hazards update moved out; handled every frame by updateHazards()
  }

  /** Update hazards independent of spell state so projectiles keep moving after spells end */
  private updateHazards(dtMs: number) {
    if (!this.hazards.length) return;
  const canAct = this.lsBossCanAct();
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      hz.elapsedMs += dtMs;
      if (hz.kind === 'proj') {
        // Move with swept collision check to prevent tunneling
        const vx = hz.vx || 0, vy = hz.vy || 0;
        const prevX = hz.x, prevY = hz.y;
        const nx = hz.x + vx * dtMs / 1000;
        const ny = hz.y + vy * dtMs / 1000;
        // Swept segment vs circle (player)
        const cx = this.player.x, cy = this.player.y;
        const pr = (hz.radius || 10) + this.player.radius;
        let hit = false; let hitX = nx; let hitY = ny;
        {
          const sx = prevX, sy = prevY; const ex = nx, ey = ny;
          const dx = ex - sx, dy = ey - sy;
          const fx = sx - cx, fy = sy - cy;
          const a = dx*dx + dy*dy;
          const b = 2 * (fx*dx + fy*dy);
          const c = (fx*fx + fy*fy) - pr*pr;
          let t = 1;
          if (a > 0) {
            const disc = b*b - 4*a*c;
            if (disc >= 0) {
              const sqrt = Math.sqrt(disc);
              const t0 = (-b - sqrt) / (2*a);
              const t1 = (-b + sqrt) / (2*a);
              const tt = (t0 >= 0 && t0 <= 1) ? t0 : ((t1 >= 0 && t1 <= 1) ? t1 : null);
              if (tt != null) { t = tt; hit = true; }
            }
          } else {
            // Degenerate segment; fallback to point-in-circle at end
            const ddx = cx - ex, ddy = cy - ey; hit = (ddx*ddx + ddy*ddy) <= pr*pr;
          }
          if (hit) { hitX = sx + dx * t; hitY = sy + dy * t; }
        }
        hz.x = nx; hz.y = ny;
  if (hit && canAct) {
          const specialScale = Math.pow(1.22, this.bossSpawnCount - 1);
          this.damagePlayer(Math.round((hz.damage || 18) * specialScale));
          window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 90, intensity: 3 } }));
          try { window.dispatchEvent(new CustomEvent('mortarExplosion', { detail: { x: hitX, y: hitY, radius: 80, damage: 0, color: '#FFDD66' } })); } catch {}
          this.hazards.splice(i, 1);
          continue;
        }
        // Lifespan and bounds
        const alive = hz.elapsedMs < (hz.windupMs + (hz.activeMs || this.volleyLifeMs));
        if (!alive || hz.x < -120 || hz.x > (this.player as any).worldWidth + 120 || hz.y < -120 || hz.y > (this.player as any).worldHeight + 120) {
          this.hazards.splice(i, 1);
        }
        continue;
      }
      const live = hz.elapsedMs < hz.windupMs + hz.activeMs;
      const active = hz.elapsedMs >= hz.windupMs && hz.elapsedMs < hz.windupMs + hz.activeMs;
  if (active && canAct) {
        if (hz.kind === 'aoe' && hz.radius) {
          const d = Math.hypot(this.player.x - hz.x, this.player.y - hz.y);
          if (d <= hz.radius) this.damagePlayer(hz.damage);
        } else if (hz.kind === 'line' && hz.x2 != null && hz.y2 != null && hz.width) {
          const px = this.player.x, py = this.player.y;
          const x1 = hz.x, y1 = hz.y, x2 = hz.x2, y2 = hz.y2;
          const vx = x2 - x1, vy = y2 - y1;
          const wx = px - x1, wy = py - y1;
          const c1 = vx*wx + vy*wy;
          const c2 = vx*vx + vy*vy;
          let t = c2 > 0 ? c1 / c2 : 0; t = Math.max(0, Math.min(1, t));
          const projx = x1 + t * vx; const projy = y1 + t * vy;
          const dist = Math.hypot(px - projx, py - projy);
          if (dist <= (hz.width/2 + this.player.radius)) this.damagePlayer(hz.damage);
        }
      }
      if (!live) this.hazards.splice(i, 1);
    }
  }

  private endSpellCooldown() {
    // Clear any spell-specific transient state before going idle
    if (this.spellState === 'SUPERNOVA_RELEASE') {
      // Ensure overlay will fade out next frame and previous radius won't affect next cast
      this.lastSuperNovaR = 0;
      // Add a tiny residual darken to avoid harsh pop
      this.screenDarkenAlpha = Math.max(this.screenDarkenAlpha, 0.1);
  // Clear banner shortly after completion
  this.bannerText = null;
    }
    this.spellState = 'IDLE';
    this.spellTimerMs = 0;
    this.novaHitApplied = false;
  const identity = (this.boss as any)?.id as string | undefined;
  const beh = this.bossDefs.find(b => b.id === identity)?.behavior || 'balanced';
  const base = this.spellCooldownMs;
  let cd = beh === 'nova' ? base * 0.95 : beh === 'dasher' ? base * 0.75 : beh === 'summoner' ? base * 0.9 : base * 0.92;
  if (this._extraCooldownMs && this._extraCooldownMs > 0) {
    cd += this._extraCooldownMs;
    this._extraCooldownMs = 0;
  }
  this.nextSpellAtMs = performance.now() + cd;
  this.dashDidHitOnce = false;
  }

  private startVolley() {
    if (!this.boss) return;
  if (!this.lsBossCanAct()) { this.nextSpellAtMs = performance.now() + 250; return; }
  // Exactly 5 continually shot shots with clear wide arc fan
  const phase = (this.boss as any)._phase || 1;
  this.volleyCount = 5;
  this.volleyIntervalMs = 140; // steady cadence
    this.volleyIndex = 0;
    this.volleyTimerMs = 0;
    this.spellState = 'VOLLEY_WINDUP';
    this.spellTimerMs = 0;
    this.showAlert('BETA: MORTAR VOLLEY', '#FFDD66', 1200);
  }

  private startVolleyRelease() {
    if (!this.boss) return;
    this.spellState = 'VOLLEY_RELEASE';
    this.spellTimerMs = 0;
    this.volleyTimerMs = 0;
    this.volleyIndex = 0;
  }

  private spawnVolleyProjectile() {
    if (!this.boss) return;
  const px = this.player.x, py = this.player.y;
  // Base aim = player, but distribute in a wide fan for readability
  const dx = px - this.boss.x; const dy = py - this.boss.y;
  const baseAng = Math.atan2(dy, dx);
  // Map volleyIndex [0..volleyCount-1] into [-arc/2 .. +arc/2]
  const arc = this.volleyFanArcRad;
  const idx = this.volleyIndex;
  const n = Math.max(1, this.volleyCount - 1);
  const t = n > 0 ? (idx / n) : 0.5;
  const ang = baseAng - arc/2 + arc * t;
    const vx = Math.cos(ang) * this.volleySpeed;
    const vy = Math.sin(ang) * this.volleySpeed;
    this.hazards.push({
      kind: 'proj',
      x: this.boss.x,
      y: this.boss.y,
      vx, vy,
      radius: 10,
      windupMs: 0,
      activeMs: this.volleyLifeMs,
      elapsedMs: 0,
      color: '#FFDD66',
      damage: 18,
      sprite: this.mortarSpritePath,
    });
  }

  public getActiveBoss() {
    return this.boss && this.boss.state === 'ACTIVE' ? this.boss : null;
  }

  /** Compatibility alias for existing callers. */
  public getBoss() {
    return this.getActiveBoss();
  }

  public setDifficulty(d: number) {
    this.difficulty = d;
    this.spawnTimer = Math.max(600, 1800 - (d - 1) * 300);
  }
}
