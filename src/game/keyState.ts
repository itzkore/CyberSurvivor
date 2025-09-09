export type KeyState = { [key: string]: boolean };

export const keyState: KeyState = {};

export const mouseState = { x: 0, y: 0, down: false };

// WHAT: Guard browser-specific event bindings.
// WHY: Allows importing this module in Node test environment (Vitest) without ReferenceError.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('keydown', (e) => {
    keyState[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', (e) => {
    keyState[e.key.toLowerCase()] = false;
  });
  window.addEventListener('mousemove', (e) => {
    mouseState.x = e.clientX;
    mouseState.y = e.clientY;
  try { (window as any).__mouseX = e.clientX; (window as any).__mouseY = e.clientY; } catch {}
  });
  window.addEventListener('mousedown', (e) => { mouseState.down = true; if (e.button === 2) { try { (window as any).__mouseRightDown = true; } catch {} } });
  window.addEventListener('mouseup', (e) => { mouseState.down = false; if (e.button === 2) { try { (window as any).__mouseRightDown = false; } catch {} } });
  window.addEventListener('contextmenu', (e) => { // prevent default right-click menu for game canvas
    const el = e.target as HTMLElement | null;
    if (el && el.tagName === 'CANVAS') { e.preventDefault(); }
  });
}
