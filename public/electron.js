const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Config Updater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const isDev = !app.isPackaged;
let win; // Keep reference globally

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "CranixOne",
    icon: __dirname + '/favicon.ico',
    show: false, // Don't show until ready
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  win.setMenuBarVisibility(false);

  // Permission Handlers (Mic/Camera)
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media';
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  // Load App
  win.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../build/index.html')}`
  );

  // Show window when ready to prevent flickering
  win.once('ready-to-show', () => {
    win.show();
    // TRIGGER UPDATE CHECK ON STARTUP
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });
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

// --- AUTO UPDATER EVENTS (Send to React) ---

autoUpdater.on('checking-for-update', () => {
  if(win) win.webContents.send('updater_message', { status: 'checking' });
});

autoUpdater.on('update-available', () => {
  if(win) win.webContents.send('updater_message', { status: 'available' });
});

autoUpdater.on('update-not-available', () => {
  if(win) win.webContents.send('updater_message', { status: 'no_update' });
});

autoUpdater.on('error', (err) => {
  // If error, just let the app open
  if(win) win.webContents.send('updater_message', { status: 'error' });
});

autoUpdater.on('download-progress', (progressObj) => {
  if(win) win.webContents.send('updater_message', { 
    status: 'downloading', 
    progress: progressObj.percent 
  });
});

autoUpdater.on('update-downloaded', () => {
  if(win) win.webContents.send('updater_message', { status: 'downloaded' });
  // Quit and install after 2 seconds
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 2000);
});