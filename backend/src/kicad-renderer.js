import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";
import {
	fallbackCapabilities,
	getCapabilities,
	parseKicadVersion,
} from "./kicad-compat.js";

/**
 * Resolves the cache directory path based on the file content hash.
 * @param {string} filePath
 * @param {boolean} isPcb
 * @returns {string|null}
 */
function resolveCacheDir(filePath, isPcb) {
	try {
		const fileBuf = fs.readFileSync(filePath);
		const fileHash = crypto
			.createHash("sha256")
			.update(fileBuf)
			.update(String(config.kicadVersion || ""))
			.digest("hex")
			.substring(0, 16);
		return path.join(
			config.tempRoot,
			"cache",
			"renders",
			`${fileHash}_${isPcb ? "pcb" : "sch"}`,
		);
	} catch (err) {
		if (process.env.DEBUG_RENDER)
			console.warn("[Renderer] Cache hash failed:", err.message);
		return null;
	}
}

/**
 * Returns absolute paths to all SVG files inside a directory.
 * @param {string} dirPath
 * @returns {string[]}
 */
function getSvgFilesFromDir(dirPath) {
	try {
		const files = fs.readdirSync(dirPath);
		return files
			.filter((file) => file.toLowerCase().endsWith(".svg"))
			.map((file) => path.join(dirPath, file));
	} catch (err) {
		if (process.env.DEBUG_RENDER)
			console.warn("[Renderer] Dir read failed:", err.message);
		return [];
	}
}

function safeCleanup(outputDir) {
	try {
		if (fs.existsSync(outputDir)) {
			fs.rmSync(outputDir, { recursive: true, force: true });
		}
	} catch (err) {
		if (process.env.DEBUG_RENDER)
			console.warn("[Renderer] Cleanup warning:", err.message);
	}
}

/**
 * Keeps the persistent render cache bounded by evicting the least recently modified entries.
 */
export function pruneRenderCache(cacheRoot, maxEntries) {
	try {
		const entries = fs
			.readdirSync(cacheRoot, { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => {
				const full = path.join(cacheRoot, e.name);
				return { full, mtime: fs.statSync(full).mtimeMs };
			})
			.sort((a, b) => b.mtime - a.mtime);
		for (const stale of entries.slice(Math.max(0, maxEntries))) {
			safeCleanup(stale.full);
		}
	} catch (err) {
		if (process.env.DEBUG_RENDER)
			console.warn("[Renderer] Cache prune warning:", err.message);
	}
}

const PCB_LAYERS = [
	"F.Cu",
	"B.Cu",
	"F.SilkS",
	"B.SilkS",
	"F.Courtyard",
	"B.Courtyard",
	"Edge.Cuts",
];

/** KiCad 8+ can export every layer in one call (--mode-multi); 7.x cannot. */
export function supportsModeMulti(versionString) {
	// Unknown or nightly builds are treated as modern.
	return fallbackCapabilities(parseKicadVersion(versionString)).svg.multiMode;
}

const RENDER_PARALLELISM = Math.max(1, Math.min(4, os.cpus().length));

/** Runs `worker` over `items` with at most `limit` in flight; rejects on the first failure. */
export async function runWithLimit(items, limit, worker) {
	let next = 0;
	let failure = null;
	const lanes = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (failure === null && next < items.length) {
				const item = items[next++];
				try {
					await worker(item);
				} catch (err) {
					failure = failure || err;
				}
			}
		},
	);
	await Promise.all(lanes);
	if (failure) throw failure;
}

function runCli(cliPath, args) {
	return new Promise((resolve, reject) => {
		const options = {
			timeout: config.renderTimeoutMs,
			maxBuffer: 64 * 1024 * 1024,
		};
		execFile(cliPath, args, options, (error, _stdout, stderr) => {
			if (error) {
				const reason = error.killed
					? `timed out after ${config.renderTimeoutMs} ms`
					: error.message;
				return reject(
					new Error(
						`KiCad render execution failed: ${reason}. Stderr: ${(stderr || "").trim()}`,
					),
				);
			}
			resolve();
		});
	});
}

/**
 * Builds the sequence of kicad-cli invocations for one file.
 * @returns {string[][]}
 */
