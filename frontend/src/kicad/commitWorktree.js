import { emitCommitCreated } from "../designEvents.js";

export function normalizePath(p) {
	if (!p || typeof p !== "string") return "";
	return p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// One app-level subscription to KiCad file changes, fanned out to readers.
// Remembers the last changed file per project so late readers still see it.
export function createFileChangeHub(getSource) {
	const readers = new Set();
	const latest = new Map();
	let release = null;

	const emit = (payload) => {
		if (!payload) return;
		latest.set(normalizePath(payload.projectRoot), payload.filePath);
		for (const reader of readers) reader(payload);
	};

	const start = () => {
		const source = release ? null : getSource();
		if (typeof source !== "function") return;
		const unsubscribe = source(emit);
		release = typeof unsubscribe === "function" ? unsubscribe : () => {};
	};

	const stop = () => {
		release?.();
		release = null;
	};

	const subscribe = (reader) => {
		readers.add(reader);
		return () => readers.delete(reader);
	};

	return {
		start,
		stop,
		subscribe,
		latestFor: (repoPath) => latest.get(normalizePath(repoPath)) ?? null,
		clear: (repoPath) => latest.delete(normalizePath(repoPath)),
	};
}

export const kicadFileChanges = createFileChangeHub(
	() => globalThis.window?.banana?.kicad?.onFileChanged,
);

export function normalizeCommitMessage(message) {
	return typeof message === "string" ? message.trim() : "";
}

// Returns true when a remembered file should trigger a diff refresh on mount.
export function shouldRefreshOnMount(filePath) {
	return typeof filePath === "string" && filePath.length > 0;
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
