import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import {
	applyCorner,
	cornersFor,
	runCorners,
} from "../../backend/src/engine/spice/env-corners.js";
import { parseSiValue } from "../../backend/src/engine/spice/ir-to-spice.js";

function makePart(ref, value, overrides = {}) {
	return {
		id: newId("part"),
		ref,
		value,
		symbol: `Device:${ref.replace(/\d+$/, "")}`,
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeNet(name, pins = []) {
	return {
		id: newId("net"),
		name,
		pins,
	};
}

function makeIR(parts, nets, name = "TestCircuit") {
	return {
		schemaVersion: 1,
		name,
		parts,
		nets,
		constraints: [],
	};
}

function createFakeEngine(runsBehavior = {}) {
	const netlists = [];
	return {
		netlists,
		run: async (netlist) => {
			netlists.push(netlist);
			return {
				ok: runsBehavior.ok ?? true,
				plots: runsBehavior.plots ?? [{ name: "tran", values: [1, 2] }],
				error: runsBehavior.error,
			};
		},
	};
}

function assertCornerProperties(corner, tc, index) {
	if (tc.expectedIds) {
		assert.equal(corner.id, tc.expectedIds[index]);
	}
	if (tc.expectedTemps) {
		assert.equal(corner.tempC, tc.expectedTemps[index]);
	}
	if (tc.expectedScales) {
		assert.equal(corner.valueScale, tc.expectedScales[index]);
	}
	if (tc.expectedSupplyScales) {
		assert.equal(corner.supplyScale, tc.expectedSupplyScales[index]);
	}
}

const CORNERS_TABLE = [
	{
		name: "default 3 corners (tolerancePct: 0)",
		env: { ambientC: { min: 0, max: 70 } },
		options: { tolerancePct: 0, supplyPct: 0 },
		expectedCount: 3,
		expectedIds: ["nominal", "cold", "hot"],
		expectedTemps: [35, 0, 70],
	},
	{
		name: "with tolerance 5 percent -> 5 corners with scales 0.95 and 1.05",
		env: { ambientC: { min: 0, max: 70 } },
		options: { tolerancePct: 5, supplyPct: 0 },
		expectedCount: 5,
		expectedIds: ["nominal", "cold", "hot", "worst-low", "worst-high"],
		expectedScales: [1, 1, 1, 0.95, 1.05],
	},
	{
		name: "default options -> 5 corners with 5% tolerance",
		env: { ambientC: { min: 0, max: 70 } },
		options: undefined,
		expectedCount: 5,
		expectedIds: ["nominal", "cold", "hot", "worst-low", "worst-high"],
		expectedScales: [1, 1, 1, 0.95, 1.05],
	},
	{
		name: "with supply 10 percent -> 7",
		env: { ambientC: { min: 0, max: 70 } },
		options: { tolerancePct: 5, supplyPct: 10 },
		expectedCount: 7,
		expectedIds: [
			"nominal",
			"cold",
			"hot",
			"worst-low",
			"worst-high",
			"supply-low",
			"supply-high",
		],
		expectedSupplyScales: [1, 1, 1, 1, 1, 0.9, 1.1],
	},
	{
		name: "clamping 200 C -> 150",
		env: { ambientC: { min: -100, max: 200 } },
		options: { tolerancePct: 0 },
		expectedCount: 3,
		expectedIds: ["nominal", "cold", "hot"],
		expectedTemps: [50, -55, 150],
	},
	{
		name: "fallback temperature when ambient is absent",
		env: {},
		options: { tolerancePct: 0 },
		expectedCount: 3,
		expectedIds: ["nominal", "cold", "hot"],
		expectedTemps: [25, 25, 25],
	},
];

describe("cornersFor", () => {
	for (const tc of CORNERS_TABLE) {
		test(tc.name, () => {
			const corners = cornersFor(tc.env, tc.options);
			assert.equal(corners.length, tc.expectedCount);
			corners.forEach((c, i) => {
				assertCornerProperties(c, tc, i);
			});
		});
	}
});

const SMALL_NETLIST = [
	"V1 in 0 DC 10",
	"R1 in out 1k",
	"C1 out 0 1u",
	".tran 1u 1m",
	".end",
].join("\n");

function verifyStructure(out) {
	const tempMatches = out.match(/^\.temp\s+/gm) ?? [];
	assert.equal(tempMatches.length, 1);
	const lines = out.split("\n");
	const tempIdx = lines.findIndex((l) => l.startsWith(".temp"));
	const endIdx = lines.findIndex((l) => l.startsWith(".end"));
	assert.equal(tempIdx + 1, endIdx);
}

const APPLY_TABLE = [
	{
		name: "applyCorner on small netlist with scaling and .temp insertion",
		netlist: SMALL_NETLIST,
		corner: {
			id: "corner1",
			label: "Corner 1",
			tempC: 25,
			valueScale: 1.05,
			supplyScale: 1.1,
		},
		checks: [
			{ pattern: /^V1 in 0 DC 11$/m, desc: "V1 DC 11 when supplyScale 1.1" },
			{
				pattern: /^R1 in out 1\.05e3$/m,
				desc: "R1 becomes 1.05e3-equivalent value when scale 1.05",
			},
			{ pattern: /^C1 out 0 1\.05e-6$/m, desc: "C1 value scaled by 1.05" },
			{ pattern: /^\.tran 1u 1m$/m, desc: "tran line unchanged" },
			{ pattern: /^\.temp 25$/m, desc: ".temp line present once" },
			{ pattern: /^\.end$/m, desc: ".end preserved" },
		],
		validateStructure: verifyStructure,
		validateEquivalent: (out) => {
			const r1Line = out.split("\n").find((l) => l.startsWith("R1"));
			const val = parseSiValue(r1Line.split(/\s+/)[3]);
			assert.equal(val, 1050);
		},
	},
	{
		name: "replaces existing .temp line before .end",
		netlist: ["* Title", ".temp 50", "R1 in out 100", ".end"].join("\n"),
		corner: {
			id: "cold",
			label: "Cold",
			tempC: -40,
			valueScale: 1,
			supplyScale: 1,
		},
		checks: [
			{ pattern: /^\.temp -40$/m, desc: "new .temp present" },
			{ pattern: /^R1 in out 1e2$/m, desc: "R1 in exponent form" },
		],
		validateStructure: (out) => {
			assert.equal(out.includes(".temp 50"), false);
			const matches = out.match(/^\.temp\s+/gm) ?? [];
			assert.equal(matches.length, 1);
		},
	},
	{
		name: "scales plain DC voltage without DC keyword and scales inductor",
		netlist: ["V1 in 0 5", "L1 in out 10u", ".end"].join("\n"),
		corner: {
			id: "high",
			label: "High",
			tempC: 70,
			valueScale: 1.05,
			supplyScale: 1.2,
		},
		checks: [
			{ pattern: /^V1 in 0 6$/m, desc: "5 * 1.2 = 6" },
			{ pattern: /^L1 in out 1\.05e-5$/m, desc: "L1 scaled by 1.05" },
		],
	},
];

describe("applyCorner", () => {
	for (const tc of APPLY_TABLE) {
		test(tc.name, () => {
			const out = applyCorner(tc.netlist, tc.corner);
			for (const check of tc.checks) {
				assert.match(out, check.pattern, check.desc);
			}
			if (tc.validateStructure) {
				tc.validateStructure(out);
			}
			if (tc.validateEquivalent) {
				tc.validateEquivalent(out);
			}
		});
	}
});

function makeCircuitIR() {
	const p1 = makePart("V1", "10", { props: { voltage: "10" } });
	const p2 = makePart("R1", "1k");
	const n1 = makeNet("in", [
		{ partId: p1.id, pin: "1" },
		{ partId: p2.id, pin: "1" },
	]);
	const n0 = makeNet("GND", [
		{ partId: p1.id, pin: "2" },
		{ partId: p2.id, pin: "2" },
	]);
	return makeIR([p1, p2], [n1, n0]);
}

const RUN_CORNERS_TABLE = [
	{
		name: "calls engine once per corner sequentially and returns success",
		env: { ambientC: { min: 0, max: 70 } },
		options: { tolerancePct: 5, supplyPct: 0 },
		engineBehavior: { ok: true, plots: [{ name: "sim" }] },
		expectedOk: true,
		expectedCalls: 5,
		validateResult: (res) => {
			assert.equal(res.ok, true);
			assert.equal(res.corners.length, 5);
			res.corners.forEach((c) => {
				assert.equal(c.ok, true);
				assert.ok(Array.isArray(c.plots));
			});
		},
	},
	{
		name: "handles engine failure on a corner run",
		env: { ambientC: { min: 0, max: 70 } },
		options: { tolerancePct: 0, supplyPct: 0 },
		engineBehavior: { ok: false, error: "Singular matrix" },
		expectedOk: false,
		expectedCalls: 3,
		validateResult: (res) => {
			assert.equal(res.ok, false);
			assert.equal(res.corners.length, 3);
			res.corners.forEach((c) => {
				assert.equal(c.ok, false);
				assert.equal(c.error, "Singular matrix");
			});
		},
	},
];

describe("runCorners", () => {
	for (const tc of RUN_CORNERS_TABLE) {
		test(tc.name, async () => {
			const engine = createFakeEngine(tc.engineBehavior);
			const ir = makeCircuitIR();
			const res = await runCorners({
				ir,
				env: tc.env,
				engine,
				analysis: { type: "tran", stepS: "1u", stopS: "1m" },
				options: tc.options,
			});
			assert.equal(engine.netlists.length, tc.expectedCalls);
			tc.validateResult(res);
		});
	}

	test("returns ok: false with errors when irToSpice fails", async () => {
		const engine = createFakeEngine();
		const res = await runCorners({
			ir: { schemaVersion: 999 },
			env: { ambientC: { min: 0, max: 70 } },
			engine,
		});
		assert.equal(res.ok, false);
		assert.ok(Array.isArray(res.errors));
		assert.equal(engine.netlists.length, 0);
	});
});
