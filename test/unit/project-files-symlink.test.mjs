import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import express from "express";
import { createProjectRouter } from "../../backend/src/routes/project-routes.js";

const ROOT = path.resolve(os.tmpdir(), "banana-symlink-project");
const OUTSIDE = path.resolve(os.tmpdir(), "banana-outside", "secret.kicad_sch");
const LINK = path.join(ROOT, "escape.kicad_sch");
const INNER_LINK = path.join(ROOT, "alias.kicad_pcb");
const REAL_FILES = new Set([
	path.join(ROOT, "main.kicad_pro"),
	path.join(ROOT, "board.kicad_pcb"),
	OUTSIDE,
]);
const LINKS = new Map([
	[LINK, OUTSIDE],
	[INNER_LINK, path.join(ROOT, "board.kicad_pcb")],
]);

function fileStat() {
	return {
		isDirectory: () => false,
		isFile: () => true,
		size: 10,
		mtime: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function resolveLink(p) {
	const res = path.resolve(p);
	return LINKS.get(res) ?? res;
}

function createLinkFs() {
	return {
		async realpath(p) {
			const res = resolveLink(p);
			if (res === ROOT || REAL_FILES.has(res)) return res;
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		},
		async stat(p) {
			const res = resolveLink(p);
			if (res === ROOT) return { isDirectory: () => true, isFile: () => false };
			if (REAL_FILES.has(res)) return fileStat();
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		},
		async readdir() {
			return [
				"main.kicad_pro",
				"board.kicad_pcb",
				"escape.kicad_sch",
				"alias.kicad_pcb",
			];
		},
	};
}

async function listFiles(fsImpl) {
	const app = express();
	app.locals.allowLocalRepos = true;
	app.use("/api", createProjectRouter({ fsImpl }));
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const query = encodeURIComponent(ROOT);
		const url = `http://127.0.0.1:${server.address().port}/api/projects/files?projectRoot=${query}`;
		const res = await fetch(url);
		return { status: res.status, json: await res.json() };
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

describe("project files symlink confinement", () => {
	test("GET /projects/files hides symlinks that resolve outside the project", async () => {
		const res = await listFiles(createLinkFs());
		assert.equal(res.status, 200);
		const names = res.json.files.map((f) => f.name);
		assert.ok(!names.includes("escape.kicad_sch"));
		assert.deepEqual(names, [
			"alias.kicad_pcb",
			"board.kicad_pcb",
			"main.kicad_pro",
		]);
		assert.ok(!JSON.stringify(res.json).includes("banana-outside"));
	});
});
