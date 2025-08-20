/**
 * GoogleAuthService
 * Lightweight wrapper around Google Identity Services (web only).
 * - Dynamically injects the GIS script when first used.
 * - Caches signed-in user (id token + basic profile) in localStorage.
 * - Exposes subscribe mechanism for auth state changes.
 * - Gracefully no-ops if client ID env var missing.
 *
 * NOTE: This is client-side only. For production you should send the ID token
 * to a backend for verification using Google's tokeninfo endpoint or a Google
 * library, then establish your own session. This code only provides basic
 * front-end identity so that the game can personalize UI / saves.
 */

export interface GoogleUserProfile {
  id: string;
  name: string;
  email: string;
  picture?: string;
  /** Raw ID token (JWT). Do NOT trust without server verification. */
  idToken: string;
  /** Player chosen or auto-generated cyber nickname (unique-ish locally). */
  nickname?: string;
  /** Indicates user completed minimal profile setup (nickname chosen). */
  profileComplete?: boolean;
}

type AuthListener = (user: GoogleUserProfile | null) => void;

declare global {
  interface Window {
    google?: any; // GIS namespace
  }
}

class GoogleAuthService {
  private clientId: string | undefined = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined ||
    (typeof document !== 'undefined' ? document.querySelector('meta[name="google-client-id"]')?.getAttribute('content') || undefined : undefined);
  private scriptLoaded = false;
  private initializing = false;
  private user: GoogleUserProfile | null = null;
  private listeners: AuthListener[] = [];
  private promptDisplayed = false;
  private verifying = false;
  private verifyUrl: string | undefined = import.meta.env.VITE_BACKEND_VERIFY_URL as string | undefined;
  private apiBase: string | undefined = import.meta.env.VITE_BACKEND_API_BASE as string | undefined;
  private tokenExpEpochSec: number | undefined;
  private configHelpShown = false;

  private static LS_KEY = 'auth.googleUser';

  constructor() {
    this.restoreFromStorage();
  }

