import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { BANANA_DATA_DIR } from "../config.js";

const MAX_MATCHES = 10;
const MAX_VISITED = 4000;
const TIMEOUT_MS = 3000;
const MAX_DEPTH = 3;
const INVALID_PATTERNS = ["/", "\\", "..", "\0", ":"];

export function isValidRepoName(name) {
	if (typeof name !== "string") {
		return false;
	}
	if (name.length < 1 || name.length > 128) {
		return false;
	}
	return !INVALID_PATTERNS.some((pattern) => name.includes(pattern));
}

export function getDefaultRoots() {
	const home = os.homedir();
	return [
		BANANA_DATA_DIR,
		path.join(home, "Desktop"),
		path.join(home, "Documents"),
		path.join(home, "Projects"),
		path.join(home, "source", "repos"),
		path.join(home, "OneDrive", "Desktop"),
		path.join(home, "OneDrive", "Documents"),
		home,
	];
}

async function isAccessibleDir(dirPath, fsp) {
	try {
		const stat = await fsp.lstat(dirPath);
		return stat.isDirectory() && !stat.isSymbolicLink();
	} catch {
		// Inaccessible, non-existent, or permission denied
		return false;
	}
}

async function filterExistingRoots(roots, fsp) {
	const seen = new Set();
	const existing = [];
	for (const root of roots) {
		const resolved = path.resolve(root);
		const key =
			process.platform === "win32" ? resolved.toLowerCase() : resolved;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		if (await isAccessibleDir(resolved, fsp)) {
			existing.push(resolved);
		}
	}
	return existing;
}

function shouldSkipEntry(dirent) {
	if (dirent.isSymbolicLink() || !dirent.isDirectory()) {
		return true;
	}
	const name = dirent.name;
	if (name.startsWith(".")) {
		return true;
	}
	const lower = name.toLowerCase();
	return lower === "node_modules" || lower === "appdata";
}

function matchesBaseName(dirPath, targetName) {
	const base = path.basename(dirPath);
	if (process.platform === "win32") {
		return base.toLowerCase() === targetName.toLowerCase();
	}
	return base === targetName;
}

function hasGitEntry(entries) {
	return entries.some((e) => e.name === ".git");
}

function isMatch(dirPath, targetName, entries) {
	return matchesBaseName(dirPath, targetName) && hasGitEntry(entries);
}

async function readDirSafe(dirPath, fsp) {
	try {
		return await fsp.readdir(dirPath, { withFileTypes: true });
	} catch {
		// Directory unreadable or permission denied
		return null;
	}
}

function enqueueChildren(queue, entries, dirPath, depth) {
	if (depth >= MAX_DEPTH) {
		return;
	}
	for (const entry of entries) {
		if (!shouldSkipEntry(entry)) {
			queue.push({
				dirPath: path.join(dirPath, entry.name),
				depth: depth + 1,
			});
		}
	}
}

function shouldStopSearch(state, startTime) {
	if (
		state.matches.length >= MAX_MATCHES ||
		state.visitedCount >= MAX_VISITED
	) {
		return true;
	}
	return Date.now() - startTime >= TIMEOUT_MS;
}

async function processDir(item, state, targetName, fsp) {
	const { dirPath, depth } = item;
	const key = process.platform === "win32" ? dirPath.toLowerCase() : dirPath;
	if (state.visited.has(key)) {
		return;
	}
	state.visited.add(key);
	state.visitedCount++;

	const entries = await readDirSafe(dirPath, fsp);
	if (!entries) {
		return;
	}
	if (isMatch(dirPath, targetName, entries)) {
		state.matches.push(dirPath);
	}
	enqueueChildren(state.queue, entries, dirPath, depth);
}

async function searchQueue(queue, targetName, fsp) {
	const state = { queue, visited: new Set(), matches: [], visitedCount: 0 };
	const startTime = Date.now();

	while (queue.length > 0 && !shouldStopSearch(state, startTime)) {
		await processDir(queue.shift(), state, targetName, fsp);
	}
	return state.matches;
}

async function findLocalRepos(candidateRoots, targetName, fsp) {
	const roots = await filterExistingRoots(candidateRoots, fsp);
	const queue = roots.map((dirPath) => ({ dirPath, depth: 0 }));
	const matches = await searchQueue(queue, targetName, fsp);
	matches.sort((a, b) => a.length - b.length || a.localeCompare(b));
	return matches.slice(0, MAX_MATCHES);
}

function resolveFsPromises(fsImpl) {
	if (fsImpl?.promises) {
		return fsImpl.promises;
	}
	if (fsImpl?.readdir) {
		return fsImpl;
	}
	return fs.promises;
}

export function createLocalRepoRouter(options = {}) {
	const router = express.Router();
	const activeRoots = options.roots ?? getDefaultRoots();
	const fsp = resolveFsPromises(options.fsImpl);

	router.get(
		["/local-repos/find", "/api/local-repos/find"],
		async (req, res) => {
			const name = req.query?.name;
			if (!isValidRepoName(name)) {
				return res.status(400).json({ error: "Invalid repository name" });
			}
			try {
				const matches = await findLocalRepos(activeRoots, name, fsp);
				return res.json({ matches });
			} catch {
				// Search processing failure
				return res.status(500).json({ error: "Search failed" });
			}
		},
	);

	return router;
}

const defaultRouter = createLocalRepoRouter();
export default defaultRouter;
