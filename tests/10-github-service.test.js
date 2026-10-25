import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import {
	downloadRepoFile,
	getRepoBranches,
	getRepoCommits,
	getRepoHardwareFiles,
	getRepoPullRequests,
} from "../backend/src/github-service.js";
import { tmpDir } from "./helpers.js";

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

function mockFetch(handler) {
	const calls = [];
	globalThis.fetch = async (url, init) => {
		calls.push(String(url));
		return handler(String(url), init);
	};
	return calls;
}
const json = (body, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

test("owner/repo are validated before any network request", async (t) => {
	const calls = mockFetch(() => json([]));
	for (const bad of ["..", "a/b", "a?b", "a#b", "", "a b", "../../x"]) {
		await t.test(`owner=${JSON.stringify(bad)}`, async () => {
			await assert.rejects(
				getRepoBranches("t", bad, "r"),
				/Invalid GitHub owner/,
			);
			await assert.rejects(
				getRepoCommits("t", bad, "r"),
				/Invalid GitHub owner/,
			);
			await assert.rejects(
				getRepoPullRequests("t", bad, "r"),
				/Invalid GitHub owner/,
			);
			await assert.rejects(
				getRepoHardwareFiles("t", bad, "r"),
				/Invalid GitHub owner/,
			);
		});
		await t.test(`repo=${JSON.stringify(bad)}`, async () =>
			assert.rejects(getRepoBranches("t", "o", bad), /Invalid GitHub repo/),
		);
	}
	assert.equal(calls.length, 0);
});

test("pull request state is whitelisted", async (t) => {
	for (const [input, expected] of [
		["open", "open"],
		["closed", "closed"],
		["all", "all"],
		["open&evil=1", "open"],
		["../x", "open"],
		[undefined, "open"],
	]) {
		await t.test(String(input), async () => {
			const calls = mockFetch(() => json([]));
			await getRepoPullRequests("t", "o", "r", input);
			assert.match(calls[0], new RegExp(`state=${expected}&`));
		});
	}
});

test("downloadRepoFile encodes the file path and writes the bytes", async () => {
	const calls = mockFetch(() => new Response("BOARD-DATA", { status: 200 }));
	const dest = path.join(tmpDir(), "x", "b.kicad_pcb");
	await downloadRepoFile(
		"tok",
		"owner",
		"repo",
		"dir with space/b#1.kicad_pcb",
		"abc123",
		dest,
	);
	assert.match(
		calls[0],
		/contents\/dir%20with%20space\/b%231\.kicad_pcb\?ref=abc123/,
	);
	assert.equal(fs.readFileSync(dest, "utf8"), "BOARD-DATA");
});

test("downloadRepoFile refuses unsafe inputs without a request", async (t) => {
	const calls = mockFetch(() => new Response("x"));
	const dest = path.join(tmpDir(), "o");
	const cases = [
		["owner/..", "r", "f", "c"],
		["o", "r", "../f", "c"],
		["o", "r", "/etc/passwd", "c"],
		["o", "r", "f", "--x"],
		["o", "r", "f", "a..b"],
	];
	for (const [o, r, f, c] of cases)
		await t.test(JSON.stringify([o, r, f, c]), () =>
			assert.rejects(downloadRepoFile("t", o, r, f, c, dest)),
		);
	assert.equal(calls.length, 0);
});

test("downloadRepoFile never serves a stale file for a moved ref", async () => {
	const dest = path.join(tmpDir(), "b.kicad_pcb");
	let body = "v1";
	mockFetch(() => new Response(body));
	await downloadRepoFile("t", "o", "r", "b.kicad_pcb", "main", dest);
	body = "v2";
	await downloadRepoFile("t", "o", "r", "b.kicad_pcb", "main", dest);
	assert.equal(fs.readFileSync(dest, "utf8"), "v2");
});

test("falls back to raw.githubusercontent and surfaces HTTP failures", async () => {
	const dest = path.join(tmpDir(), "b");
	const calls = mockFetch((url) =>
		url.includes("api.github.com")
			? new Response("no", { status: 404 })
			: new Response("RAW"),
	);
	await downloadRepoFile("t", "o", "r", "b.kicad_pcb", "main", dest);
	assert.equal(calls.length, 2);
	mockFetch(() => new Response("denied", { status: 403 }));
	await assert.rejects(
		downloadRepoFile(
			"t",
			"o",
			"r",
			"b.kicad_pcb",
			"main",
			path.join(tmpDir(), "c"),
		),
		/HTTP 403/,
	);
});

test("missing token is rejected", async () => {
	await assert.rejects(
		getRepoBranches("", "o", "r"),
		/Missing GitHub access token/,
	);
});
