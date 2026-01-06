const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { runGenerate, stopGenerate } = require('../automation/generator');
const { runLoginAll } = require('../automation/loginallaccount');
const fsPromises = fs.promises;

async function getDirSize(dirPath) {
    let size = 0;
    try {
        const files = await fsPromises.readdir(dirPath);
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = await fsPromises.stat(filePath);
            if (stats.isDirectory()) {
                size += await getDirSize(filePath);
            } else {
                size += stats.size;
            }
        }
    } catch (e) {
        // ignore missing dir or permissions for now
    }
    return size;
}

let mainWindow;

function createWindow() {
    const iconPath = process.platform === 'win32'
        ? path.join(__dirname, '../../assets/logo.ico')
        : path.join(__dirname, '../../assets/logo1.png');

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#0f172a',
        icon: iconPath,
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        frame: false, // Frameless window
        titleBarStyle: 'hidden', // Hide default title bar but keep controls overlay (on Mac) / clean (on Win)
    });

    // Check if we are in dev mode (env var or argv)
    // Simple check: if we can connect to localhost:5173
    // But for now, let's assume if 'npm start' is run while 'vite' is running, we load url
    // Or we can just try to load the file if url fails? 
    // Standard electron-vite usually uses an env var.

    // For this simple setup:
    // We can default to file, but if env.VITE_DEV_SERVER_URL is set (by some runner), use it.
    // Or just hardcode for this demo or check arg.

    // Check for explicit dev environment
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ——— Auto-Updater Logic ———
function setupAutoUpdater() {
    autoUpdater.logger = require("electron-log");
    autoUpdater.logger.transports.file.level = "info";

    // Check for updates and notify
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', (info) => {
        if (mainWindow) mainWindow.webContents.send('update-available', info);
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow) mainWindow.webContents.send('update-downloaded', info);
    });

    autoUpdater.on('error', (err) => {
        if (mainWindow) mainWindow.webContents.send('update-error', err.toString());
    });
}

// Trigger check on startup
app.whenReady().then(() => {
    setupAutoUpdater();
});

ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
});


// ——— IPC Handlers ———

ipcMain.on('minimize', () => mainWindow.minimize());
ipcMain.on('maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
});
ipcMain.on('close', () => mainWindow.close());

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// Helper to get profiles path based on OS
// Helper to get profiles path based on OS
function getProfilesRoot() {
    return path.join(app.getPath('userData'), 'profiles');
}

let isAutomationRunning = false;

ipcMain.on('start-automation', async (event, config) => {
    if (isAutomationRunning) {
        event.sender.send('log-update', 'Automation is already running!');
        return;
    }

    isAutomationRunning = true;
    event.sender.send('automation-status', 'running');
    event.sender.send('log-update', 'Starting automation...');
    console.log('[Main] Received config:', JSON.stringify(config, null, 2)); // DEBUG
    console.log('[Main] Duration:', config.duration); // DEBUG

    try {
        // Read accounts from file
        let accounts = [];
        if (fs.existsSync(ACCOUNTS_FILE)) {
            try {
                accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
            } catch (e) {
                event.sender.send('log-update', 'Error reading accounts file.');
            }
        }

        if (accounts.length === 0) {
            event.sender.send('log-update', 'No accounts found. Please add accounts in the Accounts tab.');
            event.sender.send('automation-status', 'stopped');
            isAutomationRunning = false;
            return;
        }

        const params = {
            ...config,
            images: config.imagePaths, // Map config.imagePaths to params.images
            accounts: accounts,
            userDataPath: app.getPath('userData'),
            profilesRoot: getProfilesRoot()
        };

        event.sender.send('log-update', `Mode: ${config.mode.toUpperCase()}`);
        event.sender.send('log-update', `Prompts: ${config.prompts.length}`);
        if (config.mode === 'image') {
            event.sender.send('log-update', `Images: ${config.imagePaths.length}`);
        }

        // Run the generator
        // Run the generator
        // We pass a log callback that sends IPC messages back to renderer
        await runGenerate(
            params,
            (msg) => event.sender.send('log-update', msg),
            (idx, status) => event.sender.send('item-status', { index: idx, status: status }),
            (data) => event.sender.send('account-update', data)
        );

        event.sender.send('log-update', 'Automation finished.');
        event.sender.send('automation-status', 'stopped');

    } catch (err) {
        event.sender.send('log-update', `Error: ${err.message}`);
        event.sender.send('automation-status', 'stopped');
    } finally {
        isAutomationRunning = false;
        event.sender.send('automation-status', 'stopped');
    }
});

