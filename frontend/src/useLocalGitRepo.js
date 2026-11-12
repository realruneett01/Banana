import { message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "./config.js";
import { onCommitCreated } from "./designEvents.js";

function isKiCadDesignFile(filePath) {
	return filePath?.endsWith(".kicad_pcb") || filePath?.endsWith(".kicad_sch");
}

function updateSelectedCommits(commits, setBaseCommit, setTargetCommit, form) {
	if (!commits || commits.length === 0) {
		setBaseCommit("");
		setTargetCommit("");
		form.setFieldsValue({ baseCommit: "", targetCommit: "" });
		return;
	}

	setBaseCommit((currentBase) => {
		const hasBase = commits.some((c) => c.hash === currentBase);
		if (hasBase) return currentBase;
		const nextBase = commits[Math.min(1, commits.length - 1)].hash;
		form.setFieldValue("baseCommit", nextBase);
		return nextBase;
	});

	setTargetCommit((currentTarget) => {
		const hasTarget = commits.some((c) => c.hash === currentTarget);
		if (hasTarget) return currentTarget;
		const nextTarget = commits[0].hash;
		form.setFieldValue("targetCommit", nextTarget);
		return nextTarget;
	});
}

function selectCommitPair(commits, previousTarget) {
	const hasPrevious = Boolean(
		previousTarget && commits.some((c) => c.hash === previousTarget),
	);
	const baseCommit = hasPrevious ? previousTarget : (commits[1]?.hash ?? "");
	const targetCommit = commits[0]?.hash ?? "";
	return { baseCommit, targetCommit };
}

function applyAutoSelection(commits, pending, ctx) {
	const { baseCommit, targetCommit } = selectCommitPair(
		commits,
		pending.previousTarget,
	);
	ctx.setBaseCommit(baseCommit);
	ctx.setTargetCommit(targetCommit);
	ctx.form.setFieldsValue({ baseCommit, targetCommit });
	const relativeFilePath = pending.filePath || ctx.relativeFilePath;
	ctx.onCommitsAutoSelected?.({
		baseCommit,
		targetCommit,
		relativeFilePath,
	});
}

function handleFetchedCommits(commits, ctx) {
	ctx.setRepoInfo((prev) => (prev ? { ...prev, commits } : null));
	if (ctx.pendingRef.current) {
		const pending = ctx.pendingRef.current;
		applyAutoSelection(commits, pending, ctx);
		ctx.pendingRef.current = null;
		return;
	}
	updateSelectedCommits(
		commits,
		ctx.setBaseCommit,
		ctx.setTargetCommit,
		ctx.form,
	);
}

function handleCommitEvent(detail, ctx) {
	const current = ctx.repoPath?.trim();
	const incoming = detail?.repoPath?.trim();
	if (!current || current !== incoming) return;

	ctx.pendingRef.current = {
		previousTarget: ctx.form.getFieldValue("targetCommit"),
		filePath: detail?.filePath,
	};
	if (typeof detail?.filePath === "string" && detail.filePath.length > 0) {
		ctx.setRelativeFilePath(detail.filePath);
	}
	ctx.setRefreshKey((k) => k + 1);
}

function fetchFileCommits(repoPath, relativeFilePath, onData) {
	const query = `repoPath=${encodeURIComponent(repoPath)}&filePath=${encodeURIComponent(relativeFilePath)}`;
	fetch(`${API_BASE_URL}/api/git/commits?${query}`)
		.then((res) => (res.ok ? res.json() : null))
		.then((data) => {
			if (data?.commits) onData(data.commits);
		})
		.catch((err) =>
			console.error("Failed to fetch file-specific commits:", err),
		);
}

function parseDroppedFile(file) {
	const native = file.originFileObj || file;
	const path = native.webkitRelativePath || "";
	if (path) {
		const parts = path.split("/");
		return { repoName: parts[0], relPath: parts.slice(1).join("/") };
	}
	return { repoName: null, relPath: native.name };
}

async function initGitRepoApi(path) {
	const response = await fetch(`${API_BASE_URL}/api/git/init`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ repoPath: path }),
	});
	if (!response.ok) {
		const err = await response.json();
		throw new Error(err.error || "Failed to detect git repo details");
	}
	return response.json();
}

async function fetchDiffFilesApi(path, base, target) {
	const response = await fetch(`${API_BASE_URL}/api/git/diff-files`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ repoPath: path, baseRef: base, targetRef: target }),
	});
	return response.ok ? response.json() : null;
}

function useRepoInfoLoader({
	form,
	relativeFilePath,
	setRelativeFilePath,
	setRepoPath,
}) {
	const [repoInfo, setRepoInfo] = useState(null);

	const loadRepoInfo = useCallback(
		async (path, silent = false) => {
			if (!path) return;
			try {
				const data = await initGitRepoApi(path);
				setRepoInfo(data);
				form.setFieldsValue({ repoPath: data.resolvedPath });
				setRepoPath(data.resolvedPath);

				if (
					data.kicadFiles?.length > 0 &&
					!data.kicadFiles.includes(relativeFilePath)
				) {
					setRelativeFilePath(data.kicadFiles[0]);
					form.setFieldsValue({ relativeFilePath: data.kicadFiles[0] });
				}
				if (!silent)
					message.success(`Repository detected: ${data.resolvedPath}`);
			} catch (err) {
				message.error(err.message);
			}
		},
		[form, relativeFilePath, setRelativeFilePath, setRepoPath],
	);

	return { repoInfo, setRepoInfo, loadRepoInfo };
}

