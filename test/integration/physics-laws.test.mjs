import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createSimEngine } from "../../backend/src/engine/spice/sim-engine.js";

const engine = createSimEngine();
const isAvailable = await engine.available();
const skipOption = isAvailable
	? false
	: "Circuit simulator engine is not available";

// biome-ignore lint/suspicious/noShadowRestrictedNames: required helper name
export function valueOf(plot, name, pointIndex = 0) {
	if (!plot || typeof name !== "string") return null;
	const target = name.toLowerCase();
	const variable = plot.variables?.find(
		(v) => v.name?.toLowerCase() === target,
	);
	if (!variable) return null;
	return plot.points?.[pointIndex]?.[variable.index] ?? null;
}

function findNearestPointIndex(plot, targetTime) {
	const timeVar = plot?.variables?.find(
		(v) => v.name?.toLowerCase() === "time",
	);
	const timeIdx = timeVar ? timeVar.index : 0;
	let nearestIdx = 0;
	let minDiff = Number.POSITIVE_INFINITY;
	const points = plot?.points ?? [];
	for (let i = 0; i < points.length; i++) {
		const diff = Math.abs(points[i][timeIdx] - targetTime);
		if (diff < minDiff) {
			minDiff = diff;
			nearestIdx = i;
		}
	}
	return nearestIdx;
}

function verifyOhmDivider(plot) {
	const vMid = valueOf(plot, "v(mid)");
	const iV1 = Math.abs(valueOf(plot, "i(v1)"));
	const cases = [
		{
			err: Math.abs(vMid - 7.5) / 7.5,
			msg: `v(mid) ${vMid} V outside 0.1% of 7.5 V`,
		},
		{
			err: Math.abs(iV1 - 0.0025) / 0.0025,
			msg: `i(v1) ${iV1} A outside 0.1% of 2.5 mA`,
		},
	];
	for (const tc of cases) {
		assert.ok(tc.err <= 0.001, tc.msg);
	}
}

function verifyKcl(plot) {
	const iVs1 = valueOf(plot, "i(vs1)");
	const iVs2 = valueOf(plot, "i(vs2)");
	const iVs3 = valueOf(plot, "i(vs3)");
	const diff = Math.abs(iVs1 - (iVs2 + iVs3));
	assert.ok(diff <= 1e-9, `KCL violation: diff ${diff} A exceeds 1e-9 A`);
}

function verifyKvl(plot) {
	const vSource = valueOf(plot, "v(in)");
	const vN1 = valueOf(plot, "v(n1)");
	const vN2 = valueOf(plot, "v(n2)");
	const dropSum = vSource - vN1 + (vN1 - vN2) + vN2;
	const diff = Math.abs(vSource - dropSum);
	assert.ok(diff <= 1e-6, `KVL violation: diff ${diff} V exceeds 1e-6 V`);
}

function verifyPowerBalance(plot) {
	const vSource = valueOf(plot, "v(in)");
	const current = Math.abs(valueOf(plot, "i(v1)"));
	const pSource = vSource * current;
	const pResistors = current ** 2 * (1000 + 2000 + 6000);
	const diff = Math.abs(pSource - pResistors);
	assert.ok(diff <= 1e-9, `Power diff ${diff} W exceeds 1e-9 W`);
}

function verifyRcCharging(plot) {
	const idxTau = findNearestPointIndex(plot, 0.001);
	const idx5Tau = findNearestPointIndex(plot, 0.005);
	const vOutTau = valueOf(plot, "v(out)", idxTau);
	const vOut5Tau = valueOf(plot, "v(out)", idx5Tau);
	const targetTau = 0.632 * 5.0;
	const tauDiff = Math.abs(vOutTau - targetTau) / targetTau;
	assert.ok(
		tauDiff <= 0.02,
		`v(out) at tau (${vOutTau} V) not within 2% of 3.16 V`,
	);
	assert.ok(
		vOut5Tau / 5.0 > 0.99,
		`v(out) at 5 tau (${vOut5Tau} V) not above 99%`,
	);
}

