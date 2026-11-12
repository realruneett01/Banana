import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createProjectFiles } from "../engine/kicad-project-template.js";

const IGNORED_PATTERNS = ["~", "_autosave", ".lck", "-bak"];
const ILLEGAL_PATTERNS = ["/", "\\", "..", "\0"];
const MAX_IMPORT_SIZE = 20 * 1024 * 1024;

const KIND_BY_EXTENSION = {
	".kicad_pro": "project",
	".kicad_sch": "schematic",
	".kicad_pcb": "pcb",
	".kicad_sym": "symbols",
	".kicad_mod": "footprint",
};

const ALLOWED_IMPORT_EXTS = new Set([
	".kicad_sch",
	".kicad_pcb",
	".kicad_sym",
	".kicad_mod",
]);

function defaultRunGit(cwd, args) {
	return new Promise((resolve, reject) => {
		childProcess.execFile(
			"git",
			args,
			{ cwd, timeout: 30000, windowsHide: true },
			(err, stdout, stderr) => {
				if (err) return reject(err);
				resolve({ stdout, stderr });
			},
		);
	});
}

function checkLocalAllowed(req, isLocalAllowed) {
	if (typeof isLocalAllowed === "function") {
		return isLocalAllowed(req);
	}
	return req?.app?.locals?.allowLocalRepos === true;
}

function isValidBoardDim(val) {
	if (typeof val !== "number" || !Number.isFinite(val)) {
		return false;
	}
	return val >= 10 && val <= 1000;
}

function validateBoardDimensions(body) {
	if (body.boardW !== undefined && !isValidBoardDim(body.boardW)) {
		return "Board size must be a number between 10 and 1000 mm";
	}
	if (body.boardH !== undefined && !isValidBoardDim(body.boardH)) {
		return "Board size must be a number between 10 and 1000 mm";
	}
	return null;
}

async function resolveParentDir(fsImpl, parentDir) {
	if (typeof parentDir !== "string" || parentDir.includes("\0")) {
		return null;
	}
	if (!path.isAbsolute(parentDir)) {
		return null;
	}
	try {
		const realParent = await fsImpl.realpath(parentDir);
		const stat = await fsImpl.stat(realParent);
		return stat?.isDirectory?.() ? realParent : null;
	} catch {
		// Broad catch to prevent leaking filesystem errors
		return null;
	}
}

async function targetExists(fsImpl, target) {
	try {
		await fsImpl.stat(target);
		return true;
	} catch {
		// Target does not exist
		return false;
	}
}

async function writeProjectFiles(fsImpl, target, files) {
	for (const [filename, content] of Object.entries(files)) {
		const filePath = path.join(target, filename);
		await fsImpl.writeFile(filePath, content, { flag: "wx" });
	}
}

async function initGitRepo(runGit, target, base) {
	await runGit(target, ["init"]);
	await runGit(target, ["add", "."]);
	await runGit(target, [
		"-c",
		"user.name=Banana",
		"-c",
		"user.email=banana@localhost",
		"commit",
		"-m",
		`Create project ${base}`,
	]);
}

async function provisionProject(res, deps, realParent, projectRes) {
	const { base, files } = projectRes;
	const target = path.join(realParent, base);
	if (await targetExists(deps.fsImpl, target)) {
		return res.status(409).json({
			error: "A folder with that name already exists",
		});
	}
	try {
		await deps.fsImpl.mkdir(target);
		await writeProjectFiles(deps.fsImpl, target, files);
		await initGitRepo(deps.runGit, target, base);
		return res.status(201).json({
			projectRoot: target,
			files: Object.keys(files),
		});
	} catch (_err) {
		// Broad catch to guarantee route never leaks stack traces
		return res.status(500).json({ error: "Could not create project" });
	}
}

async function handleCreate(req, res, deps) {
	if (!checkLocalAllowed(req, deps.isLocalAllowed)) {
		return res.status(403).json({
			error: "Creating projects is only available in the desktop app",
		});
	}
	const body = req.body ?? {};
	const boardErr = validateBoardDimensions(body);
	if (boardErr) {
		return res.status(400).json({ error: boardErr });
	}
	const realParent = await resolveParentDir(deps.fsImpl, body.parentDir);
	if (!realParent) {
		return res.status(400).json({ error: "Parent folder not found" });
	}
	const projectRes = createProjectFiles(body.name, {
		boardW: body.boardW,
		boardH: body.boardH,
	});
	if (!projectRes.ok) {
		return res.status(400).json({ error: projectRes.error });
	}
	return await provisionProject(res, deps, realParent, projectRes);
}

function isIgnoredFile(name) {
	if (typeof name !== "string" || name.startsWith(".")) {
		return true;
	}
	return IGNORED_PATTERNS.some((pattern) => name.includes(pattern));
}

function getFileKind(filename) {
	const ext = path.extname(filename).toLowerCase();
	return KIND_BY_EXTENSION[ext] ?? "other";
}

function formatModified(stat) {
	if (stat.mtime instanceof Date) {
		return stat.mtime.toISOString();
	}
	if (typeof stat.mtime === "string" || typeof stat.mtime === "number") {
		return new Date(stat.mtime).toISOString();
	}
	return new Date().toISOString();
}

async function hasProjectFile(fsImpl, dir) {
	try {
		const names = await fsImpl.readdir(dir);
		for (const name of names) {
			if (isIgnoredFile(name) || getFileKind(name) !== "project") {
				continue;
			}
			const stat = await fsImpl.stat(path.join(dir, name));
			if (stat?.isFile?.()) return true;
		}
		return false;
	} catch {
		// Broad catch to handle unreadable directories safely
		return false;
	}
}

