import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "../config.js";
import { createProjectHeaders } from "../projects/useProjects.js";
import {
	buildWorktreeDiffValues,
	commitWorktreeFile,
} from "./commitWorktree.js";

function normalizePath(p) {
	if (!p || typeof p !== "string") return "";
	return p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function arePathsEqual(a, b) {
	if (!a || !b) return false;
	return normalizePath(a) === normalizePath(b);
}

async function executeCommitPending({ repoPath, filePath, message }) {
	const headers = await createProjectHeaders();
	return await commitWorktreeFile({
		apiBase: API_BASE_URL,
		fetchImpl: fetch,
		headers,
		repoPath,
		filePath,
		message,
	});
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
			onWorktreeDiff?.(buildWorktreeDiffValues(repoPath, baseCommit, filePath));
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
