import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { createApp } from "../backend/src/server.js";
import { makeRepo } from "./helpers.js";

let server;
let base;
let repo;
before(async () => {
	await new Promise((resolve) => {
		server = createApp().listen(0, "127.0.0.1", resolve);
	});
	base = `http://127.0.0.1:${server.address().port}`;
	repo = makeRepo({ "board.kicad_pcb": "(kicad_pcb)", "docs/readme.txt": "x" });
});
after(() => {
	server.close();
	fs.rmSync(repo, { recursive: true, force: true });
});

const post = (route, body, raw = false) =>
	fetch(base + route, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: raw ? body : JSON.stringify(body),
	});

const OPTION_REFS = [
	"--output=/tmp/banana-pwn",
	"-p",
	"--help",
	"--exec=id",
	"-C/tmp",
	"--git-dir=/etc",
	"--",
	"-",
];
const BAD_VALUES = [null, 5, true, [], {}, ["HEAD"], { a: 1 }];

test("health check responds with JSON", async () => {
	const r = await fetch(`${base}/api/health-check`);
	assert.ok([200, 500, 503].includes(r.status));
	const body = await r.json();
	assert.ok(["healthy", "unhealthy"].includes(body.status));
});

test("unknown API routes return JSON 404, not HTML", async (t) => {
	for (const p of ["/api/nope", "/api/git/nope", "/api/x/y/z", "/api/"]) {
		await t.test(p, async () => {
			const r = await fetch(base + p);
			assert.equal(r.status, 404);
			assert.deepEqual(await r.json(), { error: "Not found" });
		});
	}
});

test("malformed JSON bodies produce a 400 JSON error and the server keeps serving", async (t) => {
	for (const body of ["{", "{bad", "[1,2", "undefined", '{"a":}', "\u0000"]) {
		await t.test(JSON.stringify(body), async () => {
			const r = await post("/api/git/init", body, true);
			assert.equal(r.status, 400);
			assert.ok((await r.json()).error);
		});
	}
	assert.equal((await fetch(`${base}/api/health-check`)).status < 600, true);
});

test("git/diff-files rejects option-like refs (argument injection)", async (t) => {
	for (const ref of OPTION_REFS) {
		for (const field of ["baseRef", "targetRef"]) {
			await t.test(`${field}=${ref}`, async () => {
				const r = await post("/api/git/diff-files", {
					repoPath: repo,
					baseRef: "HEAD",
					targetRef: "HEAD",
					[field]: ref,
				});
				assert.equal(r.status, 400);
			});
		}
	}
	assert.equal(fs.existsSync("/tmp/banana-pwn"), false);
});

test("git/diff-files with valid refs works", async () => {
	const r = await post("/api/git/diff-files", {
		repoPath: repo,
		baseRef: "HEAD",
		targetRef: "HEAD",
	});
	assert.equal(r.status, 200);
	assert.deepEqual(await r.json(), { files: [] });
});

test("diff/process validates every field before touching git (injection + type confusion)", async (t) => {
	const ok = {
		repoPath: repo,
		baseCommit: "HEAD",
		targetCommit: "HEAD",
		relativeFilePath: "board.kicad_pcb",
	};
	for (const ref of OPTION_REFS) {
		for (const field of ["baseCommit", "targetCommit"]) {
			await t.test(`${field}=${ref}`, async () =>
				assert.equal(
					(await post("/api/diff/process", { ...ok, [field]: ref })).status,
					400,
				),
			);
		}
	}
	for (const p of [
		"../x.kicad_pcb",
		"/etc/passwd",
		"a/../../b",
		"C:\\x.kicad_pcb",
	]) {
		await t.test(`path ${p}`, async () =>
			assert.equal(
				(await post("/api/diff/process", { ...ok, relativeFilePath: p }))
					.status,
				400,
			),
		);
	}
	for (const v of BAD_VALUES) {
		for (const field of ["baseCommit", "targetCommit", "relativeFilePath"]) {
			await t.test(`${field}=${JSON.stringify(v)}`, async () => {
				const r = await post("/api/diff/process", { ...ok, [field]: v });
				assert.ok(r.status >= 400 && r.status < 500, `status ${r.status}`);
			});
		}
	}
	await t.test("missing fields", async () =>
		assert.equal((await post("/api/diff/process", {})).status, 400),
	);
});

test("git/init handles bad input without hanging", async (t) => {
	for (const v of [...BAD_VALUES, "", "   "]) {
		await t.test(JSON.stringify(v), async () => {
			const r = await post("/api/git/init", { repoPath: v });
			assert.ok(r.status >= 400 && r.status < 500);
		});
	}
	await t.test("non-repo directory", async () =>
		assert.equal(
			(await post("/api/git/init", { repoPath: "/tmp" })).status < 500,
			true,
		),
	);
	await t.test("valid repo", async () => {
		const r = await post("/api/git/init", { repoPath: repo });
		assert.equal(r.status, 200);
		const body = await r.json();
		assert.deepEqual(body.kicadFiles, ["board.kicad_pcb"]);
		assert.equal(body.commits.length, 1);
	});
});

