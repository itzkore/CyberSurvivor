// Preload script
// WHAT: Exposes a minimal, read-only API to the renderer while keeping Node.js isolated.
// WHY: Limits the attack surface (no direct access to powerful Electron/Node APIs) and
//      provides a controlled bridge for future safe additions.

const { contextBridge } = require('electron');

// Frozen empty object now; extend intentionally via explicit keys.
// Pattern: keep surface tiny; add methods only when a renderer feature truly needs them.
const api = Object.freeze({
	meta: Object.freeze({ version: '1.0.0', features: [] }),
	/**
	 * Returns a small tuple with environment hints (safe – static strings only).
	 * WHY: Example of exposing data without leaking process internals.
	 */
	getEnvInfo: () => ({
		mode: process.env.NODE_ENV || 'production'
	})
});

// Expose under a namespaced key to avoid polluting global scope.
try {
	contextBridge.exposeInMainWorld('cs', api);
} catch (e) {
	// In very old Electron versions without contextIsolation this could throw;
	// we silently ignore because security relies on contextIsolation being true.
}
