import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";

function parseNumeric(token) {
	if (!token) return null;
	const commaIdx = token.indexOf(",");
	const reStr = commaIdx >= 0 ? token.slice(0, commaIdx) : token;
	const val = Number.parseFloat(reStr.trim());
	return Number.isFinite(val) ? val : null;
}

const PLOT_HEADER_PREFIXES = ["Title:", "Plotname:"];
const PLOT_BODY_PREFIXES = ["Variables:", "Values:"];

function isPlotHeader(line) {
	return PLOT_HEADER_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function isPlotBody(line) {
	return PLOT_BODY_PREFIXES.some((prefix) => line.startsWith(prefix));
}

function accumulatePlotLine(acc, rawLine) {
	const trimmed = rawLine.trim();
	if (acc.seenBody && isPlotHeader(trimmed)) {
		acc.plots.push(acc.current);
		acc.current = [];
		acc.seenBody = false;
	}
	if (isPlotBody(trimmed)) {
		acc.seenBody = true;
	}
	acc.current.push(rawLine);
}

function splitPlotLines(text) {
	if (typeof text !== "string") return [];
	if (!text.trim()) return [];

	const acc = { plots: [], current: [], seenBody: false };
	for (const rawLine of text.split(/\r?\n/)) {
		accumulatePlotLine(acc, rawLine);
	}
	if (acc.current.length > 0) {
		acc.plots.push(acc.current);
	}
	return acc.plots;
}

function partitionPlotLines(lines) {
	let section = "header";
	const buckets = { header: [], variables: [], values: [] };

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("Variables:")) {
			section = "variables";
		} else if (trimmed.startsWith("Values:")) {
			section = "values";
		} else {
			buckets[section].push(section === "header" ? trimmed : line);
		}
	}
	return {
		headerLines: buckets.header,
		variableLines: buckets.variables,
		valueLines: buckets.values,
	};
}

function extractHeaderValue(lines, prefix) {
	for (const line of lines) {
		if (line.startsWith(prefix)) {
			return line.slice(prefix.length).trim();
		}
	}
	return "";
}

function parseVariableItem(line) {
	const tokens = line.trim().split(/\s+/);
	if (tokens.length < 2) return null;
	const index = Number.parseInt(tokens[0], 10);
	if (Number.isNaN(index)) return null;
	return {
		index,
		name: tokens[1],
		type: tokens.slice(2).join(" "),
	};
}

function parseVariables(lines) {
	const vars = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const item = parseVariableItem(line);
		if (!item) return null;
		vars.push(item);
	}
	return vars.length > 0 ? vars : null;
}

function parsePointStart(line) {
	const tokens = line.trim().split(/\s+/);
	if (tokens.length < 2) return null;
	const idx = Number.parseInt(tokens[0], 10);
	if (Number.isNaN(idx)) return null;
	return parseNumeric(tokens.slice(1).join(" "));
}

function parseNextValue(line, isStart) {
	return isStart ? parsePointStart(line) : parseNumeric(line);
}

function processValueLine(line, state, numVars) {
	const trimmed = line.trim();
	if (!trimmed) return true;
	const val = parseNextValue(trimmed, state.cur.length === 0);
	if (val === null) return false;
	state.cur.push(val);
	if (state.cur.length === numVars) {
		state.points.push(state.cur);
		state.cur = [];
	}
	return true;
}

function parseValues(lines, numVars) {
	const state = { points: [], cur: [] };
	for (const line of lines) {
		if (!processValueLine(line, state, numVars)) return null;
	}
	if (state.cur.length > 0 || state.points.length === 0) return null;
	return state.points;
}

function parseSinglePlot(lines) {
	const { headerLines, variableLines, valueLines } = partitionPlotLines(lines);
	const variables = parseVariables(variableLines);
	if (!variables) {
		return { ok: false, error: "Missing or malformed Variables block" };
	}
	const points = parseValues(valueLines, variables.length);
	if (!points) {
		return { ok: false, error: "Missing or malformed Values block" };
	}
	return {
		ok: true,
		plot: {
			title: extractHeaderValue(headerLines, "Title:"),
			plotname: extractHeaderValue(headerLines, "Plotname:"),
			variables,
			points,
		},
	};
}

