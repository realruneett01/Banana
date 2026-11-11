import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { createEditorRouter } from "../../backend/src/routes/editor-routes.js";

function makeTestParts(p1Id, p2Id) {
	return [
		{
			id: p1Id,
			ref: "R1",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0603_1608Metric",
			props: {},
			placement: { x: 10, y: 10, rot: 0, side: "F" },
		},
		{
			id: p2Id,
			ref: "R2",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0603_1608Metric",
			props: {},
			placement: { x: 20, y: 20, rot: 0, side: "F" },
		},
	];
}

function makeTestNets(ids, net2Pins = 1) {
	const p2Pins = [
		{ partId: ids.p1, pin: "2" },
		...(net2Pins > 1 ? [{ partId: ids.p2, pin: "2" }] : []),
	];
	return [
		{
			id: ids.n1,
			name: "NET1",
			pins: [
				{ partId: ids.p1, pin: "1" },
				{ partId: ids.p2, pin: "1" },
			],
		},
		{ id: ids.n2, name: "NET2", pins: p2Pins },
	];
}

function makeTestIR(name = "TestCircuit", net2Pins = 1) {
	const ids = {
		p1: newId("part"),
		p2: newId("part"),
		n1: newId("net"),
		n2: newId("net"),
	};
	return {
		schemaVersion: 1,
		name,
		parts: makeTestParts(ids.p1, ids.p2),
		nets: makeTestNets(ids, net2Pins),
		constraints: [],
	};
}

function makeClearanceBoard(net1Id, net2Id) {
	return {
		tracks: [
			{
				netId: net1Id,
				layer: "F.Cu",
				start: [10, 10],
				end: [20, 10],
				widthMm: 0.25,
			},
			{
				netId: net2Id,
				layer: "F.Cu",
				start: [10, 10.3],
				end: [20, 10.3],
				widthMm: 0.25,
			},
		],
	};
}

function bootServer(app) {
	const server = http.createServer(app);
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve({ server, port: server.address().port });
		});
	});
}

function shutdownServer(server) {
	return new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}
		server.close(resolve);
	});
}

async function postJson(port, path, body) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = await response.json().catch(() => ({}));
	return {
		status: response.status,
		headers: response.headers,
		json,
	};
}

const CHECK_INVALID_CASES = [
	{ name: "empty body", body: {}, expected: 400 },
	{ name: "null ir", body: { ir: null }, expected: 400 },
	{ name: "string ir", body: { ir: "invalid" }, expected: 400 },
	{ name: "malformed ir", body: { ir: { schemaVersion: 99 } }, expected: 400 },
	{ name: "array body", body: [], expected: 400 },
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
	{ name: "empty body", body: {}, expected: 400 },
	{ name: "null ir", body: { ir: null }, expected: 400 },
	{
		name: "invalid ir schema",
		body: { ir: { schemaVersion: 2 } },
		expected: 400,
	},
];

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
		assert.equal(typeof router, "function");
	});

	describe("POST /api/editor/check", () => {
		for (const tc of CHECK_INVALID_CASES) {
			test(`rejects ${tc.name} with ${tc.expected}`, async () => {
				const res = await postJson(port, "/api/editor/check", tc.body);
				assert.equal(res.status, tc.expected);
				assert.ok(typeof res.json.error === "string");
			});
		}

		test("returns ERC and clearance issues with markers", async () => {
			const ir = makeTestIR("DrcTestCircuit", 1);
			const board = makeClearanceBoard(ir.nets[0].id, ir.nets[1].id);
			const res = await postJson(port, "/api/editor/check", { ir, board });
			assert.equal(res.status, 200);
			assert.ok(Array.isArray(res.json.issues));
			assert.ok(Array.isArray(res.json.markers));

			const hasErc = res.json.issues.some((i) => i.source === "erc");
			const hasClearance = res.json.issues.some(
				(i) => i.metric === "clearance",
			);
			assert.ok(hasErc, "expected at least one ERC issue");
			assert.ok(hasClearance, "expected at least one clearance issue");
			assert.ok(res.json.markers.length > 0, "expected at least one marker");
		});

		test("rejects board with > 20000 tracks with 413", async () => {
			const ir = makeTestIR("BigBoard", 2);
			const board = { tracks: new Array(20001).fill({}) };
			const res = await postJson(port, "/api/editor/check", { ir, board });
			assert.equal(res.status, 413);
			assert.ok(typeof res.json.error === "string");
		});
	});

	describe("POST /api/editor/export", () => {
		for (const tc of EXPORT_INVALID_CASES) {
			test(`rejects ${tc.name} with ${tc.expected}`, async () => {
				const res = await postJson(port, "/api/editor/export", tc.body);
				assert.equal(res.status, tc.expected);
				assert.ok(typeof res.json.error === "string");
			});
		}

		for (const tc of SANITIZE_CASES) {
			test(`sanitizes name '${tc.raw.replace(/\n/g, "\\n")}' to '${tc.expected}'`, async () => {
				const ir = makeTestIR(tc.raw, 2);
				const res = await postJson(port, "/api/editor/export", { ir });
				assert.equal(res.status, 200);
				const schKey = `${tc.expected}.kicad_sch`;
				const pcbKey = `${tc.expected}.kicad_pcb`;
				assert.ok(res.json.files[schKey], `missing ${schKey}`);
				assert.ok(res.json.files[pcbKey], `missing ${pcbKey}`);
				assert.ok(res.json.files[schKey].includes("(kicad_sch"));
				assert.ok(res.json.files[pcbKey].includes("(kicad_pcb"));

				for (const key of Object.keys(res.json.files)) {
					assert.match(key, /^[A-Za-z0-9_-]+\.(kicad_sch|kicad_pcb)$/);
					assert.equal(key.includes(".."), false);
					assert.equal(key.includes("/"), false);
					assert.equal(key.includes("\\"), false);
				}
			});
		}

		test("includes tracks and warning when board.tracks present", async () => {
			const ir = makeTestIR("ExportTracksCircuit", 2);
			const board = makeClearanceBoard(ir.nets[0].id, ir.nets[1].id);
			const res = await postJson(port, "/api/editor/export", { ir, board });
			assert.equal(res.status, 200);
			assert.deepEqual(res.json.tracks, board.tracks);
			assert.ok(Array.isArray(res.json.warnings));
			const expectedWarning = "tracks not yet written by pcb writer";
			assert.ok(res.json.warnings.includes(expectedWarning));
			for (const w of res.json.warnings) {
				assert.equal(w.toLowerCase().includes("todo"), false);
			}
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
				assert.equal(r.status, 200);
				assert.equal(r.headers.get("ratelimit-limit"), null);
			}
		});

		test("enforces rate limiter headers when allowLocalRepos is false", async () => {
			app.locals.allowLocalRepos = false;
			const ir = makeTestIR("RateLimitActiveTest", 2);
			const res = await postJson(port, "/api/editor/check", { ir });
			app.locals.allowLocalRepos = true;
			assert.equal(res.status, 200);
			assert.equal(res.headers.get("ratelimit-limit"), "120");
			assert.ok(res.headers.get("ratelimit-remaining") !== null);
		});
	});
});
