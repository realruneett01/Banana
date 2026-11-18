import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { KICAD_CLI_PATH } from "../config.js";

const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_LIMIT = 120000;

function isRecord(val) {
	if (!val || typeof val !== "object") return false;
	return !Array.isArray(val);
}

function sanitizeTargetName(name) {
	return typeof name === "string"
		? name.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "board"
		: "board";
}

function validateContent(val, field, header) {
	if (typeof val !== "string") {
		return `${field} must be a string`;
	}
	if (!val.trimStart().startsWith(header)) {
		return `${field} must start with ${header}`;
	}
	if (Buffer.byteLength(val, "utf8") > MAX_BYTES) {
		return `${field} exceeds maximum size of 20 MB`;
	}
	return null;
}

function checkUnconnectedFlag(body) {
	if (body.unconnected === undefined) return null;
	return typeof body.unconnected === "boolean"
		? null
		: "unconnected must be a boolean";
}

function validateCheckBody(type, body) {
	if (!isRecord(body)) return "Request body must be an object";
	const isDrc = type === "drc";
	const field = isDrc ? "pcb" : "sch";
	const header = isDrc ? "(kicad_pcb" : "(kicad_sch";
	const contentErr = validateContent(body[field], field, header);
	if (contentErr) return contentErr;
	return isDrc ? checkUnconnectedFlag(body) : null;
}

function toFiniteNumber(num) {
	const n = Number(num);
	return Number.isFinite(n) ? n : null;
}

function parsePosition(pos) {
	if (!isRecord(pos)) return null;
	const x = toFiniteNumber(pos.x);
	const y = toFiniteNumber(pos.y);
	if (x === null || y === null) return null;
	return { x, y };
}

function parseItem(item) {
	if (!isRecord(item)) {
		return { description: "", pos: null };
	}
	const desc = typeof item.description === "string" ? item.description : "";
	return { description: desc, pos: parsePosition(item.pos) };
}

function resolveSeverity(val) {
	return typeof val === "string" ? val.toLowerCase() : "error";
}

function resolveType(val, fallback) {
	return typeof val === "string" && val.length > 0 ? val : fallback;
}

function parseViolation(entry, fallbackType) {
	if (!isRecord(entry)) return null;
	const rawItems = Array.isArray(entry.items) ? entry.items : [];
	const desc = typeof entry.description === "string" ? entry.description : "";
	return {
		severity: resolveSeverity(entry.severity),
		type: resolveType(entry.type, fallbackType),
		description: desc,
		items: rawItems.map(parseItem),
	};
}

function summarizeCounts(violations) {
	const counts = { error: 0, warning: 0 };
	for (const v of violations) {
		if (v.severity === "error") counts.error += 1;
		if (v.severity === "warning") counts.warning += 1;
	}
	return counts;
}

function collectDrcEntries(raw, body) {
	const entries = [];
	const appendItems = (arr, kind) => {
		if (Array.isArray(arr)) {
			for (const item of arr) entries.push({ item, kind });
		}
	};
	appendItems(raw?.violations, "violation");
	if (body.unconnected !== false) {
		appendItems(raw?.unconnected_items, "unconnected_items");
	}
	appendItems(raw?.schematic_parity, "schematic_parity");
	return entries;
}

function collectErcEntries(raw) {
	const sheets = Array.isArray(raw?.sheets) ? raw.sheets : [];
	const sheetViolations = sheets.flatMap((s) =>
		Array.isArray(s?.violations) ? s.violations : [],
	);
	const list =
		sheetViolations.length > 0
			? sheetViolations
			: Array.isArray(raw?.violations)
				? raw.violations
				: [];
	return list.map((item) => ({ item, kind: "erc_violation" }));
}

function buildReportResponse(entries) {
	const violations = entries
		.map(({ item, kind }) => parseViolation(item, kind))
		.filter(Boolean);
	return { violations, counts: summarizeCounts(violations) };
}

function buildCliArgs(type, reportPath, inputPath) {
	const cmd = type === "drc" ? ["pcb", "drc"] : ["sch", "erc"];
	return [
		...cmd,
		"--format",
		"json",
		"--severity-all",
		"--units",
		"mm",
		"--output",
		reportPath,
		inputPath,
	];
}

async function loadReport(reportPath, type, body) {
	if (!fs.existsSync(reportPath)) return null;
	try {
		const text = await fs.promises.readFile(reportPath, "utf8");
		const raw = JSON.parse(text);
		const entries =
			type === "drc" ? collectDrcEntries(raw, body) : collectErcEntries(raw);
		return buildReportResponse(entries);
	} catch {
		return null;
	}
}

function invokeProcess(runner, targetBin, params) {
	return new Promise((done) => {
		runner(
			targetBin,
			params,
			{ timeout: TIMEOUT_LIMIT },
			(error, _out, errOut) => {
				done({
					error,
					stderr: errOut ? String(errOut) : "",
				});
			},
		);
	});
}

function formatCliError(res) {
	const message = res.stderr || res.error?.message || "KiCad check failed";
	return message.slice(0, 500);
}

async function runCheckInDir(ctx) {
	const { type, body, deps, tmpDir } = ctx;
	const isDrc = type === "drc";
	const ext = isDrc ? ".kicad_pcb" : ".kicad_sch";
	const content = isDrc ? body.pcb : body.sch;
	const safeName = sanitizeTargetName(body.name);
	const inputPath = path.join(tmpDir, `${safeName}${ext}`);
	const reportPath = path.join(tmpDir, "report.json");

	await fs.promises.writeFile(inputPath, content, "utf8");
	const args = buildCliArgs(type, reportPath, inputPath);
	const procRes = await invokeProcess(deps.execFileImpl, deps.cliPath, args);
	const report = await loadReport(reportPath, type, body);

	if (!report) {
		const detail = formatCliError(procRes);
		return {
			status: 500,
			payload: { error: `KiCad CLI check failed: ${detail}` },
		};
	}
	return { status: 200, payload: report };
}

async function withTempDirectory(action) {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kicad-check-"));
	try {
		return await action(dir);
	} finally {
		await fs.promises.rm(dir, { recursive: true, force: true });
	}
}

async function dispatchCheck(type, req, res, deps) {
	if (!deps.cliPath || !fs.existsSync(deps.cliPath)) {
		return res
			.status(503)
			.json({ error: "KiCad CLI is not configured or missing" });
	}
	const validationError = validateCheckBody(type, req.body);
	if (validationError) {
		return res.status(400).json({ error: validationError });
	}
	const outcome = await withTempDirectory((tmpDir) =>
		runCheckInDir({ type, body: req.body, deps, tmpDir }),
	);
	return res.status(outcome.status).json(outcome.payload);
}

export function createCheckRouter(opts = {}) {
	const activeCli = opts.cliPath !== undefined ? opts.cliPath : KICAD_CLI_PATH;
	const runner = opts.execFileImpl ?? execFile;
	const router = express.Router();
	router.post(["/checks/drc", "/api/checks/drc"], (req, res) =>
		dispatchCheck("drc", req, res, {
			execFileImpl: runner,
			cliPath: activeCli,
		}),
	);
	router.post(["/checks/erc", "/api/checks/erc"], (req, res) =>
		dispatchCheck("erc", req, res, {
			execFileImpl: runner,
			cliPath: activeCli,
		}),
	);
	return router;
}

const defaultRouter = createCheckRouter();
export default defaultRouter;