export function buildRenderCommands({
	isPcb,
	filePath,
	outputDir,
	kicadVersion,
	capabilities,
}) {
	if (!isPcb)
		return [["sch", "export", "svg", "--output", outputDir, filePath]];
	if (
		capabilities ? capabilities.svg.multiMode : supportsModeMulti(kicadVersion)
	) {
		return [
			[
				"pcb",
				"export",
				"svg",
				"--mode-multi",
				"--layers",
				PCB_LAYERS.join(","),
				"--output",
				outputDir,
				filePath,
			],
		];
	}
	// KiCad 7: one SVG per layer, named like --mode-multi output ("<board>-F_Cu.svg").
	const stem = path.basename(filePath).replace(/\.[^.]+$/, "");
	return PCB_LAYERS.map((layer) => [
		"pcb",
		"export",
		"svg",
		"--layers",
		layer,
		"--output",
		path.join(outputDir, `${stem}-${layer.replace(/\./g, "_")}.svg`),
		filePath,
	]);
}

async function executeCliRender(
	cliPath,
	commands,
	outputDir,
	tStart,
	finalDir = outputDir,
) {
	try {
		await runWithLimit(commands, RENDER_PARALLELISM, (args) =>
			runCli(cliPath, args),
		);
	} catch (err) {
		safeCleanup(outputDir);
		throw err;
	}

	if (finalDir !== outputDir) {
		// Publish atomically so a concurrent request never sees a half-written cache entry.
		try {
			if (getSvgFilesFromDir(outputDir).length === 0) {
				safeCleanup(outputDir);
				throw new Error("KiCad produced no SVG output for this file");
			}
			fs.mkdirSync(path.dirname(finalDir), { recursive: true });
			try {
				fs.renameSync(outputDir, finalDir);
				pruneRenderCache(path.dirname(finalDir), config.cacheMaxEntries);
			} catch (renameErr) {
				// Another request published the same entry first; use theirs.
				safeCleanup(outputDir);
				if (getSvgFilesFromDir(finalDir).length === 0) throw renameErr;
			}
		} catch (err) {
			throw new Error(`Failed to publish render cache: ${err.message}`);
		}
	}

	const svgFiles = getSvgFilesFromDir(finalDir);
	if (svgFiles.length === 0) {
		throw new Error("KiCad produced no SVG output for this file");
	}
	return {
		outputDir: finalDir,
		svgFiles,
		durationMs: performance.now() - tStart,
		persistent: finalDir !== outputDir,
	};
}

/**
 * Renders a KiCad schematic or board file using kicad-cli.
 * Includes content-hash persistent caching to eliminate redundant CLI renders.
 *
 * @param {string} filePath - Path to the file to render
 * @param {boolean} isPcb - True if PCB file (.kicad_pcb), False if schematic (.kicad_sch)
 * @returns {Promise<{outputDir: string, svgFiles: string[], durationMs: number, cached?: boolean}>} Map containing the temp folder and generated SVG absolute paths
 */
const inFlight = new Map();

export function renderKicadFile(filePath, isPcb) {
	// Identical concurrent requests (same bytes) share one render instead of racing.
	const key = resolveCacheDir(path.resolve(filePath), isPcb);
	if (!key) return renderKicadFileUncached(filePath, isPcb);
	if (inFlight.has(key)) return inFlight.get(key);
	const pending = renderKicadFileUncached(filePath, isPcb).finally(() =>
		inFlight.delete(key),
	);
	inFlight.set(key, pending);
	return pending;
}

async function renderKicadFileUncached(filePath, isPcb) {
	const cliPath = config.kicadCliPath;
	if (!cliPath) {
		throw new Error(config.kicadError || "kicad-cli is not available");
	}
	const normalizedFilePath = path.resolve(filePath);

	// 1. Check content-hash cache first
	const cacheDir = resolveCacheDir(normalizedFilePath, isPcb);
	if (cacheDir && fs.existsSync(cacheDir)) {
		const cachedSvgs = getSvgFilesFromDir(cacheDir);
		if (cachedSvgs.length > 0) {
			return {
				outputDir: cacheDir,
				svgFiles: cachedSvgs,
				durationMs: 0.5,
				cached: true,
				persistent: true,
			};
		}
	}

	// 2. Cache miss: render directly to the cache directory (or fallback uniqueId)
	const scratchName = `${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
	const outputDir = path.join(config.tempRoot, "renders", scratchName);
	fs.mkdirSync(outputDir, { recursive: true });

	const tStart = performance.now();
	const commands = buildRenderCommands({
		isPcb,
		filePath: normalizedFilePath,
		outputDir,
		kicadVersion: config.kicadVersion,
		capabilities: getCapabilities({ cliPath, version: config.kicadVersion }),
	});

	return executeCliRender(
		cliPath,
		commands,
		outputDir,
		tStart,
		cacheDir || outputDir,
	);
}