ipcMain.on('stop-automation', () => {
    stopGenerate();
    isAutomationRunning = false;
    if (mainWindow) {
        mainWindow.webContents.send('log-update', 'Stopping automation...');
        mainWindow.webContents.send('automation-status', 'stopped');
    }
});

// Accounts Management
const ACCOUNTS_FILE = path.join(app.getPath('userData'), 'accounts.json');

ipcMain.on('get-accounts', (event) => {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
            event.sender.send('accounts-data', JSON.parse(data));
        } else {
            event.sender.send('accounts-data', []);
        }
    } catch (err) {
        event.sender.send('accounts-data', []);
    }
});

ipcMain.on('save-accounts', (event, accounts) => {
    try {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
        event.sender.send('log-update', 'Accounts saved successfully.');
    } catch (err) {
        event.sender.send('log-update', `Error saving accounts: ${err.message}`);
    }
});

ipcMain.on('login-accounts', async (event) => {
    event.sender.send('log-update', 'Starting login process for all accounts...');

    try {
        let accounts = [];
        if (fs.existsSync(ACCOUNTS_FILE)) {
            accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        }

        if (accounts.length === 0) {
            event.sender.send('log-update', 'No accounts to login.');
            event.sender.send('log-update', 'Please add accounts first.');
            return;
        }

        const profilesRoot = getProfilesRoot();

        // Ensure directory exists
        if (!fs.existsSync(profilesRoot)) {
            fs.mkdirSync(profilesRoot, { recursive: true });
        }

        event.sender.send('log-update', `Profiles location: ${profilesRoot}`);

        const results = await runLoginAll(
            accounts,
            (msg) => event.sender.send('log-update', msg),
            { profilesRoot, keepBrowserOpen: false }
        );

        // Update accounts status based on results
        const updatedAccounts = accounts.map(acc => {
            const res = results.find(r => r.email === acc.email);
            if (res) {
                return { ...acc, status: res.success ? 'Active' : 'Error' };
            }
            return acc;
        });

        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(updatedAccounts, null, 2));
        event.sender.send('accounts-data', updatedAccounts);
        event.sender.send('log-update', 'Login process completed.');

    } catch (err) {
        event.sender.send('log-update', `Login Error: ${err.message}`);
    }
});

const { dialog } = require('electron');
ipcMain.handle('open-directory-dialog', async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled) return null;
    return result.filePaths[0];
});

ipcMain.handle('get-bios-serial', async () => {
    return new Promise((resolve) => {
        const cmd = process.platform === 'win32'
            ? 'wmic bios get serialnumber'
            : 'system_profiler SPHardwareDataType | grep "Serial Number (system)"';

        exec(cmd, (error, stdout) => {
            if (error) {
                resolve('UNKNOWN_DEVICE_ID');
                return;
            }
            const lines = stdout.trim().split('\n');
            // Windows usually returns "SerialNumber\nValue", so take the last non-empty line
            const serial = lines[lines.length - 1].trim();
            resolve(serial || 'UNKNOWN_DEVICE_ID');
        });
    });
});

// Helper function to get directory size recursively
async function getDirSize(dirPath) {
    let totalSize = 0;
    try {
        const files = await fsPromises.readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                totalSize += await getDirSize(fullPath);
            } else {
                const stats = await fsPromises.stat(fullPath);
                totalSize += stats.size;
            }
        }
    } catch (error) {
        // Ignore errors for inaccessible files/directories, treat as 0 size
        if (error.code === 'ENOENT') {
            return 0; // Directory does not exist
        }
        console.warn(`Error getting size for ${dirPath}: ${error.message}`);
    }
    return totalSize;
}

// Profile & Account Management Handlers
ipcMain.handle('get-profiles-size', async () => {
    const root = getProfilesRoot();
    const sizeBytes = await getDirSize(root);
    // Convert to readable format
    if (sizeBytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(sizeBytes) / Math.log(k));
    return parseFloat((sizeBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

ipcMain.handle('delete-all-profiles', async () => {
    const root = getProfilesRoot();
    try {
        await fsPromises.rm(root, { recursive: true, force: true });
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clear-accounts', async () => {
    try {
        await fsPromises.writeFile(ACCOUNTS_FILE, JSON.stringify([], null, 2), 'utf8');
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
