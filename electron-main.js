const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Enable hardware acceleration for canvas and 2D rendering
      webgl: true,
      enableBlinkFeatures: 'Canvas2D,Accelerated2dCanvas',
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
    // Open devtools in production temporarily for white screen debugging
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  // Disable hardware acceleration for all processes. This is often done to prevent issues
  // with certain GPU drivers or configurations, but can be re-enabled for specific features.
  // app.disableHardwareAcceleration();

  // Enable GPU rasterization for improved rendering performance.
  app.commandLine.appendSwitch('enable-gpu-rasterization');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});