function useFileCommitsEffect({
	repoPath,
	relativeFilePath,
	refreshKey,
	form,
	setBaseCommit,
	setTargetCommit,
	setRepoInfo,
	pendingRef,
	onCommitsAutoSelected,
}) {
	useEffect(() => {
		if (!repoPath || !relativeFilePath || refreshKey === undefined) return;
		fetchFileCommits(repoPath, relativeFilePath, (commits) => {
			handleFetchedCommits(commits, {
				form,
				relativeFilePath,
				setBaseCommit,
				setTargetCommit,
				setRepoInfo,
				pendingRef,
				onCommitsAutoSelected,
			});
		});
	}, [
		repoPath,
		relativeFilePath,
		refreshKey,
		form,
		setBaseCommit,
		setTargetCommit,
		setRepoInfo,
		pendingRef,
		onCommitsAutoSelected,
	]);
}

function areRefsValid(path, base, target) {
	return Boolean(path && base && target);
}

function applyDiffFilesResult(files, form, setRelativeFilePath) {
	const firstFile = files?.[0] ?? "";
	setRelativeFilePath(firstFile);
	form.setFieldValue("relativeFilePath", firstFile);

	if (files?.length) {
		message.info(
			`Found ${files.length} changed design file(s) between selected refs.`,
		);
	} else {
		message.warning("No changed KiCad design files found between these refs.");
	}
}

function useChangedFilesFetcher({ form, setRelativeFilePath }) {
	const [changedFiles, setChangedFiles] = useState([]);

	const fetchChangedFiles = useCallback(
		async (path, base, target) => {
			if (!areRefsValid(path, base, target)) return;
			try {
				const data = await fetchDiffFilesApi(path, base, target);
				const files = data?.files ?? [];
				setChangedFiles(files);
				applyDiffFilesResult(files, form, setRelativeFilePath);
			} catch (err) {
				console.error("Failed to fetch changed files:", err);
			}
		},
		[form, setRelativeFilePath],
	);

	return { changedFiles, setChangedFiles, fetchChangedFiles };
}

function useGitDropHandlers({ form, setRelativeFilePath, loadRepoInfo }) {
	const repoLoadTimeoutRef = useRef(null);

	const handleFileDraggedOrDropped = useCallback(
		(file) => {
			const { repoName, relPath } = parseDroppedFile(file);
			if (isKiCadDesignFile(relPath)) {
				setRelativeFilePath(relPath);
				form.setFieldValue("relativeFilePath", relPath);
			}
			if (repoName) {
				if (repoLoadTimeoutRef.current)
					clearTimeout(repoLoadTimeoutRef.current);
				repoLoadTimeoutRef.current = setTimeout(
					() => loadRepoInfo(repoName, false),
					300,
				);
			} else {
				message.info(
					"Single file dropped. Please verify or input the local absolute repository path below.",
				);
			}
		},
		[form, loadRepoInfo, setRelativeFilePath],
	);

	const handleFolderDrop = useCallback(
		(e) => {
			e.preventDefault();
			const item = e.dataTransfer.items?.[0];
			const entry = item?.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
			if (entry?.isDirectory) {
				loadRepoInfo(entry.name, false);
			} else if (item?.getAsFile?.()) {
				message.info(
					"To initialize branches/commits, please drag and drop the root Git repository folder.",
				);
			}
		},
		[loadRepoInfo],
	);

	return { handleFileDraggedOrDropped, handleFolderDrop };
}

export function useLocalGitRepo(options) {
	const {
		form,
		repoPath,
		setRepoPath,
		relativeFilePath,
		setRelativeFilePath,
		setBaseCommit,
		setTargetCommit,
		onCommitsAutoSelected,
	} = options;

	const [compareBranches, setCompareBranches] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const pendingRef = useRef(null);

	useEffect(() => {
		const unsubscribe = onCommitCreated((detail) => {
			handleCommitEvent(detail, {
				repoPath,
				form,
				setRelativeFilePath,
				setRefreshKey,
				pendingRef,
			});
		});
		return () => {
			if (typeof unsubscribe === "function") unsubscribe();
		};
	}, [repoPath, form, setRelativeFilePath]);

	const { repoInfo, setRepoInfo, loadRepoInfo } = useRepoInfoLoader({
		form,
		relativeFilePath,
		setRelativeFilePath,
		setRepoPath,
	});
	useFileCommitsEffect({
		repoPath,
		relativeFilePath,
		refreshKey,
		form,
		setBaseCommit,
		setTargetCommit,
		setRepoInfo,
		pendingRef,
		onCommitsAutoSelected,
	});
	const { changedFiles, setChangedFiles, fetchChangedFiles } =
		useChangedFilesFetcher({ form, setRelativeFilePath });
	const { handleFileDraggedOrDropped, handleFolderDrop } = useGitDropHandlers({
		form,
		setRelativeFilePath,
		loadRepoInfo,
	});

	return {
		repoInfo,
		setRepoInfo,
		compareBranches,
		setCompareBranches,
		changedFiles,
		setChangedFiles,
		loadRepoInfo,
		fetchChangedFiles,
		handleFileDraggedOrDropped,
		handleFolderDrop,
	};
}
