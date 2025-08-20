import { Logger } from '../core/Logger';

export interface Room {
  id: number;
  x: number; // world space top-left
  y: number;
  w: number;
  h: number;
  doors: { x: number; y: number; }[];
  biomeTag?: string; // simple biome label (local pocket accent)
  visited?: boolean; // player has entered this room
  doorRects?: { x: number; y: number; w: number; h: number; }[]; // cached doorway interior opening rectangles
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
  private corridors: { x: number; y: number; w: number; h: number; }[] = []; // axis-aligned corridor rectangles
  private deadEnds: { x: number; y: number; w: number; h: number; }[] = [];
  private lastPlayerRoomId: number = -1;
  private enforceCollision: boolean = true; // toggle-able if needed
  private wallThickness = 26; // thinner walls for more interior space
  private doorWidth = 0; // deprecated (doors removed)
  private hallWidth = 180; // wider corridors for freer movement
  private overlayBuffer?: HTMLCanvasElement; // viewport-sized buffer for unified tint
  private overlayBufW: number = 0;
  private overlayBufH: number = 0;
  private openWorld: boolean = false; // when true (Showdown) everything is walkable

  constructor(worldW: number, worldH: number, seed: number = Date.now()) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.rngSeed = seed & 0x7fffffff;
  }

  /** Clear all structural data (used for SHOWDOWN open-field mode). */
  public clear() {
    this.rooms.length = 0;
    this.corridors.length = 0;
    this.deadEnds.length = 0;
  }

  /** Enable/disable open world (no structure, all walkable). */
  public setOpenWorld(on: boolean) { this.openWorld = on; }

  public getRooms() { return this.rooms; }
  public getCorridors() { return this.corridors; }
  public setCollisionEnabled(on: boolean) { this.enforceCollision = on; }
  public getLastPlayerRoomId() { return this.lastPlayerRoomId; }
  /** Project arbitrary point into nearest walkable interior (used when we lack previous position). */
  public clampToWalkable(x: number, y: number, radius: number): { x: number; y: number; } {
    if (this.isWalkable(x, y, radius)) return { x, y };
    let bestX = x, bestY = y, bestD = Infinity;
    const rRad = radius;
    // Consider each room interior rect
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const ix1 = r.x + this.wallThickness + rRad;
      const iy1 = r.y + this.wallThickness + rRad;
      const ix2 = r.x + r.w - this.wallThickness - rRad;
      const iy2 = r.y + r.h - this.wallThickness - rRad;
      if (ix2 <= ix1 || iy2 <= iy1) continue;
      const cx = Math.max(ix1, Math.min(x, ix2));
      const cy = Math.max(iy1, Math.min(y, iy2));
      const dx = cx - x; const dy = cy - y; const d = dx*dx + dy*dy;
      if (d < bestD) { bestD = d; bestX = cx; bestY = cy; }
      // Door openings
      if (r.doorRects) {
        for (let dIdx=0; dIdx<r.doorRects.length; dIdx++) {
          const dr = r.doorRects[dIdx];
            const cx2 = Math.max(dr.x + rRad, Math.min(x, dr.x + dr.w - rRad));
            const cy2 = Math.max(dr.y + rRad, Math.min(y, dr.y + dr.h - rRad));
            const dx2 = cx2 - x; const dy2 = cy2 - y; const d2 = dx2*dx2 + dy2*dy2;
            if (d2 < bestD) { bestD = d2; bestX = cx2; bestY = cy2; }
        }
      }
    }
    // Corridors
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      const cx = Math.max(c.x + rRad, Math.min(x, c.x + c.w - rRad));
      const cy = Math.max(c.y + rRad, Math.min(y, c.y + c.h - rRad));
      const dx = cx - x; const dy = cy - y; const d = dx*dx + dy*dy;
      if (d < bestD) { bestD = d; bestX = cx; bestY = cy; }
    }
    // Dead ends
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      const cx = Math.max(c.x + rRad, Math.min(x, c.x + c.w - rRad));
      const cy = Math.max(c.y + rRad, Math.min(y, c.y + c.h - rRad));
      const dx = cx - x; const dy = cy - y; const d = dx*dx + dy*dy;
      if (d < bestD) { bestD = d; bestX = cx; bestY = cy; }
    }
    return { x: bestX, y: bestY };
  }

  /** Deterministic LCG for reproducible layout */
  private rand(): number {
    this.rngSeed = (this.rngSeed * 1664525 + 1013904223) & 0xffffffff;
    return (this.rngSeed >>> 0) / 0xffffffff;
  }

  public generate(targetCount: number = 32) {
    this.rooms.length = 0;
  this.corridors.length = 0;
  this.deadEnds.length = 0;
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
      const room: Room = { id, x, y, w, h, doors: [], visited: false };
      this.generateDoors(room);
      // Assign a lightweight biome pocket tag (alternate for variety)
      room.biomeTag = (id % 2 === 0) ? 'neon' : 'waste';
      this.rooms.push(room);
      this.quad++;
    }
  // Ensure a central spawn room exists then build corridors
  this.ensureCentralRoom();
  // Add dead-end branches for exploration flavor
  this.generateDeadEnds(6);
    Logger.info(`[RoomManager] Generated ${this.rooms.length} rooms (attempts=${attempts}).`);
  }

  private generateDoors(room: Room) {
    // Provide logical side midpoints as anchor points (used for corridor + dead-end direction), but omit physical doorRects.
    room.doors = [
      { x: room.x + room.w/2, y: room.y },
      { x: room.x + room.w, y: room.y + room.h/2 },
      { x: room.x + room.w/2, y: room.y + room.h },
      { x: room.x, y: room.y + room.h/2 }
    ].map(d => ({ x: Math.round(d.x), y: Math.round(d.y) }));
    room.doorRects = [];
  }

  /** Returns room containing point or null */
  public getRoomAt(x: number, y: number): Room | null {
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  /** Track player position, mark visited + dispatch biome enter event */
  public trackPlayer(x: number, y: number) {
  if (this.openWorld) return; // no room events in open mode
    const room = this.getRoomAt(x, y);
    if (room && room.id !== this.lastPlayerRoomId) {
      this.lastPlayerRoomId = room.id;
      if (!room.visited) room.visited = true;
      try { window.dispatchEvent(new CustomEvent('roomEnter', { detail: { roomId: room.id, biomeTag: room.biomeTag } })); } catch {}
    }
  }

  /** Collision clamp: if destination outside any room/corridor keep previous position */
  public constrainPosition(prevX: number, prevY: number, nextX: number, nextY: number, radius: number): { x: number; y: number; } {
  if (this.openWorld) return { x: nextX, y: nextY }; // no constraints
    if (!this.enforceCollision) return { x: nextX, y: nextY };
    if (this.isWalkable(nextX, nextY, radius)) return { x: nextX, y: nextY };
    // Try axis-wise resolution (allow sliding along edges)
    if (this.isWalkable(nextX, prevY, radius)) return { x: nextX, y: prevY };
    if (this.isWalkable(prevX, nextY, radius)) return { x: prevX, y: nextY };
    return { x: prevX, y: prevY }; // revert fully
  }

  private isWalkable(x: number, y: number, radius: number): boolean {
  if (this.openWorld) return true;
    const rRad = radius;
    // Rooms (interior minus wall thickness OR inside door opening strip)
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const wx = r.x + this.wallThickness + rRad;
      const wy = r.y + this.wallThickness + rRad;
      const ww = r.x + r.w - this.wallThickness - rRad;
      const wh = r.y + r.h - this.wallThickness - rRad;
      if (x >= wx && x <= ww && y >= wy && y <= wh) return true;
      // With doors removed, allow hugging outer band by permitting positions inside full bounds minus radius
      if (x >= r.x + rRad && x <= r.x + r.w - rRad && y >= r.y + rRad && y <= r.y + r.h - rRad) return true;
    }
    // Corridors (treat entire rectangle minus radius margin)
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      if (x >= c.x + rRad && x <= c.x + c.w - rRad && y >= c.y + rRad && y <= c.y + c.h - rRad) return true;
    }
    // Dead ends
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      if (x >= c.x + rRad && x <= c.x + c.w - rRad && y >= c.y + rRad && y <= c.y + c.h - rRad) return true;
    }
    return false;
  }

  /** Farthest (optionally unvisited) room center from a point */
  public getFarthestRoom(px: number, py: number, preferUnvisited: boolean = true): Room | null {
    let best: Room | null = null;
    let bestD = -1;
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      if (preferUnvisited && r.visited) continue;
      const cx = r.x + r.w/2;
      const cy = r.y + r.h/2;
      const dx = cx - px; const dy = cy - py;
      const d = dx*dx + dy*dy;
      if (d > bestD) { bestD = d; best = r; }
    }
    if (!best && preferUnvisited) return this.getFarthestRoom(px, py, false);
    return best;
  }

  private generateCorridors() {
    if (this.rooms.length < 2) return;
    const connected: Set<number> = new Set([0]);
    const remaining: Set<number> = new Set();
    for (let i=1;i<this.rooms.length;i++) remaining.add(i);
    while (remaining.size) {
      let bestA=-1,bestB=-1; let bestD=Infinity; let bestDoorA: any=null; let bestDoorB: any=null;
      connected.forEach(aIdx => {
        remaining.forEach(bIdx => {
          const a = this.rooms[aIdx];
          const b = this.rooms[bIdx];
          for (let da=0; da<a.doors.length; da++) {
            for (let db=0; db<b.doors.length; db++) {
              const dA = a.doors[da]; const dB = b.doors[db];
              const dx = dA.x - dB.x; const dy = dA.y - dB.y;
              const dist = dx*dx + dy*dy;
              if (dist < bestD) { bestD = dist; bestA = aIdx; bestB = bIdx; bestDoorA = dA; bestDoorB = dB; }
            }
          }
        });
      });
      if (bestA === -1) break;
      // Build corridor rectangles from bestDoorA to bestDoorB using L shape
      const width = this.hallWidth;
      const ax = bestDoorA.x, ay = bestDoorA.y;
      const bx = bestDoorB.x, by = bestDoorB.y;
      // Horizontal then vertical (choose order to minimize overlap with rooms maybe later)
      const hx = Math.min(ax, bx);
      const hy = ay - width/2;
      const hw = Math.abs(bx - ax);
      if (hw > 0) {
        // Extend horizontal segment slightly into both rooms for seamless junction
        const ext = this.wallThickness * 1.2;
        const segX = hx - ext;
        const segW = hw + ext * 2;
        this.corridors.push({ x: segX, y: hy - 2, w: segW, h: width + 4 });
      }
      const vx = bx - width/2;
      const vy = Math.min(ay, by);
      const vh = Math.abs(by - ay);
      if (vh > 0) {
        const ext = this.wallThickness * 1.2;
        const segY = vy - ext;
        const segH = vh + ext * 2;
        this.corridors.push({ x: vx - 2, y: segY, w: width + 4, h: segH });
      }
      connected.add(bestB); remaining.delete(bestB);
    }
    // Slightly inflate corridors so they blend into room interiors (removes perceived wall at junction)
    const inflate = this.wallThickness; // use wall thickness for overlap guarantee
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      c.x -= inflate; c.y -= inflate; c.w += inflate*2; c.h += inflate*2;
    }
  // After corridors created, integrate their overlaps as widened door openings
  this.integrateCorridorOverlaps();
  }

  private generateDeadEnds(count: number) {
    if (!this.rooms.length) return;
    for (let i=0;i<count;i++) {
      const baseRoom = this.rooms[(Math.random()*this.rooms.length)|0];
      if (!baseRoom) continue;
      // Pick one door orientation for direction vector
      const doorIdx = (Math.random()*baseRoom.doors.length)|0;
      const d = baseRoom.doors[doorIdx];
      const cx = baseRoom.x + baseRoom.w/2;
      const cy = baseRoom.y + baseRoom.h/2;
      let dirX = 0, dirY = 0;
      if (Math.abs(d.x - baseRoom.x) < 4) dirX = -1; // left
      else if (Math.abs(d.x - (baseRoom.x + baseRoom.w)) < 4) dirX = 1; // right
      else if (Math.abs(d.y - baseRoom.y) < 4) dirY = -1; // top
      else dirY = 1; // bottom
      const len = 500 + Math.random()*700;
      const w = this.hallWidth;
      const startX = d.x - (dirY !== 0 ? w/2 : 0);
      const startY = d.y - (dirX !== 0 ? w/2 : 0);
      const rect = {
        x: Math.round(startX + (dirX<0? -len:0)),
        y: Math.round(startY + (dirY<0? -len:0)),
        w: Math.round(dirX !== 0 ? len : w),
        h: Math.round(dirY !== 0 ? len : w)
      };
      // Push only if within world bounds
      if (rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= this.worldW && rect.y + rect.h <= this.worldH) {
  // Inflate dead-end for smoother entry
  rect.x -= this.wallThickness; rect.y -= this.wallThickness;
  rect.w += this.wallThickness*2; rect.h += this.wallThickness*2;
  this.deadEnds.push(rect);
      }
    }
  // Dead ends may also overlap room walls; integrate openings
  this.integrateCorridorOverlaps();
  }

  private ensureCentralRoom() {
    const cx = this.worldW / 2;
    const cy = this.worldH / 2;
    let has = false;
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) { has = true; break; }
    }
    if (!has) {
      const size = 620;
      const x = Math.round(cx - size/2);
      const y = Math.round(cy - size/2);
      const room: Room = { id: this.rooms.length, x, y, w: size, h: size, doors: [], biomeTag: 'neon', visited: false };
      this.generateDoors(room);
      this.rooms.push(room);
    }
    // Rebuild corridors including possible new central room
    this.corridors.length = 0;
    this.generateCorridors();
  }

  /** Create additional doorway rectangles where corridor/deadEnd rectangles overlap room outer wall band, widening passage to avoid cross-wall collisions */
  private integrateCorridorOverlaps() {
    const passages = [...this.corridors, ...this.deadEnds];
    if (!passages.length) return;
    const t = this.wallThickness;
    for (let rIdx=0; rIdx<this.rooms.length; rIdx++) {
      const room = this.rooms[rIdx];
      if (!room.doorRects) room.doorRects = [];
      const rx1 = room.x, ry1 = room.y, rx2 = room.x + room.w, ry2 = room.y + room.h;
      for (let pIdx=0; pIdx<passages.length; pIdx++) {
        const p = passages[pIdx];
        const px1 = p.x, py1 = p.y, px2 = p.x + p.w, py2 = p.y + p.h;
        // Overlap test with room bounds
        if (px1 >= rx2 || px2 <= rx1 || py1 >= ry2 || py2 <= ry1) continue;
        // Overlap rectangle
        const ox1 = Math.max(px1, rx1);
        const oy1 = Math.max(py1, ry1);
        const ox2 = Math.min(px2, rx2);
        const oy2 = Math.min(py2, ry2);
        const ow = ox2 - ox1;
        const oh = oy2 - oy1;
        if (ow <= 0 || oh <= 0) continue;
        // Only consider if overlap lies largely within wall band area (touching outer rim)
        const inWallBand = (oy1 < ry1 + t + 2) || (oy2 > ry2 - t - 2) || (ox1 < rx1 + t + 2) || (ox2 > rx2 - t - 2);
        if (!inWallBand) continue;
        // Avoid duplicating near-identical door rects
        let dup = false;
        for (let d=0; d<room.doorRects.length; d++) {
          const dr = room.doorRects[d];
            if (Math.abs(dr.x - ox1) < 4 && Math.abs(dr.y - oy1) < 4 && Math.abs(dr.w - ow) < 4 && Math.abs(dr.h - oh) < 4) { dup = true; break; }
        }
        if (dup) continue;
        room.doorRects.push({ x: Math.round(ox1), y: Math.round(oy1), w: Math.round(ow), h: Math.round(oh) });
      }
    }
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
      // Tint by biome tag
      const tint = r.biomeTag === 'neon' ? '0,179,163' : '0,128,255';
      ctx.fillStyle = `rgba(${tint},${alpha})`;
      ctx.strokeStyle = 'rgba(38,255,233,0.55)';
      ctx.fillRect(sx, sy, r.w, r.h);
      // Outer wall (thicker with doorway gaps)
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.rect(sx+3, sy+3, r.w-6, r.h-6);
      ctx.stroke();
      // Doorway cuts (clear small sections on each side where doors are)
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      if (r.doorRects) {
        for (const dr of r.doorRects) {
          ctx.fillStyle = 'rgba(0,0,0,1)';
          ctx.fillRect(dr.x - camX, dr.y - camY, dr.w, dr.h);
        }
      }
      ctx.restore();
      // Doors
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      for (const d of r.doors) {
        ctx.fillRect(d.x - camX - 4, d.y - camY - 4, 8, 8);
      }
    }
    // Draw corridors
    ctx.strokeStyle = 'rgba(38,255,233,0.35)';
    ctx.fillStyle = 'rgba(0,255,200,0.10)';
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      ctx.fillRect(c.x - camX, c.y - camY, c.w, c.h);
      ctx.strokeRect(c.x - camX + 0.5, c.y - camY + 0.5, c.w -1, c.h -1);
    }
    // Dead ends
    ctx.strokeStyle = 'rgba(255,180,60,0.35)';
    ctx.fillStyle = 'rgba(255,140,0,0.10)';
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      ctx.fillRect(c.x - camX, c.y - camY, c.w, c.h);
      ctx.strokeRect(c.x - camX + 0.5, c.y - camY + 0.5, c.w -1, c.h -1);
    }
    ctx.restore();
  }

  /** Subtle biome overlay (draw even when debug off) */
  public drawBiomeOverlays(ctx: CanvasRenderingContext2D, camX: number, camY: number) {
    const vw = ctx.canvas.width, vh = ctx.canvas.height;
    // Maintain/recreate buffer
    if (!this.overlayBuffer || this.overlayBufW !== vw || this.overlayBufH !== vh) {
      this.overlayBuffer = document.createElement('canvas');
      this.overlayBuffer.width = vw; this.overlayBuffer.height = vh;
      this.overlayBufW = vw; this.overlayBufH = vh;
    }
    const bctx = this.overlayBuffer.getContext('2d')!;
    bctx.clearRect(0,0,vw,vh);
    // 1) Build opaque mask (black) of ALL walkable space (rooms + corridors + dead ends)
    bctx.fillStyle = '#000';
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const sx = r.x - camX; const sy = r.y - camY;
      if (sx + r.w < -50 || sy + r.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      bctx.fillRect(sx, sy, r.w, r.h);
    }
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      const sx = c.x - camX; const sy = c.y - camY;
      if (sx + c.w < -50 || sy + c.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      bctx.fillRect(sx, sy, c.w, c.h);
    }
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      const sx = c.x - camX; const sy = c.y - camY;
      if (sx + c.w < -50 || sy + c.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      bctx.fillRect(sx, sy, c.w, c.h);
    }
    // 2) Uniform tint fill then mask in (no layering possible)
    ctx.save();
    ctx.fillStyle = 'rgba(38,255,233,0.06)'; // tweak alpha subtle
    ctx.fillRect(0,0,vw,vh);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.overlayBuffer,0,0);
    ctx.restore();
  }

  /** Unified walkable visualization: darken outside + uniform tint inside; drawn beneath entities. */
  public drawWalkableUnderlay(ctx: CanvasRenderingContext2D, camX: number, camY: number) {
    const vw = ctx.canvas.width, vh = ctx.canvas.height;
    // Buffers: mask (walkable alpha) + temp
    if (!this.overlayBuffer || this.overlayBufW !== vw || this.overlayBufH !== vh) {
      this.overlayBuffer = document.createElement('canvas');
      this.overlayBuffer.width = vw; this.overlayBuffer.height = vh;
      this.overlayBufW = vw; this.overlayBufH = vh;
    }
    const mask = this.overlayBuffer.getContext('2d')!;
    mask.clearRect(0,0,vw,vh);
    // Build opaque walkable mask (#000 fully opaque shapes)
    mask.fillStyle = '#000';
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const sx = r.x - camX; const sy = r.y - camY;
      if (sx + r.w < -50 || sy + r.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      mask.fillRect(sx, sy, r.w, r.h);
    }
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      const sx = c.x - camX; const sy = c.y - camY;
      if (sx + c.w < -50 || sy + c.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      mask.fillRect(sx, sy, c.w, c.h);
    }
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      const sx = c.x - camX; const sy = c.y - camY;
      if (sx + c.w < -50 || sy + c.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      mask.fillRect(sx, sy, c.w, c.h);
    }
    // Inverted: tint NON-walkable region; leave walkable fully clear showing background.
    ctx.save();
    ctx.fillStyle = 'rgba(25,35,50,0.70)'; // outside dim veil (uniform)
    ctx.fillRect(0,0,vw,vh);
    // Punch holes where walkable exists
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(this.overlayBuffer,0,0);
    ctx.restore();
    // Optional thin outline pass (low alpha) to subtly delineate edges without layering brightness
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(38,255,233,0.10)';
    ctx.lineWidth = 2;
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const sx = r.x - camX; const sy = r.y - camY;
      if (sx + r.w < -50 || sy + r.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      ctx.strokeRect(sx+1, sy+1, r.w-2, r.h-2);
    }
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      const sx = c.x - camX; const sy = c.y - camY;
      if (sx + c.w < -50 || sy + c.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      ctx.strokeRect(sx+1, sy+1, c.w-2, c.h-2);
    }
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      const sx = c.x - camX; const sy = c.y - camY;
      if (sx + c.w < -50 || sy + c.h < -50 || sx > vw + 50 || sy > vh + 50) continue;
      ctx.strokeRect(sx+1, sy+1, c.w-2, c.h-2);
    }
    ctx.restore();
  }

  /** Darken everything non-walkable so collisions are never invisible */
  public drawWalkableMask(ctx: CanvasRenderingContext2D, camX: number, camY: number) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0,0,ctx.canvas.width, ctx.canvas.height);
    ctx.globalCompositeOperation = 'destination-out';
    // carve rooms
    for (let i=0;i<this.rooms.length;i++) {
      const r = this.rooms[i];
      const sx = r.x - camX; const sy = r.y - camY;
      ctx.fillRect(sx, sy, r.w, r.h);
    }
    // carve corridors & dead ends
    for (let i=0;i<this.corridors.length;i++) {
      const c = this.corridors[i];
      ctx.fillRect(c.x - camX, c.y - camY, c.w, c.h);
    }
    for (let i=0;i<this.deadEnds.length;i++) {
      const c = this.deadEnds[i];
      ctx.fillRect(c.x - camX, c.y - camY, c.w, c.h);
    }
    ctx.restore();
  }
}
