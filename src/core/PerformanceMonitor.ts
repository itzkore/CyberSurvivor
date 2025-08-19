/**
 * Lightweight performance monitor to profile main game update phases.
 * Toggle with F10. Designed to minimize allocations.
 */
export class PerformanceMonitor {
  private container: HTMLDivElement;
  private buckets: Record<string, number> = Object.create(null);
  private frameCount = 0;
  private lastFlush = performance.now();
  private flushInterval = 1000; // ms
  private order: string[] = [];
  private enabled = true;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'perf-overlay';
    this.container.style.cssText = [
      'position:fixed','bottom:4px','left:4px','padding:4px 6px','background:rgba(0,0,0,0.45)',
      'font:11px/13px monospace','color:#ccc','z-index:9999','border:1px solid #222','border-radius:4px','white-space:pre','pointer-events:none'
    ].join(';');
    this.container.textContent = 'Perf…';
    document.body.appendChild(this.container);
    window.addEventListener('keydown', (e)=>{ if(e.key==='F10') this.toggle(); });
  }
  public toggle(){ this.enabled = !this.enabled; this.container.style.display = this.enabled? 'block':'none'; }
  public begin(label: string): number { if(!this.enabled) return 0; if(!(label in this.buckets)){ this.buckets[label]=0; this.order.push(label);} return performance.now(); }
  public end(label: string, start: number){ if(!this.enabled) return; this.buckets[label]+= performance.now()-start; }
  public frame(){ if(!this.enabled) return; this.frameCount++; const now=performance.now(); if(now-this.lastFlush>=this.flushInterval){ const inv=1/this.frameCount; const rs=(window as any).__renderScale; const lines: string[]=['F10 hide'+((window as any).__lowFX?' [lowFX]':'')+(rs&&rs!==1?` x${rs}`:'')]; for(let i=0;i<this.order.length;i++){ const k=this.order[i]; const avg=this.buckets[k]*inv; lines.push(`${k}: ${avg.toFixed(2)}ms`); this.buckets[k]=0;} this.frameCount=0; this.lastFlush=now; this.container.textContent=lines.join('\n'); } }
  public destroy(){ this.container.remove(); }
}
