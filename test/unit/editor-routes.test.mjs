import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
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

	before(async () => {
		app = createApp();
		app.locals.allowLocalRepos = true;
		const started = await bootServer(app);
		server = started.server;
		port = started.port;
	});

	after(async () => {
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
	});
});