test("git/commits and git/evolution validate query parameters", async (t) => {
	const q = (o) => new URLSearchParams(o).toString();
	await t.test("commits ok", async () => {
		const r = await fetch(`${base}/api/git/commits?${q({ repoPath: repo })}`);
		assert.equal(r.status, 200);
		assert.equal((await r.json()).commits.length, 1);
	});
	await t.test("commits missing repo", async () =>
		assert.equal((await fetch(`${base}/api/git/commits`)).status, 400),
	);
	await t.test("commits repeated repoPath param", async () =>
		assert.equal(
			(await fetch(`${base}/api/git/commits?repoPath=a&repoPath=b`)).status,
			400,
		),
	);
	await t.test("commits traversal filePath", async () =>
		assert.equal(
			(
				await fetch(
					`${base}/api/git/commits?${q({ repoPath: repo, filePath: "../x" })}`,
				)
			).status,
			400,
		),
	);
	for (const ref of OPTION_REFS) {
		await t.test(`evolution base=${ref}`, async () =>
			assert.equal(
				(
					await fetch(
						`${base}/api/git/evolution?${q({ repoPath: repo, baseCommit: ref, targetCommit: "HEAD" })}`,
					)
				).status,
				400,
			),
		);
		await t.test(`evolution target=${ref}`, async () =>
			assert.equal(
				(
					await fetch(
						`${base}/api/git/evolution?${q({ repoPath: repo, baseCommit: "HEAD", targetCommit: ref })}`,
					)
				).status,
				400,
			),
		);
	}
	await t.test("evolution ok", async () => {
		const r = await fetch(
			`${base}/api/git/evolution?${q({ repoPath: repo, baseCommit: "HEAD", targetCommit: "HEAD" })}`,
		);
		assert.equal(r.status, 200);
	});
});

test("board/pads validates input", async (t) => {
	const ok = {
		repoPath: repo,
		commit: "HEAD",
		relativeFilePath: "board.kicad_pcb",
	};
	for (const body of [
		{},
		{ ...ok, commit: "--x" },
		{ ...ok, relativeFilePath: "../b.kicad_pcb" },
		{ ...ok, relativeFilePath: "b.txt" },
		{ ...ok, owner: "../x", repo: "y" },
		{ commit: "HEAD", relativeFilePath: "b.kicad_pcb" },
	]) {
		await t.test(JSON.stringify(body), async () =>
			assert.equal((await post("/api/board/pads", body)).status, 400),
		);
	}
	await t.test("remote without token -> 401", async () =>
		assert.equal(
			(
				await post("/api/board/pads", {
					commit: "HEAD",
					filePath: "b.kicad_pcb",
					owner: "o",
					repo: "r",
				})
			).status,
			401,
		),
	);
});

test("github routes require a token and validate owner/repo", async (t) => {
	for (const p of [
		"/api/github/repos",
		"/api/github/repos/o/r/branches",
		"/api/github/repos/o/r/commits",
		"/api/github/repos/o/r/pulls",
		"/api/github/repos/o/r/files",
		"/api/auth/github/verify",
	]) {
		await t.test(p, async () =>
			assert.equal((await fetch(base + p)).status, 401),
		);
	}
	await t.test("github/diff/process without token", async () =>
		assert.equal(
			(
				await post("/api/github/diff/process", {
					owner: "o",
					repo: "r",
					baseCommit: "a",
					targetCommit: "b",
					filePath: "x.kicad_pcb",
				})
			).status,
			401,
		),
	);
	for (const [owner, repoName] of [
		["..", "r"],
		["o", ".."],
		["o/x", "r"],
		["o", "r?x=1"],
		["o", "r#"],
		["", "r"],
	]) {
		await t.test(`diff owner=${owner} repo=${repoName}`, async () => {
			const r = await fetch(`${base}/api/github/diff/process`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: "Bearer t",
				},
				body: JSON.stringify({
					owner,
					repo: repoName,
					baseCommit: "a",
					targetCommit: "b",
					filePath: "x.kicad_pcb",
				}),
			});
			assert.equal(r.status, 400);
		});
	}
});

test("OAuth callback rejects a missing or mismatched state (CSRF)", async (t) => {
	for (const [name, url, headers] of [
		["no code", "/api/auth/github/callback", {}],
		["code, no state", "/api/auth/github/callback?code=abc", {}],
		[
			"code, state, no cookie",
			"/api/auth/github/callback?code=abc&state=zzz",
			{},
		],
		[
			"code, wrong cookie",
			"/api/auth/github/callback?code=abc&state=zzz",
			{ cookie: "banana_oauth_state=other" },
		],
		[
			"array code",
			"/api/auth/github/callback?code=a&code=b&state=s",
			{ cookie: "banana_oauth_state=s" },
		],
	]) {
		await t.test(name, async () => {
			const r = await fetch(base + url, { headers, redirect: "manual" });
			assert.equal(r.status, 400);
		});
	}
});

test("OAuth url issues a random state bound to an HttpOnly cookie", async () => {
	const r = await fetch(`${base}/api/auth/github/url`);
	const body = await r.json();
	if (body.configured) {
		assert.match(
			r.headers.get("set-cookie"),
			/banana_oauth_state=[0-9a-f]{32}.*HttpOnly/i,
		);
	} else {
		assert.match(body.error, /Client ID/);
	}
});

test("server survives 200 concurrent mixed requests", async () => {
	const reqs = Array.from({ length: 200 }, (_, i) =>
		i % 2
			? fetch(`${base}/api/health-check`)
			: post("/api/git/diff-files", {
					repoPath: repo,
					baseRef: i % 4 ? "HEAD" : "--bad",
					targetRef: "HEAD",
				}),
	);
	const res = await Promise.all(reqs);
	assert.ok(res.every((r) => r.status < 600));
	assert.equal((await fetch(`${base}/api/health-check`)).status < 600, true);
});
