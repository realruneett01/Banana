import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import boardRouter from "../../backend/src/routes/board-routes.js";
import diffRouter from "../../backend/src/routes/diff-routes.js";

const BOARD_ROUTES = ["/board/pads", "/board/glb"];

function createServer(allowLocalRepos) {
	const app = express();
	app.locals.allowLocalRepos = allowLocalRepos;
	app.use(express.json());
	app.use(diffRouter);
	app.use("/board", boardRouter);
	return http.createServer(app);
}

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve(port);
		});
	});
}

function closeServer(server) {
	return new Promise((resolve) => server.close(resolve));
}

async function postJson(port, routePath, body) {
	const response = await fetch(`http://127.0.0.1:${port}${routePath}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

function makeDiffBody(baseCommit, targetCommit, relativeFilePath) {
	return {
		repoPath: "/path/to/repo",
		baseCommit,
		targetCommit,
		relativeFilePath,
	};
}

function makeBoardBody(commit, relativeFilePath) {
	return {
		repoPath: "/path/to/repo",
		commit,
		relativeFilePath,
	};
}

function diffTarget(nameBuilder, bodyBuilder) {
	return {
		name: nameBuilder,
		route: "/diff/process",
		body: bodyBuilder,
	};
}

function boardTargets(nameBuilder, bodyBuilder) {
	return BOARD_ROUTES.map((route) => ({
		name: (val) => nameBuilder(route, val),
		route,
		body: (val) => bodyBuilder(route, val),
	}));
}

function testMatrix(getPort, values, targets, expectedStatus) {
	for (const value of values) {
		for (const { name, route, body } of targets) {
			test(name(value), async () => {
				const { status } = await postJson(getPort(), route, body(value));
				assert.equal(status, expectedStatus);
			});
		}
	}
}

describe("local repository guards and input validation", () => {
	let disabledServer;
	let disabledPort;
	let enabledServer;
	let enabledPort;

	before(async () => {
		disabledServer = createServer(false);
		disabledPort = await listen(disabledServer);
		enabledServer = createServer(true);
		enabledPort = await listen(enabledServer);
	});

	after(async () => {
		await closeServer(disabledServer);
		await closeServer(enabledServer);
	});

	describe("disabled server returns 403 for local repository routes", () => {
		const cases = [
			{
				name: "POST /diff/process returns 403 when local repos disabled",
				route: "/diff/process",
				body: makeDiffBody("a1b2c3d4", "e5f6a7b8", "board.kicad_pcb"),
			},
			...BOARD_ROUTES.map((route) => ({
				name: `POST ${route} returns 403 when local repos disabled`,
				route,
				body: makeBoardBody("a1b2c3d4", "board.kicad_pcb"),
			})),
		];

		for (const { name, route, body } of cases) {
			test(name, async () => {
				const { status, json } = await postJson(disabledPort, route, body);
				assert.equal(status, 403);
				assert.equal(
					json.error,
					"Local repositories are disabled on this server",
				);
			});
		}
	});

	const badInputSuites = [
		{
			description: "bad commit refs return 400",
			values: [
				"-main",
				"--upload-pack=exploit",
				"main..HEAD",
				"feature/test..dev",
				"main;rm -rf /",
				"ref with spaces",
				`ref_${"x".repeat(200)}`,
			],
			targets: [
				diffTarget(
					(ref) => `rejects invalid ref "${ref}" on /diff/process baseCommit`,
					(ref) => makeDiffBody(ref, "a1b2c3d4", "board.kicad_pcb"),
				),
				diffTarget(
					(ref) => `rejects invalid ref "${ref}" on /diff/process targetCommit`,
					(ref) => makeDiffBody("a1b2c3d4", ref, "board.kicad_pcb"),
				),
				...boardTargets(
					(route, ref) => `rejects invalid ref "${ref}" on ${route} commit`,
					(_route, ref) => makeBoardBody(ref, "board.kicad_pcb"),
				),
			],
		},
		{
			description: "bad targetFile and relativeFilePath return 400",
			values: [
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
			],
			targets: [
				diffTarget(
					(badPath) => `rejects invalid path "${badPath}" on /diff/process`,
					(badPath) => makeDiffBody("a1b2c3d4", "e5f6a7b8", badPath),
				),
				...boardTargets(
					(route, badPath) => `rejects invalid path "${badPath}" on ${route}`,
					(_route, badPath) => makeBoardBody("a1b2c3d4", badPath),
				),
			],
		},
	];

	for (const { description, values, targets } of badInputSuites) {
		describe(description, () => {
			testMatrix(() => enabledPort, values, targets, 400);
		});
	}

	describe("valid input passes guards (not 400/403)", () => {
		const validCases = [
			{
				name: "/diff/process with 4-40 hex shas and .kicad_pcb",
				route: "/diff/process",
				body: {
					repoPath: "/nonexistent/test/repo",
					baseCommit: "a1b2c3d4",
					targetCommit: "0123456789abcdef0123456789abcdef01234567",
					relativeFilePath: "hardware/board.kicad_pcb",
				},
			},
			{
				name: "/diff/process with branch names and .kicad_sch",
				route: "/diff/process",
				body: {
					repoPath: "/nonexistent/test/repo",
					baseCommit: "main",
					targetCommit: "feature/circuit_v2-revA",
					relativeFilePath: "schematics/main.kicad_sch",
				},
			},
			{
				name: "/board/pads with valid local repo and .kicad_pcb",
				route: "/board/pads",
				body: {
					repoPath: "/nonexistent/test/repo",
					commit: "a1b2c3d4",
					relativeFilePath: "board.kicad_pcb",
				},
			},
			{
				name: "/board/glb with branch name and .kicad_pcb via filePath",
				route: "/board/glb",
				body: {
					repoPath: "/nonexistent/test/repo",
					commit: "release_1.0",
					filePath: "sub/dir/board.kicad_pcb",
				},
			},
		];

		for (const { name, route, body } of validCases) {
			test(name, async () => {
				const { status } = await postJson(enabledPort, route, body);
				assert.notEqual(
					status,
					400,
					`Expected not 400 for ${name}, got ${status}`,
				);
				assert.notEqual(
					status,
					403,
					`Expected not 403 for ${name}, got ${status}`,
				);
			});
		}
	});
});
