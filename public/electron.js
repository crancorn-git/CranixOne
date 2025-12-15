const { app, BrowserWindow, ipcMain, Notification, Tray, Menu } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let win;
let tray;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    title: "CranixOne",
    icon: __dirname + '/favicon.ico',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  win.setMenuBarVisibility(false);

  // Close to Tray behavior
  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
    return false;
  });

  // Load App
  const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, '../build/index.html')}`;
  win.loadURL(startUrl);

  win.once('ready-to-show', () => {
    win.show();
    if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify();

    // Setup Tray
    tray = new Tray(__dirname + '/favicon.ico');
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open CranixOne', click: () => win.show() },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('CranixOne - Secure Terminal');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => win.show());
  });
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Notifications
ipcMain.on('show-notification', (event, { title, body }) => {
  new Notification({ title, body, icon: __dirname + '/favicon.ico' }).show();
});

// AutoUpdater events (Optional - keeping generic listeners)
autoUpdater.on('update-available', () => {
  if(win) win.webContents.send('updater_message', { status: 'available' });
});
autoUpdater.on('update-downloaded', () => {
  if(win) win.webContents.send('updater_message', { status: 'downloaded' });
  setTimeout(() => autoUpdater.quitAndInstall(), 5000);
});