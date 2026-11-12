import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createProjectRouter } from "../../backend/src/routes/project-routes.js";

const VALID_PARENT = path.resolve(os.tmpdir(), "banana-test-projects");
const EXISTING_TARGET = path.join(VALID_PARENT, "existing-project");
const FILE_PARENT = path.join(VALID_PARENT, "not-a-dir.txt");

function makeFsError(code, message) {
	const err = new Error(message || code);
	err.code = code;
	return err;
}

function resolvePath(dirSet, fileMap, p) {
	const res = path.resolve(p);
	if (dirSet.has(res) || fileMap.has(res)) return res;
	throw makeFsError("ENOENT", `realpath '${p}'`);
}

function statPath(dirSet, fileMap, p) {
	const res = path.resolve(p);
	if (dirSet.has(res)) return { isDirectory: () => true };
	if (fileMap.has(res)) return { isDirectory: () => false };
	throw makeFsError("ENOENT", `stat '${p}'`);
}

function createFakeFs({ dirs = [], files = {}, failWrite = false } = {}) {
	const dirSet = new Set(dirs.map((d) => path.resolve(d)));
	const fileMap = new Map(
		Object.entries(files).map(([k, v]) => [path.resolve(k), v]),
	);
	const writes = [];
	return {
		writes,
		realpath: async (p) => resolvePath(dirSet, fileMap, p),
		stat: async (p) => statPath(dirSet, fileMap, p),
		async mkdir(p) {
			const res = path.resolve(p);
			if (dirSet.has(res)) throw makeFsError("EEXIST", `mkdir '${p}'`);
			dirSet.add(res);
		},
		async writeFile(p, content, options) {
			if (failWrite) throw new Error("Disk write failed");
			const res = path.resolve(p);
			writes.push({ path: res, content, options });
			fileMap.set(res, content);
		},
	};
}

function createFakeGit({ fail = false } = {}) {
	const calls = [];
	const runGit = async (cwd, args) => {
		if (fail) throw new Error("Git failed");
		calls.push({ cwd, args });
		return { stdout: "", stderr: "" };
	};
	return { calls, runGit };
}

async function startServer(appOrRouter, allowLocal = true) {
	let app = appOrRouter;
	if (typeof appOrRouter.listen !== "function") {
		app = express();
		app.locals.allowLocalRepos = allowLocal;
		app.use(express.json());
		app.use("/api", appOrRouter);
	}
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
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
	} catch (_err) {
		json = null;
	}
	return { status: res.status, json };
}

async function createProjectServer({
	dirs = [VALID_PARENT],
	files = {},
	failWrite = false,
	failGit = false,
	isLocalAllowed,
	allowLocal = true,
} = {}) {
	const fakeFs = createFakeFs({ dirs, files, failWrite });
	const fakeGit = createFakeGit({ fail: failGit });
	const router = createProjectRouter({
		isLocalAllowed,
		fsImpl: fakeFs,
		runGit: fakeGit.runGit,
	});
	const srv = await startServer(router, allowLocal);
	return { srv, fakeFs, fakeGit };
}

async function runCreateRequest(options) {
	const { srv, fakeFs, fakeGit } = await createProjectServer(options?.setup);
	try {
		const res = await postJson(srv.port, "/api/projects/create", options.body);
		return { res, fakeFs, fakeGit };
	} finally {
		await srv.close();
	}
}

function assertErrorResponse(res, status, error) {
	assert.equal(res.status, status);
	assert.equal(res.json?.error, error);
}

function assertSuccessResponse(res, expectedTarget, expectedFiles) {
	assert.equal(res.status, 201);
	assert.equal(res.json?.projectRoot, expectedTarget);
	if (expectedFiles) {
		assert.deepEqual(res.json?.files, expectedFiles);
	}
}

function verifyWrites(writes, target, base) {
	assert.equal(writes.length, 3);
	for (const w of writes) {
		assert.equal(w.options?.flag, "wx");
	}
	const writtenPaths = writes.map((w) => w.path);
	assert.deepEqual(writtenPaths, [
		path.join(target, `${base}.kicad_pro`),
		path.join(target, `${base}.kicad_sch`),
		path.join(target, `${base}.kicad_pcb`),
	]);
}

function verifyGitCalls(calls, target, base) {
	assert.equal(calls.length, 3);
	assert.deepEqual(calls[0], { cwd: target, args: ["init"] });
	assert.deepEqual(calls[1], { cwd: target, args: ["add", "."] });
	assert.deepEqual(calls[2], {
		cwd: target,
		args: [
			"-c",
			"user.name=Banana",
			"-c",
			"user.email=banana@localhost",
			"commit",
			"-m",
			`Create project ${base}`,
		],
	});
}

