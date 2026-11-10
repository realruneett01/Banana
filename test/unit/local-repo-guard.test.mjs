import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import express from "express";
import boardRouter from "../../backend/src/routes/board-routes.js";
import diffRouter from "../../backend/src/routes/diff-routes.js";

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
				body: {
					repoPath: "/path/to/repo",
					baseCommit: "a1b2c3d4",
					targetCommit: "e5f6a7b8",
					relativeFilePath: "board.kicad_pcb",
				},
			},
			{
				name: "POST /board/pads returns 403 when local repos disabled",
				route: "/board/pads",
				body: {
					repoPath: "/path/to/repo",
					commit: "a1b2c3d4",
					relativeFilePath: "board.kicad_pcb",
				},
			},
			{
				name: "POST /board/glb returns 403 when local repos disabled",
				route: "/board/glb",
				body: {
					repoPath: "/path/to/repo",
					commit: "a1b2c3d4",
					relativeFilePath: "board.kicad_pcb",
				},
			},
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

	describe("bad commit refs return 400", () => {
		const invalidRefs = [
			"-main",
			"--upload-pack=exploit",
			"main..HEAD",
			"feature/test..dev",
			"main;rm -rf /",
			"ref with spaces",
			`ref_${"x".repeat(200)}`,
		];

		for (const ref of invalidRefs) {
			test(`rejects invalid ref "${ref}" on /diff/process baseCommit`, async () => {
				const { status } = await postJson(enabledPort, "/diff/process", {
					repoPath: "/path/to/repo",
					baseCommit: ref,
					targetCommit: "a1b2c3d4",
					relativeFilePath: "board.kicad_pcb",
				});
				assert.equal(status, 400);
			});

			test(`rejects invalid ref "${ref}" on /diff/process targetCommit`, async () => {
				const { status } = await postJson(enabledPort, "/diff/process", {
					repoPath: "/path/to/repo",
					baseCommit: "a1b2c3d4",
					targetCommit: ref,
					relativeFilePath: "board.kicad_pcb",
				});
				assert.equal(status, 400);
			});

			test(`rejects invalid ref "${ref}" on /board/pads commit`, async () => {
				const { status } = await postJson(enabledPort, "/board/pads", {
					repoPath: "/path/to/repo",
					commit: ref,
					relativeFilePath: "board.kicad_pcb",
				});
				assert.equal(status, 400);
			});

			test(`rejects invalid ref "${ref}" on /board/glb commit`, async () => {
				const { status } = await postJson(enabledPort, "/board/glb", {
					repoPath: "/path/to/repo",
					commit: ref,
					relativeFilePath: "board.kicad_pcb",
				});
				assert.equal(status, 400);
			});
		}
	});

	describe("bad targetFile and relativeFilePath return 400", () => {
		const invalidPaths = [
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

		for (const badPath of invalidPaths) {
			test(`rejects invalid path "${badPath}" on /diff/process`, async () => {
				const { status } = await postJson(enabledPort, "/diff/process", {
					repoPath: "/path/to/repo",
					baseCommit: "a1b2c3d4",
					targetCommit: "e5f6a7b8",
					relativeFilePath: badPath,
				});
				assert.equal(status, 400);
			});

			test(`rejects invalid path "${badPath}" on /board/pads`, async () => {
				const { status } = await postJson(enabledPort, "/board/pads", {
					repoPath: "/path/to/repo",
					commit: "a1b2c3d4",
					relativeFilePath: badPath,
				});
				assert.equal(status, 400);
			});

			test(`rejects invalid path "${badPath}" on /board/glb`, async () => {
				const { status } = await postJson(enabledPort, "/board/glb", {
					repoPath: "/path/to/repo",
					commit: "a1b2c3d4",
					relativeFilePath: badPath,
				});
				assert.equal(status, 400);
			});
		}
	});

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
