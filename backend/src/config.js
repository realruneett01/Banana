import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const CANDIDATES = {
	win32: [
		"C:\\Program Files\\KiCad\\11.0\\bin\\kicad-cli.exe",
		"C:\\Program Files\\KiCad\\10.0\\bin\\kicad-cli.exe",
		"C:\\Program Files\\KiCad\\9.0\\bin\\kicad-cli.exe",
		"C:\\Program Files\\KiCad\\8.0\\bin\\kicad-cli.exe",
		"C:\\Program Files\\KiCad\\7.0\\bin\\kicad-cli.exe",
		"C:\\Program Files\\KiCad\\bin\\kicad-cli.exe",
	],
	darwin: [
		"/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli",
		"/Applications/KiCad 10.0/KiCad.app/Contents/MacOS/kicad-cli",
		"/Applications/KiCad 9.0/KiCad.app/Contents/MacOS/kicad-cli",
		"/Applications/KiCad 8.0/KiCad.app/Contents/MacOS/kicad-cli",
		"/Applications/KiCad 7.0/KiCad.app/Contents/MacOS/kicad-cli",
	],
	linux: [
		"/usr/bin/kicad-cli",
		"/usr/local/bin/kicad-cli",
		"/snap/bin/kicad-cli",
		"/usr/lib/kicad-nightly/bin/kicad-cli",
		"/usr/lib/kicad/bin/kicad-cli",
	],
};

function findKicadOnPath() {
	const finder = os.platform() === "win32" ? "where" : "which";
	try {
		const result = execFileSync(finder, ["kicad-cli"], {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		})
			.trim()
			.split(/\r?\n/)[0];
		if (result && fs.existsSync(result)) return result;
	} catch (err) {
		if (process.env.DEBUG_KICAD) {
			console.warn("[Banana] kicad-cli not on PATH:", err.message);
		}
	}
	return null;
}

function findKicadInStandardDirs() {
	const list = CANDIDATES[os.platform()] || [];
	return list.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveKicadCliPath() {
	if (process.env.KICAD_CLI_PATH && fs.existsSync(process.env.KICAD_CLI_PATH)) {
		return process.env.KICAD_CLI_PATH;
	}
	return (
		findKicadOnPath() ||
		findKicadInStandardDirs() ||
		(() => {
			throw new Error(
				"kicad-cli not found. Set KICAD_CLI_PATH env var, or ensure kicad-cli is on your system PATH.",
			);
		})()
	);
}

export const KICAD_CLI_PATH = resolveKicadCliPath();

function resolveKicadAssetDir(envVars, subDir, extraDirs = []) {
	for (const key of envVars) {
		const val = process.env[key];
		if (val && fs.existsSync(val)) return val;
	}
	const cliDir = path.dirname(KICAD_CLI_PATH);
	const candidates = [
		path.resolve(cliDir, "..", "share", "kicad", subDir),
		path.resolve(cliDir, "..", "SharedSupport", subDir),
		...extraDirs,
	];
	return candidates.find((dir) => fs.existsSync(dir)) || "";
}

export const KICAD_SYMBOL_DIR = resolveKicadAssetDir(
	["KICAD_SYMBOL_DIR", "KICAD10_SYMBOL_DIR", "KICAD9_SYMBOL_DIR"],
	"symbols",
	["/usr/share/kicad/symbols", "/usr/local/share/kicad/symbols"],
);

export const KICAD_FOOTPRINT_DIR = resolveKicadAssetDir(
	["KICAD_FOOTPRINT_DIR", "KICAD10_FOOTPRINT_DIR", "KICAD9_FOOTPRINT_DIR"],
	"footprints",
	["/usr/share/kicad/footprints", "/usr/local/share/kicad/footprints"],
);

export const KICAD_3DMODEL_DIR = resolveKicadAssetDir(
	["KICAD_3DMODEL_DIR", "KICAD10_3DMODEL_DIR", "KICAD9_3DMODEL_DIR"],
	"3dmodels",
	["/usr/share/kicad/3dmodels", "/usr/local/share/kicad/3dmodels"],
);

// Fail-fast verification at startup: throw immediately if KiCad CLI cannot execute
export const KICAD_VERSION = (() => {
	try {
		const ver = execFileSync(KICAD_CLI_PATH, ["--version"], {
			encoding: "utf8",
			stdio: ["pipe", "pipe", "ignore"],
		}).trim();
		console.log(`[Banana] Initialized KiCad CLI v${ver} at: ${KICAD_CLI_PATH}`);
		return ver;
	} catch (err) {
		console.error(
			`[Banana] Failed to execute KiCad CLI at ${KICAD_CLI_PATH}:`,
			err.message,
		);
		throw err;
	}
})();

export const BANANA_DATA_DIR =
	process.env.BANANA_DATA_DIR || path.join(process.cwd(), "temp_storage");
try {
	if (!fs.existsSync(BANANA_DATA_DIR)) {
		fs.mkdirSync(BANANA_DATA_DIR, { recursive: true });
	}
} catch (e) {
	console.warn("[Banana] Could not create BANANA_DATA_DIR:", e.message);
}

let explicitAllowLocalRepos = null;

export const config = {
	port: process.env.PORT || 5000,
	tempStorageDir: BANANA_DATA_DIR,
	kicadCliPath: KICAD_CLI_PATH,
	kicadVersion: KICAD_VERSION,
	kicadSymbolDir: KICAD_SYMBOL_DIR,
	kicadFootprintDir: KICAD_FOOTPRINT_DIR,
	kicad3dModelDir: KICAD_3DMODEL_DIR,
	geminiApiKey: process.env.GEMINI_API_KEY || "",
	geminiModel: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
	githubClientId: process.env.GITHUB_CLIENT_ID || "",
	githubClientSecret: process.env.GITHUB_CLIENT_SECRET || "",
	githubCallbackUrl:
		process.env.GITHUB_CALLBACK_URL ||
		"http://localhost:5000/api/auth/github/callback",
	frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
	get allowLocalRepos() {
		if (explicitAllowLocalRepos !== null) {
			return explicitAllowLocalRepos;
		}
		return process.env.BANANA_ALLOW_LOCAL_REPOS === "1";
	},
	set allowLocalRepos(val) {
		explicitAllowLocalRepos = typeof val === "boolean" ? val : null;
	},
};
