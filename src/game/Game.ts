import { Player } from './Player';
import { EnemyManager } from './EnemyManager';
import { ExplosionManager } from './ExplosionManager';
import { HUD } from '../ui/HUD';
import type { UpgradePanel } from '../ui/UpgradePanel'; // Type-only import to avoid bundling; actual code loaded dynamically in main.ts
import { Cinematic } from '../ui/Cinematic';
import { BossManager } from './BossManager';
import { BulletManager } from './BulletManager';
import { ParticleManager } from './ParticleManager';
import { AssetLoader } from './AssetLoader';
import { MainMenu } from '../ui/MainMenu';
import { CharacterSelectPanel } from '../ui/CharacterSelectPanel';
import { DamageTextManager } from './DamageTextManager';
import { GameLoop } from '../core/GameLoop';
// PerformanceMonitor removed (debug overlay eliminated)
import { Logger } from '../core/Logger';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';
import { SpatialGrid } from '../physics/SpatialGrid'; // Import SpatialGrid
import { EnvironmentManager } from './EnvironmentManager';
import { RoomManager } from './RoomManager';
import { VideoOverlay } from '../ui/VideoOverlay';
import { DebugOverlay } from '../ui/DebugOverlay';
import { FogOfWarSystem } from '../systems/FogOfWarSystem';
import { LastStandGameMode } from './modes/last-stand';
import { lastStandData, loadJSON } from './modes/config-loader';
import { screenToWorld } from '../core/coords';
// RMB controllers removed; abilities are declared via per-operative registries.
import { keyState } from './keyState';
import { getHealEfficiency } from './Balance';

export class Game {
  /**
   * Neon colors for scanlines and city lights
   */
  private static neonColors = [
    '#00FFFF', // Cyan
    '#FF00FF', // Magenta
    '#FFD700', // Gold
    '#00FF99', // Green
    '#FF0055', // Pink
    '#00BFFF'  // Blue
  ];
  // Static background image
  // Removed external background PNG; using procedural backdrop
  private backgroundImage: HTMLImageElement | null = null; // retained for compatibility (unused)
  private bgPatternCanvas?: HTMLCanvasElement; // cached background tile for low-jitter redraw
  private bgPatternCtx?: CanvasRenderingContext2D | null;
  private bgPatternValid: boolean = false;
  private bgPatternSize: number = 512; // size of cached pattern texture (power of two preferred)
  private bgGridSize: number = 160; // logical grid spacing
  private bgPatternNeedsRedraw: boolean = true; // flag for lazy rebuild
  private bgGradient?: CanvasGradient; // cached vertical gradient
  // Optional full-screen video overlay for Umbral Surge
  private surgeOverlay?: VideoOverlay;
  /**
   * Sets the game state. Used for UI panels like upgrade menu.
   * @param state New state string
   */
  private pendingInitialUpgrade: boolean = false; // request showing free upgrade on first GAME state
  public setState(state: 'MENU' | 'MAIN_MENU' | 'CHARACTER_SELECT' | 'CINEMATIC' | 'GAME' | 'PAUSE' | 'GAME_OVER' | 'UPGRADE_MENU') {
    const prev = this.state;
    this.state = state;
    // Auto start/stop loop to eliminate idle jitter in menus
    if (prev !== 'GAME' && state === 'GAME') {
      this.gameLoop.start();
    } else if (state === 'CINEMATIC') {
      // Ensure loop is running during cinematic so it can advance & draw
      this.gameLoop.start();
    } else if (prev === 'GAME' && state === 'MAIN_MENU') {
      this.gameLoop.stop();
    }
    // Show pending initial upgrade on first actual GAME entry
  if (state === 'GAME' && this.pendingInitialUpgrade && !this.initialUpgradeOffered && this.gameMode !== 'LAST_STAND') {
      const delay = 40; // allow UpgradePanel dynamic import & wiring
      setTimeout(() => {
        if (this.initialUpgradeOffered || this.state !== 'GAME') return;
        if (this.upgradePanel) {
          try {
            this.upgradePanel.show();
            this.initialUpgradeOffered = true;
            this.pendingInitialUpgrade = false;
            this.setState('UPGRADE_MENU');
          } catch (err) {
            Logger.error('[Game] Auto initial upgrade show failed: ' + (err as any)?.message);
          }
        } else {
          try { window.dispatchEvent(new CustomEvent('showUpgradePanel')); this.initialUpgradeOffered = true; } catch {}
          this.pendingInitialUpgrade = false;
        }
      }, delay);
    }
  }
  public assetLoader: AssetLoader; // Explicitly declared as public
  public player: Player; // Made public
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private enemyManager: EnemyManager;
  private bossManager: BossManager;
  private bulletManager: BulletManager;
  private particleManager: ParticleManager;
  private hud: HUD;
  private upgradePanel!: UpgradePanel; // Changed to be set later
  public cinematic: Cinematic;
  private mainMenu!: MainMenu; // Changed to be set later
  private characterSelectPanel!: CharacterSelectPanel; // Changed to be set later
  private selectedCharacterData: any | null = null; // To store selected character
  private state: 'MENU' | 'MAIN_MENU' | 'CHARACTER_SELECT' | 'CINEMATIC' | 'GAME' | 'PAUSE' | 'GAME_OVER' | 'UPGRADE_MENU';
  private gameTime: number = 0;
  private _activeBeams: any[] = [];

  // world/camera
  private worldW = 4000 * 10; // start smaller; expand later to reduce coordinate magnitude early
  private worldH = 4000 * 10;
  private worldExpanded: boolean = false;
  private camX = 0;
  private camY = 0;
  private camLerp = 0.12;
  private brightenMode: boolean = true;
  // Abilities system
  private _abilities: any[] = [];
  private lowFX: boolean = false; // legacy low FX toggle (was auto-set in Electron; now manual)
  // Dynamic resolution scaling removed with Electron support
  private designWidth: number; // logical width baseline
  private designHeight: number; // logical height baseline
  private renderScale: number = 1; // current internal resolution scale (0.5 .. 1)
  private lastScaleCheck: number = performance.now();
  private minimalRender: boolean = false; // diagnostic: draw ultra-simple frame when true
  private maxPixelBudget: number = 1300000; // ~1.3MP internal pixel budget to avoid large fullscreen slowdowns
  private minRenderScale: number = 0.6; // lower bound for automatic downscale
  private lastCssW: number = -1;
  private lastCssH: number = -1;

  private damageTextManager: DamageTextManager = new DamageTextManager();
  private dpsLog: number[] = [];
  private dpsFrameDamage: number = 0;
  private gameLoop: GameLoop;
  private enemySpatialGrid: SpatialGrid<any>; // Spatial grid for enemies
  private bulletSpatialGrid: SpatialGrid<any>; // Spatial grid for bullets
  private environment: EnvironmentManager; // biome + ambient background
  private roomManager: RoomManager; // random rooms structure
  private showRoomDebug: boolean = false;
  public gameMode: 'SHOWDOWN' | 'DUNGEON' | 'SANDBOX' | 'LAST_STAND' = 'LAST_STAND'; // default to Last Stand (main menu)
  private lastStand?: LastStandGameMode;
  // RMB controllers removed; abilities now resolved from registries.
  // Removed perf + frame pulse overlays; lightweight FPS sampling only
  private fpsFrameCount: number = 0;
  private fpsLastTs: number = performance.now();
  private autoPaused: boolean = false; // track alt-tab auto pause
  private autoPauseStartTs: number = 0; // record when auto-pause began (performance.now)
  private initialUpgradeOffered: boolean = false; // one free upgrade flag
  private debugOverlay: DebugOverlay = new DebugOverlay();
  // Fog of War
  /** Fog of War system and settings */
  private fog?: FogOfWarSystem;
  private fowEnabled: boolean = true; // locked on
  private fowRadiusBase: number = 4; // tiles (locked baseline; passives may modify)
  private readonly fowTileSize: number = 160;
  private lastFowTileX: number = Number.NaN;
  private lastFowTileY: number = Number.NaN;

  // DPS Tracking
  private totalDamageDealt: number = 0;
  private dpsHistory: { time: number, damage: number }[] = []; // Stores { timestamp, damageAmount }
  private dpsWindow: number = 5000; // 5 seconds for rolling DPS calculation

  // Screen Shake
  private shakeDuration: number = 0; // How long to shake (in milliseconds)
  private shakeIntensity: number = 0; // How strong the shake is
  private currentShakeTime: number = 0; // Current time for shake effect

  private explosionManager?: ExplosionManager;
  // Revive cinematic state
  private reviveCinematicActive: boolean = false;
  private reviveCinematicStart: number = 0;
  private reviveCinematicDuration: number = 5000;
  private reviveCinematicScheduled: boolean = false;

  // Utility: build a rounded-rectangle path on the current canvas context
  private roundRectPath(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx; r = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }
  /** Schedules or shows the opening upgrade if not already offered and player has zero upgrades. */
  private showInitialUpgradeIfNeeded(delayMs: number = 0) {
  if (this.gameMode === 'LAST_STAND') return; // No upgrade panel in Last Stand
    if (this.initialUpgradeOffered) return;
    const exec = () => {
      if (this.initialUpgradeOffered) return;
      if (this.player?.upgrades?.length === 0) {
        if (this.upgradePanel) {
          try {
            this.upgradePanel.show();
            this.setState('UPGRADE_MENU');
            this.initialUpgradeOffered = true;
          } catch (err) {
            Logger.error('[Game] showInitialUpgradeIfNeeded failure: ' + (err as any)?.message);
          }
        } else {
          // Fallback: dispatch global event main.ts listens for
          try { window.dispatchEvent(new CustomEvent('showUpgradePanel')); this.initialUpgradeOffered = true; } catch {}
        }
      }
    };
    if (delayMs > 0) setTimeout(exec, delayMs); else exec();
  }

  /** Compute effective Fog-of-War radius in tiles, including class and Vision passive multipliers. */
  private getEffectiveFowRadiusTiles(): number {
    try {
      const base = Math.max(1, Math.floor(this.fowRadiusBase));
      const cid: string | undefined = (this.player as any)?.characterData?.id;
      let classMul = 1.0;
      if (cid === 'ghost_operative' || cid === 'shadow_operative') classMul = 1.2; // snipers see farther
      else if (cid === 'titan_mech') classMul = 0.9; // huge body, slightly tighter FOV
      else if (cid === 'cyber_runner' || cid === 'data_sorcerer') classMul = 1.05; // mild +5%
      const passiveMul = Math.max(0.5, Math.min(2.5, (this.player as any)?.visionMultiplier || 1));
  // Last Stand: increase baseline vision by +30% for better early awareness
  const modeMul = (this.gameMode === 'LAST_STAND') ? 1.3 : 1.0;
  return base * classMul * passiveMul * modeMul;
    } catch { return Math.max(1, Math.floor(this.fowRadiusBase)); }
  }

