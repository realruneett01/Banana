import { emitCommitCreated } from "../designEvents.js";

export function normalizeCommitMessage(message) {
	return typeof message === "string" ? message.trim() : "";
}

export function buildWorktreeDiffValues(repoPath, baseCommit, filePath) {
	return {
		repoPath,
		baseCommit: baseCommit || "HEAD",
		targetCommit: "WORKTREE",
		relativeFilePath: filePath,
	};
}

export function buildCommitFilesRequest(
	{ repoPath, filePath, message },
	headers = {},
) {
	return {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({
			repoPath,
			files: [filePath],
			message: normalizeCommitMessage(message),
		}),
	};
}

async function readJson(res) {
	try {
		return await res.json();
	} catch {
		// Response body is not JSON
		return null;
	}
}

async function postCommit(options) {
	const { apiBase, fetchImpl, headers } = options;
	const res = await fetchImpl(
		`${apiBase}/api/git/commit-files`,
		buildCommitFilesRequest(options, headers),
	);
	const data = await readJson(res);
	if (res.status === 200 && data?.commit) {
		return { ok: true, commit: data.commit };
	}
	return { ok: false, error: data?.error || res.statusText || "Commit failed" };
}

export async function commitWorktreeFile(options) {
	if (!normalizeCommitMessage(options.message)) {
		return { ok: false, error: "Commit message is required" };
	}
	try {
		const result = await postCommit(options);
		if (result.ok) {
			const { repoPath, filePath } = options;
			emitCommitCreated({ repoPath, filePath, commit: result.commit });
		}
		return result;
	} catch (err) {
		// Network or fetch failure
		return { ok: false, error: err?.message || "Commit failed" };
	}
}
