import express from "express";
import { validateCircuitIR } from "../engine/circuit-ir.js";
import { runLiveChecks } from "../engine/drc-lite.js";
import { irToKicadPcb } from "../engine/kicad-pcb-writer.js";
import { irToKicadSch } from "../engine/kicad-sch-writer.js";
import { createRateLimiter, skipWhenLocal } from "../rate-limit.js";

const MAX_TRACKS = 20000;
const MAX_NAME_LENGTH = 64;
const DEFAULT_NAME = "circuit";
const TRACK_WARNING = "tracks not yet written by pcb writer";

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

const passThrough = (_req, _res, next) => next();

export function createEditorRouter({ limiter } = {}) {
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
	return router;
}

const defaultRouter = createEditorRouter({
	limiter: skipWhenLocal(createRateLimiter({ windowMs: 60000, max: 120 })),
});
export default defaultRouter;