  constructor(canvas: HTMLCanvasElement) {
  // No external background image; procedural map will be drawn each frame (cached layer)
  this.canvas = canvas;
  // GPU-friendly hints: desynchronized to reduce blocking; avoid readbacks.
  this.ctx = (canvas.getContext('2d', { alpha: true, desynchronized: true, willReadFrequently: false }) as CanvasRenderingContext2D) || canvas.getContext('2d')!;
  try { (this.ctx as any).imageSmoothingEnabled = false; } catch { /* ignore */ }
  this.designWidth = canvas.width;
  this.designHeight = canvas.height;
    this.state = 'MAIN_MENU';
    this.gameTime = 0;
  // Expose AssetLoader static helpers on window before any weapon visuals read them
  try { (window as any).AssetLoader = AssetLoader; } catch {}
  this.assetLoader = new AssetLoader(); // Initialization remains here
  try { (window as any).__gameInstance = this; } catch {}
    this.particleManager = new ParticleManager(160);
    // Initialize spatial grids first
    this.enemySpatialGrid = new SpatialGrid<any>(200); // Cell size 200
    this.bulletSpatialGrid = new SpatialGrid<any>(100); // Cell size 100

    // Initialize player and managers in correct dependency order
    this.player = new Player(this.worldW / 2, this.worldH / 2);
  // Ensure player has a stable instance id for scoping shared effects
  try { if ((this.player as any)._instanceId == null) { (this.player as any)._instanceId = Math.floor(Math.random()*1e9); } } catch {}
    // Scale base radius by character scale (Tech Warrior +25%, others 1.0)
    try {
      const scale = (this.player as any).getCharacterScale ? (this.player as any).getCharacterScale() : 1.0;
      this.player.radius = Math.round(18 * scale);
    } catch { this.player.radius = 18; }
  // Expose player globally for loosely-coupled systems (crit, piercing, AoE passives)
  try { (window as any).player = this.player; } catch {}
    this.enemyManager = new EnemyManager(this.player, this.bulletSpatialGrid, this.particleManager, this.assetLoader, 1);
  this.bulletManager = new BulletManager(this.assetLoader, this.enemySpatialGrid, this.particleManager, this.enemyManager, this.player);
  this.bossManager = new BossManager(this.player, this.particleManager, 1, this.assetLoader);
  try { (window as any).__bossManager = this.bossManager; } catch {}
    this.cinematic = new Cinematic();
    
    if (!this.explosionManager) {
      this.explosionManager = new ExplosionManager(this.particleManager, this.enemyManager, this.player, this.bulletManager, (durationMs: number, intensity: number) => this.startScreenShake(durationMs, intensity));
    }
  this.hud = new HUD(this.player, this.assetLoader);
  // Umbral Surge video overlay setup (screen-blended full-screen video)
  this.surgeOverlay = new VideoOverlay([
    // Actual file present
    AssetLoader.normalizePath('/assets/ui/umbral_surge.mp4.mp4'),
    AssetLoader.normalizePath('assets/ui/umbral_surge.mp4.mp4'),
    // Fallbacks for differing prefixes/extension handling
    AssetLoader.normalizePath('/assets/ui/umbral_surge.mp4'),
    AssetLoader.normalizePath('assets/ui/umbral_surge.mp4')
  ]);
  // Start overlay when surge begins
  window.addEventListener('shadowSurgeStart', (e: any) => {
    const dur = (e?.detail?.durationMs) ?? 5000;
  // Make the effect less obstructive near the end with a longer fade-out
  this.surgeOverlay?.play(dur, { fadeInMs: 140, fadeOutMs: 700 });
  });
  // Stop overlay early if surge explicitly ends sooner
  window.addEventListener('shadowSurgeEnd', () => {
    this.surgeOverlay?.stop();
  });
  this.environment = new EnvironmentManager();
  this.roomManager = new RoomManager(this.worldW, this.worldH);
  // Fog of War init (sparse grid; tile ~ 160 logical px matches background grid)
  try {
    this.fog = new FogOfWarSystem();
    this.fog.setGrid(undefined as any, undefined as any, this.fowTileSize);
  const itx = Math.floor(this.player.x / this.fowTileSize);
  const ity = Math.floor(this.player.y / this.fowTileSize);
  this.fog.compute(itx, ity, Math.max(1, Math.floor(this.getEffectiveFowRadiusTiles())));
  this.lastFowTileX = itx; this.lastFowTileY = ity;
  } catch { /* ignore */ }
  // Generate structure only for Dungeon mode (default Showdown/Sandbox = open field)
  // Mode override via URL (e.g., ?mode=laststand or #mode=ls)
  try {
    const mode = this.parseModeFromUrl();
    if (mode) this.gameMode = mode;
  } catch {}
  // Lock Fog-of-War always on (Pause menu controls removed)
  this.fowEnabled = true;
  if (this.gameMode === 'DUNGEON') {
    this.roomManager.generate(60);
    (this.roomManager as any).setOpenWorld(false);
  }
  else { (this.roomManager as any).setOpenWorld(true); }
  // Defer Last Stand orchestration until after loop exists, and honor URL override
  const parsedMode = this.parseModeFromUrl();
  if (parsedMode) this.gameMode = parsedMode;
  // Expose globally for managers lacking direct reference (lightweight)
  try { (window as any).__roomManager = this.roomManager; } catch {}
  // Listen for revive to start a 5s cinematic overlay and schedule detonation
  window.addEventListener('playerRevived', (e: Event) => {
    try {
      this.reviveCinematicActive = true;
      this.reviveCinematicStart = performance.now();
      this.reviveCinematicScheduled = false;
  try { (window as any).__reviveCinematicActive = true; } catch {}
      // Optional: small screen shake at start
      window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 160, intensity: 6 } }));
    } catch { /* ignore */ }
  });
  // Allow global skip via Escape to instantly end revive cinematic with detonation
  window.addEventListener('keydown', (ke: KeyboardEvent) => {
    if (!this.reviveCinematicActive) return;
    if (ke.key === 'Escape') {
      this.triggerReviveDetonation();
      this.reviveCinematicActive = false;
  try { (window as any).__reviveCinematicActive = false; } catch {}
    }
  });
  // Place player inside central room if currently outside any
  const spawnRoom = this.roomManager.getRoomAt(this.player.x, this.player.y) || this.roomManager.getFarthestRoom(this.player.x, this.player.y, false);
  if (spawnRoom) {
    this.player.x = spawnRoom.x + spawnRoom.w/2;
    this.player.y = spawnRoom.y + spawnRoom.h/2;
  }
    // Removed direct instantiation: this.upgradePanel = new UpgradePanel(this.player, this); // Will be set via setter
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    this.player.setGameContext(this as any); // Cast to any to allow setting game context
  // Provide global game instance reference (used by EnemyManager passive AoE)
  try { (window as any).__gameInstance = this; } catch {}
    this.initInput();
  // RMB controllers removed
  // (Electron auto lowFX removed)
    // Removed frame pulse overlay (F9 toggle)
  this.gameLoop = new GameLoop(this.update.bind(this), this.render.bind(this));
  // Initialize Last Stand after gameLoop only when explicitly requested via URL
  if (parsedMode === 'LAST_STAND') {
    this.lastStand = new LastStandGameMode(this as any);
    this.setState('GAME');
    this.lastStand.init?.();
  }

    // Initialize camera position to center on player
    // Use logical (design) dimensions so small window (low resolution) starts centered correctly.
    this.camX = this.player.x - this.designWidth / 2;
    this.camY = this.player.y - this.designHeight / 2;

  // Ensure game starts in MAIN_MENU state, not GAME_OVER.
  // Do not override if a mode already placed us into GAME (e.g., Last Stand immediate start).
  const curState: any = this.state as any;
  if (curState !== 'GAME') this.state = 'MAIN_MENU';

    window.addEventListener('upgradeOpen', () => {
      if (this.state === 'GAME') this.state = 'UPGRADE_MENU';
    });
    window.addEventListener('upgradeClose', () => {
      if (this.state === 'UPGRADE_MENU') this.state = 'GAME';
    });
    window.addEventListener('damageDealt', (event: Event) => this.handleDamageDealt(event as CustomEvent));
    window.addEventListener('screenShake', (e: Event) => { // Listen for screen shake events
      this.startScreenShake((e as CustomEvent).detail.durationMs, (e as CustomEvent).detail.intensity);
    });
    // Listen for mortarExplosion / implosion events
  window.addEventListener('mortarExplosion', (e: Event) => this.handleMortarExplosion(e as CustomEvent));
  window.addEventListener('mortarImplosion', (e: Event) => this.handleMortarImplosion(e as CustomEvent));
  // Kamikaze Drone custom explosion (separate event so tuning/visuals can differ)
  window.addEventListener('droneExplosion', (e: Event) => this.handleDroneExplosion(e as CustomEvent));
    // Scavenger Scrap-Saw 10-hit explosion
    window.addEventListener('scrapExplosion', (e: Event) => {
      const d = (e as CustomEvent).detail;
      // Stronger visual: immediate damage + an extra subtle second ring
      try { this.explosionManager?.triggerShockwave(d.x, d.y, d.damage, d.radius, d.color || '#FFAA33'); } catch {}
      // Add a quick faint second ring for readability
      try { this.explosionManager?.triggerShockwave(d.x, d.y, Math.max(1, Math.round(d.damage*0.2)), Math.round(d.radius*0.65), '#FFD199'); } catch {}
      this.startScreenShake(100, 4);
    });
    // Scavenger Pulse visualization (dual warm rings + sparks)
    window.addEventListener('scrapPulse', (e: Event) => {
      const d = (e as CustomEvent).detail || {}; const x = d.x, y = d.y; const r = d.r || 160;
      try { this.explosionManager?.triggerShockwave(x, y, 0, Math.round(r*0.75), '#FFB347'); } catch {}
      try { this.explosionManager?.triggerShockwave(x, y, 0, Math.round(r*1.05), '#FFE6C2'); } catch {}
  try { this.particleManager.spawn(x, y, 14, '#FF9B2A', { sizeMin:2,sizeMax:4,lifeMs:420,speedMin:0.5,speedMax:2.0 }); } catch {}
    });
    // Listen for enemyDeathExplosion event
    window.addEventListener('enemyDeathExplosion', (e: Event) => this.handleEnemyDeathExplosion(e as CustomEvent));
    // Plasma events
    window.addEventListener('plasmaDetonation', (e: Event) => {
      const d = (e as CustomEvent).detail; this.explosionManager?.triggerPlasmaDetonation(d.x, d.y, d.damage, d.fragments, d.radius);
    });
    window.addEventListener('plasmaIonField', (e: Event) => {
      const d = (e as CustomEvent).detail; this.explosionManager?.triggerPlasmaIonField(d.x, d.y, d.damage, d.radius);
    });

    // Serpent Chain finisher: soft teal shockwave burst
    window.addEventListener('serpentBurst', (e: Event) => {
      const d = (e as CustomEvent).detail;
      try { this.explosionManager?.triggerShockwave(d.x, d.y, d.damage, d.radius, '#7EF1FF'); } catch {}
      try { this.particleManager.spawn(d.x, d.y, 12, '#A8F7FF', { sizeMin: 2, sizeMax: 4, lifeMs: 380, speedMin: 0.8, speedMax: 2.2 }); } catch {}
    });

    // Neural Nomad Overmind VFX: teal shockwaves + brief charge glow burst
    window.addEventListener('overmindFX', (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const x = d.x ?? this.player.x, y = d.y ?? this.player.y;
      const r = Math.max(140, d.radius ?? 240);
      try { this.explosionManager?.triggerShockwave(x, y, 0, Math.round(r * 0.85), '#66F2FF'); } catch {}
      try { this.explosionManager?.triggerShockwave(x, y, 0, Math.round(r * 1.15), '#A8FFFF'); } catch {}
      try { this.explosionManager?.triggerChargeGlow(x, y, Math.round(r * 0.6), '#9FFFFF', 260); } catch {}
      // Light energy flecks
      try { this.particleManager.spawn(x, y, 18, '#9FFCF6', { sizeMin: 2, sizeMax: 4, lifeMs: 420, speedMin: 0.6, speedMax: 1.8 }); } catch {}
    });

    // Listen for level up and chest upgrade events to show UpgradePanel
    window.addEventListener('levelup', () => {
  // Disable upgrade panel in Sandbox and Last Stand (LS uses its own shop)
  if (this.gameMode === 'SANDBOX' || this.gameMode === 'LAST_STAND') return;
      if (!this.upgradePanel) {
        Logger.error('[Game] UpgradePanel instance missing on levelup!');
        return;
      }
      // Defensive: check DOM element exists before showing
      if (typeof this.upgradePanel.show === 'function' && this.upgradePanel['panelElement']) {
        this.upgradePanel.show();
        this.setState('UPGRADE_MENU');
      } else {
        Logger.error('[Game] UpgradePanel panelElement missing or show() not a function.');
      }
    });
    window.addEventListener('forceUpgradeOption', (e: Event) => {
  // Disable forced/auto upgrade panel in Sandbox and Last Stand
  if (this.gameMode === 'SANDBOX' || this.gameMode === 'LAST_STAND') return;
      if (!this.upgradePanel) {
        Logger.error('[Game] UpgradePanel instance missing on forceUpgradeOption!');
        return;
      }
      if (typeof this.upgradePanel.show === 'function' && this.upgradePanel['panelElement']) {
        this.upgradePanel.show();
        this.setState('UPGRADE_MENU');
      } else {
        Logger.error('[Game] UpgradePanel panelElement missing or show() not a function.');
      }
    });
  // ...existing code...

    // Auto-pause on window blur (alt-tab) & resume on focus
    window.addEventListener('blur', () => {
  if (this.state === 'GAME') {
        this.pause();
        this.autoPaused = true;
        try { this.autoPauseStartTs = performance.now(); } catch { this.autoPauseStartTs = Date.now(); }
  window.dispatchEvent(new CustomEvent('showPauseOverlay', { detail: { auto: true } }));
      }
    });
    window.addEventListener('focus', () => {
      if (this.autoPaused && this.state === 'PAUSE') {
        // Compute how long we were auto-paused and shift absolute timers forward so cooldowns/effects don't advance while unfocused.
        let pausedDelta = 0;
        try { pausedDelta = Math.max(0, (performance.now() - (this.autoPauseStartTs || performance.now()))); } catch { pausedDelta = 0; }
        if (pausedDelta > 0) {
          try { this.adjustTimeAfterPause(pausedDelta); } catch { /* best-effort */ }
        }
        (this.gameLoop as any)?.resetTiming?.();
        this.resume();
        this.autoPaused = false;
  window.dispatchEvent(new CustomEvent('hidePauseOverlay'));
      }
    });
    // Boss defeat rewards
    window.addEventListener('bossDefeated', () => {
      // In Last Stand: award scrap instead of opening the standard UpgradePanel
      if (this.gameMode === 'LAST_STAND') {
        try { (this.lastStand as any)?.addScrap?.(500); } catch {}
        try { window.dispatchEvent(new CustomEvent('upgradeNotice', { detail: { type: 'boss-clear', message: '+500 Scrap (Boss)' } })); } catch {}
        return;
      }
      // In other modes: chain double upgrade
      if (!this.upgradePanel) return;
      let remaining = 2;
      const showNext = () => {
        if (remaining <= 0) return;
        remaining--;
        this.upgradePanel.show();
        this.setState('UPGRADE_MENU');
        // After player selects an upgrade, listen once to reopen if one remains
        const handler = () => {
          window.removeEventListener('playerUpgraded', handler);
          if (remaining > 0) {
            // Small delay to avoid immediate re-open flicker
            setTimeout(showNext, 150);
          }
        };
        window.addEventListener('playerUpgraded', handler, { once: true });
      };
      // Start chain
      showNext();
    });

  // Removed old interval-based initial upgrade watcher; now handled explicitly on reset/cinematic end.
  }

  /**
   * Asynchronously initializes deferred game resources (asset manifest + image preloads).
   * Idempotent: safe to call multiple times; concurrent callers will await the same promise.
   * Keeps constructor lean so Game can be created synchronously, while allowing main.ts
   * to await heavy I/O (manifest + image loads) before showing character select / menus.
   */
  public async init(): Promise<void> {
    // Reuse in-flight promise to avoid duplicate network work under race conditions.
    const self: any = this as any;
    if (self._initDone) return; // fast path
    if (self._initPromise) return self._initPromise;
    self._initPromise = (async () => {
      try {
        await this.assetLoader.loadAllFromManifest();
        // Proactively load class weapon sprites via manifest to avoid placeholder text boxes
        try {
          const saw = this.assetLoader.getAsset('bullet_saw') || '/assets/projectiles/bullet_sawblade.png';
          // bullet_grinder.png is not present in public/assets/projectiles; fallback to sawblade to avoid 404
          const grind = this.assetLoader.getAsset('bullet_grinder') || '/assets/projectiles/bullet_sawblade.png';
          const drone = this.assetLoader.getAsset('bullet_drone') || '/assets/projectiles/bullet_drone.png';
          await Promise.all([
            this.assetLoader.loadImage(saw),
            this.assetLoader.loadImage(grind),
            this.assetLoader.loadImage(drone)
          ]);
        } catch {}
        self._initDone = true;
        Logger.info('[Game] init complete (assets preloaded)');
      } catch (err) {
        Logger.error('[Game] init failed: ' + (err as any)?.message);
        // Continue – placeholders will render for any missing assets.
        self._initDone = true; // prevent infinite retry loop
      } finally {
        self._initPromise = null;
      }
    })();
    return self._initPromise;
  }

  /** Accessor for EnemyManager (read-only external usage). */
  public getEnemyManager(){ return this.enemyManager; }
  /** Accessor for BulletManager */
  public getBulletManager(){ return this.bulletManager; }
  /** Accessor for HUD (optional) */
  public getHUD(){ return this.hud; }

  /**
  * Resize logical & display dimensions. Supports bigger than FHD.
   * Keeps dynamic resolution scaling logic: renderScale still applies to internal pixel size.
   */
  public resize(displayW: number, displayH: number) {
    // Update design canvas logical size (viewport). We treat design == window size for survivor style (more area visible).
    this.designWidth = displayW;
    this.designHeight = displayH;
    // Device pixel ratio aware backing store so we can draw sharp while filling window completely.
    const dpr = (window as any).devicePixelRatio || 1;
  const backingW = Math.round(this.designWidth * dpr * this.renderScale);
  const backingH = Math.round(this.designHeight * dpr * this.renderScale);
    if (this.canvas.width !== backingW || this.canvas.height !== backingH) {
      this.canvas.width = backingW;
      this.canvas.height = backingH;
    }
    // Always stretch CSS to full window.
    this.canvas.style.width = this.designWidth + 'px';
    this.canvas.style.height = this.designHeight + 'px';
  // Keep existing renderScale (adaptive) when resizing.
    (window as any).__renderScale = this.renderScale;
  (window as any).__designWidth = this.designWidth;
  (window as any).__designHeight = this.designHeight;
    // Recenter / clamp camera immediately so there is no one-frame jump.
    this.camX = this.player.x - this.designWidth / 2;
    this.camY = this.player.y - this.designHeight / 2;
    this.camX = Math.max(0, Math.min(this.camX, this.worldW - this.designWidth));
    this.camY = Math.max(0, Math.min(this.camY, this.worldH - this.designHeight));
  // Invalidate cached background (viewport size change may alter perceived scaling of pattern lines)
  this.bgPatternNeedsRedraw = true;
  this.bgGradient = undefined; // force rebuild
  }

  /**
   * Starts a screen shake effect.
   * @param durationMs The duration of the shake in milliseconds.
   * @param intensity The intensity of the shake (e.g., 1-10).
   */
  public startScreenShake(durationMs: number, intensity: number): void {
    this.shakeDuration = durationMs;
    this.shakeIntensity = intensity;
    this.currentShakeTime = performance.now(); // Record start time of shake
  }

  /**
   * Handles clicks on the pause menu buttons.
   * @param x X coordinate of the click/touch
   * @param y Y coordinate of the click/touch
   */
  private handlePauseMenuClick(x: number, y: number) {
  // Legacy canvas pause menu removed; logic migrated to HTML PauseOverlay.
  }

  /**
   * Initializes input event listeners for the game.
   */
  private initInput() {
  window.addEventListener('keydown', (e) => {
      if (this.state === 'GAME' && e.key === 'Escape') {
        this.pause();
      } else if (this.state === 'PAUSE' && e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('resumeGame'));
      } else if (this.state === 'GAME_OVER' && e.key === 'Enter') {
        this.resetGame(this.selectedCharacterData); // Restart with selected character
      } else if (this.state === 'GAME' && (e.code === 'Space' || e.key === ' ' || e.key === 'Space' || e.key === 'Spacebar')) {
        // Activate character ability if available
        e.preventDefault(); // avoid page scroll / focus issues on Space
        try {
          (this.player as any)?.activateAbility?.();
        } catch {}
      } else if (e.key === 'k' || e.key === 'K') {
        // Manual hero kill hotkey for rapid leaderboard submission testing
        if (this.state === 'GAME') { this.player.hp = 0; }
      } else if (this.state === 'GAME' && (e.key === 'c' || e.key === 'C')) {
        // Global auto-aim toggle: closest <-> toughest, boss highest priority
        const current = ((this as any).aimMode as ('closest'|'toughest')) || ((window as any).__aimMode) || 'closest';
        const next = current === 'closest' ? 'toughest' : 'closest';
        (this as any).aimMode = next; (window as any).__aimMode = next;
        try { localStorage.setItem('cs-aimMode', next); } catch {}
        window.dispatchEvent(new CustomEvent('aimModeChanged', { detail: { mode: next } }));
      } else if (this.state === 'GAME' && (e.key === 'F10')) {
        // Toggle debug overlay
        const v = !(this as any).__dbgVisible;
        (this as any).__dbgVisible = v; (window as any).__debugOverlay = v;
        this.debugOverlay.toggle(v);
      }
    });

    window.addEventListener('statechange', () => {
      if (this.state === 'PAUSE') {
        setTimeout(() => {
          const overlay = (window as any).__pauseOverlay;
          if (overlay && !overlay.visible) {
            window.dispatchEvent(new CustomEvent('showPauseOverlay', { detail: { auto: false } }));
          }
        }, 16);
      } else if (this.state === 'GAME') {
        // Ensure aim mode is initialized when entering gameplay so HUD can always render the toggle
        const cur = ((this as any).aimMode as ('closest'|'toughest')) || ((window as any).__aimMode);
        const mode = (cur === 'toughest' || cur === 'closest') ? cur : 'closest';
        (this as any).aimMode = mode; (window as any).__aimMode = mode;
        try { localStorage.setItem('cs-aimMode', mode); } catch {}
        window.dispatchEvent(new CustomEvent('aimModeChanged', { detail: { mode } }));
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      // Character select panel now uses HTML/DOM instead of canvas events
    });

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Do nothing for character select on 'click', only handle in 'mousedown'
      if (this.state === 'GAME_OVER') { // Add this condition
        this.handlePauseMenuClick(mouseX, mouseY);
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      // Character select click handling is now done via HTML/DOM events
      if (this.state === 'GAME_OVER') { // Add this condition
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        this.handlePauseMenuClick(mouseX, mouseY);
      } else if (this.state === 'PAUSE') {
        // Pause interactions handled by HTML overlay now
      } else if (this.state === 'GAME' && this.gameMode === 'LAST_STAND') {
        // Handle small square skip button click during SHOP
        try {
          const rect = this.canvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const worldX = mouseX + this.camX;
          const worldY = mouseY + this.camY;
          const ls: any = (this as any).lastStand;
          if (ls && typeof ls.tryClickSkipButton === 'function') {
            if (ls.tryClickSkipButton(worldX, worldY)) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
          }
        } catch { /* ignore */ }
      }
    });

  // Removed internal 'startGame' listener to avoid pre-CINEMATIC GAME state flash; main.ts handles start sequence.
  }

  /**
   * Resets the game state and player for a new run (optionally switching character).
   */
  public resetGame(selectedCharacterData?: any) {
  // Only create a new player if one doesn't exist or if new character data is provided
  if (!this.player || selectedCharacterData) {
    // Persist selected character for overlays/leaderboards
    if (selectedCharacterData) {
      this.selectedCharacterData = selectedCharacterData;
    }
    // Ensure we always pass a character dataset when available; prevents Player constructor fallback warnings
    this.player = new Player(this.worldW / 2, this.worldH / 2, selectedCharacterData || this.player?.characterData);
  try { if ((this.player as any)._instanceId == null) { (this.player as any)._instanceId = Math.floor(Math.random()*1e9); } } catch {}
    try {
      const scale = (this.player as any).getCharacterScale ? (this.player as any).getCharacterScale() : 1.0;
      this.player.radius = Math.round(18 * scale);
    } catch { this.player.radius = 18; }
  } else {
    // If player already exists and no new character data, just reset existing player state
    this.player.resetState(); // Implement this method in Player.ts
  }
  // Always rewire UpgradePanel to current player instance
  if (this.upgradePanel) {
    this.upgradePanel['player'] = this.player;
  }

  // Reset managers with new player reference
    // Abilities are now handled by operative-specific AbilityManagers
    this._abilities = [];
    this.enemySpatialGrid.clear(); // Clear grid on reset
    this.bulletSpatialGrid.clear(); // Clear grid on reset
  this.enemyManager = new EnemyManager(this.player, this.bulletSpatialGrid, this.particleManager, this.assetLoader, 1); // Pass spatial grid
  this.bossManager = new BossManager(this.player, this.particleManager, 1, this.assetLoader);
  // Recreate bullet manager with updated player reference
  this.bulletManager = new BulletManager(this.assetLoader, this.enemySpatialGrid, this.particleManager, this.enemyManager, this.player);
    // Ensure player uses the new enemyManager for enemyProvider
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    // Ensure player uses the correct game context for bulletManager
    this.player.setGameContext(this);
    // Re-initialize explosionManager with the new enemyManager instance
  this.explosionManager = new ExplosionManager(this.particleManager, this.enemyManager, this.player, this.bulletManager, (durationMs: number, intensity: number) => this.startScreenShake(durationMs, intensity));
    this.hud = new HUD(this.player, this.assetLoader);
    // Recreate / regenerate rooms depending on mode.
    if (!this.roomManager) {
      this.roomManager = new RoomManager(this.worldW, this.worldH);
    }
  if (this.gameMode === 'DUNGEON') {
      this.roomManager.generate(60);
  (this.roomManager as any).setOpenWorld(false);
    } else {
      // SHOWDOWN mode: clear any existing rooms/corridors so walkable is everywhere
      (this.roomManager as any).clear?.();
  (this.roomManager as any).setOpenWorld(true);
    }
    // Removed direct instantiation: this.upgradePanel = new UpgradePanel(this.player, this); // UpgradePanel is now set via setter in main.ts
    this.gameTime = 0;
    this.dpsLog = [];
    this.totalDamageDealt = 0;
    this.dpsHistory = [];
  (this.hud as any).maxDPS = 0;
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
    this.currentShakeTime = 0;
  this.state = 'GAME'; // Set state to GAME after reset
  // Ensure loop is running when entering GAME directly via reset
  try { if (this.gameLoop) this.gameLoop.start(); } catch {}
  try { window.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'GAME' } })); } catch {}

    // Restart upgrade offering: on a fresh run (e.g. after GAME_OVER Enter) the original
    // interval-based free upgrade watcher no longer exists (it was cleared after first run),
    // and initialUpgradeOffered remained true, preventing a new opening panel. Reset the flag
    // and proactively show the UpgradePanel once the state is GAME and the panel is wired.
  // Clear flag so cinematic completion will trigger offering
  // In Sandbox, block auto initial upgrade and any upgrade panel
  if (this.gameMode === 'SANDBOX') {
    this.initialUpgradeOffered = true;
    this.pendingInitialUpgrade = false;
  } else {
    this.initialUpgradeOffered = false;
    this.pendingInitialUpgrade = true; // arm for post-cinematic/gameplay
  }
  // Reset environment visual state to avoid oversaturated gradients on second run
  try { this.environment?.reset?.(); } catch {}
  // Reset Fog of War state for new run
  try { this.fog?.clear(); this.lastFowTileX = Number.NaN; this.lastFowTileY = Number.NaN; } catch {}
  }

  public setMainMenu(mainMenu: MainMenu) {
    this.mainMenu = mainMenu;
  }

  /**
   * Sets the CharacterSelectPanel instance for the game.
   * @param panel The CharacterSelectPanel instance.
   */
  public setCharacterSelectPanel(panel: CharacterSelectPanel) {
    this.characterSelectPanel = panel;
  }

  /**
   * Sets the UpgradePanel instance for the game.
   * @param panel The UpgradePanel instance.
   */
  public setUpgradePanel(panel: UpgradePanel) {
    this.upgradePanel = panel;
  }

  /** Explicit hook for main menu return so next start grants initial upgrade again. */
  public onReturnToMainMenu() {
    this.initialUpgradeOffered = false;
  }

  /** Fully stop gameplay and return to MAIN_MENU (no simulation continues in background). */
  public stopToMainMenu() {
    try { if (this.gameLoop) this.gameLoop.stop(); } catch { /* ignore */ }
    this.state = 'MENU';
    // Clear transient combat collections to free refs & ensure no residual updates if loop accidentally restarts
    try {
      this.enemyManager?.enemies?.forEach(e=> e.active = false);
      this.bulletManager?.bullets?.forEach(b=> b.active = false);
      this._activeBeams.length = 0;
    } catch {}
  // Dispose Last Stand specific UI/handlers if active
  try { (this.lastStand as any)?.dispose?.(); } catch {}
  try { this.lastStand = undefined as any; } catch {}
    // Reset shake / timers
    this.shakeDuration = 0; this.currentShakeTime = 0; this.shakeIntensity = 0;
    (this as any).pendingInitialUpgrade = false; // will be re-armed on next resetGame/start
  }

  /** Public getter for current high-level game state (for global key handlers). */
  public getState() {
    return this.state;
  }

  /** Public accessor for total elapsed gameplay time in seconds. */
  public getGameTime() { return this.gameTime; }
  /** Current rolling DPS from HUD. */
  public getCurrentDPS() { return this.hud?.currentDPS ?? 0; }
  /** Active enemy count (approx). */
  public getEnemyCount() { return this.enemyManager?.getEnemies()?.length || 0; }
  /** Upgrade count acquired this run. */
  public getUpgradeCount() { return this.player?.upgrades?.length || 0; }
  /** Total kills (cumulative) */
  public getKillCount() { return (this.enemyManager as any)?.getKillCount?.() || 0; }

  /**
   * Pauses the game.
   */
  public pause() {
    if (this.state !== 'GAME') return; // Only allow pausing from active gameplay
  this.state = 'PAUSE'; // update state first so listeners see PAUSE
  if (this.gameLoop) this.gameLoop.stop();
  try { window.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'PAUSE' } })); } catch {}
  // Defer to main.ts listener to show overlay (it will verify state === 'PAUSE').
  window.dispatchEvent(new CustomEvent('showPauseOverlay', { detail: { auto: false } }));
  }

  /**
   * Resumes the game.
   */
  public resume() {
  // Only allow resume strictly from PAUSE; ignore spurious events (prevents restart after returning to menu)
  if (this.state !== 'PAUSE') {
    (window as any).__lastResumeIgnored = { prev: this.state, t: performance.now() };
    return;
  }
  const was = this.state;
  if (this.gameLoop) this.gameLoop.start();
  this.state = 'GAME';
  try { window.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'GAME' } })); } catch {}
  try { window.dispatchEvent(new CustomEvent('hidePauseOverlay')); } catch {}
  (window as any).__lastResumeDebug = { prev: was, now: this.state, t: performance.now(), loop: (this.gameLoop as any) };
  }

  /**
   * Starts the main game loop.
   */
  public start() {
  // Defer actual loop start until gameplay to keep menu idle CPU near-zero
  if (this.state === 'GAME') this.gameLoop.start();
  }

  public startCinematicAndGame() {
  const isSandbox = this.gameMode === 'SANDBOX';
  const isLastStand = this.gameMode === 'LAST_STAND';
  // Ensure world structure matches current mode
  if (this.gameMode === 'DUNGEON') {
    this.roomManager.clear?.();
    this.roomManager.generate(60);
    (this.roomManager as any).setOpenWorld(false);
  } else {
    this.roomManager.clear?.();
    (this.roomManager as any).setOpenWorld(true);
  }
  if (isSandbox) {
    // Skip cinematic entirely for Sandbox; ensure loop is running
    const was = this.state;
    if (was !== 'GAME') {
      this.setState('GAME');
    } else {
      // If already GAME (e.g., resetGame set it), make sure loop is started
      if (this.gameLoop) this.gameLoop.start();
      try { window.dispatchEvent(new CustomEvent('statechange', { detail: { state: 'GAME' } })); } catch {}
    }
    return;
  }
  if (isLastStand) {
    // Play a dedicated Last Stand cinematic, then init mode
    if (!this.lastStand) this.lastStand = new LastStandGameMode(this as any);
    this.setState('CINEMATIC');
    // Lock skip until LS assets are warmed to avoid stutter at T0
    (window as any).__cinSkipLocked = true;
    const unlock = () => { try { (window as any).__cinSkipLocked = false; } catch {} };
  // Kick a targeted LS preload in parallel (UI and common assets)
    (async () => {
      try {
        const al: any = (this as any).assetLoader;
        await al?.loadManifest?.();
        await al?.loadAllFromManifest?.();
      } catch {}
      unlock();
    })();
    this.cinematic.start('LAST_STAND', () => {
      // If preload still running, delay transition a tick to avoid first-frame jank
      const go = () => {
        this.setState('GAME');
        if (this.lastStand && typeof this.lastStand.init === 'function') this.lastStand.init();
        // Smoothly reveal the LS HUD only after cinematic completes
        try { (this.lastStand as any).hud?.showSmooth?.(); } catch {}
      };
      if ((window as any).__cinSkipLocked) { setTimeout(go, 50); } else { go(); }
    });
    return;
  }
  // Default path: play cinematic, then enter gameplay
  this.setState('CINEMATIC');
  this.cinematic.start(this.gameMode, () => {
    this.setState('GAME');
    // pendingInitialUpgrade logic in setState will pick this up
  });
  }

  /**
   * Shift absolute timers by deltaMs so that auto-pause (blur) doesn't recharge abilities or expire effects.
   * This adjusts common fields across Player, current AbilityManager instances (Weaver/Nomad), and a few globals.
   */
  private adjustTimeAfterPause(deltaMs: number) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const shiftIfTime = (obj: any, key: string) => {
      try {
        const v = obj?.[key];
        if (typeof v === 'number' && isFinite(v)) {
          // Only shift timestamps that are in the future relative to when pause began (tolerate small negatives)
          obj[key] = v + deltaMs;
        }
      } catch {}
    };

    // Player-level timers (invuln, surges, etc.) — shift any numeric field ending with 'Until' or 'UntilMs'.
    try {
      const pAny: any = this.player as any;
      for (const k in pAny) {
        if (!Object.prototype.hasOwnProperty.call(pAny, k)) continue;
        if ((/Until(Ms)?$/i).test(k) && typeof pAny[k] === 'number') {
          shiftIfTime(pAny, k);
        }
      }
      // Rogue Hacker: Ghost Protocol ability stores its own absolute timestamps; shift them too
      try {
        const gp: any = pAny.ghostProtocol;
        if (gp) {
          shiftIfTime(gp, 'start');
          shiftIfTime(gp, 'end');
          shiftIfTime(gp, 'nextTick');
          shiftIfTime(gp, '_ghostProtocolCdUntil');
        }
      } catch {}
      // Known nested state bags
  const hg = pAny.__hgTurret; if (hg && typeof hg.cooldownUntil === 'number') shiftIfTime(hg, 'cooldownUntil');
  // Legacy Cyber Runner Vector Boomerang (__runnerVB) removed; cooldown handled by ability manager's onTimeShift.
    } catch {}

    // Current operative ability manager internals (generic hook + best-effort per-ability safety net)
    try {
      const am: any = (this.player as any).abilityManager;
      if (am) {
        const hasHook = typeof am.onTimeShift === 'function';
        // Preferred: let the manager shift its own internal timers
        if (hasHook) {
          try { am.onTimeShift(deltaMs); } catch {}
        }

        // Safety net (only if manager doesn't provide a hook): known abilities with local timestamp fields
        if (!hasHook) {
          // Psionic Weaver
          if (am.constructor?.name === 'PsionicWeaverAbilityManager') {
            const st = am['stitch'];
            if (st) {
              shiftIfTime(st, 'cdUntil');
              shiftIfTime(st, 'returnAt');
              shiftIfTime(st, 'lingerUntil');
              shiftIfTime(st, 'justTeleportedAt');
              shiftIfTime(st, 'justReturnedAt');
            }
          }
          // Neural Nomad
          if (am.constructor?.name === 'NeuralNomadAbilityManager') {
            const sw = am['swarm'];
            if (sw) {
              shiftIfTime(sw, 'cdUntil');
              try {
                const drones: any[] = sw['drones'];
                if (Array.isArray(drones)) for (let i = 0; i < drones.length; i++) shiftIfTime(drones[i], 'next');
              } catch {}
            }
          }
          // Wasteland Scavenger (redirect + pulse)
          if (am.constructor?.name === 'WastelandScavengerAbilityManager') {
            const rd = am['redirect'];
            if (rd) {
              shiftIfTime(rd, 'redirectCdUntil');
              shiftIfTime(rd, 'pulseCdUntil');
            }
          }
          // Data Sorcerer (storm cd/active)
          if (am.constructor?.name === 'DataSorcererAbilityManager') {
            const st = am['storm'];
            if (st) { shiftIfTime(st, 'cdUntil'); shiftIfTime(st, 'activeUntil'); }
          }
          // Tech Warrior (anchor substate bag)
          if (am.constructor?.name === 'TechWarriorAbilityManager') {
            const pAny: any = (this.player as any);
            const tw = pAny.__techAnchor; if (tw) shiftIfTime(tw, 'cooldownUntil');
          }
          // Rogue Hacker manual hack previously used a per-operative controller; removed in favor of centralized logic.
        }
      }
    } catch {}

    // Active beams in Game (visual timers use start/duration)
    try {
      const beams: any[] = this._activeBeams as any[];
      if (Array.isArray(beams)) {
        for (let i = 0; i < beams.length; i++) {
          const b = beams[i];
          if (b && typeof b.start === 'number') b.start += deltaMs;
          if (b && typeof b.end === 'number') b.end += deltaMs; // if present
          if (b && typeof b.lastTick === 'number') b.lastTick += deltaMs;
        }
      }
    } catch {}

    // Global window markers used by overlays and class passives
    try {
      const w: any = window as any;
      const globals = ['__weaverLatticeActiveUntil', '__overmindActiveUntil', '__bioBoostActiveUntil'];
      for (let i = 0; i < globals.length; i++) { if (typeof w[globals[i]] === 'number') w[globals[i]] += deltaMs; }
    } catch {}

    // EnemyManager coarse timers (spawn freeze, outbreaks, cloak follows). Per-enemy debuffs are left as-is for performance.
    try {
      const emAny: any = this.enemyManager as any;
      const keys = ['spawnFreezeUntilMs', 'bioOutbreakUntil', 'shadowSurgeUntilMs'];
      for (let i = 0; i < keys.length; i++) { if (typeof emAny[keys[i]] === 'number') emAny[keys[i]] += deltaMs; }
      if (emAny._ghostCloakFollow && typeof emAny._ghostCloakFollow.until === 'number') emAny._ghostCloakFollow.until += deltaMs;
      if (typeof emAny.hackerAutoCooldownUntil === 'number') emAny.hackerAutoCooldownUntil += deltaMs;
    } catch {}
  }

  public showCharacterSelect() {
    // Minimal implementation: simply set state, UI panels are managed elsewhere.
    this.setState('CHARACTER_SELECT');
  }

  // drawPause removed; handled by HTML PauseOverlay

  drawGameOver() { /* replaced by GameOverOverlay DOM */ }

  /** Parse mode from URL (?mode=laststand or #mode=ls). Returns null if none. */
  private parseModeFromUrl(): 'SHOWDOWN'|'DUNGEON'|'SANDBOX'|'LAST_STAND'|null {
    try {
      const url = new URL(location.href);
      const q = (url.searchParams.get('mode') || '').toLowerCase();
      const h = (url.hash || '').toLowerCase();
      if (q === 'laststand' || q === 'ls') return 'LAST_STAND';
      if (q === 'sandbox') return 'SANDBOX';
      if (q === 'dungeon') return 'DUNGEON';
      if (h.includes('mode=laststand') || h.includes('mode=ls')) return 'LAST_STAND';
      if (h.includes('mode=sandbox')) return 'SANDBOX';
      if (h.includes('mode=dungeon')) return 'DUNGEON';
    } catch {}
    return null;
  }

  /**
   * The main update method for the game logic.
   * @param deltaTime The time elapsed since the last update, in milliseconds.
   */
  private update(deltaTime: number) {
    // Hard-freeze the simulation during revive cinematic: no movement, no contact, no updates
    if (this.reviveCinematicActive) {
      // Keep camera centered on player while frozen
      this.camX = this.player.x - this.designWidth / 2;
      this.camY = this.player.y - this.designHeight / 2;
      this.camX = Math.max(0, Math.min(this.camX, this.worldW - this.designWidth));
      this.camY = Math.max(0, Math.min(this.camY, this.worldH - this.designHeight));
      (window as any).__camX = this.camX;
      (window as any).__camY = this.camY;
      (window as any).__designWidth = this.designWidth;
      (window as any).__designHeight = this.designHeight;
      // Only handle revive cinematic timing and detonation scheduling
      const nowFreeze = performance.now();
      const elapsed = nowFreeze - this.reviveCinematicStart;
      if (elapsed >= this.reviveCinematicDuration) {
        this.triggerReviveDetonation();
        this.reviveCinematicActive = false;
        try { (window as any).__reviveCinematicActive = false; } catch {}
      }
      // Skip all other updates while frozen
      return;
    }
  // Always run gameLoop, and advance gameTime if in GAME state
  if (this.state === 'GAME') {
  // Last Stand SHOP hard-freeze: keep only LS timers/UI alive; freeze player/enemies/bullets behind the overlay
  try {
    const lsAny: any = this.lastStand as any;
    const isShop = !!(lsAny && lsAny.phase === 'SHOP');
    if (isShop) {
      // Advance only LS orchestrator so its countdown can end and close the shop
      if (this.lastStand) this.lastStand.update(deltaTime);
      // Maintain camera anchored to current player position without moving simulation
      this.camX = this.player.x - this.designWidth / 2;
      this.camY = this.player.y - this.designHeight / 2;
      this.camX = Math.max(0, Math.min(this.camX, this.worldW - this.designWidth));
      this.camY = Math.max(0, Math.min(this.camY, this.worldH - this.designHeight));
      (window as any).__camX = this.camX; (window as any).__camY = this.camY;
      // Skip updating the rest of the simulation while in SHOP
      return;
    }
  } catch { /* ignore LS phase check */ }
  // One-time world expansion after first 10s of gameplay to keep early coordinates small
  if (!this.worldExpanded && this.gameTime > 10) {
    this.worldW = 4000 * 100;
    this.worldH = 4000 * 100;
    this.worldExpanded = true;
  }
  // Expose avg frame time for adaptive systems (particle manager) using rolling EMA
  (window as any).__avgFrameMs = ((window as any).__avgFrameMs ?? deltaTime) * 0.9 + deltaTime * 0.1;
  this.gameTime += deltaTime / 1000;
  // Capture pre-move position for collision resolution
  const pPrevX = this.player.x;
  const pPrevY = this.player.y;
  this.player.update(deltaTime);
  // Track player room & apply room collision constraints (post movement)
  if (this.gameMode === 'DUNGEON') this.roomManager.trackPlayer(this.player.x, this.player.y);
  const constrained = this.roomManager.constrainPosition(pPrevX, pPrevY, this.player.x, this.player.y, this.player.radius);
  this.player.x = constrained.x; this.player.y = constrained.y;
  // Post-knockback unstick: if somehow still outside walkable (rare embedding), project inward using clampToWalkable
  const rmAny2: any = this.roomManager as any;
  if (rmAny2 && typeof rmAny2.isWalkable === 'function' && !rmAny2.isWalkable(this.player.x, this.player.y, this.player.radius)) {
    const proj = this.roomManager.clampToWalkable(this.player.x, this.player.y, this.player.radius);
    this.player.x = proj.x; this.player.y = proj.y;
  }
  this.explosionManager?.update(deltaTime);
  // Let mode orchestrator run (turrets, timers) early so LS visibility cache is fresh for this frame
  if (this.lastStand) this.lastStand.update(deltaTime);
  // Enemy update after LS so intake/targeting can use freshly published LS cache
  this.enemyManager.update(deltaTime, this.gameTime, this.bulletManager.bullets);
  // Enforce enemy collision with rooms / corridors (simple clamp against previous pos) to stop leaking through walls.
  const rmAny: any = this.roomManager;
  if (rmAny && typeof rmAny.constrainPosition === 'function') {
    const enemies = this.enemyManager.getEnemies ? this.enemyManager.getEnemies() : (this.enemyManager as any).enemies;
    if (enemies) {
      for (let i=0;i<enemies.length;i++) {
        const e = enemies[i];
        if (!e.active) continue;
        const prevEx = e._prevX ?? e.x;
        const prevEy = e._prevY ?? e.y;
  const c = this.roomManager.constrainPosition(prevEx, prevEy, e.x, e.y, e.radius || 18, 'enemy');
        e.x = c.x; e.y = c.y;
        e._prevX = e.x; e._prevY = e.y;
      }
    }
  }
  this.bossManager.update(deltaTime, this.gameTime);
  this.bulletManager.update(deltaTime);
  // Update abilities (self-managed state)
  try {
    const abs: any[] = this._abilities as any;
    if (abs && abs.length) {
      for (let i = 0; i < abs.length; i++) {
        const a = abs[i]; if (!a) continue;
        if (typeof a.update === 'function') { a.update(this.player as any, deltaTime); }
      }
    }
  } catch { /* noop */ }
    // Update active beams (damage + expiry)
    if (this._activeBeams.length) {
      const now = performance.now();
      this._activeBeams = this._activeBeams.filter(b => {
        if (now - b.start >= b.duration) return false;
        if (typeof b.dealDamage === 'function') b.dealDamage(now);
        return true;
      });
    }
  this.particleManager.update(deltaTime);
  // RMB controllers removed
  // Update environment (biome cycle)
  this.environment.update(this.gameTime);
  this.damageTextManager.update();
  // Fog of War dirty recompute when player crosses tile
  if (this.fowEnabled && this.fog) {
    const ts = this.fowTileSize; // keep in sync with setGrid tile size
    const tx = Math.floor(this.player.x / ts);
    const ty = Math.floor(this.player.y / ts);
    // Recompute strictly on tile-cross or after a small time interval to avoid rapid thrash
    const movedTile = (tx !== this.lastFowTileX || ty !== this.lastFowTileY);
    // Recompute budget every ~120ms if not moved across a tile, to keep explored downgrade progressing
    const now = performance.now ? performance.now() : Date.now();
    const lastFowAt = (this as any).__lastFowComputeAt || 0;
    const timeBudgetHit = (now - lastFowAt) >= 120;
    if (movedTile || timeBudgetHit) {
  this.fog.compute(tx, ty, Math.max(1, Math.floor(this.getEffectiveFowRadiusTiles())));
      this.lastFowTileX = tx; this.lastFowTileY = ty;
      (this as any).__lastFowComputeAt = now;
    }
  }
  // (handled at top) revive cinematic timing and detonation

    // Clear and re-populate spatial grids
    this.enemySpatialGrid.clear();
    for (let i=0;i<this.enemyManager.enemies.length;i++) {
      const enemy = this.enemyManager.enemies[i];
      if (enemy.active) this.enemySpatialGrid.insert(enemy);
    }
    this.bulletSpatialGrid.clear();
    for (let i=0;i<this.bulletManager.bullets.length;i++) {
      const bullet = this.bulletManager.bullets[i];
      if (bullet.active) this.bulletSpatialGrid.insert(bullet);
    }

  // --- Boss bullet collision ---
    const boss = this.bossManager.getActiveBoss();
    if (boss) {
      // Use spatial grid to find potential bullets near boss
      const potentialBullets = this.bulletSpatialGrid.query(boss.x, boss.y, boss.radius);
      const bossRadSumSqBase = boss.radius; // will add bullet radius per test
      for (let i = 0; i < potentialBullets.length; i++) {
        const b = potentialBullets[i];
        if (!b.active) continue;
    // Absolutely collisionless weapons: do not process boss collision here.
    //  - Quantum Halo / Industrial Grinder: flagged as isOrbiting and handle contact internally.
    //  - Melee sweep weapons: flagged via isMeleeSweep and handled in BulletManager sweep logic.
    if ((b as any).isOrbiting) continue;
    if ((b as any).isMeleeSweep) continue;
        const dx = b.x - boss.x;
        const dy = b.y - boss.y;
        const r = bossRadSumSqBase + b.radius;
        if (dx*dx + dy*dy < r*r) { // squared distance check
          // Route through EnemyManager for consistency, pass weapon type when available
          const wType: any = (b as any).weaponType;
          try { (this.enemyManager as any)?.takeBossDamage?.(boss, b.damage, false, wType, b.x, b.y); } catch {}
          b.active = false;
          this.particleManager.spawn(boss.x, boss.y, 1, '#FFD700');
          window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount: b.damage, isCritical: false, x: boss.x, y: boss.y } }));
        }
      }
    }
    // Update DPS calculation
    const currentTime = performance.now();
    while (this.dpsHistory.length > 0 && currentTime - this.dpsHistory[0].time > this.dpsWindow) {
      this.dpsHistory.shift();
    }
    const totalDamageInWindow = this.dpsHistory.reduce((sum, entry) => sum + entry.damage, 0);
    const currentDPS = (totalDamageInWindow / this.dpsWindow) * 1000;
    this.hud.currentDPS = currentDPS;
  if (currentDPS > (this.hud as any).maxDPS) (this.hud as any).maxDPS = currentDPS;
  // Follow player using logical viewport dimensions only (canvas.width includes DPR * renderScale which caused offset)
  const targetCamX = this.player.x - this.designWidth / 2;
  const targetCamY = this.player.y - this.designHeight / 2;
  // Delta-aware smoothing so perceived damping constant independent of frame time.
  const dtNorm = Math.max(0.1, Math.min(3, deltaTime / 16.6667)); // clamp extreme spikes
  const lerpFactor = 1 - Math.pow(1 - this.camLerp, dtNorm); // exponential smoothing invariant to fps
  this.camX += (targetCamX - this.camX) * lerpFactor;
  this.camY += (targetCamY - this.camY) * lerpFactor;
    // Clamp within world using logical viewport
    this.camX = Math.max(0, Math.min(this.camX, this.worldW - this.designWidth));
    this.camY = Math.max(0, Math.min(this.camY, this.worldH - this.designHeight));
  (window as any).__camX = this.camX;
  (window as any).__camY = this.camY;
    if (this.player.hp <= 0) {
      this.state = 'GAME_OVER';
      // Fire DOM overlay event (GameOverOverlay will lazy-create/show)
      try {
        window.dispatchEvent(new CustomEvent('showGameOverOverlay'));
      } catch { /* ignore */ }
    }
  } else if (this.state === 'CINEMATIC') {
    this.cinematic.update();
    if (this.cinematic.isFinished()) {
      this.state = 'GAME';
    }
  } else {
    // Skip heavy updates when not in active gameplay/cinematic
  // (perf overlay removed)
    return;
  }
  // (dynamic Electron-specific internal resolution scaling removed)
  // Auto downgrade / upgrade FX based on sustained frame time
  const avg = (window as any).__avgFrameMs;
  if (avg !== undefined) {
    if (avg > 22 && !this.lowFX) { this.lowFX = true; (window as any).__lowFX = true; }
    else if (avg < 17 && this.lowFX) { this.lowFX = false; (window as any).__lowFX = false; }
  }
  }

  /**
   * The main render method for drawing game elements.
   * @param alpha The interpolation factor for smooth rendering between fixed updates.
   */
  private render(alpha: number) {
  const debugNoAdd = (window as any).__noAddBlend; // set this flag in devtools to disable all additive flashes
  // Auto-heal: if window size changed (maximize/restore) but resize handler missed it, force a resize.
  if ((this.state === 'GAME' || this.state === 'PAUSE' || this.state === 'UPGRADE_MENU' || this.state === 'GAME_OVER') && !((window as any).__noAutoResize)) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Compare against design size (logical). If mismatch >1px trigger resize.
    if (Math.abs(w - this.designWidth) > 1 || Math.abs(h - this.designHeight) > 1) {
      this.resize(w, h);
    }
    // Enforce CSS stretch every frame (some Electron maximize events intermittently fail to apply style width/height)
    if (this.lastCssW !== this.designWidth || this.lastCssH !== this.designHeight) {
      this.canvas.style.width = this.designWidth + 'px';
      this.canvas.style.height = this.designHeight + 'px';
      this.lastCssW = this.designWidth; this.lastCssH = this.designHeight;
    }
  }
  // FPS sampling (updated once per second)
  this.fpsFrameCount++;
  const fpsNow = performance.now();
  if (fpsNow - this.fpsLastTs >= 1000) {
    (window as any).__fpsSample = Math.round(this.fpsFrameCount * 1000 / (fpsNow - this.fpsLastTs));
    this.fpsFrameCount = 0;
    this.fpsLastTs = fpsNow;
  }
  // Skip almost all work if we're in a non-game menu where canvas is hidden
  if (this.state === 'MAIN_MENU') { return; }
  // Optional half-rate rendering (set window.__halfRender=true in devtools to test) – game logic still 60Hz
  if ((window as any).__halfRender) {
    (window as any).__halfToggle = !(window as any).__halfToggle;
  if ((window as any).__halfToggle) { return; }
  }
  this.ctx.setTransform(1,0,0,1,0,0);
  this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  // Hard reset of render state each frame (guards against leaked alpha / composite from prior entity flash draws)
  this.ctx.globalAlpha = 1;
  this.ctx.globalCompositeOperation = 'source-over';
  this.ctx.shadowBlur = 0;
  this.ctx.shadowColor = 'transparent';
  if (this.minimalRender) {
    // Ultra-simple diagnostic frame: solid bg + player dot only.
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    this.ctx.fillStyle = '#0ff';
    this.ctx.beginPath();
    this.ctx.arc(this.canvas.width/2, this.canvas.height/2, 12, 0, Math.PI*2);
    this.ctx.fill();
    // Pulsing rectangle to visualize present cadence
    const t = (performance.now()/250)%1;
    this.ctx.fillStyle = '#f0f';
    this.ctx.fillRect(10, 10, 80 * t, 6);
  return; // skip full render path (minimal)
    }
    // Simple diagnostic render path (skip almost everything to test compositor pacing)
    if ((window as any).__simpleRender) {
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
      this.ctx.fillStyle = '#0ff';
      this.ctx.font = '16px monospace';
      this.ctx.fillText('SIMPLE RENDER MODE (F10)', 12, 24);
      this.ctx.fillText('Enemies: '+ this.enemyManager.enemies.length, 12, 46);
      this.ctx.fillText('Bullets: '+ this.bulletManager.bullets.length, 12, 66);
      // Player marker
      this.ctx.fillStyle = '#fff';
      this.ctx.beginPath();
      this.ctx.arc(this.canvas.width/2, this.canvas.height/2, 10, 0, Math.PI*2);
      this.ctx.fill();
  return; // simple render path
  }
  // Apply logical coordinate scaling so game logic uses design space
  // Apply high-DPI transform so logical coordinates map to CSS pixels; background fill will cover full area.
  const dpr = (window as any).devicePixelRatio || 1;
  this.ctx.scale(dpr * this.renderScale, dpr * this.renderScale);
  // Frame pulse (visual actual repaint cadence)
  // Removed frame pulse debug box

  // (Removed global ctx.filter brightness which caused full-screen flicker on some drivers when combined with 'lighter' beam composites.)
  // Keep filter neutral; apply a lightweight additive overlay later instead (see below) when brightenMode is enabled.
  this.ctx.filter = 'none';

    // Apply screen shake
    let shakeOffsetX = 0;
    let shakeOffsetY = 0;
    if (this.shakeDuration > 0) {
      const elapsed = performance.now() - this.currentShakeTime;
      if (elapsed < this.shakeDuration) {
        shakeOffsetX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
        shakeOffsetY = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      } else {
        this.shakeDuration = 0; // End shake
      }
    }

    // Always ensure canvas is visible and on top for gameplay states
    const canvasElem = document.getElementById('gameCanvas') as HTMLCanvasElement;
    if (canvasElem) {
      if (["GAME", "CINEMATIC", "CHARACTER_SELECT", "UPGRADE_MENU", "PAUSE", "GAME_OVER"].includes(this.state)) {
        canvasElem.style.display = 'block';
        canvasElem.style.zIndex = '10';
  // Ensure CSS logical size stays at design reference
  canvasElem.style.width = this.designWidth + 'px';
  canvasElem.style.height = this.designHeight + 'px';
      } else {
        canvasElem.style.zIndex = '-1';
      }
    }

    switch (this.state) {
      case 'GAME':
      case 'PAUSE':
      case 'UPGRADE_MENU':
      case 'GAME_OVER':
  // Optimized background: cached gradient + grid/noise pattern composited with camera offset.
  // Draw dynamic environment (biome aware)
  this.environment.setLowFX(this.lowFX);
  // In SANDBOX, keep environment bright and avoid darkening overlays
  if (this.gameMode === 'SANDBOX') (this as any).brightenMode = true;
  this.environment.draw(this.ctx, this.camX, this.camY, this.canvas.width, this.canvas.height);
  // Darker vibe for Last Stand: cool vignette overlay
  if (this.gameMode === 'LAST_STAND') {
    this.ctx.save();
    const g = this.ctx.createRadialGradient(this.canvas.width/2, this.canvas.height/2, Math.min(this.canvas.width, this.canvas.height) * 0.25,
                                            this.canvas.width/2, this.canvas.height/2, Math.max(this.canvas.width, this.canvas.height) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0.0)');
    g.addColorStop(1, 'rgba(8,12,20,0.35)');
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    this.ctx.restore();
  }
  // Rogue Hacker overlay (post-world, pre-HUD)
  // Draw ability world visuals
  try {
    const abs: any[] = this._abilities as any;
    if (abs && abs.length) {
      for (let i=0;i<abs.length;i++) { const a = abs[i]; if (a && typeof a.drawWorld === 'function') a.drawWorld(this.player as any, this.ctx); }
    }
  } catch { /* ignore */ }
  // Light biome pocket tint overlay (not part of debug) for visual variety
        // Ability overlay visuals (pre-HUD)
        try {
          const abs: any[] = this._abilities as any;
          if (abs && abs.length) {
            for (let i=0;i<abs.length;i++) { const a = abs[i]; if (a && typeof a.drawOverlay === 'function') a.drawOverlay(this.player as any, this.ctx); }
          }
        } catch { /* ignore */ }

        this.hud.draw(this.ctx, this.gameTime, this.enemyManager.getEnemies(), this.worldW, this.worldH, this.player.upgrades);
  if (!this.showRoomDebug) {
    // New unified walkable underlay: darken outside + soft tint inside, beneath entities
    if (this.gameMode === 'DUNGEON' || this.gameMode === 'LAST_STAND') {
      this.roomManager.drawWalkableUnderlay(this.ctx, this.camX, this.camY);
      // Last Stand terrain: UNWALKABLE = grey dystopian terrain, WALKABLE (corridor) = grey road
      if (this.gameMode === 'LAST_STAND') {
        try {
          // Build (and cache) a small pattern canvas once
          const w: any = window as any;
          // Grey dystopian terrain (used outside the corridor)
          if (!w.__lsDystopiaPattern) {
            const pC = document.createElement('canvas'); pC.width = 96; pC.height = 96;
            const pCtx = pC.getContext('2d');
            if (pCtx) {
              // Base concrete
              pCtx.fillStyle = '#2c2f33';
              pCtx.fillRect(0,0,pC.width,pC.height);
              // Fine noise pass (one-time)
              const img = pCtx.getImageData(0,0,pC.width,pC.height); const data = img.data;
              for (let i=0;i<data.length;i+=4){
                const v = ((Math.random()*14)|0) - 7; // -7..+6
                data[i] = Math.max(0, Math.min(255, data[i] + v));
                data[i+1] = Math.max(0, Math.min(255, data[i+1] + v));
                data[i+2] = Math.max(0, Math.min(255, data[i+2] + v));
              }
              pCtx.putImageData(img,0,0);
              // Cracks (random jagged lines)
              pCtx.strokeStyle = 'rgba(0,0,0,0.22)';
              pCtx.lineWidth = 1;
              for (let c=0;c<8;c++) {
                let x = Math.random()*pC.width;
                let y = Math.random()*pC.height;
                pCtx.beginPath(); pCtx.moveTo(x,y);
                const seg = 3 + (Math.random()*3|0);
                for (let s=0;s<seg;s++) {
                  x += (Math.random()*18 - 9);
                  y += (Math.random()*18 - 9);
                  pCtx.lineTo(x,y);
                }
                pCtx.stroke();
              }
              // Debris specks
              for (let i=0;i<140;i++){
                const sx = Math.random()*pC.width, sy = Math.random()*pC.height;
                const sz = (Math.random()<0.85)?1:2;
                pCtx.fillStyle = (Math.random()<0.5) ? 'rgba(200,205,210,0.10)' : 'rgba(0,0,0,0.20)';
                pCtx.fillRect(sx, sy, sz, sz);
              }
              // Subtle oil stains
              pCtx.fillStyle = 'rgba(0,0,0,0.08)';
              for (let i=0;i<3;i++){
                const cx = Math.random()*pC.width, cy = Math.random()*pC.height, r = 10 + Math.random()*20;
                pCtx.beginPath(); pCtx.arc(cx, cy, r, 0, Math.PI*2); pCtx.fill();
              }
            }
            w.__lsDystopiaPattern = pC;
          }
          // Road pattern (used inside the corridor)
          if (!w.__lsRoadPattern) {
            const rC = document.createElement('canvas'); rC.width = 96; rC.height = 96;
            const rCtx = rC.getContext('2d');
            if (rCtx) {
              // Asphalt base
              rCtx.fillStyle = '#42474c';
              rCtx.fillRect(0,0,rC.width,rC.height);
              // Fine asphalt noise
              const img2 = rCtx.getImageData(0,0,rC.width,rC.height); const d2 = img2.data;
              for (let i=0;i<d2.length;i+=4){
                const v = ((Math.random()*12)|0) - 6; // -6..+5
                d2[i] = Math.max(0, Math.min(255, d2[i] + v));
                d2[i+1] = Math.max(0, Math.min(255, d2[i+1] + v));
                d2[i+2] = Math.max(0, Math.min(255, d2[i+2] + v));
              }
              rCtx.putImageData(img2,0,0);
              // Subtle seams
              rCtx.strokeStyle = 'rgba(255,255,255,0.03)'; rCtx.lineWidth = 1;
              for (let y=0; y<=rC.height; y+=48) { rCtx.beginPath(); rCtx.moveTo(0,y); rCtx.lineTo(rC.width,y); rCtx.stroke(); }
            }
            w.__lsRoadPattern = rC;
          }
          const desertPat = this.ctx.createPattern(w.__lsDystopiaPattern, 'repeat');
          const roadPat = this.ctx.createPattern(w.__lsRoadPattern, 'repeat');
          if (desertPat && roadPat) {
            this.ctx.save();
            this.ctx.translate(-this.camX, -this.camY);
            // 1) Fill visible viewport with desert (unwalkable)
            this.ctx.fillStyle = desertPat;
            this.ctx.fillRect(this.camX, this.camY, this.canvas.width, this.canvas.height);
            // 2) Draw grey road inside corridor (walkable)
            const corrs = this.roomManager.getCorridors?.() || [];
            for (let i=0;i<corrs.length;i++){
              const c = corrs[i]; if (!c) continue;
              this.ctx.save();
              this.ctx.beginPath(); this.ctx.rect(c.x, c.y, c.w, c.h); this.ctx.clip();
              this.ctx.fillStyle = roadPat; this.ctx.fillRect(c.x, c.y, c.w, c.h);
              // Road edges — brighter for visible corridor walls
              this.ctx.strokeStyle = 'rgba(255,255,255,0.16)';
              this.ctx.lineWidth = 3;
              this.ctx.strokeRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);
              // Inner dashed lane lines for depth
              this.ctx.save();
              this.ctx.strokeStyle = 'rgba(255,255,255,0.10)';
              this.ctx.setLineDash([10, 14]);
              this.ctx.lineWidth = 2;
              const midY = c.y + Math.floor(c.h/2);
              this.ctx.beginPath(); this.ctx.moveTo(c.x + 10, midY); this.ctx.lineTo(c.x + c.w - 10, midY); this.ctx.stroke();
              this.ctx.restore();
              // Reset opacity before drawing gameplay props (pads, palisades, holders, gate)
              this.ctx.globalAlpha = 1.0;
              // Draw turret pads and palisades if present
              try {
                const pads: any[] = ((window as any).__gameInstance?.lastStand as any)?.pads || [];
                const pals: any[] = ((window as any).__gameInstance?.lastStand as any)?.palisades || [];
                const holders: any[] = ((window as any).__gameInstance?.lastStand as any)?.holders || [];
                const lsAny: any = (window as any).__gameInstance?.lastStand as any;
                const turretMgr: any = (lsAny && typeof lsAny.getTurretManager === 'function') ? lsAny.getTurretManager() : (lsAny?.turrets || null);
                // Pads — hidden per feedback (no neon circles)
                // Turrets: draw solid colored blocks at turret positions
                try {
                  if (turretMgr && typeof turretMgr.list === 'function') {
                    const list = turretMgr.list();
                    for (let i=0;i<list.length;i++){
                      const t = list[i]; if (!t) continue;
                      const color = (t.id === 'turret_minigun') ? '#0BD9BD' : (t.id === 'turret_crossbow3') ? '#D98B2B' : (t.id === 'turret_heavy_mortar' ? '#FFC857' : '#6CA6FF');
                      this.ctx.fillStyle = color; this.ctx.strokeStyle = 'rgba(0,0,0,0.65)'; this.ctx.lineWidth = 2;
                      const size = 26; // square block base
                      const x0 = t.x - size/2, y0 = t.y - size/2;
                      this.ctx.fillRect(x0, y0, size, size);
                      this.ctx.strokeRect(x0 + 0.5, y0 + 0.5, size-1, size-1);
                      // Icon overlay per type to show it was bought & what it is
                      this.ctx.save();
                      this.ctx.translate(t.x, t.y);
                      // Face nearest enemy for a tiny bit of life/aim feedback
                      try {
                        const em: any = (this as any).enemyManager || (this as any).getEnemyManager?.();
                        const enemies: any[] = em?.getEnemies?.() || [];
                        let ang = 0; let bd2 = Infinity;
                        for (let ei=0;ei<enemies.length;ei++){
                          const e = enemies[ei]; if (!e?.active || e.hp<=0) continue;
                          const dx = e.x - t.x, dy = e.y - t.y; const d2 = dx*dx + dy*dy; if (d2<bd2){ bd2 = d2; ang = Math.atan2(dy, dx); }
                        }
                        this.ctx.rotate(ang);
                      } catch { /* ignore */ }
                      if (t.id === 'turret_minigun') {
                        // Minigun glyph: base + tri-barrels + mount
                        this.ctx.fillStyle = '#073c36';
                        // Mount
                        this.ctx.fillRect(-6, 6, 12, 3);
                        // Body
                        this.ctx.fillRect(-6, -4, 12, 8);
                        // Barrels
                        this.ctx.fillStyle = '#0b6f63';
                        this.ctx.fillRect(4, -5, 10, 2);
                        this.ctx.fillRect(4, -1, 10, 2);
                        this.ctx.fillRect(4, 3, 10, 2);
                        // Pivot
                        this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
                        this.ctx.beginPath(); this.ctx.arc(-2, 0, 3, 0, Math.PI*2); this.ctx.fill();
                      } else if (t.id === 'turret_crossbow3') {
                        // Triple crossbow glyph (three chevrons)
                        this.ctx.strokeStyle = '#5a3008'; this.ctx.lineWidth = 2;
                        this.ctx.beginPath(); this.ctx.moveTo(-8,-4); this.ctx.lineTo(0,0); this.ctx.lineTo(-8,4); this.ctx.stroke();
                        this.ctx.beginPath(); this.ctx.moveTo(0,-4); this.ctx.lineTo(8,0); this.ctx.lineTo(0,4); this.ctx.stroke();
                        this.ctx.beginPath(); this.ctx.moveTo(-4,-6); this.ctx.lineTo(4,0); this.ctx.lineTo(-4,6); this.ctx.stroke();
                      } else if (t.id === 'turret_mortar' || t.id === 'turret_heavy_mortar') {
                        // Mortar glyph: tube + baseplate
                        this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
                        this.ctx.fillRect(-10, 6, 20, 4); // baseplate
                        this.ctx.fillStyle = '#6b5b2a';
                        this.ctx.rotate(-Math.PI/7);
                        this.ctx.fillRect(-2, -10, 4, 14); // tube
                        this.ctx.rotate(Math.PI/7);
                      } else {
                        // Default turret glyph
                        this.ctx.fillStyle = 'rgba(0,0,0,0.35)';
                        this.ctx.beginPath(); this.ctx.arc(0,0,5,0,Math.PI*2); this.ctx.fill();
                      }
                      this.ctx.restore();
                      // Subtle range ring for placement awareness
                      try {
                        const spec: any = turretMgr.getSpec?.(t.id);
                        const r = spec?.range || 520;
                        this.ctx.save();
                        this.ctx.globalAlpha = 0.08;
                        this.ctx.strokeStyle = color;
                        this.ctx.lineWidth = 2;
                        this.ctx.beginPath(); this.ctx.arc(t.x, t.y, r, 0, Math.PI*2); this.ctx.stroke();
                        this.ctx.restore();
                      } catch { /* ignore */ }
                    }
                    // Draw visible shot tracers (currently disabled in TurretManager to avoid flashing)
                    const shots = turretMgr.listShots?.() || [];
                    if (shots.length) {
                      for (let s=0;s<shots.length;s++){
                        const sh = shots[s];
                        const a = Math.max(0, Math.min(1, sh.life / sh.maxLife));
                        this.ctx.strokeStyle = sh.color;
                        this.ctx.globalAlpha = 0.85 * a + 0.15;
                        this.ctx.lineWidth = sh.width;
                        this.ctx.beginPath(); this.ctx.moveTo(sh.x, sh.y); this.ctx.lineTo(sh.x2, sh.y2); this.ctx.stroke();
                        this.ctx.globalAlpha = 1;
                      }
                    }
                  }
                } catch { /* ignore */ }
                // Palisades: full visual (vertical posts with caps)
                for (let k=0;k<pals.length;k++){
                  const ps = pals[k]; if (!ps) continue;
                  // Shadow
                  this.ctx.save();
                  this.ctx.fillStyle = 'rgba(0,0,0,0.35)';
                  this.ctx.filter = 'blur(1px)';
                  this.ctx.fillRect(ps.x + 3, ps.y + 3, ps.w, ps.h);
                  this.ctx.filter = 'none';
                  this.ctx.restore();
                  // Body (wood/metal tone)
                  const vertical = ps.h >= ps.w;
                  const grad = vertical
                    ? this.ctx.createLinearGradient(ps.x, ps.y, ps.x + ps.w, ps.y)
                    : this.ctx.createLinearGradient(ps.x, ps.y, ps.x, ps.y + ps.h);
                  grad.addColorStop(0, 'rgba(70,80,88,1.0)');
                  grad.addColorStop(0.5, 'rgba(112,132,144,1.0)');
                  grad.addColorStop(1, 'rgba(70,80,88,1.0)');
                  this.ctx.fillStyle = grad;
                  this.ctx.strokeStyle = 'rgba(20,30,36,0.85)';
                  this.ctx.lineWidth = 3;
                  this.ctx.beginPath(); this.ctx.rect(ps.x, ps.y, ps.w, ps.h); this.ctx.fill(); this.ctx.stroke();
                  // Top/Bottom caps
                  this.ctx.fillStyle = 'rgba(190,210,220,0.95)';
                  const cap = Math.max(6, Math.min(12, vertical ? Math.round(ps.w*0.9) : Math.round(ps.h*0.15)));
                  if (vertical) {
                    this.ctx.fillRect(ps.x-2, ps.y-4, ps.w+4, 6);
                    this.ctx.fillRect(ps.x-2, ps.y + ps.h - 2, ps.w+4, 6);
                  } else {
                    this.ctx.fillRect(ps.x-4, ps.y-2, 6, ps.h+4);
                    this.ctx.fillRect(ps.x + ps.w - 2, ps.y-2, 6, ps.h+4);
                  }
                  // Bolts / studs every 28px
                  this.ctx.fillStyle = 'rgba(235,245,250,0.95)';
                  const step = 28;
                  if (vertical) {
                    for (let yy = ps.y + 10; yy < ps.y + ps.h - 10; yy += step) {
                      this.ctx.fillRect(ps.x + Math.floor(ps.w/2) - 1, yy, 2, 2);
                    }
                  } else {
                    for (let xx = ps.x + 10; xx < ps.x + ps.w - 10; xx += step) {
                      this.ctx.fillRect(xx, ps.y + Math.floor(ps.h/2) - 1, 2, 2);
                    }
                  }
                }
                // Precompute nearest interactable (gate repair vs. holder) so only one hint appears and F targets it
                let __nearestType: 'gate'|'holder'|null = null;
                let __nearestHolder: any = null;
                let __nearestD2 = Infinity;
                try {
                  const p = this.player; if (p) {
                    const pr = (p.radius || 20);
                    const thresh2 = (pr + 36) * (pr + 36);
                    // Nearest holder
                    if (holders && holders.length) {
                      for (let i=0;i<holders.length;i++){
                        const h = holders[i]; if (!h) continue;
                        const cx = Math.max(h.x, Math.min(p.x, h.x + h.w));
                        const cy = Math.max(h.y, Math.min(p.y, h.y + h.h));
                        const dx = p.x - cx, dy = p.y - cy; const d2 = dx*dx + dy*dy;
                        if (d2 < __nearestD2 && d2 <= thresh2) { __nearestD2 = d2; __nearestType = 'holder'; __nearestHolder = h; }
                      }
                    }
                    // Gate (only if active and damaged)
                    try {
                      const gate: any = lsAny?.gate || null;
                      if (gate && gate.active && gate.hp > 0 && gate.hp < gate.maxHp) {
                        const cx = Math.max(gate.x, Math.min(p.x, gate.x + gate.w));
                        const cy = Math.max(gate.y, Math.min(p.y, gate.y + gate.h));
                        const dx = p.x - cx, dy = p.y - cy; const d2 = dx*dx + dy*dy;
                        if (d2 < __nearestD2 && d2 <= thresh2) { __nearestD2 = d2; __nearestType = 'gate'; __nearestHolder = null; }
                      }
                    } catch { /* ignore */ }
                  }
                } catch { /* ignore */ }
                // Gate: always draw if present (active bright, inside is transparent); HP bar + repair hint when selected
                try {
                  const gate: any = lsAny?.gate || null;
                  if (gate && gate.h > 0) {
                    this.ctx.save();
                    const active = !!gate.active && gate.hp > 0;
                    const col = active ? 'rgba(76,255,120,0.95)' : 'rgba(76,255,120,0.45)';
                    // If player is inside the gate rect, inner fill becomes translucent
                    let inside = false;
                    try {
                      const p = this.player; if (p) inside = (p.x >= gate.x && p.x <= gate.x + gate.w && p.y >= gate.y && p.y <= gate.y + gate.h);
                    } catch { inside = false; }
                    // Shadow
                    this.ctx.fillStyle = 'rgba(0,0,0,0.35)'; this.ctx.fillRect(gate.x + 3, gate.y + 3, gate.w, gate.h);
                    // Body
                    this.ctx.fillStyle = inside ? 'rgba(22,42,28,0.35)' : 'rgba(22,42,28,0.95)'; this.ctx.fillRect(gate.x, gate.y, gate.w, gate.h);
                    this.ctx.strokeStyle = col; this.ctx.lineWidth = 3; this.ctx.strokeRect(gate.x + 0.5, gate.y + 0.5, gate.w - 1, gate.h - 1);
                    // HP bar
                    const pct = (gate.maxHp > 0) ? Math.max(0, Math.min(1, gate.hp / gate.maxHp)) : 0;
                    const barW = Math.max(0, Math.floor((gate.w - 6) * pct));
                    this.ctx.fillStyle = 'rgba(30,60,36,0.9)';
                    this.ctx.fillRect(gate.x + 3, gate.y + 3, Math.max(0, gate.w - 6), 6);
                    this.ctx.fillStyle = 'rgba(76,255,120,0.9)';
                    this.ctx.fillRect(gate.x + 3, gate.y + 3, barW, 6);
                    // Repair hint: only when this is the nearest interactable
                    if (active && gate.hp < gate.maxHp && __nearestType === 'gate') {
                      try {
                        const cost = typeof lsAny.getGateRepairCost === 'function' ? lsAny.getGateRepairCost() : 0;
                        // Place compact hint just above gate center
                        const px = gate.x + gate.w / 2; const py = gate.y - 14;
                        this.ctx.font = 'bold 12px sans-serif';
                        this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'bottom';
                        this.ctx.fillStyle = 'rgba(22,42,28,0.9)';
                        this.ctx.fillText(`F ${cost}`.trim(), px, py);
                        this.ctx.fillStyle = '#7DFFEA';
                        this.ctx.fillText(`F ${cost}`.trim(), px, py);
                      } catch { /* ignore */ }
                    }
                    this.ctx.restore();
                  }
                } catch { /* ignore gate draw */ }
                // Turret holders (blocking)
                for (let k=0;k<holders.length;k++){
                  const h = holders[k]; if (!h) continue;
                  const occupied = !!(h as any).turretId;
                  // base block with different styling if occupied
                  this.ctx.save();
                  if (!occupied) { this.ctx.shadowColor = 'rgba(120,255,235,0.75)'; this.ctx.shadowBlur = 14; }
                  this.ctx.fillStyle = occupied ? 'rgba(10,20,24,0.98)' : 'rgba(14,34,40,0.98)';
                  this.ctx.strokeStyle = occupied ? 'rgba(255,211,110,0.95)' : 'rgba(120,255,235,0.95)';
                  this.ctx.lineWidth = 3;
                  this.ctx.beginPath(); this.ctx.rect(h.x, h.y, h.w, h.h); this.ctx.fill(); this.ctx.stroke();
                  this.ctx.restore();
                  if (!occupied) {
                    // empty slot visual
                    this.ctx.fillStyle = 'rgba(120,255,235,0.45)';
                    this.ctx.fillRect(h.x+6, h.y + h.h/2 - 3, h.w-12, 6);
                    this.ctx.strokeStyle = 'rgba(140,220,210,0.65)'; this.ctx.lineWidth = 1.5;
                    for (let yy=h.y+6; yy<h.y+h.h-6; yy+=8) {
                      this.ctx.beginPath(); this.ctx.moveTo(h.x+4, yy); this.ctx.lineTo(h.x+h.w-4, yy); this.ctx.stroke();
                    }
                  } else {
                    // occupied: draw a compact turret-type glyph inside the holder
                    const id = String((h as any).turretId || '');
                    this.ctx.save();
                    this.ctx.translate(h.x + h.w/2, h.y + h.h/2);
                    // small base plate
                    this.ctx.fillStyle = 'rgba(0,0,0,0.35)';
                    this.ctx.fillRect(-Math.min(12,h.w/2-3), Math.min(8,h.h/2-4), Math.min(24,h.w-6), 4);
                    if (id === 'turret_minigun') {
                      this.ctx.fillStyle = '#0BD9BD';
                      this.ctx.fillRect(-6, -4, 12, 8);
                      this.ctx.fillStyle = '#0b6f63';
                      this.ctx.fillRect(4, -5, 10, 2);
                      this.ctx.fillRect(4, -1, 10, 2);
                      this.ctx.fillRect(4, 3, 10, 2);
                    } else if (id === 'turret_crossbow3') {
                      this.ctx.strokeStyle = '#D98B2B'; this.ctx.lineWidth = 2;
                      this.ctx.beginPath(); this.ctx.moveTo(-6,-3); this.ctx.lineTo(0,0); this.ctx.lineTo(-6,3); this.ctx.stroke();
                      this.ctx.beginPath(); this.ctx.moveTo(0,-3); this.ctx.lineTo(6,0); this.ctx.lineTo(0,3); this.ctx.stroke();
                    } else if (id === 'turret_mortar' || id === 'turret_heavy_mortar') {
                      this.ctx.fillStyle = id === 'turret_heavy_mortar' ? '#FFC857' : '#C7B26A';
                      this.ctx.rotate(-Math.PI/7);
                      this.ctx.fillRect(-2, -8, 4, 12);
                    } else {
                      this.ctx.fillStyle = '#6CA6FF';
                      this.ctx.beginPath(); this.ctx.arc(0,0,4,0,Math.PI*2); this.ctx.fill();
                    }
                    this.ctx.restore();
                  }
                  // UX: show a subtle "F" hint only for the selected nearest holder
                  try {
                    const p = this.player;
                    if (p && holders.length && __nearestType === 'holder' && __nearestHolder === h) {
                        const bx = h.x + h.w/2;
                        // position inside the holder box (top-center), with small padding
                        const by = h.y + Math.max(10, Math.min(16, h.h * 0.2));
                        this.ctx.save();
                        // Soft glow circle
                        const r = 10;
                        this.ctx.fillStyle = 'rgba(120,255,235,0.22)';
                        this.ctx.beginPath(); this.ctx.arc(bx, by, r, 0, Math.PI*2); this.ctx.fill();
                        // Key label
                        this.ctx.font = 'bold 12px sans-serif';
                        this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
                        this.ctx.fillStyle = '#7DFFEA';
                        this.ctx.strokeStyle = 'rgba(10,20,24,0.9)'; this.ctx.lineWidth = 3;
                        this.ctx.strokeText('F', bx, by);
                        this.ctx.fillText('F', bx, by);
                        this.ctx.restore();
                    }
                  } catch { /* ignore F hint errors */ }
                }
              } catch { /* ignore */ }
              this.ctx.restore();
            }
            this.ctx.restore();
          }
        } catch { /* ignore */ }
      }
    }
  } else {
    this.roomManager.debugDraw(this.ctx, this.camX, this.camY, 0.18);
  }
        // Now apply camera transform and draw entities
        this.ctx.save();
        this.ctx.translate(-this.camX + shakeOffsetX, -this.camY + shakeOffsetY);
  // Draw Last Stand core marker (if present)
  try {
    if (this.gameMode === 'LAST_STAND') {
      const core: any = (window as any).__lsCore;
      if (core && core.x != null && core.y != null && core.radius != null) {
  // Soft glow + solid core + outline ring (reduce layers when lowFX)
        this.ctx.save();
        const r = core.radius as number;
        // Advance spin using wall clock (render lacks delta argument)
        try {
          const w:any = window as any;
          const now = performance.now();
          const last = w.__lsCoreSpinTs || now; const dt = Math.min(50, Math.max(0, now - last));
          w.__lsCoreSpinTs = now;
          const cfg:any = w.__lsCoreCfg;
          const spinSpeed = Math.max(0.001, Math.min(0.05, Number(cfg?.core?.spinSpeed ?? 0.0025)));
          core.spin = (core.spin || 0) + dt * spinSpeed; // configurable rad/ms
        } catch {}
  // Glow — darker teal spectrum
  if (!this.lowFX) {
    const grad = this.ctx.createRadialGradient(core.x, core.y, r*0.28, core.x, core.y, r*1.7);
    grad.addColorStop(0, 'rgba(26,255,233,0.24)');
    grad.addColorStop(0.55, 'rgba(20,160,150,0.14)');
    grad.addColorStop(1, 'rgba(10,20,24,0.00)');
    const oldComp: GlobalCompositeOperation = this.ctx.globalCompositeOperation as GlobalCompositeOperation;
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.fillStyle = grad; this.ctx.beginPath(); this.ctx.arc(core.x, core.y, r*1.7, 0, Math.PI*2); this.ctx.fill();
    this.ctx.globalCompositeOperation = oldComp;
  }
        // Vector orb core (color-cycling). Removes PNG sprite dependency for performance & style.
        try {
          const w:any = window as any;
          // Config fetch (retain spinSpeed, optional fx toggles)
          if (!w.__lsCoreCfgLoading && !w.__lsCoreCfg) {
            w.__lsCoreCfgLoading = true;
            (async () => { try { w.__lsCoreCfg = await loadJSON(lastStandData.config()); } catch { w.__lsCoreCfg = {}; } })();
          }
          const t = (performance.now() || 0) * 0.001; // seconds
          // HSV-like cycling: compute a hue and map to RGB manually (avoid canvas state churn)
          const hue = (t * 18) % 360; // slow rotate
          const sat = 0.72, val = 1.0;
          const h = (hue/60)|0; const f = (hue/60 - h);
          const p = val * (1 - sat), q = val * (1 - sat * f), s = val * (1 - sat * (1 - f));
          let rC=0,gC=0,bC=0; switch (h) { case 0: rC=val;gC=s; bC=p; break; case 1: rC=q; gC=val; bC=p; break; case 2: rC=p; gC=val; bC=s; break; case 3: rC=p; gC=q; bC=val; break; case 4: rC=s; gC=p; bC=val; break; default: rC=val; gC=p; bC=q; }
          const inner = `rgba(${Math.round(rC*255)},${Math.round(gC*255)},${Math.round(bC*255)},1)`;
          const rim = 'rgba(255,255,255,0.85)';
          // Orb body: inner bright gradient
          const g = this.ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, r*0.9);
          g.addColorStop(0.0, inner);
          g.addColorStop(0.6, inner);
          g.addColorStop(1.0, 'rgba(255,255,255,0)');
          this.ctx.fillStyle = g;
          this.ctx.beginPath(); this.ctx.arc(core.x, core.y, r*0.9, 0, Math.PI*2); this.ctx.fill();
          // Gloss highlight arc (uses spin)
          const glossR = r*0.92;
          this.ctx.save();
          this.ctx.translate(core.x, core.y);
          this.ctx.rotate((core.spin||0) * 0.35);
          this.ctx.strokeStyle = 'rgba(255,255,255,0.45)'; this.ctx.lineWidth = 3;
          this.ctx.beginPath(); this.ctx.arc(0, 0, glossR, -0.9, -0.2); this.ctx.stroke();
          this.ctx.restore();
          // Outer ring
          this.ctx.lineWidth = 4; this.ctx.strokeStyle = rim;
          this.ctx.beginPath(); this.ctx.arc(core.x, core.y, r, 0, Math.PI*2); this.ctx.stroke();
        } catch { /* ignore orb errors */ }
        // Optional FX
        try {
          const cfg:any = (window as any).__lsCoreCfg;
          const fx = cfg?.core?.fx || { ring:true, pulses:true, sparks:true };
          if (fx.ring) {
            this.ctx.lineWidth = 4; this.ctx.strokeStyle = 'rgba(38,255,233,0.85)';
            this.ctx.beginPath(); this.ctx.arc(core.x, core.y, r, 0, Math.PI*2); this.ctx.stroke();
          }
          if (fx.pulses && !this.lowFX) {
            this.ctx.save();
            this.ctx.translate(core.x, core.y);
            this.ctx.rotate(core.spin || 0);
            this.ctx.strokeStyle = 'rgba(38,255,233,0.65)';
            this.ctx.lineWidth = 3;
            for (let i=0;i<4;i++){
              const a0 = i * (Math.PI * 2 / 4) + 0.10;
              const a1 = a0 + 0.42;
              this.ctx.beginPath(); this.ctx.arc(0, 0, r*1.12, a0, a1); this.ctx.stroke();
            }
            this.ctx.restore();
          }
          if (fx.sparks && !this.lowFX) {
            this.ctx.save();
            this.ctx.translate(core.x, core.y);
            this.ctx.rotate(-(core.spin||0) * 0.6);
            this.ctx.strokeStyle = 'rgba(38,255,233,0.5)';
            this.ctx.lineWidth = 2;
            for (let i=0;i<6;i++){
              const a = (core.spin||0) * (1+i*0.13) + i * (Math.PI*2/6);
              const r0 = r*0.8, r1 = r*1.35;
              const oldComp2: GlobalCompositeOperation = this.ctx.globalCompositeOperation as GlobalCompositeOperation;
              if (!this.lowFX) this.ctx.globalCompositeOperation = 'lighter';
              this.ctx.beginPath(); this.ctx.moveTo(Math.cos(a)*r0, Math.sin(a)*r0); this.ctx.lineTo(Math.cos(a)*r1, Math.sin(a)*r1); this.ctx.stroke();
              this.ctx.globalCompositeOperation = oldComp2;
            }
            this.ctx.restore();
          }
        } catch { /* ignore FX config */ }
        this.ctx.restore();
      }
    }
  } catch { /* ignore core draw errors */ }
  // Enemies: optional GL instanced renderer for enemy bodies (overlays/HP bars still drawn in 2D path)
  try {
    const glER: any = (window as any).__glEnemiesRenderer;
  if (glER && typeof glER.render === 'function') {
      const dpr2 = (window as any).devicePixelRatio || 1;
      const pixelW2 = Math.round(this.designWidth * dpr2 * this.renderScale);
      const pixelH2 = Math.round(this.designHeight * dpr2 * this.renderScale);
    const enemiesArr: any[] = this.enemyManager.getEnemies ? this.enemyManager.getEnemies() : (this.enemyManager as any).enemies;
    // Pass manager and playerX so GL can select atlas UVs and facing consistently with 2D path
    glER.render(enemiesArr, this.enemyManager, this.player?.x ?? 0, this.camX, this.camY, this.designWidth, this.designHeight, pixelW2, pixelH2, { tint: [1.0, 1.0, 1.0, 1.0] });
      // Read GL readiness flags published by the renderer
      const glReady = !!((window as any).__glEnemiesIsReady);
      const glAtlasReady = !!((window as any).__glEnemiesAtlasReady);
      const glCount = (window as any).__glEnemiesLastCount ?? 0;
      // Composite GL canvas whenever it rendered any instances (texture or atlas path)
      if (glReady && glCount > 0) {
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.drawImage(glER.canvas, 0, 0);
        this.ctx.restore();
      }
      // Only skip 2D body draw when the atlas is ready (parity with sprite visuals) AND GL drew instances
      (this.enemyManager as any).__skipBody2DOnce = !!(glAtlasReady && glCount > 0);
      // Now draw overlays/HP bars via EnemyManager (body draw gated inside when GL ready)
      this.enemyManager.draw(this.ctx, this.camX, this.camY);
    } else {
      this.enemyManager.draw(this.ctx, this.camX, this.camY);
    }
  } catch { this.enemyManager.draw(this.ctx, this.camX, this.camY); }
    // Bullets layer: use GL renderer when enabled, else 2D draw
    try {
        const glr: any = (window as any).__glBulletRenderer;
        if (glr && glr.canvas) {
            // Drive GL renderer with current bullets and camera
            const bullets: any[] = (this.bulletManager as any).bullets || [];
            const dpr = (window as any).devicePixelRatio || 1;
            const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
            const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
            if (typeof glr.render === 'function') {
              glr.render(bullets, this.camX, this.camY, this.designWidth, this.designHeight, pixelW, pixelH);
            }
            // Composite GL canvas into 2D context at current transform (already translated by camera)
            this.ctx.save();
            // Reset transform to screen space to blit the offscreen framebuffer
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            // Draw pixel-exact; the offscreen canvas matches the 2D backing store size
            this.ctx.drawImage(glr.canvas, 0, 0);
            // Restore world transform
            this.ctx.restore();
          } else {
            this.bulletManager.draw(this.ctx);
          }
  } catch { this.bulletManager.draw(this.ctx); }
  // Active beams (railgun/sniper) under player for proper layering
        const glBR: any = (window as any).__glBeamsRenderer;
        let skipped2DBeams = false;
        if (this._activeBeams && this._activeBeams.length) {
          if (glBR && typeof glBR.render === 'function') {
            // Build GL instances from current beams
            const dprB = (window as any).devicePixelRatio || 1;
            const pixelWB = Math.round(this.designWidth * dprB * this.renderScale);
            const pixelHB = Math.round(this.designHeight * dprB * this.renderScale);
            const beamsGL: any[] = [];
            for (const beam of this._activeBeams) {
              const elapsed = performance.now() - beam.start;
              const t = elapsed / beam.duration;
              if (t >= 1) continue;
              const fade = 1 - t;
              const len = beam.range;
              // Map beam type/variant
              let type = 0; // 0 sniper, 1 melter
              let variant = 0; // sniper variants: 0 default, 1 void, 2 black_sun, 3 exec
              if (beam.type === 'melter') type = 1; else type = 0;
              if (type === 0) {
                if (beam.type === 'voidsniper') variant = 1; else if (beam.type === 'sniper_black_sun') variant = 2; else if (beam.type === 'sniper_exec') variant = 3; else variant = 0;
                beamsGL.push({ x: beam.x, y: beam.y, angle: beam.angle, length: len, thickness: (beam.thickness || 10), type, variant, fade, additive: !this.lowFX && !(window as any).__noAddBlend, a: 1 });
              } else {
                const visLen = Math.min(len, (beam as any).visLen || len);
                const lava = !!(beam as any).lavaHint;
                const hue = (beam as any).hue ?? Math.floor(((elapsed / Math.max(1, beam.duration)) * 360) % 360);
                const heatT = Math.max(0, Math.min(1, (beam as any).heatT || 0));
                const coreFrac = 0.55;
                beamsGL.push({ x: beam.x, y: beam.y, angle: beam.angle, length: len, thickness: Math.max(6, (beam.thickness || 12) * 1.6), type, variant: lava ? 1 : 0, hue, heatT, visLen, coreFrac, fade, additive: !this.lowFX && !(window as any).__noAddBlend, a: 1 });
              }
            }
            if (beamsGL.length) {
              glBR.render(beamsGL, this.camX, this.camY, this.designWidth, this.designHeight, pixelWB, pixelHB, performance.now() * 0.001);
              // Composite GL beams canvas overlay in screen space
              this.ctx.save();
              this.ctx.setTransform(1, 0, 0, 1, 0, 0);
              this.ctx.drawImage(glBR.canvas, 0, 0);
              this.ctx.restore();
              skipped2DBeams = true;
            }
          }
          if (!skipped2DBeams) for (const beam of this._activeBeams) {
            const elapsed = performance.now() - beam.start;
            const t = elapsed / beam.duration;
            if (t >= 1) continue;
            const fade = 1 - t;
            this.ctx.save();
            this.ctx.translate(beam.x, beam.y);
            this.ctx.rotate(beam.angle);
            const len = beam.range;
            if (beam.type === 'sniper' || beam.type === 'sniper_exec' || beam.type === 'voidsniper' || beam.type === 'sniper_black_sun') {
              // Sniper: ultra-tight bright white core with faint cyan rim
              const fadeEase = fade * fade; // smoother tail
              // Keep base thickness stable for special beams; pulsate only non-wedge beams
              const thickness = (beam.thickness || 10) * (0.9 + 0.1 * Math.sin(elapsed * 0.24)) * (0.85 + 0.15 * fadeEase);
              if (!this.lowFX && !debugNoAdd) {
                const grad = this.ctx.createLinearGradient(0, 0, len, 0);
                if (beam.type === 'voidsniper') {
                  grad.addColorStop(0, `rgba(186,126,255,${0.95 * fadeEase})`);
                  grad.addColorStop(0.08, `rgba(106,13,173,${0.75 * fadeEase})`);
                  grad.addColorStop(0.4, `rgba(106,13,173,${0.22 * fadeEase})`);
                  grad.addColorStop(1, 'rgba(0,0,0,0)');
                  this.ctx.fillStyle = grad;
                  this.ctx.shadowColor = `rgba(178,102,255,${0.9 * fadeEase})`;
                  this.ctx.shadowBlur = 22 * (0.6 + 0.4 * fadeEase);
                } else if (beam.type === 'sniper_black_sun') {
                  // Black Sun multi-beam: deeper indigo palette
                  grad.addColorStop(0, `rgba(158,112,255,${0.95 * fadeEase})`);
                  grad.addColorStop(0.08, `rgba(75,0,130,${0.75 * fadeEase})`);
                  grad.addColorStop(0.4, `rgba(75,0,130,${0.22 * fadeEase})`);
                  grad.addColorStop(1, 'rgba(0,0,0,0)');
                  this.ctx.fillStyle = grad;
                  this.ctx.shadowColor = `rgba(155,120,255,${0.9 * fadeEase})`;
                  this.ctx.shadowBlur = 22 * (0.6 + 0.4 * fadeEase);
                } else if (beam.type === 'sniper_exec') {
                  // Golden spectral execution beam
                  grad.addColorStop(0, `rgba(255,244,200,${0.95 * fadeEase})`);
                  grad.addColorStop(0.08, `rgba(255,230,160,${0.65 * fadeEase})`);
                  grad.addColorStop(0.25, `rgba(255,210,120,${0.28 * fadeEase})`);
                  grad.addColorStop(1, 'rgba(0,0,0,0)');
                  this.ctx.fillStyle = grad;
                  this.ctx.shadowColor = `rgba(255,234,170,${0.85 * fadeEase})`;
                  this.ctx.shadowBlur = 18 * (0.6 + 0.4 * fadeEase);
                } else {
                  grad.addColorStop(0, `rgba(255,255,255,${0.95 * fadeEase})`);
                  grad.addColorStop(0.05, `rgba(200,240,255,${0.65 * fadeEase})`);
                  grad.addColorStop(0.25, `rgba(150,220,255,${0.28 * fadeEase})`);
                  grad.addColorStop(1, 'rgba(0,0,0,0)');
                  this.ctx.fillStyle = grad;
                  this.ctx.shadowColor = `rgba(224,247,255,${0.85 * fadeEase})`;
                  this.ctx.shadowBlur = 18 * (0.6 + 0.4 * fadeEase);
                }
                if (!debugNoAdd) this.ctx.globalCompositeOperation = 'lighter';
              } else {
                if (beam.type === 'voidsniper') {
                  this.ctx.fillStyle = `rgba(186,126,255,${0.55*fadeEase})`;
                } else if (beam.type === 'sniper_black_sun') {
                  this.ctx.fillStyle = `rgba(155,120,255,${0.55*fadeEase})`;
                } else if (beam.type === 'sniper_exec') {
                  this.ctx.fillStyle = `rgba(255,234,170,${0.55*fadeEase})`;
                } else {
                  this.ctx.fillStyle = `rgba(240,250,255,${0.55*fadeEase})`;
                }
                this.ctx.globalCompositeOperation = 'source-over';
              }
              // (Gate drawing moved to world props section above so it renders every frame)
              this.ctx.beginPath();
              this.ctx.rect(0, -thickness/2, len, thickness);
              this.ctx.fill();
              if (beam.type === 'voidsniper') {
                this.ctx.strokeStyle = this.lowFX ? `rgba(178,102,255,${0.3 * fadeEase})` : `rgba(178,102,255,${0.7 * fadeEase})`;
              } else if (beam.type === 'sniper_black_sun') {
                this.ctx.strokeStyle = this.lowFX ? `rgba(155,120,255,${0.3 * fadeEase})` : `rgba(155,120,255,${0.7 * fadeEase})`;
              } else if (beam.type === 'sniper_exec') {
                this.ctx.strokeStyle = this.lowFX ? `rgba(255,220,120,${0.3 * fadeEase})` : `rgba(255,220,120,${0.7 * fadeEase})`;
              } else {
                this.ctx.strokeStyle = this.lowFX ? `rgba(255,255,255,${0.3 * fadeEase})` : `rgba(255,255,255,${0.7 * fadeEase})`;
              }
            } else if (beam.type === 'melter') {
              // Melter beam: tight core, RGB hue-cycling rim while intensifying; draws only up to visLen (subtle glow)
              const visLen = Math.min(len, beam.visLen || len);
              const fadeEase = fade * fade;
              const coreT = Math.max(6, (beam.thickness || 12) * 0.55);
              const rimT = coreT * 1.6;
              // Compute intensity-ramp t based on beam duration for color cycle (0..1)
              const elapsedBeam = Math.max(0, Math.min(beam.duration, (performance.now() - beam.start)));
              const tRamp = beam.duration > 0 ? (elapsedBeam / beam.duration) : 0;
              // Support a lava palette override for Lava Minigun beams
              const lava = !!beam.lavaHint;
              const heatT = lava ? Math.max(0, Math.min(1, (beam as any).heatT || 0)) : 0;
              // Hue cycles 0->360 once over the ramp; keep a tiny offset to start near red
              const hue = lava ? 20 : Math.floor((tRamp * 360) % 360);
              if (!this.lowFX && !debugNoAdd) {
                this.ctx.globalCompositeOperation = 'lighter';
                // Core (white‑hot or lava‑tinted)
                if (lava) {
                  // Interpolate core from warm amber to near white‑hot based on heatT
                  const coreR = 255;
                  const coreG = Math.round(140 + (190 - 140) * (1 - heatT * 0.6));
                  const coreB = Math.round(60 + (120 - 60) * (1 - heatT * 0.6));
                  const coreA = (0.70 + 0.20 * heatT) * fadeEase;
                  this.ctx.fillStyle = `rgba(${coreR},${coreG},${coreB},${coreA.toFixed(3)})`;
                } else {
                  this.ctx.fillStyle = `rgba(255,255,255,${(0.72 * fadeEase).toFixed(3)})`;
                }
                this.ctx.fillRect(0, -coreT/2, visLen, coreT);
                // Rim (RGB gradient along beam length)
                const grad = this.ctx.createLinearGradient(0, 0, visLen, 0);
                // Use HSL for smooth spectrum; convert via CSS hsl(); lava sticks to hot reds/oranges
                const rimA1 = (0.42 * fadeEase).toFixed(3);
                const rimA2 = (0.28 * fadeEase).toFixed(3);
                if (lava) {
                  // Blend stops toward deeper reds as heat rises
                  const a1 = parseFloat(rimA1) * (0.9 + 0.2 * heatT);
                  const a2 = parseFloat(rimA2) * (0.9 + 0.2 * heatT);
                  const o1 = `rgba(${255},${Math.round(120 + 20*(1-heatT))},0,${a1.toFixed(3)})`; // orange -> deep orange
                  const r1 = `rgba(255,${Math.round(60 - 30*heatT)},${Math.round(0 + 10*(1-heatT))},${a1.toFixed(3)})`; // red hot
                  const r2 = `rgba(255,${Math.round(40 - 25*heatT)},${Math.round(20 - 15*heatT)},${a2.toFixed(3)})`; // deeper red
                  const g1 = `rgba(${Math.round(255 - 20*heatT)},${Math.round(180 - 60*heatT)},0,${a2.toFixed(3)})`; // gold -> amber
                  grad.addColorStop(0.00, o1);
                  grad.addColorStop(0.25, r1);
                  grad.addColorStop(0.50, r2);
                  grad.addColorStop(0.75, g1);
                } else {
                  grad.addColorStop(0.00, `hsla(${hue}, 100%, 70%, ${rimA1})`);
                  grad.addColorStop(0.25, `hsla(${(hue+60)%360}, 100%, 65%, ${rimA2})`);
                  grad.addColorStop(0.50, `hsla(${(hue+120)%360}, 100%, 60%, ${rimA2})`);
                  grad.addColorStop(0.75, `hsla(${(hue+180)%360}, 100%, 55%, ${rimA2})`);
                }
                grad.addColorStop(1.00, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = grad;
                this.ctx.fillRect(0, -rimT/2, visLen, rimT);
                // Outer heat haze (very subtle, extended band)
                if (lava) {
                  const hazeA = (0.06 + 0.10 * heatT) * fadeEase;
                  this.ctx.fillStyle = `rgba(255,40,20,${hazeA.toFixed(3)})`;
                  this.ctx.fillRect(0, -rimT * 0.95, visLen, rimT * 1.9);
                }
                // Impact bloom tinted by current hue
                const impact = this.ctx.createRadialGradient(visLen, 0, 0, visLen, 0, 18);
                if (lava) {
                  const a0 = (0.50 + 0.25 * heatT) * fadeEase;
                  const a1i = (0.28 + 0.22 * heatT) * fadeEase;
                  impact.addColorStop(0, `rgba(255,150,0,${a0.toFixed(3)})`);
                  impact.addColorStop(0.5, `rgba(255,50,0,${a1i.toFixed(3)})`);
                } else {
                  impact.addColorStop(0, `hsla(${hue}, 100%, 80%, ${0.62 * fadeEase})`);
                  impact.addColorStop(0.5, `hsla(${(hue+40)%360}, 100%, 65%, ${0.35 * fadeEase})`);
                }
                impact.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = impact;
                this.ctx.beginPath();
                this.ctx.arc(visLen, 0, 18, 0, Math.PI * 2);
                this.ctx.fill();
              } else {
                this.ctx.globalCompositeOperation = 'source-over';
                // Low FX: single color band based on hue
                if (lava) {
                  const a = (0.35 + 0.18 * heatT) * fadeEase;
                  this.ctx.fillStyle = `rgba(255,80,40,${a.toFixed(3)})`;
                } else {
                  this.ctx.fillStyle = `hsla(${hue}, 100%, 70%, ${0.45 * fadeEase})`;
                }
                this.ctx.fillRect(0, -rimT/2, visLen, rimT);
              }
              // Subtle outline that follows the hue at low opacity
              if (lava) {
                const a = (this.lowFX ? (0.16 + 0.10 * heatT) : (0.30 + 0.18 * heatT)) * fadeEase;
                this.ctx.strokeStyle = `rgba(255,60,0,${a.toFixed(3)})`;
              } else {
                this.ctx.strokeStyle = this.lowFX ? `hsla(${hue}, 100%, 80%, ${0.22 * fadeEase})` : `hsla(${hue}, 100%, 90%, ${0.44 * fadeEase})`;
              }
            } else {
              // Railgun: tuned to avoid brightening the background (no global additive blending)
              const fadeEase = fade * (0.7 + 0.3 * Math.min(1, fade));
              // Rail layout
              const railGap = 7;            // half-distance from center to each rail
              const railThickness = 4;      // each rail thickness
              const rungHeight = 10;        // crossbar height spanning both rails (ladder look)
              const rungSpacing = 46;       // distance between rungs
              const rungSpeed = 220;        // px/sec travel speed to the right
              const offset = (elapsed * (rungSpeed / 1000)) % rungSpacing;

              // Keep compositing neutral to avoid washing out the environment
              this.ctx.globalCompositeOperation = 'source-over';
              // Very soft local glow only
              if (!this.lowFX && !debugNoAdd) {
                this.ctx.shadowColor = 'rgba(0,255,220,0.28)';
                this.ctx.shadowBlur = 8 * (0.6 + 0.4 * fadeEase);
              } else {
                this.ctx.shadowBlur = 0;
              }

              // Draw two rails with a restrained gradient and capped alpha
              const railGrad = this.ctx.createLinearGradient(0, 0, len, 0);
              railGrad.addColorStop(0, `rgba(180,255,255,${0.38 * fadeEase})`);
              railGrad.addColorStop(0.25, `rgba(0,220,255,${0.28 * fadeEase})`);
              railGrad.addColorStop(0.75, `rgba(0,150,255,${0.16 * fadeEase})`);
              railGrad.addColorStop(1, 'rgba(0,0,0,0)');
              this.ctx.fillStyle = railGrad;

              // Upper and lower rails
              this.ctx.fillRect(0, -railGap - railThickness/2, len, railThickness);
              this.ctx.fillRect(0,  railGap - railThickness/2, len, railThickness);

              // Animated crossbar rungs bridging rails (reduced alpha)
              const rungWidth = 12; // visual thickness along x
              const maxRungs = Math.ceil((len + rungSpacing) / rungSpacing);
              const alphaBase = this.lowFX ? 0.18 : 0.32;
              for (let i = 0; i < maxRungs; i++) {
                const rx = i * rungSpacing + (rungSpacing - offset);
                if (rx < 0 || rx > len) continue;
                const a = Math.max(0, Math.min(1, 1 - Math.abs(rx/len)));
                this.ctx.fillStyle = `rgba(255,255,255,${(alphaBase * a * fadeEase).toFixed(3)})`;
                this.ctx.fillRect(rx - rungWidth/2, -rungHeight/2, rungWidth, rungHeight);
              }

              // Capacitor muzzle flash at origin with screened micro-bloom only at the source
              if (!this.lowFX && !debugNoAdd) {
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'screen';
                const muzzle = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
                muzzle.addColorStop(0, `rgba(255,255,255,${0.32 * fadeEase})`);
                muzzle.addColorStop(0.5, `rgba(0,255,230,${0.22 * fadeEase})`);
                muzzle.addColorStop(1, 'rgba(0,0,0,0)');
                this.ctx.fillStyle = muzzle;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 18, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.restore();
              }

              // Subtle central filament
              const filamentAlpha = 0.18 * (this.lowFX ? 0.6 : 1) * fadeEase;
              this.ctx.fillStyle = `rgba(180,255,255,${filamentAlpha.toFixed(3)})`;
              this.ctx.fillRect(0, -1, len, 2);
              // Outline hint
              this.ctx.strokeStyle = this.lowFX ? `rgba(200,240,255,${(0.18 * fadeEase).toFixed(3)})` : `rgba(200,255,255,${(0.36 * fadeEase).toFixed(3)})`;
            }
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(0,0);
            this.ctx.lineTo(len,0);
            this.ctx.stroke();
            this.ctx.restore();
          }
        }
  // Tech Warrior anchor visual (world space)
  // RMB controllers removed
  // Heavy Gunner micro turret visual (world space)
  // RMB controllers removed
        // Early GL aura underlay: render player's Slow Aura via GL glows before drawing the player sprite
        try {
          const glGR: any = (window as any).__glGlowsRenderer;
          if (glGR && typeof glGR.render === 'function' && this.explosionManager && typeof (this.explosionManager as any).getPlayerAuraGlowSnapshot === 'function') {
            const snap = (this.explosionManager as any).getPlayerAuraGlowSnapshot() as Array<{ x:number; y:number; radius:number; r:number; g:number; b:number; a:number }>;
            if (snap && snap.length) {
              const dpr = (window as any).devicePixelRatio || 1;
              const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
              const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
              glGR.render(snap, this.camX, this.camY, this.designWidth, this.designHeight, pixelW, pixelH);
              // Composite GL aura into screen beneath player
              this.ctx.save();
              this.ctx.setTransform(1, 0, 0, 1, 0, 0);
              this.ctx.drawImage(glGR.canvas, 0, 0);
              this.ctx.restore();
              // 2D aura path removed; no skip flag necessary
            }
          }
        } catch { /* ignore GL aura errors */ }

        this.player.draw(this.ctx);
        // Particles: prefer GL renderer, fallback to 2D draw
        try {
          const glP: any = (window as any).__glParticlesRenderer;
          if (glP && typeof glP.render === 'function') {
            const dpr = (window as any).devicePixelRatio || 1;
            const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
            const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
            const particles: any[] = (this.particleManager as any).getSnapshot?.() || [];
            glP.render(particles, this.camX, this.camY, this.designWidth, this.designHeight, pixelW, pixelH);
            // Composite GL particles texture into screen (between player and zones)
            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.drawImage(glP.canvas, 0, 0);
            this.ctx.restore();
          } else {
            this.particleManager.draw(this.ctx);
          }
        } catch { this.particleManager.draw(this.ctx); }
        // GL zones: render filled AoE zones (normal blend) via WebGL before glows and rings
        try {
          const glZR: any = (window as any).__glZonesRenderer;
          if (glZR && typeof glZR.render === 'function' && this.explosionManager && typeof (this.explosionManager as any).getActiveAoEZonesSnapshot === 'function') {
            const snap = (this.explosionManager as any).getActiveAoEZonesSnapshot() as Array<{ x:number; y:number; radius:number; r:number; g:number; b:number; a:number }>;
            if (snap && snap.length) {
              const dpr = (window as any).devicePixelRatio || 1;
              const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
              const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
              glZR.render(snap, this.camX, this.camY, this.designWidth, this.designHeight, pixelW, pixelH);
              // Composite GL zones texture into screen
              this.ctx.save();
              this.ctx.setTransform(1, 0, 0, 1, 0, 0);
              this.ctx.drawImage(glZR.canvas, 0, 0);
              this.ctx.restore();
            }
          }
        } catch { /* ignore GL zones errors */ }
        // GL glows: render charge glows (additive) via WebGL before rings and 2D explosion draw
        try {
          const glGR: any = (window as any).__glGlowsRenderer;
          if (glGR && typeof glGR.render === 'function' && this.explosionManager && typeof (this.explosionManager as any).getActiveChargeGlowsSnapshot === 'function') {
            const snap = (this.explosionManager as any).getActiveChargeGlowsSnapshot() as Array<{ x:number; y:number; radius:number; r:number; g:number; b:number; a:number }>;
            if (snap && snap.length) {
              const dpr = (window as any).devicePixelRatio || 1;
              const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
              const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
              glGR.render(snap, this.camX, this.camY, this.designWidth, this.designHeight, pixelW, pixelH);
              // Composite GL glows texture into screen
              this.ctx.save();
              this.ctx.setTransform(1, 0, 0, 1, 0, 0);
              this.ctx.drawImage(glGR.canvas, 0, 0);
              this.ctx.restore();
            }
          }
        } catch { /* ignore GL glows errors */ }
        // GL rings: render shockwave rings via WebGL and composite before 2D explosion draw
        try {
          const glRR: any = (window as any).__glRingsRenderer;
          if (glRR && typeof glRR.render === 'function' && this.explosionManager && typeof (this.explosionManager as any).getActiveShockwaveSnapshot === 'function') {
            const snap = (this.explosionManager as any).getActiveShockwaveSnapshot() as Array<{ x:number; y:number; innerR:number; outerR:number; color:string; alpha:number; additive:boolean }>;
            if (snap && snap.length) {
              // Convert to GLRingInstance array
              const rings: any[] = new Array(snap.length);
              // Helper parse color (reuse BulletManager.parseColor if available)
              const parse = (col: string): { r:number; g:number; b:number; a:number } => {
                try { return (require('../game/BulletManager') as any).BulletManager.parseColor(col) || { r:255,g:255,b:255,a:1 }; } catch { /* ignore require in bundlers */ }
                // Fallback simple hex/rgb parser
                const mHex = /^#([0-9a-f]{6})$/i.exec(col);
                if (mHex) { const n = parseInt(mHex[1],16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255, a:1 }; }
                const mR = /^rgba?\(([^)]+)\)$/i.exec(col);
                if (mR) { const p = mR[1].split(',').map(s=>s.trim()); return { r:parseInt(p[0],10)||255, g:parseInt(p[1],10)||255, b:parseInt(p[2],10)||255, a:(p[3]?parseFloat(p[3]):1) }; }
                return { r:255,g:255,b:255,a:1 };
              };
              for (let i = 0; i < snap.length; i++) {
                const s = snap[i];
                const c = parse(s.color);
                const a = Math.max(0, Math.min(1, c.a * s.alpha));
                rings[i] = { x: s.x, y: s.y, innerR: s.innerR, outerR: s.outerR, r: c.r/255, g: c.g/255, b: c.b/255, a, additive: s.additive };
              }
              const dpr = (window as any).devicePixelRatio || 1;
              const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
              const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
              glRR.render(rings, this.camX, this.camY, this.designWidth, this.designHeight, pixelW, pixelH);
              // Composite GL rings texture into screen
              this.ctx.save();
              this.ctx.setTransform(1, 0, 0, 1, 0, 0);
              this.ctx.drawImage(glRR.canvas, 0, 0);
              this.ctx.restore();
            }
          }
        } catch { /* ignore GL rings errors */ }
        // 2D explosion visuals removed; GL path covers rings/glows/zones
    this.bossManager.draw(this.ctx);
  this.ctx.restore();
  // (Removed post-entity drawWalkableMask; underlay already applied beneath entities)
  this.damageTextManager.draw(this.ctx, this.camX, this.camY, this.renderScale);
  // Draw Umbral Surge overlay after all world-space elements and damage text, but before HUD
  const overlay = this.surgeOverlay;
  if (overlay && overlay.isActive()) {
  // Prefer 'screen' blending with an even lower base alpha to keep visibility clear.
  overlay.draw(this.ctx, this.designWidth, this.designHeight, 'screen', 0.6);
  }
  // Fog of War screen-space mask after world rendering, before HUD
  if (this.fowEnabled && this.fog) {
    const cam = { x: this.camX, y: this.camY, width: this.designWidth, height: this.designHeight };
    // Compute a smooth pixel radius tied to tile radius (slightly larger to reduce grid feel)
  const radiusPx = Math.floor(this.getEffectiveFowRadiusTiles() * this.fowTileSize * 0.95);
    // In Last Stand, bind core as the vision anchor; optional flashlight adds a wedge in front of player
    let visX = this.player.x, visY = this.player.y;
    try {
      if (this.gameMode === 'LAST_STAND') {
        const core: any = (window as any).__lsCore;
        if (core && core.x != null && core.y != null) { visX = core.x; visY = core.y; }
      }
    } catch { /* ignore */ }
    // Prefer GL fog if available, else fall back to 2D mask render
    try {
      const glFR: any = (window as any).__glFogRenderer;
      if (glFR && glFR.render) {
        const dpr = (window.devicePixelRatio || 1);
        const pixelW = Math.round(this.designWidth * dpr * this.renderScale);
        const pixelH = Math.round(this.designHeight * dpr * this.renderScale);
        // Flashlight wedge determination
        let wedge: any = undefined;
        try {
          const ls: any = (this as any).lastStand;
          const hasFlashlight = !!(ls && ls.getFlashlight && ls.getFlashlight());
          if (hasFlashlight) {
            const dirX = (this.player as any).lastDirX || 1;
            const dirY = (this.player as any).lastDirY || 0;
            const wedgeR = Math.max(200, Math.floor(this.fowTileSize * 3.6));
            const wedgeHalf = Math.PI / 9;
            wedge = { enabled: true, dirX, dirY, halfAngleRad: wedgeHalf, radius: wedgeR };
          }
        } catch { /* ignore */ }
        glFR.render({
          camX: this.camX,
          camY: this.camY,
          centerX: visX,
          centerY: visY,
          designW: this.designWidth,
          designH: this.designHeight,
          pixelW,
          pixelH,
          radiusPx,
          darkRGB: [0.0196, 0.0313, 0.051], // #05080d roughly
          darkAlpha: 0.88,
          penScale: 1.18,
          penAlpha: 0.04,
          wedge,
        });
        // Composite GL fog texture into screen with neutral blending
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        const oldCompF = this.ctx.globalCompositeOperation as GlobalCompositeOperation;
        const oldAlphaF = this.ctx.globalAlpha;
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.ctx.drawImage(glFR.canvas, 0, 0);
        this.ctx.globalAlpha = oldAlphaF;
        this.ctx.globalCompositeOperation = oldCompF;
        this.ctx.restore();
      } else {
        // Use 2D fallback; reset transform to avoid compounding fractional transforms
        this.ctx.save();
        this.ctx.setTransform(1,0,0,1,0,0);
        // Ensure prior additive blends (bullets/beams) don't affect mask draw
        const oldCompF2 = this.ctx.globalCompositeOperation as GlobalCompositeOperation;
        const oldAlphaF2 = this.ctx.globalAlpha;
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.globalAlpha = 1;
        this.fog.render(this.ctx, cam, {
          enable: true,
          visibleCenterX: visX,
          visibleCenterY: visY,
          visibleRadiusPx: radiusPx,
          exploredAlpha: 0.34,
          edgeNoise: !this.lowFX && !(/[?&](fowNoise)=0/.test(location.search)), // optional override to reduce shimmer
          penumbraScale: 1.18,
          penumbraAlpha: this.lowFX ? 0.02 : 0.04,
        });
        this.ctx.globalAlpha = oldAlphaF2;
        this.ctx.globalCompositeOperation = oldCompF2;
        this.ctx.restore();
      }
    } catch {
      // Fallback to 2D on any GL error
      this.ctx.save(); this.ctx.setTransform(1,0,0,1,0,0);
      this.fog.render(this.ctx, cam, {
        enable: true,
        visibleCenterX: visX,
        visibleCenterY: visY,
        visibleRadiusPx: radiusPx,
        exploredAlpha: 0.34,
        edgeNoise: !this.lowFX && !(/[?&](fowNoise)=0/.test(location.search)),
        penumbraScale: 1.18,
        penumbraAlpha: this.lowFX ? 0.02 : 0.04,
      });
      this.ctx.restore();
    }
    // Flashlight wedge: reveal an arc ahead of player (bonus item toggles this)
    // Flashlight wedge is handled inside GL path; 2D fallback skipped for simplicity
  // Post-fog anchor overlay (ensures visibility even outside vision)
  // RMB controllers removed
  // Post-fog Heavy Gunner turret overlay (ensures visibility even outside vision)
  // RMB controllers removed
  }
  // Post-Fog ability overlays (e.g., Rogue Hacker telegraph) so they are not hidden by FOW
  try {
    const am: any = (this.player as any).abilityManager;
    if (am && typeof am.renderPostFog === 'function') {
      am.renderPostFog(this.ctx, this.player);
    }
  } catch { /* ignore */ }
  // Draw visual red skip button (holder-like) near core during Last Stand. Visible and interactive only in SHOP.
  try {
    if (this.gameMode === 'LAST_STAND') {
      const ls: any = (this as any).lastStand;
      const core: any = (window as any).__lsCore;
      const sk: any = (ls && typeof ls.getSkipRect === 'function') ? ls.getSkipRect() : null;
      if (core && core.x != null && sk) {
        const isShop = (ls && (ls as any).phase === 'SHOP');
        if (isShop) {
          this.ctx.save();
          this.ctx.translate(-this.camX, -this.camY);
          // Harden against blend-state leakage from enemy hit flashes
          const prevOp = this.ctx.globalCompositeOperation as any;
          const prevAlpha = this.ctx.globalAlpha;
          this.ctx.globalCompositeOperation = 'source-over';
          this.ctx.globalAlpha = 1;
          const bw = sk.w ?? 28, bh = sk.h ?? 28;
          const bx = sk.x;
          const by = sk.y;
          // Small square button
          this.ctx.fillStyle = '#8f1010';
          this.ctx.strokeStyle = '#ff5c5c';
          this.ctx.lineWidth = 2;
          this.ctx.beginPath(); this.roundRectPath(bx, by, bw, bh, 4); this.ctx.fill(); this.ctx.stroke();
          // Minimal inner indicator
          this.ctx.fillStyle = '#ffd6d6';
          this.ctx.font = '700 11px Orbitron, monospace';
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText('F', bx + bw/2, by + bh/2 + 0.5);
          // restore blend state
          this.ctx.globalCompositeOperation = prevOp;
          this.ctx.globalAlpha = prevAlpha;
          this.ctx.restore();
        }
      }
    }
  } catch { /* ignore */ }
  // Draw boss screen-space FX (e.g., Supernova darken) before HUD so UI stays readable on top
  this.bossManager.drawScreenFX(this.ctx, this.designWidth, this.designHeight);
  // Removed full-screen additive overlay to prevent global flash; enemy hit feedback now strictly per-entity.
        this.hud.draw(this.ctx, this.gameTime, this.enemyManager.getEnemies(), this.worldW, this.worldH, this.player.upgrades);
    // Draw cinematic alerts LAST so they remain visible even during bright spells/HUD
    this.bossManager.drawAlerts(this.ctx, this.designWidth, this.designHeight);
    // Draw revive cinematic angelic overlay LAST over HUD when active
    if (this.reviveCinematicActive) {
      this.drawReviveCinematicOverlay(this.ctx, this.designWidth, this.designHeight);
    }
  // Lightweight debug overlay (opt-in)
  this.debugOverlay.draw(this.ctx, this);

        if (this.state === 'PAUSE') {
          // Pause overlay handled via DOM; no canvas rendering
        } else if (this.state === 'GAME_OVER') {
          this.drawGameOver();
        }
        break;
      case 'CHARACTER_SELECT':
        // Character select panel now uses HTML/DOM rendering, not canvas
        if (canvasElem) canvasElem.style.zIndex = '-1';
        break;
      case 'CINEMATIC':
        // No cinematic is shown for SANDBOX (guarded in startCinematicAndGame),
        // but if reached due to an external call, draw a plain environment frame.
        if (this.gameMode === 'SANDBOX') {
          this.environment.setLowFX(this.lowFX);
          this.environment.draw(this.ctx, this.camX, this.camY, this.canvas.width, this.canvas.height);
          break;
        }
        this.cinematic.draw(this.ctx, this.canvas);
        break;
    }
  // end render
  }

  private handleDamageDealt(event: CustomEvent): void {
    const damageAmount = event.detail.amount;
    const isCritical = event.detail.isCritical || false; // Get isCritical from event detail
    this.dpsHistory.push({ time: performance.now(), damage: damageAmount });
  // Spawn damage text at source coordinates if provided (enemy/boss position), fallback to player
  const sx = event.detail.x ?? this.player.x;
  const sy = event.detail.y ?? this.player.y;
  this.damageTextManager.spawn(sx, sy, damageAmount, undefined, isCritical);
  }

  /**
   * Handles a mortar explosion event.
   * @param event CustomEvent with explosion details (x, y, damage, hitEnemy)
   */
  private handleMortarExplosion(event: CustomEvent): void {
  const { x, y, damage, hitEnemy, radius } = event.detail;
  // Scale radius by player's global area multiplier if available
  const areaMul = (this.player as any)?.getGlobalAreaMultiplier?.() ?? ((this.player as any)?.globalAreaMultiplier ?? 1);
  // Respect weapon-provided radius fully (no minimum clamp) so early levels can be smaller
  const baseR = (typeof radius === 'number' ? radius : 220);
  const finalR = baseR * (areaMul || 1);
  // Titan Mech uses dedicated high-impact mortar explosion (full damage, larger visuals)
  this.explosionManager?.triggerTitanMortarExplosion(x, y, damage, finalR);
  }
  /**
   * Handles mortar implosion pre-effect.
   */
  private handleMortarImplosion(event: CustomEvent): void {
    const { x, y, radius, color } = event.detail;
    this.explosionManager?.triggerMortarImplosion(x, y, radius ?? 120, color ?? '#FFE66D');
  }
  /**
   * Handles a kamikaze drone explosion event (separate from mortar for balance & visuals).
   */
  private handleDroneExplosion(event: CustomEvent): void {
    const { x, y, damage, radius } = event.detail;
  // Route through dedicated enhanced drone explosion (triple area, double damage, richer visuals)
  const r = radius ?? 110;
  this.explosionManager?.triggerDroneExplosion(x, y, damage, r, '#00BFFF');
  }
  /**
   * Handles an enemy death explosion event.
   * @param event CustomEvent with explosion details (x, y, damage, radius, color)
   */
  private handleEnemyDeathExplosion(event: CustomEvent): void {
    const { x, y, damage, radius, color } = event.detail;
    // Route through centralized ExplosionManager for visuals and AoE damage
    this.explosionManager?.triggerExplosion(x, y, damage, undefined, radius ?? 50, color ?? '#FF4500');
  }

  /**
   * Dynamically adjusts internal rendering resolution (renderScale) when running in Electron if frame jitter is high.
   * Uses p95 jitter (& render bucket avg placed in perf overlay) to downscale to 0.75 or 0.6, and scales back up when stable.
   */
  private adjustRenderScale() {
    if (!(window as any).process?.versions?.electron) return; // Only in Electron packaged/runtime
    if (this.state !== 'GAME' && this.state !== 'PAUSE' && this.state !== 'UPGRADE_MENU') return;
    const now = performance.now();
    if (now - this.lastScaleCheck < 900) return; // throttle checks ~1s
    this.lastScaleCheck = now;
    const avg = (window as any).__avgFrameMs || 16.6;
    const high = 18.5; // downscale threshold
    const low = 14.0;  // upscale threshold
    let newScale = this.renderScale;
    if (avg > high && newScale > this.minRenderScale) {
      newScale = Math.max(this.minRenderScale, Math.round((newScale - 0.1) * 10) / 10);
    } else if (avg < low && newScale < 1) {
      newScale = Math.min(1, Math.round((newScale + 0.1) * 10) / 10);
    }
    if (newScale !== this.renderScale) {
      this.renderScale = newScale;
      (window as any).__renderScale = this.renderScale;
      const dpr = (window as any).devicePixelRatio || 1;
      const bw = Math.round(this.designWidth * dpr * this.renderScale);
      const bh = Math.round(this.designHeight * dpr * this.renderScale);
      if (this.canvas.width !== bw || this.canvas.height !== bh) {
        this.canvas.width = bw;
        this.canvas.height = bh;
      }
      this.bgPatternNeedsRedraw = true; // adjust pattern density if scale changed
    }
  }

  // --- Revive cinematic helpers ---
  private triggerReviveDetonation() {
    if (this.reviveCinematicScheduled) return;
    this.reviveCinematicScheduled = true;
    try { window.dispatchEvent(new CustomEvent('reviveDetonate')); } catch {}
  }

  private drawReviveCinematicOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = Math.max(0, Math.min(1, (performance.now() - this.reviveCinematicStart) / this.reviveCinematicDuration));
  // Player screen position in logical space
  const centerX = Math.round(this.player.x - this.camX);
  const centerY = Math.round(this.player.y - this.camY);
    const easeIn = (x: number) => x*x;
    const easeOut = (x: number) => 1 - Math.pow(1 - x, 2);
    const fadeIn = easeOut(Math.min(1, t * 2)); // first half fade-in
    const fadeOut = easeIn(Math.max(0, Math.min(1, (t - 0.7) / 0.3))); // last 30% fade-out
    const baseAlpha = Math.max(0, Math.min(1, fadeIn * (1 - fadeOut)));
    ctx.save();
    // Dim background slightly
    ctx.globalAlpha = 0.25 * baseAlpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    // Heavenly radial glow centered on player screen position
    const px = centerX; // camera already applied to world; overlay is screen-space
    const py = centerY;
    const rMax = Math.hypot(w, h) * 0.6;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, rMax);
    grad.addColorStop(0, `rgba(255,255,255,${0.42 * baseAlpha})`);
    grad.addColorStop(0.3, `rgba(255,244,200,${0.32 * baseAlpha})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(px, py, rMax, 0, Math.PI*2); ctx.fill();
    // Light shafts (god rays)
    const rays = 7;
    const rayAlpha = 0.16 * baseAlpha * (this.lowFX ? 0.6 : 1);
    const time = (performance.now() - this.reviveCinematicStart) * 0.001;
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2 + time * 0.4;
      const len = rMax * 1.1;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      const width = Math.max(24, Math.min(90, rMax * 0.12));
      const gradRay = ctx.createLinearGradient(0, 0, len, 0);
      gradRay.addColorStop(0, `rgba(255,255,240,${rayAlpha})`);
      gradRay.addColorStop(0.5, `rgba(240,255,255,${rayAlpha * 0.6})`);
      gradRay.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradRay;
      ctx.fillRect(0, -width/2, len, width);
      ctx.restore();
    }
    // Descending glyphs (simple crosses)
    const glyphs = 18;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < glyphs; i++) {
      const gx = Math.sin((i * 127 + time * 1.7)) * (w * 0.35) + centerX;
      const gy = ((i * 83) % h) * (1 - t) + h * (t * 0.2);
      const s = 8 + (i % 3) * 4;
      ctx.globalAlpha = 0.35 * baseAlpha;
      ctx.strokeStyle = '#FFFDE6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gx - s, gy); ctx.lineTo(gx + s, gy);
      ctx.moveTo(gx, gy - s); ctx.lineTo(gx, gy + s);
      ctx.stroke();
    }
    // Soul visual: luminous orb rising from the player then hovering
    // Rise phase ~ first 45% of t, then hover with gentle sine bob
    const soulT = t;
    const risePhase = Math.min(1, soulT / 0.45);
    const bobPhase = Math.max(0, (soulT - 0.45) / 0.55);
    const riseHeight = 80; // px above player
    const hoverHeight = 110; // final hover height
    const yRise = centerY - riseHeight * easeOut(risePhase);
    const yHover = centerY - hoverHeight - Math.sin(time * 2.0) * 6 * bobPhase;
    const soulY = soulT < 0.45 ? yRise : yHover;
    const soulX = centerX;
    // Orb glow
    const orbR = 14 + 6 * Math.sin(time * 3.0) * (1 - fadeOut);
    const orbGrad = ctx.createRadialGradient(soulX, soulY, 0, soulX, soulY, Math.max(28, orbR * 3));
    const soulAlpha = 0.85 * baseAlpha;
    orbGrad.addColorStop(0, `rgba(255,255,255,${soulAlpha})`);
    orbGrad.addColorStop(0.4, `rgba(240,255,250,${soulAlpha * 0.55})`);
    orbGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 1;
    ctx.fillStyle = orbGrad;
    ctx.beginPath(); ctx.arc(soulX, soulY, Math.max(orbR, 10), 0, Math.PI * 2); ctx.fill();
    // Subtle vertical aura lines
    ctx.globalAlpha = 0.25 * baseAlpha;
    ctx.strokeStyle = '#EFFFFF';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      const off = i * 10;
      ctx.beginPath();
      ctx.moveTo(soulX + off, soulY - 26);
      ctx.lineTo(soulX + off, soulY + 26);
      ctx.stroke();
    }
    // Final flash hint near the end
    if (t > 0.9 && !this.lowFX) {
      const k = (t - 0.9) / 0.1;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.35 * k;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /**
   * Builds or reuses a cached pattern tile containing the static grid lines & sparse noise dots.
   * Dramatically reduces per-frame CPU by avoiding thousands of path ops each render at 4K.
   */
  private ensureBgPattern() {
    if (!this.bgPatternCanvas) {
      this.bgPatternCanvas = document.createElement('canvas');
      this.bgPatternCtx = this.bgPatternCanvas.getContext('2d');
    }
    if (!this.bgPatternCtx) return;
    if (!this.bgPatternNeedsRedraw && this.bgPatternValid) return;
    const ctx = this.bgPatternCtx;
    const size = this.bgPatternSize;
    this.bgPatternCanvas.width = size;
    this.bgPatternCanvas.height = size;
    ctx.clearRect(0,0,size,size);
    // Base fill transparent; we composite over gradient.
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1e254033'; // subtle alpha for grid
    const g = this.bgGridSize;
    // Draw vertical lines
    for (let x=0; x<=size; x+=g) {
      ctx.beginPath();
      ctx.moveTo(x+0.5,0);
      ctx.lineTo(x+0.5,size);
      ctx.stroke();
    }
    // Draw horizontal lines
    for (let y=0; y<=size; y+=g) {
      ctx.beginPath();
      ctx.moveTo(0,y+0.5);
      ctx.lineTo(size,y+0.5);
      ctx.stroke();
    }
  // Deterministic sparse noise based on tile-local hashed coordinates
  const noisePerTile = 80; // reduce density for calmer look
    for (let i=0;i<noisePerTile;i++) {
      // LCG pseudo-random
      const seed = (i * 48271) & 0x7fffffff;
      const rx = (seed % 1000) / 1000;
      const ry = ((seed / 1000) % 1000) / 1000;
      const px = rx * size;
      const py = ry * size;
      // Skip points too near grid intersections for clarity
      if ((px % g) < 3 || (py % g) < 3) continue;
  ctx.fillStyle = '#1f243a';
      ctx.fillRect(px, py, 2, 2);
    }
    this.bgPatternValid = true;
    this.bgPatternNeedsRedraw = false;
  }

  /**
   * Draws gradient + cached pattern, scrolling pattern by camera offset for parallax-free background.
   */
  private drawBackground() {
    // Gradient (cheap single fill)
    this.ctx.save();
    if (!this.lowFX) {
      if (!this.bgGradient) {
  const g = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
  g.addColorStop(0, '#0b0b14');
  g.addColorStop(0.5, '#121323');
  g.addColorStop(1, '#171a2d');
        this.bgGradient = g;
      }
      this.ctx.fillStyle = this.bgGradient;
    } else {
      this.ctx.fillStyle = '#0d0d18';
    }
    this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);

    // Grid + noise pattern
    this.ensureBgPattern();
    if (this.bgPatternCanvas && this.bgPatternCtx) {
      const size = this.bgPatternSize;
      // Offset so pattern scrolls with world (camera) without redrawing.
      const offX = - (this.camX % size);
      const offY = - (this.camY % size);
      // Tile draw to cover viewport; two loops (<=3x3 draws typical) instead of O(N) path ops.
      for (let x = offX; x < this.canvas.width; x += size) {
        for (let y = offY; y < this.canvas.height; y += size) {
          this.ctx.drawImage(this.bgPatternCanvas, x, y);
        }
      }
    }
    this.ctx.restore();
  }
}
