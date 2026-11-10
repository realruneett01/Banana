import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "../config.js";
import { extractFileFromCommit } from "../git-extractor.js";
import { downloadRepoFile } from "../github-service.js";
import { parseKiCadBoard } from "../kicad-pcb-parser.js";
import { exportBoardGlb } from "../kicad-renderer.js";

const router = express.Router();

function hasRepositoryTarget({ repoPath, owner, repo }) {
	return Boolean(repoPath || (owner && repo));
}

function validatePadRequest({ commit, targetFile, repoPath, owner, repo }) {
	if (!commit || !targetFile) {
		return "Missing required fields: commit, (relativeFilePath OR filePath)";
	}
	if (!hasRepositoryTarget({ repoPath, owner, repo })) {
		return "Missing required fields: repoPath OR (owner and repo)";
	}
	if (!targetFile.endsWith(".kicad_pcb")) {
		return "Only .kicad_pcb files are supported by this endpoint";
	}
	return null;
}

async function downloadRemoteBoard({
	token,
	owner,
	repo,
	targetFile,
	commit,
	tempFilePath,
}) {
	if (!token) {
		const err = new Error("GitHub token required for remote pads");
		err.statusCode = 401;
		throw err;
	}
	await downloadRepoFile(token, owner, repo, targetFile, commit, tempFilePath);
}

async function retrieveBoardFile({
	owner,
	repo,
	token,
	repoPath,
	commit,
	targetFile,
	tempFilePath,
	uniqueId,
	fileBasename,
}) {
	if (owner && repo) {
		await downloadRemoteBoard({
			token,
			owner,
			repo,
			targetFile,
			commit,
			tempFilePath,
		});
		return;
	}
	await extractFileFromCommit(
		repoPath,
		commit,
		targetFile,
		path.join(uniqueId, fileBasename),
	);
}

function formatPad(pad) {
	return {
		number: pad.number,
		net: pad.net ?? "",
		absAt: { x: pad.absAt.x, y: pad.absAt.y },
		size: { w: pad.size?.w ?? 0.5, h: pad.size?.h ?? 0.5 },
		layers: pad.layers ?? [],
	};
}

function formatFootprint(fp) {
	return {
		reference: fp.reference?.text ?? "",
		layer: fp.layer,
		pads: fp.pads.map(formatPad),
	};
}

function formatFootprints(board) {
	return board.footprints.map(formatFootprint);
}

function cleanupTempDir(dirPath) {
	try {
		if (dirPath && fs.existsSync(dirPath)) {
			fs.rmSync(dirPath, { recursive: true, force: true });
		}
	} catch (err) {
		// Best-effort cleanup: do not throw if directory removal fails
		console.warn("Failed to clean up temp directory:", dirPath, err?.message);
	}
}

function extractAuthToken(req) {
	return (
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.body.token
	);
}

function extractBoardRequest(req) {
	const { repoPath, commit, relativeFilePath, owner, repo, filePath } =
		req.body;
	return {
		repoPath,
		commit,
		targetFile: relativeFilePath || filePath,
		owner,
		repo,
		token: extractAuthToken(req),
	};
}

function createTempContext(prefix, targetFile) {
	const uniqueId = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	const fileBasename = path.basename(targetFile);
	const tempDir = path.join(config.tempStorageDir, uniqueId);
	const tempFilePath = path.join(tempDir, fileBasename);
	return { uniqueId, fileBasename, tempDir, tempFilePath };
}

function sendErrorResponse(res, error, fallbackError) {
	const status = error.statusCode || 500;
	res.status(status).json({
		error: status === 401 ? error.message : fallbackError,
		details: error.message,
	});
}

async function handlePadsExtraction(tempFilePath, res) {
	let board;
	try {
		board = parseKiCadBoard(tempFilePath);
	} catch (err) {
		return res.status(500).json({
			error: "Failed to parse .kicad_pcb file",
			details: err.message,
		});
	}
	res.json({ footprints: formatFootprints(board) });
}

async function handleGlbExport(tempFilePath, res) {
	const { glbPath, cached, durationMs } = await exportBoardGlb(tempFilePath);
	res.set("X-Banana-Glb-Cached", cached ? "1" : "0");
	res.set("X-Banana-Glb-Ms", String(Math.round(durationMs)));
	res.type("model/gltf-binary").sendFile(glbPath);
}

async function processBoardRequest({
	req,
	res,
	prefix,
	fallbackError,
	handler,
}) {
	const boardReq = extractBoardRequest(req);
	const validationError = validatePadRequest(boardReq);
	if (validationError) {
		return res.status(400).json({ error: validationError });
	}

	const temp = createTempContext(prefix, boardReq.targetFile);
	try {
		await retrieveBoardFile({ ...boardReq, ...temp });
		await handler(temp.tempFilePath, res);
	} catch (error) {
		sendErrorResponse(res, error, fallbackError);
	} finally {
		cleanupTempDir(temp.tempDir);
	}
}

/**
 * POST /api/board/pads
 *
 * Extracts a .kicad_pcb file from a git commit and returns parsed pad data
 * (absolute coordinates, size, net names, layer membership) for the
 * frontend pad/net label overlay.
 */
router.post("/pads", (req, res) =>
	processBoardRequest({
		req,
		res,
		prefix: "pads",
		fallbackError: "Unexpected error during pad extraction",
		handler: handlePadsExtraction,
	}),
);

/**
 * POST /api/board/glb
 *
 * Extracts a .kicad_pcb at a commit (local git or GitHub) and returns it as a
 * binary glTF with every copper layer, mask, silkscreen and component model,
 * for the frontend 3D hologram viewer. Same request body as /pads.
 */
router.post("/glb", (req, res) =>
	processBoardRequest({
		req,
		res,
		prefix: "glb",
		fallbackError: "Unexpected error during 3D export",
		handler: handleGlbExport,
	}),
);

export default router;
