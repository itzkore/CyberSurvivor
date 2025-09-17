export class DebugOverlay {
  visible = false;
  toggle(v?: boolean) { this.visible = v == null ? !this.visible : !!v; }

  draw(ctx: CanvasRenderingContext2D, game: any) {
    const show = this.visible || (window as any).__debugOverlay === true;
    if (!show) return;
    const pad = 8;
    const lines: string[] = [];
    const fps = (window as any).__fpsSample ?? 0;
    const avg = (window as any).__avgFrameMs ?? 0;
    const enemies = game?.getEnemyManager?.()?.getEnemies?.()?.length ?? 0;
    const elites = (() => {
      const arr = game?.getEnemyManager?.()?.getEnemies?.() || [];
      let n = 0; for (let i=0;i<arr.length;i++){ const a:any=arr[i]; if (a?.active && a._elite?.kind) n++; }
      return n;
    })();
    const bullets = game?.getBulletManager?.()?.bullets?.length ?? 0;
    lines.push(`FPS ${fps}  avg ${avg.toFixed(1)}ms`);
    lines.push(`Enemies ${enemies}  Elites ${elites}  Bullets ${bullets}`);
    try {
      const r:any = (window as any).__glEnemiesRenderer;
      const on = !!r;
      const inst = (window as any).__glEnemiesLastCount ?? 0;
      let extra = '';
      if (on) {
        const cap = (r as any).instancesCapacity ?? undefined;
        const texReady = (r as any).textureReady === true ? 'tex' : 'no-tex';
        const atlas = (window as any).__glEnemiesAtlasInfo || {};
        const ent = atlas.entries != null ? ` entries=${atlas.entries}` : '';
        const ready = (window as any).__glEnemiesIsReady ? 'ready' : 'warming';
        const atlasReady = (window as any).__glEnemiesAtlasReady ? 'atlas' : 'no-atlas';
        const validTex = (window as any).__glEnemiesHasValidTexture ? 'valid-tex' : 'invalid-tex';
        if (cap != null) extra = ` cap=${cap} ${texReady} ${ready} ${atlasReady} ${validTex}${ent}`; else extra = ` ${texReady} ${ready} ${atlasReady} ${validTex}${ent}`;
      }
      lines.push(`GL-Enemies ${on ? 'ON' : 'off'}  inst=${inst}${extra}`);
    } catch {}
    // GL Fog
    try {
      const r:any = (window as any).__glFogRenderer;
      const on = !!r;
      const ready = (window as any).__glFogReady ? 'ready' : 'warming';
      lines.push(`GL-Fog ${on ? 'ON' : 'off'}  ${ready}`);
    } catch {}
    // GL Bullets
    try {
      const r:any = (window as any).__glBulletRenderer;
      const on = !!r;
      const inst = (window as any).__glBulletsLastCount ?? 0;
      let extra = '';
      if (on) {
        const cap = (r as any).instancesCapacity ?? undefined;
        const texReady = (r as any).textureReady === true ? 'tex' : 'no-tex';
        if (cap != null) extra = ` cap=${cap} ${texReady}`; else extra = ` ${texReady}`;
      }
      lines.push(`GL-Bullets ${on ? 'ON' : 'off'}  inst=${inst}${extra}`);
    } catch {}
    // Pools (best-effort)
    try {
      const em:any = game?.getEnemyManager?.();
      const pool = em?.enemyPool?.length ?? 0;
      lines.push(`EnemyPool ${pool}`);
    } catch {}
    // Draw panel
    ctx.save();
    ctx.resetTransform?.();
    const dpr = (window as any).devicePixelRatio || 1;
    const rs = (window as any).__renderScale || 1;
    const scale = dpr * rs;
    const w = ctx.canvas.width / scale; const h = ctx.canvas.height / scale;
    ctx.translate(10, h - (lines.length * 16) - 10);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(-pad, -pad, 260, lines.length * 16 + pad*2);
    ctx.fillStyle = '#bdf';
    ctx.font = '12px monospace';
    for (let i=0;i<lines.length;i++) ctx.fillText(lines[i], 0, i*16 + 12);
    ctx.restore();
  }
}
