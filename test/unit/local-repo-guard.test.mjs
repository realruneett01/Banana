import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import boardRouter from "../../backend/src/routes/board-routes.js";
import diffRouter from "../../backend/src/routes/diff-routes.js";
import { listenOnLoopback, requestJson } from "../helpers/tests_3-http.mjs";

const recordedErrors = [];
const onUncaughtException = (err) => {
	recordedErrors.push({
		type: "uncaughtException",
		message: err?.message,
		err,
	});
};
const onUnhandledRejection = (reason) => {
	recordedErrors.push({
		type: "unhandledRejection",
		message: reason?.message || String(reason),
		reason,
	});
};

process.on("uncaughtException", onUncaughtException);
process.on("unhandledRejection", onUnhandledRejection);

const BOARD_ROUTES = ["/board/pads", "/board/glb"];
const REPO = "/path/to/repo";
const NONEXISTENT_REPO = "/nonexistent/test/repo";
const NON_GIT_DIR = path.join(tmpdir(), "banana_non_git_test_repo");
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

function createTestServer(allowLocalRepos) {
	const app = express();
	app.locals.allowLocalRepos = allowLocalRepos;
	app.use(express.json());
	app.use(diffRouter);
	app.use("/board", boardRouter);
	return listenOnLoopback(app);
}

// POSTs JSON; a non-JSON reply body becomes {}.
const postJson = (port, routePath, body) =>
	requestJson(port, routePath, body, {});

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

function assertErrorResponse(result) {
	const { status, json } = result;
	assert.ok(
		status >= 400 && status < 600,
		`Expected 4xx or 5xx status, got ${status}`,
	);
	assert.ok(json && typeof json === "object", "Expected JSON object");
	assert.ok(
		Boolean(json.error || json.details),
		"Expected error property in JSON",
	);
}

async function sendParallelRequests(port, route, body, count = 20) {
	const requests = Array.from({ length: count }, () =>
		postJson(port, route, body),
	);
	return Promise.all(requests);
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

// Valid /diff/process input aimed at a repo that does not exist.
const validDiff = (name, ...diffArgs) => ({
	name,
	route: "/diff/process",
	body: { ...diffBody(...diffArgs), repoPath: NONEXISTENT_REPO },
});

// Valid board-route input aimed at a repo that does not exist.
const validBoard = (name, route, fields) => ({
	name,
	route,
	body: { repoPath: NONEXISTENT_REPO, ...fields },
});

const VALID_CASES = [
	validDiff(
		"/diff/process with 4-40 hex shas and .kicad_pcb",
		"a1b2c3d4",
		"0123456789abcdef0123456789abcdef01234567",
		"hardware/board.kicad_pcb",
	),
	validDiff(
		"/diff/process with branch names and .kicad_sch",
		"main",
		"feature/circuit_v2-revA",
		"schematics/main.kicad_sch",
	),
	validBoard(
		"/board/pads with valid local repo and .kicad_pcb",
		"/board/pads",
		{
			commit: "a1b2c3d4",
			relativeFilePath: "board.kicad_pcb",
		},
	),
	validBoard(
		"/board/glb with branch name and .kicad_pcb via filePath",
		"/board/glb",
		{ commit: "release_1.0", filePath: "sub/dir/board.kicad_pcb" },
	),
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

// Each target puts the hostile value into one field of an otherwise valid board body.
const BOARD_FIELD_TARGETS = [
	{
		field: "repoPath",
		buildBody: (val) => ({ ...boardBody(SHA_A, PCB_FILE), repoPath: val }),
	},
	{ field: "relativeFilePath", buildBody: (val) => boardBody(SHA_A, val) },
	{
		field: "filePath",
		buildBody: (val) => ({ repoPath: REPO, commit: SHA_A, filePath: val }),
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
		body: { ...boardBody(SHA_A, PCB_FILE), repoPath },
	})),
);

const PARALLEL_REPOS = [
	["nonexistent repo", NONEXISTENT_REPO],
	["non-git folder", NON_GIT_DIR],
];

describe("local repository guards and input validation", () => {
	let disabled;
	let enabled;

	before(async () => {
		if (!existsSync(NON_GIT_DIR)) {
			mkdirSync(NON_GIT_DIR, { recursive: true });
		}
		disabled = await createTestServer(false);
		enabled = await createTestServer(true);
	});

	after(async () => {
		process.off("uncaughtException", onUncaughtException);
		process.off("unhandledRejection", onUnhandledRejection);
		await disabled?.close();
		await enabled?.close();
		try {
			if (existsSync(NON_GIT_DIR)) {
				rmSync(NON_GIT_DIR, { recursive: true, force: true });
			}
		} catch (err) {
			// Best-effort cleanup of the non-git temp directory: report, do not fail.
			console.warn(`Could not remove ${NON_GIT_DIR}: ${err.message}`);
		}
		assert.equal(
			recordedErrors.length,
			0,
			`Expected 0 unhandled errors, got: ${JSON.stringify(recordedErrors)}`,
		);
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

	describe("parallel requests with nonexistent and non-git repo paths", () => {
		for (const route of BOARD_ROUTES) {
			for (const [label, repoPath] of PARALLEL_REPOS) {
				test(`${route} handles 20 parallel requests with ${label}`, async () => {
					const body = { ...boardBody(SHA_A, PCB_FILE), repoPath };
					const results = await sendParallelRequests(enabled.port, route, body);
					for (const res of results) {
						assertErrorResponse(res);
					}
				});
			}
		}
	});
});
