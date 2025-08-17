// Entry point for the game
import { Game } from './game/Game';
import { MainMenu } from './ui/MainMenu';
import { CharacterSelectPanel } from './ui/CharacterSelectPanel'; // Import CharacterSelectPanel
import { Logger } from './core/Logger'; // Import Logger

window.onload = async () => {
  // --- Cinematic skip button click handler ---
  // Move click handler after canvas is assigned
  setTimeout(() => {
    canvas.addEventListener('mousedown', (e) => {
      if (!game.cinematic || !game.cinematic.active) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (game.cinematic.handleClick(x, y, canvas)) {
        Logger.info('[main.ts] Cinematic skipped via button');
      }
    });
  }, 0);
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) {
    Logger.error('Canvas element with ID "gameCanvas" not found.');
    return;
  }

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = '-1'; // Ensure canvas is behind HTML menu
  canvas.style.display = 'block';

  const game = new Game(canvas); // Instantiate Game first
  const mainMenu = new MainMenu(game); // Pass game instance to MainMenu

  // Now pass UI panels to game after they are instantiated
  game.setMainMenu(mainMenu);

  // Initial state setup
  game.setState('MAIN_MENU');
  Logger.info('[main.ts] Initial state set to MAIN_MENU');

  await game.init();
  Logger.info('[main.ts] Game assets loaded');

  // Ensure manifest is loaded before CharacterSelectPanel is instantiated
  await game.assetLoader.loadManifest();

  // Instantiate CharacterSelectPanel after assets are loaded
  const characterSelectPanel = new CharacterSelectPanel();
  game.setCharacterSelectPanel(characterSelectPanel);

  // Instantiate UpgradePanel after player is initialized
  import('./ui/UpgradePanel').then(({ UpgradePanel }) => {
    const upgradePanel = new UpgradePanel(game.player, game);
    game.setUpgradePanel(upgradePanel);
    Logger.info('[main.ts] UpgradePanel instantiated and set.');
  });

  // Start background music immediately after game initialization
  import('./game/SoundManager').then(({ SoundManager }) => {
    SoundManager.playMusic('assets/music/bg-music.mp3');
  });

  game.start();
  Logger.info('[main.ts] Game loop started');

  mainMenu.show(); // Show the main menu initially
  Logger.info('[main.ts] Main menu shown');

  // --- Sound Settings Panel & Music ---
  import('./ui/SoundSettingsPanel').then(({ SoundSettingsPanel }) => {
    const soundPanel = new SoundSettingsPanel();
    soundPanel.show();
    Logger.info('[main.ts] SoundSettingsPanel shown');
  });
  // Hudba se spustí až po startu hry (po interakci uživatele)
  let musicStarted = false;
  function startMusic() {
    if (musicStarted) return;
    import('./game/SoundManager').then(({ SoundManager }) => {
      SoundManager.playMusic('/assets/music/bg-music.mp3');
      Logger.info('[main.ts] Background music started');
      musicStarted = true;
    });
  }

  window.addEventListener('startGame', (event: Event) => {
  startMusic(); // Spustit hudbu po startu hry
    const customEvent = event as CustomEvent;
    const selectedCharData = customEvent.detail;
    Logger.info('[main.ts] startGame event received, selectedCharData:', selectedCharData);
    game.resetGame(selectedCharData); // Reset game with selected character
    mainMenu.hide();
    Logger.info('[main.ts] Main menu hidden, starting cinematic and game');
    // Ensure canvas is visible and on top
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
    game.startCinematicAndGame(); // Start cinematic and then game
  });

  window.addEventListener('showCharacterSelect', () => {
    Logger.info('[main.ts] showCharacterSelect event received');
    mainMenu.hide();
    characterSelectPanel.show();
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });

  window.addEventListener('showMainMenu', () => {
    Logger.info('[main.ts] showMainMenu event received');
    characterSelectPanel.hide(); // Hide character select if coming from there
    mainMenu.show();
    canvas.style.zIndex = '-1';
  });

  window.addEventListener('backToMenu', () => {
    Logger.info('[main.ts] backToMenu event received');
    characterSelectPanel.hide();
    mainMenu.show();
    canvas.style.zIndex = '-1';
  });

  window.addEventListener('pauseGame', () => {
    Logger.info('[main.ts] pauseGame event received');
    game.pause();
  });

  window.addEventListener('resumeGame', () => {
    Logger.info('[main.ts] resumeGame event received');
    game.resume();
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });

  // Show upgrade panel on player level up
  window.addEventListener('levelup', () => {
    Logger.info('[main.ts] levelup event received, dispatching showUpgradePanel');
    window.dispatchEvent(new CustomEvent('showUpgradePanel'));
    canvas.style.display = 'block';
    canvas.style.zIndex = '10';
  });
  // Matrix background now managed by MatrixBackground singleton (auto on show/hide)
};

window.onresize = () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
};
