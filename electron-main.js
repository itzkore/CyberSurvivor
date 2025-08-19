const { app, BrowserWindow } = require('electron');
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
      webgl: true,
      backgroundThrottling: false, // keep RAF cadence even if window not focused
      spellcheck: false,
      // Allow forcing devtools in a production (packaged) build when DEVTOOLS=1
      devTools: process.env.NODE_ENV === 'development' || process.env.DEVTOOLS === '1',
      enableBlinkFeatures: 'Accelerated2dCanvas',
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

// GPU flag profiles to experiment with jitter; choose via env GFX=aggressive|baseline|minimal
function applyGpuFlags(profile) {
  if (profile === 'minimal') {
    // No extra flags – pure default to see if overrides caused pacing issues
    return;
  }
  if (profile === 'baseline') {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    return;
  }
  // aggressive (current original set)
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