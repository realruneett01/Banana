import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createApp } from "../../backend/src/app.js";
import { newId } from "../../backend/src/engine/ids.js";
import {
	FAULT_INFO,
	FAULT_KINDS,
} from "../../backend/src/engine/sim/fault-inject.js";

function makeCircuitParts(v1, r1, d1) {
	return [
		{
			id: v1,
			ref: "V1",
			value: "5V",
			symbol: "Source:V",
			footprint: "Pkg:V",
			props: { voltage: "5V" },
		},
		{
			id: r1,
			ref: "R1",
			value: "1k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0603",
			props: {},
		},
		{
			id: d1,
			ref: "D1",
			value: "RED",
			symbol: "Device:LED",
			footprint: "LED_SMD:LED_0805",
			props: {},
		},
	];
}

function makeCircuitNets(ids) {
	return [
		{
			id: ids.vcc,
			name: "VCC",
			pins: [
				{ partId: ids.v1, pin: "1" },
				{ partId: ids.r1, pin: "1" },
			],
		},
		{
			id: ids.mid,
			name: "MID",
			pins: [
				{ partId: ids.r1, pin: "2" },
				{ partId: ids.d1, pin: "A" },
			],
		},
		{
			id: ids.gnd,
			name: "GND",
			pins: [
				{ partId: ids.d1, pin: "K" },
				{ partId: ids.v1, pin: "2" },
			],
		},
	];
}

function makeBatteryLedIR() {
	const [v1, r1, d1] = [newId("part"), newId("part"), newId("part")];
	const [vcc, mid, gnd] = [newId("net"), newId("net"), newId("net")];
	return {
		schemaVersion: 1,
		name: "BatteryLedCircuit",
		parts: makeCircuitParts(v1, r1, d1),
		nets: makeCircuitNets({ v1, r1, d1, vcc, mid, gnd }),
		constraints: [],
	};
}

function createOpPlot(current) {
	const vMid = current === 0 ? 0 : 1.85;
	return {
		title: "Operating Point",
		plotname: "Operating Point",
		variables: [
			{ index: 0, name: "v(n_vcc)", type: "voltage" },
			{ index: 1, name: "v(n_mid)", type: "voltage" },
			{ index: 2, name: "i(v1)", type: "current" },
			{ index: 3, name: "@r1[i]", type: "current" },
			{ index: 4, name: "@d1[id]", type: "current" },
		],
		points: [[5.0, vMid, -current, current, current]],
	};
}

function createTranPlot() {
	return {
		title: "Transient",
		plotname: "Transient Analysis",
		variables: [
			{ index: 0, name: "time", type: "time" },
			{ index: 1, name: "v(n_vcc)", type: "voltage" },
			{ index: 2, name: "v(n_mid)", type: "voltage" },
			{ index: 3, name: "i(v1)", type: "current" },
			{ index: 4, name: "@r1[i]", type: "current" },
			{ index: 5, name: "@d1[id]", type: "current" },
		],
		points: [
			[0.0, 0.0, 0.0, 0, 0, 0],
			[0.0001, 5.0, 1.85, -0.00315, 0.00315, 0.00315],
		],
	};
}

