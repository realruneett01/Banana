import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config } from "../config.js";
import { extractFileFromCommit } from "../git-extractor.js";
import { downloadRepoFile } from "../github-service.js";
import { parseKiCadBoard } from "../kicad-pcb-parser.js";
import { exportBoardGlb } from "../kicad-renderer.js";

const router = express.Router();

const VALID_REF_PATTERNS = [
	/^[0-9a-fA-F]{4,40}$/,
	/^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/,
];

function isValidCommitRef(ref) {
	if (typeof ref !== "string" || ref.length === 0) {
		return false;
	}
	return VALID_REF_PATTERNS.some((pattern) => pattern.test(ref));
}

const ROOT_OR_DRIVE_PATTERN = /^[a-zA-Z]:|^[/\\]/;
const NETWORK_OR_DEVICE_PATTERN = /^[/\\]{2}/;
const TRAVERSAL_SEGMENT_PATTERN = /(^|[/\\])\.\.([/\\]|$)/;
const ALLOWED_BOARD_EXTENSIONS = [".kicad_pcb", ".kicad_sch"];

function hasHostileString(val) {
	if (typeof val !== "string" || val.length === 0) {
		return true;
	}
	if (val.includes("\0")) {
		return true;
	}
	if (NETWORK_OR_DEVICE_PATTERN.test(val)) {
		return true;
	}
	return TRAVERSAL_SEGMENT_PATTERN.test(val);
}

function isPathConfined(filePath) {
	if (hasHostileString(filePath)) {
		return false;
	}
	if (ROOT_OR_DRIVE_PATTERN.test(filePath)) {
		return false;
	}
	return !path.isAbsolute(filePath);
}

