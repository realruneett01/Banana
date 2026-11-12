import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../config.js";
import { emitCommitCreated } from "../designEvents.js";

function normalizePath(p) {
	if (!p || typeof p !== "string") return "";
	return p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function arePathsEqual(a, b) {
	if (!a || !b) return false;
	return normalizePath(a) === normalizePath(b);
}

async function getAuthHeader() {
	try {
		if (typeof window !== "undefined" && window.banana?.getApiToken) {
			const token = await window.banana.getApiToken();
			if (token) return { "x-banana-auth": token };
		}
	} catch {
		// Ignore token retrieval errors
	}
	return {};
}

async function parseJsonResponse(res) {
	try {
		return await res.json();
	} catch {
		// Response body is not JSON
		return null;
	}
}

async function postCommitFiles(repoPath, filePath, message) {
	const authHeader = await getAuthHeader();
	return await fetch(`${API_BASE_URL}/api/git/commit-files`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...authHeader,
		},
		body: JSON.stringify({
			repoPath,
			files: [filePath],
			message,
		}),
	});
}

async function executeCommitPending({ repoPath, filePath, message }) {
	try {
		const trimmed = (message ?? "").trim();
		const res = await postCommitFiles(repoPath, filePath, trimmed);
		const data = await parseJsonResponse(res);
		if (res.status === 200 && data?.commit) {
			emitCommitCreated({ repoPath, filePath, commit: data.commit });
			return { ok: true, commit: data.commit };
		}
		const error = data?.error ?? (res.statusText || "Commit failed");
		return { ok: false, error };
	} catch (err) {
		// Network or fetch failure
		return { ok: false, error: err?.message || "Commit failed" };
	}
}

function useKicadSubscription({
	repoPath,
	baseCommit,
	onWorktreeDiff,
	onFileChange,
}) {
	useEffect(() => {
		if (typeof window === "undefined" || !window.banana?.kicad?.onFileChanged) {
			return;
		}
		const unsubscribe = window.banana.kicad.onFileChanged((payload) => {
			if (!payload) return;
			const { projectRoot, filePath } = payload;
			if (!arePathsEqual(projectRoot, repoPath)) return;
			onFileChange(filePath);
			onWorktreeDiff?.({
				repoPath,
				baseCommit,
				targetCommit: "WORKTREE",
				relativeFilePath: filePath,
			});
		});
		return () => {
			if (typeof unsubscribe === "function") unsubscribe();
		};
	}, [repoPath, baseCommit, onWorktreeDiff, onFileChange]);
}

function useCommitCallback({ repoPath, pending, setPending }) {
	return useCallback(
		async (commitMessage) => {
			if (!pending?.filePath) {
				return { ok: false, error: "No pending change to commit" };
			}
			const result = await executeCommitPending({
				repoPath,
				filePath: pending.filePath,
				message: commitMessage,
			});
			if (result.ok) setPending(null);
			return result;
		},
		[repoPath, pending, setPending],
	);
}

export function useKicadSaves(options = {}) {
	const { repoPath, baseCommit, onWorktreeDiff } = options;
	const [pending, setPending] = useState(null);
	const [prevRepo, setPrevRepo] = useState(repoPath);

	if (repoPath !== prevRepo) {
		setPrevRepo(repoPath);
		setPending(null);
	}

	const onFileChange = useCallback((filePath) => setPending({ filePath }), []);
	const dismiss = useCallback(() => setPending(null), []);
	useKicadSubscription({ repoPath, baseCommit, onWorktreeDiff, onFileChange });
	const commitPending = useCommitCallback({ repoPath, pending, setPending });

	return { pending, commitPending, dismiss };
}

export default useKicadSaves;
