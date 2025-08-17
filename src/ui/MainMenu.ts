import { Logger } from '../core/Logger';

export class MainMenu {
  private mainMenuElement: HTMLElement | null;
  private startGameButton: HTMLButtonElement | null;
  private characterSelectButton: HTMLButtonElement | null;
  private gameInstance: any; // Reference to the Game instance
  private matrixDrops?: number[]; // Array to manage the falling characters
  private _matrixChars?: string[]; // Preallocated array for matrix characters

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
        Logger.debug('Character Select button clicked');
        // Always hide HTML character select panel if present
        const htmlCharPanel = document.getElementById('character-select-panel');
        if (htmlCharPanel) htmlCharPanel.style.display = 'none';
        window.dispatchEvent(new CustomEvent('showCharacterSelect'));
      });
    }

    this.updateStartButtonState(); // Initial state update

    // Listen for character selection to update the start button
    window.addEventListener('characterSelected', (event: Event) => {
      const customEvent = event as CustomEvent;
      this.gameInstance.selectedCharacterData = customEvent.detail;
      this.updateStartButtonState();
    });
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

  /**
   * Public getter for mainMenuElement to allow external access.
   */
  public getMainMenuElement(): HTMLElement | null {
    return this.mainMenuElement;
  }

  /**
   * Draws the animated matrix background effect on the main menu canvas.
   * Slower, smoother, and glitchy: slow drops, random glitch columns, color flicker.
   * @param ctx Canvas 2D context
   * @param canvas Canvas element
   */
  drawMatrixBackground(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    // Matrix effect parameters
    const fontSize = 32;
    const columns = Math.floor(canvas.width / fontSize);
    // Preallocate drops array only once per resize
    if (!this.matrixDrops || this.matrixDrops.length !== columns) {
      this.matrixDrops = new Array(columns);
      for (let i = 0; i < columns; i++) this.matrixDrops[i] = 1;
    }
    // Force solid black background first
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Semi-transparent trail for smoothness
    ctx.fillStyle = 'rgba(0,32,48,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = fontSize + 'px monospace';
    // Use a preallocated array for chars
    if (!this._matrixChars || this._matrixChars.length !== columns) {
      this._matrixChars = new Array(columns);
    }
    for (let i = 0; i < columns; i++) {
      // Glitch effect: random columns flicker and change color/char rapidly
      let isGlitch = Math.random() < 0.08;
      if (isGlitch) {
        ctx.fillStyle = Math.random() < 0.5 ? '#00eaff' : '#fff'; // cyan or white flicker
        this._matrixChars[i] = String.fromCharCode(0x30A0 + (Math.random() * 96) | 0);
      } else {
        ctx.fillStyle = '#00eaff';
        if (!this._matrixChars[i] || this.matrixDrops[i] % 18 === 0) {
          this._matrixChars[i] = String.fromCharCode(0x30A0 + (Math.random() * 96) | 0);
        }
      }
      ctx.fillText(this._matrixChars[i], i * fontSize, this.matrixDrops[i] * fontSize);
      // Slow down drop speed for smoothness
      if (this.matrixDrops[i] * fontSize > canvas.height && Math.random() > 0.99) {
        this.matrixDrops[i] = 0;
      }
      // Move drops much slower
      this.matrixDrops[i] += isGlitch ? 1.5 : 0.25;
    }
  }
}
