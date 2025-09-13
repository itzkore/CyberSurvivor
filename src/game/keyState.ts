export type KeyState = { [key: string]: boolean };

export const keyState: KeyState = {};

// Mouse state now tracks individual buttons while preserving the legacy 'down' flag (any button pressed)
export const mouseState = { x: 0, y: 0, down: false, left: false, right: false, middle: false, buttons: 0 } as {
  x: number;
  y: number;
  down: boolean;      // any button pressed
  left: boolean;      // primary (usually LMB)
  right: boolean;     // secondary (usually RMB)
  middle: boolean;    // MMB
  buttons: number;    // bitmask from Pointer/MouseEvent.buttons
};

// WHAT: Guard browser-specific event bindings.
// WHY: Allows importing this module in Node test environment (Vitest) without ReferenceError.
if (typeof window !== 'undefined' && window.addEventListener) {
  // Make mouseState globally accessible
  (window as any).mouseState = mouseState;
  
  window.addEventListener('keydown', (e) => {
    keyState[e.key.toLowerCase()] = true;
  });
  window.addEventListener('keyup', (e) => {
    keyState[e.key.toLowerCase()] = false;
  });
  window.addEventListener('mousemove', (e) => {
    mouseState.x = e.clientX;
    mouseState.y = e.clientY;
    // Update from buttons bitmask when available (helps during drag)
    if (typeof (e as any).buttons === 'number') {
      mouseState.buttons = (e as any).buttons >>> 0;
      mouseState.left = !!(mouseState.buttons & 1);
      mouseState.right = !!(mouseState.buttons & 2);
      mouseState.middle = !!(mouseState.buttons & 4);
      mouseState.down = mouseState.buttons !== 0;
    }
  });
  window.addEventListener('mousedown', (e) => {
    // buttons: bit 0=LMB, 1=RMB, 2=MMB
    mouseState.buttons = typeof (e as any).buttons === 'number' ? (e as any).buttons >>> 0 : (mouseState.buttons | (1 << (e.button || 0)));
    if (e.button === 0) mouseState.left = true;
    if (e.button === 1) mouseState.middle = true;
    if (e.button === 2) mouseState.right = true;
    mouseState.down = mouseState.buttons !== 0 || mouseState.left || mouseState.right || mouseState.middle;
  });
  window.addEventListener('mouseup', (e) => {
    // Clear corresponding button bit and flags
    if (typeof (e as any).buttons === 'number') {
      mouseState.buttons = (e as any).buttons >>> 0;
    } else {
      // best-effort: toggle off bit using button index
      mouseState.buttons = mouseState.buttons & ~(1 << (e.button || 0));
    }
    if (e.button === 0) mouseState.left = false;
    if (e.button === 1) mouseState.middle = false;
    if (e.button === 2) mouseState.right = false;
    mouseState.down = mouseState.buttons !== 0 || mouseState.left || mouseState.right || mouseState.middle;
  });
  // Disable native context menu so RMB works during gameplay
  window.addEventListener('contextmenu', (e) => {
    try { e.preventDefault(); } catch {}
  });
}
