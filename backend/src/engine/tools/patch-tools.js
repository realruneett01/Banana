import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { patchKicadText } from "../kicad-inplace.js";
import { createKicadLibrary } from "../kicad-library.js";
import {
	commitFiles,
	ensureGitWorkTree,
	validateMessage,
	validateRepoPath,
} from "./commit-tools.js";

const ROOT_OR_DRIVE = /^[a-zA-Z]:|^[/\\]/;

const PATCH_INPUT_SCHEMA = {
	type: "object",
	required: ["repoPath", "files", "message"],
	additionalProperties: false,
	properties: {
		repoPath: { type: "string" },
		files: {
			type: "array",
			items: {
				type: "object",
				required: ["path", "kind", "edits"],
				additionalProperties: false,
				properties: {
					path: { type: "string" },
					kind: { enum: ["sch", "pcb"] },
					edits: { type: "array" },
				},
			},
		},
		message: {
			type: "string",
			minLength: 1,
			pattern: "^[\\s\\S]{1,200}$",
		},
	},
};

const PATCH_OUTPUT_SCHEMA = {
	type: "object",
	required: ["commit", "files"],
	additionalProperties: false,
	properties: {
		commit: { type: "string" },
		files: {
			type: "array",
			items: {
				type: "object",
				required: ["path", "applied", "skipped"],
				additionalProperties: false,
				properties: {
					path: { type: "string" },
					applied: { type: "number" },
					skipped: { type: "array" },
				},
			},
		},
	},
};

function validatePathFormat(filePath) {
	if (typeof filePath !== "string" || filePath.length === 0) {
		throw new Error("path must be a non-empty string");
	}
	if (path.isAbsolute(filePath) || ROOT_OR_DRIVE.test(filePath)) {
		throw new Error("path must not be absolute");
	}
	if (filePath.includes("..") || filePath.includes("\\")) {
		throw new Error("path must not contain traversal characters");
	}
}

function validatePathInsideRepo(repoPath, filePath) {
	const resolved = path.resolve(repoPath, filePath);
	const rel = path.relative(repoPath, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error("path resolves outside repoPath");
	}
	return resolved;
}

function validateKindAndExtension(kind, filePath) {
	if (kind === "sch") {
		if (!filePath.endsWith(".kicad_sch")) {
			throw new Error("path must end with .kicad_sch for kind sch");
		}
		return;
	}
	if (kind === "pcb") {
		if (!filePath.endsWith(".kicad_pcb")) {
			throw new Error("path must end with .kicad_pcb for kind pcb");
		}
		return;
	}
	throw new Error(`unsupported kind: ${kind}`);
}

function validateEdits(edits) {
	if (!Array.isArray(edits) || edits.length > 500) {
		throw new Error("edits must be an array of at most 500 items");
	}
}

function validateFileEntry(repoPath, file) {
	if (!file || typeof file !== "object") {
		throw new Error("file entry must be an object");
	}
	validatePathFormat(file.path);
	const resolvedPath = validatePathInsideRepo(repoPath, file.path);
	validateKindAndExtension(file.kind, file.path);
	validateEdits(file.edits);
	return resolvedPath;
}

function checkDuplicatePaths(files) {
	const seen = new Set();
	for (const file of files) {
		const normalized = path.posix.normalize(file.path);
		if (seen.has(normalized)) {
			throw new Error("files must not repeat the same path");
		}
		seen.add(normalized);
	}
}

function validateFiles(repoPath, files) {
	if (!Array.isArray(files)) {
		throw new Error("files must be an array");
	}
	if (files.length < 1 || files.length > 2) {
		throw new Error("files must contain 1 or 2 entries");
	}
	const targets = files.map((file) => ({
		file,
		resolvedPath: validateFileEntry(repoPath, file),
	}));
	checkDuplicatePaths(files);
	return targets;
}

function stripClientFields(edit) {
	if (!edit || typeof edit !== "object") {
		return edit;
	}
	const { libSymbol, source, parentLibSymbol, ...rest } = edit;
	return rest;
}

async function resolveSymbolEdit(edit, library) {
	const src = await library.getSymbolSource(edit.libId);
	if (!src?.text) {
		throw new Error(`Library item not found: ${edit.libId}`);
	}
	const resolved = { ...edit, libSymbol: src.text };
	if (src.parentText) {
		resolved.parentLibSymbol = src.parentText;
	}
	return resolved;
}

