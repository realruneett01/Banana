import express from "express";
import { validateCircuitIR } from "../engine/circuit-ir.js";
import { runLiveChecks } from "../engine/drc-lite.js";
import { irToBomCsv, irToKicadNetlist } from "../engine/ir-exports.js";
import { embeddedLibSymbols } from "../engine/kicad-library.js";
import { kicadPcbToIr } from "../engine/kicad-pcb-to-ir.js";
import { irToKicadPcb } from "../engine/kicad-pcb-writer.js";
import { kicadSchToIr } from "../engine/kicad-sch-to-ir.js";
import { irToKicadSch } from "../engine/kicad-sch-writer.js";
import { KICAD_REJECT_ERROR } from "../engine/kicad-validate.js";
import { createRegistry } from "../engine/tool-registry.js";
import { registerPatchTools } from "../engine/tools/patch-tools.js";
import { createRateLimiter, skipWhenLocal } from "../rate-limit.js";

const MAX_TRACKS = 20000;
const MAX_NAME_LENGTH = 64;
const DEFAULT_NAME = "circuit";
const TRACK_WARNING = "tracks not yet written by pcb writer";
const PATCH_TOOL_ERRORS = [
	"path must",
	"path resolves outside",
	"unsupported kind",
	"edits must",
	"file entry must",
	"files must",
	"repoPath must",
	"message must",
	"No edits were applied",
	"Failed to patch",
	"Failed to read file",
];

function sanitizeName(raw) {
	if (typeof raw !== "string") {
		return DEFAULT_NAME;
	}
	const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_NAME_LENGTH);
	return cleaned || DEFAULT_NAME;
}

function checkTrackLimit(board) {
	const tracks = board?.tracks;
	if (Array.isArray(tracks) && tracks.length > MAX_TRACKS) {
		return {
			status: 413,
			error: `Board exceeds track limit (max ${MAX_TRACKS})`,
		};
	}
	return null;
}

function validatePayload(body) {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { status: 400, error: "Request body must be an object" };
	}
	const irResult = validateCircuitIR(body.ir);
	if (!irResult.ok) {
		return {
			status: 400,
			error: "Invalid circuit IR",
			errors: irResult.errors,
		};
	}
	return checkTrackLimit(body.board);
}

function handleCheck(req, res) {
	const err = validatePayload(req.body);
	if (err) {
		const { status, ...payload } = err;
		return res.status(status).json(payload);
	}
	try {
		const { ir, board, rules } = req.body;
		const result = runLiveChecks({ ir, board, rules });
		return res.status(200).json(result);
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Editor check failed" });
	}
}

function buildExportFiles(ir, body, baseName) {
	const schRes = irToKicadSch(ir, { title: body.title });
	const pcbRes = irToKicadPcb(ir, {
		boardW: body.boardW ?? body.board?.width,
		boardH: body.boardH ?? body.board?.height,
		footprints: body.board?.footprints ?? {},
	});
	const files = {
		[`${baseName}.kicad_sch`]: schRes.text,
		[`${baseName}.kicad_pcb`]: pcbRes.text,
	};
	const warnings = [...(schRes.warnings || []), ...(pcbRes.warnings || [])];
	return { files, warnings };
}

function formatExportResponse(ir, body) {
	const baseName = sanitizeName(ir?.name);
	const { files, warnings } = buildExportFiles(ir, body, baseName);
	const response = { files, warnings };
	if (body.board?.tracks) {
		response.tracks = body.board.tracks;
		response.warnings.push(TRACK_WARNING);
	}
	return response;
}

function handleExport(req, res) {
	const err = validatePayload(req.body);
	if (err) {
		const { status, ...payload } = err;
		return res.status(status).json(payload);
	}
	try {
		const response = formatExportResponse(req.body.ir, req.body);
		return res.status(200).json(response);
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Editor export failed" });
	}
}

function sanitizeDownloadBase(raw) {
	if (typeof raw !== "string") {
		return "design";
	}
	const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_NAME_LENGTH);
	return cleaned || "design";
}

const DOWNLOAD_CONFIG = {
	bom: {
		contentType: "text/csv; charset=utf-8",
		suffix: "-bom.csv",
		convert: irToBomCsv,
	},
	netlist: {
		contentType: "text/plain; charset=utf-8",
		suffix: ".net",
		convert: irToKicadNetlist,
	},
};

function createDownloadHandler(kind) {
	const config = DOWNLOAD_CONFIG[kind];
	return (req, res) => {
		const err = validatePayload(req.body);
		if (err) {
			const { status, ...payload } = err;
			return res.status(status).json(payload);
		}
		try {
			const base = sanitizeDownloadBase(req.body?.name);
			const data = config.convert(req.body.ir);
			res.set({
				"Content-Type": config.contentType,
				"Content-Disposition": `attachment; filename=${base}${config.suffix}`,
			});
			return res.status(200).send(data);
		} catch (_err) {
			// Broad catch to guarantee route never leaks stack traces
			return res.status(500).json({ error: "Editor export failed" });
		}
	};
}

function isPlainObject(val) {
	if (!val || typeof val !== "object") {
		return false;
	}
	return !Array.isArray(val);
}

function isValidRepoPath(repoPath) {
	if (typeof repoPath !== "string") {
		return false;
	}
	return repoPath.length >= 1 && repoPath.length <= 1024;
}

function isValidMessage(message) {
	if (typeof message !== "string") {
		return false;
	}
	return message.length >= 1 && message.length <= 200;
}

function isValidFilesList(files) {
	if (!Array.isArray(files)) {
		return false;
	}
	return files.length >= 1 && files.length <= 2;
}

