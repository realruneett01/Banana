import { joinPath } from "./projectFiles.js";

const DESIGN_EXTS = [
	[".kicad_sch", "schematic"],
	[".kicad_pcb", "pcb"],
];

function toSlashes(p) {
	return String(p).replace(/\\/g, "/");
}

export function toRelativeFilePath(projectRoot, filePath) {
	if (!projectRoot || !filePath) return "";
	const root = `${toSlashes(projectRoot).replace(/\/+$/, "")}/`;
	const file = toSlashes(filePath);
	return file.startsWith(root) ? file.slice(root.length) : "";
}

function designKind(relPath) {
	const hit = DESIGN_EXTS.find(([ext]) => relPath.endsWith(ext));
	return hit ? hit[1] : null;
}

export function planProjectOpen(target) {
	const repoPath = target?.projectRoot;
	const relativeFilePath = toRelativeFilePath(repoPath, target?.filePath);
	const kind = designKind(relativeFilePath);
	if (!kind) return null;
	const isPcb = kind === "pcb";
	return {
		repoPath,
		relativeFilePath,
		editorRepo: {
			repoPath,
			schPath: isPcb ? undefined : relativeFilePath,
			pcbPath: isPcb ? relativeFilePath : undefined,
		},
	};
}

export function pickDiffCommits(commits) {
	const targetCommit = commits?.[0]?.hash;
	if (!targetCommit) return null;
	return { baseCommit: commits[1]?.hash ?? targetCommit, targetCommit };
}

export function createdProjectTarget(project) {
	const files = Array.isArray(project?.files) ? project.files : [];
	for (const [ext, kind] of DESIGN_EXTS) {
		const file = files.find((f) => f.endsWith(ext));
		if (file) {
			const { projectRoot } = project;
			return { projectRoot, filePath: joinPath(projectRoot, file), kind };
		}
	}
	return null;
}

export function shouldShowProjectHome({ homeRequested }) {
	return Boolean(homeRequested);
}
