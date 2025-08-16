export class Cinematic {
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
    if (this.progress > 100) {
      this.active = false;
      if (this.onComplete) this.onComplete();
    }
  }
  private progress: number = 0;
  private active: boolean = false;
  private onComplete: (() => void) | null = null;

  public start(onComplete: () => void) {
    this.progress = 0;
    this.active = true;
    this.onComplete = onComplete;
  }

  public draw(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    if (!this.active) return;
    ctx.save();
    ctx.globalAlpha = 1 - this.progress / 100;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.font = 'bold 48px Orbitron, sans-serif';
    ctx.fillStyle = '#0ff';
    ctx.textAlign = 'center';
    ctx.fillText('Welcome to CYBER SURVIVOR', canvas.width / 2, canvas.height / 2);
    ctx.font = '24px Orbitron, sans-serif';
    ctx.fillText('Survive the neon onslaught...', canvas.width / 2, canvas.height / 2 + 60);
    ctx.restore();
    this.progress++;
    if (this.progress > 100) {
      this.active = false;
      if (this.onComplete) this.onComplete();
    }
  }
}