export function parseRawAscii(text) {
	const plotLinesList = splitPlotLines(text);
	if (plotLinesList.length === 0) {
		return { ok: false, error: "Empty or invalid raw simulation text" };
	}
	const plots = [];
	for (const lines of plotLinesList) {
		const res = parseSinglePlot(lines);
		if (!res.ok) {
			return { ok: false, error: res.error };
		}
		plots.push(res.plot);
	}
	return { ok: true, plots };
}

function isPathInside(parentDir, targetPath) {
	const rel = path.relative(parentDir, targetPath);
	if (!rel || path.isAbsolute(rel)) return false;
	return !rel.startsWith("..");
}

function extractLogTail(logText, maxLines = 20) {
	if (!logText || typeof logText !== "string") return "";
	const lines = logText.trim().split(/\r?\n/);
	return lines.slice(-maxLines).join("\n");
}

async function safeRemoveDir(dirPath, parentDir) {
	if (!dirPath || !isPathInside(parentDir, path.resolve(dirPath))) {
		return false;
	}
	try {
		await fs.promises.rm(dirPath, { recursive: true, force: true });
		return true;
	} catch (_err) {
		return false;
	}
}

function runExec(execFn, file, args, options) {
	return new Promise((resolve, reject) => {
		const onDone = (error, stdout, stderr) => {
			if (error) {
				error.stdout = stdout;
				error.stderr = stderr;
				reject(error);
				return;
			}
			resolve({ stdout, stderr });
		};
		execFn(file, args, options, onDone);
	});
}

async function createWorkDir(tempDir) {
	const resolvedTemp = path.resolve(tempDir);
	await fs.promises.mkdir(resolvedTemp, { recursive: true });
	const workDir = await fs.promises.mkdtemp(path.join(resolvedTemp, "spice-"));
	if (!isPathInside(resolvedTemp, path.resolve(workDir))) {
		await safeRemoveDir(workDir, resolvedTemp);
		throw new Error("Work directory created outside temp directory");
	}
	return { workDir, resolvedTemp };
}

async function readLogFile(logPath, execError) {
	try {
		return await fs.promises.readFile(logPath, "utf8");
	} catch (_err) {
		const out = execError?.stderr || execError?.stdout || "";
		return typeof out === "string" ? out : "";
	}
}

function buildErrorResult(log, fallbackMsg) {
	const tail = extractLogTail(log) || fallbackMsg;
	return { ok: false, error: tail, log };
}

async function invokeBatchNgspice(cfg, cirPath, rawPath, logPath) {
	const args = ["-b", "-r", rawPath, "-o", logPath, cirPath];
	try {
		await runExec(cfg.execFileFn, cfg.ngspicePath, args, {
			timeout: cfg.timeoutMs,
			maxBuffer: 10 * 1024 * 1024,
		});
		return null;
	} catch (err) {
		return err;
	}
}

async function readRawOutput(rawPath) {
	try {
		return await fs.promises.readFile(rawPath, "utf8");
	} catch (_err) {
		return null;
	}
}

async function executeSimulation(cfg, workDir, netlist) {
	const cirPath = path.join(workDir, "circuit.cir");
	const rawPath = path.join(workDir, "output.raw");
	const logPath = path.join(workDir, "run.log");
	await fs.promises.writeFile(cirPath, netlist, "utf8");

	const execError = await invokeBatchNgspice(cfg, cirPath, rawPath, logPath);
	const log = await readLogFile(logPath, execError);
	if (execError) return buildErrorResult(log, "ngspice execution failed");

	const rawText = await readRawOutput(rawPath);
	if (rawText === null) {
		return buildErrorResult(log, "Raw output file not generated");
	}

	const parsed = parseRawAscii(rawText);
	if (!parsed.ok) return buildErrorResult(log, parsed.error);
	return { ok: true, plots: parsed.plots, log };
}

