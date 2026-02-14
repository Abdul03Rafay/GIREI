const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

const fs = require('fs');
const os = require('os');

let pyProc = null;

const { exec } = require('child_process');

// Logger setup
let logPath;

function log(message) {
    if (!logPath) {
        try {
            logPath = path.join(app.getPath('userData'), 'chat_app_debug.log');
        } catch (e) {
            console.log(message);
            return;
        }
    }
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(logPath, logMessage);
    } catch (e) {
        console.error('Failed to write to log:', e);
    }
    console.log(message);
}

function killExistingServer() {
    return new Promise((resolve) => {
        log('Attempting to kill existing server on port 8000...');
        const cmd = 'lsof -ti:8000 | xargs kill -9';
        exec(cmd, { env: { ...process.env, PATH: '/usr/sbin:/usr/bin:/bin:' + process.env.PATH } }, (error, stdout, stderr) => {
            if (error) {
                log(`Kill command had error (might be no process): ${error.message}`);
            } else {
                log('Kill command executed successfully');
            }
            resolve();
        });
    });
}

function checkPythonVersion(pythonPath) {
    try {
        require('child_process').execSync(`"${pythonPath}" -c "import fastapi; import uvicorn; import requests"`, {
            stdio: 'ignore'
        });
        return true;
    } catch (e) {
        log(`Python at ${pythonPath} does not have required modules (fastapi, uvicorn, requests)`);
        return false;
    }
}

function findPython() {
    const possibilities = [
        path.join(process.resourcesPath, 'venv', 'bin', 'python3'),
        path.join(__dirname, 'venv', 'bin', 'python3'),
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3',
        'python3' // Fallback to PATH lookup
    ];

    for (const p of possibilities) {
        if (p === 'python3') {
            // For PATH lookup, we just try to run it
            try {
                if (checkPythonVersion('python3')) {
                    log('Found valid python3 in PATH');
                    return 'python3';
                }
            } catch (e) { }
            continue;
        }

        if (fs.existsSync(p)) {
            log(`Checking python at: ${p}`);
            if (checkPythonVersion(p)) {
                log(`Found valid python with dependencies at: ${p}`);
                return p;
            }
        }
    }

    log('Could not find python with dependencies. Using "python3" as last resort.');
    return 'python3';
}

function startPythonSubprocess() {
    killExistingServer().then(() => {
        const scriptPath = path.join(__dirname, 'backend', 'server.py');
        const backendDir = path.join(__dirname, 'backend');
        const pythonExecutable = findPython();

        log(`Starting Python server...`);
        log(`Script: ${scriptPath}`);
        log(`CWD: ${backendDir}`);
        log(`Python Executable: ${pythonExecutable}`);

        pyProc = spawn(pythonExecutable, [scriptPath], {
            cwd: backendDir,
            stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        if (pyProc != null) {
            log(`Python process spawned, pid: ${pyProc.pid}`);

            pyProc.stdout.on('data', (data) => {
                log(`[PY STDOUT] ${data.toString().trim()}`);
            });

            pyProc.stderr.on('data', (data) => {
                log(`[PY STDERR] ${data.toString().trim()}`);
            });

            pyProc.on('close', (code) => {
                log(`Python process exited with code ${code}`);
            });

            pyProc.on('error', (err) => {
                log(`Failed to start python subprocess: ${err.message}`);
            });
        } else {
            log('Failed to spawn python process object is null');
        }
    });
}

function exitPyProc() {
    if (pyProc != null) {
        log('Killing python process before quit...');
        pyProc.kill();
        pyProc = null;
    }
}

let tray = null;
let win = null;

function createTray() {
    if (tray) return;

    const iconPath = path.join(__dirname, 'menu-icon.png');
    // Resize image for Tray (needs to be small, usually 16x16 or 22x22 points)
    const image = nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 });

    tray = new Tray(image);
    tray.setToolTip('DeepSeek Chat');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => showWindow() },
        { type: 'separator' },
        {
            label: 'Quit', click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        toggleWindow();
    });
}

function destroyTray() {
    if (tray) {
        tray.destroy();
        tray = null;
    }
}

function showWindow() {
    if (win) {
        if (process.platform === 'darwin') {
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            win.setAlwaysOnTop(true, 'floating', 1);
        }
        win.show();
        win.focus();
    }
}

function toggleWindow() {
    if (!win || win.isDestroyed()) {
        createWindow();
        return;
    }
    if (win.isVisible()) {
        win.hide();
    } else {
        showWindow();
    }
}

function createWindow() {
    win = new BrowserWindow({
        width: 900,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // For simple prototype; use preload in prod
        },
        vibrancy: 'sidebar',
        visualEffectState: 'followWindow',
        backgroundColor: '#00000000',
        transparent: true,
        hasShadow: false,
        frame: false,
        titleBarStyle: 'hidden',
    });

    if (process.platform === 'darwin') {
        win.setWindowButtonVisibility(false);
    }

    // MacOS specific: ensure window floats above fullscreen apps
    if (process.platform === 'darwin') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setAlwaysOnTop(true, 'floating', 1);
        win.setFullScreenable(false);
    } else {
        win.setAlwaysOnTop(true, 'floating', 1);
    }

    win.loadFile('index.html');
    // win.webContents.openDevTools({ mode: 'detach' });

    // Handle close to hide instead of quit if tray is enabled (MacOS behavior mostly, but custom here)
    // Actually, we want standard behavior unless tray is active.
    // Let's implement Tray Toggle IPC first.

    win.on('closed', () => {
        win = null;
    });
}

// IPC Handlers
ipcMain.handle('toggle-tray', (event, enabled) => {
    if (enabled) {
        createTray();
    } else {
        destroyTray();
        if (win && !win.isVisible()) win.show();
    }
    return true;
});

ipcMain.on('minimize-window', () => {
    if (win) win.minimize();
});

ipcMain.on('close-window', () => {
    if (win && !win.isDestroyed()) {
        win.hide();
    }
});

ipcMain.handle('get-history-path', () => {
    return path.join(app.getPath('userData'), 'chat_history.json');
});

// History Persistence Handlers
ipcMain.handle('save-history', async (event, history) => {
    try {
        const historyPath = path.join(app.getPath('userData'), 'chat_history.json');
        fs.writeFileSync(historyPath, JSON.stringify(history));
        return { success: true };
    } catch (error) {
        log(`Failed to save history: ${error.message}`);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('load-history', async () => {
    try {
        const historyPath = path.join(app.getPath('userData'), 'chat_history.json');
        if (fs.existsSync(historyPath)) {
            const data = fs.readFileSync(historyPath, 'utf-8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        log(`Failed to load history: ${error.message}`);
        return [];
    }
});

app.whenReady().then(() => {
    startPythonSubprocess();
    createWindow();

    // Register global shortcut
    globalShortcut.register('Alt+Space', () => {
        if (win) {
            toggleWindow();
        }
    });

    // Check if we should start with tray?
    // The renderer will tell us on load based on localStorage, but that might be late.
    // For now, start without tray until renderer requests it.

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else {
            showWindow();
        }
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    exitPyProc();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
