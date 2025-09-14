import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import CodexRoute from './CodexRoute';
import './styles.css';

declare global {
  interface Window { __codex2Enabled?: boolean; __codex2Root?: Root | null; }
}

// Codex v2: enabled by default. Opt-out via ?codex2=0 or localStorage cs-codex2=0.
// URL param has highest precedence, then localStorage. Explicit ?codex2=1 forces enable.
let enabled = true;
try {
  const qs = new URLSearchParams(location.search);
  const p = qs.get('codex2');
  if (p === '1') enabled = true;
  else if (p === '0') enabled = false;
  else {
    const ls = (typeof localStorage !== 'undefined') ? localStorage.getItem('cs-codex2') : null;
    if (ls === '1') enabled = true;
    else if (ls === '0') enabled = false;
  }
} catch { /* default true */ }
window.__codex2Enabled = enabled;

if (enabled) {
  let host: HTMLDivElement | null = null;
    let popHandler: ((this: Window, ev: PopStateEvent) => any) | null = null;
    // Document gesture/scroll locks while Codex is open
    let prevHtmlOverscroll: string | null = null;
    let prevBodyOverscroll: string | null = null;
    let prevHtmlTouchAction: string | null = null;
    let prevBodyTouchAction: string | null = null;
    // Edge-swipe guards (left/right) to block iOS Safari forward/back gestures
    let leftEdgeGuard: HTMLDivElement | null = null;
    let rightEdgeGuard: HTMLDivElement | null = null;
    let edgeTouchHandler: ((e: TouchEvent) => void) | null = null;
  const ensureHost = () => {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.id = 'codex2-root-host';
    Object.assign(host.style, {
      position: 'fixed', inset: '0', zIndex: '2000', pointerEvents: 'auto'
    } as CSSStyleDeclaration);
    document.body.appendChild(host);
    return host;
  };

  const open = (detail?: any) => {
    const el = ensureHost();
    if (!window.__codex2Root) {
      window.__codex2Root = createRoot(el);
    }
    window.__codex2Root!.render(<CodexRoute {...(detail||{})} />);
    try {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
      if (canvas) {
        // Preserve previous z-index so we can restore it on close
        const prev = canvas.style.zIndex || '';
        canvas.setAttribute('data-prev-z', prev);
        canvas.style.zIndex = '-1';
      }
      // While Codex is open, strongly disable scroll chaining and edge-swipe navigation on the document.
      const html = document.documentElement as HTMLElement | null;
      const body = document.body as HTMLElement | null;
      if (html) {
        prevHtmlOverscroll = (html.style as any).overscrollBehavior || '';
        prevHtmlTouchAction = (html.style as any).touchAction || '';
        (html.style as any).overscrollBehavior = 'none'; // disable scroll chaining both axes
        (html.style as any).touchAction = 'pan-y pinch-zoom'; // allow vertical scroll/zoom only
      }
      if (body) {
        prevBodyOverscroll = (body.style as any).overscrollBehavior || '';
        prevBodyTouchAction = (body.style as any).touchAction || '';
        (body.style as any).overscrollBehavior = 'none';
        (body.style as any).touchAction = 'pan-y pinch-zoom';
      }
      // Install narrow edge guards to intercept iOS Safari forward/back edge gestures.
      // These sit at the extreme left/right edges and cancel touchstart/move.
      const installEdgeGuard = (side: 'left' | 'right') => {
        const g = document.createElement('div');
        g.id = side === 'left' ? 'codex2-edge-guard-left' : 'codex2-edge-guard-right';
        Object.assign(g.style, {
          position: 'fixed',
          top: '0',
          bottom: '0',
          [side]: '0',
          width: '18px', // narrow strip; adjust if needed
          zIndex: '2005', // above overlay to catch edge gesture start
          pointerEvents: 'auto',
          background: 'transparent',
          touchAction: 'none', // strongest hint to browser
        } as CSSStyleDeclaration & { [key: string]: any });
        // Non-passive to allow preventDefault on iOS
        const handler = (e: TouchEvent) => { try { e.preventDefault(); } catch {} };
        g.addEventListener('touchstart', handler, { passive: false });
        g.addEventListener('touchmove', handler, { passive: false });
        document.body.appendChild(g);
        return { el: g, handler };
      };
      const L = installEdgeGuard('left');
      const R = installEdgeGuard('right');
      leftEdgeGuard = L.el; rightEdgeGuard = R.el; edgeTouchHandler = L.handler; // same ref
    } catch {}
    // Add a global popstate guard to close Codex even if the inner route component unmounted unexpectedly.
    try {
      popHandler = () => close();
      window.addEventListener('popstate', popHandler);
    } catch {}
  };

  const close = () => {
    if (window.__codex2Root) {
      window.__codex2Root.unmount();
      window.__codex2Root = null;
    }
    if (host && host.parentElement) host.parentElement.removeChild(host);
    host = null;
    // Restore canvas z-index if we changed it on open
    try {
      const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement | null;
      if (canvas) {
        const prev = canvas.getAttribute('data-prev-z');
        if (prev !== null) {
          canvas.style.zIndex = prev;
          canvas.removeAttribute('data-prev-z');
        }
      }
    } catch {}
    // Restore document gesture/scroll behavior
    try {
      const html = document.documentElement as HTMLElement | null;
      const body = document.body as HTMLElement | null;
      if (html) {
        (html.style as any).overscrollBehavior = prevHtmlOverscroll ?? '';
        (html.style as any).touchAction = prevHtmlTouchAction ?? '';
      }
      if (body) {
        (body.style as any).overscrollBehavior = prevBodyOverscroll ?? '';
        (body.style as any).touchAction = prevBodyTouchAction ?? '';
      }
      prevHtmlOverscroll = null;
      prevBodyOverscroll = null;
      prevHtmlTouchAction = null;
      prevBodyTouchAction = null;
    } catch {}
    // Remove edge guards
    try {
      const removeGuard = (el: HTMLDivElement | null) => {
        if (!el) return;
        if (edgeTouchHandler) {
          el.removeEventListener('touchstart', edgeTouchHandler as EventListenerOrEventListenerObject as any);
          el.removeEventListener('touchmove', edgeTouchHandler as EventListenerOrEventListenerObject as any);
        }
        if (el.parentElement) el.parentElement.removeChild(el);
      };
      removeGuard(leftEdgeGuard);
      removeGuard(rightEdgeGuard);
      leftEdgeGuard = null; rightEdgeGuard = null; edgeTouchHandler = null;
    } catch {}
    // Clean codex query params from URL
    try {
      const url = new URL(location.href);
      url.searchParams.delete('codex');
      url.searchParams.delete('codexTab');
      url.searchParams.delete('op');
      url.searchParams.delete('q');
      history.replaceState(history.state, '', url);
    } catch {}
    // Remove global popstate guard
    try {
      if (popHandler) window.removeEventListener('popstate', popHandler);
      popHandler = null;
    } catch {}
  };

  // Bridge standard events
  window.addEventListener('showCodex', (e) => { e.stopImmediatePropagation?.(); open((e as CustomEvent).detail); }, true);
  window.addEventListener('hideCodex', (e) => { e.stopImmediatePropagation?.(); close(); }, true);
  window.addEventListener('codex2:open', (e) => open((e as CustomEvent).detail));
  window.addEventListener('codex2:close', () => close());
  window.addEventListener('showMainMenu', () => close());

  // Auto-open when URL contains ?codex=1
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('codex') === '1') {
      const tab = url.searchParams.get('codexTab') || undefined;
      const op = url.searchParams.get('op') || undefined;
      open({ tab, operativeId: op });
    }
  } catch {}
}
