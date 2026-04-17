/**
 * WeFlow - A workflow automation tool
 * Main entry point
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/** Whether the app is running in development mode */
const isDev = process.env.NODE_ENV === 'development';

/** Reference to the main application window */
let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main application window with appropriate settings
 */
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'WeFlow',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
    backgroundColor: '#1e1e2e',
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready to avoid flickering
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Ensures the user data directory exists for storing app data
 */
function ensureUserDataDir(): void {
  const userDataPath = app.getPath('userData');
  const workflowsDir = path.join(userDataPath, 'workflows');

  if (!fs.existsSync(workflowsDir)) {
    fs.mkdirSync(workflowsDir, { recursive: true });
  }
}

// App lifecycle events
app.whenReady().then(() => {
  ensureUserDataDir();
  createMainWindow();

  app.on('activate', () => {
    // On macOS, re-create a window when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep the app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-user-data-path', () => app.getPath('userData'));

ipcMain.handle('open-external', async (_event, url: string) => {
  await shell.openExternal(url);
});
