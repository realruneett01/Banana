import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../config.js";
import { createProjectHeaders } from "../projects/useProjects.js";
import {
	buildWorktreeDiffValues,
	commitWorktreeFile,
	kicadFileChanges,
	normalizePath,
	shouldRefreshOnMount,
} from "./commitWorktree.js";

// Mount once near the app root: owns the session-long KiCad subscription.
export function useKicadFileFeed() {
	useEffect(() => {
		kicadFileChanges.start();
		return kicadFileChanges.stop;
	}, []);
}

function pendingFor(repoPath) {
	const filePath = kicadFileChanges.latestFor(repoPath);
	return filePath ? { filePath } : null;
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
		return kicadFileChanges.subscribe(({ projectRoot, filePath }) => {
			if (!arePathsEqual(projectRoot, repoPath)) return;
			onFileChange(filePath);
			onWorktreeDiff?.(buildWorktreeDiffValues(repoPath, baseCommit, filePath));
		});
	}, [repoPath, baseCommit, onWorktreeDiff, onFileChange]);
}

function useCommitCallback({ repoPath, pending, clearPending }) {
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
			if (result.ok) clearPending();
			return result;
		},
		[repoPath, pending, clearPending],
	);
}

export function useKicadSaves(options = {}) {
	const { repoPath, baseCommit, onWorktreeDiff } = options;
	const [pending, setPending] = useState(() => pendingFor(repoPath));
	const [prevRepo, setPrevRepo] = useState(repoPath);

	if (repoPath !== prevRepo) {
		setPrevRepo(repoPath);
		setPending(pendingFor(repoPath));
	}

	const onFileChange = useCallback((filePath) => setPending({ filePath }), []);
	const dismiss = useCallback(() => {
		kicadFileChanges.clear(repoPath);
		setPending(null);
	}, [repoPath]);

	// On mount / repo change: if a remembered file exists, refresh the diff once.
	// The callback is read through a ref so a new identity never re-runs the refresh.
	const diffRef = useRef(onWorktreeDiff);
	diffRef.current = onWorktreeDiff;
	useEffect(() => {
		const filePath = kicadFileChanges.latestFor(repoPath);
		if (shouldRefreshOnMount(filePath)) {
			diffRef.current?.(
				buildWorktreeDiffValues(repoPath, baseCommit, filePath),
			);
		}
	}, [repoPath, baseCommit]);

	useKicadSubscription({ repoPath, baseCommit, onWorktreeDiff, onFileChange });
	const commitPending = useCommitCallback({
		repoPath,
		pending,
		clearPending: dismiss,
	});

	return { pending, commitPending, dismiss };
}

export default useKicadSaves;
