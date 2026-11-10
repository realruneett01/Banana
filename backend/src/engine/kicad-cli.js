import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { KICAD_CLI_PATH } from "../config.js";

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

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

function isViolationExit(err) {
	if (!err) {
		return false;
	}
	const code = err.code ?? err.exitCode ?? err.status;
	return code === 5;
}

function mapReportItem(item) {
	if (!item || typeof item !== "object") {
		return { uuid: "", description: "", pos: null };
	}
	return {
		uuid: typeof item.uuid === "string" ? item.uuid : "",
		description: typeof item.description === "string" ? item.description : "",
		pos: item.pos && typeof item.pos === "object" ? item.pos : null,
	};
}

function mapViolation(v) {
	if (!v || typeof v !== "object") {
		return { type: "", severity: "error", description: "", items: [] };
	}
	const items = Array.isArray(v.items) ? v.items.map(mapReportItem) : [];
	return {
		type: typeof v.type === "string" ? v.type : "",
		severity: typeof v.severity === "string" ? v.severity : "error",
		description: typeof v.description === "string" ? v.description : "",
		items,
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

async function executeCommand(exec, cliPath, args, options) {
	try {
		return await invokeExec(exec, cliPath, args, options);
	} catch (failure) {
		if (failure?.err) {
			throw failure.err;
		}
		throw new Error(failure?.stderr || "Execution failed");
	}
}

async function runWithReport({ exec, cliPath, args, options, outJsonPath }) {
	try {
		await invokeExec(exec, cliPath, args, options);
	} catch (failure) {
		if (!isViolationExit(failure?.err)) {
			throw failure?.err || new Error(failure?.stderr || "Execution failed");
		}
	}
	return readAndParseReport(outJsonPath);
}

async function runErcInternal(ctx, schPath, outJsonPath) {
	validateInputPath(schPath, ".kicad_sch");
	validateOutputPath(outJsonPath);
	const args = [
		"sch",
		"erc",
		"--format",
		"json",
		"--severity-all",
		"--output",
		outJsonPath,
		schPath,
	];
	return runWithReport({
		exec: ctx.exec,
		cliPath: ctx.cliPath,
		args,
		options: ctx.execOptions,
		outJsonPath,
	});
}

async function runDrcInternal(ctx, pcbPath, outJsonPath) {
	validateInputPath(pcbPath, ".kicad_pcb");
	validateOutputPath(outJsonPath);
	const args = [
		"pcb",
		"drc",
		"--format",
		"json",
		"--severity-all",
		"--output",
		outJsonPath,
		pcbPath,
	];
	return runWithReport({
		exec: ctx.exec,
		cliPath: ctx.cliPath,
		args,
		options: ctx.execOptions,
		outJsonPath,
	});
}

async function exportNetlistInternal(ctx, schPath, outPath, format) {
	validateInputPath(schPath, ".kicad_sch");
	validateOutputPath(outPath);
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
		version: () => versionInternal(ctx),
	};
}
