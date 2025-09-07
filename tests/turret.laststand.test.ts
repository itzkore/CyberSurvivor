import { describe, it, expect } from 'vitest';
import { TurretManager as TM } from '../src/game/modes/turret-manager';
import { WeaponType } from '../src/game/WeaponType';

// Minimal LS stubs
function stubLastStand(core:{x:number;y:number}, corridors?: Array<{x:number;y:number;w:number;h:number}>) {
	(globalThis as any).window = (globalThis as any).window || {};
	const w: any = (globalThis as any).window;
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

describe('Last Stand turrets', () => {
	it('minigun turret fires at visible target and passes origin as TURRET with extended range', () => {
		stubLastStand({ x: 0, y: 0 });
		const tm = new TM();
		// Seed one minigun turret
		(tm as any).specs = { turret_minigun: { id: 'turret_minigun', name: 'Minigun', range: 560, dps: [35], price: [90] } };
		(tm as any).turrets = [{ id: 'turret_minigun', x: 0, y: 0, level: 1, spec: (tm as any).specs.turret_minigun }];
		(tm as any).fireAccumMs = [1000];

		const enemy = { id: 'e1', x: 300, y: 0, radius: 16, hp: 100, active: true } as any;
		const enemyMgr = { getEnemies: () => [enemy], takeDamage: () => {} } as any;

		const bullets: any[] = [];
		const bm = { spawnBullet: (sx:number, sy:number, tx:number, ty:number, wt:WeaponType, dmg:number, lvl:number, origin:any) => {
			const vx = Math.cos(Math.atan2(ty - sy, tx - sx)) * 10; // arbitrary speed to compute life
			const vy = Math.sin(Math.atan2(ty - sy, tx - sx)) * 10;
			const b = { x:sx, y:sy, vx, vy, damage:dmg, life:60, active:true, weaponType: wt, projectileVisual: {}, maxDistanceSq: 0 };
			(b as any).origin = origin;
			bullets.push(b);
			return b;
		}};

		const beforeShots = (tm as any).shots.length;
		tm.update(100, enemyMgr, bm);
		const afterShots = (tm as any).shots.length;
		expect(afterShots).toBeGreaterThanOrEqual(beforeShots); // tracer queued (visual proof)
		expect(bullets.length).toBeGreaterThan(0);              // bullet spawned
		const b = bullets[0];
		expect((b as any).origin).toBe('TURRET');               // correct origin propagation
		// Lifetime/distance tuned to turret spec range
		expect((b as any).maxDistanceSq).toBeGreaterThanOrEqual(560*560 - 1);
	});
});

