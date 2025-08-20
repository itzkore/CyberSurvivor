const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');
const fetch = (...args) => import('node-fetch').then(m => m.default(...args)).catch(() => Promise.reject(new Error('node-fetch missing')));
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#000000',
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // WHAT: Run renderer in Chromium sandbox. WHY: Stronger process isolation.
      enableRemoteModule: false, // WHAT: Disable deprecated remote module. WHY: Prevent remote-based RCE vectors.
      webgl: true,
      backgroundThrottling: false, // keep RAF cadence even if window not focused
      spellcheck: false,
      // Allow forcing devtools in a production (packaged) build when DEVTOOLS=1
      devTools: process.env.NODE_ENV === 'development' || process.env.DEVTOOLS === '1',
      enableBlinkFeatures: 'Accelerated2dCanvas',
      // Additional guardrails (explicit even if defaults):
      webSecurity: true, // Enforce same-origin & CSP.
      allowRunningInsecureContent: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    console.log('[electron] loading index from', indexPath);
    mainWindow.webContents.once('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
      console.error('[electron] did-fail-load', { errorCode, errorDesc, validatedURL });
    });
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[electron] did-finish-load');
    });
    try {
      mainWindow.loadFile(indexPath);
    } catch (err) {
      console.error('[electron] Failed to load index.html at', indexPath, err);
    }
  // DevTools disabled in production for performance (enable manually if needed)
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
    if (process.env.DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }
}


// ---- Google OAuth (PKCE) Support ----
let currentUser = null; // in-memory user profile (email, name, picture)
let oauthTokens = null; // access / refresh tokens (memory only)

function base64UrlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

function createCodeVerifier() { return base64UrlEncode(crypto.randomBytes(32)); }
function createCodeChallenge(verifier) { return base64UrlEncode(crypto.createHash('sha256').update(verifier).digest()); }

async function startGoogleAuth() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID; // MUST be set by user (Desktop application credential)
  if (!clientId) throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID environment variable');
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  // Start ephemeral local redirect server
  const server = await new Promise((resolve, reject) => {
    const s = http.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const scope = encodeURIComponent('openid email profile');
  const state = base64UrlEncode(crypto.randomBytes(16));
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&access_type=offline&prompt=consent&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`;

  const authWindow = new BrowserWindow({
    width: 480, height: 640, modal: true, show: true, parent: BrowserWindow.getAllWindows()[0],
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  authWindow.loadURL(authUrl);

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try { server.close(); } catch{}; authWindow.close(); reject(new Error('OAuth timeout')); }, 180000);
    server.on('request', async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || returnedState !== state) { res.writeHead(400).end('Invalid response'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="background:#000;color:#0f0;font-family:monospace;">Login successful. You can close this window.</body></html>');
      clearTimeout(timeout);
      authWindow.close();
      try { server.close(); } catch {}
      resolve(code);
    });
  });

  // Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code: result,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!tokenResp.ok) throw new Error('Token exchange failed');
  const tokenJson = await tokenResp.json();
  oauthTokens = tokenJson; // access_token, refresh_token (if provided)
  // Fetch userinfo (OpenID Connect)
  const userResp = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  if (userResp.ok) {
    currentUser = await userResp.json();
  } else {
    currentUser = null;
  }
  return currentUser;
}

ipcMain.handle('auth:google', async () => {
  try { return { ok: true, user: await startGoogleAuth() }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('auth:getUser', async () => ({ user: currentUser }));
ipcMain.handle('auth:logout', async () => { currentUser = null; oauthTokens = null; return { ok: true }; });
// -------------------------------------

// GPU flag profiles to experiment with jitter; choose via env GFX=aggressive|baseline|minimal
function applyGpuFlags(profile) {
  const isDev = process.env.NODE_ENV === 'development';
  if (profile === 'minimal') {
    // No extra flags – pure default to see if overrides caused pacing issues
    return;
  }
  if (profile === 'baseline') {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    return;
  }
  if (!isDev) {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    return;
  }
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blacklist');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('force_high_performance_gpu');
  // Optional FPS unlock (set UNLOCK_FPS=1). Beware: can increase power usage & heat.
  if (process.env.UNLOCK_FPS === '1') {
    app.commandLine.appendSwitch('disable-frame-rate-limit');
    app.commandLine.appendSwitch('disable-gpu-vsync'); // allow > display Hz (may cause tearing)
  }
  app.commandLine.appendSwitch('disable-software-rasterizer');
}
applyGpuFlags(process.env.GFX || 'aggressive');

app.whenReady().then(async () => {
  try {
    const gpuInfo = await app.getGPUInfo('basic');
    console.log('[electron] GPU info renderer:', gpuInfo?.auxAttributes?.gl_renderer || 'n/a');
  } catch {
    /* ignore */
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});