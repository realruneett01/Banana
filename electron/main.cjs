const {
	app,
	BrowserWindow,
	shell,
	ipcMain,
	dialog,
	safeStorage,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { autoUpdater } = require("electron-updater");
const {
	detectSystemGitHub,
	startDeviceFlow,
	pollDeviceFlow,
	saveEncryptedToken,
	loadEncryptedToken,
	clearEncryptedToken,
} = require("./github-auth.cjs");
const { findKicadGui, launchKicad } = require("./kicad-launch.cjs");

// 1. Single Instance Lock (Phase 1 / T1.2)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
	app.quit();
	process.exit(0);
}

let mainWindow = null;
let serverInstance = null;
let serverPort = null;
const apiSecret = crypto.randomBytes(32).toString("hex"); // Phase 2 / T2.1: per-launch secret

// Set up user-writable storage directory for KiCad temp outputs (Phase 2 / T2.3)
const userDataPath = app.getPath("userData");
const desktopTempStorage = path.join(userDataPath, "temp_storage");
const tokenFilePath = path.join(userDataPath, "banana_github.enc");
process.env.BANANA_DATA_DIR = desktopTempStorage;

try {
	if (!fs.existsSync(desktopTempStorage)) {
		fs.mkdirSync(desktopTempStorage, { recursive: true });
	}
} catch (err) {
	console.warn(
		"[Banana Electron] Failed to create userData temp storage:",
		err.message,
	);
}

function validateHostHeader(host) {
	if (!serverPort) return true;
	return (
		host === `127.0.0.1:${serverPort}` || host === `localhost:${serverPort}`
	);
}

/**
 * Starts the local Express backend server bound strictly to 127.0.0.1 (T1.2, T2.2)
 */
async function startLocalBackend() {
	const staticDir = path.resolve(__dirname, "../frontend/dist");
	const appModule = await import("../backend/src/app.js");
	const createApp = appModule.createApp;

	return new Promise((resolve, reject) => {
		const expressApp = createApp({
			staticDir,
			apiSecret,
			validateHost: validateHostHeader,
		});

		const server = expressApp.listen(0, "127.0.0.1", () => {
			serverPort = server.address().port;
			console.log(
				`[Banana Desktop] Express backend running on http://127.0.0.1:${serverPort}`,
			);
			resolve({ server, port: serverPort });
		});

		server.on("error", (err) => {
			console.error("[Banana Desktop] Server startup failed:", err);
			reject(err);
		});
	});
}

/**
 * Creates the main native application window (T1.2, T1.6)
 */
function buildWindowOptions(isDev) {
	return {
		width: 1440,
		height: 920,
		minWidth: 1024,
		minHeight: 700,
		title: "Banana — Hardware Diff Studio",
		backgroundColor: "#0f1015",
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
			devTools: isDev,
		},
		autoHideMenuBar: true,
	};
}

function isDevMode() {
	return process.env.NODE_ENV === "development" || !app.isPackaged;
}

function getAllowedOrigins() {
	const origins = [];
	if (serverPort) {
		origins.push(`http://127.0.0.1:${serverPort}`);
	}
	if (isDevMode()) {
		origins.push("http://localhost:5173");
	}
	return origins;
}

function isAllowedOrigin(origin) {
	if (!origin) return false;
	return getAllowedOrigins().includes(origin);
}

async function openExternalSafe(url) {
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "https:" || parsed.protocol === "http:") {
			await shell.openExternal(url);
			return true;
		}
	} catch (err) {
		console.debug("[Banana Navigation] Invalid external URL:", err.message);
	}
	return false;
}

function handleWindowOpen({ url }) {
	openExternalSafe(url);
	return { action: "deny" };
}

function handleWillNavigate(event, url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch (err) {
		console.debug(
			"[Banana Navigation] Blocked malformed navigation URL:",
			err.message,
		);
		event.preventDefault();
		return;
	}

	if (isAllowedOrigin(parsed.origin)) return;

	event.preventDefault();
	openExternalSafe(url);
}

