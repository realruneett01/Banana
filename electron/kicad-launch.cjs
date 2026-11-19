const child_process = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WIN_VERSIONS = ["10.0", "9.0", "8.0"];
const DARWIN_APPS = {
	kicad: "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad",
	eeschema: "/Applications/KiCad/Eeschema.app/Contents/MacOS/eeschema",
	pcbnew: "/Applications/KiCad/Pcbnew.app/Contents/MacOS/pcbnew",
};

const PLATFORM_PATHS = {
	win32: (name, p) =>
		WIN_VERSIONS.map((v) =>
			p.join(`C:/Program Files/KiCad/${v}/bin`, `${name}.exe`),
		),
	darwin: (name) => [DARWIN_APPS[name]].filter(Boolean),
	linux: (name, p) => [
		p.join("/usr/bin", name),
		p.join("/usr/local/bin", name),
	],
};

const KIND_EXTENSIONS = {
	project: ".kicad_pro",
	schematic: ".kicad_sch",
	pcb: ".kicad_pcb",
};

function resolveCliDir(cliPath, p) {
	if (typeof cliPath !== "string") {
		return null;
	}
	if (!p.isAbsolute(cliPath)) {
		return null;
	}
	return p.dirname(cliPath);
}

function getToolCandidates(tool, platform, p, cliDir) {
	const ext = platform === "win32" ? ".exe" : "";
	const list = [];
	if (cliDir) {
		list.push(p.join(cliDir, `${tool}${ext}`));
	}
	const resolver = PLATFORM_PATHS[platform];
	if (resolver) {
		list.push(...resolver(tool, p));
	}
	return list;
}

function findFirstExisting(candidates, exists) {
	for (const candidate of candidates) {
		if (candidate && exists(candidate)) {
			return candidate;
		}
	}
	return null;
}

function findKicadGui({
	platform = process.platform,
	env = process.env,
	exists = fs.existsSync,
} = {}) {
	const p = platform === "win32" ? path.win32 : path.posix;
	const cliDir = resolveCliDir(env?.KICAD_CLI_PATH, p);
	const tools = ["kicad", "eeschema", "pcbnew"];
	const result = {};
	let foundAny = false;

	for (const tool of tools) {
		const candidates = getToolCandidates(tool, platform, p, cliDir);
		const found = findFirstExisting(candidates, exists);
		result[tool] = found;
		if (found) {
			foundAny = true;
		}
	}

	return foundAny ? result : null;
}

function isSafePathString(val) {
	if (typeof val !== "string") {
		return false;
	}
	if (val.includes("\0")) {
		return false;
	}
	const isAbs = path.isAbsolute(val) || path.win32.isAbsolute(val);
	return isAbs || path.posix.isAbsolute(val);
}

function checkPathStrings(filePath, projectRoot) {
	if (!isSafePathString(filePath)) {
		return false;
	}
	return isSafePathString(projectRoot);
}

function resolvePaths(filePath, projectRoot, realpath) {
	try {
		const resolvedFile = realpath(filePath);
		const resolvedRoot = realpath(projectRoot);
		return { resolvedFile, resolvedRoot };
	} catch {
		// realpathSync throws ENOENT when path does not exist on disk
		return null;
	}
}

function checkResolvedFile(resolved, exists) {
	if (!resolved) {
		return false;
	}
	return Boolean(exists(resolved.resolvedFile));
}

function isWithinRoot(rootDir, targetPath) {
	const rel = path.relative(rootDir, targetPath);
	if (rel === "" || rel.startsWith("..")) {
		return false;
	}
	return !path.isAbsolute(rel) && !path.win32.isAbsolute(rel);
}

function validateOpenRequest(
	{ kind, filePath, projectRoot } = {},
	{ realpath = fs.realpathSync, exists = fs.existsSync } = {},
) {
	const expectedExt = KIND_EXTENSIONS[kind];
	if (!expectedExt) {
		return { ok: false, error: "Invalid kind" };
	}
	if (!checkPathStrings(filePath, projectRoot)) {
		return { ok: false, error: "Invalid path" };
	}
	const resolved = resolvePaths(filePath, projectRoot, realpath);
	if (!checkResolvedFile(resolved, exists)) {
		return { ok: false, error: "File not found" };
	}
	if (!isWithinRoot(resolved.resolvedRoot, resolved.resolvedFile)) {
		return { ok: false, error: "Path outside project root" };
	}
	if (path.extname(resolved.resolvedFile).toLowerCase() !== expectedExt) {
		return { ok: false, error: "Invalid file extension" };
	}
	return { ok: true, file: resolved.resolvedFile };
}

function pickBinary(gui, kind) {
	if (!gui) {
		return null;
	}
	const map = {
		project: gui.kicad,
		schematic: gui.eeschema || gui.kicad,
		pcb: gui.pcbnew || gui.kicad,
	};
	return map[kind] || null;
}

function spawnProcess(binary, file, spawn) {
	try {
		const child = spawn(binary, [file], {
			detached: true,
			stdio: "ignore",
			shell: false,
			windowsHide: false,
		});
		if (child && typeof child.unref === "function") {
			child.unref();
		}
		return { ok: true };
	} catch {
		// Spawn can throw on missing executable or permission error
		return { ok: false, error: "Could not start KiCad" };
	}
}

function launchKicad(
	request,
	{ gui, spawn = child_process.spawn, ...validateDeps } = {},
) {
	const validation = validateOpenRequest(request, validateDeps);
	if (!validation.ok) {
		return validation;
	}
	const binary = pickBinary(gui, request?.kind);
	if (!binary) {
		return { ok: false, error: "KiCad is not installed" };
	}
	return spawnProcess(binary, validation.file, spawn);
}

module.exports = {
	findKicadGui,
	validateOpenRequest,
	launchKicad,
};
