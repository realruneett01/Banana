import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import gitRouter from "../../backend/src/routes/git-routes.js";

const SCH_CONTENT = "(kicad_sch (version 20230121) (generator banana_test))";

function initTempGitRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banana-git-guard-"));
	execFileSync("git", ["init"], { cwd: dir });
	const schFile = path.join(dir, "test.kicad_sch");
	fs.writeFileSync(schFile, SCH_CONTENT, "utf8");
	execFileSync("git", ["add", "test.kicad_sch"], { cwd: dir });
	execFileSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "init"],
		{ cwd: dir },
	);
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
		.toString()
		.trim();
	return { dir, head };
}

async function startServer(allowLocalRepos) {
	const app = express();
	app.locals.allowLocalRepos = allowLocalRepos;
	app.use(express.json());
	app.use("/api/git", gitRouter);
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

async function requestApi(
	baseUrl,
	{ method = "GET", path: reqPath, body = null },
) {
	const options = { method, headers: {} };
	if (body) {
		options.headers["Content-Type"] = "application/json";
		options.body = JSON.stringify(body);
	}
	const res = await fetch(`${baseUrl}${reqPath}`, options);
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: res.status, headers: res.headers, text, json };
}

function getFile(serverUrl, repoPath, filePath, commit = null) {
	let query = `repoPath=${encodeURIComponent(repoPath)}&filePath=${encodeURIComponent(filePath)}`;
	if (commit) {
		query += `&commit=${encodeURIComponent(commit)}`;
	}
	return requestApi(serverUrl, {
		method: "GET",
		path: `/api/git/file?${query}`,
	});
}

describe("git router local repository guards and /file endpoint", () => {
	let disabledServer;
	let enabledServer;
	let tempRepo;

	before(async () => {
		tempRepo = initTempGitRepo();
		disabledServer = await startServer(false);
		enabledServer = await startServer(true);
	});

	after(async () => {
		if (disabledServer) await disabledServer.close();
		if (enabledServer) await enabledServer.close();
		if (tempRepo?.dir) {
			fs.rmSync(tempRepo.dir, { recursive: true, force: true });
		}
	});

	const FORBIDDEN_ROUTES = [
		{ method: "POST", path: "/api/git/init", body: { repoPath: "/tmp" } },
		{
			method: "POST",
			path: "/api/git/diff-files",
			body: { repoPath: "/tmp", baseRef: "main", targetRef: "HEAD" },
		},
		{ method: "GET", path: "/api/git/commits?repoPath=/tmp", body: null },
		{
			method: "GET",
			path: "/api/git/evolution?repoPath=/tmp&baseCommit=a1b2&targetCommit=c3d4",
			body: null,
		},
		{
			method: "GET",
			path: "/api/git/file?repoPath=/tmp&filePath=board.kicad_sch",
			body: null,
		},
	];

	for (const route of FORBIDDEN_ROUTES) {
		test(`${route.method} ${route.path.split("?")[0]} returns 403 when local repos disabled`, async () => {
			const res = await requestApi(disabledServer.url, route);
			assert.equal(res.status, 403);
			assert.deepEqual(res.json, {
				error: "Local repositories are disabled on this server",
			});
		});
	}

	const VALIDATION_CASES = [
		{
			name: "absolute path leading slash",
			file: "/test.kicad_sch",
			commit: null,
		},
		{
			name: "absolute path with drive",
			file: "C:/test.kicad_sch",
			commit: null,
		},
		{
			name: "../ escape prefix",
			file: "../test.kicad_sch",
			commit: null,
		},
		{
			name: "../ escape embedded",
			file: "sub/../../test.kicad_sch",
			commit: null,
		},
		{
			name: "wrong extension .txt",
			file: "test.txt",
			commit: null,
		},
		{
			name: "wrong extension .kicad_pcb.bak",
			file: "test.kicad_pcb.bak",
			commit: null,
		},
		{
			name: "bad commit too short",
			file: "test.kicad_sch",
			commit: "abc",
		},
		{
			name: "bad commit non-hex",
			file: "test.kicad_sch",
			commit: "123xyz",
		},
		{
			name: "bad commit flag injection",
			file: "test.kicad_sch",
			commit: "--help",
		},
	];

	for (const tc of VALIDATION_CASES) {
		test(`/file rejects ${tc.name} with 400`, async () => {
			const res = await getFile(
				enabledServer.url,
				tempRepo.dir,
				tc.file,
				tc.commit,
			);
			assert.equal(res.status, 400);
		});
	}

	const SUCCESS_CASES = [
		{
			name: "GET /file without commit returns 200 and working-tree content",
			commit: () => null,
		},
		{
			name: "GET /file with commit returns 200 and git show content",
			commit: () => tempRepo.head,
		},
	];

	for (const tc of SUCCESS_CASES) {
		test(tc.name, async () => {
			const res = await getFile(
				enabledServer.url,
				tempRepo.dir,
				"test.kicad_sch",
				tc.commit(),
			);
			assert.equal(res.status, 200);
			assert.equal(
				res.headers.get("content-type"),
				"text/plain; charset=utf-8",
			);
			assert.equal(res.text, SCH_CONTENT);
		});
	}

	const FILE_ERROR_CASES = [
		{
			name: "GET /file for nonexistent file returns 404 File not found",
			getRepo: () => tempRepo.dir,
			file: "missing.kicad_sch",
			status: 404,
			error: "File not found",
		},
		{
			name: "validateRepoPath returns 400 with 'Path does not exist on disk' without echoing path",
			getRepo: () =>
				path.join(os.tmpdir(), `banana-test-nonexistent-${Date.now()}`),
			file: "test.kicad_sch",
			status: 400,
			error: "Path does not exist on disk",
		},
	];

	for (const tc of FILE_ERROR_CASES) {
		test(tc.name, async () => {
			const res = await getFile(enabledServer.url, tc.getRepo(), tc.file);
			assert.deepEqual(res.json, { error: tc.error });
			assert.equal(res.status, tc.status);
		});
	}
});
