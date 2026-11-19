import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { createLocalRepoRouter } from "../../backend/src/routes/local-repo-routes.js";

const INVALID_NAMES = ["../x", "a/b", "C:x", "", "a".repeat(200)];

async function setupTestTree(baseDir) {
	const dirs = [
		path.join(baseDir, "sub", "repoA", ".git"),
		path.join(baseDir, "other", "repoA"),
		path.join(baseDir, "node_modules", "repoA", ".git"),
		path.join(baseDir, ".hidden", "repoA", ".git"),
		path.join(baseDir, "AppData", "repoA", ".git"),
	];
	for (let i = 1; i <= 15; i++) {
		const num = String(i).padStart(2, "0");
		dirs.push(path.join(baseDir, `lim_${num}`, "limitRepo", ".git"));
	}
	await Promise.all(
		dirs.map((dir) => fs.promises.mkdir(dir, { recursive: true })),
	);
}

async function startServer(routerOrApp) {
	let app = routerOrApp;
	if (typeof routerOrApp.listen !== "function") {
		app = express();
		app.use("/api", routerOrApp);
	}
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

async function withServer(routerOrApp, testFn) {
	const harness = await startServer(routerOrApp);
	try {
		await testFn(harness);
	} finally {
		await harness.close();
	}
}

async function fetchFind(baseUrl, query) {
	const qs = query ? `?${query}` : "";
	const res = await fetch(`${baseUrl}/api/local-repos/find${qs}`);
	const json = await res.json().catch(() => ({}));
	return { status: res.status, json };
}

function assertSuccess(res, expectedMatches = null) {
	assert.equal(res.status, 200);
	if (expectedMatches !== null) {
		assert.deepEqual(res.json.matches, expectedMatches);
	}
}

function assertBadRequest(res, label) {
	assert.equal(res.status, 400, label);
	assert.ok(res.json.error, label);
}

async function tryCreateSymlink(target, linkPath) {
	try {
		await fs.promises.symlink(target, linkPath, "dir");
		return true;
	} catch {
		// Operating system refused symlink creation
		return false;
	}
}

describe("local repo find routes", () => {
	let tempDir;
	let harness;

	before(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "banana-test-"));
		await setupTestTree(tempDir);
		const router = createLocalRepoRouter({ roots: [tempDir] });
		harness = await startServer(router);
	});

	after(async () => {
		if (harness) await harness.close();
		if (tempDir) {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("rejects invalid repository names with 400", async () => {
		for (const invalidName of INVALID_NAMES) {
			const qs = `name=${encodeURIComponent(invalidName)}`;
			const res = await fetchFind(harness.url, qs);
			assertBadRequest(res, `name=${invalidName}`);
		}
	});

	test("rejects missing name query parameter with 400", async () => {
		const res = await fetchFind(harness.url, "");
		assertBadRequest(res, "missing name");
	});

	test("finds repoA with .git at depth 2 and skips excluded dirs", async () => {
		const res = await fetchFind(harness.url, "name=repoA");
		assertSuccess(res);
		assert.ok(Array.isArray(res.json.matches));
		const expectedMatch = path.resolve(tempDir, "sub", "repoA");
		assert.ok(res.json.matches.includes(expectedMatch));

		const excluded = [
			path.resolve(tempDir, "other", "repoA"),
			path.resolve(tempDir, "node_modules", "repoA"),
			path.resolve(tempDir, ".hidden", "repoA"),
			path.resolve(tempDir, "AppData", "repoA"),
		];
		for (const p of excluded) {
			assert.ok(!res.json.matches.includes(p), `Excluded path matched: ${p}`);
		}
	});

	test("skips symlinked repositories", async () => {
		const symlinkDir = path.resolve(tempDir, "symlink_dir");
		const symlinkPath = path.join(symlinkDir, "symRepo");
		await fs.promises.mkdir(symlinkDir, { recursive: true });

		const created = await tryCreateSymlink(
			path.resolve(tempDir, "sub", "repoA"),
			symlinkPath,
		);
		if (created) {
			const res = await fetchFind(harness.url, "name=symRepo");
			assertSuccess(res);
			assert.ok(!res.json.matches.includes(symlinkPath));
		}
	});

	test("limits matches to at most 10 and sorts shortest path first", async () => {
		const res = await fetchFind(harness.url, "name=limitRepo");
		assertSuccess(res);
		assert.equal(res.json.matches.length, 10);

		for (let i = 0; i < res.json.matches.length - 1; i++) {
			const curLen = res.json.matches[i].length;
			const nextLen = res.json.matches[i + 1].length;
			assert.ok(curLen <= nextLen, "matches should be sorted by length");
		}
	});

	test("handles case-insensitivity on win32", async () => {
		const res = await fetchFind(harness.url, "name=REPOA");
		assertSuccess(res);
		const expectedMatch = path.resolve(tempDir, "sub", "repoA");
		if (process.platform === "win32") {
			assert.ok(res.json.matches.includes(expectedMatch));
		}
	});

	test("factory accepts custom fsImpl", async () => {
		const customFs = {
			promises: {
				lstat: async () => ({
					isDirectory: () => true,
					isSymbolicLink: () => false,
				}),
				readdir: async () => [],
			},
		};
		const router = createLocalRepoRouter({
			roots: ["/mock/root"],
			fsImpl: customFs,
		});
		await withServer(router, async (h) => {
			const res = await fetchFind(h.url, "name=mockRepo");
			assertSuccess(res, []);
		});
	});

	test("app integration serves /api/local-repos/find", async () => {
		await withServer(createApp(), async (h) => {
			const res = await fetchFind(h.url, "name=non_existent_unique_123");
			assertSuccess(res, []);
		});
	});
});
