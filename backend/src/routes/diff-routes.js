import crypto from "node:crypto";
import path from "node:path";
import { config } from "../config.js";
import { executeDiffPipeline } from "../diff-pipeline.js";
import { extractFileFromCommit } from "../git-extractor.js";
import {
	isSafeGithubName,
	isSafeRef,
	isSafeRelativePath,
} from "../git-safety.js";
import { downloadRepoFile } from "../github-service.js";
import { createSafeRouter } from "../safe-router.js";

const router = createSafeRouter();

function sanitizeCommit(commit) {
	return String(commit || "")
		.replace(/[^a-zA-Z0-9_-]/g, "")
		.substring(0, 16);
}

function sanitizeFilePath(filePath) {
	return String(filePath || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildTempFolder(prefix, commit, filePath) {
	// Unique per request: concurrent diffs of the same commit/file must never share
	// (or clean up) each other's working files.
	const unique = crypto.randomBytes(6).toString("hex");
	const folderName = `${prefix}_${unique}_${sanitizeCommit(commit)}_${sanitizeFilePath(filePath).substring(0, 80)}`;
	const folderDir = path.join(config.tempRoot, folderName);
	const targetPath = path.join(folderDir, path.basename(filePath));
	return { folderName, folderDir, targetPath };
}

function validateRefsAndPath(baseCommit, targetCommit, filePath) {
	if (!isSafeRef(baseCommit)) return "Invalid baseCommit";
	if (!isSafeRef(targetCommit)) return "Invalid targetCommit";
	if (!isSafeRelativePath(filePath)) return "Invalid file path";
	return null;
}

function inferIsPcb(isPcb, filePath) {
	return isPcb !== undefined && isPcb !== null
		? Boolean(isPcb)
		: /\.kicad_pcb$/i.test(filePath);
}

function validateLocalDiffParams(body) {
	const required = [
		"repoPath",
		"baseCommit",
		"targetCommit",
		"relativeFilePath",
	];
	const missing = required.filter((k) => !body[k]);
	if (missing.length > 0) {
		return `Missing required parameters in request body. Required: ${required.join(", ")}`;
	}
	return validateRefsAndPath(
		body.baseCommit,
		body.targetCommit,
		body.relativeFilePath,
	);
}

function validateGithubDiffParams(token, body) {
	if (!token)
		return { error: "GitHub authentication token required", status: 401 };
	const required = ["owner", "repo", "baseCommit", "targetCommit", "filePath"];
	const missing = required.filter((k) => !body[k]);
	if (missing.length > 0) {
		return {
			error: `Missing required parameters: ${required.join(", ")}`,
			status: 400,
		};
	}
	if (!isSafeGithubName(body.owner) || !isSafeGithubName(body.repo)) {
		return { error: "Invalid owner or repo", status: 400 };
	}
	const refError = validateRefsAndPath(
		body.baseCommit,
		body.targetCommit,
		body.filePath,
	);
	if (refError) return { error: refError, status: 400 };
	return null;
}

/**
 * POST /api/diff/process
 * Local Git diff processor
 */
router.post("/diff/process", async (req, res) => {
	const { repoPath, baseCommit, targetCommit, relativeFilePath, isPcb } =
		req.body;
	const validationError = validateLocalDiffParams(req.body);
	if (validationError) {
		return res.status(400).json({ error: validationError });
	}

	const tTotalStart = performance.now();
	const fileBasename = path.basename(relativeFilePath);
	const baseLoc = buildTempFolder("git", baseCommit, relativeFilePath);
	const targetLoc = buildTempFolder("git", targetCommit, relativeFilePath);

	const tGitStart = performance.now();
	let basePath, targetPath;
	try {
		basePath = await extractFileFromCommit(
			repoPath,
			baseCommit,
			relativeFilePath,
			path.join(baseLoc.folderName, fileBasename),
		);
	} catch (err) {
		return res.status(500).json({
			error: `Failed to extract file at base commit (${baseCommit})`,
			details: err.message,
		});
	}

	try {
		targetPath = await extractFileFromCommit(
			repoPath,
			targetCommit,
			relativeFilePath,
			path.join(targetLoc.folderName, fileBasename),
		);
	} catch (err) {
		return res.status(500).json({
			error: `Failed to extract file at target commit (${targetCommit})`,
			details: err.message,
		});
	}
	const tGit = performance.now() - tGitStart;

	return executeDiffPipeline(
		{
			basePath,
			targetPath,
			baseCommit,
			targetCommit,
			isPcb: inferIsPcb(isPcb, relativeFilePath),
			tExtraction: tGit,
			cleanExtractionFolders: [baseLoc.folderDir, targetLoc.folderDir],
			tTotalStart,
		},
		res,
	);
});

/**
 * POST /api/github/diff/process
 * Remote GitHub diff processor (directly diffs remote branches, commits, or PRs)
 */
router.post("/github/diff/process", async (req, res) => {
	const token =
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.body.token;
	const { owner, repo, baseCommit, targetCommit, filePath, isPcb } = req.body;

	const authOrParamError = validateGithubDiffParams(token, req.body);
	if (authOrParamError) {
		return res
			.status(authOrParamError.status)
			.json({ error: authOrParamError.error });
	}

	const tTotalStart = performance.now();
	const baseLoc = buildTempFolder("gh", baseCommit, filePath);
	const targetLoc = buildTempFolder("gh", targetCommit, filePath);

	const tGhStart = performance.now();
	try {
		await Promise.all([
			downloadRepoFile(
				token,
				owner,
				repo,
				filePath,
				baseCommit,
				baseLoc.targetPath,
			),
			downloadRepoFile(
				token,
				owner,
				repo,
				filePath,
				targetCommit,
				targetLoc.targetPath,
			),
		]);
	} catch (err) {
		return res.status(500).json({
			error: "Failed to download hardware file from GitHub",
			details: err.message,
		});
	}
	const tGh = performance.now() - tGhStart;

	return executeDiffPipeline(
		{
			basePath: baseLoc.targetPath,
			targetPath: targetLoc.targetPath,
			baseCommit,
			targetCommit,
			isPcb: inferIsPcb(isPcb, filePath),
			tExtraction: tGh,
			cleanExtractionFolders: [baseLoc.folderDir, targetLoc.folderDir],
			tTotalStart,
		},
		res,
	);
});

export default router;
