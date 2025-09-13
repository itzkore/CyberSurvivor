export function screenToWorld(sx: number, sy: number, camX: number, camY: number) {
  return { x: sx + camX, y: sy + camY };
}

export function worldToScreen(wx: number, wy: number, camX: number, camY: number) {
  return { x: wx - camX, y: wy - camY };
}
