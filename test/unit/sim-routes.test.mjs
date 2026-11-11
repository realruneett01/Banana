import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import { SIM_KINDS } from "../../backend/src/engine/sim/run-sim.js";

function makeValidEnv(overrides = {}) {
	return {
		id: newId("env"),
		name: "Nominal",
		ambientC: { min: -10, max: 25 },
		humidityPct: { min: 10, max: 90 },
		altitudeM: 0,
		airflowMs: 0,
		...overrides,
	};
}

function makeValidThermalInputs() {
	return {
		ir: {
			parts: [
				{
					id: newId("part"),
					ref: "U1",
					value: "LDO",
					symbol: "Reg:LDO",
					footprint: "Pkg:SOT-223",
					props: { powerW: 3.0, thetaJA: 50, tjMaxC: 125 },
				},
			],
		},
	};
}

function makeValidCircuitIR() {
	const part1Id = newId("part");
	const part2Id = newId("part");
	return {
		schemaVersion: 1,
		name: "TestCircuit",
		parts: [
			{
				id: part1Id,
				ref: "R1",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0603",
				props: {},
			},
			{
				id: part2Id,
				ref: "R2",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0603",
				props: {},
			},
		],
		nets: [
			{
				id: newId("net"),
				name: "VCC",
				pins: [
					{ partId: part1Id, pin: "1" },
					{ partId: part2Id, pin: "1" },
				],
			},
		],
		constraints: [],
	};
}

function listen(server) {
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve(port);
		});
	});
}

function closeServer(server) {
	return new Promise((resolve) => server.close(resolve));
}

async function postJson(port, path, body) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

async function getJson(port, path) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`);
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

describe("sim-routes and erc-routes", () => {
	let server;
	let port;

	before(async () => {
		const app = createApp();
		server = http.createServer(app);
		port = await listen(server);
	});

	after(async () => {
		if (server) {
			await closeServer(server);
		}
	});

	describe("GET /api/sim/kinds", () => {
		test("returns list of supported simulation kinds", async () => {
			const { status, json } = await getJson(port, "/api/sim/kinds");
			assert.equal(status, 200);
			assert.deepEqual(json.kinds, SIM_KINDS);
		});
	});

	describe("POST /api/sim/run - validation guards", () => {
		const badCases = [
			{
				name: "rejects unknown simulation kind",
				body: {
					kind: "unknown-kind",
					commit: "a1b2c3d4e5f6",
					env: makeValidEnv(),
					inputs: {},
				},
			},
			{
				name: "rejects short commit ref (< 7 chars)",
				body: {
					kind: "thermal",
					commit: "123456",
					env: makeValidEnv(),
					inputs: {},
				},
			},
			{
				name: "rejects long commit ref (> 40 chars)",
				body: {
					kind: "thermal",
					commit: "a".repeat(41),
					env: makeValidEnv(),
					inputs: {},
				},
			},
			{
				name: "rejects non-hex commit ref",
				body: {
					kind: "thermal",
					commit: "not-a-valid-hex-commit!",
					env: makeValidEnv(),
					inputs: {},
				},
			},
			{
				name: "rejects non-object env",
				body: {
					kind: "thermal",
					commit: "a1b2c3d4e5f6",
					env: "not-an-object",
					inputs: {},
				},
			},
			{
				name: "rejects non-object inputs",
				body: {
					kind: "thermal",
					commit: "a1b2c3d4e5f6",
					env: makeValidEnv(),
					inputs: "not-an-object",
				},
			},
			{
				name: "rejects null inputs",
				body: {
					kind: "thermal",
					commit: "a1b2c3d4e5f6",
					env: makeValidEnv(),
					inputs: null,
				},
			},
		];

		for (const tc of badCases) {
			test(tc.name, async () => {
				const { status, json } = await postJson(port, "/api/sim/run", tc.body);
				assert.equal(status, 400);
				assert.ok(typeof json.error === "string");
			});
		}
	});

	describe("POST /api/sim/run - execution", () => {
		test("happy path: runs thermal simulation and returns 200 with run and issues", async () => {
			const body = {
				kind: "thermal",
				commit: "a1b2c3d4e5f6",
				env: makeValidEnv(),
				inputs: makeValidThermalInputs(),
			};
			const { status, json } = await postJson(port, "/api/sim/run", body);
			assert.equal(status, 200);
			assert.equal(json.run.status, "done");
			assert.equal(json.run.kind, "thermal");
			assert.equal(json.run.commit, "a1b2c3d4e5f6");
			assert.ok(Array.isArray(json.issues));
		});

		test("failed simulation returns 422 with error and run", async () => {
			const body = {
				kind: "thermal",
				commit: "a1b2c3d4e5f6",
				env: makeValidEnv({ ambientC: { min: 40, max: 20 } }),
				inputs: makeValidThermalInputs(),
			};
			const { status, json } = await postJson(port, "/api/sim/run", body);
			assert.equal(status, 422);
			assert.equal(json.run.status, "failed");
			assert.ok(typeof json.error === "string");
			assert.ok(json.error.includes("ambientC"));
		});
	});

	describe("POST /api/erc/run", () => {
		test("invalid IR returns 400 with validation errors", async () => {
			const body = {
				ir: { schemaVersion: 99 },
				commit: "a1b2c3d4e5f6",
			};
			const { status, json } = await postJson(port, "/api/erc/run", body);
			assert.equal(status, 400);
			assert.ok(typeof json.error === "string");
			assert.ok(Array.isArray(json.errors));
			assert.ok(json.errors.length > 0);
		});

		test("valid IR returns 200 with issues list", async () => {
			const body = {
				ir: makeValidCircuitIR(),
				commit: "a1b2c3d4e5f6",
			};
			const { status, json } = await postJson(port, "/api/erc/run", body);
			assert.equal(status, 200);
			assert.ok(Array.isArray(json.issues));
		});
	});
});
