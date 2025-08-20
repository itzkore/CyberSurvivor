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
    if (state === 'GAME' && this.pendingInitialUpgrade && !this.initialUpgradeOffered) {
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
  private lowFX: boolean = false; // runtime quality downgrade for Electron stutter
  // Dynamic resolution scaling (Electron only) to reduce GPU/compositor pressure
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
  // Removed perf + frame pulse overlays; lightweight FPS sampling only
  private fpsFrameCount: number = 0;
  private fpsLastTs: number = performance.now();
  private autoPaused: boolean = false; // track alt-tab auto pause
  private initialUpgradeOffered: boolean = false; // one free upgrade flag

  // DPS Tracking
  private totalDamageDealt: number = 0;
  private dpsHistory: { time: number, damage: number }[] = []; // Stores { timestamp, damageAmount }
  private dpsWindow: number = 5000; // 5 seconds for rolling DPS calculation

  // Screen Shake
  private shakeDuration: number = 0; // How long to shake (in milliseconds)
  private shakeIntensity: number = 0; // How strong the shake is
  private currentShakeTime: number = 0; // Current time for shake effect

  private explosionManager?: ExplosionManager;
  /** Schedules or shows the opening upgrade if not already offered and player has zero upgrades. */
  private showInitialUpgradeIfNeeded(delayMs: number = 0) {
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

  constructor(canvas: HTMLCanvasElement) {
  // No external background image; procedural map will be drawn each frame (cached layer)
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  this.designWidth = canvas.width;
  this.designHeight = canvas.height;
    this.state = 'MAIN_MENU';
    this.gameTime = 0;
    this.assetLoader = new AssetLoader(); // Initialization remains here
    this.particleManager = new ParticleManager(160);
    // Initialize spatial grids first
    this.enemySpatialGrid = new SpatialGrid<any>(200); // Cell size 200
    this.bulletSpatialGrid = new SpatialGrid<any>(100); // Cell size 100

    // Initialize player and managers in correct dependency order
    this.player = new Player(this.worldW / 2, this.worldH / 2);
    this.player.radius = 18;
    this.enemyManager = new EnemyManager(this.player, this.bulletSpatialGrid, this.particleManager, this.assetLoader, 1);
    this.bulletManager = new BulletManager(this.assetLoader, this.enemySpatialGrid, this.particleManager, this.enemyManager);
  this.bossManager = new BossManager(this.player, this.particleManager, 1, this.assetLoader);
    this.cinematic = new Cinematic();
    
    if (!this.explosionManager) {
      this.explosionManager = new ExplosionManager(this.particleManager, this.enemyManager, this.player, (durationMs: number, intensity: number) => this.startScreenShake(durationMs, intensity));
    }
    this.hud = new HUD(this.player, this.assetLoader);
    // Removed direct instantiation: this.upgradePanel = new UpgradePanel(this.player, this); // Will be set via setter
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    this.player.setGameContext(this as any); // Cast to any to allow setting game context
    this.initInput();
    // Auto-enable lowFX when running inside Electron packaged app to mitigate compositor stutter
    try {
      if ((window as any).process?.versions?.electron) {
        this.lowFX = true;
        (window as any).__lowFX = true;
  (window as any).__electron = true;
      }
    } catch { /* ignore */ }
    // Removed frame pulse overlay (F9 toggle)
  this.gameLoop = new GameLoop(this.update.bind(this), this.render.bind(this));

    // Initialize camera position to center on player
    // Use logical (design) dimensions so small window (low resolution) starts centered correctly.
    this.camX = this.player.x - this.designWidth / 2;
    this.camY = this.player.y - this.designHeight / 2;

    // Ensure game starts in MAIN_MENU state, not GAME_OVER
    this.state = 'MAIN_MENU'; // Explicitly set initial state

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
    // Listen for mortarExplosion event
  window.addEventListener('mortarExplosion', (e: Event) => this.handleMortarExplosion(e as CustomEvent));
  // Kamikaze Drone custom explosion (separate event so tuning/visuals can differ)
  window.addEventListener('droneExplosion', (e: Event) => this.handleDroneExplosion(e as CustomEvent));
    // Listen for enemyDeathExplosion event
    window.addEventListener('enemyDeathExplosion', (e: Event) => this.handleEnemyDeathExplosion(e as CustomEvent));

    // Listen for level up and chest upgrade events to show UpgradePanel
    window.addEventListener('levelup', () => {
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
  window.dispatchEvent(new CustomEvent('showPauseOverlay', { detail: { auto: true } }));
      }
    });
    window.addEventListener('focus', () => {
      if (this.autoPaused && this.state === 'PAUSE') {
        (this.gameLoop as any)?.resetTiming?.();
        this.resume();
        this.autoPaused = false;
  window.dispatchEvent(new CustomEvent('hidePauseOverlay'));
      }
    });
    // Chain double upgrade when a boss is defeated
    window.addEventListener('bossDefeated', () => {
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

  /** Accessor for EnemyManager (read-only external usage). */
  public getEnemyManager(){ return this.enemyManager; }
  /** Accessor for BulletManager */
  public getBulletManager(){ return this.bulletManager; }

  /**
   * Resize logical & display dimensions (e.g. when user resizes Electron window). Supports bigger than FHD.
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
      } else if (this.state === 'GAME' && (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar')) {
        // Activate character ability if available
        try {
          (this.player as any)?.activateAbility?.();
        } catch {
          // ignore if not implemented
        }
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'b') {
        this.brightenMode = !this.brightenMode;
      } else if (e.key.toLowerCase() === 'l') { // toggle low effects mode
        this.lowFX = !this.lowFX;
        (window as any).__lowFX = this.lowFX;
  // Removed 'm' minimap toggle: minimap is now always visible
      } else if (e.key === 'F9' || e.key.toLowerCase() === 'p') {
        // Frame pulse debug overlay removed
      } else if (e.key === 'F10') { // ultra simple render mode for pacing diagnostics
        (window as any).__simpleRender = !(window as any).__simpleRender;
      } else if (e.key === 'F11') { // toggle dynamic resolution scaling off/on
        (window as any).__noDynScale = !(window as any).__noDynScale;
      }
    });
    // Fallback: if PauseOverlay fails to show within next tick after switching to PAUSE, force dispatch
    window.addEventListener('statechange', () => {
      if (this.state === 'PAUSE') {
        setTimeout(() => {
          const overlay = (window as any).__pauseOverlay;
          if (overlay && !overlay.visible) {
            window.dispatchEvent(new CustomEvent('showPauseOverlay', { detail: { auto: false } }));
          }
        }, 16);
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
      }
    });

  // Removed internal 'startGame' listener to avoid pre-CINEMATIC GAME state flash; main.ts handles start sequence.
  }

  /**
   * Resets the game state and player, optionally with selected character data.
   * @param selectedCharacterData Data for the selected character (optional)
   */
  public resetGame(selectedCharacterData?: any) {
  /**
   * Resets the game state and player for a new run.
   * Ensures player weapon state is initialized with character data.
   * @param selectedCharacterData Data for the selected character (optional)
   */
  // Only create a new player if one doesn't exist or if new character data is provided
  if (!this.player || selectedCharacterData) {
    this.player = new Player(this.worldW / 2, this.worldH / 2, selectedCharacterData);
    this.player.radius = 18;
  } else {
    // If player already exists and no new character data, just reset existing player state
    this.player.resetState(); // Implement this method in Player.ts
  }
  // Always rewire UpgradePanel to current player instance
  if (this.upgradePanel) {
    this.upgradePanel['player'] = this.player;
  }

    // Reset managers with new player reference
    this.enemySpatialGrid.clear(); // Clear grid on reset
    this.bulletSpatialGrid.clear(); // Clear grid on reset
    this.enemyManager = new EnemyManager(this.player, this.bulletSpatialGrid, this.particleManager, this.assetLoader, 1); // Pass spatial grid
  this.bossManager = new BossManager(this.player, this.particleManager, 1, this.assetLoader);
    // Ensure player uses the new enemyManager for enemyProvider
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    // Ensure player uses the correct game context for bulletManager
    this.player.setGameContext(this);
    // Re-initialize explosionManager with the new enemyManager instance
    this.explosionManager = new ExplosionManager(this.particleManager, this.enemyManager, this.player, (durationMs: number, intensity: number) => this.startScreenShake(durationMs, intensity));
    this.hud = new HUD(this.player, this.assetLoader);
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

    // Restart upgrade offering: on a fresh run (e.g. after GAME_OVER Enter) the original
    // interval-based free upgrade watcher no longer exists (it was cleared after first run),
    // and initialUpgradeOffered remained true, preventing a new opening panel. Reset the flag
    // and proactively show the UpgradePanel once the state is GAME and the panel is wired.
  // Clear flag so cinematic completion will trigger offering
  this.initialUpgradeOffered = false;
  this.pendingInitialUpgrade = true; // arm for post-cinematic/gameplay
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
  this.setState('CINEMATIC');
  this.cinematic.start(() => {
    this.setState('GAME');
  // pendingInitialUpgrade logic in setState will pick this up
  });
  }

  public showCharacterSelect() {
  if ((this.state === 'GAME' || this.state === 'PAUSE' || this.state === 'UPGRADE_MENU' || this.state === 'GAME_OVER') && !((window as any).__noAutoResize)) {
    Logger.debug('Entering CHARACTER_SELECT state');
    try {
      (this.mainMenu as any)?.hideMenuElement();
      const htmlCharPanel = document.getElementById('character-select-panel');
      if (htmlCharPanel) htmlCharPanel.style.display = 'none';
      const mainMenuPanel = document.getElementById('main-menu');
      if (mainMenuPanel) mainMenuPanel.style.display = 'none';
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
      if (canvas) {
        canvas.style.display = 'block';
        canvas.style.zIndex = '100';
      }
    } catch {
      // ignore if not available
    }
  }
  }

  private worldToScreenX(x: number) {
    return x - this.camX + this.designWidth / 2;
  }
  private worldToScreenY(y: number) {
    return y - this.camY + this.designHeight / 2;
  }

async init() {
  try {
    // Use default internal logic (relative under file://, absolute under http) – avoid forcing '/assets'
    await this.assetLoader.loadAllFromManifest();

    // Explicit character image preloads (ensure paths match file vs http protocol)
    const prefix = (location.protocol === 'file:' ? './assets/player/' : '/assets/player/');
    const chars = [
      'cyber_runner',
      'psionic_weaver',
      'bio_engineer',
      'titan_mech',
      'ghost_operative',
      'data_sorcerer',
      'neural_nomad',
      'shadow_operative',
      'tech_warrior',
      'heavy_gunner',
      'wasteland_scavenger',
      'rogue_hacker'
    ];
    for (const c of chars) {
      await this.assetLoader.loadImage(prefix + c + '.png');
    }

    const debugImg = this.assetLoader.getImage(prefix + 'cyber_runner.png');
    if (debugImg) {
      Logger.info(`[Game.init] cyber_runner.png loaded, src: ${debugImg.src}`);
    } else {
      Logger.warn('[Game.init] cyber_runner.png NOT loaded!');
    }
  } catch (error) {
    Logger.error('Error loading assets:', error);
    // ignore missing assets; placeholders will be used
  }
}

  // drawPause removed; handled by HTML PauseOverlay

  drawGameOver() { /* replaced by GameOverOverlay DOM */ }

  /**
   * The main update method for the game logic.
   * @param deltaTime The time elapsed since the last update, in milliseconds.
   */
  private update(deltaTime: number) {
  // console.log('Game.render called, current state:', this.state); // Removed misleading log
  // Always run gameLoop, and advance gameTime if in GAME state
  if (this.state === 'GAME') {
  // One-time world expansion after first 10s of gameplay to keep early coordinates small
  if (!this.worldExpanded && this.gameTime > 10) {
    this.worldW = 4000 * 100;
    this.worldH = 4000 * 100;
    this.worldExpanded = true;
  }
  // Expose avg frame time for adaptive systems (particle manager) using rolling EMA
  (window as any).__avgFrameMs = ((window as any).__avgFrameMs ?? deltaTime) * 0.9 + deltaTime * 0.1;
  this.gameTime += deltaTime / 1000;
  this.player.update(deltaTime);
  this.explosionManager?.update(deltaTime);
  this.enemyManager.update(deltaTime, this.gameTime, this.bulletManager.bullets);
  this.bossManager.update(deltaTime, this.gameTime);
  this.bulletManager.update(deltaTime);
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
  this.damageTextManager.update();

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
        const dx = b.x - boss.x;
        const dy = b.y - boss.y;
        const r = bossRadSumSqBase + b.radius;
        if (dx*dx + dy*dy < r*r) { // squared distance check
          boss.hp -= b.damage;
          boss._damageFlash = 12;
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
  this.camX += (targetCamX - this.camX) * this.camLerp;
  this.camY += (targetCamY - this.camY) * this.camLerp;
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
  // (perf overlay removed)
  // Adapt internal resolution based on recent jitter (Electron only)
  this.adjustRenderScale();
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
  this.drawBackground();
        // Now apply camera transform and draw entities
        this.ctx.save();
        this.ctx.translate(-this.camX + shakeOffsetX, -this.camY + shakeOffsetY);
        this.enemyManager.draw(this.ctx, this.camX, this.camY);
        this.bulletManager.draw(this.ctx);
        // Active beams (railgun) under player for proper layering
        if (this._activeBeams && this._activeBeams.length) {
          for (const beam of this._activeBeams) {
            const elapsed = performance.now() - beam.start;
            const t = elapsed / beam.duration;
            if (t >= 1) continue;
            const fade = 1 - t;
            this.ctx.save();
            this.ctx.translate(beam.x, beam.y);
            this.ctx.rotate(beam.angle);
            const thickness = 16 * (0.9 + 0.1 * Math.sin(elapsed * 0.18)); // visually slimmer
            const len = beam.range;
            if (!this.lowFX && !debugNoAdd) {
              const grad = this.ctx.createLinearGradient(0, 0, len, 0);
              grad.addColorStop(0, `rgba(255,255,255,${0.85 * fade})`);
              grad.addColorStop(0.08, `rgba(0,255,255,${0.75 * fade})`);
              grad.addColorStop(0.4, `rgba(0,128,255,${0.32 * fade})`);
              grad.addColorStop(1, 'rgba(0,0,0,0)');
              this.ctx.fillStyle = grad;
              this.ctx.shadowColor = '#00FFFF';
              this.ctx.shadowBlur = 22; // tighter glow
              if (!debugNoAdd) this.ctx.globalCompositeOperation = 'lighter';
            } else {
              this.ctx.fillStyle = `rgba(0,200,255,${0.4*fade})`;
              this.ctx.globalCompositeOperation = 'source-over';
            }
            this.ctx.beginPath();
            this.ctx.rect(0, -thickness/2, len, thickness);
            this.ctx.fill();
            // Core line
            this.ctx.strokeStyle = this.lowFX ? `rgba(255,255,255,${0.25 * fade})` : `rgba(255,255,255,${0.6 * fade})`;
            this.ctx.lineWidth = 2.5;
            this.ctx.beginPath();
            this.ctx.moveTo(0,0);
            this.ctx.lineTo(len,0);
            this.ctx.stroke();
            this.ctx.restore();
          }
        }
        this.player.draw(this.ctx);
        this.particleManager.draw(this.ctx);
        this.explosionManager?.draw(this.ctx);
        this.bossManager.draw(this.ctx);
        this.ctx.restore();
  this.damageTextManager.draw(this.ctx, this.camX, this.camY, this.renderScale);
  // Removed full-screen additive overlay to prevent global flash; enemy hit feedback now strictly per-entity.
        this.hud.draw(this.ctx, this.gameTime, this.enemyManager.getEnemies(), this.worldW, this.worldH, this.player.upgrades);

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
    // Route through centralized ExplosionManager for visuals and AoE damage
    this.explosionManager?.triggerExplosion(x, y, damage, hitEnemy, radius ?? 100);
  }
  /**
   * Handles a kamikaze drone explosion event (separate from mortar for balance & visuals).
   */
  private handleDroneExplosion(event: CustomEvent): void {
    const { x, y, damage, radius } = event.detail;
    // Use shockwave-only variant for cleaner visual (no old filled circle)
    const r = radius ?? 160;
    if (this.explosionManager?.triggerShockwave) {
      this.explosionManager.triggerShockwave(x, y, damage, r, '#00BFFF');
    } else {
      this.explosionManager?.triggerExplosion(x, y, damage, undefined, r, '#00BFFF');
    }
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
    const noisePerTile = 140; // tune density (was dynamic per-cell before)
    for (let i=0;i<noisePerTile;i++) {
      // LCG pseudo-random
      const seed = (i * 48271) & 0x7fffffff;
      const rx = (seed % 1000) / 1000;
      const ry = ((seed / 1000) % 1000) / 1000;
      const px = rx * size;
      const py = ry * size;
      // Skip points too near grid intersections for clarity
      if ((px % g) < 3 || (py % g) < 3) continue;
      ctx.fillStyle = '#2d3558';
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
        g.addColorStop(0, '#0a0a1a');
        g.addColorStop(0.5, '#181825');
        g.addColorStop(1, '#232347');
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
