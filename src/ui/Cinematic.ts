export class Cinematic {
  private progress: number = 0;
  private active: boolean = false;
  private onComplete: (() => void) | null = null;
  private duration: number = 900; // 15 seconds at 60fps

  /**
   * Returns true if the cinematic is finished.
   */
  public isFinished(): boolean {
    return !this.active;
  }

  /**
   * Advances the cinematic progress and calls onComplete if finished.
   */
  public update() {
    if (!this.active) return;
    this.progress++;
    if (this.progress > this.duration) {
      this.active = false;
      if (this.onComplete) this.onComplete();
    }
  }

  public start(onComplete: () => void) {
    this.progress = 0;
    this.active = true;
    this.onComplete = onComplete;
  }

  public draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    if (!this.active) return;
    ctx.save();
    // Fade in/out effect
    let alpha = 1;
    if (this.progress < 60) {
      alpha = this.progress / 60;
    } else if (this.progress > this.duration - 60) {
      alpha = 1 - (this.progress - (this.duration - 60)) / 60;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';

    // Epic intro sequence
    if (this.progress < 180) {
      ctx.font = 'bold 54px Orbitron, sans-serif';
      ctx.fillStyle = '#0ff';
      ctx.shadowColor = '#00f6ff';
      ctx.shadowBlur = 24;
      ctx.fillText('CYBER SURVIVOR', canvas.width / 2, canvas.height / 2 - 40);
      ctx.font = '28px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('A Neon Roguelike Experience', canvas.width / 2, canvas.height / 2 + 30);
    } else if (this.progress < 420) {
      ctx.font = 'bold 42px Orbitron, sans-serif';
      ctx.fillStyle = '#ff00cc';
      ctx.shadowColor = '#ff00cc';
      ctx.shadowBlur = 18;
      ctx.fillText('In the year 2088...', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '24px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('Mega-cities are ruled by rogue AIs.', canvas.width / 2, canvas.height / 2 + 30);
    } else if (this.progress < 660) {
      ctx.font = 'bold 42px Orbitron, sans-serif';
      ctx.fillStyle = '#00ffea';
      ctx.shadowColor = '#00ffea';
      ctx.shadowBlur = 18;
      ctx.fillText('You are the last survivor...', canvas.width / 2, canvas.height / 2 - 20);
      ctx.font = '24px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('Fight through endless waves of enemies.', canvas.width / 2, canvas.height / 2 + 30);
    } else {
      ctx.font = 'bold 48px Orbitron, sans-serif';
      ctx.fillStyle = '#0ff';
      ctx.shadowColor = '#00f6ff';
      ctx.shadowBlur = 24;
      ctx.fillText('Survive the Neon Onslaught!', canvas.width / 2, canvas.height / 2);
      ctx.font = '24px Orbitron, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.shadowBlur = 0;
      ctx.fillText('Good luck...', canvas.width / 2, canvas.height / 2 + 60);
    }
    ctx.restore();
  }
}