async function resolveFootprintEdit(edit, library) {
	const src = await library.getFootprintSource(edit.libId);
	if (!src?.text) {
		throw new Error(`Library item not found: ${edit.libId}`);
	}
	return { ...edit, source: src.text };
}

async function mapSingleEdit(edit, library) {
	const stripped = stripClientFields(edit);
	if (stripped?.op === "addSymbol") {
		return await resolveSymbolEdit(stripped, library);
	}
	if (stripped?.op === "addFootprint") {
		return await resolveFootprintEdit(stripped, library);
	}
	return stripped;
}

async function mapFileEdits(edits, library) {
	const mapped = [];
	for (const edit of edits) {
		mapped.push(await mapSingleEdit(edit, library));
	}
	return mapped;
}

async function readAndPatchFile(deps, target) {
	const { file, resolvedPath } = target;
	const edits = await mapFileEdits(file.edits, deps.library);
	let content;
	try {
		content = await deps.fsImpl.readFile(resolvedPath, "utf8");
	} catch {
		// Avoid leaking system paths or raw filesystem error in message
		throw new Error(`Failed to read file: ${file.path}`);
	}
	const kind = file.path.endsWith(".kicad_sch") ? "sch" : "pcb";
	const res = deps.patchFn(content, { kind, edits });
	if (!res?.ok) {
		const reason = res?.error || "unknown patch failure";
		throw new Error(`Failed to patch ${file.path}: ${reason}`);
	}
	return {
		relPath: file.path,
		resolvedPath,
		text: res.text,
		applied: res.applied ?? edits.length,
		skipped: res.skipped ?? [],
	};
}

async function processPatchTargets(deps, targets) {
	const results = [];
	let totalApplied = 0;
	for (const target of targets) {
		const item = await readAndPatchFile(deps, target);
		totalApplied += item.applied;
		results.push(item);
	}
	if (totalApplied === 0) {
		throw new Error("No edits were applied");
	}
	return results;
}

async function writeAllPatchedFiles(fsImpl, results) {
	for (const item of results) {
		await fsImpl.writeFile(item.resolvedPath, item.text, "utf8");
	}
}

async function commitPatchedFiles(execFileFn, repoPath, results, message) {
	const relFiles = results.map((r) => r.relPath);
	const commit = await commitFiles(execFileFn, repoPath, relFiles, message);
	return {
		commit,
		files: results.map((r) => ({
			path: r.relPath,
			applied: r.applied,
			skipped: r.skipped,
		})),
	};
}

async function checkTargetRealPath(fsImpl, realRepo, resolvedPath) {
	let realTarget;
	try {
		realTarget = await fsImpl.realpath(resolvedPath);
	} catch {
		return;
	}
	const rel = path.relative(realRepo, realTarget);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error("path resolves outside repoPath");
	}
}

async function validateRealPaths(fsImpl, repoPath, targets) {
	if (typeof fsImpl?.realpath !== "function") {
		return;
	}
	let realRepo;
	try {
		realRepo = await fsImpl.realpath(repoPath);
	} catch {
		return;
	}
	for (const target of targets) {
		await checkTargetRealPath(fsImpl, realRepo, target.resolvedPath);
	}
}

function createPatchHandler(deps) {
	const { execFileFn, fsImpl } = deps;
	return async (input) => {
		validateRepoPath(input.repoPath);
		validateMessage(input.message);
		const targets = validateFiles(input.repoPath, input.files);
		await validateRealPaths(fsImpl, input.repoPath, targets);
		await ensureGitWorkTree(execFileFn, input.repoPath);

		const results = await processPatchTargets(deps, targets);
		await writeAllPatchedFiles(fsImpl, results);
		return await commitPatchedFiles(
			execFileFn,
			input.repoPath,
			results,
			input.message,
		);
	};
}

export function registerPatchTools(registry, deps = {}) {
	const execFileFn = deps.execFileFn ?? promisify(execFile);
	const fsImpl = deps.fsImpl ?? fs.promises;
	const patchFn = deps.patchKicadText ?? patchKicadText;
	const library = deps.library ?? createKicadLibrary();

	const handler = createPatchHandler({
		execFileFn,
		fsImpl,
		patchFn,
		library,
	});

	registry.register({
		name: "design.patch",
		description:
			"Applies targeted in-place edits to KiCad files and creates a git commit",
		inputSchema: PATCH_INPUT_SCHEMA,
		outputSchema: PATCH_OUTPUT_SCHEMA,
		permission: "destructive",
		handler,
	});
}
