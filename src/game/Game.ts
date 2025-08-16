import { Player } from './Player';
import { EnemyManager } from './EnemyManager';
import { ExplosionManager } from './ExplosionManager';
import { HUD } from '../ui/HUD';
import { UpgradePanel } from '../ui/UpgradePanel'; // Import UpgradePanel
import { Cinematic } from '../ui/Cinematic';
import { BossManager } from './BossManager';
import { BulletManager } from './BulletManager';
import { ParticleManager } from './ParticleManager';
import { AssetLoader } from './AssetLoader';
import { MainMenu } from '../ui/MainMenu';
import { CharacterSelectPanel } from '../ui/CharacterSelectPanel';
import { DamageTextManager } from './DamageTextManager';
import { GameLoop } from '../core/GameLoop';
import { Logger } from '../core/Logger';
import { WEAPON_SPECS } from './WeaponConfig';
import { WeaponType } from './WeaponType';

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
  private backgroundImage: HTMLImageElement | null = null;
  /**
   * Sets the game state. Used for UI panels like upgrade menu.
   * @param state New state string
   */
  public setState(state: 'MENU' | 'MAIN_MENU' | 'CHARACTER_SELECT' | 'CINEMATIC' | 'GAME' | 'PAUSE' | 'GAME_OVER' | 'UPGRADE_MENU') {
    this.state = state;
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
  private cinematic: Cinematic;
  private mainMenu!: MainMenu; // Changed to be set later
  private characterSelectPanel!: CharacterSelectPanel; // Changed to be set later
  private selectedCharacterData: any | null = null; // To store selected character
  private state: 'MENU' | 'MAIN_MENU' | 'CHARACTER_SELECT' | 'CINEMATIC' | 'GAME' | 'PAUSE' | 'GAME_OVER' | 'UPGRADE_MENU';
  private gameTime: number = 0;

  // world/camera
  private worldW = 4000 * 100; // 100x larger
  private worldH = 4000 * 100; // 100x larger
  private camX = 0;
  private camY = 0;
  private camLerp = 0.12;
  private brightenMode: boolean = true;

  private damageTextManager: DamageTextManager = new DamageTextManager();
  private dpsLog: number[] = [];
  private dpsFrameDamage: number = 0;
  private gameLoop: GameLoop;

  // DPS Tracking
  private totalDamageDealt: number = 0;
  private dpsHistory: { time: number, damage: number }[] = []; // Stores { timestamp, damageAmount }
  private dpsWindow: number = 5000; // 5 seconds for rolling DPS calculation

  // Screen Shake
  private shakeDuration: number = 0; // How long to shake (in milliseconds)
  private shakeIntensity: number = 0; // How strong the shake is
  private currentShakeTime: number = 0; // Current time for shake effect

  private explosionManager?: ExplosionManager;

  constructor(canvas: HTMLCanvasElement) {
  // Load static background image
  this.backgroundImage = new window.Image();
  this.backgroundImage.src = 'assets/background.png';
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = 'MAIN_MENU';
    this.gameTime = 0;
    this.assetLoader = new AssetLoader(); // Initialization remains here
    this.particleManager = new ParticleManager(160);
    this.bulletManager = new BulletManager(this.assetLoader);
    // ExplosionManager will be initialized after EnemyManager is created
    this.cinematic = new Cinematic();
    // Initialize player and managers here
    this.player = new Player(this.worldW / 2, this.worldH / 2);
    this.player.radius = 18;
    this.enemyManager = new EnemyManager(this.player, this.particleManager, this.assetLoader, 1);
    this.bossManager = new BossManager(this.player, this.particleManager);
    if (!this.explosionManager) {
      this.explosionManager = new ExplosionManager(this.particleManager, this.enemyManager, this.player, (durationMs: number, intensity: number) => this.startScreenShake(durationMs, intensity));
    }
    this.hud = new HUD(this.player, this.assetLoader);
    // Removed direct instantiation: this.upgradePanel = new UpgradePanel(this.player, this); // Will be set via setter
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    this.player.setGameContext(this as any); // Cast to any to allow setting game context
    this.initInput();
    this.gameLoop = new GameLoop(this.update.bind(this), this.render.bind(this));

    // Initialize camera position to center on player
    this.camX = this.player.x - this.canvas.width / 2;
    this.camY = this.player.y - this.canvas.height / 2;

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
    // Listen for enemyDeathExplosion event
    window.addEventListener('enemyDeathExplosion', (e: Event) => this.handleEnemyDeathExplosion(e as CustomEvent));

    // Listen for level up and chest upgrade events to show UpgradePanel
    window.addEventListener('levelup', () => {
      Logger.debug('[Game] levelup event received, attempting to show UpgradePanel.');
      if (!this.upgradePanel) {
        Logger.error('[Game] UpgradePanel instance missing on levelup!');
        return;
      }
      // Defensive: check DOM element exists before showing
      if (typeof this.upgradePanel.show === 'function' && this.upgradePanel['panelElement']) {
        Logger.debug('[Game] UpgradePanel panelElement exists, calling show().');
        this.upgradePanel.show();
        this.setState('UPGRADE_MENU');
      } else {
        Logger.error('[Game] UpgradePanel panelElement missing or show() not a function.');
      }
    });
    window.addEventListener('forceUpgradeOption', (e: Event) => {
      Logger.debug('[Game] forceUpgradeOption event received, attempting to show UpgradePanel.');
      if (!this.upgradePanel) {
        Logger.error('[Game] UpgradePanel instance missing on forceUpgradeOption!');
        return;
      }
      if (typeof this.upgradePanel.show === 'function' && this.upgradePanel['panelElement']) {
        Logger.debug('[Game] UpgradePanel panelElement exists, calling show().');
        this.upgradePanel.show();
        this.setState('UPGRADE_MENU');
      } else {
        Logger.error('[Game] UpgradePanel panelElement missing or show() not a function.');
      }
    });
    // ...existing code...
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
    // Main Menu Button
    const mainMenuBtnX = this.canvas.width / 2 - 150;
    const mainMenuBtnY = this.canvas.height / 2;
    const btnWidth = 300;
    const btnHeight = 60;

    // Restart Button
    const restartBtnX = this.canvas.width / 2 - 150;
    const restartBtnY = this.canvas.height / 2 + 80;

    // Check if click is within Main Menu button
    if (
      x >= mainMenuBtnX &&
      x <= mainMenuBtnX + btnWidth &&
      y >= mainMenuBtnY &&
      y <= mainMenuBtnY + btnHeight
    ) {
      this.state = 'MAIN_MENU';
      if (this.mainMenu) this.mainMenu.show();
      return;
    }

    // Check if click is within Restart button
    if (
      x >= restartBtnX &&
      x <= restartBtnX + btnWidth &&
      y >= restartBtnY &&
      y <= restartBtnY + btnHeight
    ) {
      this.resetGame(this.selectedCharacterData);
      return;
    }
  }

  /**
   * Initializes input event listeners for the game.
   */
  private initInput() {
    window.addEventListener('keydown', (e) => {
      if (this.state === 'CHARACTER_SELECT') {
        this.characterSelectPanel.handleInput(e); // Allow panel to handle input first
      } else if (this.state === 'GAME' && e.key === 'Escape') {
        this.state = 'PAUSE';
        // this.mainMenu.hide(); // Main menu is HTML, no need to hide here
      } else if (this.state === 'PAUSE' && e.key === 'Escape') {
        this.state = 'GAME';
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
      } else if (e.key.toLowerCase() === 'm') { // Toggle minimap
        this.hud.showMinimap = !this.hud.showMinimap;
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.state === 'CHARACTER_SELECT') {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        this.characterSelectPanel.handleMouseMove(mouseX, mouseY, this.canvas);
      }
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
      // Character select click handling on canvas
      if (this.state === 'CHARACTER_SELECT') {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const clickResult = this.characterSelectPanel.handleClick(mouseX, mouseY, this.canvas);
        // clickResult is CharacterData when a character is clicked, or 'backToMainMenu'
        /**
         * Defensive: Only accept complete character data (must have stats, visuals, and weapon)
         */
        if (clickResult && typeof clickResult === 'object' && clickResult.stats && clickResult.defaultWeapon !== undefined) {
          this.selectedCharacterData = clickResult;
          this.state = 'MAIN_MENU';
          this.mainMenu.show();
        } else if (clickResult === 'backToMainMenu') {
          this.state = 'MAIN_MENU';
          this.mainMenu.show();
        }
      } else if (this.state === 'PAUSE') {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        this.handlePauseMenuClick(mouseX, mouseY);
      }
    });

    // Listen for the custom 'startGame' event from CharacterSelectPanel
    window.addEventListener('startGame', (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        this.selectedCharacterData = customEvent.detail; // Store the selected character data
        this.state = 'GAME'; // Transition to GAME state
        this.mainMenu.hide(); // Hide main menu
        this.resetGame(this.selectedCharacterData); // Reset game with selected character data

        // Instantiate UpgradePanel here, after player is initialized with character data
        if (!this.upgradePanel) { // Only instantiate once
          this.upgradePanel = new UpgradePanel(this.player, this); // Pass initialized player and game
          Logger.debug('[Game] UpgradePanel instantiated and set.');
        }
      }
    });
  }

  /**
   * Resets the game state and player, optionally with selected character data.
   * @param selectedCharacterData Data for the selected character (optional)
   */
  public resetGame(selectedCharacterData?: any) {
    Logger.debug(`[Game.resetGame] selectedCharacterData received:`, selectedCharacterData);
  /**
   * Resets the game state and player for a new run.
   * Ensures player weapon state is initialized with character data.
   * @param selectedCharacterData Data for the selected character (optional)
   */
  // Only create a new player if one doesn't exist or if new character data is provided
  if (!this.player || selectedCharacterData) {
    this.player = new Player(this.worldW / 2, this.worldH / 2, selectedCharacterData);
    Logger.debug(`[Game.resetGame] New Player instance created. Active weapons: ${Array.from(this.player.activeWeapons.entries()).map(([wt, lvl]) => WeaponType[wt] + ':' + lvl).join(', ')}`);
    this.player.radius = 18;
  } else {
    // If player already exists and no new character data, just reset existing player state
    this.player.resetState(); // Implement this method in Player.ts
    Logger.debug(`[Game.resetGame] Existing Player state reset. Active weapons: ${Array.from(this.player.activeWeapons.entries()).map(([wt, lvl]) => WeaponType[wt] + ':' + lvl).join(', ')}`);
  }
  // Always rewire UpgradePanel to current player instance
  if (this.upgradePanel) {
    this.upgradePanel['player'] = this.player;
    Logger.debug('[Game.resetGame] UpgradePanel rewired to new player instance.');
  }

    // Reset managers with new player reference
    this.enemyManager = new EnemyManager(this.player, this.particleManager, this.assetLoader, 1);
    this.bossManager = new BossManager(this.player, this.particleManager);
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
    this.shakeDuration = 0;
    this.shakeIntensity = 0;
    this.currentShakeTime = 0;
    this.state = 'GAME'; // Set state to GAME after reset
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

  /**
   * Pauses the game.
   */
  public pause() {
    if (this.gameLoop) {
      this.gameLoop.stop();
    }
    this.state = 'PAUSE';
    // Logger.info('Game Paused'); // Removed debug log
  }

  /**
   * Resumes the game.
   */
  public resume() {
    if (this.gameLoop) {
      this.gameLoop.start();
    }
    this.state = 'GAME'; // Assuming it resumes to GAME state
    // Logger.info('Game Resumed'); // Removed debug log
  }

  /**
   * Starts the main game loop.
   */
  public start() {
    if (this.gameLoop) {
      this.gameLoop.start();
    }
  }

  public startCinematicAndGame() {
  this.state = 'CINEMATIC';
  this.cinematic.start(() => { this.state = 'GAME'; });
  }

  public showCharacterSelect() {
  console.log('Game.showCharacterSelect called, setting state to CHARACTER_SELECT');
    this.state = 'CHARACTER_SELECT';
    // Debug log for state transition
    window.dispatchEvent(new CustomEvent('debugLog', { detail: 'Entering CHARACTER_SELECT state' }));
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

  private worldToScreenX(x: number) {
    return x - this.camX + this.canvas.width / 2;
  }
  private worldToScreenY(y: number) {
    return y - this.camY + this.canvas.height / 2;
  }

async init() {
  try {
    await this.assetLoader.loadAllFromManifest('/assets');
  } catch (error) {
    console.error("Error loading assets:", error);
    // ignore missing assets; placeholders will be used
  }
}

  drawPause() {
  // Removed: Draw upgrades list overlay (now handled by HTML UpgradePanel)

  // Draw PAUSED text
  this.ctx.save();
  this.ctx.globalAlpha = 1;
  this.ctx.fillStyle = '#fff';
  this.ctx.font = 'bold 48px Orbitron, sans-serif';
  this.ctx.textAlign = 'center';
  this.ctx.fillText('PAUSED', this.canvas.width / 2, 100);

  // Main Menu Button
  const mainMenuBtnX = this.canvas.width / 2 - 150;
  const mainMenuBtnY = this.canvas.height / 2;
  const btnWidth = 300;
  const btnHeight = 60;

  this.ctx.strokeStyle = '#00FFFF';
  this.ctx.lineWidth = 2;
  this.ctx.strokeRect(mainMenuBtnX, mainMenuBtnY, btnWidth, btnHeight);
  this.ctx.fillStyle = 'rgba(25, 25, 40, 0.8)';
    this.ctx.fillRect(mainMenuBtnX, mainMenuBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = '#00FFFF';
    this.ctx.font = 'bold 28px Orbitron, sans-serif';
    this.ctx.fillText('MAIN MENU', this.canvas.width / 2, mainMenuBtnY + btnHeight / 2 + 8);

    // Restart Button
    const restartBtnX = this.canvas.width / 2 - 150;
    const restartBtnY = this.canvas.height / 2 + 80;

    this.ctx.strokeStyle = '#00FFFF';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(restartBtnX, restartBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = 'rgba(25, 25, 40, 0.8)';
    this.ctx.fillRect(restartBtnX, restartBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = '#00FFFF';
    this.ctx.font = 'bold 28px Orbitron, sans-serif';
    this.ctx.fillText('RESTART', this.canvas.width / 2, restartBtnY + btnHeight / 2 + 8);

    this.ctx.restore();
  }

  drawGameOver() {
    this.ctx.save();
    this.ctx.globalAlpha = 0.7;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = '#f00';
    this.ctx.font = 'bold 64px Orbitron, sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('GAME OVER', this.canvas.width / 2, this.canvas.height / 2 - 100);

    // Main Menu Button
    const mainMenuBtnX = this.canvas.width / 2 - 150;
    const mainMenuBtnY = this.canvas.height / 2;
    const btnWidth = 300;
    const btnHeight = 60;

    this.ctx.strokeStyle = '#00FFFF';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(mainMenuBtnX, mainMenuBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = 'rgba(25, 25, 40, 0.8)';
    this.ctx.fillRect(mainMenuBtnX, mainMenuBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = '#00FFFF';
    this.ctx.font = 'bold 28px Orbitron, sans-serif';
    this.ctx.fillText('MAIN MENU', this.canvas.width / 2, mainMenuBtnY + btnHeight / 2 + 8);

    // Restart Button
    const restartBtnX = this.canvas.width / 2 - 150;
    const restartBtnY = this.canvas.height / 2 + 80;

    this.ctx.strokeStyle = '#00FFFF';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(restartBtnX, restartBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = 'rgba(25, 25, 40, 0.8)';
    this.ctx.fillRect(restartBtnX, restartBtnY, btnWidth, btnHeight);
    this.ctx.fillStyle = '#00FFFF';
    this.ctx.font = 'bold 28px Orbitron, sans-serif';
    this.ctx.fillText('RESTART', this.canvas.width / 2, restartBtnY + btnHeight / 2 + 8);

    this.ctx.fillStyle = '#fff';
    this.ctx.font = '24px Orbitron, sans-serif';
    this.ctx.restore();
  }

  /**
   * The main update method for the game logic.
   * @param deltaTime The time elapsed since the last update, in milliseconds.
   */
  private update(deltaTime: number) {
  // console.log('Game.render called, current state:', this.state); // Removed misleading log
  // Always run gameLoop, and advance gameTime if in GAME state
  if (this.state === 'GAME') {
    this.gameTime += deltaTime / 1000;
    this.player.update(deltaTime);
    this.explosionManager?.update();
    this.enemyManager.update(deltaTime, this.gameTime, this.bulletManager.bullets);
    this.bossManager.update(deltaTime, this.gameTime);
    this.bulletManager.update();
    this.particleManager.update();
    this.damageTextManager.update();
    // --- Boss bullet collision ---
    const boss = this.bossManager.getActiveBoss();
    if (boss) {
      for (let i = 0; i < this.bulletManager.bullets.length; i++) {
        const b = this.bulletManager.bullets[i];
        if (!b.active) continue;
        const dx = b.x - boss.x;
        const dy = b.y - boss.y;
        const dist = Math.hypot(dx, dy);
        if (dist < boss.radius + b.radius) {
          boss.hp -= b.damage;
          boss._damageFlash = 12;
          b.active = false;
          this.particleManager.spawn(boss.x, boss.y, 1, '#FFD700');
          window.dispatchEvent(new CustomEvent('damageDealt', { detail: { amount: b.damage, isCritical: false } }));
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
    this.camX += (this.player.x - this.canvas.width / 2 - this.camX) * this.camLerp;
    this.camY += (this.player.y - this.canvas.height / 2 - this.camY) * this.camLerp;
    this.camX = Math.max(0, Math.min(this.camX, this.worldW - this.canvas.width));
    this.camY = Math.max(0, Math.min(this.camY, this.worldH - this.canvas.height));
    if (this.player.hp <= 0) {
      this.state = 'GAME_OVER';
    }
  } else if (this.state === 'CINEMATIC') {
    this.cinematic.update();
    if (this.cinematic.isFinished()) {
      this.state = 'GAME';
    }
  }
  }

  /**
   * The main render method for drawing game elements.
   * @param alpha The interpolation factor for smooth rendering between fixed updates.
   */
  private render(alpha: number) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Apply brighten mode if active
    if (this.brightenMode) {
      this.ctx.filter = 'brightness(1.2)';
    } else {
      this.ctx.filter = 'none';
    }

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
      } else {
        canvasElem.style.zIndex = '-1';
      }
    }

    switch (this.state) {
      case 'GAME':
      case 'PAUSE':
      case 'UPGRADE_MENU':
      case 'GAME_OVER':
        Logger.debug(`[Game.render] Rendering state: ${this.state}`);
        // Draw cyberpunk grid background before camera transform
        this.ctx.save();
        // Night city gradient sky
        const grad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        grad.addColorStop(0, '#0a0a1a');
        grad.addColorStop(0.5, '#181825');
        grad.addColorStop(1, '#232347');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw PNG background as a seamless tile so it never disappears
        if (
          this.backgroundImage &&
          this.backgroundImage.complete &&
          this.backgroundImage.naturalWidth > 0 &&
          this.backgroundImage.naturalHeight > 0
        ) {
          this.ctx.save();
          this.ctx.globalAlpha = 0.85;
          const imgW = this.backgroundImage.naturalWidth;
          const imgH = this.backgroundImage.naturalHeight;
          // Find top-left tile to start drawing
          const startX = Math.floor(this.camX / imgW) * imgW;
          const startY = Math.floor(this.camY / imgH) * imgH;
          for (let x = startX; x < this.camX + this.canvas.width; x += imgW) {
            for (let y = startY; y < this.camY + this.canvas.height; y += imgH) {
              this.ctx.drawImage(
                this.backgroundImage,
                x - this.camX, y - this.camY, imgW, imgH
              );
            }
          }
          this.ctx.globalAlpha = 1;
          this.ctx.restore();
        }
  // Removed animated neon scanlines and moving lines for a clean PNG background.
        this.ctx.restore();
        // Now apply camera transform and draw entities
        this.ctx.save();
        this.ctx.translate(-this.camX + shakeOffsetX, -this.camY + shakeOffsetY);
        this.enemyManager.draw(this.ctx, this.camX, this.camY);
        this.bulletManager.draw(this.ctx);
        this.player.draw(this.ctx);
        this.particleManager.draw(this.ctx);
        this.explosionManager?.draw(this.ctx);
        this.bossManager.draw(this.ctx);
        this.ctx.restore();
        this.damageTextManager.draw(this.ctx, this.camX, this.camY);
        this.hud.draw(this.ctx, this.gameTime, this.enemyManager.getEnemies(), this.worldW, this.worldH, this.player.upgrades);

        if (this.state === 'PAUSE') {
          this.drawPause();
        } else if (this.state === 'GAME_OVER') {
          this.drawGameOver();
        }
        break;
      case 'MAIN_MENU':
        Logger.debug('[Game.render] MAIN_MENU state, hiding canvas.');
        if (canvasElem) canvasElem.style.zIndex = '-1';
        break;
      case 'CHARACTER_SELECT':
        Logger.debug('[Game.render] CHARACTER_SELECT state.');
        this.characterSelectPanel.draw(this.ctx, this.canvas);
        break;
      case 'CINEMATIC':
        Logger.debug('[Game.render] CINEMATIC state.');
        this.cinematic.draw(this.ctx, this.canvas);
        break;
    }
  }

  private handleDamageDealt(event: CustomEvent): void {
    const damageAmount = event.detail.amount;
    const isCritical = event.detail.isCritical || false; // Get isCritical from event detail
    this.dpsHistory.push({ time: performance.now(), damage: damageAmount });
    // Spawn damage text at player's position (or enemy's position if available in event detail)
    // For now, using player's position as a placeholder, ideally it should be enemy's position
    this.damageTextManager.spawn(this.player.x, this.player.y, damageAmount, undefined, isCritical);
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
   * Handles an enemy death explosion event.
   * @param event CustomEvent with explosion details (x, y, damage, radius, color)
   */
  private handleEnemyDeathExplosion(event: CustomEvent): void {
    const { x, y, damage, radius, color } = event.detail;
    // Route through centralized ExplosionManager for visuals and AoE damage
    this.explosionManager?.triggerExplosion(x, y, damage, undefined, radius ?? 50, color ?? '#FF4500');
  }
}
