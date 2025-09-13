// Lightweight HackingSystem used by Rogue Hacker manual ability and utility helpers.
// Keep dependency-free; Game wires it and passes enemies + inputs.

export interface HackingSystemOptions {
	radius: number;
	minChargeMs: number;
	fullChargeMs: number;
	cooldownMs: number;
}

export type HackState = 'IDLE' | 'CHARGING' | 'COOLDOWN';

export interface HackVisual {
	state: HackState;
	radius: number;
	chargeFrac: number; // 0..1 when charging
	target?: { x: number; y: number; radius?: number } | null;
}

export class HackingSystem {
	private opts: HackingSystemOptions;
	private enabled = false;
	private state: HackState = 'IDLE';
	private chargeStart = 0;
	private cooldownUntil = 0;
	private wasDown = false;
	private visual: HackVisual = { state: 'IDLE', radius: 160, chargeFrac: 0, target: null };

	constructor(opts: HackingSystemOptions) {
		this.opts = opts;
		this.visual.radius = Math.max(40, opts.radius);
	}

	setEnabled(v: boolean) {
		this.enabled = !!v;
		if (!this.enabled) {
			this.state = 'IDLE';
			this.visual.state = 'IDLE';
			this.visual.chargeFrac = 0;
		}
	}

	/**
	 * Update internal state and expose a simple visual descriptor.
	 * @param now performance.now()
	 * @param deltaMs timestep
	 * @param enemies available enemies (optional safe subset)
	 * @param wx world mouse x
	 * @param wy world mouse y
	 * @param rDown right mouse button down
	 */
	update(now: number, _deltaMs: number, enemies: Array<{x:number;y:number;radius?:number;active?:boolean;hp?:number}> = [], wx: number, wy: number, rDown: boolean) {
		if (!this.enabled) { this.state = 'IDLE'; this.visual.state = 'IDLE'; return; }
		// Cooldown gate
		if (now < this.cooldownUntil) {
			this.state = 'COOLDOWN';
			this.visual.state = 'COOLDOWN';
			this.visual.chargeFrac = 0;
			this.wasDown = rDown;
			this.visual.target = null;
			return;
		}
		// Handle charge/activate on press/release
		if (rDown) {
			if (!this.wasDown) {
				// Start charging
				this.chargeStart = now;
			}
			this.state = 'CHARGING';
			this.visual.state = 'CHARGING';
			const elapsed = now - this.chargeStart;
			const min = this.opts.minChargeMs;
			const full = this.opts.fullChargeMs;
			const frac = Math.max(0, Math.min(1, (elapsed - min) / Math.max(1, full - min)));
			this.visual.chargeFrac = Number.isFinite(frac) ? frac : 0;
			// Track nearest target for feedback only
			this.visual.target = this.findNearest(enemies, wx, wy, this.opts.radius);
		} else {
			// Released: if we had enough charge, "activate" and start cooldown
			if (this.wasDown && this.state === 'CHARGING') {
				const elapsed = now - this.chargeStart;
				if (elapsed >= this.opts.minChargeMs) {
					// Optional: effect on nearest enemy can be handled outside; we just set cooldown.
					this.cooldownUntil = now + this.opts.cooldownMs;
					this.state = 'COOLDOWN';
					this.visual.state = 'COOLDOWN';
					this.visual.chargeFrac = 0;
				} else {
					// Short tap: cancel
					this.state = 'IDLE';
					this.visual.state = 'IDLE';
					this.visual.chargeFrac = 0;
				}
				this.visual.target = null;
			} else {
				this.state = 'IDLE';
				this.visual.state = 'IDLE';
				this.visual.chargeFrac = 0;
				this.visual.target = null;
			}
		}
		this.wasDown = rDown;
	}

	getVisual(): HackVisual {
		return this.visual;
	}

	private findNearest<T extends {x:number;y:number;radius?:number;active?:boolean;hp?:number}>(list: T[], x: number, y: number, radius: number): T | null {
		const r2 = radius*radius; let best: T | null = null; let bd2 = Infinity;
		for (let i=0;i<list.length;i++) {
			const e = list[i]; if (!e) continue; if (e.active === false || (e.hp != null && e.hp <= 0)) continue;
			const dx = e.x - x, dy = e.y - y; const d2 = dx*dx + dy*dy; if (d2 > r2) continue;
			if (d2 < bd2) { bd2 = d2; best = e; }
		}
		return best;
	}
}


/** Convert screen coordinates to world coordinates using camera offsets. */
