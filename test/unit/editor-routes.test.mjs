import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import express from "express";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { createEditorRouter } from "../../backend/src/routes/editor-routes.js";

const createResistorPart = (id, ref, coord) => ({
	id,
	ref,
	value: "10k",
	symbol: "Device:R",
	footprint: "Resistor_SMD:R_0603_1608Metric",
	props: {},
	placement: { x: coord, y: coord, rot: 0, side: "F" },
});

function makeTestParts(p1Id, p2Id) {
	return [
		createResistorPart(p1Id, "R1", 10),
		createResistorPart(p2Id, "R2", 20),
	];
}

function makeTestNets(ids, net2Pins = 1) {
	const pinRef = (partId, pin) => ({ partId, pin: String(pin) });
	const net2List = [pinRef(ids.p1, 2)];
	if (net2Pins > 1) {
		net2List.push(pinRef(ids.p2, 2));
	}
	return [
		{
			id: ids.n1,
			name: "NET1",
			pins: [pinRef(ids.p1, 1), pinRef(ids.p2, 1)],
		},
		{ id: ids.n2, name: "NET2", pins: net2List },
	];
}

function makeTestIR(name = "TestCircuit", net2Pins = 1) {
	const [p1, p2] = [newId("part"), newId("part")];
	const [n1, n2] = [newId("net"), newId("net")];
	return {
		schemaVersion: 1,
		name,
		parts: makeTestParts(p1, p2),
		nets: makeTestNets({ p1, p2, n1, n2 }, net2Pins),
		constraints: [],
	};
}

const createTrack = (netId, yPos) => ({
	netId,
	layer: "F.Cu",
	start: [10, yPos],
	end: [20, yPos],
	widthMm: 0.25,
});

function makeClearanceBoard(net1Id, net2Id) {
	return {
		tracks: [createTrack(net1Id, 10), createTrack(net2Id, 10.3)],
	};
}

function bootServer(app) {
	const server = http.createServer(app);
	return new Promise((done) => {
		server.listen(0, "127.0.0.1", () => {
			done({ server, port: server.address().port });
		});
	});
}

const shutdownServer = (server) =>
	new Promise((done) => (server ? server.close(done) : done()));

