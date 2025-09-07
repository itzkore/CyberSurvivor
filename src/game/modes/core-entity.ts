/**
 * CoreEntity: stationary defense core for Last Stand mode.
 * - Acts as the enemies' chase target.
 * - When HP reaches 0, the run ends (GAME_OVER).
 */
export class CoreEntity {
  /** World X position (px). */
  public x: number;
  /** World Y position (px). */
  public y: number;
  /** Collision/interaction radius (px). */
  public radius: number;
  /** Current hit points. */
  public hp: number;
  /** Maximum hit points. */
  public maxHp: number;
  /** Spin phase used for rendering decoration (radians). */
  public spin: number = 0;

  constructor(x: number, y: number, radius: number, maxHp: number) {
    this.x = x;
    this.y = y;
    this.radius = Math.max(10, Math.round(radius));
    this.maxHp = Math.max(1, Math.round(maxHp));
    this.hp = this.maxHp;
  }

  /** Apply damage to the core (non-negative). Returns remaining HP. */
  takeDamage(amount: number): number {
    if (!isFinite(amount) || amount <= 0) return this.hp;
    this.hp = Math.max(0, this.hp - Math.round(amount));
    return this.hp;
  }

  /** Returns true when the core has 0 HP. */
  isDestroyed(): boolean { return this.hp <= 0; }
}
