export type KeyState = { [key: string]: boolean };

export const keyState: KeyState = {};

export const mouseState = { x: 0, y: 0, down: false };

window.addEventListener('keydown', (e) => {
  keyState[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
  keyState[e.key.toLowerCase()] = false;
});

window.addEventListener('mousemove', (e) => {
  mouseState.x = e.clientX;
  mouseState.y = e.clientY;
});
window.addEventListener('mousedown', () => (mouseState.down = true));
window.addEventListener('mouseup', () => (mouseState.down = false));
