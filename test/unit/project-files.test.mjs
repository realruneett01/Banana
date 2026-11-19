import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createProjectRouter } from "../../backend/src/routes/project-routes.js";
import { listenOnLoopback, requestJson } from "../helpers/tests_3-http.mjs";

const VALID_ROOT = path.resolve(tmpdir(), "banana-test-project-files");
const NO_PRO_ROOT = path.resolve(tmpdir(), "banana-test-no-pro");
const FILE_ROOT = path.join(VALID_ROOT, "some-file.txt");
const PRO_FILE = path.join(VALID_ROOT, "main.kicad_pro");
const IMPORT_PATH = "/api/projects/import";

function makeFsError(code, message) {
	const err = new Error(message || code);
	err.code = code;
	return err;
}

// One fake file record; every fake file has the same fixed mtime.
const fileRecord = (content, buf) => ({
	content,
	size: buf.length,
	mtime: new Date("2026-01-01T00:00:00.000Z"),
});

function normalizeFileMap(files) {
	const fileMap = new Map();
	for (const [k, v] of Object.entries(files)) {
		const res = path.resolve(k);
		if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
			const content = v.content ?? "";
			const record = fileRecord(content, Buffer.from(content));
			fileMap.set(res, {
				...record,
				size: v.size ?? record.size,
				mtime: v.mtime ?? record.mtime,
			});
		} else {
			fileMap.set(
				res,
				fileRecord(v, Buffer.isBuffer(v) ? v : Buffer.from(String(v ?? ""))),
			);
		}
	}
	return fileMap;
}

function listChildren(res, dirSet, fileMap) {
	const entries = new Set();
	for (const d of dirSet) {
		if (path.dirname(d) === res && d !== res) entries.add(path.basename(d));
	}
	for (const f of fileMap.keys()) {
		if (path.dirname(f) === res) entries.add(path.basename(f));
	}
	return Array.from(entries);
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
			const meta = fileMap.get(res);
			if (!meta) throw makeFsError("ENOENT", `stat '${p}'`);
			const { size, mtime } = meta;
			return { isDirectory: () => false, isFile: () => true, size, mtime };
		},
		async readdir(p) {
			const res = path.resolve(p);
			if (!dirSet.has(res)) throw makeFsError("ENOENT", `readdir '${p}'`);
			return listChildren(res, dirSet, fileMap);
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
			fileMap.set(res, fileRecord(content, buf));
		},
	};
}

function startServer(router, allowLocal = true) {
	const app = express();
	app.locals.allowLocalRepos = allowLocal;
	app.use("/api", router);
	return listenOnLoopback(app);
}

const getJson = (port, routePath) => requestJson(port, routePath);
const postJson = (port, routePath, body) => requestJson(port, routePath, body);

/** Runs `fn(srv, fakeFs)` against a project router backed by a fake fs. */
async function withProjectServer(
	{ fsSpec, allowLocal = true, isLocalAllowed },
	fn,
) {
	const fakeFs = createFakeFs(fsSpec);
	const options = isLocalAllowed
		? { isLocalAllowed, fsImpl: fakeFs }
		: { fsImpl: fakeFs };
	const srv = await startServer(createProjectRouter(options), allowLocal);
	try {
		return await fn(srv, fakeFs);
	} finally {
		await srv.close();
	}
}

/** Asserts the status and that no absolute project path leaks into the reply. */
function assertStatusNoLeak(res, status, roots = [VALID_ROOT]) {
	assert.equal(res.status, status);
	for (const root of roots) {
		assert.ok(!JSON.stringify(res.json).includes(root));
	}
}

const filesUrl = (root) =>
	`/api/projects/files?projectRoot=${encodeURIComponent(root)}`;

// A well-formed import body for `name` (base64 of "hello").
const importBody = (name, projectRoot = VALID_ROOT) => ({
	projectRoot,
	name,
	contentBase64: "aGVsbG8=",
});

// [label, GET path]
const GET_400 = [
	["GET missing projectRoot query param", "/api/projects/files"],
	["GET relative projectRoot", "/api/projects/files?projectRoot=relative/path"],
	["GET projectRoot with NUL byte", filesUrl(`${VALID_ROOT}\0bad`)],
	["GET projectRoot is a file", filesUrl(FILE_ROOT)],
	["GET projectRoot missing .kicad_pro", filesUrl(NO_PRO_ROOT)],
];

const HUGE_BASE64 = Buffer.alloc(20 * 1024 * 1024 + 16, "x").toString("base64");

// [label, POST import body]
const POST_400 = [
	[
		"POST import missing projectRoot",
		{ name: "test.kicad_sch", contentBase64: "aGVsbG8=" },
	],
	[
		"POST import relative projectRoot",
		importBody("test.kicad_sch", "relative/path"),
	],
	[
		"POST import projectRoot missing .kicad_pro",
		importBody("test.kicad_sch", NO_PRO_ROOT),
	],
	["POST import name containing ../", importBody("../escape.kicad_sch")],
	["POST import name containing slash", importBody("nested/test.kicad_sch")],
	[
		"POST import name containing backslash",
		importBody("nested\\test.kicad_sch"),
	],
	["POST import wrong extension .kicad_pro", importBody("project.kicad_pro")],
	["POST import wrong extension .txt", importBody("readme.txt")],
	[
		"POST import name exceeding 128 characters",
		importBody(`${"a".repeat(125)}.kicad_sch`),
	],
	[
		"POST import missing contentBase64",
		{ projectRoot: VALID_ROOT, name: "valid.kicad_sch" },
	],
	[
		"POST import contentBase64 exceeding 20 MB",
		{ ...importBody("huge.kicad_sch"), contentBase64: HUGE_BASE64 },
	],
];

