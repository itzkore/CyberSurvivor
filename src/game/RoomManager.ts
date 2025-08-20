import { Logger } from '../core/Logger';

export interface Room {
  id: number;
  x: number; // world space top-left
  y: number;
  w: number;
  h: number;
  doors: { x: number; y: number; }[];
  biomeTag?: string;
}

/**
 * RoomManager: generates lightweight axis-aligned rectangular "rooms" in the open world,
 * giving structure for future spawning, loot, or biome pockets.
 */
export class RoomManager {
  private rooms: Room[] = [];
  private worldW: number;
  private worldH: number;
  private rngSeed: number;
  private quad: number = 0; // rotate quadrant preference to spread distribution

  constructor(worldW: number, worldH: number, seed: number = Date.now()) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.rngSeed = seed & 0x7fffffff;
  }

  public getRooms() { return this.rooms; }

  /** Deterministic LCG for reproducible layout */
  private rand(): number {
    this.rngSeed = (this.rngSeed * 1664525 + 1013904223) & 0xffffffff;
    return (this.rngSeed >>> 0) / 0xffffffff;
  }

  public generate(targetCount: number = 32) {
    this.rooms.length = 0;
    const maxAttempts = targetCount * 25;
    let attempts = 0;
    while (this.rooms.length < targetCount && attempts < maxAttempts) {
      attempts++;
      // Size tiers
      const baseSize = 280 + this.rand()*420; // 280..700
      const aspect = 0.55 + this.rand()*0.9; // vary width/height
      let w = Math.round(baseSize * aspect);
      let h = Math.round(baseSize / aspect);
      // Clamp
      w = Math.max(180, Math.min(900, w));
      h = Math.max(180, Math.min(900, h));
      // Position biased to current quadrant to pseudo-cluster, rotating quadrants
      const q = this.quad % 4;
      const qx = (q === 0 || q === 3) ? 0.08 + this.rand()*0.42 : 0.5 + this.rand()*0.42;
      const qy = (q === 0 || q === 1) ? 0.08 + this.rand()*0.42 : 0.5 + this.rand()*0.42;
      const x = Math.round(qx * (this.worldW - w - 400)) + 200; // margin from edges
      const y = Math.round(qy * (this.worldH - h - 400)) + 200;
      // Overlap check with padding
      const padding = 140;
      let overlaps = false;
      for (let i=0;i<this.rooms.length;i++) {
        const r = this.rooms[i];
        if (x < r.x + r.w + padding && x + w + padding > r.x && y < r.y + r.h + padding && y + h + padding > r.y) {
          overlaps = true; break;
        }
      }
      if (overlaps) continue;
      const id = this.rooms.length;
      const room: Room = { id, x, y, w, h, doors: [] };
      this.generateDoors(room);
      this.rooms.push(room);
      this.quad++;
    }
    Logger.info(`[RoomManager] Generated ${this.rooms.length} rooms (attempts=${attempts}).`);
  }

  private generateDoors(room: Room) {
    // Simple: one door midpoint each side (could later prune or randomize)
    const sides = [
      { x: room.x + room.w/2, y: room.y },
      { x: room.x + room.w, y: room.y + room.h/2 },
      { x: room.x + room.w/2, y: room.y + room.h },
      { x: room.x, y: room.y + room.h/2 }
    ];
    for (const s of sides) room.doors.push({ x: Math.round(s.x), y: Math.round(s.y) });
  }

  /** Collision clamp placeholder */
  public constrainPosition(x: number, y: number): { x: number; y: number; } {
    return { x, y };
  }

  /** Draw debug overlay of rooms (fills) */
  public debugDraw(ctx: CanvasRenderingContext2D, camX: number, camY: number, alpha: number = 0.16) {
    ctx.save();
    ctx.lineWidth = 2;
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const sx = r.x - camX;
      const sy = r.y - camY;
      if (sx + r.w < -50 || sy + r.h < -50 || sx > ctx.canvas.width + 50 || sy > ctx.canvas.height + 50) continue;
      ctx.fillStyle = `rgba(0,179,163,${alpha})`;
      ctx.strokeStyle = 'rgba(38,255,233,0.55)';
      ctx.fillRect(sx, sy, r.w, r.h);
      ctx.strokeRect(sx+0.5, sy+0.5, r.w-1, r.h-1);
      // Doors
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      for (const d of r.doors) {
        ctx.fillRect(d.x - camX - 4, d.y - camY - 4, 8, 8);
      }
    }
    ctx.restore();
  }
}
