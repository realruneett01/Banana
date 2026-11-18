import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { KICAD_CLI_PATH } from "../config.js";

const DEFAULT_NAME = "board";
const MAX_NAME_LEN = 64;
const MAX_PCB_BYTES = 20 * 1024 * 1024;
const PCB_HEADER = "(kicad_pcb";
const CLI_TIMEOUT_MS = 120000;
const VALID_OUTPUTS = Object.freeze(["gerbers", "drill", "pos", "pdf", "step"]);
const OUTPUT_SET = new Set(VALID_OUTPUTS);

function sanitizeName(raw) {
	if (typeof raw !== "string") {
		return DEFAULT_NAME;
	}
	const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_NAME_LEN);
	return cleaned || DEFAULT_NAME;
}

function validatePcb(pcb) {
	if (typeof pcb !== "string") {
		return "pcb must be a string";
	}
	if (!pcb.trimStart().startsWith(PCB_HEADER)) {
		return `pcb must start with ${PCB_HEADER}`;
	}
	if (Buffer.byteLength(pcb, "utf8") > MAX_PCB_BYTES) {
		return "pcb exceeds maximum size of 20 MB";
	}
	return null;
}

function validateOutputs(outputs) {
	if (outputs === undefined) {
		return { ok: true, values: [...VALID_OUTPUTS] };
	}
	if (!Array.isArray(outputs)) {
		return { ok: false, error: "outputs must be an array" };
	}
	const hasUnknown = outputs.some(
		(o) => typeof o !== "string" || !OUTPUT_SET.has(o),
	);
	if (hasUnknown) {
		return { ok: false, error: "outputs contains an unknown entry" };
	}
	return { ok: true, values: outputs };
}

function validateRequestBody(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { status: 400, error: "Request body must be an object" };
	}
	const pcbError = validatePcb(body.pcb);
	if (pcbError) {
		return { status: 400, error: pcbError };
	}
	const outRes = validateOutputs(body.outputs);
	if (!outRes.ok) {
		return { status: 400, error: outRes.error };
	}
	return { status: 200, outputs: outRes.values };
}

function buildCommandArgs(kind, ctx) {
	const { tmpDir, safeName, pcbPath } = ctx;
	if (kind === "gerbers" || kind === "drill") {
		const outDir = path.join(tmpDir, kind) + path.sep;
		return ["pcb", "export", kind, "--output", outDir, pcbPath];
	}
	if (kind === "pos") {
		const out = path.join(tmpDir, `${safeName}-pos.csv`);
		return [
			"pcb",
			"export",
			"pos",
			"--output",
			out,
			"--format",
			"csv",
			pcbPath,
		];
	}
	if (kind === "pdf") {
		const out = path.join(tmpDir, `${safeName}.pdf`);
		const layers = "F.Cu,B.Cu,F.SilkS,B.SilkS,Edge.Cuts";
		return [
			"pcb",
			"export",
			"pdf",
			"--output",
			out,
			"--layers",
			layers,
			pcbPath,
		];
	}
	const stepOut = path.join(tmpDir, `${safeName}.step`);
	return ["pcb", "export", "step", "--output", stepOut, pcbPath];
}

async function prepareOutputDir(kind, tmpDir) {
	if (kind === "gerbers" || kind === "drill") {
		await fs.promises.mkdir(path.join(tmpDir, kind), { recursive: true });
	}
}

function execCli(execFileImpl, cliPath, args) {
	return new Promise((resolve) => {
		execFileImpl(
			cliPath,
			args,
			{ timeout: CLI_TIMEOUT_MS },
			(error, stdout, stderr) => {
				resolve({
					error,
					stdout: stdout ? String(stdout) : "",
					stderr: stderr ? String(stderr) : "",
				});
			},
		);
	});
}

async function runOutputs({ outputs, context, execFileImpl, cliPath }) {
	const log = [];
	for (const kind of outputs) {
		await prepareOutputDir(kind, context.tmpDir);
		const args = buildCommandArgs(kind, context);
		const res = await execCli(execFileImpl, cliPath, args);
		if (res.error) {
			const detail = (res.stderr || res.error.message || "").slice(0, 500);
			return { ok: false, error: `KiCad CLI export failed: ${detail}` };
		}
		log.push(`Exported ${kind}`);
	}
	return { ok: true, log };
}

const SIDE_FILE_EXTENSIONS = Object.freeze([
	".kicad_prl",
	".kicad_pro",
	".lck",
	".fp-info-cache",
]);

function isSideFile(name, inputName) {
	if (name === inputName || name === "fp-info-cache") {
		return true;
	}
	return SIDE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

async function collectFiles(dir, tmpDir, inputName) {
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const results = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory() && entry.name !== "backups") {
			const nested = await collectFiles(fullPath, tmpDir, inputName);
			results.push(...nested);
		} else if (entry.isFile() && !isSideFile(entry.name, inputName)) {
			const relName = path.relative(tmpDir, fullPath).replace(/\\/g, "/");
			const content = await fs.promises.readFile(fullPath);
			results.push({ name: relName, base64: content.toString("base64") });
		}
	}
	return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function exportDesignFiles({ body, tmpDir, deps }) {
	const safeName = sanitizeName(body.name);
	const inputName = `${safeName}.kicad_pcb`;
	await fs.promises.writeFile(path.join(tmpDir, inputName), body.pcb, "utf8");
	const runRes = await runOutputs({
		outputs: body.validatedOutputs,
		context: { tmpDir, safeName, pcbPath: path.join(tmpDir, inputName) },
		execFileImpl: deps.execFileImpl,
		cliPath: deps.cliPath,
	});
	if (!runRes.ok) {
		return { status: 500, payload: { error: runRes.error } };
	}
	const files = await collectFiles(tmpDir, tmpDir, inputName);
	return { status: 200, payload: { files, log: runRes.log } };
}

async function handleExportRequest(req, res, deps) {
	if (!deps.cliPath || !fs.existsSync(deps.cliPath)) {
		return res
			.status(503)
			.json({ error: "KiCad CLI is not configured or missing" });
	}
	const val = validateRequestBody(req.body);
	if (val.status !== 200) {
		return res.status(val.status).json({ error: val.error });
	}
	const tmpDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "banana-fab-"),
	);
	let result = null;
	try {
		const body = { ...req.body, validatedOutputs: val.outputs };
		result = await exportDesignFiles({ body, tmpDir, deps });
	} finally {
		await fs.promises.rm(tmpDir, { recursive: true, force: true });
	}
	return res.status(result.status).json(result.payload);
}

export function createFabRouter(options = {}) {
	const execFileImpl = options.execFileImpl ?? execFile;
	const cliPath =
		options.cliPath !== undefined ? options.cliPath : KICAD_CLI_PATH;
	const router = express.Router();
	router.post(["/fab/export", "/api/fab/export"], (req, res) =>
		handleExportRequest(req, res, { execFileImpl, cliPath }),
	);
	return router;
}

const defaultRouter = createFabRouter();
export default defaultRouter;
