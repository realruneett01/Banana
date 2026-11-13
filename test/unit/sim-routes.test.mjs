import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { SIM_KINDS } from "../../backend/src/engine/sim/run-sim.js";

const COMMIT_SHA = "a1b2c3d4e5f6";

function makeValidEnv(overrides = {}) {
	const defaultRanges = {
		ambientC: { min: -10, max: 25 },
		humidityPct: { min: 10, max: 90 },
	};
	return {
		id: newId("env"),
		name: "Nominal",
		altitudeM: 0,
		airflowMs: 0,
		...defaultRanges,
		...overrides,
	};
}

function makeValidThermalInputs() {
	const thermalLimits = { powerW: 3.0, thetaJA: 50, tjMaxC: 125 };
	const thermalPart = {
		id: newId("part"),
		ref: "U1",
		value: "LDO",
		symbol: "Reg:LDO",
		footprint: "Pkg:SOT-223",
		props: thermalLimits,
	};
	return { ir: { parts: [thermalPart] } };
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

class RouteHarness {
	constructor(server) {
		this.server = server;
	}

	async close() {
		if (!this.server) return;
		await new Promise((done) => this.server.close(done));
	}

	async request(endpoint, init) {
		const { port } = this.server.address();
		const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, init);
		const payload = await res.json().catch(() => ({}));
		return { status: res.status, json: payload };
	}

	async get(endpoint) {
		return this.request(endpoint);
	}

	async post(endpoint, body) {
		return this.request(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}
}

async function launchRouteHarness(app) {
	const server = http.createServer(app);
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return new RouteHarness(server);
}

function makeSimRunBody(patch = {}) {
	return {
		kind: "thermal",
		commit: COMMIT_SHA,
		env: makeValidEnv(),
		inputs: {},
		...patch,
	};
}

function assertStatus(res, expectedStatus) {
	assert.equal(res?.status, expectedStatus);
}

function assertErrorMessage(res) {
	assertStatus(res, 400);
	assert.ok(typeof res?.json?.error === "string");
}

function assertIssuesList(res) {
	assertStatus(res, 200);
	assert.ok(Array.isArray(res?.json?.issues));
}

function assertValidationErrors(res) {
	assertErrorMessage(res);
	const errors = res.json?.errors;
	assert.ok(Array.isArray(errors) && errors.length > 0);
}

function assertSuccessfulKinds(res, expectedKinds) {
	assertStatus(res, 200);
	assert.deepEqual(res?.json?.kinds, expectedKinds);
}

function assertSuccessfulSim(res, expected) {
	assertIssuesList(res);
	const runRecord = {
		status: res.json?.run?.status,
		kind: res.json?.run?.kind,
		commit: res.json?.run?.commit,
	};
	assert.deepEqual(runRecord, {
		status: "done",
		kind: expected.kind,
		commit: expected.commit,
	});
}

function assertFailedSim(res, fragment) {
	assertStatus(res, 422);
	const runSummary = {
		status: res.json?.run?.status,
		hasErr: typeof res.json?.error,
	};
	assert.deepEqual(runSummary, { status: "failed", hasErr: "string" });
	assert.ok(res.json.error.includes(fragment));
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
	let harness;

	before(async () => {
		harness = await launchRouteHarness(createApp());
	});

	after(async () => {
		await harness.close();
	});

	describe("GET /api/sim/kinds", () => {
		test("returns list of supported simulation kinds", async () => {
			const res = await harness.get("/api/sim/kinds");
			assertSuccessfulKinds(res, SIM_KINDS);
		});
	});

	describe("POST /api/sim/run - validation guards", () => {
		for (const { name, patch } of BAD_CASES) {
			test(name, async () => {
				const body = makeSimRunBody(patch);
				const res = await harness.post("/api/sim/run", body);
				assertErrorMessage(res);
			});
		}
	});

	describe("POST /api/sim/run - execution", () => {
		test("happy path: runs thermal simulation and returns 200 with run and issues", async () => {
			const body = makeSimRunBody({ inputs: makeValidThermalInputs() });
			const res = await harness.post("/api/sim/run", body);
			assertSuccessfulSim(res, {
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
			const res = await harness.post("/api/sim/run", body);
			assertFailedSim(res, "ambientC");
		});
	});

	describe("POST /api/erc/run", () => {
		test("invalid IR returns 400 with validation errors", async () => {
			const res = await harness.post("/api/erc/run", {
				ir: { schemaVersion: 99 },
				commit: COMMIT_SHA,
			});
			assertValidationErrors(res);
		});

		test("valid IR returns 200 with issues list", async () => {
			const res = await harness.post("/api/erc/run", {
				ir: makeValidCircuitIR(),
				commit: COMMIT_SHA,
			});
			assertIssuesList(res);
		});
	});
});
