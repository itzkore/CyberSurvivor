// Runtime leaderboard configuration injector.
// Reads optional <meta name="upstash-url" content="..."> and <meta name="upstash-token" content="...">
// If both present, sets window.__UPSTASH__ so leaderboard.ts picks them up without rebuild.
// WARNING: Token is exposed to clients. Use only for development or low-risk public boards.

export {}; // ensure this file is a module for global augmentation
declare global { interface Window { __UPSTASH__?: { url?: string; token?: string }; } }

(() => {
  try {
    const urlMeta = document.querySelector('meta[name=upstash-url]') as HTMLMetaElement | null;
    const tokenMeta = document.querySelector('meta[name=upstash-token]') as HTMLMetaElement | null;
    const url = urlMeta?.content?.trim();
    const token = tokenMeta?.content?.trim();
    if (url && token) {
      window.__UPSTASH__ = { url, token };
      console.info('[Leaderboard] Runtime Upstash config injected from meta tags.');
    } else {
      console.info('[Leaderboard] Meta tags for Upstash not set; using build-time Vite env if available.');
    }
    // Try localStorage fallback if still not configured
    if (!window.__UPSTASH__) {
      const lsUrl = localStorage.getItem('lb_upstash_url');
      const lsTok = localStorage.getItem('lb_upstash_token');
      if (lsUrl && lsTok) {
        window.__UPSTASH__ = { url: lsUrl, token: lsTok };
        console.info('[Leaderboard] Loaded Upstash config from localStorage.');
      }
    }
  // If still missing, mount a minimal config UI (dev-only helper) only on localhost or when ?lbconfig=1 is present
  const allowOverlay = /localhost|127\.0\.0\.1/.test(location.hostname) || /[?&]lbconfig=1/.test(location.search);
  if (!window.__UPSTASH__ && allowOverlay) {
      const root = document.createElement('div');
      root.id = 'lb-config-overlay';
      root.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10000;background:rgba(0,0,0,0.7);padding:10px 12px;font:12px/15px monospace;color:#0ff;border:1px solid #044;border-radius:6px;max-width:340px';
      root.innerHTML = `<div style="margin-bottom:6px;font-weight:bold;color:#6ff">Leaderboard Config (dev)</div>
        <label style='display:block;margin-bottom:4px;color:#9fe'>URL<br><input id='lb-url' style='width:100%;box-sizing:border-box;padding:3px;background:#111;border:1px solid #055;color:#0ff' placeholder='https://xxxxx.upstash.io'></label>
        <label style='display:block;margin-bottom:6px;color:#9fe'>Token<br><input id='lb-token' style='width:100%;box-sizing:border-box;padding:3px;background:#111;border:1px solid #055;color:#0ff' placeholder='UPSTASH_TOKEN'></label>
        <div style='display:flex;gap:6px;margin-top:4px'>
          <button id='lb-save' style='flex:1;padding:4px 6px;background:#044;border:1px solid #077;color:#8ff;cursor:pointer'>Save</button>
          <button id='lb-clear' style='padding:4px 6px;background:#330;border:1px solid #650;color:#f96;cursor:pointer'>Clear</button>
          <button id='lb-close' style='padding:4px 6px;background:#222;border:1px solid #555;color:#ccc;cursor:pointer'>X</button>
        </div>
        <div style='margin-top:6px;font-size:11px;opacity:.7'>Values stored locally only (localStorage). Token is public; restrict commands + rate limit.</div>`;
      document.body.appendChild(root);
      const byId = (id:string)=> root.querySelector('#'+id) as HTMLElement|null;
      byId('lb-save')?.addEventListener('click', ()=>{
        const vUrl = (byId('lb-url') as HTMLInputElement).value.trim();
        const vTok = (byId('lb-token') as HTMLInputElement).value.trim();
        if (!/^https:\/\/.+upstash\.io/.test(vUrl)) { alert('URL must look like https://xxxxx.upstash.io'); return; }
        if (vTok.length < 20) { alert('Token looks too short'); return; }
        localStorage.setItem('lb_upstash_url', vUrl);
        localStorage.setItem('lb_upstash_token', vTok);
        window.__UPSTASH__ = { url: vUrl, token: vTok };
        console.info('[Leaderboard] Config saved. Reload or wait for next fetch cycle.');
        root.remove();
      });
      byId('lb-clear')?.addEventListener('click', ()=>{
        localStorage.removeItem('lb_upstash_url');
        localStorage.removeItem('lb_upstash_token');
        alert('Cleared stored config.');
      });
      byId('lb-close')?.addEventListener('click', ()=> root.remove());
    } else if (!window.__UPSTASH__) {
      // Silent: in production we just remain disabled rather than showing overlay
      console.info('[Leaderboard] No runtime config and overlay disabled (not dev).');
    }
  } catch (e) {
    console.warn('[Leaderboard] Runtime config injection failed', e);
  }
})();
