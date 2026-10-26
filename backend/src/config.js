import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
	APP_ROOT,
	findKicadCli,
	loadAutoconfig,
	parsePort,
	parsePositiveInt,
	probeKicadVersion,
	resolveTempRoot,
} from "./runtime-detect.js";

dotenv.config({ path: `${APP_ROOT}/.env`, quiet: true });
dotenv.config({ quiet: true });

const auto = loadAutoconfig() || {};

function resolveKicad() {
	// Environment wins; the calibration file is only trusted if its path still exists.
	const explicit =
		process.env.KICAD_CLI_PATH ||
		(auto.kicadCliPath && fs.existsSync(auto.kicadCliPath)
			? auto.kicadCliPath
			: "");
	const found = findKicadCli({ explicit });
	if (!found.path) {
		return {
			path: "",
			version: "",
			error:
				"kicad-cli not found. Install KiCad 7+, set KICAD_CLI_PATH, or put KiCad under runtime/kicad*/. Run `npm run preflight` for details.",
		};
	}
	const probe = probeKicadVersion(found.path);
	if (!probe.ok) {
		return {
			path: found.path,
			version: "",
			error: `kicad-cli at ${found.path} failed to run: ${probe.error}`,
		};
	}
	console.log(
		`[Banana] KiCad CLI ${probe.version} at ${found.path} (${found.source})`,
	);
	return { path: found.path, version: probe.version, error: "" };
}

const kicad = resolveKicad();
if (kicad.error) console.warn(`[Banana] WARNING: ${kicad.error}`);

export const KICAD_CLI_PATH = kicad.path;
export const KICAD_VERSION = kicad.version;

export const config = {
	port: parsePort(process.env.PORT, parsePort(auto.port, 5000)),
	host: process.env.HOST || auto.host || "127.0.0.1",
	kicadCliPath: KICAD_CLI_PATH,
	kicadVersion: KICAD_VERSION,
	kicadError: kicad.error,
	authEnabled: ["required", "on", "1", "true"].includes(
		String(process.env.BANANA_AUTH || "").toLowerCase(),
	),
	dataDir: path.resolve(
		process.env.BANANA_DATA_DIR || path.join(APP_ROOT, ".banana"),
	),
	projectsDir: path.resolve(process.env.BANANA_PROJECTS_DIR || path.join(path.resolve(process.env.BANANA_DATA_DIR || path.join(APP_ROOT, ".banana")), "projects")),
	sessionHours: parsePositiveInt(process.env.BANANA_SESSION_HOURS, 12),
	trustProxy: process.env.BANANA_TRUST_PROXY === "1",
	accessToken: process.env.BANANA_ACCESS_TOKEN || "",
	tempRoot: resolveTempRoot(),
	renderTimeoutMs: parsePositiveInt(
		process.env.RENDER_TIMEOUT_MS,
		parsePositiveInt(auto.renderTimeoutMs, 120000),
	),
	cacheMaxEntries: parsePositiveInt(
		process.env.CACHE_MAX_ENTRIES,
		parsePositiveInt(auto.cacheMaxEntries, 200),
	),
	geminiApiKey: process.env.GEMINI_API_KEY || "",
	geminiModel: process.env.GEMINI_MODEL || "gemini-3-flash-preview",
	githubClientId: process.env.GITHUB_CLIENT_ID || "",
	githubClientSecret: process.env.GITHUB_CLIENT_SECRET || "",
	githubCallbackUrl:
		process.env.GITHUB_CALLBACK_URL ||
		"http://localhost:5000/api/auth/github/callback",
	frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
};
