/** Tech Warrior RMB: Kinetic Anchor controller (per-operative). */
export class TechWarriorAnchorRMB {
  private game: any;
  private anchor: any | null = null; // {x,y,arm,spawnTime,_drawCount,_seenOnce,_spawnPulseDone}
  private jump: any | null = null;   // {sx,sy,ex,ey,start,dur,done}
  private cdUntil = 0;

  constructor(game: any) { this.game = game; }

  update(nowMs: number, _deltaMs: number, rDown: boolean, edge: boolean, worldX: number, worldY: number) {
    if (this.jump) {
      const j = this.jump; const tRaw = (nowMs - j.start) / j.dur; const t = Math.min(1, Math.max(0, tRaw)); const ease = t * t * (3 - 2 * t); const arc = Math.sin(Math.PI * t) * 42;
      this.game.player.x = j.sx + (j.ex - j.sx) * ease; this.game.player.y = j.sy + (j.ey - j.sy) * ease - arc;
      if (Math.random() < 0.28) { try { this.game.particleManager.spawn(this.game.player.x, this.game.player.y + 8, 1, '#FFB066'); } catch {} }
      if (t >= 1 && !j.done) {
        j.done = true;
        // Pre-land displacement
        try { const pushR = 120; const pushR2 = pushR*pushR; const enemies = this.game.enemyManager.getEnemies ? this.game.enemyManager.getEnemies() : this.game.enemyManager.enemies; if (enemies) { for (let i=0;i<enemies.length;i++){ const e:any=enemies[i]; if(!e||!e.active||e.hp<=0) continue; const dx=e.x-j.ex, dy=e.y-j.ey; const d2=dx*dx+dy*dy; if(d2>pushR2) continue; const d=Math.sqrt(d2)||1; const nx=dx/d, ny=dy/d; const strength=140*(1-d/pushR); e.x=j.ex+nx*(d+Math.max(12,strength)); e.y=j.ey+ny*(d+Math.max(12,strength)); try{ e._staggerUntil=Math.max(e._staggerUntil||0, performance.now()+180);}catch{} }} } catch {}
        // Detonation
        try { const radius=210; const enemies=this.game.enemyManager.getEnemies?this.game.enemyManager.getEnemies():this.game.enemyManager.enemies; if (enemies) { const baseD=Math.round(((this.game.player as any)?.baseDamage||24)*1.15); for (let i=0;i<enemies.length;i++){ const e:any=enemies[i]; if(!e||!e.active||e.hp<=0) continue; const dx=e.x-j.ex, dy=e.y-j.ey; if(dx*dx+dy*dy <= radius*radius){ this.game.enemyManager.takeDamage(e, baseD, false, true, undefined, j.ex, j.ey, (this.game.player as any)?.weaponLevel||1, true, 'PLAYER'); try{ this.game.particleManager.spawn(e.x, e.y, 3, '#FF9F4B'); }catch{} }}} } catch {}
        try { window.dispatchEvent(new CustomEvent('screenShake', { detail: { durationMs: 160, intensity: 3 } })); } catch {}
        try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: j.ex, y: j.ey, color:'#FFA95F' } })); } catch {}
        this.anchor = null; this.cdUntil = nowMs + 15000;
      }
      if (t >= 1.05) { this.jump = null; }
    }
    if (edge) {
      if (this.anchor && nowMs >= (this.anchor.arm||0)) { if (!this.jump) { this.jump = { sx: this.game.player.x, sy: this.game.player.y, ex: this.anchor.x, ey: this.anchor.y, start: nowMs, dur: 300, done:false }; } }
      else if (nowMs >= this.cdUntil) { this.anchor = { x: worldX, y: worldY, arm: nowMs + 200, spawnTime: nowMs, _drawCount: 0 }; try { window.dispatchEvent(new CustomEvent('scrapPulse', { detail: { x: worldX, y: worldY, color:'#FF9F4B', r:140 } })); } catch {} this.cdUntil = nowMs + 200; }
    } else if (rDown) { if (this.anchor && nowMs >= (this.anchor.arm||0) && !this.jump) { this.jump = { sx: this.game.player.x, sy: this.game.player.y, ex: this.anchor.x, ey: this.anchor.y, start: nowMs, dur: 300, done:false }; } }
  }

  getHud() {
    const n = performance.now(); const max = 15000; const remain = Math.max(0, this.cdUntil - n); const placed = !!this.anchor; const armAt = this.anchor?.arm || 0; const armed = placed && n >= armAt; const armRemain = placed && !armed ? Math.max(0, armAt - n) : 0; const ready = armed || (!placed && remain<=0);
    return { value:(max-remain), max, ready, placed, armed, armRemain, label:'Anchor' };
  }

  drawWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number, renderScale: number) {
    const anchor = this.anchor; if (!anchor) return; const age = performance.now() - (anchor.spawnTime || (anchor.spawnTime = performance.now())); const baseR = 22; const pulse = 3 + Math.sin(age / 220) * 3; const r = baseR + pulse; const sx = (anchor.x - camX) * renderScale; const sy = (anchor.y - camY) * renderScale;
    ctx.save(); ctx.translate(sx, sy);
    try { ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,255,255,0.55)'; ctx.beginPath(); ctx.arc(0,0, 16 * renderScale, 0, Math.PI*2); ctx.fill(); ctx.strokeStyle = 'rgba(0,255,255,0.9)'; ctx.lineWidth = 4 * renderScale; ctx.beginPath(); ctx.arc(0,0, 22 * renderScale, 0, Math.PI*2); ctx.stroke(); ctx.strokeStyle = 'rgba(0,200,255,0.85)'; ctx.lineWidth = 3 * renderScale; ctx.beginPath(); ctx.moveTo(0, -40 * renderScale); ctx.lineTo(0, 40 * renderScale); ctx.stroke(); ctx.restore(); } catch {}
    const ringR = r * renderScale; const g = ctx.createRadialGradient(0,0, ringR*0.15, 0,0, ringR); g.addColorStop(0, `rgba(170,255,255,0.55)`); g.addColorStop(0.5, `rgba(90,200,255,0.28)`); g.addColorStop(1, 'rgba(40,120,200,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0,0, ringR, 0, Math.PI*2); ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const beamH = 120 * renderScale; const beamW = 18 * renderScale; const beamGrad = ctx.createLinearGradient(0, -beamH*0.6, 0, beamH*0.4); const flashBoost = age < 150 ? (1 - age/150) : 0; beamGrad.addColorStop(0, 'rgba(160,240,255,0)'); beamGrad.addColorStop(0.32, `rgba(160,240,255,${0.25+0.35*flashBoost})`); beamGrad.addColorStop(0.55, `rgba(200,255,255,${0.38+0.42*flashBoost})`); beamGrad.addColorStop(0.8, `rgba(120,220,255,${0.18+0.25*flashBoost})`); beamGrad.addColorStop(1, 'rgba(0,140,255,0)'); ctx.fillStyle = beamGrad; ctx.beginPath(); ctx.ellipse(0, -beamH*0.1, beamW*0.55, beamH*0.55, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'screen'; const hexR = 26 * renderScale; const hexA = 0.6 + Math.sin(age/400)*0.3; ctx.strokeStyle = `rgba(120,240,255,${hexA.toFixed(3)})`; ctx.lineWidth = 3 * renderScale; ctx.beginPath(); for (let i=0;i<6;i++){ const a = Math.PI/3 * i + age/900; const x = Math.cos(a) * hexR; const y = Math.sin(a) * hexR * 0.9; if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);} ctx.closePath(); ctx.stroke(); ctx.restore();
    const landR = 210 * renderScale; ctx.save(); ctx.globalCompositeOperation = 'screen'; const lrPulse = 0.55 + Math.sin(age/600)*0.15; ctx.strokeStyle = `rgba(180,255,255,${(0.18 + 0.15*lrPulse).toFixed(3)})`; ctx.lineWidth = 3 * renderScale; ctx.beginPath(); ctx.arc(0,0, landR, 0, Math.PI*2); ctx.stroke(); const landR2 = landR + 10 * renderScale; ctx.setLineDash([12 * renderScale, 9 * renderScale]); ctx.lineDashOffset = (age/120) % (21 * renderScale); ctx.strokeStyle = `rgba(120,220,255,${(0.22 + 0.12*lrPulse).toFixed(3)})`; ctx.lineWidth = 2 * renderScale; ctx.beginPath(); ctx.arc(0,0, landR2, 0, Math.PI*2); ctx.stroke(); const lf = (Math.sin(age/700)+1)/2; const fillA = 0.06 + lf * 0.06; const fillGrad = ctx.createRadialGradient(0,0, landR*0.15, 0,0, landR); fillGrad.addColorStop(0, `rgba(120,220,255,${fillA.toFixed(3)})`); fillGrad.addColorStop(1, 'rgba(40,120,180,0)'); ctx.fillStyle = fillGrad; ctx.beginPath(); ctx.arc(0,0, landR, 0, Math.PI*2); ctx.fill(); ctx.restore();
    const spearH = 90 * renderScale; const shaftW = 10 * renderScale; const tipH = 14 * renderScale; const shaftGrad = ctx.createLinearGradient(0, -spearH, 0, 0); shaftGrad.addColorStop(0, 'rgba(255,255,255,0.9)'); shaftGrad.addColorStop(0.2, 'rgba(180,255,255,0.85)'); shaftGrad.addColorStop(0.7, 'rgba(40,200,255,0.75)'); shaftGrad.addColorStop(1, 'rgba(0,140,255,0.4)'); ctx.fillStyle = shaftGrad; ctx.beginPath(); (ctx as any).roundRect?.(-shaftW/2, -spearH, shaftW, spearH, 2*renderScale); if (!(ctx as any).roundRect) ctx.rect(-shaftW/2, -spearH, shaftW, spearH); ctx.fill(); const corePulse = 0.45 + Math.sin(age/180)*0.25; ctx.fillStyle = `rgba(255,255,255,${(0.55 + 0.25*corePulse).toFixed(3)})`; ctx.fillRect(-1.5 * renderScale, -spearH, 3 * renderScale, spearH * 0.9); ctx.save(); ctx.translate(0, -spearH); const tipGrad = ctx.createRadialGradient(0, -tipH*0.25, 0, 0, -tipH*0.25, tipH*1.4); tipGrad.addColorStop(0, 'rgba(255,255,255,1)'); tipGrad.addColorStop(0.28, 'rgba(200,255,255,0.95)'); tipGrad.addColorStop(0.6, 'rgba(120,230,255,0.35)'); tipGrad.addColorStop(1, 'rgba(0,140,255,0)'); ctx.fillStyle = tipGrad; ctx.beginPath(); ctx.moveTo(0, -tipH); ctx.lineTo(shaftW*0.85, tipH*0.15); ctx.lineTo(0, tipH*0.55); ctx.lineTo(-shaftW*0.85, tipH*0.15); ctx.closePath(); ctx.fill(); ctx.strokeStyle = 'rgba(200,255,255,0.5)'; ctx.lineWidth = 1 * renderScale; ctx.stroke(); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const scorchR = 30 * renderScale; const scorch = ctx.createRadialGradient(0,0,0,0,0,scorchR); scorch.addColorStop(0, 'rgba(160,255,255,0.55)'); scorch.addColorStop(0.45, 'rgba(40,180,255,0.32)'); scorch.addColorStop(1, 'rgba(0,100,200,0)'); ctx.fillStyle = scorch; ctx.beginPath(); ctx.arc(0,0, scorchR, 0, Math.PI*2); ctx.fill(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgba(10,25,35,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, scorchR*0.55, scorchR*0.22, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();
    const pulseT = (age % 900) / 900; const ringA = (1 - pulseT) * 0.5; const ringR2 = (12 + pulseT * 34) * renderScale; ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = `rgba(120,220,255,${ringA.toFixed(3)})`; ctx.lineWidth = 2.5 * (1 - pulseT) * renderScale; ctx.beginPath(); ctx.arc(0,0, ringR2, 0, Math.PI*2); ctx.stroke(); ctx.restore();
    ctx.restore();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number, renderScale: number, designW: number, designH: number) {
    const anchor = this.anchor; if (!anchor) return; const ax = (anchor.x - camX) * renderScale; const ay = (anchor.y - camY) * renderScale; const w = designW * renderScale; const h = designH * renderScale; const inside = ax >= 0 && ay >= 0 && ax <= w && ay <= h; ctx.save(); ctx.globalCompositeOperation = 'screen';
    if (inside) { ctx.strokeStyle = 'rgba(0,255,255,0.95)'; ctx.lineWidth = 3 * renderScale; ctx.beginPath(); ctx.arc(ax, ay, 20 * renderScale, 0, Math.PI*2); ctx.stroke(); ctx.fillStyle = 'rgba(0,160,255,0.22)'; ctx.beginPath(); ctx.arc(ax, ay, 12 * renderScale, 0, Math.PI*2); ctx.fill(); }
    else { const cx = w/2, cy = h/2; let dx = ax - cx, dy = ay - cy; const dist = Math.max(0.001, Math.hypot(dx,dy)); dx/=dist; dy/=dist; const margin = 24 * renderScale; const halfW = w/2 - margin; const halfH = h/2 - margin; const t = Math.min(Math.abs(halfW/dx)||9999, Math.abs(halfH/dy)||9999); const px = cx + dx * t; const py = cy + dy * t; ctx.translate(px, py); const ang = Math.atan2(dy, dx); ctx.rotate(ang); const s = 16 * renderScale; ctx.fillStyle = 'rgba(0,220,255,0.9)'; ctx.beginPath(); ctx.moveTo(s,0); ctx.lineTo(-s*0.6, s*0.6); ctx.lineTo(-s*0.3,0); ctx.lineTo(-s*0.6,-s*0.6); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
}