  /** Subscribe to auth state changes. Returns unsubscribe fn. */
  subscribe(listener: AuthListener): () => void {
    this.listeners.push(listener);
    // immediate fire with current state
    listener(this.user);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  getCurrentUser(): GoogleUserProfile | null {
    return this.user;
  }

  /** True if a Google client id is configured (env var present). */
  isConfigured(): boolean { return !!this.clientId; }

  /** Attempt to refresh client id from meta tag (in case index loaded after service constructed). */
  refreshClientIdFromMeta(): boolean {
    if (this.clientId) return true;
    try {
      const meta = document.querySelector('meta[name="google-client-id"]');
      const val = meta?.getAttribute('content') || undefined;
      if (val) {
        this.clientId = val;
        return true;
      }
    } catch {/* ignore */}
    return false;
  }

  /** Public helper to preload the GIS script early (no UI yet). */
  async preload(): Promise<boolean> {
    if (!this.clientId) return false;
    try { await this.loadScript(); return true; } catch { return false; }
  }

  isReady(): boolean {
    return !!this.clientId && this.scriptLoaded && !!window.google?.accounts?.id;
  }

  /** Begins sign-in flow. If GIS not yet loaded, loads then prompts. */
  async signIn(): Promise<GoogleUserProfile | null> {
    if (!this.clientId) {
      console.warn('[Auth] Missing VITE_GOOGLE_CLIENT_ID; sign-in disabled');
      return null;
    }
    if (!this.scriptLoaded) {
      await this.loadScript();
    }
    if (!window.google?.accounts?.id) {
      console.warn('[Auth] Google accounts API not available');
      return null;
    }
    return new Promise<GoogleUserProfile | null>((resolve) => {
      // Use the one-tap prompt or fallback to explicit button? We'll call prompt.
      if (!this.promptDisplayed) {
        this.promptDisplayed = true;
        window.google.accounts.id.initialize({
          client_id: this.clientId,
            callback: (resp: any) => {
            const profile = this.decodeCredential(resp.credential);
            if (profile) {
              this.setUser(profile);
              resolve(profile);
            } else {
              resolve(null);
            }
          },
          auto_select: true,
          cancel_on_tap_outside: true
        });
      }
      window.google.accounts.id.prompt((notification: any) => {
        try {
          if (notification.isDisplayed && notification.isDisplayed()) {
            return; // one-tap shown
          }
        } catch { /* ignore */ }
        const notDisplayed = notification.isNotDisplayed && notification.isNotDisplayed();
        const skipped = notification.isSkippedMoment && notification.isSkippedMoment();
        if (notDisplayed || skipped) {
          // Create fallback modal with explicit GIS button
            this.renderFallbackModal(resolve);
        }
      });
    });
  }

  /** Explicit sign-out clears local state and revokes token hints (best effort). */
  signOut(): void {
    if (this.user) {
      // Attempt revocation (non-blocking)
      const token = this.user.idToken;
      try {
        if (window.google?.accounts?.id) {
          window.google.accounts.id.disableAutoSelect();
        }
        // Revocation via fetch (optional). token is a JWT; revocation sometimes requires access token (different). We'll skip for now.
      } catch (e) {
        // ignore
      }
    }
    this.user = null;
    localStorage.removeItem(GoogleAuthService.LS_KEY);
    this.emit();
  }

  /** Load the Google Identity Services script once. */
  private loadScript(): Promise<void> {
    if (this.scriptLoaded) return Promise.resolve();
    if (this.initializing) {
      return new Promise((res) => {
        const check = () => {
          if (this.scriptLoaded) res(); else setTimeout(check, 30);
        };
        check();
      });
    }
    this.initializing = true;
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        this.scriptLoaded = true;
        this.initializing = false;
        resolve();
      };
      script.onerror = (e) => {
        this.initializing = false;
        reject(e);
      };
      document.head.appendChild(script);
    });
  }

  /** Decode the ID token (JWT) to extract basic profile fields. */
  private decodeCredential(credential: string): GoogleUserProfile | null {
    if (!credential) return null;
    try {
      const parts = credential.split('.');
      if (parts.length < 2) return null;
      const payload = JSON.parse(this.base64UrlDecode(parts[1]));
  this.tokenExpEpochSec = typeof payload.exp === 'number' ? payload.exp : undefined;
      const profile: GoogleUserProfile = {
        id: payload.sub,
        name: payload.name || payload.given_name || 'Player',
        email: payload.email,
        picture: payload.picture,
        idToken: credential
      };
      return profile;
    } catch (e) {
      console.warn('[Auth] Failed to decode credential', e);
      return null;
    }
  }

  private base64UrlDecode(str: string): string {
    // Convert from base64url to base64
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const decoded = atob(padded);
    return decodeURIComponent(decoded.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  }

  private setUser(u: GoogleUserProfile | null) {
    this.user = u;
    if (u) {
      const finalize = () => { localStorage.setItem(GoogleAuthService.LS_KEY, JSON.stringify(u)); this.emit(); };
      const verifyEndpoint = this.verifyUrl || (this.apiBase ? this.apiBase.replace(/\/$/, '') + '/verify' : undefined);
      // If nickname missing try backend FIRST so same Gmail gets consistent handle across devices
      if (!u.nickname) {
        if (verifyEndpoint && !this.verifying) {
          this.verifying = true;
          fetch(verifyEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: u.idToken })
          }).then(async r => {
            if (r.ok) {
              const data = await r.json().catch(()=>null);
              if (data && data.nickname) {
                u.nickname = data.nickname;
                u.profileComplete = !!data.profileComplete;
                finalize();
                return;
              }
            }
            // Still no nickname – generate local fallback then finalize
            return import('./NicknameGenerator').then(mod => {
              try { u.nickname = mod.generateNickname(); u.profileComplete = false; } catch {/* ignore */}
              finalize();
            }).catch(()=> finalize());
          }).catch(err => {
            console.warn('[Auth] Verify (pre-nickname restore) failed', err);
            import('./NicknameGenerator').then(mod => {
              try { u.nickname = mod.generateNickname(); u.profileComplete = false; } catch {/* ignore */}
              finalize();
            }).catch(()=> finalize());
          }).finally(()=> { this.verifying = false; });
        } else {
          // No verify endpoint -> local fallback
          import('./NicknameGenerator').then(mod => {
            try { u.nickname = mod.generateNickname(); u.profileComplete = false; } catch {/* ignore */}
            finalize();
          }).catch(()=> finalize());
        }
        return; // emit after async path
      }
      // If nickname present already, still run verification (non-blocking) to refresh profile completeness / backend canonical nickname.
      if (verifyEndpoint && !this.verifying) {
        this.verifying = true;
        fetch(verifyEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: u.idToken })
        }).then(async r => {
          if (!r.ok) throw new Error('verify failed ' + r.status);
          const data = await r.json().catch(()=>null);
          if (data && data.nickname) {
            // If backend has authoritative nickname (e.g. uniqueness enforcement), update local
            if (u.nickname !== data.nickname) { u.nickname = data.nickname; }
            if (data.profileComplete != null) u.profileComplete = !!data.profileComplete;
            finalize();
          }
        }).catch(err => { console.warn('[Auth] Backend verify failed', err); })
          .finally(()=>{ this.verifying = false; });
      }
      finalize();
    } else {
      localStorage.removeItem(GoogleAuthService.LS_KEY);
      this.emit();
    }
  }

  private restoreFromStorage() {
    try {
      const raw = localStorage.getItem(GoogleAuthService.LS_KEY);
      if (raw) {
        const parsed: GoogleUserProfile = JSON.parse(raw);
        this.user = parsed;
      }
    } catch {
      // ignore
    }
  }

  /** Allow user to set or change nickname (marks profile complete). */
  setNickname(nickname: string) {
    if (!this.user) return;
    this.user.nickname = nickname.trim().slice(0, 24);
    this.user.profileComplete = true;
    localStorage.setItem(GoogleAuthService.LS_KEY, JSON.stringify(this.user));
    this.emit();
    // Optionally push nickname update to backend
    const profileEndpoint = this.verifyUrl ? this.verifyUrl.replace(/\/verify$/, '/profile') : (this.apiBase ? this.apiBase.replace(/\/$/, '') + '/profile' : undefined);
    if (profileEndpoint) {
      fetch(profileEndpoint, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ idToken: this.user.idToken, nickname: this.user.nickname })
      }).catch(()=>{});
    }
  }

  /** Returns true if token is still valid; if near expiry attempts silent refresh (one-tap) */
  async ensureValidToken(): Promise<boolean> {
    if (!this.tokenExpEpochSec) return !!this.user; // unknown => assume valid
    const nowSec = Date.now() / 1000;
    // If token expires in < 60s attempt re-auth
    if (this.tokenExpEpochSec - nowSec < 60) {
      try {
        const refreshed = await this.signIn();
        return !!refreshed;
      } catch {
        return false;
      }
    }
    return true;
  }

  private emit() {
    for (let i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](this.user); } catch {/* ignore */}
    }
    // Also broadcast a DOM event for non-subscribed legacy code.
    window.dispatchEvent(new CustomEvent('authChanged', { detail: this.user }));
  }

  /** Render an explicit sign-in modal with a Google button if one-tap fails */
  renderFallbackModal(resolve: (v: GoogleUserProfile | null)=>void) {
    if (!window.google?.accounts?.id) { resolve(this.user); return; }
    // Avoid duplicates
    if (document.getElementById('auth-fallback-modal')) { resolve(this.user); return; }
    const modal = document.createElement('div');
    modal.id = 'auth-fallback-modal';
    modal.innerHTML = `
      <div class="afm-shell">
        <div class="afm-panel">
          <h2>Sign In</h2>
          <p>Continue with Google to personalize highscores & saves.</p>
          <div id="gis-btn-container"></div>
          <button class="afm-close" data-close>Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => { modal.remove(); resolve(this.user); };
    modal.querySelector('[data-close]')?.addEventListener('click', close);
    // Render button
    try {
      window.google.accounts.id.initialize({
        client_id: this.clientId,
        callback: (resp: any) => {
          const profile = this.decodeCredential(resp.credential);
          if (profile) {
            this.setUser(profile);
            modal.remove();
            resolve(profile);
          }
        }
      });
      window.google.accounts.id.renderButton(
        modal.querySelector('#gis-btn-container'),
        { theme: 'outline', size: 'large', width: 280 }
      );
    } catch {
      // If render fails just resolve current state
      resolve(this.user);
    }
  }

  /**
   * Explicitly open the login modal (skips relying on one-tap). Useful for a dedicated
   * "SIGN IN" button when auto one-tap didn't appear or was dismissed previously.
   */
  async openLogin(): Promise<GoogleUserProfile | null> {
    if (this.user) return this.user; // already signed in
    if (!this.clientId) return null;
    if (!this.scriptLoaded) await this.loadScript();
    return new Promise<GoogleUserProfile | null>(resolve => {
      this.renderFallbackModal(resolve);
    });
  }

  /** Opens Google OAuth in a new tab (implicit id_token flow) and resolves when token is returned. */
  async openNewTabSignIn(): Promise<GoogleUserProfile | null> {
    if (this.user) return this.user;
    if (!this.clientId) { console.warn('[Auth] Missing client id'); return null; }
    const nonce = Math.random().toString(36).slice(2);
    let redirectUri = (import.meta as any).env?.VITE_GOOGLE_REDIRECT_URI || (window.location.origin + '/oauth-callback.html');
    try {
      // Allow runtime override for debugging (no rebuild) via localStorage or global var.
      const lsOverride = localStorage.getItem('auth.redirectOverride');
      const globalOverride = (window as any).__authRedirectOverride;
      if (lsOverride && /^https?:\/\//i.test(lsOverride)) redirectUri = lsOverride;
      else if (globalOverride && typeof globalOverride === 'string' && /^https?:\/\//i.test(globalOverride)) redirectUri = globalOverride;
    } catch {/* ignore */}
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'
      + new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: redirectUri,
        response_type: 'id_token',
        scope: 'openid email profile',
        nonce,
        prompt: 'select_account'
      }).toString();
    if (import.meta.env.DEV) {
      console.info('[Auth][Debug] redirect_uri=', redirectUri);
      console.info('[Auth][Debug] authUrl=', authUrl);
    }
    // Listen for storage event
    const storageKey = 'auth.oauthReturn';
    return new Promise<GoogleUserProfile | null>((resolve) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey && e.newValue) {
          try {
            const data = JSON.parse(e.newValue);
            if (data.nonce === nonce && data.idToken) {
              window.removeEventListener('storage', onStorage);
              localStorage.removeItem(storageKey);
              const profile = this.decodeCredential(data.idToken);
              if (profile) {
                this.setUser(profile);
                resolve(profile);
                return;
              }
            }
          } catch {/* ignore */}
        }
      };
      window.addEventListener('storage', onStorage);
      // Fallback poll (in case storage event doesn't fire in some browsers for same-origin open tabs)
      const poll = () => {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          try {
            const data = JSON.parse(raw);
            if (data.nonce === nonce && data.idToken) {
              window.removeEventListener('storage', onStorage);
              localStorage.removeItem(storageKey);
              const profile = this.decodeCredential(data.idToken);
              if (profile) { this.setUser(profile); resolve(profile); return; }
            }
          } catch {/* ignore */}
        }
        if (!this.user) setTimeout(poll, 1000);
      };
      setTimeout(poll, 1500);
      const win = window.open(authUrl, '_blank', 'noopener');
      if (!win) {
        console.warn('[Auth] window.open blocked; falling back to same-window navigation');
        try { window.location.href = authUrl; } catch {/* ignore */}
        // Also schedule a very late fallback modal if still no user after 6s (in case nav blocked)
        setTimeout(()=>{ if (!this.user) { this.maybeShowConfigHelp(); this.openLogin().then(resolve); } }, 6000);
      } else {
        // Safety: if user closes tab without completing, offer modal after timeout
        setTimeout(()=>{ if (!this.user) { console.info('[Auth] New-tab flow timeout; showing fallback modal'); this.maybeShowConfigHelp(); this.openLogin().then(resolve); } }, 15000);
      }
    });
  }

  /** Display a one-time configuration help modal if origin/redirect not set correctly. */
  private maybeShowConfigHelp() {
    if (this.configHelpShown || this.user) return;
    this.configHelpShown = true;
    try {
      const existing = document.getElementById('auth-config-help');
      if (existing) return; // already
      const div = document.createElement('div');
      div.id = 'auth-config-help';
      div.innerHTML = `
        <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);z-index:5000;font-family:Arial,Helvetica,sans-serif;">
          <div style="background:#061822;border:1px solid #00ffe5;border-radius:14px;max-width:560px;padding:28px 34px;color:#c8f9ff;line-height:1.4;">
            <h2 style="margin:0 0 12px;font:700 22px/1 'Orbitron',Arial;letter-spacing:3px;color:#00ffe5;">Google Sign-In Setup Needed</h2>
            <p style="font-size:13px;opacity:.85;">No token returned yet. If a Google error page mentioned <code>redirect_uri_mismatch</code> or origin not allowed, add these items in Google Cloud Console &gt; Credentials &gt; OAuth 2.0 Client (Web):</p>
            <ol style="font-size:12px;opacity:.8;padding-left:18px;">
              <li>Authorized JavaScript origins: <code>${location.origin}</code></li>
              <li>Authorized redirect URIs: <code>${location.origin}/oauth-callback.html</code></li>
              <li>Use the Client ID in your .env (VITE_GOOGLE_CLIENT_ID) or meta tag.</li>
            </ol>
            <p style="font-size:12px;opacity:.75;">After saving, wait 1–2 minutes, hard reload (Ctrl+Shift+R) and try again.</p>
            <button id="auth-config-help-close" style="margin-top:14px;background:#093642;color:#dff;border:1px solid #00ffe5;border-radius:8px;padding:8px 16px;cursor:pointer;font:600 12px 'Orbitron';letter-spacing:2px;">CLOSE</button>
          </div>
        </div>`;
      document.body.appendChild(div);
      div.querySelector('#auth-config-help-close')?.addEventListener('click', ()=> div.remove());
    } catch {/* ignore */}
  }

  /** Popup-based OAuth (access token) flow; then silently tries to acquire ID token. */
  async popupAccessSignIn(): Promise<GoogleUserProfile | null> {
    if (this.user) return this.user;
    if (!this.clientId) return null;
    if (!this.scriptLoaded) { console.info('[Auth][Debug] Loading GIS script for popup flow'); await this.loadScript(); }
    if (!window.google?.accounts?.oauth2) {
      console.warn('[Auth] oauth2 API not present');
      return null;
    }
    return new Promise<GoogleUserProfile | null>((resolve) => {
      try {
        console.info('[Auth][Debug] Initializing token client');
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
            scope: 'openid email profile',
          callback: async (resp: any) => {
            console.info('[Auth][Debug] tokenClient callback resp=', resp);
            if (!resp || resp.error) { resolve(null); return; }
            const accessToken = resp.access_token;
            try {
              const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: 'Bearer ' + accessToken }
              });
              const info = await r.json();
              console.info('[Auth][Debug] userinfo response', info);
              if (info && info.sub) {
                const user: GoogleUserProfile = {
                  id: info.sub,
                  name: info.name || info.given_name || 'Player',
                  email: info.email,
                  picture: info.picture,
                  idToken: '' // will try to upgrade below
                };
                this.setUser(user);
                resolve(user);
                // Attempt silent ID token acquisition for backend verify
                try {
                  if (window.google?.accounts?.id) {
                    console.info('[Auth][Debug] Attempting silent ID token upgrade');
                    window.google.accounts.id.initialize({
                      client_id: this.clientId,
                      callback: (credResp: any) => {
                        console.info('[Auth][Debug] id.initialize callback', credResp?.credential ? 'credential received' : 'no credential');
                        const prof = this.decodeCredential(credResp.credential);
                        if (prof) {
                          // Preserve nickname/profileComplete if already set
                          if (this.user?.nickname) prof.nickname = this.user.nickname;
                          if (this.user?.profileComplete) prof.profileComplete = this.user.profileComplete;
                          this.setUser(prof);
                        }
                      },
                      auto_select: true,
                      cancel_on_tap_outside: true
                    });
                    window.google.accounts.id.prompt();
                  }
                } catch {/* ignore */}
              } else {
                resolve(null);
              }
            } catch {
              resolve(null);
            }
          }
        });
        try { tokenClient.requestAccessToken(); } catch(e){ console.warn('[Auth][Debug] requestAccessToken threw', e); resolve(null); }
      } catch (e) {
        console.warn('[Auth] popupAccessSignIn failed', e);
        resolve(null);
      }
    });
  }
}

export const googleAuthService = new GoogleAuthService();

// Convenience: attach to window for quick manual debugging in dev.
if (import.meta.env.DEV) {
  (window as any).googleAuthService = googleAuthService;
  (window as any).debugSignInFlow = () => {
    console.info('[AuthDebug] isConfigured=', googleAuthService.isConfigured(), 'isReady=', googleAuthService.isReady());
    googleAuthService.openNewTabSignIn().catch(e=>console.warn('[AuthDebug] openNewTabSignIn error', e));
  };
}
