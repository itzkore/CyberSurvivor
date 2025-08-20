// OAuth implicit id_token callback handler
// Parses the fragment, stores id_token + nonce (extracted from JWT payload) in localStorage
// so the opener/original tab (listening via storage event + polling) can finish sign-in.
(function(){
  function base64UrlDecode(seg){
    try {
      const b = seg.replace(/-/g,'+').replace(/_/g,'/');
      const pad = b.length % 4 ? b + '='.repeat(4 - (b.length % 4)) : b;
      const bin = atob(pad);
      return decodeURIComponent(Array.prototype.map.call(bin, c => '%' + c.charCodeAt(0).toString(16).padStart(2,'0')).join(''));
    } catch { return '{}'; }
  }
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);
  const idToken = params.get('id_token');
  const error = params.get('error');
  const storageKey = 'auth.oauthReturn';
  const statusEl = document.getElementById('callback-status');
  if (error) {
    statusEl && (statusEl.textContent = 'Authentication error: ' + error);
    return;
  }
  if (!idToken) {
    statusEl && (statusEl.textContent = 'No id_token in response.');
    return;
  }
  let nonce;
  try { const payloadRaw = idToken.split('.')[1]; nonce = JSON.parse(base64UrlDecode(payloadRaw)).nonce; } catch { /* ignore */ }
  try {
    localStorage.setItem(storageKey, JSON.stringify({ idToken, nonce }));
    statusEl && (statusEl.textContent = 'Sign-in complete. You can close this tab.');
  } catch (e) {
    statusEl && (statusEl.textContent = 'Failed to store auth data: ' + e);
  }
  // Attempt to close window (will only succeed if user gesture context retained)
  setTimeout(()=>{ try { window.close(); } catch {} }, 1200);
  // Fallback redirect back to root after a short delay (if not closed)
  setTimeout(()=>{ if (!document.hidden) location.replace('/'); }, 4000);
})();