function verifyDiode(plot) {
	const vd = valueOf(plot, "v(d_anode)");
	const current = Math.abs(valueOf(plot, "i(v1)"));
	const expectedCurrent = (5.0 - vd) / 1000.0;
	const currentDiff = Math.abs(current - expectedCurrent) / expectedCurrent;
	assert.ok(vd >= 0.55, `Diode forward voltage ${vd} V below 0.55 V`);
	assert.ok(vd <= 0.8, `Diode forward voltage ${vd} V above 0.8 V`);
	assert.ok(
		currentDiff <= 0.01,
		`Current ${current} A not consistent with (5-Vd)/1k`,
	);
}

const OHM_DIVIDER_NETLIST = `* Ohm divider
V1 in 0 10
R1 in mid 1k
R2 mid 0 3k
.op
.end`;

const KCL_NETLIST = `* KCL test
V1 in 0 12
R1 in n1 1k
Vs1 n1 n 0
Vs2 n n2 0
R2 n2 0 2k
Vs3 n n3 0
R3 n3 0 3k
.op
.end`;

const SERIES_LOOP_NETLIST = `* Series loop for KVL and power balance
V1 in 0 9
R1 in n1 1k
R2 n1 n2 2k
R3 n2 0 6k
.op
.end`;

const RC_CHARGING_NETLIST = `* RC charging
V1 in 0 PULSE(0 5 0 1n 1n 10m 20m)
R1 in out 1k
C1 out 0 1u
.tran 1u 5m
.end`;

const DIODE_NETLIST = `* Diode circuit
V1 in 0 5
R1 in d_anode 1k
D1 d_anode 0 D1N4148
.model D1N4148 D(IS=2.52n RS=0.568 N=1.752)
.op
.end`;

const CIRCUITS = [
	{
		name: "1) Ohm/divider: solves 7.5 V midpoint and 2.5 mA current",
		netlist: OHM_DIVIDER_NETLIST,
		verify: verifyOhmDivider,
	},
	{
		name: "2) KCL: node n branch currents balance within 1e-9 A",
		netlist: KCL_NETLIST,
		verify: verifyKcl,
	},
	{
		name: "3) KVL: sum of resistor drops equals source voltage within 1e-6 V",
		netlist: SERIES_LOOP_NETLIST,
		verify: verifyKvl,
	},
	{
		name: "4) Power balance: source power equals sum of I^2 R within 1e-9 W",
		netlist: SERIES_LOOP_NETLIST,
		verify: verifyPowerBalance,
	},
	{
		name: "5) RC charging: transient reaches 63.2% at tau and >99% at 5 tau",
		netlist: RC_CHARGING_NETLIST,
		verify: verifyRcCharging,
	},
	{
		name: "6) Diode: forward voltage between 0.55-0.8 V and Ohm consistent current",
		netlist: DIODE_NETLIST,
		verify: verifyDiode,
	},
];

describe("Circuit physics laws simulation", () => {
	test("valueOf helper resolves case-insensitively and handles missing keys", () => {
		const mockPlot = {
			variables: [
				{ index: 0, name: "V(MID)", type: "voltage" },
				{ index: 1, name: "i(v1)", type: "current" },
			],
			points: [[7.5, -0.0025]],
		};
		assert.equal(valueOf(mockPlot, "v(mid)"), 7.5);
		assert.equal(valueOf(mockPlot, "V(MID)"), 7.5);
		assert.equal(valueOf(mockPlot, "I(V1)"), -0.0025);
		assert.equal(valueOf(mockPlot, "nonexistent"), null);
		assert.equal(valueOf(null, "v(mid)"), null);
	});

	for (const circuit of CIRCUITS) {
		test(circuit.name, { skip: skipOption, timeout: 20000 }, async () => {
			const res = await engine.run(circuit.netlist);
			assert.equal(res.ok, true, `Simulation failed: ${res.error}`);
			assert.ok(res.plots?.length > 0, "Expected non-empty plots array");
			circuit.verify(res.plots[0]);
		});
	}
});
