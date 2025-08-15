export class MainMenu {
  private mainMenuElement: HTMLElement | null;
  private startGameButton: HTMLButtonElement | null;
  private characterSelectButton: HTMLButtonElement | null;
  private gameInstance: any; // Reference to the Game instance

  constructor(game: any) {
    this.gameInstance = game;
    this.mainMenuElement = document.getElementById('main-menu');
    this.startGameButton = document.getElementById('start-game-btn') as HTMLButtonElement;
    this.characterSelectButton = document.getElementById('character-select-btn') as HTMLButtonElement;

    if (this.startGameButton) {
      this.startGameButton.addEventListener('click', () => {
        if (this.gameInstance.selectedCharacterData) {
          window.dispatchEvent(new CustomEvent('startGame', { detail: this.gameInstance.selectedCharacterData }));
        } else {
          alert('Please select a character first!');
        }
      });
    }

    if (this.characterSelectButton) {
      this.characterSelectButton.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('showCharacterSelect'));
      });
    }

    this.updateStartButtonState(); // Initial state update
  }

  show() {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'flex'; // Use flex to center content
    }
    this.updateStartButtonState(); // Update state when menu is shown
  }

  hide() {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'none';
    }
  }

  public hideMenuElement() {
    if (this.mainMenuElement) {
      this.mainMenuElement.style.display = 'none';
    }
  }

  updateStartButtonState() {
    if (this.startGameButton) {
      if (this.gameInstance.selectedCharacterData) {
        this.startGameButton.disabled = false;
        this.startGameButton.textContent = `START GAME (${this.gameInstance.selectedCharacterData.name})`;
      } else {
        this.startGameButton.disabled = true;
        this.startGameButton.textContent = 'START GAME (Select Character First)';
      }
    }
  }

  // The draw and update methods are no longer needed for HTML-based menu
  draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // No longer drawing directly to canvas
  }

  update() {
    // No longer updating for HTML-based menu
  }
}
