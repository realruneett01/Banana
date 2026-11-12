import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createProjectRouter } from "../../backend/src/routes/project-routes.js";

const VALID_ROOT = path.resolve(os.tmpdir(), "banana-test-project-files");
const NO_PRO_ROOT = path.resolve(os.tmpdir(), "banana-test-no-pro");
const FILE_ROOT = path.join(VALID_ROOT, "some-file.txt");

function makeFsError(code, message) {
	const err = new Error(message || code);
	err.code = code;
	return err;
}

function normalizeFileMap(files) {
	const fileMap = new Map();
	for (const [k, v] of Object.entries(files)) {
		const res = path.resolve(k);
		if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
			const content = v.content ?? "";
			const size = v.size ?? Buffer.byteLength(content);
			const mtime = v.mtime ?? new Date("2026-01-01T00:00:00.000Z");
			fileMap.set(res, { content, size, mtime });
		} else {
			const buf = Buffer.isBuffer(v) ? v : Buffer.from(String(v ?? ""));
			fileMap.set(res, {
				content: v,
				size: buf.length,
				mtime: new Date("2026-01-01T00:00:00.000Z"),
			});
		}
	}
	return fileMap;
}

function createFakeFs({ dirs = [], files = {}, failWrite = false } = {}) {
	const dirSet = new Set(dirs.map((d) => path.resolve(d)));
	const fileMap = normalizeFileMap(files);
	const writes = [];
	return {
		writes,
		async realpath(p) {
			const res = path.resolve(p);
			if (dirSet.has(res) || fileMap.has(res)) return res;
			throw makeFsError("ENOENT", `realpath '${p}'`);
		},
		async stat(p) {
			const res = path.resolve(p);
			if (dirSet.has(res))
				return { isDirectory: () => true, isFile: () => false };
			if (fileMap.has(res)) {
				const meta = fileMap.get(res);
				return {
					isDirectory: () => false,
					isFile: () => true,
					size: meta.size,
					mtime: meta.mtime,
				};
			}
			throw makeFsError("ENOENT", `stat '${p}'`);
		},
		async readdir(p) {
			const res = path.resolve(p);
			if (!dirSet.has(res)) throw makeFsError("ENOENT", `readdir '${p}'`);
			const entries = new Set();
			for (const d of dirSet) {
				if (path.dirname(d) === res && d !== res) {
					entries.add(path.basename(d));
				}
			}
			for (const f of fileMap.keys()) {
				if (path.dirname(f) === res) {
					entries.add(path.basename(f));
				}
			}
			return Array.from(entries);
		},
		async writeFile(p, content, options) {
			if (failWrite) throw new Error("Disk write failed");
			const res = path.resolve(p);
			if (options?.flag === "wx" && fileMap.has(res)) {
				throw makeFsError("EEXIST", `writeFile '${p}'`);
			}
			writes.push({ path: res, content, options });
			const buf = Buffer.isBuffer(content)
				? content
				: Buffer.from(String(content));
			fileMap.set(res, {
				content,
				size: buf.length,
				mtime: new Date("2026-01-01T00:00:00.000Z"),
			});
		},
	};
}

async function startServer(router, allowLocal = true) {
	const app = express();
	app.locals.allowLocalRepos = allowLocal;
	app.use("/api", router);
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

async function getJson(port, routePath) {
	const res = await fetch(`http://127.0.0.1:${port}${routePath}`);
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: res.status, json };
}

