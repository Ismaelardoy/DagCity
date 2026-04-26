const { app, BrowserWindow } = require('electron');
const path = require('path');

// ── GPU Acceleration Switches (CRITICAL for WebGL Performance) ──
// These switches force maximum 3D performance and prevent Chrome GPU blocks
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-gpu-compositing');
app.commandLine.appendSwitch('enable-native-gpu-memory-buffers');
app.commandLine.appendSwitch('enable-features=VaapiVideoDecoder');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-direct3d-11-compositing');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    // Start maximized for professional desktop app experience
    show: false,
    autoHideMenuBar: true, // Hide default menu bar for corporate look
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#000408',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Enable hardware acceleration
      webgl: true,
      experimentalFeatures: true,
      // Allow local file access if needed
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  // Load the local docker-compose address
  // Adjust the port if your backend uses a different one
  mainWindow.loadURL('http://localhost:8080');

  // Show window when ready to avoid flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle navigation errors (e.g., if backend is not running)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
    
    // Show error page if backend is not running
    mainWindow.loadURL(`data:text/html;charset=utf-8,
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>DagCity - Backend Not Running</title>
        <style>
          body {
            background: linear-gradient(135deg, #0a0f16 0%, #0f141a 100%);
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .container {
            text-align: center;
            padding: 40px;
            border: 1px solid #003366;
            border-radius: 8px;
            background: rgba(0, 20, 40, 0.8);
          }
          h1 { color: #00aaff; margin-bottom: 20px; }
          p { font-size: 16px; line-height: 1.6; }
          .code {
            background: #001122;
            padding: 15px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            margin: 20px 0;
            color: #00ff88;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>DagCity Desktop</h1>
          <p>Backend service is not running.</p>
          <p>Please start the Docker container:</p>
          <div class="code">docker compose up</div>
          <p>Then restart the application.</p>
        </div>
      </body>
      </html>
    `);
  });

  // Open DevTools in development (optional - comment out for production)
  // mainWindow.webContents.openDevTools();
}

// App lifecycle
app.whenReady().then(() => {
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

// Handle certificate errors (for local development with self-signed certs if needed)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // Allow all certificates for localhost (development only)
  if (url.includes('localhost')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
