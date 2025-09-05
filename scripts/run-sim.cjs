/* Simple Node wrapper to run the TS sim with CommonJS transpilation */
try {
	console.error('[sim] starting TS runner');
	// Minimal browser-like globals so data modules that touch window/location don't crash at import time
	const g = globalThis;
	if (typeof g.window === 'undefined') g.window = {};
	// Ensure event APIs exist on window for game code
	if (typeof g.window.addEventListener !== 'function') {
		const listeners = new Map();
		g.window.addEventListener = (type, cb) => {
			const arr = listeners.get(type) || []; arr.push(cb); listeners.set(type, arr);
		};
		g.window.removeEventListener = (type, cb) => {
			const arr = listeners.get(type) || []; const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); listeners.set(type, arr);
		};
		g.window.dispatchEvent = (ev) => {
			const type = ev && ev.type; const arr = (type && listeners.get(type)) || []; for (const f of arr) { try { f(ev); } catch (_) {} }
		};
	}
	if (typeof g.location === 'undefined') g.location = { protocol: 'file:', pathname: '/', href: 'file:///' };
	if (typeof g.performance === 'undefined') g.performance = { now: () => Date.now() };
	if (typeof g.requestAnimationFrame === 'undefined') g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
	if (typeof g.cancelAnimationFrame === 'undefined') g.cancelAnimationFrame = (id) => clearTimeout(id);
	if (typeof g.document === 'undefined') {
		const makeNoop2D = () => new Proxy({}, { get: () => () => {}, set: () => true });
		g.document = {
			createElement: (tag) => {
				if (tag === 'canvas') {
					return { width: 0, height: 0, style: {}, getContext: () => makeNoop2D(), toDataURL: () => 'data:' };
				}
				return { style: {} };
			},
			getElementById: () => null,
			body: { appendChild: () => {}, removeChild: () => {} },
			querySelector: () => null,
		};
	}
	if (typeof g.Image === 'undefined') {
		g.Image = function() {
			this.onload = null; this.onerror = null; this.src = '';
			setTimeout(() => { try { this.onload && this.onload(); } catch(_) {} }, 0);
		};
	}
	if (typeof g.Event === 'undefined') { g.Event = function(type){ this.type = type; }; }
	if (typeof g.CustomEvent === 'undefined') { g.CustomEvent = function(type, params){ g.Event.call(this, type); this.detail = params && params.detail; }; }
	require('ts-node').register({
		transpileOnly: true,
		compilerOptions: {
			module: 'commonjs',
			moduleResolution: 'node'
		}
	});
	// Defer to TS CLI so new flags like --log work
	require('../src/sim/run-sim.ts');
} catch (err) {
	console.error('[sim] failed to start:', err && (err.stack || err.message || err));
	process.exit(1);
}
