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
    // Vite dev server default port
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
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