// Navigation lockdown (T1.6)
function attachNavigationGuards(win) {
	win.webContents.setWindowOpenHandler(handleWindowOpen);
	win.webContents.on("will-navigate", handleWillNavigate);
}

async function resolveTargetUrl(port, isDev) {
	const prodUrl = `http://127.0.0.1:${port}`;
	if (!isDev) return prodUrl;
	try {
		const ping = await fetch("http://localhost:5173");
		return ping.status < 500 ? "http://localhost:5173" : prodUrl;
	} catch (err) {
		console.debug(
			"[Banana Desktop] Vite dev server not reachable:",
			err.message,
		);
		return prodUrl;
	}
}

async function createMainWindow(port) {
	const isDev = isDevMode();

	mainWindow = new BrowserWindow(buildWindowOptions(isDev));
	mainWindow.once("ready-to-show", () => {
		mainWindow.show();
	});
	attachNavigationGuards(mainWindow);

	mainWindow.loadURL(await resolveTargetUrl(port, isDev));

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

function sendUpdaterEvent(channel, info) {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send(channel, info);
	}
}

function scheduleUpdateCheck() {
	setTimeout(() => {
		autoUpdater.checkForUpdatesAndNotify().catch((err) => {
			console.debug(
				"[Banana Updater] Check for updates failed:",
				err?.message || err,
			);
		});
	}, 10000);
}

/**
 * Configure background auto-updater from GitHub Releases (T6.3)
 */
function setupAutoUpdater() {
	if (!app.isPackaged) {
		return; // Updates only run in packaged production builds
	}

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("update-available", (info) => {
		console.log("[Banana Updater] Update available:", info?.version);
		sendUpdaterEvent("banana:update-available", info);
	});

	autoUpdater.on("update-downloaded", (info) => {
		console.log("[Banana Updater] Update downloaded:", info?.version);
		sendUpdaterEvent("banana:update-downloaded", info);
	});

	autoUpdater.on("error", (err) => {
		console.debug("[Banana Updater] Update check error:", err?.message || err);
	});

	scheduleUpdateCheck();
}

// Second instance focus (T1.5)
app.on("second-instance", () => {
	if (mainWindow) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.focus();
	}
});

// App Lifecycle
app.whenReady().then(async () => {
	registerIpcHandlers();
	try {
		const { server, port } = await startLocalBackend();
		serverInstance = server;
		await createMainWindow(port);
		setupAutoUpdater();
	} catch (err) {
		dialog.showErrorBox(
			"Startup Error",
			`Failed to initialize local Banana server: ${err.message}`,
		);
		app.quit();
	}
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	if (serverInstance) {
		try {
			serverInstance.close();
		} catch (err) {
			console.debug(
				"[Banana Desktop] Server close on quit failed:",
				err.message,
			);
		}
	}
});

// ==========================================
// IPC Handlers: GitHub Connect & Local Tools
// ==========================================
function getSenderOrigin(event) {
	const frameUrl = event?.senderFrame?.url;
	if (!frameUrl) return null;
	try {
		return new URL(frameUrl).origin;
	} catch (err) {
		console.debug("[Banana IPC] Invalid sender frame URL:", err.message);
		return null;
	}
}

/**
 * Validates that an IPC event originated from the trusted application origin.
 */
function isTrustedSender(event) {
	const origin = getSenderOrigin(event);
	return isAllowedOrigin(origin);
}

async function handleSelectFolder() {
	const result = await dialog.showOpenDialog(mainWindow, {
		title: "Select KiCad Git Project Folder",
		properties: ["openDirectory"],
	});
	if (!result.canceled && result.filePaths.length > 0) {
		return result.filePaths[0];
	}
	return null;
}

let cachedKicadGui = null;
let kicadGuiChecked = false;

function getKicadGui() {
	if (!kicadGuiChecked) {
		cachedKicadGui = findKicadGui();
		kicadGuiChecked = true;
	}
	return cachedKicadGui;
}

