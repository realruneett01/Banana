import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BANANA_DATA_DIR } from "../../backend/src/config.js";
import {
	buildContentsApiUrl,
	buildRawFileUrl,
	downloadRepoFile,
	encodeFilePath,
	getRepoBranches,
	getRepoCommits,
	getRepoHardwareFiles,
	getRepoPullRequests,
	validateDestinationPath,
	validateFilePath,
	validateOwner,
	validateRepo,
	validateRepoSegment,
	validateRepoSlug,
} from "../../backend/src/github-service.js";

const INVALID_GITHUB_PATH = /invalid GitHub path/;
const DESTINATION_OUTSIDE_DATA_DIR = /destination outside data dir/;
const SEGMENT_VALIDATORS = [validateRepoSegment, validateOwner, validateRepo];

function assertValidSegment(segment) {
	for (const validate of SEGMENT_VALIDATORS) {
		assert.doesNotThrow(() => validate(segment));
	}
}

function assertInvalidSegment(segment) {
	for (const validate of SEGMENT_VALIDATORS) {
		assert.throws(() => validate(segment), INVALID_GITHUB_PATH);
	}
}

function assertThrowsAll(callers, expected = INVALID_GITHUB_PATH) {
	for (const fn of callers) {
		assert.throws(fn, expected);
	}
}

async function assertRejectsAll(callers, expected = INVALID_GITHUB_PATH) {
	for (const fn of callers) {
		await assert.rejects(fn, expected);
	}
}

function makeDownloadOptions(overrides = {}) {
	return {
		owner: "owner",
		repo: "repo",
		filePath: "board.kicad_pcb",
		commitSha: "sha123",
		destinationPath: path.join(BANANA_DATA_DIR, "safe.kicad_pcb"),
		...overrides,
	};
}

function mockFetch(response) {
	const calls = [];
	globalThis.fetch = async (url) => {
		calls.push(url);
		return {
			ok: true,
			status: 200,
			...response,
		};
	};
	return calls;
}

async function cleanupTestFile(filePath) {
	try {
		await fs.promises.unlink(filePath);
	} catch (err) {
		// Ignore if test file was not created or already removed
		if (err?.code !== "ENOENT") {
			throw err;
		}
	}
}

