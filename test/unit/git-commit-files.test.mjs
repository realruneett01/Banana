import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import gitRouter from "../../backend/src/routes/git-routes.js";

const gitIn = (cwd, args) => execFileSync("git", args, { cwd });

function initTempRepo() {
	const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "banana-commit-test-"));
	gitIn(repoDir, ["init"]);
	fs.writeFileSync(
		path.join(repoDir, "board.kicad_sch"),
		"(kicad_sch (version 20230121))",
		"utf8",
	);
	gitIn(repoDir, ["add", "--", "board.kicad_sch"]);
	gitIn(repoDir, [
		"-c",
		"user.name=Banana",
		"-c",
		"user.email=banana@localhost",
		"commit",
		"-m",
		"init",
		"--",
		"board.kicad_sch",
	]);
	return repoDir;
}

async function createTestServer(allowLocal) {
	const app = express().use(express.json());
	app.locals.allowLocalRepos = allowLocal;
	app.use("/api/git", gitRouter);
	const srv = http.createServer(app);
	await new Promise((cb) => srv.listen(0, "127.0.0.1", cb));
	return {
		url: `http://127.0.0.1:${srv.address().port}`,
		close: () => new Promise((cb) => srv.close(cb)),
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
	if (!dir) return;
	fs.rmSync(dir, { recursive: true, force: true });
}

function commitBody(repoPath, overrides = {}) {
	return {
		repoPath,
		files: ["board.kicad_sch"],
		message: "valid message",
		...overrides,
	};
}

const VALIDATION_CASES = [
	{ name: "empty message", payload: { message: "" } },
	{ name: "whitespace-only message", payload: { message: "   " } },
	{ name: "message of 201 chars", payload: { message: "a".repeat(201) } },
	{ name: "../ path", payload: { files: ["../board.kicad_sch"] } },
	{ name: "wrong extension", payload: { files: ["board.txt"] } },
	{ name: "nonexistent file", payload: { files: ["missing.kicad_sch"] } },
	{ name: "empty files array", payload: { files: [] } },
];

const ERROR_RESPONSE_CASES = [
	{
		name: "returns 409 when file is unchanged",
		useDisabledServer: false,
		payload: { message: "no changes" },
		expectedStatus: 409,
		expectedError: "No changes to commit",
	},
	{
		name: "returns 403 when allowLocalRepos is false",
		useDisabledServer: true,
		payload: { message: "try commit" },
		expectedStatus: 403,
		expectedError: "Local repositories are disabled on this server",
	},
];

function addValidationTest(getContext, tc) {
	test(`returns 400 on ${tc.name}`, async () => {
		const { enabledServer, repoDir } = getContext();
		const res = await postCommit(
			enabledServer.url,
			commitBody(repoDir, tc.payload),
		);
		assert.equal(res.status, 400);
		assert.equal(typeof res.json?.error, "string");
		assert.equal(res.json.error.includes(repoDir), false);
	});
}

function registerValidationTests(getContext) {
	for (const tc of VALIDATION_CASES) {
		addValidationTest(getContext, tc);
	}
}

function addErrorTest(getContext, tc) {
	test(tc.name, async () => {
		const { disabledServer, enabledServer, repoDir } = getContext();
		const server = tc.useDisabledServer ? disabledServer : enabledServer;
		const res = await postCommit(server.url, commitBody(repoDir, tc.payload));
		assert.equal(res.status, tc.expectedStatus);
		assert.deepEqual(res.json, { error: tc.expectedError });
	});
}

function registerErrorTests(getContext) {
	for (const tc of ERROR_RESPONSE_CASES) {
		addErrorTest(getContext, tc);
	}
}

function registerSuccessTest(getContext) {
	test("returns 200 with short sha and commits modified file", async () => {
		const { enabledServer, repoDir } = getContext();
		const schFile = path.join(repoDir, "board.kicad_sch");
		fs.writeFileSync(schFile, "(kicad_sch (version 20230121) (mod 1))", "utf8");
		const res = await postCommit(
			enabledServer.url,
			commitBody(repoDir, { message: "update schematic" }),
		);
		assert.equal(res.status, 200);
		assert.equal(typeof res.json?.commit, "string");
		assert.deepEqual(res.json?.files, ["board.kicad_sch"]);
		const logMsg = gitIn(repoDir, ["log", "-1", "--format=%s"])
			.toString()
			.trim();
		assert.equal(logMsg, "update schematic");
	});
}

describe("POST /commit-files", () => {
	const ctx = {};

	before(async () => {
		ctx.repoDir = initTempRepo();
		[ctx.disabledServer, ctx.enabledServer] = await Promise.all([
			createTestServer(false),
			createTestServer(true),
		]);
	});

	after(async () => {
		await Promise.all([
			ctx.disabledServer?.close(),
			ctx.enabledServer?.close(),
		]);
		cleanDir(ctx.repoDir);
	});

	registerValidationTests(() => ctx);
	registerErrorTests(() => ctx);
	registerSuccessTest(() => ctx);
});