function isValidFileEntry(file) {
	if (!isPlainObject(file)) {
		return false;
	}
	if (typeof file.path !== "string" || file.path.length === 0) {
		return false;
	}
	if (file.kind !== "sch" && file.kind !== "pcb") {
		return false;
	}
	return Array.isArray(file.edits) && file.edits.length <= 500;
}

function validateCommitBody(body) {
	if (!isPlainObject(body)) {
		return "Request body must be an object";
	}
	if (!isValidRepoPath(body.repoPath)) {
		return "repoPath must be a non-empty string of at most 1024 characters";
	}
	if (!isValidMessage(body.message)) {
		return "message must be a non-empty string of at most 200 characters";
	}
	if (!isValidFilesList(body.files)) {
		return "files must be an array of 1 or 2 file objects";
	}
	if (!body.files.every(isValidFileEntry)) {
		return "Each file must have a valid path, kind ('sch' or 'pcb'), and edits array (max 500)";
	}
	return null;
}

function isValidationOrPatchError(msg) {
	if (typeof msg !== "string") {
		return false;
	}
	return PATCH_TOOL_ERRORS.some((prefix) => msg.startsWith(prefix));
}

function checkLocalAllowed(req, isLocalAllowed) {
	if (typeof isLocalAllowed === "function") {
		return isLocalAllowed(req);
	}
	return req?.app?.locals?.allowLocalRepos === true;
}

async function executeCommit(reqBody, patchDeps) {
	const registry = createRegistry();
	registerPatchTools(registry, patchDeps);
	const { repoPath, files, message } = reqBody;
	return await registry.call(
		"design.patch",
		{ repoPath, files, message },
		{ approved: true },
	);
}

function dispatchCommitResult(res, result) {
	if (result.ok) {
		return res.status(200).json(result.output);
	}
	if (result.error?.startsWith?.(`${KICAD_REJECT_ERROR}: `)) {
		const detail = result.error.slice(KICAD_REJECT_ERROR.length + 2);
		return res.status(422).json({ error: KICAD_REJECT_ERROR, detail });
	}
	if (isValidationOrPatchError(result.error)) {
		return res.status(400).json({ error: result.error });
	}
	return res.status(500).json({ error: "Editor commit failed" });
}

async function handleCommit(req, res, options = {}) {
	try {
		if (!checkLocalAllowed(req, options.isLocalAllowed)) {
			return res.status(403).json({
				error: "Saving to KiCad files is only available in the desktop app",
			});
		}
		const validationError = validateCommitBody(req.body);
		if (validationError) {
			return res.status(400).json({ error: validationError });
		}
		const result = await executeCommit(req.body, options.patchDeps);
		return dispatchCommitResult(res, result);
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces or absolute paths
		return res.status(500).json({ error: "Editor commit failed" });
	}
}

const IMPORT_CONFIG = {
	sch: {
		header: "(kicad_sch",
		error: "File is not a KiCad schematic",
		convert: (text) => ({
			...kicadSchToIr(text),
			symbols: embeddedLibSymbols(text),
		}),
	},
	pcb: {
		header: "(kicad_pcb",
		error: "File is not a KiCad board",
		convert: (text) => kicadPcbToIr(text),
	},
};

function resolveImportConfig(kind) {
	return typeof kind === "string" && Object.hasOwn(IMPORT_CONFIG, kind)
		? IMPORT_CONFIG[kind]
		: null;
}

function handleImport(req, res) {
	try {
		const config = resolveImportConfig(req.query?.kind);
		if (!config) {
			return res
				.status(400)
				.json({ error: "Query parameter kind must be sch or pcb" });
		}
		const text = req.body;
		if (
			typeof text !== "string" ||
			!text.trimStart().startsWith(config.header)
		) {
			return res.status(400).json({ error: config.error });
		}
		const result = config.convert(text);
		if (!result.ok) {
			const errors = (result.errors || []).slice(0, 5);
			return res.status(422).json({ error: "Could not import file", errors });
		}
		return res.status(200).json({
			ir: result.ir,
			board: result.board ?? null,
			warnings: result.warnings ?? [],
			symbols: result.symbols ?? {},
		});
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Editor import failed" });
	}
}

const passThrough = (_req, _res, next) => next();

function registerDownloadRoutes(router, routeLimiter) {
	router.post(
		["/editor/bom", "/api/editor/bom"],
		routeLimiter,
		createDownloadHandler("bom"),
	);
	router.post(
		["/editor/netlist", "/api/editor/netlist"],
		routeLimiter,
		createDownloadHandler("netlist"),
	);
}

export function createEditorRouter(options = {}) {
	const { limiter, patchDeps, isLocalAllowed } = options;
	const router = express.Router();
	const routeLimiter = limiter ?? passThrough;
	router.post(
		["/editor/check", "/api/editor/check"],
		routeLimiter,
		handleCheck,
	);
	router.post(
		["/editor/export", "/api/editor/export"],
		routeLimiter,
		handleExport,
	);
	registerDownloadRoutes(router, routeLimiter);
	router.post(
		["/editor/commit", "/api/editor/commit"],
		routeLimiter,
		(req, res) => handleCommit(req, res, { patchDeps, isLocalAllowed }),
	);
	router.post(
		["/editor/import", "/api/editor/import"],
		routeLimiter,
		express.text({ type: "text/plain", limit: "20mb" }),
		handleImport,
	);
	return router;
}

const defaultRouter = createEditorRouter({
	limiter: skipWhenLocal(createRateLimiter({ windowMs: 60000, max: 120 })),
});
export default defaultRouter;
