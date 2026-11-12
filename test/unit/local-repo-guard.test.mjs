import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import boardRouter from "../../backend/src/routes/board-routes.js";
import diffRouter from "../../backend/src/routes/diff-routes.js";

const BOARD_ROUTES = ["/board/pads", "/board/glb"];
const REPO = "/path/to/repo";
const NONEXISTENT_REPO = "/nonexistent/test/repo";
const SHA_A = "a1b2c3d4";
const SHA_B = "e5f6a7b8";
const PCB_FILE = "board.kicad_pcb";

// Proves server rejects hostile paths quickly without waiting on network or filesystem timeouts (8s+).
const HOSTILE_PATH_TIMEOUT_MS = 5000;

const diffBody = (baseCommit, targetCommit, relativeFilePath) => ({
	repoPath: REPO,
	baseCommit,
	targetCommit,
	relativeFilePath,
});

const boardBody = (commit, relativeFilePath) => ({
	repoPath: REPO,
	commit,
	relativeFilePath,
});

async function createTestServer(allowLocalRepos) {
	const app = express();
	app.locals.allowLocalRepos = allowLocalRepos;
	app.use(express.json());
	app.use(diffRouter);
	app.use("/board", boardRouter);
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		port: server.address().port,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

async function postJson(port, routePath, body) {
	const response = await fetch(`http://127.0.0.1:${port}${routePath}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return {
		status: response.status,
		json: await response.json().catch(() => ({})),
	};
}

function rejectTarget(route, location, bodyFn, kind = "ref") {
	return {
		route,
		name: (val) => `rejects invalid ${kind} "${val}" on ${location}`,
		body: bodyFn,
	};
}

function expandMatrix(values, targets) {
	return values.flatMap((val) =>
		targets.map((t) => ({
			name: t.name(val),
			route: t.route,
			body: t.body(val),
		})),
	);
}

function runStatusTests(cases, getPort, expectedStatus) {
	for (const c of cases) {
		test(c.name, async () => {
			const { status } = await postJson(getPort(), c.route, c.body);
			assert.equal(status, expectedStatus);
		});
	}
}

function assertDisabledGuard(status, json) {
	assert.equal(status, 403);
	assert.equal(json.error, "Local repositories are disabled on this server");
}

function assertNotGuarded(status, name) {
	assert.notEqual(status, 400, `Expected not 400 for ${name}, got ${status}`);
	assert.notEqual(status, 403, `Expected not 403 for ${name}, got ${status}`);
}

const DISABLED_CASES = [
	{
		name: "POST /diff/process returns 403 when local repos disabled",
		route: "/diff/process",
		body: diffBody(SHA_A, SHA_B, PCB_FILE),
	},
	...BOARD_ROUTES.map((route) => ({
		name: `POST ${route} returns 403 when local repos disabled`,
		route,
		body: boardBody(SHA_A, PCB_FILE),
	})),
];

const BAD_REFS = [
	"-main",
	"--upload-pack=exploit",
	"main..HEAD",
	"feature/test..dev",
	"main;rm -rf /",
	"ref with spaces",
	`ref_${"x".repeat(200)}`,
];

const REF_TARGETS = [
	rejectTarget("/diff/process", "/diff/process baseCommit", (ref) =>
		diffBody(ref, SHA_A, PCB_FILE),
	),
	rejectTarget("/diff/process", "/diff/process targetCommit", (ref) =>
		diffBody(SHA_A, ref, PCB_FILE),
	),
	...BOARD_ROUTES.map((r) =>
		rejectTarget(r, `${r} commit`, (ref) => boardBody(ref, PCB_FILE)),
	),
];

const BAD_PATHS = [
	"/etc/passwd.kicad_pcb",
	"C:/board.kicad_pcb",
	"C:\\board.kicad_pcb",
	"\\server\\share\\board.kicad_pcb",
	"../board.kicad_pcb",
	"hardware/../../board.kicad_pcb",
	"hardware\\..\\board.kicad_pcb",
	"board.txt",
	"board.kicad_pcb.exe",
	"board.json",
];

const PATH_TARGETS = [
	rejectTarget(
		"/diff/process",
		"/diff/process",
		(p) => diffBody(SHA_A, SHA_B, p),
		"path",
	),
	...BOARD_ROUTES.map((r) =>
		rejectTarget(r, r, (p) => boardBody(SHA_A, p), "path"),
	),
];

const VALID_CASES = [
	{
		name: "/diff/process with 4-40 hex shas and .kicad_pcb",
		route: "/diff/process",
		body: {
			repoPath: NONEXISTENT_REPO,
			baseCommit: "a1b2c3d4",
			targetCommit: "0123456789abcdef0123456789abcdef01234567",
			relativeFilePath: "hardware/board.kicad_pcb",
		},
	},
	{
		name: "/diff/process with branch names and .kicad_sch",
		route: "/diff/process",
		body: {
			repoPath: NONEXISTENT_REPO,
			baseCommit: "main",
			targetCommit: "feature/circuit_v2-revA",
			relativeFilePath: "schematics/main.kicad_sch",
		},
	},
	{
		name: "/board/pads with valid local repo and .kicad_pcb",
		route: "/board/pads",
		body: {
			repoPath: NONEXISTENT_REPO,
			commit: "a1b2c3d4",
			relativeFilePath: "board.kicad_pcb",
		},
	},
	{
		name: "/board/glb with branch name and .kicad_pcb via filePath",
		route: "/board/glb",
		body: {
			repoPath: NONEXISTENT_REPO,
			commit: "release_1.0",
			filePath: "sub/dir/board.kicad_pcb",
		},
	},
];

const HOSTILE_PATHS = [
	{ label: "UNC with backslashes", val: "\\\\server\\share\\board.kicad_pcb" },
	{ label: "UNC with forward slashes", val: "//server/share/board.kicad_pcb" },
	{ label: "\\\\?\\C:\\x", val: "\\\\?\\C:\\x" },
	{ label: "\\\\.\\pipe\\x", val: "\\\\.\\pipe\\x" },
	{ label: "a path with a NUL character", val: "board\0.kicad_pcb" },
	{
		label: "C:\\Windows\\system.ini",
		val: "C:\\Windows\\system.ini",
		fileOnly: true,
	},
	{ label: "/etc/passwd", val: "/etc/passwd", fileOnly: true },
	{ label: "../../x", val: "../../x" },
];

const BOARD_FIELD_TARGETS = [
	{
		field: "repoPath",
		buildBody: (val) => ({
			repoPath: val,
			commit: SHA_A,
			relativeFilePath: PCB_FILE,
		}),
	},
	{
		field: "relativeFilePath",
		buildBody: (val) => ({
			repoPath: REPO,
			commit: SHA_A,
			relativeFilePath: val,
		}),
	},
	{
		field: "filePath",
		buildBody: (val) => ({
			repoPath: REPO,
			commit: SHA_A,
			filePath: val,
		}),
	},
];

function isApplicableHostile(targetField, hostile) {
	return !hostile.fileOnly || targetField !== "repoPath";
}

function buildHostileCases(routes, fieldTargets, hostilePaths) {
	return routes.flatMap((route) =>
		fieldTargets.flatMap((target) =>
			hostilePaths
				.filter((hostile) => isApplicableHostile(target.field, hostile))
				.map((hostile) => ({
					name: `${route} ${target.field} rejects "${hostile.label}" in <${HOSTILE_PATH_TIMEOUT_MS}ms`,
					route,
					body: target.buildBody(hostile.val),
				})),
		),
	);
}

function runHostileTests(cases, getPort) {
	for (const c of cases) {
		test(c.name, async () => {
			const start = performance.now();
			const { status } = await postJson(getPort(), c.route, c.body);
			const durationMs = performance.now() - start;
			assert.equal(status, 400);
			assert.ok(
				durationMs < HOSTILE_PATH_TIMEOUT_MS,
				`Expected response under ${HOSTILE_PATH_TIMEOUT_MS}ms for ${c.name}, took ${durationMs}ms`,
			);
		});
	}
}

const LEGITIMATE_REPO_PATHS = [
	"C:\\dev\\my-board",
	"/home/me/dev/board",
	"D:\\sys\\pcb",
	"C:\\work\\notes.conf",
];

const LEGITIMATE_REPO_CASES = BOARD_ROUTES.flatMap((route) =>
	LEGITIMATE_REPO_PATHS.map((repoPath) => ({
		name: `${route} does not reject repoPath "${repoPath}" with invalid path error`,
		route,
		body: {
			repoPath,
			commit: SHA_A,
			relativeFilePath: PCB_FILE,
		},
	})),
);

describe("local repository guards and input validation", () => {
	let disabled;
	let enabled;

	before(async () => {
		disabled = await createTestServer(false);
		enabled = await createTestServer(true);
	});

	after(async () => {
		await disabled?.close();
		await enabled?.close();
	});

	describe("disabled server returns 403 for local repository routes", () => {
		for (const c of DISABLED_CASES) {
			test(c.name, async () => {
				const { status, json } = await postJson(disabled.port, c.route, c.body);
				assertDisabledGuard(status, json);
			});
		}
	});

	describe("bad commit refs return 400", () => {
		runStatusTests(
			expandMatrix(BAD_REFS, REF_TARGETS),
			() => enabled.port,
			400,
		);
	});

	describe("bad targetFile and relativeFilePath return 400", () => {
		runStatusTests(
			expandMatrix(BAD_PATHS, PATH_TARGETS),
			() => enabled.port,
			400,
		);
	});

	describe(`hostile path inputs to board routes return 400 under ${HOSTILE_PATH_TIMEOUT_MS}ms`, () => {
		runHostileTests(
			buildHostileCases(BOARD_ROUTES, BOARD_FIELD_TARGETS, HOSTILE_PATHS),
			() => enabled.port,
		);
	});

	describe("valid input passes guards (not 400/403)", () => {
		for (const c of VALID_CASES) {
			test(c.name, async () => {
				const { status } = await postJson(enabled.port, c.route, c.body);
				assertNotGuarded(status, c.name);
			});
		}
	});

	describe("legitimate repo paths are not rejected by path validation", () => {
		for (const c of LEGITIMATE_REPO_CASES) {
			test(c.name, async () => {
				const { json } = await postJson(enabled.port, c.route, c.body);
				assert.notEqual(json.error, "Invalid repository path");
			});
		}
	});
});
