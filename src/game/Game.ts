import { Player } from './Player';
import { EnemyManager } from './EnemyManager';
import { HUD } from '../ui/HUD';
import { UpgradePanel } from '../ui/UpgradePanel';
import { Cinematic } from '../ui/Cinematic';
import { BossManager } from './BossManager';
import { BulletManager } from './BulletManager';
import { ParticleManager } from './ParticleManager';
import { AssetLoader } from './AssetLoader';
import { MainMenu } from '../ui/MainMenu';
import { CharacterSelectPanel } from '../ui/CharacterSelectPanel';
import { DamageTextManager } from './DamageTextManager';

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private player: Player;
  private enemyManager: EnemyManager;
  private bossManager: BossManager;
  private bulletManager: BulletManager;
  private particleManager: ParticleManager;
  private hud: HUD;
  private upgradePanel: UpgradePanel;
  private cinematic: Cinematic;
  private assetLoader: AssetLoader;
  private mainMenu!: MainMenu; // Changed to be set later
  private characterSelectPanel: CharacterSelectPanel;
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.state = 'MAIN_MENU';
    this.gameTime = 0;
    this.assetLoader = new AssetLoader();
    this.particleManager = new ParticleManager(160);
    this.bulletManager = new BulletManager(this.assetLoader);
    this.cinematic = new Cinematic();
    // mainMenu and characterSelectPanel are initialized later or passed
    this.characterSelectPanel = new CharacterSelectPanel(this.assetLoader);
    // Initialize player and managers here
    this.player = new Player(this.worldW / 2, this.worldH / 2);
    this.player.radius = 18;
    this.enemyManager = new EnemyManager(this.player, this.particleManager, 1, this.assetLoader);
    this.bossManager = new BossManager(this.player, this.particleManager);
    this.hud = new HUD(this.player, this.assetLoader);
    this.upgradePanel = new UpgradePanel(this.player);
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    this.player.setGameContext(this as any); // Cast to any to allow setting game context
    this.initInput();

    window.addEventListener('upgradeOpen', () => {
      if (this.state === 'GAME') this.state = 'UPGRADE_MENU';
    });
    window.addEventListener('upgradeClose', () => {
      if (this.state === 'UPGRADE_MENU') this.state = 'GAME';
    });
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

      if (this.state === 'CHARACTER_SELECT') {
        const clickResult = this.characterSelectPanel.handleClick(mouseX, mouseY, this.canvas);

        if (clickResult && typeof clickResult === 'object') { // Character was clicked
          this.selectedCharacterData = clickResult; // Store the selected character data
          // No game start from here, just update selection
        } else if (clickResult === 'backToMainMenu') {
          this.state = 'MAIN_MENU';
          if (this.mainMenu) this.mainMenu.show();
        }
      } else if (this.state === 'GAME_OVER') { // Add this condition
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
        if (clickResult && typeof clickResult === 'object') {
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
  }

  /**
   * Resets the game state and player, optionally with selected character data.
   * @param selectedCharacterData Data for the selected character (optional)
   */
  public resetGame(selectedCharacterData?: any) {
    // Reset player position and stats
    this.player = new Player(this.worldW / 2, this.worldH / 2);
    this.player.radius = 18;
    if (selectedCharacterData) {
      this.player.applyCharacterData?.(selectedCharacterData);
    }
    // Reset managers with new player reference
    this.enemyManager = new EnemyManager(this.player, this.particleManager, 1, this.assetLoader);
    this.bossManager = new BossManager(this.player, this.particleManager);
    this.hud = new HUD(this.player, this.assetLoader);
    this.upgradePanel = new UpgradePanel(this.player);
    this.player.setEnemyProvider(() => this.enemyManager.getEnemies());
    this.player.setGameContext(this as any);
    this.gameTime = 0;
    this.camX = this.worldW / 2;
    this.camY = this.worldH / 2;
    this.state = 'GAME';
  }

  setMainMenu(mainMenu: MainMenu) {
    this.mainMenu = mainMenu;
  }

  public startCinematicAndGame() {
    this.state = 'CINEMATIC';
    this.cinematic.start(() => { this.state = 'GAME'; });
  }

  public showCharacterSelect() {
    this.state = 'CHARACTER_SELECT';
    // Ensure HTML main menu (if present) does not cover the canvas
    try {
      (this.mainMenu as any)?.hideMenuElement();
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

start() {
  requestAnimationFrame(() => this.loop());
}

private updateCamera() {
  // target camera at player
  const targetX = Math.max(0, Math.min(this.worldW, this.player.x));
  const targetY = Math.max(0, Math.min(this.worldH, this.player.y));
  this.camX += (targetX - this.camX) * this.camLerp;
  this.camY += (targetY - this.camY) * this.camLerp;
}

  private loop() {
    if (!this.ctx) {
      console.error('Canvas context (this.ctx) is null or undefined in loop().');
      requestAnimationFrame(() => this.loop());
      return;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Universal base background to ensure visibility even if rendering fails in other layers
    this.ctx.save();
    this.ctx.fillStyle = '#181818';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    try {
      switch (this.state) {
        case 'MENU':
          // this.drawMenu(); // Removed
          break;
        case 'MAIN_MENU':
          if (this.mainMenu) this.mainMenu.show();
          break;
        case 'CHARACTER_SELECT':
        if (this.mainMenu) this.mainMenu.hideMenuElement();
        this.characterSelectPanel.update();
        this.characterSelectPanel.draw(this.ctx, this.canvas);
        break;
      case 'CINEMATIC':
  if (this.mainMenu) this.mainMenu.hide();
        this.cinematic.draw(this.ctx, this.canvas);
        break;
      case 'GAME':
  if (this.mainMenu) this.mainMenu.hide();
        this.updateGame();
        this.drawGame();
        break;
      case 'PAUSE':
        if (this.mainMenu) this.mainMenu.hideMenuElement();
        this.drawPause();
        break;
      case 'GAME_OVER':
        if (this.mainMenu) this.mainMenu.hideMenuElement();
        this.drawGameOver();
        break;
      case 'UPGRADE_MENU':
        this.drawGame(); // Draw game world underneath
        this.upgradePanel.draw(this.ctx); // Draw upgrade panel on top
        break;
      }
    } catch (err) {
       console.error('Rendering loop error:', err);
       // Fallback: ensure canvas is visible even if something goes wrong
       this.ctx.save();
       this.ctx.fillStyle = '#181818';
       this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
       this.ctx.restore();
    }
    requestAnimationFrame(() => this.loop());
  }

  drawPause() {
  // Draw upgrades list overlay
  UpgradePanel.showUpgradeList(this.ctx, this.player);

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

  updateGame() {
    this.gameTime += 1 / 60; // Assuming 60 FPS
    this.player.update(1); // Pass delta (e.g., 1 for frame-based update)

    if (this.player.hp <= 0) {
      this.state = 'GAME_OVER';
      return; // Stop updating game elements if game is over
    }

    // clamp player to world bounds
    this.player.x = Math.max(0, Math.min(this.worldW, this.player.x));
    this.player.y = Math.max(0, Math.min(this.worldH, this.player.y));
    this.bulletManager.update();
    this.enemyManager.update(this.bulletManager.bullets, this.gameTime);
    this.bossManager.update();
    // Boss bullet collision
    const boss = this.bossManager.getActiveBoss && this.bossManager.getActiveBoss();
    if (boss && boss.state === 'ACTIVE' && boss.active && boss.hp > 0) {
      for (const b of this.bulletManager.bullets) {
        if (!b.active) continue;
        const ddx = b.x - boss.x;
        const ddy = b.y - boss.y;
        const d = Math.hypot(ddx, ddy);
        if (d < boss.radius + b.radius) {
          boss.hp -= b.damage;
          boss._damageFlash = 12;
          this.damageTextManager.spawn(boss.x, boss.y - boss.radius, b.damage, '#FFD700');
          this.dpsFrameDamage += b.damage;
          if (!(b as any).piercing) {
            b.active = false;
          }
        }
      }
      if (boss.hp <= 0) boss.state = 'DEAD';
    }
    this.particleManager.update();
    this.upgradePanel.update();
    this.damageTextManager.update();
    // DPS logging (every second)
    if (Math.floor(this.gameTime * 60) % 60 === 0) {
      this.dpsLog.push(this.dpsFrameDamage);
      this.dpsFrameDamage = 0;
      // Optionally: console.log('DPS:', this.dpsLog[this.dpsLog.length-1]);
    }
    this.updateCamera();
  }

  drawGame() {
    // Simple grass background
    this.ctx.save();
    const grassGradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    grassGradient.addColorStop(0, '#3cb371'); // MediumSeaGreen
    grassGradient.addColorStop(1, '#228b22'); // ForestGreen
    this.ctx.fillStyle = grassGradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

    // Make grid tiles semi-transparent so background is visible
    const tile = 128;
    const startX = Math.floor((this.camX - this.canvas.width/2)/tile) * tile;
    const startY = Math.floor((this.camY - this.canvas.height/2)/tile) * tile;
    for (let x = startX; x < startX + this.canvas.width + tile; x += tile) {
      for (let y = startY; y < startY + this.canvas.height + tile; y += tile) {
        const sx = this.worldToScreenX(x);
        const sy = this.worldToScreenY(y);
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(11,11,11,0.45)'; // Semi-transparent black
        this.ctx.fillRect(sx, sy, tile - 2, tile - 2);
        this.ctx.restore();
      }
    }

    // draw entities in world coordinates by translating context to camera
    this.ctx.save();
    const tx = this.canvas.width / 2 - this.camX;
    const ty = this.canvas.height / 2 - this.camY;
    this.ctx.translate(tx, ty);

    // now draw entities at their world positions
    console.log('drawGame: Drawing player');
    this.player.draw(this.ctx);
    console.log('drawGame: Drawing bullets');
    this.bulletManager.draw(this.ctx);
    console.log('drawGame: Drawing enemies');
    this.enemyManager.draw(this.ctx);
    console.log('drawGame: Drawing boss');
    this.bossManager.draw(this.ctx);
    this.damageTextManager.draw(this.ctx);
    console.log('drawGame: Drawing particles');
    this.particleManager.draw(this.ctx);
    console.log('drawGame: Entities drawn');

    // restore to screen space for HUD and UI
    this.ctx.restore();

    this.hud.draw(this.ctx, this.gameTime);
    this.upgradePanel.draw(this.ctx);

    // HUD alive enemies
    const aliveCount = this.enemyManager?.getAliveCount?.() ?? 0;
    this.hud?.drawAliveEnemiesCount(this.ctx, aliveCount);
    console.log('drawGame: Finished');

    if (this.brightenMode) {
      // Apply a vertical gradient to brighten the game
      const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Draw minimap in top-right corner
    this.ctx.save();
    const mapW = 180, mapH = 180;
    const mapX = this.canvas.width - mapW - 24;
    const mapY = 24;
    this.ctx.globalAlpha = 0.92;
    this.ctx.fillStyle = '#222';
    this.ctx.fillRect(mapX, mapY, mapW, mapH);
    this.ctx.strokeStyle = '#FFD700';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(mapX, mapY, mapW, mapH);
    // Draw player dot
    const px = Math.floor(this.player.x / 10) % mapW;
    const py = Math.floor(this.player.y / 10) % mapH;
    this.ctx.beginPath();
    this.ctx.arc(mapX + px, mapY + py, 8, 0, Math.PI * 2);
    this.ctx.fillStyle = '#00FFFF';
    this.ctx.fill();
    // Draw enemy dots
    for (const e of this.enemyManager.getEnemies()) {
      if (!e || e.hp <= 0) continue;
      const ex = Math.floor(e.x / 10) % mapW;
      const ey = Math.floor(e.y / 10) % mapH;
      this.ctx.beginPath();
      this.ctx.arc(mapX + ex, mapY + ey, 6, 0, Math.PI * 2);
      this.ctx.fillStyle = '#FF2D2D';
      this.ctx.fill();
    }
    this.ctx.restore();
  }
}
