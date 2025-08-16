// Entry point for the game
import { Game } from './game/Game';
import { MainMenu } from './ui/MainMenu';
import { CharacterSelectPanel } from './ui/CharacterSelectPanel'; // Import CharacterSelectPanel
import { Logger } from './core/Logger'; // Import Logger

window.onload = async () => {
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

  const game = new Game(canvas); // Instantiate Game first
  const mainMenu = new MainMenu(game); // Pass game instance to MainMenu
  const characterSelectPanel = new CharacterSelectPanel(game.assetLoader); // Instantiate CharacterSelectPanel

  // Now pass UI panels to game after they are instantiated
  game.setMainMenu(mainMenu);
  game.setCharacterSelectPanel(characterSelectPanel);

  // Initial state setup
  game.setState('MAIN_MENU');

  await game.init();

  game.start();

  mainMenu.show(); // Show the main menu initially

  window.addEventListener('startGame', (event: Event) => {
    const customEvent = event as CustomEvent;
    const selectedCharData = customEvent.detail;
    Logger.info('startGame event received, selectedCharData:', selectedCharData);
    game.resetGame(selectedCharData); // Reset game with selected character
    mainMenu.hide();
    Logger.info('Calling game.startCinematicAndGame()');
    game.startCinematicAndGame(); // Start cinematic and then game
  });

  window.addEventListener('showCharacterSelect', () => {
    mainMenu.hide();
    characterSelectPanel.show();
  });

  window.addEventListener('showMainMenu', () => {
    characterSelectPanel.hide(); // Hide character select if coming from there
    mainMenu.show();
  });

  window.addEventListener('pauseGame', () => {
    game.pause();
  });

  window.addEventListener('resumeGame', () => {
    game.resume();
  });

    // Show upgrade panel on player level up
    window.addEventListener('levelup', () => {
      window.dispatchEvent(new CustomEvent('showUpgradePanel'));
    });
  // --- Matrix Background Animation ---
  let matrixActive = true;
  function renderMatrixBackground() {
    const menuEl = mainMenu.getMainMenuElement();
    if (!menuEl || menuEl.style.display === 'none') {
      matrixActive = false;
      return;
    }
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      mainMenu.drawMatrixBackground(ctx, canvas);
    }
    if (matrixActive) {
      requestAnimationFrame(renderMatrixBackground);
    }
  }

  // Start matrix background immediately on load
  renderMatrixBackground();

  // Start matrix background when menu is shown
  mainMenu.show = function() {
    const menuEl = this.getMainMenuElement();
    if (menuEl) {
      menuEl.style.display = 'flex';
    }
    this.updateStartButtonState();
    matrixActive = true;
    renderMatrixBackground();
  };

  // Stop matrix background when game starts
  window.addEventListener('startGame', () => {
    matrixActive = false;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
};

window.onresize = () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
};