describe("GitHub service path validation and URL encoding", () => {
	describe("owner and repo validation", () => {
		const validSegments = [
			"owner",
			"repo-name",
			"repo_name",
			"repo.name",
			"A".repeat(100),
		];
		for (const segment of validSegments) {
			it(`accepts valid segment: ${segment}`, () => {
				assertValidSegment(segment);
			});
		}

		it("accepts valid owner/repo pair", () => {
			assert.doesNotThrow(() => validateRepoSlug("owner-1", "repo.2"));
		});

		const invalidSegments = [
			".",
			"..",
			"",
			"owner/repo",
			"owner repo",
			"owner$name",
			"A".repeat(101),
			null,
			undefined,
			123,
		];
		for (const segment of invalidSegments) {
			it(`rejects invalid segment: ${JSON.stringify(segment)}`, () => {
				assertInvalidSegment(segment);
			});
		}

		it("rejects invalid pair if either owner or repo is invalid", () => {
			assertThrowsAll([
				() => validateRepoSlug(".", "valid-repo"),
				() => validateRepoSlug("valid-owner", ".."),
			]);
		});
	});

	describe("file path validation", () => {
		const validPaths = [
			"board.kicad_pcb",
			"hardware/board.kicad_pcb",
			"nested/dir/level/schematic.kicad_sch",
			"project space/rev 1/board.kicad_pcb",
		];
		for (const fp of validPaths) {
			it(`accepts valid relative path: ${fp}`, () => {
				assert.doesNotThrow(() => validateFilePath(fp));
			});
		}

		const invalidPathCases = [
			...[
				"../board.kicad_pcb",
				"nested/../board.kicad_pcb",
				"nested/dir/../../board.kicad_pcb",
				"..",
			].map((tp) => ({ name: `rejects traversal path: ${tp}`, path: tp })),
			...[
				"/board.kicad_pcb",
				"/etc/passwd",
				"C:/Windows/system32",
				"D:/data/board.kicad_pcb",
			].map((ap) => ({ name: `rejects absolute path: ${ap}`, path: ap })),
			...["hardware\\board.kicad_pcb", "\\board.kicad_pcb", "a\\b\\c"].map(
				(bp) => ({ name: `rejects backslash path: ${bp}`, path: bp }),
			),
			...["", null, undefined, 42, {}].map((val) => ({
				name: `rejects non-string or empty path: ${JSON.stringify(val)}`,
				path: val,
			})),
		];

		for (const { name, path: candidatePath } of invalidPathCases) {
			it(name, () => {
				assert.throws(
					() => validateFilePath(candidatePath),
					INVALID_GITHUB_PATH,
				);
			});
		}
	});

	describe("encodeFilePath", () => {
		it("encodes each segment while preserving slashes", () => {
			const raw = "hardware rev 1/sub folder/board v1.kicad_pcb";
			const encoded = encodeFilePath(raw);
			assert.equal(
				encoded,
				"hardware%20rev%201/sub%20folder/board%20v1.kicad_pcb",
			);
		});

		it("throws when encoding invalid path with traversal", () => {
			assert.throws(() => encodeFilePath("../secret.txt"), INVALID_GITHUB_PATH);
		});
	});

	describe("URL builders", () => {
		it("builds contents API URL with encoded owner, repo, sha, and path", () => {
			const url = buildContentsApiUrl(
				"test-owner",
				"test-repo",
				"folder space/board v1.kicad_pcb",
				"sha 123",
			);
			assert.equal(
				url,
				"https://api.github.com/repos/test-owner/test-repo/contents/folder%20space/board%20v1.kicad_pcb?ref=sha%20123",
			);
		});

		it("builds raw file URL with encoded owner, repo, sha, and path", () => {
			const url = buildRawFileUrl(
				"test-owner",
				"test-repo",
				"sha 123",
				"folder space/board v1.kicad_pcb",
			);
			assert.equal(
				url,
				"https://raw.githubusercontent.com/test-owner/test-repo/sha%20123/folder%20space/board%20v1.kicad_pcb",
			);
		});

		it("throws on invalid owner or repo in URL builders", () => {
			assertThrowsAll([
				() => buildContentsApiUrl("..", "repo", "board.kicad_pcb", "sha"),
				() => buildRawFileUrl("owner", "..", "sha", "board.kicad_pcb"),
			]);
		});
	});

	describe("destinationPath validation", () => {
		it("accepts valid destination inside BANANA_DATA_DIR", () => {
			const dest = path.join(BANANA_DATA_DIR, "downloads", "board.kicad_pcb");
			const validated = validateDestinationPath(dest);
			assert.equal(validated, path.resolve(dest));
		});

		const invalidDests = [
			path.join(BANANA_DATA_DIR, "..", "secret.txt"),
			path.resolve(BANANA_DATA_DIR, "../outside.txt"),
			BANANA_DATA_DIR,
			"/etc/passwd",
			"C:/Windows/system32",
			"",
			null,
			undefined,
		];
		for (const badDest of invalidDests) {
			it(`rejects destination outside data dir: ${JSON.stringify(badDest)}`, () => {
				assert.throws(
					() => validateDestinationPath(badDest),
					DESTINATION_OUTSIDE_DATA_DIR,
				);
			});
		}
	});

	describe("high-level methods input rejection", () => {
		it("getRepoBranches rejects invalid owner/repo", async () => {
			await assertRejectsAll([
				() => getRepoBranches("token", ".", "valid-repo"),
				() => getRepoBranches("token", "valid-owner", ".."),
			]);
		});

		it("getRepoPullRequests rejects invalid owner/repo", async () => {
			await assert.rejects(
				() => getRepoPullRequests("token", "bad/owner", "valid-repo"),
				INVALID_GITHUB_PATH,
			);
		});

		it("getRepoHardwareFiles rejects invalid owner/repo", async () => {
			await assert.rejects(
				() => getRepoHardwareFiles("token", "owner", ".."),
				INVALID_GITHUB_PATH,
			);
		});

		it("getRepoCommits rejects invalid owner/repo or pathFilter traversal", async () => {
			await assertRejectsAll([
				() => getRepoCommits("token", "..", "valid-repo"),
				() =>
					getRepoCommits("token", "owner", "repo", {
						filePath: "../traversal",
					}),
			]);
		});

		it("downloadRepoFile rejects destination outside data dir", async () => {
			await assert.rejects(
				() =>
					downloadRepoFile(
						"token",
						makeDownloadOptions({
							destinationPath: path.join(
								BANANA_DATA_DIR,
								"..",
								"escape.kicad_pcb",
							),
						}),
					),
				DESTINATION_OUTSIDE_DATA_DIR,
			);
		});

		it("downloadRepoFile rejects invalid owner/repo or traversal filePath", async () => {
			await assertRejectsAll([
				() => downloadRepoFile("token", makeDownloadOptions({ owner: ".." })),
				() =>
					downloadRepoFile(
						"token",
						makeDownloadOptions({ filePath: "../secret.kicad_pcb" }),
					),
			]);
		});
	});

	describe("mocked fetch behavior", () => {
		let originalFetch;
		const createdFiles = [];

		before(() => {
			originalFetch = globalThis.fetch;
		});

		after(async () => {
			globalThis.fetch = originalFetch;
			await Promise.all(createdFiles.map(cleanupTestFile));
		});

		it("downloadRepoFile fetches and saves file with encoded URL", async () => {
			const fileContent = "kicad_pcb file dummy content";
			const calls = mockFetch({
				arrayBuffer: async () => Buffer.from(fileContent),
			});

			const testDest = path.join(
				BANANA_DATA_DIR,
				"test_fetch_save",
				"board.kicad_pcb",
			);
			createdFiles.push(testDest);

			const saved = await downloadRepoFile(
				"mock-token",
				makeDownloadOptions({
					owner: "test-owner",
					repo: "test-repo",
					filePath: "sub dir/board rev1.kicad_pcb",
					commitSha: "commit-sha",
					destinationPath: testDest,
				}),
			);

			assert.equal(saved, testDest);
			assert.equal(calls.length, 1);
			assert.equal(
				calls[0],
				"https://api.github.com/repos/test-owner/test-repo/contents/sub%20dir/board%20rev1.kicad_pcb?ref=commit-sha",
			);
			const written = await fs.promises.readFile(testDest, "utf8");
			assert.equal(written, fileContent);
		});

		it("getRepoBranches fetches with encoded owner and repo", async () => {
			const calls = mockFetch({
				json: async () => [{ name: "main", commit: { sha: "abc" } }],
			});

			const branches = await getRepoBranches("token", "owner.1", "repo_2");
			assert.equal(branches.length, 1);
			assert.equal(
				calls[0],
				"https://api.github.com/repos/owner.1/repo_2/branches?per_page=100",
			);
		});
	});
});