async function postJson(port, path, body) {
	const targetUrl = `http://127.0.0.1:${port}${path}`;
	const res = await fetch(targetUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	let payload = {};
	try {
		payload = await res.json();
	} catch {
		payload = {};
	}
	return {
		status: res.status,
		headers: res.headers,
		json: payload,
	};
}

async function postText(
	targetPort,
	endpoint,
	body,
	contentType = "text/plain",
) {
	const headers = {};
	if (contentType) {
		headers["content-type"] = contentType;
	}
	const targetUrl = `http://127.0.0.1:${targetPort}${endpoint}`;
	const res = await fetch(targetUrl, {
		method: "POST",
		headers,
		body,
	});
	let payload = {};
	try {
		payload = await res.json();
	} catch {
		payload = {};
	}
	return {
		status: res.status,
		headers: res.headers,
		json: payload,
	};
}

const createCase = (name, body, expected = 400) => ({ name, body, expected });

const CHECK_INVALID_CASES = [
	createCase("empty body", {}),
	createCase("null ir", { ir: null }),
	createCase("string ir", { ir: "invalid" }),
	createCase("malformed ir", { ir: { schemaVersion: 99 } }),
	createCase("array body", []),
];

const SANITIZE_CASES = [
	{ raw: "../x", expected: "x" },
	{ raw: "a\nb", expected: "ab" },
	{ raw: "../../etc/passwd", expected: "etcpasswd" },
	{ raw: "", expected: "circuit" },
	{ raw: "///", expected: "circuit" },
	{ raw: "SafeProject_01", expected: "SafeProject_01" },
];

const EXPORT_INVALID_CASES = [
	createCase("empty body", {}),
	createCase("null ir", { ir: null }),
	createCase("invalid ir schema", { ir: { schemaVersion: 2 } }),
];

const SAMPLE_SCH = `(kicad_sch
	(version 20240108)
	(generator "banana")
	(symbol (lib_id "Device:R") (at 30 40 90)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const SAMPLE_PCB = `(kicad_pcb
	(version 20240108)
	(generator "banana")
	(footprint "Resistor_SMD:R_0603"
		(layer "F.Cu")
		(at 10 20 45)
		(property "Reference" "R1")
		(property "Value" "10k")
	)
)`;

const IMPORT_INVALID_CASES = [
	{
		name: "missing kind",
		endpoint: "/api/editor/import",
		body: SAMPLE_SCH,
		expected: "Query parameter kind must be sch or pcb",
	},
	{
		name: "invalid kind",
		endpoint: "/api/editor/import?kind=xml",
		body: SAMPLE_SCH,
		expected: "Query parameter kind must be sch or pcb",
	},
	{
		name: "constructor kind",
		endpoint: "/api/editor/import?kind=constructor",
		body: SAMPLE_SCH,
		expected: "Query parameter kind must be sch or pcb",
	},
	{
		name: "array kind",
		endpoint: "/api/editor/import?kind=sch&kind=pcb",
		body: SAMPLE_SCH,
		expected: "Query parameter kind must be sch or pcb",
	},
	{
		name: "wrong header for sch",
		endpoint: "/api/editor/import?kind=sch",
		body: SAMPLE_PCB,
		expected: "File is not a KiCad schematic",
	},
	{
		name: "wrong header for pcb",
		endpoint: "/api/editor/import?kind=pcb",
		body: SAMPLE_SCH,
		expected: "File is not a KiCad board",
	},
	{
		name: "garbage text for sch",
		endpoint: "/api/editor/import?kind=sch",
		body: "not a kicad schematic",
		expected: "File is not a KiCad schematic",
	},
	{
		name: "garbage text for pcb",
		endpoint: "/api/editor/import?kind=pcb",
		body: "not a kicad board",
		expected: "File is not a KiCad board",
	},
	{
		name: "empty body for sch",
		endpoint: "/api/editor/import?kind=sch",
		body: "",
		expected: "File is not a KiCad schematic",
	},
	{
		name: "empty body for pcb",
		endpoint: "/api/editor/import?kind=pcb",
		body: "",
		expected: "File is not a KiCad board",
	},
];

const REPO_DIR = path.resolve("/fake/repo");
const COMMIT_HASH = "0123456789abcdef0123456789abcdef01234567";

function createFakeFs(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const written = new Map();
	const readFile = async (p) => {
		if (!files.has(p)) {
			throw new Error(`ENOENT: ${p}`);
		}
		return files.get(p);
	};
	const writeFile = async (p, data) => {
		written.set(p, data);
	};
	return { files, written, fsImpl: { readFile, writeFile } };
}

function createFakeExecFile(options = {}) {
	const calls = [];
	const isWorkTree = options.isWorkTree ?? true;
	const commitHash = options.commitHash ?? COMMIT_HASH;
	const execFileFn = async (cmd, args, opts) => {
		calls.push({ cmd, args, opts });
		if (args.includes("--is-inside-work-tree")) {
			return { stdout: isWorkTree ? "true\n" : "false\n" };
		}
		if (args.includes("HEAD")) {
			return { stdout: `${commitHash}\n` };
		}
		return { stdout: "" };
	};
	return { calls, execFileFn };
}

function assertNoWritesOrCommits(fakeFs, fakeExec) {
	assert.strictEqual(fakeFs.written.size, 0);
	const commits = fakeExec.calls.filter((c) => c.args.includes("commit"));
	assert.strictEqual(commits.length, 0);
}

function makeValidCommitBody(overrides = {}) {
	return {
		repoPath: REPO_DIR,
		files: [
			{
				path: "hardware/board.kicad_sch",
				kind: "sch",
				edits: [{ ref: "R1", op: "setValue", value: "22k" }],
			},
		],
		message: "Update R1 value",
		...overrides,
	};
}

const COMMIT_INVALID_CASES = [
	createCase("empty body", {}),
	createCase("null repoPath", makeValidCommitBody({ repoPath: null })),
	createCase("non-string repoPath", makeValidCommitBody({ repoPath: 123 })),
	createCase("empty repoPath", makeValidCommitBody({ repoPath: "" })),
	createCase(
		"overly long repoPath",
		makeValidCommitBody({ repoPath: "x".repeat(1025) }),
	),
	createCase("null message", makeValidCommitBody({ message: null })),
	createCase("empty message", makeValidCommitBody({ message: "" })),
	createCase(
		"overly long message",
		makeValidCommitBody({ message: "m".repeat(201) }),
	),
	createCase("non-array files", makeValidCommitBody({ files: "not-array" })),
	createCase("empty files array", makeValidCommitBody({ files: [] })),
	createCase(
		"too many files",
		makeValidCommitBody({
			files: [
				{ path: "a.kicad_sch", kind: "sch", edits: [] },
				{ path: "b.kicad_pcb", kind: "pcb", edits: [] },
				{ path: "c.kicad_sch", kind: "sch", edits: [] },
			],
		}),
	),
	createCase("invalid file entry type", makeValidCommitBody({ files: [null] })),
	createCase(
		"missing file path",
		makeValidCommitBody({ files: [{ kind: "sch", edits: [] }] }),
	),
	createCase(
		"empty file path",
		makeValidCommitBody({ files: [{ path: "", kind: "sch", edits: [] }] }),
	),
	createCase(
		"invalid file kind",
		makeValidCommitBody({
			files: [{ path: "a.kicad_sch", kind: "csv", edits: [] }],
		}),
	),
	createCase(
		"edits not array",
		makeValidCommitBody({
			files: [{ path: "a.kicad_sch", kind: "sch", edits: "none" }],
		}),
	),
	createCase(
		"edits too large",
		makeValidCommitBody({
			files: [{ path: "a.kicad_sch", kind: "sch", edits: new Array(501) }],
		}),
	),
];

function assertErrorResponse(res, expectedStatus) {
	assert.strictEqual(res.status, expectedStatus);
	assert.strictEqual(typeof res.json?.error, "string");
}

function registerRejectionTests(endpoint, cases, getPort) {
	for (const { name, body, expected } of cases) {
		test(`rejects ${name} with ${expected}`, async () => {
			const res = await postJson(getPort(), endpoint, body);
			assertErrorResponse(res, expected);
		});
	}
}

function assertDrcIssuesAndMarkers(res) {
	assert.strictEqual(res.status, 200);
	const { issues, markers } = res.json;
	assert.ok(Array.isArray(issues) && Array.isArray(markers));
	const hasErc = issues.some((i) => i.source === "erc");
	const hasClearance = issues.some((i) => i.metric === "clearance");
	assert.ok(hasErc, "expected at least one ERC issue");
	assert.ok(hasClearance, "expected at least one clearance issue");
	assert.ok(markers.length > 0, "expected at least one marker");
}

function assertSanitizedExportFiles(res, expectedName) {
	assert.strictEqual(res.status, 200);
	const files = res.json.files;
	const schKey = `${expectedName}.kicad_sch`;
	const pcbKey = `${expectedName}.kicad_pcb`;
	assert.ok(files[schKey], `missing ${schKey}`);
	assert.ok(files[pcbKey], `missing ${pcbKey}`);
	assert.ok(files[schKey].includes("(kicad_sch"));
	assert.ok(files[pcbKey].includes("(kicad_pcb"));

	for (const key of Object.keys(files)) {
		assert.match(key, /^[A-Za-z0-9_-]+\.(kicad_sch|kicad_pcb)$/);
		assert.strictEqual(key.includes(".."), false);
		assert.strictEqual(key.includes("/"), false);
		assert.strictEqual(key.includes("\\"), false);
	}
}

function assertExportTracksAndWarnings(res, expectedTracks) {
	assert.strictEqual(res.status, 200);
	assert.deepEqual(res.json.tracks, expectedTracks);
	const warnings = res.json.warnings;
	assert.ok(Array.isArray(warnings));
	const expectedWarning = "tracks not yet written by pcb writer";
	assert.ok(warnings.includes(expectedWarning));
	for (const w of warnings) {
		assert.strictEqual(w.toLowerCase().includes("todo"), false);
	}
}

describe("editor-routes", () => {
	let app;
	let server;
	let port;
	let fixtureDir;
	let schFixturePath;
	let pcbFixturePath;

	before(async () => {
		fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "kicad-test-"));
		schFixturePath = path.join(fixtureDir, "sample.kicad_sch");
		pcbFixturePath = path.join(fixtureDir, "sample.kicad_pcb");
		fs.writeFileSync(schFixturePath, SAMPLE_SCH, "utf8");
		fs.writeFileSync(pcbFixturePath, SAMPLE_PCB, "utf8");

		app = createApp();
		app.locals.allowLocalRepos = true;
		const started = await bootServer(app);
		server = started.server;
		port = started.port;
	});

	after(async () => {
		if (fixtureDir) {
			fs.rmSync(fixtureDir, { recursive: true, force: true });
		}
		await shutdownServer(server);
	});

	test("createEditorRouter exports valid express router", () => {
		const router = createEditorRouter();
		assert.strictEqual(typeof router, "function");
	});

	describe("POST /api/editor/check", () => {
		registerRejectionTests(
			"/api/editor/check",
			CHECK_INVALID_CASES,
			() => port,
		);

		test("returns ERC and clearance issues with markers", async () => {
			const ir = makeTestIR("DrcTestCircuit", 1);
			const board = makeClearanceBoard(ir.nets[0].id, ir.nets[1].id);
			const res = await postJson(port, "/api/editor/check", { ir, board });
			assertDrcIssuesAndMarkers(res);
		});

		test("rejects board with > 20000 tracks with 413", async () => {
			const ir = makeTestIR("BigBoard", 2);
			const board = { tracks: new Array(20001).fill({}) };
			const res = await postJson(port, "/api/editor/check", { ir, board });
			assertErrorResponse(res, 413);
		});
	});

	describe("POST /api/editor/export", () => {
		registerRejectionTests(
			"/api/editor/export",
			EXPORT_INVALID_CASES,
			() => port,
		);

		for (const tc of SANITIZE_CASES) {
			test(`sanitizes name '${tc.raw.replace(/\n/g, "\\n")}' to '${tc.expected}'`, async () => {
				const ir = makeTestIR(tc.raw, 2);
				const res = await postJson(port, "/api/editor/export", { ir });
				assertSanitizedExportFiles(res, tc.expected);
			});
		}

		test("includes tracks and warning when board.tracks present", async () => {
			const ir = makeTestIR("ExportTracksCircuit", 2);
			const board = makeClearanceBoard(ir.nets[0].id, ir.nets[1].id);
			const res = await postJson(port, "/api/editor/export", { ir, board });
			assertExportTracksAndWarnings(res, board.tracks);
		});
	});

	describe("POST /api/editor/import", () => {
		for (const tc of IMPORT_INVALID_CASES) {
			test(`rejects ${tc.name} with 400`, async () => {
				const res = await postText(port, tc.endpoint, tc.body);
				assert.strictEqual(res.status, 400);
				assert.strictEqual(res.json.error, tc.expected);
			});
		}

		test("sch happy path returns 200 and ir.parts is an array", async () => {
			const schText = fs.readFileSync(schFixturePath, "utf8");
			const res = await postText(port, "/api/editor/import?kind=sch", schText);
			assert.strictEqual(res.status, 200);
			assert.ok(Array.isArray(res.json.ir?.parts));
			assert.strictEqual(res.json.board, null);
			assert.ok(Array.isArray(res.json.warnings));
		});

		test("pcb happy path returns 200 and board is an object", async () => {
			const pcbText = fs.readFileSync(pcbFixturePath, "utf8");
			const res = await postText(port, "/api/editor/import?kind=pcb", pcbText);
			assert.strictEqual(res.status, 200);
			assert.ok(typeof res.json.board === "object" && res.json.board !== null);
			assert.ok(Array.isArray(res.json.warnings));
		});

		test("accepts valid fixture padded with trailing spaces past 100kb", async () => {
			const schText = fs.readFileSync(schFixturePath, "utf8");
			const padded = schText + " ".repeat(120 * 1024);
			assert.ok(padded.length > 100 * 1024);
			const res = await postText(port, "/api/editor/import?kind=sch", padded);
			assert.strictEqual(res.status, 200);
			assert.ok(Array.isArray(res.json.ir?.parts));
		});

		test("returns 422 with errors when file content cannot be imported", async () => {
			const unclosed = "(kicad_sch (unclosed";
			const res = await postText(port, "/api/editor/import?kind=sch", unclosed);
			assert.strictEqual(res.status, 422);
			assert.strictEqual(res.json.error, "Could not import file");
			assert.ok(Array.isArray(res.json.errors));
		});
	});

	describe("POST /api/editor/commit", () => {
		let commitApp;
		let commitServer;
		let commitPort;
		let fakeFs;
		let fakeExec;

		function resetHarness() {
			const schPath = path.resolve(REPO_DIR, "hardware/board.kicad_sch");
			fakeFs = createFakeFs({ [schPath]: SAMPLE_SCH });
			fakeExec = createFakeExecFile();
			commitApp.locals.allowLocalRepos = true;
		}

		before(async () => {
			commitApp = express();
			commitApp.use(express.json());
			resetHarness();
			const router = createEditorRouter({
				patchDeps: {
					fsImpl: {
						readFile: (p, enc) => fakeFs.fsImpl.readFile(p, enc),
						writeFile: (p, data, enc) => fakeFs.fsImpl.writeFile(p, data, enc),
					},
					execFileFn: (cmd, args, opts) => fakeExec.execFileFn(cmd, args, opts),
				},
			});
			commitApp.use(router);
			const started = await bootServer(commitApp);
			commitServer = started.server;
			commitPort = started.port;
		});

		after(async () => {
			await shutdownServer(commitServer);
		});

		test("refuses with 403 in hosted mode without calling fs or git", async () => {
			resetHarness();
			commitApp.locals.allowLocalRepos = false;
			const res = await postJson(
				commitPort,
				"/api/editor/commit",
				makeValidCommitBody(),
			);
			assert.strictEqual(res.status, 403);
			assert.strictEqual(
				res.json.error,
				"Saving to KiCad files is only available in the desktop app",
			);
			assertNoWritesOrCommits(fakeFs, fakeExec);
			assert.strictEqual(fakeExec.calls.length, 0);
		});

		test("desktop happy path returns commit hash and per-file counts", async () => {
			resetHarness();
			const res = await postJson(
				commitPort,
				"/api/editor/commit",
				makeValidCommitBody(),
			);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.json.commit, COMMIT_HASH);
			assert.deepStrictEqual(res.json.files, [
				{ path: "hardware/board.kicad_sch", applied: 1, skipped: [] },
			]);
			assert.strictEqual(fakeFs.written.size, 1);
		});

		for (const { name, body } of COMMIT_INVALID_CASES) {
			test(`rejects ${name} with 400 and writes nothing`, async () => {
				resetHarness();
				const res = await postJson(commitPort, "/api/editor/commit", body);
				assertErrorResponse(res, 400);
				assertNoWritesOrCommits(fakeFs, fakeExec);
			});
		}

		test("rejects traversal path with 400 and writes nothing", async () => {
			resetHarness();
			const body = makeValidCommitBody({
				files: [
					{
						path: "../secret.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R1", op: "setValue", value: "22k" }],
					},
				],
			});
			const res = await postJson(commitPort, "/api/editor/commit", body);
			assertErrorResponse(res, 400);
			assertNoWritesOrCommits(fakeFs, fakeExec);
		});

		test("returns 400 when tool applies zero edits", async () => {
			resetHarness();
			const body = makeValidCommitBody({
				files: [
					{
						path: "hardware/board.kicad_sch",
						kind: "sch",
						edits: [{ ref: "R999", op: "setValue", value: "22k" }],
					},
				],
			});
			const res = await postJson(commitPort, "/api/editor/commit", body);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(res.json.error, "No edits were applied");
			assertNoWritesOrCommits(fakeFs, fakeExec);
		});

		test("returns 500 on unexpected throw without leaking absolute path", async () => {
			resetHarness();
			const secretPath = path.resolve("/secret/storage/leak.txt");
			fakeFs.fsImpl.writeFile = async () => {
				throw new Error(`Write failed at ${secretPath}: broken disk`);
			};
			const res = await postJson(
				commitPort,
				"/api/editor/commit",
				makeValidCommitBody(),
			);
			assert.strictEqual(res.status, 500);
			assert.strictEqual(res.json.error, "Editor commit failed");
			assert.strictEqual(res.json.stack, undefined);
			assert.strictEqual(JSON.stringify(res.json).includes(secretPath), false);
		});

		test("responds successfully at /editor/commit", async () => {
			resetHarness();
			const res = await postJson(
				commitPort,
				"/editor/commit",
				makeValidCommitBody(),
			);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.json.commit, COMMIT_HASH);
		});
	});

	describe("rate limiting and local mode", () => {
		test("does not break local mode with allowLocalRepos = true", async () => {
			const ir = makeTestIR("LocalModeTest", 2);
			const calls = Array.from({ length: 15 }, () =>
				postJson(port, "/api/editor/check", { ir }),
			);
			const responses = await Promise.all(calls);
			for (const r of responses) {
				assert.strictEqual(r.status, 200);
				assert.strictEqual(r.headers.get("ratelimit-limit"), null);
			}
		});

		test("enforces rate limiter headers when allowLocalRepos is false", async () => {
			app.locals.allowLocalRepos = false;
			try {
				const ir = makeTestIR("RateLimitActiveTest", 2);
				const res = await postJson(port, "/api/editor/check", { ir });
				assert.strictEqual(res.status, 200);
				assert.strictEqual(res.headers.get("ratelimit-limit"), "120");
				assert.notStrictEqual(res.headers.get("ratelimit-remaining"), null);
			} finally {
				app.locals.allowLocalRepos = true;
			}
		});

		test("enforces rate limiter headers on commit route when allowLocalRepos is false", async () => {
			app.locals.allowLocalRepos = false;
			try {
				const res = await postJson(port, "/api/editor/commit", {});
				assert.strictEqual(res.status, 403);
				assert.strictEqual(res.headers.get("ratelimit-limit"), "120");
				assert.notStrictEqual(res.headers.get("ratelimit-remaining"), null);
			} finally {
				app.locals.allowLocalRepos = true;
			}
		});

		test("does not rate limit commit route when allowLocalRepos is true", async () => {
			const res = await postJson(port, "/api/editor/commit", {});
			assert.strictEqual(res.headers.get("ratelimit-limit"), null);
		});
	});
});
