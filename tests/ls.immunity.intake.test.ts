import { describe, it, expect } from 'vitest';
import { EnemyManager } from '../src/game/EnemyManager';
import { Player } from '../src/game/Player';
import { WeaponType } from '../src/game/WeaponType';
import { SpatialGrid } from '../src/physics/SpatialGrid';
import type { Bullet } from '../src/game/Bullet';

// Minimal window stubs used by LS visibility helpers
function stubLastStand(core:{x:number;y:number}, corridors?: Array<{x:number;y:number;w:number;h:number}>) {
	(globalThis as any).window = (globalThis as any).window || {};
	const w: any = (globalThis as any).window;
	// DOM/canvas shims used by EnemyManager sprite pre-render
	if (typeof (globalThis as any).document === 'undefined') {
		const makeNoop2D = () => new Proxy({}, { get: () => () => {}, set: () => true });
		(globalThis as any).document = {
			createElement: (tag: string) => tag === 'canvas' ? ({ width: 0, height: 0, style: {}, getContext: () => makeNoop2D(), toDataURL: () => 'data:' } as any) : ({ style: {} } as any),
			body: { appendChild: () => {}, removeChild: () => {} },
			getElementById: () => null,
			querySelector: () => null,
			addEventListener: () => {},
		} as any;
	}
	if (typeof (globalThis as any).Image === 'undefined') {
		(globalThis as any).Image = class { src = ''; width = 0; height = 0; onload: any = null; onerror: any = null; constructor(){ setTimeout(()=>{ try { this.onload && this.onload(); } catch {} }, 0);} } as any;
	}
	if (!w.addEventListener) {
		w.__evt = new Map<string, Set<Function>>();
		w.addEventListener = (type: string, fn: Function) => { if (!w.__evt.has(type)) w.__evt.set(type, new Set()); w.__evt.get(type)!.add(fn); };
		w.removeEventListener = (type: string, fn: Function) => { w.__evt.get(type)?.delete(fn); };
		w.dispatchEvent = (ev: any) => { const s = w.__evt.get(ev?.type); if (s) s.forEach((fn: any) => { try { fn(ev); } catch {} }); return true; };
	}
	if (typeof (globalThis as any).CustomEvent === 'undefined') {
		(globalThis as any).CustomEvent = class { type: string; detail: any; constructor(type: string, params?: any) { this.type = type; this.detail = params?.detail; } } as any;
	}
	(window as any).__gameInstance = { gameMode: 'LAST_STAND', getEffectiveFowRadiusTiles: () => 4, fowTileSize: 160 };
	(window as any).__lsCore = { x: core.x, y: core.y };
	(window as any).__roomManager = { getCorridors: () => corridors || [] };
}

function makeEnemyManagerWithPlayer(px=0, py=0) {
	const player = { x: px, y: py } as unknown as Player;
	const grid = new SpatialGrid<Bullet>(160);
	const em = new EnemyManager(player, grid, undefined, undefined, 1);
	return em as any;
}

describe('Last Stand intake immunity backstop (all origins)', () => {
	it('blocks TURRET-origin direct damage and knockback when target is in fog', () => {
		stubLastStand({ x: 0, y: 0 });
		const em = makeEnemyManagerWithPlayer(0, 0);
		const enemy = { id: 'eT', x: 900, y: 0, radius: 16, hp: 100, active: true } as any;
		(em as any).activeEnemies = [enemy];

		const hpBefore = enemy.hp;
		// Source coordinates would normally produce knockback; verify none is applied
		em.takeDamage(enemy, 50, false, false, WeaponType.PISTOL, 0, 0, 1, false, 'TURRET');
		expect(enemy.hp).toBe(hpBefore);
		expect((enemy as any).knockbackTimer || 0).toBe(0);
		expect((enemy as any).knockbackVx || 0).toBe(0);
		expect((enemy as any).knockbackVy || 0).toBe(0);
	});

	it('blocks indirect/AoE damage when target is in fog (no chip or shove)', () => {
		stubLastStand({ x: 0, y: 0 });
		const em = makeEnemyManagerWithPlayer(0, 0);
		const enemy = { id: 'eA', x: 950, y: 0, radius: 16, hp: 120, active: true } as any;
		(em as any).activeEnemies = [enemy];

		const hpBefore = enemy.hp;
		// Mark as indirect (e.g., zone/explosion tick). Should still be fully ignored in fog.
		em.takeDamage(enemy, 40, false, false, WeaponType.SINGULARITY_SPEAR, 0, 0, 1, true, 'PLAYER');
		expect(enemy.hp).toBe(hpBefore);
		expect((enemy as any).knockbackTimer || 0).toBe(0);
	});
});