// Exported so netlist writers (ir-to-spice) strip exactly what this gate rejects.
export const NETLIST_LIMITS = {
	maxBytes: 500 * 1024,
	forbiddenChars: /[\0`]/,
	forbiddenSubstrings: ["$("],
	filePathChars: /[/\\~"'>]/,
	filePathParam: /^(file|path)\s*=/i,
	forbiddenPrefixes: [
		".control",
		".endc",
		".exec",
		".include",
		".inc",
		".lib",
		".write",
		".shell",
		"shell",
		"system",
		"*ng_script",
		"* ng_script",
	],
};

function hasExtensionWithoutParens(token) {
	if (/[()]/.test(token)) return false;
	return /\.[a-z0-9_-]+$/i.test(token);
}

function isFilePathToken(token) {
	if (!token) return false;
	if (NETLIST_LIMITS.filePathChars.test(token)) return true;
	if (token.startsWith(".")) return true;
	if (NETLIST_LIMITS.filePathParam.test(token)) return true;
	return hasExtensionWithoutParens(token);
}

function hasFilePath(line) {
	const rest = line.slice(5).trim();
	if (!rest) return false;
	for (const token of rest.split(/\s+/)) {
		if (isFilePathToken(token)) return true;
	}
	return false;
}

function normalizeLine(line) {
	let s = line.trim();
	while (s.startsWith("+")) {
		s = s.slice(1).trim();
	}
	return s.replace(/^\.\s+/, ".");
}

function checkDangerousLine(line) {
	const normalized = normalizeLine(line);
	if (!normalized) return null;
	const lower = normalized.toLowerCase();
	for (const prefix of NETLIST_LIMITS.forbiddenPrefixes) {
		if (lower.startsWith(prefix)) {
			return `Netlist contains forbidden '${prefix}' directive`;
		}
	}
	if (lower.startsWith(".save") && hasFilePath(lower)) {
		return "Netlist contains forbidden '.save' with file path";
	}
	return null;
}

function appendContinuation(unfolded, continuation) {
	if (unfolded.length > 0) {
		unfolded[unfolded.length - 1] += ` ${continuation}`;
		return;
	}
	unfolded.push(continuation);
}

function unfoldNetlistLines(rawLines) {
	const unfolded = [];
	for (const raw of rawLines) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("+")) {
			appendContinuation(unfolded, trimmed.slice(1).trim());
		} else {
			unfolded.push(trimmed);
		}
	}
	return unfolded;
}

function findForbiddenLine(lines) {
	for (const line of lines) {
		const err = checkDangerousLine(line);
		if (err) return err;
	}
	return null;
}

function checkNetlistPayload(netlist) {
	if (typeof netlist !== "string" || !netlist.trim()) {
		return "Netlist must be non-empty";
	}
	if (Buffer.byteLength(netlist, "utf8") > NETLIST_LIMITS.maxBytes) {
		return "Netlist exceeds maximum allowed size of 500 KB";
	}
	if (NETLIST_LIMITS.forbiddenChars.test(netlist)) {
		return "Netlist contains forbidden character";
	}
	const bad = NETLIST_LIMITS.forbiddenSubstrings.find((s) =>
		netlist.includes(s),
	);
	if (bad) {
		return `Netlist contains forbidden '${bad}'`;
	}
	return null;
}

export function validateNetlist(netlist) {
	const payloadErr = checkNetlistPayload(netlist);
	if (payloadErr) {
		return { ok: false, error: payloadErr };
	}
	const rawLines = netlist.split(/\r?\n/);
	const rawErr = findForbiddenLine(rawLines);
	if (rawErr) {
		return { ok: false, error: rawErr };
	}
	const unfoldedErr = findForbiddenLine(unfoldNetlistLines(rawLines));
	if (unfoldedErr) {
		return { ok: false, error: unfoldedErr };
	}
	return { ok: true };
}

function checkNgspiceAvailable(execFileFn, ngspicePath) {
	return new Promise((resolve) => {
		execFileFn(ngspicePath, ["--version"], { timeout: 5000 }, (err) => {
			resolve(!err);
		});
	});
}

async function runNgspiceSimulation(cfg, netlist) {
	const validation = validateNetlist(netlist);
	if (!validation.ok) {
		return { ok: false, error: validation.error, log: "" };
	}
	const { workDir, resolvedTemp } = await createWorkDir(cfg.tempDir);
	try {
		return await executeSimulation(cfg, workDir, netlist);
	} finally {
		await safeRemoveDir(workDir, resolvedTemp);
	}
}

export function createNgspice({
	ngspicePath = process.env.NGSPICE_PATH || "ngspice",
	execFileFn = execFile,
	timeoutMs = 30000,
	tempDir = config.tempStorageDir,
} = {}) {
	const cfg = { ngspicePath, execFileFn, timeoutMs, tempDir };
	let availablePromise = null;

	return {
		available: () => {
			if (availablePromise !== null) return availablePromise;
			availablePromise = checkNgspiceAvailable(execFileFn, ngspicePath);
			return availablePromise;
		},
		run: (netlist) => runNgspiceSimulation(cfg, netlist),
	};
}