async function postJson(port, routePath, body) {
	const res = await fetch(`http://127.0.0.1:${port}${routePath}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: res.status, json };
}

const TABLE_400_CASES = [
	{
		label: "GET missing projectRoot query param",
		method: "GET",
		path: "/api/projects/files",
	},
	{
		label: "GET relative projectRoot",
		method: "GET",
		path: "/api/projects/files?projectRoot=relative/path",
	},
	{
		label: "GET projectRoot with NUL byte",
		method: "GET",
		path: `/api/projects/files?projectRoot=${encodeURIComponent(`${VALID_ROOT}\0bad`)}`,
	},
	{
		label: "GET projectRoot is a file",
		method: "GET",
		path: `/api/projects/files?projectRoot=${encodeURIComponent(FILE_ROOT)}`,
	},
	{
		label: "GET projectRoot missing .kicad_pro",
		method: "GET",
		path: `/api/projects/files?projectRoot=${encodeURIComponent(NO_PRO_ROOT)}`,
	},
	{
		label: "POST import missing projectRoot",
		method: "POST",
		path: "/api/projects/import",
		body: { name: "test.kicad_sch", contentBase64: "aGVsbG8=" },
	},
	{
		label: "POST import relative projectRoot",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: "relative/path",
			name: "test.kicad_sch",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import projectRoot missing .kicad_pro",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: NO_PRO_ROOT,
			name: "test.kicad_sch",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import name containing ../",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: "../escape.kicad_sch",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import name containing slash",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: "nested/test.kicad_sch",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import name containing backslash",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: "nested\\test.kicad_sch",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import wrong extension .kicad_pro",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: "project.kicad_pro",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import wrong extension .txt",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: "readme.txt",
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import name exceeding 128 characters",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: `${"a".repeat(125)}.kicad_sch`,
			contentBase64: "aGVsbG8=",
		},
	},
	{
		label: "POST import missing contentBase64",
		method: "POST",
		path: "/api/projects/import",
		body: { projectRoot: VALID_ROOT, name: "valid.kicad_sch" },
	},
	{
		label: "POST import contentBase64 exceeding 20 MB",
		method: "POST",
		path: "/api/projects/import",
		body: {
			projectRoot: VALID_ROOT,
			name: "huge.kicad_sch",
			contentBase64: Buffer.alloc(20 * 1024 * 1024 + 16, "x").toString(
				"base64",
			),
		},
	},
];

describe("project files routes", () => {
	test("returns 403 for GET and POST when local repos are disabled", async () => {
		const fakeFs = createFakeFs({ dirs: [VALID_ROOT] });
		const router = createProjectRouter({
			isLocalAllowed: () => false,
			fsImpl: fakeFs,
		});
		const srv = await startServer(router, false);
		try {
			const getRes = await getJson(
				srv.port,
				`/api/projects/files?projectRoot=${encodeURIComponent(VALID_ROOT)}`,
			);
			assert.equal(getRes.status, 403);
			assert.ok(!JSON.stringify(getRes.json).includes(VALID_ROOT));

			const postRes = await postJson(srv.port, "/api/projects/import", {
				projectRoot: VALID_ROOT,
				name: "test.kicad_sch",
				contentBase64: "aGVsbG8=",
			});
			assert.equal(postRes.status, 403);
			assert.ok(!JSON.stringify(postRes.json).includes(VALID_ROOT));
		} finally {
			await srv.close();
		}
	});

	test("GET /projects/files filters non-kicad, lock, backup files and classifies kinds", async () => {
		const subDir = path.join(VALID_ROOT, "subfolder");
		const fakeFs = createFakeFs({
			dirs: [VALID_ROOT, subDir],
			files: {
				[path.join(VALID_ROOT, "main.kicad_pro")]: "pro content",
				[path.join(VALID_ROOT, "sheet.kicad_sch")]: "sch content",
				[path.join(VALID_ROOT, "board.kicad_pcb")]: "pcb content",
				[path.join(VALID_ROOT, "device.kicad_sym")]: "sym content",
				[path.join(VALID_ROOT, "foot.kicad_mod")]: "mod content",
				[path.join(VALID_ROOT, "notes.txt")]: "plain notes",
				[path.join(VALID_ROOT, ".hidden.kicad_sch")]: "hidden",
				[path.join(VALID_ROOT, "sheet.kicad_sch~")]: "backup tilde",
				[path.join(VALID_ROOT, "_autosave-sheet.kicad_sch")]: "autosave",
				[path.join(VALID_ROOT, "board.kicad_pcb.lck")]: "lock file",
				[path.join(VALID_ROOT, "sheet-bak.kicad_sch")]: "backup dash",
			},
		});
		const router = createProjectRouter({ fsImpl: fakeFs });
		const srv = await startServer(router, true);
		try {
			const res = await getJson(
				srv.port,
				`/api/projects/files?projectRoot=${encodeURIComponent(VALID_ROOT)}`,
			);
			assert.equal(res.status, 200);
			assert.ok(Array.isArray(res.json?.files));
			const files = res.json.files;
			assert.equal(files.length, 6);
			const expectedKinds = {
				"board.kicad_pcb": "pcb",
				"device.kicad_sym": "symbols",
				"foot.kicad_mod": "footprint",
				"main.kicad_pro": "project",
				"notes.txt": "other",
				"sheet.kicad_sch": "schematic",
			};
			for (const file of files) {
				assert.equal(file.kind, expectedKinds[file.name]);
				assert.equal(typeof file.size, "number");
				assert.ok(file.size > 0);
				assert.equal(typeof file.modified, "string");
			}
			assert.ok(!JSON.stringify(res.json).includes(VALID_ROOT));
		} finally {
			await srv.close();
		}
	});

	test("POST /projects/import writes file with flag wx and does not commit", async () => {
		const fakeFs = createFakeFs({
			dirs: [VALID_ROOT],
			files: {
				[path.join(VALID_ROOT, "main.kicad_pro")]: "pro content",
			},
		});
		const router = createProjectRouter({ fsImpl: fakeFs });
		const srv = await startServer(router, true);
		try {
			const body = {
				projectRoot: VALID_ROOT,
				name: "extra.kicad_sch",
				contentBase64: Buffer.from("(kicad_sch content)").toString("base64"),
			};
			const res = await postJson(srv.port, "/api/projects/import", body);
			assert.equal(res.status, 201);
			assert.equal(res.json?.name, "extra.kicad_sch");
			assert.equal(fakeFs.writes.length, 1);
			const write = fakeFs.writes[0];
			assert.equal(write.path, path.join(VALID_ROOT, "extra.kicad_sch"));
			assert.equal(write.options?.flag, "wx");
			assert.ok(!JSON.stringify(res.json).includes(VALID_ROOT));
		} finally {
			await srv.close();
		}
	});

	test("POST /projects/import returns 409 when target file already exists", async () => {
		const existingPath = path.join(VALID_ROOT, "existing.kicad_sch");
		const fakeFs = createFakeFs({
			dirs: [VALID_ROOT],
			files: {
				[path.join(VALID_ROOT, "main.kicad_pro")]: "pro content",
				[existingPath]: "already here",
			},
		});
		const router = createProjectRouter({ fsImpl: fakeFs });
		const srv = await startServer(router, true);
		try {
			const body = {
				projectRoot: VALID_ROOT,
				name: "existing.kicad_sch",
				contentBase64: Buffer.from("new content").toString("base64"),
			};
			const res = await postJson(srv.port, "/api/projects/import", body);
			assert.equal(res.status, 409);
			assert.ok(!JSON.stringify(res.json).includes(VALID_ROOT));
		} finally {
			await srv.close();
		}
	});

	describe("validation 400 cases table", () => {
		let srv;
		before(async () => {
			const fakeFs = createFakeFs({
				dirs: [VALID_ROOT, NO_PRO_ROOT],
				files: {
					[path.join(VALID_ROOT, "main.kicad_pro")]: "pro",
					[FILE_ROOT]: "not a directory",
				},
			});
			const router = createProjectRouter({ fsImpl: fakeFs });
			srv = await startServer(router, true);
		});

		after(async () => {
			if (srv) await srv.close();
		});

		for (const item of TABLE_400_CASES) {
			test(`returns 400 for ${item.label}`, async () => {
				const res =
					item.method === "GET"
						? await getJson(srv.port, item.path)
						: await postJson(srv.port, item.path, item.body);
				assert.equal(res.status, 400);
				assert.ok(typeof res.json?.error === "string");
				assert.ok(!JSON.stringify(res.json).includes(VALID_ROOT));
				assert.ok(!JSON.stringify(res.json).includes(NO_PRO_ROOT));
			});
		}
	});
});