async function resolveProjectRoot(fsImpl, projectRoot) {
	if (typeof projectRoot !== "string" || projectRoot.includes("\0")) {
		return { ok: false, error: "Project folder not found" };
	}
	if (!path.isAbsolute(projectRoot)) {
		return { ok: false, error: "Project folder not found" };
	}
	try {
		const realRoot = await fsImpl.realpath(projectRoot);
		const stat = await fsImpl.stat(realRoot);
		if (!stat?.isDirectory?.()) {
			return { ok: false, error: "Project folder not found" };
		}
		const hasPro = await hasProjectFile(fsImpl, realRoot);
		if (!hasPro) {
			return {
				ok: false,
				error: "Project folder must contain a .kicad_pro file",
			};
		}
		return { ok: true, realRoot };
	} catch {
		// Broad catch to prevent leaking path or filesystem errors
		return { ok: false, error: "Project folder not found" };
	}
}

async function buildFileEntry(fsImpl, dir, name) {
	if (isIgnoredFile(name)) {
		return null;
	}
	try {
		const stat = await fsImpl.stat(path.join(dir, name));
		if (!stat?.isFile?.()) {
			return null;
		}
		return {
			name,
			kind: getFileKind(name),
			size: stat.size ?? 0,
			modified: formatModified(stat),
		};
	} catch {
		// Broad catch to ignore unreadable files
		return null;
	}
}

async function collectProjectFiles(fsImpl, dir) {
	const names = await fsImpl.readdir(dir);
	const files = [];
	for (const name of names) {
		const entry = await buildFileEntry(fsImpl, dir, name);
		if (entry) {
			files.push(entry);
		}
	}
	files.sort((a, b) => a.name.localeCompare(b.name));
	return files;
}

async function handleListFiles(req, res, deps) {
	if (!checkLocalAllowed(req, deps.isLocalAllowed)) {
		return res.status(403).json({
			error: "Managing project files is only available in the desktop app",
		});
	}
	const rootRes = await resolveProjectRoot(deps.fsImpl, req.query?.projectRoot);
	if (!rootRes.ok) {
		return res.status(400).json({ error: rootRes.error });
	}
	try {
		const files = await collectProjectFiles(deps.fsImpl, rootRes.realRoot);
		return res.status(200).json({ files });
	} catch {
		// Broad catch to avoid leaking filesystem errors
		return res.status(500).json({ error: "Could not read project files" });
	}
}

function validateImportName(name) {
	if (typeof name !== "string" || name.length === 0) {
		return "Invalid file name";
	}
	if (name.length > 128 || ILLEGAL_PATTERNS.some((p) => name.includes(p))) {
		return "Invalid file name";
	}
	if (path.basename(name) !== name) {
		return "Invalid file name";
	}
	const ext = path.extname(name).toLowerCase();
	if (!ALLOWED_IMPORT_EXTS.has(ext)) {
		return "Invalid file extension";
	}
	return null;
}

function decodeImportContent(contentBase64) {
	if (typeof contentBase64 !== "string") {
		return { ok: false, error: "Missing or invalid file content" };
	}
	try {
		const buf = Buffer.from(contentBase64, "base64");
		if (buf.length > MAX_IMPORT_SIZE) {
			return { ok: false, error: "File exceeds 20 MB limit" };
		}
		return { ok: true, buffer: buf };
	} catch {
		// Broad catch for unexpected decoding failure
		return { ok: false, error: "Invalid file content" };
	}
}

async function writeImportedFile(res, fsImpl, filePath, fileData) {
	const { buffer, name } = fileData;
	try {
		await fsImpl.writeFile(filePath, buffer, { flag: "wx" });
		return res.status(201).json({ ok: true, name, size: buffer.length });
	} catch (err) {
		if (err?.code === "EEXIST") {
			return res.status(409).json({ error: "File already exists" });
		}
		// Broad catch to prevent leaking filesystem errors
		return res.status(500).json({ error: "Could not import file" });
	}
}

async function handleImport(req, res, deps) {
	if (!checkLocalAllowed(req, deps.isLocalAllowed)) {
		return res.status(403).json({
			error: "Managing project files is only available in the desktop app",
		});
	}
	const body = req.body ?? {};
	const rootRes = await resolveProjectRoot(deps.fsImpl, body.projectRoot);
	if (!rootRes.ok) {
		return res.status(400).json({ error: rootRes.error });
	}
	const nameErr = validateImportName(body.name);
	if (nameErr) {
		return res.status(400).json({ error: nameErr });
	}
	const contentRes = decodeImportContent(body.contentBase64);
	if (!contentRes.ok) {
		return res.status(400).json({ error: contentRes.error });
	}
	const filePath = path.join(rootRes.realRoot, body.name);
	return await writeImportedFile(res, deps.fsImpl, filePath, {
		buffer: contentRes.buffer,
		name: body.name,
	});
}

export function createProjectRouter(options = {}) {
	const {
		isLocalAllowed,
		fsImpl = fs.promises,
		runGit = defaultRunGit,
	} = options;
	const router = express.Router();
	const deps = { isLocalAllowed, fsImpl, runGit };
	router.post(["/projects/create", "/api/projects/create"], (req, res) =>
		handleCreate(req, res, deps),
	);
	router.get(["/projects/files", "/api/projects/files"], (req, res) =>
		handleListFiles(req, res, deps),
	);
	router.post(
		["/projects/import", "/api/projects/import"],
		express.json({ limit: "30mb" }),
		(req, res) => handleImport(req, res, deps),
	);
	return router;
}

const defaultRouter = createProjectRouter();
export default defaultRouter;
