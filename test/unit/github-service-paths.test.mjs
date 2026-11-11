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
				assert.doesNotThrow(() => validateRepoSegment(segment));
				assert.doesNotThrow(() => validateOwner(segment));
				assert.doesNotThrow(() => validateRepo(segment));
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
				assert.throws(
					() => validateRepoSegment(segment),
					/invalid GitHub path/,
				);
				assert.throws(() => validateOwner(segment), /invalid GitHub path/);
				assert.throws(() => validateRepo(segment), /invalid GitHub path/);
			});
		}

		it("rejects invalid pair if either owner or repo is invalid", () => {
			assert.throws(
				() => validateRepoSlug(".", "valid-repo"),
				/invalid GitHub path/,
			);
			assert.throws(
				() => validateRepoSlug("valid-owner", ".."),
				/invalid GitHub path/,
			);
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

		const traversalPaths = [
			"../board.kicad_pcb",
			"nested/../board.kicad_pcb",
			"nested/dir/../../board.kicad_pcb",
			"..",
		];
		for (const tp of traversalPaths) {
			it(`rejects traversal path: ${tp}`, () => {
				assert.throws(() => validateFilePath(tp), /invalid GitHub path/);
			});
		}

		const absolutePaths = [
			"/board.kicad_pcb",
			"/etc/passwd",
			"C:/Windows/system32",
			"D:/data/board.kicad_pcb",
		];
		for (const ap of absolutePaths) {
			it(`rejects absolute path: ${ap}`, () => {
				assert.throws(() => validateFilePath(ap), /invalid GitHub path/);
			});
		}

		const backslashPaths = [
			"hardware\\board.kicad_pcb",
			"\\board.kicad_pcb",
			"a\\b\\c",
		];
		for (const bp of backslashPaths) {
			it(`rejects backslash path: ${bp}`, () => {
				assert.throws(() => validateFilePath(bp), /invalid GitHub path/);
			});
		}

		const invalidTypes = ["", null, undefined, 42, {}];
		for (const val of invalidTypes) {
			it(`rejects non-string or empty path: ${JSON.stringify(val)}`, () => {
				assert.throws(() => validateFilePath(val), /invalid GitHub path/);
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
			assert.throws(
				() => encodeFilePath("../secret.txt"),
				/invalid GitHub path/,
			);
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
			assert.throws(
				() => buildContentsApiUrl("..", "repo", "board.kicad_pcb", "sha"),
				/invalid GitHub path/,
			);
			assert.throws(
				() => buildRawFileUrl("owner", "..", "sha", "board.kicad_pcb"),
				/invalid GitHub path/,
			);
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
					/destination outside data dir/,
				);
			});
		}
	});

	describe("high-level methods input rejection", () => {
		it("getRepoBranches rejects invalid owner/repo", async () => {
			await assert.rejects(
				() => getRepoBranches("token", ".", "valid-repo"),
				/invalid GitHub path/,
			);
			await assert.rejects(
				() => getRepoBranches("token", "valid-owner", ".."),
				/invalid GitHub path/,
			);
		});

		it("getRepoPullRequests rejects invalid owner/repo", async () => {
			await assert.rejects(
				() => getRepoPullRequests("token", "bad/owner", "valid-repo"),
				/invalid GitHub path/,
			);
		});

		it("getRepoHardwareFiles rejects invalid owner/repo", async () => {
			await assert.rejects(
				() => getRepoHardwareFiles("token", "owner", ".."),
				/invalid GitHub path/,
			);
		});

		it("getRepoCommits rejects invalid owner/repo or pathFilter traversal", async () => {
			await assert.rejects(
				() => getRepoCommits("token", "..", "valid-repo"),
				/invalid GitHub path/,
			);
			await assert.rejects(
				() =>
					getRepoCommits("token", "owner", "repo", {
						filePath: "../traversal",
					}),
				/invalid GitHub path/,
			);
		});

		it("downloadRepoFile rejects destination outside data dir", async () => {
			await assert.rejects(
				() =>
					downloadRepoFile("token", {
						owner: "owner",
						repo: "repo",
						filePath: "board.kicad_pcb",
						commitSha: "sha123",
						destinationPath: path.join(
							BANANA_DATA_DIR,
							"..",
							"escape.kicad_pcb",
						),
					}),
				/destination outside data dir/,
			);
		});

		it("downloadRepoFile rejects invalid owner/repo or traversal filePath", async () => {
			const safeDest = path.join(BANANA_DATA_DIR, "safe.kicad_pcb");
			await assert.rejects(
				() =>
					downloadRepoFile("token", {
						owner: "..",
						repo: "repo",
						filePath: "board.kicad_pcb",
						commitSha: "sha123",
						destinationPath: safeDest,
					}),
				/invalid GitHub path/,
			);
			await assert.rejects(
				() =>
					downloadRepoFile("token", {
						owner: "owner",
						repo: "repo",
						filePath: "../secret.kicad_pcb",
						commitSha: "sha123",
						destinationPath: safeDest,
					}),
				/invalid GitHub path/,
			);
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
			for (const file of createdFiles) {
				try {
					await fs.promises.unlink(file);
				} catch {}
			}
		});

		it("downloadRepoFile fetches and saves file with encoded URL", async () => {
			const calls = [];
			const fileContent = "kicad_pcb file dummy content";
			globalThis.fetch = async (url) => {
				calls.push(url);
				return {
					ok: true,
					status: 200,
					arrayBuffer: async () => Buffer.from(fileContent),
				};
			};

			const testDest = path.join(
				BANANA_DATA_DIR,
				"test_fetch_save",
				"board.kicad_pcb",
			);
			createdFiles.push(testDest);

			const saved = await downloadRepoFile("mock-token", {
				owner: "test-owner",
				repo: "test-repo",
				filePath: "sub dir/board rev1.kicad_pcb",
				commitSha: "commit-sha",
				destinationPath: testDest,
			});

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
			const calls = [];
			globalThis.fetch = async (url) => {
				calls.push(url);
				return {
					ok: true,
					status: 200,
					json: async () => [{ name: "main", commit: { sha: "abc" } }],
				};
			};

			const branches = await getRepoBranches("token", "owner.1", "repo_2");
			assert.equal(branches.length, 1);
			assert.equal(
				calls[0],
				"https://api.github.com/repos/owner.1/repo_2/branches?per_page=100",
			);
		});
	});
});
