import type { AbilityDescriptor } from '../../ability-types';
import type { Player } from '../../../Player';
import { mouseState } from '../../../keyState';
import { WeaponType } from '../../../WeaponType';

type VBState = {
	active: boolean;
	startX: number; startY: number;
	x: number; y: number; vx: number; vy: number;
	t0: number; // start time
	spin: number; // radians per second
	phase: 'OUT'|'CHASE'|'RETURN';
	targets: { x:number; y:number; id?:number }[];
	targetIndex: number;
	returnX: number; returnY: number;
	trail: { x:number; y:number; t:number }[];
	lastTick: number;
	meterCdUntil: number; // cooldown end
};

const CD_MS = 12000;
const TRAIL_TTL = 2000; // <= 2s
const SPEED = 10.5; // base world units per ms
const SPIN = Math.PI * 2.2; // radians/sec
const MAX_TARGETS = 5;
const DOT_DPS = 10; // weak DoT baseline
const SLOW_FRAC = 0.65; // 35% slow

export const VectorBoomerangRMB: AbilityDescriptor = {
	key: 'RMB',
	id: 'runner_vector_boomerang',
	getMeter: (p: Player & any) => (p as any).getRunnerBoomerang?.() ?? null,
	update: (p: Player & any, dt: number) => {
		const g:any = (p as any).gameContext || (window as any).__gameInstance; if (!g) return;
		const now = (typeof performance!=='undefined'?performance.now():Date.now());
		const S = ensure(p);
		// HUD getter
		if (!p.getRunnerBoomerang) p.getRunnerBoomerang = function(){ const max=CD_MS; const remain=Math.max(0, S.meterCdUntil - (typeof performance!=='undefined'?performance.now():Date.now())); return { value:(max-remain), max, ready: remain<=0, active: !!S.active }; };

		// Input edge for RMB (ESM import)
		const mouse = mouseState; const rDown = !!mouse.right; const edge = (()=>{ const prev=(p as any).__runPrevR||false; (p as any).__runPrevR=rDown; return rDown && !prev; })();
		if (edge && !S.active && now >= S.meterCdUntil) {
			// Unlimited range: aim at mouse world point, then generate initial interesting curve outbound
			const camX=g.camX||0, camY=g.camY||0; const mx = mouse.x||0, my=mouse.y||0; const tx = mx+camX, ty = my+camY;
			S.active = true; S.t0 = now; S.lastTick = now; S.startX = p.x; S.startY = p.y; S.x = p.x; S.y = p.y; S.spin = SPIN; S.phase='OUT';
			// initial velocity: toward target with slight perpendicular bias to create a curve
			const dx = tx - p.x, dy = ty - p.y; const d = Math.max(1e-3, Math.hypot(dx,dy)); const nx = dx/d, ny = dy/d; const perp = { x: -ny, y: nx }; const bias = 0.55; const vx = nx * SPEED + perp.x * SPEED * bias; const vy = ny * SPEED + perp.y * SPEED * bias;
			S.vx = vx; S.vy = vy; S.returnX = p.x; S.returnY = p.y;
			// pick up to 5 random visible enemies as chase beacons
			const enemies = (g.enemyManager.queryEnemies?.(p.x, p.y, 2000)) || g.enemyManager.getEnemies?.() || [];
			const pool:any[] = [];
			for (let i=0;i<enemies.length;i++){ const e:any = enemies[i]; if(!e||!e.active||e.hp<=0) continue; pool.push({x:e.x,y:e.y,id:e._id||i}); }
			for (let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=pool[i]; pool[i]=pool[j]; pool[j]=t; }
			S.targets = pool.slice(0, MAX_TARGETS);
			S.targetIndex = 0;
			// Start cooldown immediately; early return won't reset CD
			S.meterCdUntil = now + CD_MS;
			try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: p.x, y: p.y, color:'#33d1ff', r:120 } })); } catch {}
		}

		if (!S.active) return;
		const dtMs = Math.max(1, now - S.lastTick); S.lastTick = now;

		// Curved motion: apply gentle steering toward current target (OUT) then chase sequence, then return
		if (S.phase === 'OUT') {
			if (S.targets.length <= 0) { S.phase = 'RETURN'; }
			else S.phase = 'CHASE';
		}
		if (S.phase === 'CHASE') {
			// steer toward current target; when close, advance to next; if none left, RETURN
			const t = S.targets[S.targetIndex]; if (!t) { S.phase='RETURN'; }
			else {
				const dx = t.x - S.x, dy = t.y - S.y; const d = Math.hypot(dx,dy) || 1; const desiredX = (dx/d)*SPEED, desiredY=(dy/d)*SPEED; const steer = 0.055; S.vx = S.vx*(1-steer)+desiredX*steer; S.vy=S.vy*(1-steer)+desiredY*steer;
				if (d < 50) { S.targetIndex++; if (S.targetIndex >= S.targets.length) S.phase='RETURN'; }
			}
		}
		if (S.phase === 'RETURN') {
			const dx = p.x - S.x, dy = p.y - S.y; const d = Math.hypot(dx,dy) || 1; const desiredX = (dx/d)*SPEED, desiredY=(dy/d)*SPEED; const steer = 0.06; S.vx = S.vx*(1-steer)+desiredX*steer; S.vy=S.vy*(1-steer)+desiredY*steer;
			if (d < 28) { S.active=false; }
		}

		// Integrate position
		S.x += S.vx * dtMs; S.y += S.vy * dtMs;
		// Trail hazard: push a breadcrumb; periodically cull
		S.trail.push({ x: S.x, y: S.y, t: now });
		while (S.trail.length>0 && now - S.trail[0].t > TRAIL_TTL) S.trail.shift();

		// Apply trail slow + DoT to nearby enemies
		try {
			const enemies = g.enemyManager.getEnemies?.() || [];
			for (let i=0;i<enemies.length;i++) {
				const e:any = enemies[i]; if (!e||!e.active||e.hp<=0) continue;
				// find nearest trail point within radius
				const r = 28; const r2 = r*r; let near=false; for (let k=S.trail.length-1;k>=0 && !near;k--){ const b=S.trail[k]; const dx=e.x-b.x, dy=e.y-b.y; if (dx*dx+dy*dy<=r2){ near=true; break; } }
				if (!near) continue;
				// slow
				try { e._slowUntil = Math.max(e._slowUntil||0, now + 450); e._slowMul = Math.min(e._slowMul||1, SLOW_FRAC); } catch {}
				// apply weak DoT tick (no more than once every ~200ms per enemy for this effect)
				const key = '_vbNextTick'; const due = (e as any)[key] || 0; if (now >= due) {
					const dmg = Math.round((p.baseDamage || 10) * 0.2); // weak
					g.enemyManager.takeDamage(e, dmg, false, false, WeaponType.RUNNER_GUN, S.x, S.y, (p as any)?.weaponLevel||1, false, 'PLAYER');
					(e as any)[key] = now + 200; // 5 ticks/sec cap
				}
			}
		} catch {}
	},
	render: (p: Player & any, ctx: CanvasRenderingContext2D) => {
		const g:any = (p as any).gameContext || (window as any).__gameInstance; const S = (p as any).__runnerVB as VBState | undefined; if (!S || !S.active) return;
		const rs = g.renderScale||1, camX=g.camX||0, camY=g.camY||0;
		// Trail: blue flame wisps
		try {
			ctx.save(); ctx.globalCompositeOperation = 'screen';
			for (let i=0;i<S.trail.length;i++){
				const b = S.trail[i]; const age = ((typeof performance!=='undefined'?performance.now():Date.now()) - b.t)/TRAIL_TTL; const a = Math.max(0, 1 - age); const sx=(b.x-camX)*rs, sy=(b.y-camY)*rs; const r = (14 + 16*(1-age)) * rs; const grad = ctx.createRadialGradient(sx,sy,0,sx,sy,r); grad.addColorStop(0,'rgba(80,220,255,'+(0.35*a)+')'); grad.addColorStop(1,'rgba(0,120,200,0)'); ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.fill();
			}
			ctx.restore();
		} catch {}
		// Boomerang body: spinning blade
		const sx = (S.x - camX) * rs, sy = (S.y - camY) * rs; const ang = ((typeof performance!=='undefined'?performance.now():Date.now()) - S.t0)/1000 * S.spin;
		ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
		try { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#3bd1ff'; ctx.beginPath(); ctx.moveTo(20*rs,0); ctx.lineTo(-8*rs, 8*rs); ctx.lineTo(-6*rs,0); ctx.lineTo(-8*rs,-8*rs); ctx.closePath(); ctx.fill(); ctx.fillStyle='#ffffff'; ctx.fillRect(-2*rs,-2*rs,4*rs,4*rs); } catch {}
		ctx.restore();
	}
};

function ensure(p:any){ if(!(p as any).__runnerVB){ (p as any).__runnerVB = { active:false, startX:0,startY:0,x:0,y:0,vx:0,vy:0,t0:0,spin:0,phase:'OUT',targets:[],targetIndex:0,returnX:0,returnY:0,trail:[], lastTick:0, meterCdUntil:0 } as VBState; } return (p as any).__runnerVB as VBState; }
