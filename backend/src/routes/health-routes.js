import { execFile } from "node:child_process";
import fs from "node:fs";
import express from "express";
import { config } from "../config.js";
import { createSimEngine } from "../engine/spice/sim-engine.js";

const router = express.Router();

const CAPABILITIES_CACHE_TTL_MS = 60 * 1000;
let cachedCapabilities = null;
let cacheExpiresAt = 0;
let pendingCapabilitiesPromise = null;

async function checkSimulator() {
	try {
		const engine = createSimEngine();
		const available = Boolean(await engine.available());
		return { available, simulatorKind: engine.kind() };
	} catch {
		// Suppress failure and report simulator unavailable
		return { available: false, simulatorKind: "none" };
	}
}

function checkKicadLibraries() {
	const symDir = process.env.KICAD_SYMBOL_DIR;
	const fpDir = process.env.KICAD_FOOTPRINT_DIR;
	if (!symDir || !fpDir) return false;
	try {
		return fs.existsSync(symDir) && fs.existsSync(fpDir);
	} catch {
		// Suppress fs errors and report libraries unavailable
		return false;
	}
}

function checkFreerouting() {
	const jar = process.env.FREEROUTING_JAR;
	if (!jar || typeof jar !== "string") return false;
	const trimmed = jar.trim();
	if (!trimmed) return false;
	try {
		return fs.existsSync(trimmed);
	} catch {
		// Suppress fs errors and report freerouting unavailable
		return false;
	}
}

async function computeCapabilities() {
	const sim = await checkSimulator();
	const kicadLibraries = checkKicadLibraries();
	const freerouting = checkFreerouting();
	return {
		ngspice: sim.available,
		simulatorKind: sim.simulatorKind,
		kicadLibraries,
		freerouting,
	};
}

async function getCapabilities() {
	const now = Date.now();
	if (cachedCapabilities && now < cacheExpiresAt) {
		return cachedCapabilities;
	}
	if (pendingCapabilitiesPromise) {
		return pendingCapabilitiesPromise;
	}

	pendingCapabilitiesPromise = (async () => {
		try {
			cachedCapabilities = await computeCapabilities();
			cacheExpiresAt = Date.now() + CAPABILITIES_CACHE_TTL_MS;
			return cachedCapabilities;
		} finally {
			pendingCapabilitiesPromise = null;
		}
	})();

	return pendingCapabilitiesPromise;
}

router.get("/health-check", (_req, res) => {
	const cliPath = config.kicadCliPath;

	execFile(cliPath, ["--version"], async (error, stdout, stderr) => {
		if (error) {
			return res.status(500).json({
				status: "unhealthy",
				error:
					"KiCad CLI execution failed or executable not found/inaccessible",
				message: error.message,
				cliPath: cliPath,
				code: error.code,
				stderr: stderr ? stderr.trim() : "",
			});
		}

		const version = stdout.trim();
		if (!version) {
			return res.status(500).json({
				status: "unhealthy",
				error: "KiCad CLI did not output any version information",
				cliPath: cliPath,
				stderr: stderr ? stderr.trim() : "",
			});
		}

		const capabilities = await getCapabilities();

		res.json({
			status: "healthy",
			kicadVersion: version,
			capabilities,
		});
	});
});

export default router;
