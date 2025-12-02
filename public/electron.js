const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Check if we are in development or production
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "CranixOne",
    icon: __dirname + '/favicon.ico',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // Helps with local media streams
    },
  });

  win.setMenuBarVisibility(false);

  // --- PERMISSION HANDLERS (Force Allow Microphone) ---
  
  // 1. Handle the check (used by some Electron versions)
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') {
      return true; // Allow
    }
    return false;
  });

  // 2. Handle the request (used by others)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true); // Approve
    } else {
      callback(false);
    }
  });

  // --- LOAD APP ---
  win.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

const { autoUpdater } = require('electron-updater');

// Check for updates as soon as app opens
app.on('ready', () => {
  autoUpdater.checkForUpdatesAndNotify();
});