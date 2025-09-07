export class LastStandHUD {
  private el: HTMLDivElement;
  private waveSpan: HTMLSpanElement;
  private scrapSpan: HTMLSpanElement;
  private phaseSpan: HTMLSpanElement;
  private timerSpan: HTMLSpanElement;
  private coreHpBar: HTMLDivElement;
  private coreHpText: HTMLSpanElement;
  private enemiesSpan: HTMLSpanElement;
  private enemiesBottomSpan: HTMLSpanElement;
  private visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ls-hud';
  Object.assign(this.el.style, {
  position:'fixed', left:'50%', top:'10px', transform:'translateX(-50%)',
  color:'#dff', font:'600 13px Orbitron, monospace', zIndex:'140',
  textShadow:'0 0 8px #19f0e6', background:'linear-gradient(180deg, rgba(0,16,20,0.72), rgba(0,10,12,0.62))', padding:'10px 14px', borderRadius:'14px',
  border:'1.5px solid rgba(32,255,233,0.85)', boxShadow:'0 0 24px rgba(32,255,233,0.35), inset 0 0 12px rgba(32,255,233,0.12)',
  width:'min(48vw, 640px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'
  } as CSSStyleDeclaration);
  this.el.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:center;white-space:nowrap;letter-spacing:.4px;margin:0 auto;max-width:96%">Wave <span id="ls-wave">1</span> · Enemies <span id="ls-left">--</span> · Scrap <span id="ls-scrap">0</span> · <span id="ls-phase">COMBAT</span> · <span id="ls-timer">--</span></div>`;
  // Core HP bar container
  const coreWrap = document.createElement('div');
  Object.assign(coreWrap.style, { marginTop:'8px', width:'min(420px, 42vw)', height:'12px', border:'1px solid rgba(32,255,233,0.85)', borderRadius:'8px', background:'rgba(0,0,0,0.35)', overflow:'hidden', boxShadow:'0 0 16px rgba(32,255,233,0.25) inset', marginLeft:'auto', marginRight:'auto' } as CSSStyleDeclaration);
  const coreFill = document.createElement('div'); this.coreHpBar = coreFill;
  Object.assign(coreFill.style, { width:'100%', height:'100%', background:'linear-gradient(90deg, #26ffe9, #00b3a3 60%, #007d73)', transition:'width 120ms linear', boxShadow:'0 0 10px rgba(32,255,233,0.55)' } as CSSStyleDeclaration);
  const coreLabel = document.createElement('div'); this.coreHpText = document.createElement('span');
  coreLabel.textContent = 'Core ';
  Object.assign(coreLabel.style, { fontSize:'12px', opacity:'0.9', marginTop:'4px' } as CSSStyleDeclaration);
  coreLabel.appendChild(this.coreHpText);
  coreWrap.appendChild(coreFill); this.el.appendChild(coreWrap); this.el.appendChild(coreLabel);
  this.waveSpan = this.el.querySelector('#ls-wave') as HTMLSpanElement;
  this.enemiesSpan = this.el.querySelector('#ls-left') as HTMLSpanElement;
    this.scrapSpan = this.el.querySelector('#ls-scrap') as HTMLSpanElement;
    this.phaseSpan = this.el.querySelector('#ls-phase') as HTMLSpanElement;
    this.timerSpan = this.el.querySelector('#ls-timer') as HTMLSpanElement;
  // Bottom-center "Enemies Left" footer
  const footer = document.createElement('div');
  Object.assign(footer.style, { marginTop:'8px', fontSize:'12px', opacity:'0.95', textAlign:'center' } as CSSStyleDeclaration);
  footer.innerHTML = `Enemies Left: <span id="ls-left-bot">--</span>`;
  this.el.appendChild(footer);
  this.enemiesBottomSpan = footer.querySelector('#ls-left-bot') as HTMLSpanElement;
    document.body.appendChild(this.el);
    this.hide();
  }

  show(){ this.el.style.display='block'; this.visible = true; }
  hide(){ this.el.style.display='none'; this.visible = false; }

  setWave(n:number){ this.waveSpan.textContent = String(n); }
  setScrap(v:number){ this.scrapSpan.textContent = String(v); }
  setPhase(p:'COMBAT'|'SHOP'){ this.phaseSpan.textContent = p; }
  setTimer(seconds:number){ this.timerSpan.textContent = seconds>0? (seconds+'s'):'--'; }
  setEnemiesLeft(n:number){
    const v = String(Math.max(0, n|0));
    if (this.enemiesSpan) this.enemiesSpan.textContent = v;
    if (this.enemiesBottomSpan) this.enemiesBottomSpan.textContent = v;
  }
  /** Update the core HP HUD elements. */
  setCoreHp(hp:number, max:number){
    const pct = Math.max(0, Math.min(1, (max>0? hp/max : 0)));
    this.coreHpBar.style.width = Math.round(pct * 100) + '%';
    this.coreHpText.textContent = `HP ${Math.max(0, Math.floor(hp))} / ${Math.max(1, Math.floor(max))}`;
  }
}
