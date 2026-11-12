import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import gitRouter from "../../backend/src/routes/git-routes.js";

function initTempRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "banana-commit-test-"));
	execFileSync("git", ["init"], { cwd: dir });
	const schFile = path.join(dir, "board.kicad_sch");
	fs.writeFileSync(schFile, "(kicad_sch (version 20230121))", "utf8");
	execFileSync("git", ["add", "--", "board.kicad_sch"], { cwd: dir });
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Banana",
			"-c",
			"user.email=banana@localhost",
			"commit",
			"-m",
			"init",
			"--",
			"board.kicad_sch",
		],
		{ cwd: dir },
	);
	return dir;
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

async function postCommit(baseUrl, body) {
	const res = await fetch(`${baseUrl}/api/git/commit-files`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, json };
}

function cleanDir(dir) {
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const VALIDATION_CASES = [
	{
		name: "empty message",
		body: (dir) => ({
			repoPath: dir,
			files: ["board.kicad_sch"],
			message: "",
		}),
	},
	{
		name: "whitespace-only message",
		body: (dir) => ({
			repoPath: dir,
			files: ["board.kicad_sch"],
			message: "   ",
		}),
	},
	{
		name: "message of 201 chars",
		body: (dir) => ({
			repoPath: dir,
			files: ["board.kicad_sch"],
			message: "a".repeat(201),
		}),
	},
	{
		name: "../ path",
		body: (dir) => ({
			repoPath: dir,
			files: ["../board.kicad_sch"],
			message: "valid message",
		}),
	},
	{
		name: "wrong extension",
		body: (dir) => ({
			repoPath: dir,
			files: ["board.txt"],
			message: "valid message",
		}),
	},
	{
		name: "nonexistent file",
		body: (dir) => ({
			repoPath: dir,
			files: ["missing.kicad_sch"],
			message: "valid message",
		}),
	},
	{
		name: "empty files array",
		body: (dir) => ({
			repoPath: dir,
			files: [],
			message: "valid message",
		}),
	},
];

describe("POST /commit-files", () => {
	let disabledServer;
	let enabledServer;
	let repoDir;

	before(async () => {
		repoDir = initTempRepo();
		disabledServer = await startServer(false);
		enabledServer = await startServer(true);
	});

	after(async () => {
		if (disabledServer) await disabledServer.close();
		if (enabledServer) await enabledServer.close();
		cleanDir(repoDir);
	});

	for (const tc of VALIDATION_CASES) {
		test(`returns 400 on ${tc.name}`, async () => {
			const res = await postCommit(enabledServer.url, tc.body(repoDir));
			assert.equal(res.status, 400);
			assert.equal(typeof res.json?.error, "string");
			assert.equal(res.json.error.includes(repoDir), false);
		});
	}

	test("returns 409 when file is unchanged", async () => {
		const res = await postCommit(enabledServer.url, {
			repoPath: repoDir,
			files: ["board.kicad_sch"],
			message: "no changes",
		});
		assert.equal(res.status, 409);
		assert.deepEqual(res.json, { error: "No changes to commit" });
	});

	test("returns 200 with short sha and commits modified file", async () => {
		const schFile = path.join(repoDir, "board.kicad_sch");
		fs.writeFileSync(schFile, "(kicad_sch (version 20230121) (mod 1))", "utf8");
		const res = await postCommit(enabledServer.url, {
			repoPath: repoDir,
			files: ["board.kicad_sch"],
			message: "update schematic",
		});
		assert.equal(res.status, 200);
		assert.equal(typeof res.json?.commit, "string");
		assert.deepEqual(res.json?.files, ["board.kicad_sch"]);
		const logMsg = execFileSync("git", ["log", "-1", "--format=%s"], {
			cwd: repoDir,
		})
			.toString()
			.trim();
		assert.equal(logMsg, "update schematic");
	});

	test("returns 403 when allowLocalRepos is false", async () => {
		const res = await postCommit(disabledServer.url, {
			repoPath: repoDir,
			files: ["board.kicad_sch"],
			message: "try commit",
		});
		assert.equal(res.status, 403);
		assert.deepEqual(res.json, {
			error: "Local repositories are disabled on this server",
		});
	});
});
