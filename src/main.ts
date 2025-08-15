// Entry point for the game
import { Game } from './game/Game';
import { MainMenu } from './ui/MainMenu'; // Import MainMenu

window.onload = async () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (!canvas) {
    console.error('Canvas element with ID "gameCanvas" not found.');
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

  // Now pass mainMenu to game after it's instantiated
  game.setMainMenu(mainMenu);

  await game.init();

  game.start();

  mainMenu.show(); // Show the main menu initially

  window.addEventListener('startGame', (event: CustomEvent) => {
    const selectedCharData = event.detail;
    game.resetGame(selectedCharData); // Reset game with selected character
    mainMenu.hide();
    game.startCinematicAndGame(); // Start cinematic and then game
  });

  window.addEventListener('showCharacterSelect', () => {
    mainMenu.hide();
    game.showCharacterSelect();
  });
};

window.onresize = () => {
  const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
};