function isValidFilePath(filePath) {
	if (typeof filePath !== "string" || filePath.length === 0) {
		return false;
	}
	if (!isPathConfined(filePath)) {
		return false;
	}
	return ALLOWED_BOARD_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

function isValidRepoPath(repoPath) {
	if (typeof repoPath !== "string" || repoPath.trim().length === 0) {
		return false;
	}
	return !hasHostileString(repoPath);
}

function hasValidFileInputs(boardReq) {
	if (
		boardReq.relativeFilePath &&
		!isValidFilePath(boardReq.relativeFilePath)
	) {
		return false;
	}
	if (boardReq.filePath && !isValidFilePath(boardReq.filePath)) {
		return false;
	}
	return isValidFilePath(boardReq.targetFile);
}

function isRemoteTarget(boardReq) {
	return Boolean(boardReq.owner && boardReq.repo);
}

const LOCAL_REPOS_DISABLED_MESSAGE =
	"Local repositories are disabled on this server";

function isLocalRepoRequest(boardReq) {
	return Boolean(boardReq.repoPath) || !isRemoteTarget(boardReq);
}

function enforceLocalRepoPolicy(req, boardReq, res) {
	const isLocal = isLocalRepoRequest(boardReq);
	const permitsLocal = req.app?.locals?.allowLocalRepos === true;
	if (isLocal && !permitsLocal) {
		res.status(403).json({ error: LOCAL_REPOS_DISABLED_MESSAGE });
		return false;
	}
	return true;
}

const VALIDATION_RULES = [
	{
		check: (req) => Boolean(req.commit && req.targetFile),
		message: "Missing required fields: commit, (relativeFilePath OR filePath)",
	},
	{
		check: (req) => Boolean(req.repoPath || isRemoteTarget(req)),
		message: "Missing required fields: repoPath OR (owner and repo)",
	},
	{
		check: (req) => isValidCommitRef(req.commit),
		message: "Invalid commit ref",
	},
	{
		check: (req) => !req.repoPath || isValidRepoPath(req.repoPath),
		message: "Invalid repository path",
	},
	{
		check: (req) => hasValidFileInputs(req),
		message: "Invalid target file path",
	},
];

function findValidationError(boardReq) {
	const failedRule = VALIDATION_RULES.find((rule) => !rule.check(boardReq));
	return failedRule ? failedRule.message : null;
}

function extractAuthToken(req) {
	const headerToken = req.headers?.authorization?.replace(/^Bearer\s+/i, "");
	return headerToken || req.body?.token;
}

function extractBoardRequest(req) {
	const body = req.body || {};
	return {
		repoPath: body.repoPath,
		commit: body.commit,
		targetFile: body.relativeFilePath || body.filePath,
		relativeFilePath: body.relativeFilePath,
		filePath: body.filePath,
		owner: body.owner,
		repo: body.repo,
		token: extractAuthToken(req),
	};
}

function makeTempLocation(prefix, targetFile) {
	const id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	const fileName = path.basename(targetFile);
	const dir = path.join(config.tempStorageDir, id);
	const filePath = path.join(dir, fileName);
	return { id, fileName, dir, filePath };
}

async function fetchBoardSource(boardReq, temp) {
	if (isRemoteTarget(boardReq)) {
		if (!boardReq.token) {
			const authErr = new Error("GitHub token required for remote pads");
			authErr.statusCode = 401;
			throw authErr;
		}
		await downloadRepoFile(
			boardReq.token,
			boardReq.owner,
			boardReq.repo,
			boardReq.targetFile,
			boardReq.commit,
			temp.filePath,
		);
		return;
	}
	const relTarget = path.join(temp.id, temp.fileName);
	await extractFileFromCommit(
		boardReq.repoPath,
		boardReq.commit,
		boardReq.targetFile,
		relTarget,
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

function removeDirSafely(dirPath) {
	if (!dirPath || !fs.existsSync(dirPath)) {
		return;
	}
	fs.rmSync(dirPath, { recursive: true, force: true });
}

function cleanupTempDir(dirPath) {
	try {
		removeDirSafely(dirPath);
	} catch (err) {
		console.warn("Failed to clean up temp directory:", dirPath, err?.message);
	}
}

function waitForResponse(res) {
	if (res.writableFinished || res.closed || res.destroyed) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const onDone = () => {
			res.off("finish", onDone);
			res.off("close", onDone);
			resolve();
		};
		res.once("finish", onDone);
		res.once("close", onDone);
	});
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

async function executeBoardAction(req, res, endpoint) {
	const boardReq = extractBoardRequest(req);
	if (!enforceLocalRepoPolicy(req, boardReq, res)) {
		return;
	}

	const validationMsg = findValidationError(boardReq);
	if (validationMsg) {
		return res.status(400).json({ error: validationMsg });
	}

	const temp = makeTempLocation(endpoint.prefix, boardReq.targetFile);
	try {
		await fetchBoardSource(boardReq, temp);
		await endpoint.handler(temp.filePath, res);
	} catch (error) {
		sendErrorResponse(res, error, endpoint.fallbackError);
	} finally {
		await waitForResponse(res);
		cleanupTempDir(temp.dir);
	}
}

/**
 * Configuration table for board route endpoints:
 * - /pads: Extracts parsed pad/net labels for overlay rendering.
 * - /glb: Generates binary glTF 3D model for hologram viewer.
 */
const BOARD_ENDPOINT_REGISTRATIONS = [
	/**
	 * POST /api/board/pads - Extracts a .kicad_pcb file from a git commit and returns parsed pad data (absolute coordinates, size, net names, layer membership) for the frontend pad/net label overlay.
	 */
	{
		endpointPath: "/pads",
		prefix: "pads",
		fallbackError: "Unexpected error during pad extraction",
		handler: handlePadsExtraction,
	},
	/**
	 * POST /api/board/glb - Extracts a .kicad_pcb at a commit (local git or GitHub) and returns it as a binary glTF with every copper layer, mask, silkscreen and component model, for the frontend 3D hologram viewer. Same request body as /pads.
	 */
	{
		endpointPath: "/glb",
		prefix: "glb",
		fallbackError: "Unexpected error during 3D export",
		handler: handleGlbExport,
	},
];

for (const registration of BOARD_ENDPOINT_REGISTRATIONS) {
	router.post(registration.endpointPath, (req, res) =>
		executeBoardAction(req, res, registration),
	);
}

export default router;