function hasAnyKicadTool(gui) {
	if (!gui) return false;
	const hasEditor = Boolean(gui.eeschema || gui.pcbnew);
	return Boolean(gui.kicad || hasEditor);
}

function getKicadStatus() {
	const gui = getKicadGui();
	const schematic = Boolean(gui?.eeschema || gui?.kicad);
	const pcb = Boolean(gui?.pcbnew || gui?.kicad);
	return {
		installed: hasAnyKicadTool(gui),
		schematic,
		pcb,
	};
}

function isPlainObject(value) {
	if (!value || typeof value !== "object") {
		return false;
	}
	return !Array.isArray(value);
}

function handleKicadOpen(request) {
	if (!isPlainObject(request)) {
		return { ok: false, error: "Invalid request" };
	}
	const { kind, filePath, projectRoot } = request;
	return launchKicad({ kind, filePath, projectRoot }, { gui: getKicadGui() });
}

function registerAppIpcHandlers() {
	// Safe External URL Opener (T1.6)
	ipcMain.handle("banana:open-external", async (_, url) => {
		return openExternalSafe(url);
	});

	// Per-launch API token (T2.1)
	ipcMain.handle("banana:get-api-token", (event) => {
		if (!isTrustedSender(event)) return null;
		return apiSecret;
	});

	// Native Folder Selector Dialog (T3.6)
	ipcMain.handle("banana:select-folder", handleSelectFolder);

	// KiCad Status & Launcher
	ipcMain.handle("banana:kicad-status", (event) => {
		if (!isTrustedSender(event)) return null;
		return getKicadStatus();
	});

	ipcMain.handle("banana:kicad-open", (event, request) => {
		if (!isTrustedSender(event)) {
			return { ok: false, error: "Untrusted sender" };
		}
		return handleKicadOpen(request);
	});
}

function registerGitHubDeviceFlowHandlers() {
	// GitHub System Detection (T3.1)
	ipcMain.handle("banana:gh-detect", async (event) => {
		if (!isTrustedSender(event)) return null;
		return detectSystemGitHub();
	});

	// GitHub Device Flow Start (T3.2)
	ipcMain.handle("banana:gh-device-start", async (_, clientId) => {
		return startDeviceFlow(clientId);
	});

	// GitHub Device Flow Poll (T3.2)
	ipcMain.handle(
		"banana:gh-device-poll",
		async (_, { deviceCode, clientId }) => {
			return pollDeviceFlow(deviceCode, clientId);
		},
	);
}

function registerGitHubTokenHandlers() {
	// Secure Token Storage via OS Keychain (T3.4)
	ipcMain.handle("banana:gh-save-token", async (event, token) => {
		if (!isTrustedSender(event)) return false;
		return saveEncryptedToken(token, safeStorage, tokenFilePath);
	});

	ipcMain.handle("banana:gh-get-token", async (event) => {
		if (!isTrustedSender(event)) return null;
		return loadEncryptedToken(safeStorage, tokenFilePath);
	});

	ipcMain.handle("banana:gh-clear-token", async (event) => {
		if (!isTrustedSender(event)) return false;
		return clearEncryptedToken(tokenFilePath);
	});
}

function registerUpdaterIpcHandlers() {
	// Auto-updater manual trigger (T6.3)
	ipcMain.handle("banana:check-for-updates", async () => {
		if (app.isPackaged) {
			return autoUpdater.checkForUpdates();
		}
		return null;
	});

	ipcMain.handle("banana:quit-and-install", (event) => {
		if (!isTrustedSender(event)) return false;
		if (app.isPackaged) {
			autoUpdater.quitAndInstall();
		}
	});
}

function registerIpcHandlers() {
	registerAppIpcHandlers();
	registerGitHubDeviceFlowHandlers();
	registerGitHubTokenHandlers();
	registerUpdaterIpcHandlers();
}
