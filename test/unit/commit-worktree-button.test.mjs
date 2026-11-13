import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { onCommitCreated } from "../../frontend/src/designEvents.js";
import {
	buildCommitFilesRequest,
	buildWorktreeDiffValues,
	commitWorktreeFile,
	normalizeCommitMessage,
} from "../../frontend/src/kicad/commitWorktree.js";

const REPO = "C:/repos/board";
const FILE = "board.kicad_pcb";

function fakeFetch(status, body) {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, init });
		return { status, statusText: "", json: async () => body };
	};
	return { impl, calls };
}

describe("normalizeCommitMessage", () => {
	test("trims and rejects blank messages", () => {
		assert.equal(normalizeCommitMessage("  fix trace  "), "fix trace");
		assert.equal(normalizeCommitMessage("   "), "");
		assert.equal(normalizeCommitMessage(undefined), "");
		assert.equal(normalizeCommitMessage(42), "");
	});
});

describe("buildCommitFilesRequest", () => {
	test("posts JSON body { repoPath, files[], message } with extra headers", () => {
		const req = buildCommitFilesRequest(
			{ repoPath: REPO, filePath: FILE, message: " msg " },
			{ "x-banana-auth": "t" },
		);
		assert.equal(req.method, "POST");
		assert.equal(req.headers["Content-Type"], "application/json");
		assert.equal(req.headers["x-banana-auth"], "t");
		assert.deepEqual(JSON.parse(req.body), {
			repoPath: REPO,
			files: [FILE],
			message: "msg",
		});
	});
});

describe("buildWorktreeDiffValues", () => {
	test("targets WORKTREE with the selected base commit", () => {
		assert.deepEqual(buildWorktreeDiffValues(REPO, "abc123", FILE), {
			repoPath: REPO,
			baseCommit: "abc123",
			targetCommit: "WORKTREE",
			relativeFilePath: FILE,
		});
	});

	test("falls back to HEAD when no base commit is selected", () => {
		assert.equal(buildWorktreeDiffValues(REPO, "", FILE).baseCommit, "HEAD");
	});
});

describe("commitWorktreeFile", () => {
	test("requires a commit message and never calls fetch without one", async () => {
		const { impl, calls } = fakeFetch(200, { commit: "x" });
		const res = await commitWorktreeFile({
			apiBase: "http://api",
			repoPath: REPO,
			filePath: FILE,
			message: "  ",
			fetchImpl: impl,
		});
		assert.equal(res.ok, false);
		assert.match(res.error, /message is required/i);
		assert.equal(calls.length, 0);
	});

	test("posts to /api/git/commit-files and reports the new commit", async () => {
		const { impl, calls } = fakeFetch(200, { commit: "deadbeef" });
		const res = await commitWorktreeFile({
			apiBase: "http://api",
			repoPath: REPO,
			filePath: FILE,
			message: "route GND",
			fetchImpl: impl,
		});
		assert.deepEqual(res, { ok: true, commit: "deadbeef" });
		assert.equal(calls[0].url, "http://api/api/git/commit-files");
		assert.equal(JSON.parse(calls[0].init.body).message, "route GND");
	});

	test("emits commit-created so the commit selector refreshes", async () => {
		const { impl } = fakeFetch(200, { commit: "cafe01" });
		const seen = [];
		const off = onCommitCreated((detail) => seen.push(detail));
		try {
			await commitWorktreeFile({
				apiBase: "",
				repoPath: REPO,
				filePath: FILE,
				message: "m",
				fetchImpl: impl,
			});
		} finally {
			off();
		}
		assert.deepEqual(seen, [
			{ repoPath: REPO, filePath: FILE, commit: "cafe01" },
		]);
	});

	test("surfaces the backend error and does not emit on failure", async () => {
		const { impl } = fakeFetch(409, { error: "No changes to commit" });
		const seen = [];
		const off = onCommitCreated((detail) => seen.push(detail));
		try {
			const res = await commitWorktreeFile({
				apiBase: "",
				repoPath: REPO,
				filePath: FILE,
				message: "m",
				fetchImpl: impl,
			});
			assert.deepEqual(res, { ok: false, error: "No changes to commit" });
		} finally {
			off();
		}
		assert.equal(seen.length, 0);
	});

	test("reports network failures", async () => {
		const res = await commitWorktreeFile({
			apiBase: "",
			repoPath: REPO,
			filePath: FILE,
			message: "m",
			fetchImpl: async () => {
				throw new Error("offline");
			},
		});
		assert.deepEqual(res, { ok: false, error: "offline" });
	});
});
