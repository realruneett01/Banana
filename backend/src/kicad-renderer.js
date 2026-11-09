import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

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
			.digest("hex")
			.substring(0, 16);
		return path.resolve(
			config.tempStorageDir,
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

function executeCliRender(cliPath, args, outputDir, tStart) {
	return new Promise((resolve, reject) => {
		execFile(cliPath, args, (error, _stdout, stderr) => {
			if (error) {
				safeCleanup(outputDir);
				return reject(
					new Error(
						`KiCad render execution failed: ${error.message}. Stderr: ${stderr.trim()}`,
					),
				);
			}

			try {
				const svgFiles = getSvgFilesFromDir(outputDir);
				const durationMs = performance.now() - tStart;
				resolve({
					outputDir,
					svgFiles,
					durationMs,
				});
			} catch (err) {
				reject(
					new Error(`Failed to list rendered KiCad SVG files: ${err.message}`),
				);
			}
		});
	});
}

const GLB_EXPORT_FLAGS = [
	"--force",
	"--subst-models",
	"--cut-vias-in-body",
	"--include-tracks",
	"--include-pads",
	"--include-zones",
	"--include-inner-copper",
	"--include-silkscreen",
	"--include-soldermask",
];

/**
 * Exports a .kicad_pcb as a binary glTF (board body, every copper layer, mask,
 * silkscreen and component 3D models) for the 3D hologram viewer.
 * Cached by file content hash, like renderKicadFile.
 *
 * @param {string} filePath - Path to the .kicad_pcb file
 * @returns {Promise<{glbPath: string, durationMs: number, cached?: boolean}>}
 */
export async function exportBoardGlb(filePath) {
	const normalizedFilePath = path.resolve(filePath);
	const fileHash = crypto
		.createHash("sha256")
		.update(fs.readFileSync(normalizedFilePath))
		.digest("hex")
		.substring(0, 16);
	const glbDir = path.resolve(config.tempStorageDir, "cache", "glb");
	const glbPath = path.join(glbDir, `${fileHash}.glb`);

	if (fs.existsSync(glbPath) && fs.statSync(glbPath).size > 0) {
		return { glbPath, durationMs: 0.5, cached: true };
	}
	fs.mkdirSync(glbDir, { recursive: true });

	const tStart = performance.now();
	// Unique temp output + rename so concurrent exports of the same board never corrupt the cache
	const tmpPath = path.join(
		glbDir,
		`${fileHash}.${process.pid}_${Math.random().toString(36).substring(2, 9)}.glb`,
	);
	const args = [
		"pcb",
		"export",
		"glb",
		...GLB_EXPORT_FLAGS,
		"--output",
		tmpPath,
		normalizedFilePath,
	];
	return new Promise((resolve, reject) => {
		execFile(
			config.kicadCliPath,
			args,
			{ timeout: 180000 },
			(error, _stdout, stderr) => {
				if (error || !fs.existsSync(tmpPath)) {
					try {
						fs.rmSync(tmpPath, { force: true });
					} catch (_) {}
					return reject(
						new Error(
							`KiCad GLB export failed: ${error?.message ?? "no output"}. Stderr: ${stderr.trim()}`,
						),
					);
				}
				try {
					fs.renameSync(tmpPath, glbPath);
				} catch (renameErr) {
					try {
						fs.rmSync(tmpPath, { force: true });
					} catch (_) {}
					if (!fs.existsSync(glbPath)) return reject(renameErr); // another export already won the race otherwise
				}
				resolve({ glbPath, durationMs: performance.now() - tStart });
			},
		);
	});
}

/**
 * Renders a KiCad schematic or board file using kicad-cli.
 * Includes content-hash persistent caching to eliminate redundant CLI renders.
 *
 * @param {string} filePath - Path to the file to render
 * @param {boolean} isPcb - True if PCB file (.kicad_pcb), False if schematic (.kicad_sch)
 * @returns {Promise<{outputDir: string, svgFiles: string[], durationMs: number, cached?: boolean}>} Map containing the temp folder and generated SVG absolute paths
 */
export async function renderKicadFile(filePath, isPcb) {
	const cliPath = config.kicadCliPath;
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
			};
		}
	}

	// 2. Cache miss: render directly to the cache directory (or fallback uniqueId)
	const outputDir =
		cacheDir ||
		path.resolve(
			config.tempStorageDir,
			"renders",
			`${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
		);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const tStart = performance.now();
	const args = isPcb
		? [
				"pcb",
				"export",
				"svg",
				"--mode-multi",
				"--layers",
				"F.Cu,B.Cu,F.SilkS,B.SilkS,F.Courtyard,B.Courtyard,Edge.Cuts",
				"--output",
				outputDir,
				normalizedFilePath,
			]
		: ["sch", "export", "svg", "--output", outputDir, normalizedFilePath];

	return executeCliRender(cliPath, args, outputDir, tStart);
}
