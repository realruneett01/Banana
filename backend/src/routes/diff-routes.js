import path from "node:path";
import express from "express";
import { config } from "../config.js";
import { executeDiffPipeline } from "../diff-pipeline.js";
import { extractFileFromCommit } from "../git-extractor.js";
import { downloadRepoFile } from "../github-service.js";

const router = express.Router();

function sanitizeCommit(commit) {
	return String(commit || "")
		.replace(/[^a-zA-Z0-9_-]/g, "")
		.substring(0, 16);
}

function sanitizeFilePath(filePath) {
	return String(filePath || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildTempFolder(prefix, commit, filePath) {
	const folderName = `${prefix}_${sanitizeCommit(commit)}_${sanitizeFilePath(filePath)}`;
	const folderDir = path.join(config.tempStorageDir, folderName);
	const targetPath = path.join(folderDir, path.basename(filePath));
	return { folderName, folderDir, targetPath };
}

function buildTempPair(prefix, baseCommit, targetCommit, filePath) {
	const baseLoc = buildTempFolder(prefix, baseCommit, filePath);
	const targetLoc = buildTempFolder(prefix, targetCommit, filePath);
	return {
		baseLoc,
		targetLoc,
		cleanFolders: [baseLoc.folderDir, targetLoc.folderDir],
	};
}

function findMissingParamError(body, required, prefix) {
	const hasMissing = required.some((k) => !body[k]);
	return hasMissing ? `${prefix}${required.join(", ")}` : null;
}

const COMMIT_HEX_REGEX = /^[0-9a-fA-F]{4,40}$/;
const BRANCH_TAG_REGEX = /^[A-Za-z0-9._/-]{1,200}$/;

function isValidCommitRef(ref) {
	if (typeof ref !== "string" || !ref) {
		return false;
	}
	if (COMMIT_HEX_REGEX.test(ref)) {
		return true;
	}
	if (!BRANCH_TAG_REGEX.test(ref)) {
		return false;
	}
	if (ref.startsWith("-") || ref.includes("..")) {
		return false;
	}
	return true;
}

function isAbsolutePath(filePath) {
	if (path.isAbsolute(filePath)) return true;
	if (path.win32.isAbsolute(filePath)) return true;
	if (path.posix.isAbsolute(filePath)) return true;
	return /^[a-zA-Z]:/.test(filePath);
}

function hasTraversalSegment(filePath) {
	const segments = filePath.split(/[/\\]/);
	return segments.includes("..");
}

function hasValidExtension(filePath) {
	return filePath.endsWith(".kicad_pcb") || filePath.endsWith(".kicad_sch");
}

function isValidFilePath(filePath) {
	if (typeof filePath !== "string" || !filePath) {
		return false;
	}
	if (isAbsolutePath(filePath)) {
		return false;
	}
	if (hasTraversalSegment(filePath)) {
		return false;
	}
	return hasValidExtension(filePath);
}

function validateDiffGuards({ baseCommit, targetCommit, relativeFilePath }) {
	if (!isValidCommitRef(baseCommit) || !isValidCommitRef(targetCommit)) {
		return "Invalid commit ref";
	}
	if (!isValidFilePath(relativeFilePath)) {
		return "Invalid relative file path";
	}
	return null;
}

function validateLocalDiffParams(body) {
	return findMissingParamError(
		body,
		["repoPath", "baseCommit", "targetCommit", "relativeFilePath"],
		"Missing required parameters in request body. Required: ",
	);
}

function validateGithubDiffParams(token, body) {
	if (!token) {
		return { error: "GitHub authentication token required", status: 401 };
	}
	const error = findMissingParamError(
		body,
		["owner", "repo", "baseCommit", "targetCommit", "filePath"],
		"Missing required parameters: ",
	);
	return error ? { error, status: 400 } : null;
}

function extractAuthToken(req) {
	return (
		req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.body?.token
	);
}

function sendInternalError(res, error, details) {
	return res.status(500).json({ error, details });
}

async function extractCommitTarget({
	repoPath,
	commit,
	relativeFilePath,
	folderName,
	role,
}) {
	const fileBasename = path.basename(relativeFilePath);
	const targetPath = path.join(folderName, fileBasename);
	try {
		return await extractFileFromCommit(
			repoPath,
			commit,
			relativeFilePath,
			targetPath,
		);
	} catch (err) {
		const error = new Error(
			`Failed to extract file at ${role} commit (${commit})`,
		);
		error.details = err.message;
		throw error;
	}
}

async function extractLocalDiff(body, baseLoc, targetLoc) {
	const { repoPath, baseCommit, targetCommit, relativeFilePath } = body;
	const basePath = await extractCommitTarget({
		repoPath,
		commit: baseCommit,
		relativeFilePath,
		folderName: baseLoc.folderName,
		role: "base",
	});
	const targetPath = await extractCommitTarget({
		repoPath,
		commit: targetCommit,
		relativeFilePath,
		folderName: targetLoc.folderName,
		role: "target",
	});
	return { basePath, targetPath };
}

async function downloadGithubPair(token, body, baseLoc, targetLoc) {
	const { owner, repo, filePath, baseCommit, targetCommit } = body;
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
}

function resolveGithubIsPcb(isPcb, filePath) {
	return isPcb !== undefined ? isPcb : /\.kicad_pcb$/i.test(filePath);
}

function dispatchPipelineResult(
	res,
	{ paths, commits, isPcb, tExtraction, cleanFolders, tTotalStart },
) {
	return executeDiffPipeline(
		{
			basePath: paths.basePath,
			targetPath: paths.targetPath,
			baseCommit: commits.baseCommit,
			targetCommit: commits.targetCommit,
			isPcb,
			tExtraction,
			cleanExtractionFolders: cleanFolders,
			tTotalStart,
		},
		res,
	);
}

async function runLocalPipeline({ req, res, pair, tGitStart, tTotalStart }) {
	const { baseCommit, targetCommit, isPcb } = req.body;
	const paths = await extractLocalDiff(req.body, pair.baseLoc, pair.targetLoc);
	return dispatchPipelineResult(res, {
		paths,
		commits: { baseCommit, targetCommit },
		isPcb,
		tExtraction: performance.now() - tGitStart,
		cleanFolders: pair.cleanFolders,
		tTotalStart,
	});
}

async function runGithubPipeline({
	req,
	res,
	token,
	pair,
	tGhStart,
	tTotalStart,
}) {
	const { baseCommit, targetCommit, filePath, isPcb } = req.body;
	await downloadGithubPair(token, req.body, pair.baseLoc, pair.targetLoc);
	return dispatchPipelineResult(res, {
		paths: {
			basePath: pair.baseLoc.targetPath,
			targetPath: pair.targetLoc.targetPath,
		},
		commits: { baseCommit, targetCommit },
		isPcb: resolveGithubIsPcb(isPcb, filePath),
		tExtraction: performance.now() - tGhStart,
		cleanFolders: pair.cleanFolders,
		tTotalStart,
	});
}

/**
 * POST /api/diff/process
 * Local Git diff processor
 */
router.post("/diff/process", async (req, res) => {
	if (req.app?.locals?.allowLocalRepos !== true) {
		return res
			.status(403)
			.json({ error: "Local repositories are disabled on this server" });
	}

	const err = validateLocalDiffParams(req.body);
	if (err) return res.status(400).json({ error: err });

	const guardErr = validateDiffGuards(req.body);
	if (guardErr) return res.status(400).json({ error: guardErr });

	const tTotalStart = performance.now();
	const { baseCommit, targetCommit, relativeFilePath } = req.body;
	const pair = buildTempPair("git", baseCommit, targetCommit, relativeFilePath);
	const tGitStart = performance.now();

	try {
		return await runLocalPipeline({
			req,
			res,
			pair,
			tGitStart,
			tTotalStart,
		});
	} catch (extractErr) {
		return sendInternalError(res, extractErr.message, extractErr.details);
	}
});

/**
 * POST /api/github/diff/process
 * Remote GitHub diff processor (directly diffs remote branches, commits, or PRs)
 */
router.post("/github/diff/process", async (req, res) => {
	const token = extractAuthToken(req);
	const authErr = validateGithubDiffParams(token, req.body);
	if (authErr) return res.status(authErr.status).json({ error: authErr.error });

	const tTotalStart = performance.now();
	const { baseCommit, targetCommit, filePath } = req.body;
	const pair = buildTempPair("gh", baseCommit, targetCommit, filePath);
	const tGhStart = performance.now();

	try {
		return await runGithubPipeline({
			req,
			res,
			token,
			pair,
			tGhStart,
			tTotalStart,
		});
	} catch (err) {
		return sendInternalError(
			res,
			"Failed to download hardware file from GitHub",
			err.message,
		);
	}
});

export default router;
