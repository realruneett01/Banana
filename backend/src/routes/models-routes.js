import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config, KICAD_3DMODEL_DIR } from "../config.js";

const EXT_REGEX = /\.(?:wrl|step|stp)$/i;
const VAR_PREFIX_REGEX =
	/^(?:\$\{(?:KICAD\d*_3DMODEL_DIR|KISYS3DMOD)\}|\$(?:KICAD\d*_3DMODEL_DIR|KISYS3DMOD))[/\\]?/i;

function isConfiguredDir(dir) {
	if (!dir || typeof dir !== "string") return false;
	try {
		return fs.statSync(dir).isDirectory();
	} catch {
		// Non-existent or inaccessible model directory
		return false;
	}
}

function hasInvalidTokens(p) {
	if (p.includes("\0") || p.includes("..")) return true;
	if (p.startsWith("/") || p.startsWith("\\")) return true;
	if (p.toLowerCase().includes("%2e")) return true;
	return /[a-zA-Z]:/.test(p);
}

function isValidModelPath(rawPath) {
	if (typeof rawPath !== "string" || !rawPath.trim()) return false;
	if (hasInvalidTokens(rawPath)) return false;
	return EXT_REGEX.test(rawPath);
}

function stripModelVariable(rawPath) {
	return rawPath.replace(VAR_PREFIX_REGEX, "");
}

function isValidRelativePath(rel) {
	if (!rel || hasInvalidTokens(rel)) return false;
	return EXT_REGEX.test(rel);
}

function resolveSafePath(rootDir, rel) {
	const resolvedRoot = path.resolve(rootDir);
	const normalizedRel = rel.replace(/\\/g, "/");
	const resolvedPath = path.resolve(resolvedRoot, normalizedRel);
	const rootWithSep = resolvedRoot.endsWith(path.sep)
		? resolvedRoot
		: resolvedRoot + path.sep;
	if (!resolvedPath.startsWith(rootWithSep)) return null;
	return resolvedPath;
}

function findModelFile(resolvedPath) {
	const ext = path.extname(resolvedPath).toLowerCase();
	if (ext === ".step" || ext === ".stp") {
		const wrlCandidate = `${resolvedPath.slice(0, -ext.length)}.wrl`;
		if (fs.existsSync(wrlCandidate)) {
			return { filePath: wrlCandidate, contentType: "model/vrml" };
		}
		if (fs.existsSync(resolvedPath)) {
			return { filePath: resolvedPath, contentType: "application/step" };
		}
		return null;
	}
	if (!fs.existsSync(resolvedPath)) return null;
	return { filePath: resolvedPath, contentType: "model/vrml" };
}

function streamModelFile(res, filePath, contentType) {
	let stat;
	try {
		stat = fs.statSync(filePath);
	} catch {
		// File vanished between check and stat
		return res.status(404).json({ error: "Model not found" });
	}
	if (!stat.isFile()) {
		return res.status(404).json({ error: "Model not found" });
	}
	res.setHeader("Content-Type", contentType);
	res.setHeader("Cache-Control", "public, max-age=86400");
	res.setHeader("Content-Length", stat.size);
	const stream = fs.createReadStream(filePath);
	stream.on("error", () => {
		if (!res.headersSent) {
			res.status(500).json({ error: "Failed to read model file" });
		}
	});
	res.on("close", () => stream.destroy());
	return stream.pipe(res);
}

function handleGetModel(modelDir, req, res) {
	if (!isConfiguredDir(modelDir)) {
		return res
			.status(503)
			.json({ error: "KiCad 3D model directory is not configured" });
	}
	const rawPath = req.query?.path;
	if (!isValidModelPath(rawPath)) {
		return res.status(400).json({ error: "Invalid model path" });
	}
	const rel = stripModelVariable(rawPath);
	if (!isValidRelativePath(rel)) {
		return res.status(400).json({ error: "Invalid model path" });
	}
	const resolvedPath = resolveSafePath(modelDir, rel);
	if (!resolvedPath) {
		return res.status(400).json({ error: "Invalid model path" });
	}
	const model = findModelFile(resolvedPath);
	if (!model) {
		return res.status(404).json({ error: "Model not found" });
	}
	return streamModelFile(res, model.filePath, model.contentType);
}

export function createModelsRouter(options = {}) {
	const modelDir =
		options.modelDir !== undefined
			? options.modelDir
			: config?.kicad3dModelDir || KICAD_3DMODEL_DIR;
	const router = express.Router();
	router.get("/models", (req, res) => handleGetModel(modelDir, req, res));
	return router;
}

const defaultRouter = createModelsRouter();
export default defaultRouter;