function createFakeNgspice(opts = {}) {
	const state = {
		available: opts.available ?? true,
		shouldFail: opts.shouldFail ?? false,
	};
	return {
		setAvailable: (val) => {
			state.available = val;
		},
		setShouldFail: (val) => {
			state.shouldFail = val;
		},
		available: async () => state.available,
		run: async (netlist) => {
			if (state.shouldFail) {
				return {
					ok: false,
					error: "Convergence failed",
					log: "Fatal error: iteration limit reached",
				};
			}
			if (netlist.includes(".tran")) {
				return { ok: true, plots: [createTranPlot()] };
			}
			const isBroken = netlist.toLowerCase().includes("broken");
			const current = isBroken ? 0 : 0.00315;
			return { ok: true, plots: [createOpPlot(current)] };
		},
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

async function postJson(port, path, body) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

describe("circuit-routes", () => {
	let server;
	let port;
	let fakeNgspice;
	const ir = makeBatteryLedIR();

	before(async () => {
		const app = createApp();
		app.locals.allowLocalRepos = true;
		fakeNgspice = createFakeNgspice();
		app.locals.ngspice = fakeNgspice;

		const started = await bootServer(app);
		server = started.server;
		port = started.port;
	});

	after(async () => {
		await shutdownServer(server);
	});

	describe("POST /api/circuit/simulate - happy path op", () => {
		test("maps voltages and currents to net and part ids", async () => {
			const { status, json } = await postJson(port, "/api/circuit/simulate", {
				ir,
			});
			assert.equal(status, 200);
			const [vccNet, midNet, gndNet] = ir.nets;
			const [v1Part, r1Part, d1Part] = ir.parts;

			assert.equal(json.nodeVoltages[vccNet.id], 5.0);
			assert.equal(json.nodeVoltages[midNet.id], 1.85);
			assert.equal(json.nodeVoltages[gndNet.id], 0);

			assert.equal(json.partCurrents[v1Part.id], -0.00315);
			assert.equal(json.partCurrents[r1Part.id], 0.00315);
			assert.equal(json.partCurrents[d1Part.id], 0.00315);
			assert.equal(json.fault, null);
			assert.ok(Array.isArray(json.warnings));
		});
	});

	describe("POST /api/circuit/simulate - fault injection", () => {
		test("applies open_trace fault, returning zero current and fault info", async () => {
			const fault = {
				kind: "open_trace",
				netId: ir.nets[0].id,
				pinIndex: 0,
			};
			const { status, json } = await postJson(port, "/api/circuit/simulate", {
				ir,
				fault,
			});
			assert.equal(status, 200);
			const r1PartId = ir.parts[1].id;
			assert.equal(json.partCurrents[r1PartId], 0);

			assert.ok(json.fault);
			assert.equal(json.fault.kind, "open_trace");
			assert.equal(json.fault.info.label, FAULT_INFO.open_trace.label);
			assert.equal(
				json.fault.info.plainEnglish,
				FAULT_INFO.open_trace.plainEnglish,
			);
		});
	});

	describe("POST /api/circuit/simulate - validation guards", () => {
		const invalidCases = [
			{
				name: "rejects invalid IR schema",
				body: { ir: { schemaVersion: 99 } },
			},
			{
				name: "rejects unknown fault kind",
				body: { ir, fault: { kind: "melt_pcb" } },
			},
			{
				name: "rejects invalid analysis type",
				body: { ir, analysis: { type: "quantum" } },
			},
			{
				name: "rejects tran stopS > 1",
				body: { ir, analysis: { type: "tran", stopS: 2, stepS: 0.001 } },
			},
			{
				name: "rejects tran stepS < stopS / 10000",
				body: { ir, analysis: { type: "tran", stopS: 0.1, stepS: 1e-7 } },
			},
			{
				name: "rejects injectFault failure on invalid pinIndex",
				body: {
					ir,
					fault: { kind: "open_trace", netId: ir.nets[0].id, pinIndex: 99 },
				},
			},
		];

		for (const { name, body } of invalidCases) {
			test(name, async () => {
				const { status, json } = await postJson(
					port,
					"/api/circuit/simulate",
					body,
				);
				assert.equal(status, 400);
				assert.ok(json.error);
			});
		}
	});

	describe("POST /api/circuit/simulate - tran series", () => {
		test("returns series data for transient analysis", async () => {
			const { status, json } = await postJson(port, "/api/circuit/simulate", {
				ir,
				analysis: { type: "tran", stopS: 0.01, stepS: 0.0001 },
			});
			assert.equal(status, 200);
			assert.ok(json.series);
			assert.deepEqual(json.series.time, [0.0, 0.0001]);
			const vccId = ir.nets[0].id;
			assert.deepEqual(json.series.nodeVoltages[vccId], [0.0, 5.0]);
		});
	});

	describe("POST /api/circuit/simulate - simulator states", () => {
		test("returns 503 when simulator is unavailable", async () => {
			fakeNgspice.setAvailable(false);
			try {
				const { status, json } = await postJson(port, "/api/circuit/simulate", {
					ir,
				});
				assert.equal(status, 503);
				assert.equal(
					json.error,
					"Circuit simulator (ngspice) is not installed on this server",
				);
			} finally {
				fakeNgspice.setAvailable(true);
			}
		});

		test("returns 422 when simulator run fails", async () => {
			fakeNgspice.setShouldFail(true);
			try {
				const { status, json } = await postJson(port, "/api/circuit/simulate", {
					ir,
				});
				assert.equal(status, 422);
				assert.equal(json.error, "Convergence failed");
				assert.ok(json.log.includes("Fatal error"));
			} finally {
				fakeNgspice.setShouldFail(false);
			}
		});
	});

	describe("POST /api/circuit/suggest-faults", () => {
		test("returns suggested faults with metadata for valid IR", async () => {
			const { status, json } = await postJson(
				port,
				"/api/circuit/suggest-faults",
				{ ir },
			);
			assert.equal(status, 200);
			assert.ok(Array.isArray(json.faults));
			assert.ok(json.faults.length > 0);
			for (const fault of json.faults) {
				assert.ok(FAULT_KINDS.includes(fault.kind));
				assert.ok(fault.info);
				assert.ok(typeof fault.info.label === "string");
			}
		});

		test("rejects invalid IR with 400", async () => {
			const { status, json } = await postJson(
				port,
				"/api/circuit/suggest-faults",
				{ ir: {} },
			);
			assert.equal(status, 400);
			assert.ok(json.error);
		});
	});
});
