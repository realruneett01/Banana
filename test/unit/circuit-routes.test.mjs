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
	const pin = (partId, p) => ({ partId, pin: p });
	return [
		{
			id: ids.vcc,
			name: "VCC",
			pins: [pin(ids.v1, "1"), pin(ids.r1, "1")],
		},
		{
			id: ids.mid,
			name: "MID",
			pins: [pin(ids.r1, "2"), pin(ids.d1, "A")],
		},
		{
			id: ids.gnd,
			name: "GND",
			pins: [pin(ids.d1, "K"), pin(ids.v1, "2")],
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

function makePlotVars(specs) {
	return specs.map(([name, type], index) => ({ index, name, type }));
}

function createOpPlot(current) {
	const vMid = current === 0 ? 0 : 1.85;
	const variables = makePlotVars([
		["v(n_vcc)", "voltage"],
		["v(n_mid)", "voltage"],
		["i(v1)", "current"],
		["@r1[i]", "current"],
		["@d1[id]", "current"],
	]);
	return {
		title: "Operating Point",
		plotname: "Operating Point",
		variables,
		points: [[5.0, vMid, -current, current, current]],
	};
}

function createTranPlot() {
	const variables = makePlotVars([
		["time", "time"],
		["v(n_vcc)", "voltage"],
		["v(n_mid)", "voltage"],
		["i(v1)", "current"],
		["@r1[i]", "current"],
		["@d1[id]", "current"],
	]);
	return {
		title: "Transient",
		plotname: "Transient Analysis",
		variables,
		points: [
			[0.0, 0.0, 0.0, 0, 0, 0],
			[0.0001, 5.0, 1.85, -0.00315, 0.00315, 0.00315],
		],
	};
}

function resolveNgspiceCurrent(state, netlist) {
	if (state.cannedCurrent !== null) {
		return state.cannedCurrent;
	}
	return netlist.toLowerCase().includes("broken") ? 0 : 0.00315;
}

function runFakeNgspice(state, netlist) {
	if (state.shouldFail) {
		return { ok: false, error: "Convergence failed", log: state.failLog };
	}
	if (netlist.includes(".tran")) {
		return { ok: true, plots: [createTranPlot()] };
	}
	const current = resolveNgspiceCurrent(state, netlist);
	return { ok: true, plots: [createOpPlot(current)] };
}

function createFakeNgspice(opts = {}) {
	const state = {
		available: opts.available ?? true,
		shouldFail: opts.shouldFail ?? false,
		failLog: opts.failLog ?? "Fatal error: iteration limit reached",
		cannedCurrent: opts.cannedCurrent ?? null,
	};
	return {
		setAvailable: (val) => {
			state.available = val;
		},
		setShouldFail: (val) => {
			state.shouldFail = val;
		},
		setFailLog: (val) => {
			state.failLog = val;
		},
		setCannedCurrent: (val) => {
			state.cannedCurrent = val;
		},
		available: async () => state.available,
		run: async (netlist) => runFakeNgspice(state, netlist),
	};
}

async function startSimApp(fakeNgspice) {
	const app = createApp();
	app.locals.allowLocalRepos = true;
	app.locals.ngspice = fakeNgspice;
	const server = http.createServer(app);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { server, port: server.address().port };
}

const stopSimApp = (server) =>
	new Promise((resolve) => (server ? server.close(resolve) : resolve()));

async function callCircuitApi(port, endpoint, payload) {
	const response = await fetch(
		`http://127.0.0.1:${port}/api/circuit/${endpoint}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		},
	);
	const json = await response.json().catch(() => ({}));
	return { status: response.status, json };
}

const simulate = (port, payload) => callCircuitApi(port, "simulate", payload);
const suggestFaults = (port, payload) =>
	callCircuitApi(port, "suggest-faults", payload);

function assertSuccess(res) {
	assert.equal(res.status, 200);
}

function assertError(res, expectedStatus, expectedError) {
	assert.equal(res.status, expectedStatus);
	if (typeof expectedError === "string") {
		assert.equal(res.json.error, expectedError);
	} else if (expectedError !== undefined) {
		assert.deepEqual(res.json.error, expectedError);
	} else {
		assert.ok(res.json.error);
	}
}

function makeNoisyLog() {
	const initial = [
		"Error in C:\\Users\\runner\\AppData\\Local\\Temp\\circuit.cir: line 4",
		"Secondary in C:/projects/banana/temp.cir: syntax error",
		"Failed reading /tmp/build-1234/netlist.cir: invalid token",
		"In /app/backend/spice.cir: unable to converge",
	];
	const extras = Array.from(
		{ length: 25 },
		(_, i) => `Extra log detail line ${i + 1}`,
	);
	return [...initial, ...extras].join("\n");
}

function assertSanitizedLog(log) {
	assert.ok(!/[a-zA-Z]:[\\/]/.test(log));
	assert.ok(!log.includes("/tmp"));
	assert.ok(!log.includes("/app"));
	assert.ok(log.includes("<path>"));
	assert.equal(log.split("\n").length, 20);
}

function assertLedOvercurrentFix(fixes) {
	assert.ok(Array.isArray(fixes));
	assert.ok(fixes.length > 0);
	const ledFix = fixes.find((f) => f.id.includes("led-overcurrent"));
	assert.ok(ledFix);
	assert.equal(ledFix.risk, "low");
}

function makeValidationCases(ir) {
	const badTran = (stopS, stepS) => ({ type: "tran", stopS, stepS });
	return [
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
			body: { ir, analysis: badTran(2, 0.001) },
		},
		{
			name: "rejects tran stepS < stopS / 10000",
			body: { ir, analysis: badTran(0.1, 1e-7) },
		},
		{
			name: "rejects injectFault failure on invalid pinIndex",
			body: {
				ir,
				fault: { kind: "open_trace", netId: ir.nets[0].id, pinIndex: 99 },
			},
		},
	];
}

const SIMULATOR_STATE_CASES = [
	{
		name: "returns 503 when simulator is unavailable",
		setup: (sim) => sim.setAvailable(false),
		cleanup: (sim) => sim.setAvailable(true),
		expectedStatus: 503,
		expectedError:
			"Circuit simulator (ngspice) is not installed on this server",
	},
	{
		name: "returns 422 when simulator run fails",
		setup: (sim) => sim.setShouldFail(true),
		cleanup: (sim) => sim.setShouldFail(false),
		expectedStatus: 422,
		expectedError: "Convergence failed",
		assertExtra: (json) => assert.ok(json.log.includes("Fatal error")),
	},
];

const FIXES_CASES = [
	{
		name: "healthy result returns empty fixes array",
		cannedCurrent: null,
		check: (fixes) => assert.deepEqual(fixes, []),
	},
	{
		name: "fixes present for an LED overcurrent canned result",
		cannedCurrent: 0.08,
		check: (fixes) => assertLedOvercurrentFix(fixes),
	},
];

describe("circuit-routes", () => {
	let server;
	let port;
	let fakeNgspice;
	const ir = makeBatteryLedIR();

	before(async () => {
		fakeNgspice = createFakeNgspice();
		const started = await startSimApp(fakeNgspice);
		server = started.server;
		port = started.port;
	});

	after(async () => {
		await stopSimApp(server);
	});

	describe("POST /api/circuit/simulate - happy path op", () => {
		test("maps voltages and currents to net and part ids", async () => {
			const res = await simulate(port, { ir });
			assertSuccess(res);
			const [vccNet, midNet, gndNet] = ir.nets;
			const [v1Part, r1Part, d1Part] = ir.parts;

			assert.equal(res.json.nodeVoltages[vccNet.id], 5.0);
			assert.equal(res.json.nodeVoltages[midNet.id], 1.85);
			assert.equal(res.json.nodeVoltages[gndNet.id], 0);

			assert.equal(res.json.partCurrents[v1Part.id], -0.00315);
			assert.equal(res.json.partCurrents[r1Part.id], 0.00315);
			assert.equal(res.json.partCurrents[d1Part.id], 0.00315);
			assert.equal(res.json.fault, null);
			assert.ok(Array.isArray(res.json.warnings));
		});
	});

	describe("POST /api/circuit/simulate - fault injection", () => {
		test("applies open_trace fault, returning zero current and fault info", async () => {
			const fault = {
				kind: "open_trace",
				netId: ir.nets[0].id,
				pinIndex: 0,
			};
			const res = await simulate(port, { ir, fault });
			assertSuccess(res);
			const r1PartId = ir.parts[1].id;
			assert.equal(res.json.partCurrents[r1PartId], 0);

			assert.ok(res.json.fault);
			assert.equal(res.json.fault.kind, "open_trace");
			assert.equal(res.json.fault.info.label, FAULT_INFO.open_trace.label);
			assert.equal(
				res.json.fault.info.plainEnglish,
				FAULT_INFO.open_trace.plainEnglish,
			);
		});
	});

	describe("POST /api/circuit/simulate - validation guards", () => {
		for (const { name, body } of makeValidationCases(ir)) {
			test(name, async () => {
				const res = await simulate(port, body);
				assertError(res, 400);
			});
		}
	});

	describe("POST /api/circuit/simulate - tran series", () => {
		test("returns series data for transient analysis", async () => {
			const res = await simulate(port, {
				ir,
				analysis: { type: "tran", stopS: 0.01, stepS: 0.0001 },
			});
			assertSuccess(res);
			assert.ok(res.json.series);
			assert.deepEqual(res.json.series.time, [0.0, 0.0001]);
			const vccId = ir.nets[0].id;
			assert.deepEqual(res.json.series.nodeVoltages[vccId], [0.0, 5.0]);
		});
	});

	describe("POST /api/circuit/simulate - simulator states", () => {
		for (const tc of SIMULATOR_STATE_CASES) {
			test(tc.name, async () => {
				tc.setup(fakeNgspice);
				try {
					const res = await simulate(port, { ir });
					assertError(res, tc.expectedStatus, tc.expectedError);
					tc.assertExtra?.(res.json);
				} finally {
					tc.cleanup(fakeNgspice);
				}
			});
		}
	});

	describe("POST /api/circuit/simulate - fixes and log sanitization", () => {
		for (const tc of FIXES_CASES) {
			test(tc.name, async () => {
				if (tc.cannedCurrent !== null) {
					fakeNgspice.setCannedCurrent(tc.cannedCurrent);
				}
				try {
					const res = await simulate(port, { ir });
					assertSuccess(res);
					tc.check(res.json.fixes);
				} finally {
					if (tc.cannedCurrent !== null) {
						fakeNgspice.setCannedCurrent(null);
					}
				}
			});
		}

		test("422 log contains no drive letters or /tmp paths and caps at 20 lines", async () => {
			fakeNgspice.setShouldFail(true);
			fakeNgspice.setFailLog(makeNoisyLog());
			try {
				const res = await simulate(port, { ir });
				assertError(res, 422);
				assertSanitizedLog(res.json.log);
			} finally {
				fakeNgspice.setShouldFail(false);
				fakeNgspice.setFailLog("Fatal error: iteration limit reached");
			}
		});
	});

	describe("POST /api/circuit/suggest-faults", () => {
		test("returns suggested faults with metadata for valid IR", async () => {
			const res = await suggestFaults(port, { ir });
			assertSuccess(res);
			assert.ok(Array.isArray(res.json.faults));
			assert.ok(res.json.faults.length > 0);
			for (const fault of res.json.faults) {
				assert.ok(FAULT_KINDS.includes(fault.kind));
				assert.ok(fault.info);
				assert.ok(typeof fault.info.label === "string");
			}
		});

		test("rejects invalid IR with 400", async () => {
			const res = await suggestFaults(port, { ir: {} });
			assertError(res, 400);
		});
	});
});
