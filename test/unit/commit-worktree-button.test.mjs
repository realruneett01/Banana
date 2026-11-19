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

/** Table-driven strict equality: each row is [actual, expected]. */
function assertEqualRows(rows) {
	for (const [actual, expected] of rows) {
		assert.equal(actual, expected);
	}
}

/** Calls commitWorktreeFile with the shared repo/file defaults plus overrides. */
function commit(overrides) {
	return commitWorktreeFile({
		apiBase: "",
		repoPath: REPO,
		filePath: FILE,
		message: "m",
		...overrides,
	});
}

/** Commits via a fake 200 backend at http://api; returns the result and fetch calls. */
async function commitViaApi(message, body) {
	const { impl, calls } = fakeFetch(200, body);
	const res = await commit({ apiBase: "http://api", message, fetchImpl: impl });
	return { res, calls };
}

/** Runs fn while listening for commit-created; returns [fnResult, details seen]. */
async function withCommitEvents(fn) {
	const seen = [];
	const off = onCommitCreated((detail) => seen.push(detail));
	try {
		return [await fn(), seen];
	} finally {
		off();
	}
}

describe("normalizeCommitMessage", () => {
	test("trims and rejects blank messages", () => {
		const cases = [
			["  fix trace  ", "fix trace"],
			["   ", ""],
			[undefined, ""],
			[42, ""],
		];
		for (const [input, expected] of cases) {
			assert.equal(normalizeCommitMessage(input), expected);
		}
	});
});

describe("buildCommitFilesRequest", () => {
	test("posts JSON body { repoPath, files[], message } with extra headers", () => {
		const req = buildCommitFilesRequest(
			{ repoPath: REPO, filePath: FILE, message: " msg " },
			{ "x-banana-auth": "t" },
		);
		assertEqualRows([
			[req.method, "POST"],
			[req.headers["Content-Type"], "application/json"],
			[req.headers["x-banana-auth"], "t"],
		]);
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
		const { res, calls } = await commitViaApi("  ", { commit: "x" });
		assert.match(res.error, /message is required/i);
		assertEqualRows([
			[res.ok, false],
			[calls.length, 0],
		]);
	});

	test("posts to /api/git/commit-files and reports the new commit", async () => {
		const { res, calls } = await commitViaApi("route GND", {
			commit: "deadbeef",
		});
		assert.deepEqual(res, { ok: true, commit: "deadbeef" });
		assertEqualRows([
			[calls[0].url, "http://api/api/git/commit-files"],
			[JSON.parse(calls[0].init.body).message, "route GND"],
		]);
	});

	test("emits commit-created so the commit selector refreshes", async () => {
		const { impl } = fakeFetch(200, { commit: "cafe01" });
		const [, seen] = await withCommitEvents(() => commit({ fetchImpl: impl }));
		assert.deepEqual(seen, [
			{ repoPath: REPO, filePath: FILE, commit: "cafe01" },
		]);
	});

	test("surfaces the backend error and does not emit on failure", async () => {
		const { impl } = fakeFetch(409, { error: "No changes to commit" });
		const [res, seen] = await withCommitEvents(() =>
			commit({ fetchImpl: impl }),
		);
		assert.deepEqual(res, { ok: false, error: "No changes to commit" });
		assert.equal(seen.length, 0);
	});

	test("reports network failures", async () => {
		const res = await commit({
			fetchImpl: async () => {
				throw new Error("offline");
			},
		});
		assert.deepEqual(res, { ok: false, error: "offline" });
	});
});
