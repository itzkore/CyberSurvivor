import { describe, it, expect } from 'vitest';
import { RoomManager } from '../src/game/RoomManager';

describe('unstick: clampToWalkable around core blocker', () => {
  it('projects a point from inside a solid core blocker to a walkable corridor', () => {
    const rm = new RoomManager(4000, 3000, 123);
    rm.generate(8);
    // Build a straight corridor across middle
    const corY = Math.floor(3000/2 - 180/2);
    const cor = { x: 200, y: corY, w: 3600, h: 180 };
    // @ts-ignore - reach into private for deterministic test via public helper
    rm.getCorridors().push(cor);
    // Place a circular core approximated by a solid square blocker at corridor center
    const core = { x: 1200, y: cor.y + 90, r: 60 };
    rm.addBlockRects([{ x: core.x - core.r, y: core.y - core.r, w: core.r*2, h: core.r*2 }]);

    // A point smack in the middle of the core should be reprojected outside the blocker, inside corridor bounds
    const startX = core.x, startY = core.y;
    const radius = 14;
    const p = rm.clampToWalkable(startX, startY, radius, 'player');
    // Should not be overlapping the blocker anymore
    const insideBlocker = (p.x >= core.x - core.r - radius && p.x <= core.x + core.r + radius && p.y >= core.y - core.r - radius && p.y <= core.y + core.r + radius);
    expect(insideBlocker).toBe(false);
    // And should be within corridor interior (minus radius padding)
    expect(p.y).toBeGreaterThanOrEqual(cor.y + radius);
    expect(p.y).toBeLessThanOrEqual(cor.y + cor.h - radius);
  });
});