const TABLE_400_CASES = [
	...GET_400.map(([label, path]) => ({ label, method: "GET", path })),
	...POST_400.map(([label, body]) => ({
		label,
		method: "POST",
		path: IMPORT_PATH,
		body,
	})),
];

// file name -> content
const LISTED_FILES = {
	"main.kicad_pro": "pro content",
	"sheet.kicad_sch": "sch content",
	"board.kicad_pcb": "pcb content",
	"device.kicad_sym": "sym content",
	"foot.kicad_mod": "mod content",
	"notes.txt": "plain notes",
	".hidden.kicad_sch": "hidden",
	"sheet.kicad_sch~": "backup tilde",
	"_autosave-sheet.kicad_sch": "autosave",
	"board.kicad_pcb.lck": "lock file",
	"sheet-bak.kicad_sch": "backup dash",
};

// listed file name -> expected kind
const EXPECTED_KINDS = {
	"board.kicad_pcb": "pcb",
	"device.kicad_sym": "symbols",
	"foot.kicad_mod": "footprint",
	"main.kicad_pro": "project",
	"notes.txt": "other",
	"sheet.kicad_sch": "schematic",
};

function assertListedFile(file) {
	assert.equal(file.kind, EXPECTED_KINDS[file.name]);
	assert.equal(typeof file.size, "number");
	assert.ok(file.size > 0);
	assert.equal(typeof file.modified, "string");
}

const base64 = (text) => Buffer.from(text).toString("base64");

describe("project files routes", () => {
	test("returns 403 for GET and POST when local repos are disabled", () =>
		withProjectServer(
			{
				fsSpec: { dirs: [VALID_ROOT] },
				allowLocal: false,
				isLocalAllowed: () => false,
			},
			async (srv) => {
				assertStatusNoLeak(await getJson(srv.port, filesUrl(VALID_ROOT)), 403);
				const body = importBody("test.kicad_sch");
				assertStatusNoLeak(await postJson(srv.port, IMPORT_PATH, body), 403);
			},
		));

	test("GET /projects/files filters non-kicad, lock, backup files and classifies kinds", () => {
		const subDir = path.join(VALID_ROOT, "subfolder");
		const files = Object.fromEntries(
			Object.entries(LISTED_FILES).map(([name, text]) => [
				path.join(VALID_ROOT, name),
				text,
			]),
		);
		const fsSpec = { dirs: [VALID_ROOT, subDir], files };
		return withProjectServer({ fsSpec }, async (srv) => {
			const res = await getJson(srv.port, filesUrl(VALID_ROOT));
			assertStatusNoLeak(res, 200);
			assert.ok(Array.isArray(res.json?.files));
			assert.equal(res.json.files.length, 6);
			res.json.files.forEach(assertListedFile);
		});
	});

	test("POST /projects/import writes file with flag wx and does not commit", () => {
		const fsSpec = { dirs: [VALID_ROOT], files: { [PRO_FILE]: "pro content" } };
		return withProjectServer({ fsSpec }, async (srv, fakeFs) => {
			const body = {
				...importBody("extra.kicad_sch"),
				contentBase64: base64("(kicad_sch content)"),
			};
			const res = await postJson(srv.port, IMPORT_PATH, body);
			assertStatusNoLeak(res, 201);
			assert.equal(res.json?.name, "extra.kicad_sch");
			assert.equal(fakeFs.writes.length, 1);
			const [write] = fakeFs.writes;
			assert.equal(write.path, path.join(VALID_ROOT, "extra.kicad_sch"));
			assert.equal(write.options?.flag, "wx");
		});
	});

	test("POST /projects/import returns 409 when target file already exists", () => {
		const existingPath = path.join(VALID_ROOT, "existing.kicad_sch");
		const files = { [PRO_FILE]: "pro content", [existingPath]: "already here" };
		return withProjectServer(
			{ fsSpec: { dirs: [VALID_ROOT], files } },
			async (srv) => {
				const body = {
					...importBody("existing.kicad_sch"),
					contentBase64: base64("new content"),
				};
				assertStatusNoLeak(await postJson(srv.port, IMPORT_PATH, body), 409);
			},
		);
	});

	describe("validation 400 cases table", () => {
		let srv;
		before(async () => {
			const fakeFs = createFakeFs({
				dirs: [VALID_ROOT, NO_PRO_ROOT],
				files: { [PRO_FILE]: "pro", [FILE_ROOT]: "not a directory" },
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
				assert.ok(typeof res.json?.error === "string");
				assertStatusNoLeak(res, 400, [VALID_ROOT, NO_PRO_ROOT]);
			});
		}
	});
});
