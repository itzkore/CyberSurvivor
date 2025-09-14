// DEPRECATED: Legacy Codex has been removed in favor of React Codex v2 (src/features/codex)
// This stub intentionally throws if instantiated. Do not import from this file.
// Use window.dispatchEvent(new CustomEvent('showCodex', { detail: { tab: 'operatives' } })) to open Codex v2.

export class Codex {
  constructor() {
    throw new Error('[Legacy Codex] Removed. Use Codex v2 (src/features/codex).');
  }
  show(): never {
    throw new Error('[Legacy Codex] Removed. Use Codex v2 (src/features/codex).');
  }
  hide(): never {
    throw new Error('[Legacy Codex] Removed. Use Codex v2 (src/features/codex).');
  }
}

export default Codex;
