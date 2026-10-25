import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);

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
		"/var/lib/flatpak/exports/bin/org.kicad.KiCad",
		"/usr/lib/kicad-nightly/bin/kicad-cli",
		"/usr/lib/kicad/bin/kicad-cli",
	],
};

function exists(p) {
	try {
		return Boolean(p) && fs.existsSync(p);
	} catch {
		return false;
	}
}

/** KiCad shipped next to the app (e.g. on a USB stick): runtime/kicad*\/bin/kicad-cli[.exe]. */
export function findBundledKicad(appRoot = APP_ROOT, platform = os.platform()) {
	const exe = platform === "win32" ? "kicad-cli.exe" : "kicad-cli";
	const runtimeDir = path.join(appRoot, "runtime");
	let names = [];
	try {
		names = fs
			.readdirSync(runtimeDir)
			.filter((n) => n.toLowerCase().startsWith("kicad"));
	} catch {
		return null;
	}
	for (const name of names.sort().reverse()) {
		for (const rel of [path.join("bin", exe), exe]) {
			const candidate = path.join(runtimeDir, name, rel);
			if (exists(candidate)) return candidate;
		}
	}
	return null;
}

export function findKicadOnPath(platform = os.platform()) {
	const finder = platform === "win32" ? "where" : "which";
	try {
		const result = execFileSync(finder, ["kicad-cli"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 5000,
		})
			.trim()
			.split(/\r?\n/)[0];
		if (exists(result)) return result;
	} catch {
		/* not on PATH */
	}
	return null;
}

/**
 * Locates kicad-cli. Order: explicit override, bundled copy, PATH, standard install dirs.
 * @returns {{path: string|null, source: string|null, tried: string[]}}
 */
export function findKicadCli({
	explicit = process.env.KICAD_CLI_PATH,
	appRoot = APP_ROOT,
	platform = os.platform(),
} = {}) {
	const tried = [];
	if (explicit) {
		tried.push(explicit);
		if (exists(explicit))
			return { path: explicit, source: "KICAD_CLI_PATH", tried };
	}
	const bundled = findBundledKicad(appRoot, platform);
	if (bundled) return { path: bundled, source: "bundled", tried };
	const onPath = findKicadOnPath(platform);
	if (onPath) return { path: onPath, source: "PATH", tried };
	for (const candidate of CANDIDATES[platform] || []) {
		tried.push(candidate);
		if (exists(candidate))
			return { path: candidate, source: "standard-dir", tried };
	}
	return { path: null, source: null, tried };
}

/**
 * Runs `kicad-cli --version`.
 * @returns {{ok: boolean, version?: string, error?: string}}
 */
export function probeKicadVersion(cliPath, timeoutMs = 15000) {
	try {
		const out = execFileSync(cliPath, ["--version"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: timeoutMs,
		}).trim();
		if (!out) return { ok: false, error: "kicad-cli printed no version" };
		return { ok: true, version: out.split(/\r?\n/)[0] };
	} catch (err) {
		return { ok: false, error: err.message };
	}
}

/** Identifies the machine an auto-config was calibrated on. */
export function machineFingerprint() {
	return {
		platform: os.platform(),
		arch: os.arch(),
		hostname: os.hostname(),
		node: process.versions.node.split(".")[0],
	};
}

export function sameMachine(a, b) {
	return Boolean(
		a &&
			b &&
			a.platform === b.platform &&
			a.arch === b.arch &&
			a.hostname === b.hostname,
	);
}

export function autoconfigPath(appRoot = APP_ROOT, env = process.env) {
	return (
		env.BANANA_AUTOCONFIG || path.join(appRoot, ".banana", "autoconfig.json")
	);
}

/**
 * Reads the calibration written by `npm run preflight`. A calibration made on a
 * different machine (moved USB stick) is ignored so the app re-detects instead of
 * trusting stale paths.
 */
export function loadAutoconfig(appRoot = APP_ROOT, env = process.env) {
	try {
		const raw = JSON.parse(
			fs.readFileSync(autoconfigPath(appRoot, env), "utf8"),
		);
		if (
			!raw ||
			typeof raw !== "object" ||
			!sameMachine(raw.machine, machineFingerprint())
		)
			return null;
		return raw;
	} catch {
		return null;
	}
}

/** Parses a TCP port; returns fallback when invalid. */
export function parsePort(value, fallback) {
	const n = Number.parseInt(String(value ?? ""), 10);
	return Number.isInteger(n) &&
		n >= 0 &&
		n <= 65535 &&
		String(n) === String(value).trim()
		? n
		: fallback;
}

export function parsePositiveInt(value, fallback) {
	const n = Number.parseInt(String(value ?? ""), 10);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Scratch directory. Defaults to the OS temp dir so a USB stick is never written to or worn out. */
export function resolveTempRoot(env = process.env) {
	if (env.BANANA_TEMP_DIR) return path.resolve(env.BANANA_TEMP_DIR);
	const uid = typeof process.getuid === "function" ? process.getuid() : "user";
	return path.join(os.tmpdir(), `banana-${uid}`);
}
