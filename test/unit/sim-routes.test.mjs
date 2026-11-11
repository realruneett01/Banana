import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { SIM_KINDS } from "../../backend/src/engine/sim/run-sim.js";

const COMMIT_SHA = "a1b2c3d4e5f6";

function makeValidEnv(overrides = {}) {
	return Object.assign(
		{ id: newId("env"), altitudeM: 0, airflowMs: 0, name: "Nominal" },
		{ ambientC: { min: -10, max: 25 }, humidityPct: { min: 10, max: 90 } },
		overrides,
	);
}

function createPart(ref, value, symbol, options = {}) {
	return { id: newId("part"), ref, value, symbol, ...options };
}

function makeValidThermalInputs() {
	const part = createPart("U1", "LDO", "Reg:LDO", {
		footprint: "Pkg:SOT-223",
		props: { powerW: 3.0, thetaJA: 50, tjMaxC: 125 },
	});
	return { ir: { parts: [part] } };
}

function createResistor(id, ref) {
	return {
		id,
		ref,
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603",
		props: {},
	};
}

function makeValidCircuitIR() {
	const [p1, p2] = [newId("part"), newId("part")];
	const netPins = [
		{ partId: p1, pin: "1" },
		{ partId: p2, pin: "1" },
	];
	return {
		schemaVersion: 1,
		name: "TestCircuit",
		parts: [createResistor(p1, "R1"), createResistor(p2, "R2")],
		nets: [{ id: newId("net"), name: "VCC", pins: netPins }],
		constraints: [],
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

const shutdownServer = (server) =>
	new Promise((resolve) => {
		if (!server) {
			resolve();
			return;
		}
		server.close(resolve);
	});

async function requestJson(port, path, options = {}) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, options);
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

const getJson = (port, path) => requestJson(port, path);

const postJson = (port, path, body) =>
	requestJson(port, path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

function makeSimRunBody(patch = {}) {
	return {
		kind: "thermal",
		commit: COMMIT_SHA,
		env: makeValidEnv(),
		inputs: {},
		...patch,
	};
}

function assertBadRequest(status, json) {
	assert.equal(status, 400);
	assert.ok(typeof json?.error === "string");
}

function assertIssuesResponse(status, json) {
	assert.equal(status, 200);
	assert.ok(Array.isArray(json?.issues));
}

function assertSuccessfulSim(status, json, expected) {
	assertIssuesResponse(status, json);
	assert.deepEqual(
		{
			status: json?.run?.status,
			kind: json?.run?.kind,
			commit: json?.run?.commit,
		},
		{ status: "done", kind: expected.kind, commit: expected.commit },
	);
}

function assertFailedSim(status, json, fragment) {
	assert.equal(status, 422);
	assert.deepEqual(
		{ runStatus: json?.run?.status, hasError: typeof json?.error },
		{ runStatus: "failed", hasError: "string" },
	);
	assert.ok(json.error.includes(fragment));
}

const BAD_CASES = [
	{ name: "rejects unknown simulation kind", patch: { kind: "unknown-kind" } },
	{ name: "rejects short commit ref (< 7 chars)", patch: { commit: "123456" } },
	{
		name: "rejects long commit ref (> 40 chars)",
		patch: { commit: "a".repeat(41) },
	},
	{
		name: "rejects non-hex commit ref",
		patch: { commit: "not-a-valid-hex-commit!" },
	},
	{ name: "rejects non-object env", patch: { env: "not-an-object" } },
	{ name: "rejects non-object inputs", patch: { inputs: "not-an-object" } },
	{ name: "rejects null inputs", patch: { inputs: null } },
];

describe("sim-routes and erc-routes", () => {
	let server;
	let port;

	before(async () => {
		const started = await bootServer(createApp());
		server = started.server;
		port = started.port;
	});

	after(async () => {
		await shutdownServer(server);
	});

	describe("GET /api/sim/kinds", () => {
		test("returns list of supported simulation kinds", async () => {
			const { status, json } = await getJson(port, "/api/sim/kinds");
			assert.equal(status, 200);
			assert.deepEqual(json.kinds, SIM_KINDS);
		});
	});

	describe("POST /api/sim/run - validation guards", () => {
		for (const { name, patch } of BAD_CASES) {
			test(name, async () => {
				const body = makeSimRunBody(patch);
				const { status, json } = await postJson(port, "/api/sim/run", body);
				assertBadRequest(status, json);
			});
		}
	});

	describe("POST /api/sim/run - execution", () => {
		test("happy path: runs thermal simulation and returns 200 with run and issues", async () => {
			const body = makeSimRunBody({ inputs: makeValidThermalInputs() });
			const { status, json } = await postJson(port, "/api/sim/run", body);
			assertSuccessfulSim(status, json, {
				kind: "thermal",
				commit: COMMIT_SHA,
			});
		});

		test("failed simulation returns 422 with error and run", async () => {
			const badEnv = makeValidEnv({ ambientC: { min: 40, max: 20 } });
			const body = makeSimRunBody({
				env: badEnv,
				inputs: makeValidThermalInputs(),
			});
			const { status, json } = await postJson(port, "/api/sim/run", body);
			assertFailedSim(status, json, "ambientC");
		});
	});

	describe("POST /api/erc/run", () => {
		test("invalid IR returns 400 with validation errors", async () => {
			const body = { ir: { schemaVersion: 99 }, commit: COMMIT_SHA };
			const { status, json } = await postJson(port, "/api/erc/run", body);
			assertBadRequest(status, json);
			assert.ok(Array.isArray(json.errors) && json.errors.length > 0);
		});

		test("valid IR returns 200 with issues list", async () => {
			const body = { ir: makeValidCircuitIR(), commit: COMMIT_SHA };
			const { status, json } = await postJson(port, "/api/erc/run", body);
			assertIssuesResponse(status, json);
		});
	});
});
