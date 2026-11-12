import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createProjectFiles } from "../engine/kicad-project-template.js";

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
		return null;
	}
}

async function targetExists(fsImpl, target) {
	try {
		await fsImpl.stat(target);
		return true;
	} catch {
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
	return router;
}

const defaultRouter = createProjectRouter();
export default defaultRouter;