const INVALID_CASES = [
	{
		label: "relative parentDir",
		body: { parentDir: "relative/path", name: "test-proj" },
		expectedError: "Parent folder not found",
	},
	{
		label: "missing parent directory",
		body: {
			parentDir: path.resolve(VALID_PARENT, "missing"),
			name: "test-proj",
		},
		expectedError: "Parent folder not found",
	},
	{
		label: "parentDir is a file instead of directory",
		body: { parentDir: FILE_PARENT, name: "test-proj" },
		expectedError: "Parent folder not found",
	},
	{
		label: "parentDir contains NUL byte",
		body: { parentDir: `${VALID_PARENT}\0sub`, name: "test-proj" },
		expectedError: "Parent folder not found",
	},
	{
		label: "bad name (reserved word CON)",
		body: { parentDir: VALID_PARENT, name: "CON" },
		expectedError: "Invalid project name",
	},
	{
		label: "bad name (empty string)",
		body: { parentDir: VALID_PARENT, name: "" },
		expectedError: "Invalid project name",
	},
	{
		label: "boardW is malicious string '100) (evil'",
		body: {
			parentDir: VALID_PARENT,
			name: "test-proj",
			boardW: "100) (evil",
		},
		expectedError: "Board size must be a number between 10 and 1000 mm",
	},
	{
		label: "boardH is too small (5)",
		body: { parentDir: VALID_PARENT, name: "test-proj", boardH: 5 },
		expectedError: "Board size must be a number between 10 and 1000 mm",
	},
	{
		label: "boardW is too large (2000)",
		body: { parentDir: VALID_PARENT, name: "test-proj", boardW: 2000 },
		expectedError: "Board size must be a number between 10 and 1000 mm",
	},
];

const ROUTE_ERROR_CASES = [
	{
		title: "returns 403 when local repos are not allowed",
		setup: {
			dirs: [VALID_PARENT],
			isLocalAllowed: () => false,
			allowLocal: false,
		},
		body: { parentDir: VALID_PARENT, name: "demo-proj" },
		status: 403,
		error: "Creating projects is only available in the desktop app",
		checkZeroWrites: true,
		checkZeroGit: true,
	},
	{
		title: "returns 409 when target project directory already exists",
		setup: { dirs: [VALID_PARENT, EXISTING_TARGET] },
		body: { parentDir: VALID_PARENT, name: "existing-project" },
		status: 409,
		error: "A folder with that name already exists",
	},
	{
		title: "returns 500 when writeFile fails after mkdir",
		setup: { dirs: [VALID_PARENT], failWrite: true },
		body: { parentDir: VALID_PARENT, name: "fail_write_proj" },
		status: 500,
		error: "Could not create project",
		checkZeroGit: true,
	},
];

const HAPPY_PATH_CASES = [
	{
		title: "writes 3 files with flag wx and runs 3 git commands",
		name: "my_board",
		body: { parentDir: VALID_PARENT, name: "my_board" },
		expectedFiles: [
			"my_board.kicad_pro",
			"my_board.kicad_sch",
			"my_board.kicad_pcb",
		],
	},
	{
		title: "with boardW 120 and boardH 80",
		name: "custom_board",
		body: {
			parentDir: VALID_PARENT,
			name: "custom_board",
			boardW: 120,
			boardH: 80,
		},
	},
];

describe("project routes", () => {
	for (const tc of ROUTE_ERROR_CASES) {
		test(tc.title, async () => {
			const { res, fakeFs, fakeGit } = await runCreateRequest(tc);
			assertErrorResponse(res, tc.status, tc.error);
			if (tc.checkZeroWrites) {
				assert.equal(fakeFs.writes.length, 0);
			}
			if (tc.checkZeroGit) {
				assert.equal(fakeGit.calls.length, 0);
			}
		});
	}

	describe("validation 400 cases", () => {
		let srv;
		before(async () => {
			const started = await createProjectServer({
				dirs: [VALID_PARENT],
				files: { [FILE_PARENT]: "content" },
			});
			srv = started.srv;
		});

		after(async () => {
			if (srv) await srv.close();
		});

		for (const { label, body, expectedError } of INVALID_CASES) {
			test(`returns 400 when ${label}`, async () => {
				const res = await postJson(srv.port, "/api/projects/create", body);
				assertErrorResponse(res, 400, expectedError);
			});
		}
	});

	for (const tc of HAPPY_PATH_CASES) {
		test(`happy path 201 ${tc.title}`, async () => {
			const { res, fakeFs, fakeGit } = await runCreateRequest({
				setup: { dirs: [VALID_PARENT] },
				body: tc.body,
			});
			const expectedTarget = path.join(VALID_PARENT, tc.name);
			assertSuccessResponse(res, expectedTarget, tc.expectedFiles);
			verifyWrites(fakeFs.writes, expectedTarget, tc.name);
			verifyGitCalls(fakeGit.calls, expectedTarget, tc.name);
		});
	}

	test("app integrates projectRouter under /api/projects/create", async () => {
		const app = createApp();
		app.locals.allowLocalRepos = false;
		const srv = await startServer(app);
		try {
			const res = await postJson(srv.port, "/api/projects/create", {
				parentDir: VALID_PARENT,
				name: "test",
			});
			assert.equal(res.status, 403);
		} finally {
			await srv.close();
		}
	});
});
