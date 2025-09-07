export class LastStandHUD {
  private el: HTMLDivElement;
  private waveSpan: HTMLSpanElement;
  private scrapSpan: HTMLSpanElement;
  private phaseSpan: HTMLSpanElement;
  private timerSpan: HTMLSpanElement;
  private visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'ls-hud';
    Object.assign(this.el.style, {
      position:'fixed', left:'12px', top:'12px', color:'#bff', font:'600 14px Orbitron, monospace', zIndex:'40',
      textShadow:'0 0 6px #0af', background:'rgba(0,12,18,0.35)', padding:'8px 10px', borderRadius:'6px', border:'1px solid #094'
    } as CSSStyleDeclaration);
    this.el.innerHTML = `Wave <span id="ls-wave">1</span> · Scrap <span id="ls-scrap">0</span> · <span id="ls-phase">COMBAT</span> · <span id="ls-timer">--</span>`;
    this.waveSpan = this.el.querySelector('#ls-wave') as HTMLSpanElement;
    this.scrapSpan = this.el.querySelector('#ls-scrap') as HTMLSpanElement;
    this.phaseSpan = this.el.querySelector('#ls-phase') as HTMLSpanElement;
    this.timerSpan = this.el.querySelector('#ls-timer') as HTMLSpanElement;
    document.body.appendChild(this.el);
    this.hide();
  }

  show(){ this.el.style.display='block'; this.visible = true; }
  hide(){ this.el.style.display='none'; this.visible = false; }

  setWave(n:number){ this.waveSpan.textContent = String(n); }
  setScrap(v:number){ this.scrapSpan.textContent = String(v); }
  setPhase(p:'COMBAT'|'SHOP'){ this.phaseSpan.textContent = p; }
  setTimer(seconds:number){ this.timerSpan.textContent = seconds>0? (seconds+'s'):'--'; }
}
