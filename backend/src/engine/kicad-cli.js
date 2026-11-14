import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KICAD_CLI_PATH } from "../config.js";

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const REPORT_COMMANDS = Object.freeze({
	erc: Object.freeze({ tool: "sch", cmd: "erc", ext: ".kicad_sch" }),
	drc: Object.freeze({ tool: "pcb", cmd: "drc", ext: ".kicad_pcb" }),
});

function validateInputPath(filePath, expectedExt) {
	if (typeof filePath !== "string" || !path.isAbsolute(filePath)) {
		throw new Error(`Input path must be absolute: ${filePath}`);
	}
	if (!filePath.endsWith(expectedExt)) {
		throw new Error(`Input path must end with ${expectedExt}: ${filePath}`);
	}
}

function validateOutputPath(outputPath) {
	if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
		throw new Error(`Output path must be a non-empty string: ${outputPath}`);
	}
}

function validateFilePaths(inputPath, expectedExt, outputPath) {
	validateInputPath(inputPath, expectedExt);
	validateOutputPath(outputPath);
}

function isViolationExit(err) {
	if (!err) {
		return false;
	}
	const code = err.code ?? err.exitCode ?? err.status;
	return code === 5;
}

function asString(val, fallback = "") {
	return typeof val === "string" ? val : fallback;
}

function mapReportItem(item) {
	if (!item || typeof item !== "object") {
		return { uuid: "", description: "", pos: null };
	}
	const hasPosObj = Boolean(item.pos && typeof item.pos === "object");
	return {
		uuid: asString(item.uuid),
		description: asString(item.description),
		pos: hasPosObj ? item.pos : null,
	};
}

function mapViolation(v) {
	if (!v || typeof v !== "object") {
		return { type: "", severity: "error", description: "", items: [] };
	}
	return {
		type: asString(v.type),
		severity: asString(v.severity, "error"),
		description: asString(v.description),
		items: Array.isArray(v.items) ? v.items.map(mapReportItem) : [],
	};
}

function countSeverities(violations) {
	let errors = 0;
	let warnings = 0;
	for (const v of violations) {
		if (v.severity === "error") {
			errors += 1;
		} else if (v.severity === "warning") {
			warnings += 1;
		}
	}
	return { errors, warnings };
}

function parseReportContent(jsonText) {
	const raw = JSON.parse(jsonText);
	const rawViolations = Array.isArray(raw?.violations) ? raw.violations : [];
	const violations = rawViolations.map(mapViolation);
	const counts = countSeverities(violations);
	const summary = {
		errors:
			typeof raw?.summary?.errors === "number"
				? raw.summary.errors
				: counts.errors,
		warnings:
			typeof raw?.summary?.warnings === "number"
				? raw.summary.warnings
				: counts.warnings,
	};
	return { violations, summary };
}

async function readAndParseReport(outJsonPath) {
	const content = await fs.promises.readFile(outJsonPath, "utf8");
	return parseReportContent(content);
}

function invokeExec(exec, cliPath, args, options) {
	return new Promise((resolve, reject) => {
		exec(cliPath, args, options, (err, stdout, stderr) => {
			if (err) {
				return reject({ err, stdout, stderr });
			}
			resolve({ stdout, stderr });
		});
	});
}

function extractFailureError(failure) {
	if (failure?.err) {
		failure.err.stderr ??= failure.stderr;
		return failure.err;
	}
	return new Error(failure?.stderr || "Execution failed");
}

async function executeCommand(exec, cliPath, args, options) {
	try {
		return await invokeExec(exec, cliPath, args, options);
	} catch (failure) {
		throw extractFailureError(failure);
	}
}

async function runWithReport({ exec, cliPath, args, options, outJsonPath }) {
	try {
		await invokeExec(exec, cliPath, args, options);
	} catch (failure) {
		if (!isViolationExit(failure?.err)) {
			throw extractFailureError(failure);
		}
	}
	return readAndParseReport(outJsonPath);
}

async function runReportCommand(ctx, inputPath, outJsonPath, config) {
	validateFilePaths(inputPath, config.ext, outJsonPath);
	const args = [
		config.tool,
		config.cmd,
		"--format",
		"json",
		"--severity-all",
		"--output",
		outJsonPath,
		inputPath,
	];
	return runWithReport({
		exec: ctx.exec,
		cliPath: ctx.cliPath,
		args,
		options: ctx.execOptions,
		outJsonPath,
	});
}

function runErcInternal(ctx, schPath, outJsonPath) {
	return runReportCommand(ctx, schPath, outJsonPath, REPORT_COMMANDS.erc);
}

function runDrcInternal(ctx, pcbPath, outJsonPath) {
	return runReportCommand(ctx, pcbPath, outJsonPath, REPORT_COMMANDS.drc);
}

async function exportNetlistInternal(ctx, schPath, outPath, format) {
	validateFilePaths(schPath, ".kicad_sch", outPath);
	const args = [
		"sch",
		"export",
		"netlist",
		"--format",
		format,
		"--output",
		outPath,
		schPath,
	];
	await executeCommand(ctx.exec, ctx.cliPath, args, ctx.execOptions);
	return outPath;
}

async function exportDrillInternal(ctx, pcbPath, outDir) {
	validateFilePaths(pcbPath, ".kicad_pcb", outDir);
	const args = ["pcb", "export", "drill", "--output", outDir, pcbPath];
	await executeCommand(ctx.exec, ctx.cliPath, args, ctx.execOptions);
	return outDir;
}

// kicad-cli saves the refilled board over its input (--save-board needs
// --refill-zones), so the text goes through a private temp copy.
async function refillBoardTextInternal(ctx, text) {
	const dir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "banana-refill-"),
	);
	const pcbPath = path.join(dir, "board.kicad_pcb");
	try {
		await fs.promises.writeFile(pcbPath, text, "utf8");
		const args = ["pcb", "drc", "--refill-zones", "--save-board"];
		args.push("--format", "json", "--output", path.join(dir, "drc.json"));
		await executeCommand(
			ctx.exec,
			ctx.cliPath,
			[...args, pcbPath],
			ctx.execOptions,
		);
		return await fs.promises.readFile(pcbPath, "utf8");
	} finally {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

async function versionInternal(ctx) {
	const res = await executeCommand(
		ctx.exec,
		ctx.cliPath,
		["--version"],
		ctx.execOptions,
	);
	return (res.stdout || "").trim();
}

export function createKicadCli({
	cliPath = KICAD_CLI_PATH,
	exec = execFile,
	timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
	const ctx = Object.freeze({
		cliPath,
		exec,
		execOptions: Object.freeze({
			timeout: timeoutMs,
			maxBuffer: MAX_BUFFER_BYTES,
		}),
	});

	return {
		runErc: (schPath, outJsonPath) => runErcInternal(ctx, schPath, outJsonPath),
		runDrc: (pcbPath, outJsonPath) => runDrcInternal(ctx, pcbPath, outJsonPath),
		exportNetlist: (schPath, outPath, format = "kicadsexpr") =>
			exportNetlistInternal(ctx, schPath, outPath, format),
		exportDrill: (pcbPath, outDir) => exportDrillInternal(ctx, pcbPath, outDir),
		refillBoardText: (text) => refillBoardTextInternal(ctx, text),
		version: () => versionInternal(ctx),
	};
}
