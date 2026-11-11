import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import { newId } from "../../backend/src/engine/ids.js";
import {
	FAULT_INFO,
	FAULT_KINDS,
	injectFault,
	suggestFaults,
} from "../../backend/src/engine/sim/fault-inject.js";

const PART_SPECS = [
	["BT1", "9V", "Device:Battery", "Battery:BatteryHolder_Keystone_2460_1xAA"],
	["R1", "330", "Device:R", "Resistor_SMD:R_0603_1608Metric"],
	["D1", "Red", "Device:LED", "LED_SMD:LED_0805_2012Metric"],
];

function buildNets(btId, rId, ledId) {
	return [
		["VCC", btId, "1", rId, "1"],
		["NET_LED", rId, "2", ledId, "1"],
		["GND", ledId, "2", btId, "2"],
	].map(([name, pA, pinA, pB, pinB]) => ({
		id: newId("net"),
		name,
		pins: [
			{ partId: pA, pin: pinA },
			{ partId: pB, pin: pinB },
		],
	}));
}

function buildTestCircuit() {
	const [bt, r, led] = PART_SPECS.map(([ref, value, symbol, footprint]) => ({
		id: newId("part"),
		ref,
		value,
		symbol,
		footprint,
		props: {},
	}));
	const nets = buildNets(bt.id, r.id, led.id);
	const ir = {
		schemaVersion: 1,
		name: "LedCircuit",
		parts: [bt, r, led],
		nets,
		constraints: [
			{ id: "c_rail_vcc", kind: "rail", target: "VCC", value: 9, unit: "V" },
		],
	};
	return { ir, bt, r, led, netVcc: nets[0], netMid: nets[1], netGnd: nets[2] };
}

function assertValidFault(ir, fault) {
	const res = injectFault(ir, fault);
	assert.equal(res.ok, true);
	assert.equal(validateCircuitIR(res.ir).ok, true);
	return res;
}

function suggestedKinds(ir) {
	return suggestFaults(ir).map((s) => s.kind);
}

describe("fault-inject constants", () => {
	test("exports FAULT_KINDS with 8 exact kinds", () => {
		const expected = [
			"open_trace",
			"short_nets",
			"part_open",
			"part_short",
			"reverse_polarity",
			"value_drift",
			"overvoltage",
			"missing_ground",
		];
		assert.deepEqual(FAULT_KINDS, expected);
	});

	test("exports FAULT_INFO with descriptions for all kinds", () => {
		for (const kind of FAULT_KINDS) {
			const info = FAULT_INFO[kind];
			assert.ok(info, `Missing info for ${kind}`);
			assert.equal(typeof info.label, "string");
			assert.equal(typeof info.plainEnglish, "string");
			assert.equal(typeof info.example, "string");
			assert.ok(info.plainEnglish.length > 10);
		}
	});
});

describe("injectFault valid kinds on test circuit", () => {
	test("open_trace splits net and creates broken net", () => {
		const c = buildTestCircuit();
		const res = assertValidFault(c.ir, {
			kind: "open_trace",
			netId: c.netVcc.id,
			pinIndex: 0,
		});
		assert.equal(res.ir.nets.length, 4);
		const brokenNet = res.ir.nets.find((n) => n.name === "VCC_BROKEN");
		assert.ok(brokenNet);
		assert.deepEqual(brokenNet.pins, [{ partId: c.bt.id, pin: "1" }]);
	});

	test("short_nets merges netB into netA", () => {
		const c = buildTestCircuit();
		const res = assertValidFault(c.ir, {
			kind: "short_nets",
			netA: c.netVcc.id,
			netB: c.netMid.id,
		});
		assert.equal(res.ir.nets.length, 2);
		const merged = res.ir.nets.find((n) => n.id === c.netVcc.id);
		assert.equal(merged?.pins.length, 4);
	});

	test("part_open disconnects part from all nets", () => {
		const c = buildTestCircuit();
		const res = assertValidFault(c.ir, { kind: "part_open", partId: c.r.id });
		const stillConnected = res.ir.nets.some((net) =>
			net.pins.some((p) => p.partId === c.r.id),
		);
		assert.equal(stillConnected, false);
	});

	test("part_short merges all nets touched by part", () => {
		const c = buildTestCircuit();
		const res = assertValidFault(c.ir, { kind: "part_short", partId: c.r.id });
		assert.equal(res.ir.nets.length, 2);
		assert.deepEqual(
			res.affected.netIds.sort(),
			[c.netVcc.id, c.netMid.id].sort(),
		);
	});

	test("reverse_polarity swaps pins 1 and 2", () => {
		const c = buildTestCircuit();
		const res = assertValidFault(c.ir, {
			kind: "reverse_polarity",
			partId: c.led.id,
		});
		const pinFor = (netId) =>
			res.ir.nets
				.find((n) => n.id === netId)
				?.pins.find((p) => p.partId === c.led.id)?.pin;
		assert.deepEqual([pinFor(c.netMid.id), pinFor(c.netGnd.id)], ["2", "1"]);
	});

	const SCALED_VALUE_CASES = [
		{
			name: "value_drift scales part value with SI suffix",
			fault: (c) => ({ kind: "value_drift", partId: c.r.id, factor: 2 }),
			partId: (c) => c.r.id,
			expected: "660",
		},
		{
			name: "overvoltage scales power source value",
			fault: (c) => ({ kind: "overvoltage", partId: c.bt.id, factor: 1.5 }),
			partId: (c) => c.bt.id,
			expected: "13.5V",
		},
	];

	for (const tc of SCALED_VALUE_CASES) {
		test(tc.name, () => {
			const c = buildTestCircuit();
			const res = assertValidFault(c.ir, tc.fault(c));
			const targetId = tc.partId(c);
			assert.equal(
				res.ir.parts.find((p) => p.id === targetId)?.value,
				tc.expected,
			);
		});
	}

	test("missing_ground renames ground net", () => {
		const c = buildTestCircuit();
		const res = assertValidFault(c.ir, { kind: "missing_ground" });
		assert.equal(
			res.ir.nets.find((n) => n.name === "GND"),
			undefined,
		);
		assert.ok(res.ir.nets.find((n) => n.name === "GND_DISCONNECTED"));
	});

	test("injectFault never mutates the input IR", () => {
		const { ir, r } = buildTestCircuit();
		const snapshot = JSON.stringify(ir);
		injectFault(ir, { kind: "value_drift", partId: r.id, factor: 5 });
		assert.equal(JSON.stringify(ir), snapshot);
	});
});

describe("injectFault invalid parameter handling", () => {
	const c = buildTestCircuit();
	const singleNetIR = { ...c.ir, nets: [c.netVcc] };
	const invalidCases = [
		{ name: "null ir", ir: null, fault: { kind: "missing_ground" } },
		{ name: "null fault", ir: {}, fault: null },
		{ name: "unknown kind", ir: {}, fault: { kind: "magic_smoke" } },
		{
			name: "open_trace missing net",
			ir: c.ir,
			fault: { kind: "open_trace", netId: "net_missing", pinIndex: 0 },
		},
		{
			name: "open_trace invalid pinIndex",
			ir: c.ir,
			fault: { kind: "open_trace", netId: c.netVcc.id, pinIndex: 99 },
		},
		{
			name: "short_nets same net",
			ir: c.ir,
			fault: { kind: "short_nets", netA: c.netVcc.id, netB: c.netVcc.id },
		},
		{
			name: "part_open missing part",
			ir: c.ir,
			fault: { kind: "part_open", partId: "part_unknown" },
		},
		{
			name: "part_short with 1 net part",
			ir: singleNetIR,
			fault: { kind: "part_short", partId: c.r.id },
		},
		{
			name: "value_drift invalid factor",
			ir: c.ir,
			fault: { kind: "value_drift", partId: c.r.id, factor: -2 },
		},
		{
			name: "overvoltage invalid factor",
			ir: c.ir,
			fault: { kind: "overvoltage", partId: c.bt.id, factor: 0 },
		},
		{
			name: "missing_ground with no gnd net",
			ir: singleNetIR,
			fault: { kind: "missing_ground" },
		},
	];

	for (const tc of invalidCases) {
		test(`rejects ${tc.name}`, () => {
			const res = injectFault(tc.ir, tc.fault);
			assert.equal(res.ok, false);
			assert.equal(typeof res.error, "string");
		});
	}
});

describe("suggestFaults functionality", () => {
	test("suggests all applicable faults on test circuit", () => {
		const { ir } = buildTestCircuit();
		const suggestions = suggestFaults(ir);

		assert.ok(Array.isArray(suggestions));
		assert.equal(suggestions.length, 8);
		const kinds = new Set(suggestions.map((s) => s.kind));
		for (const k of FAULT_KINDS) {
			assert.ok(kinds.has(k), `Missing suggestion for ${k}`);
		}

		for (const suggestion of suggestions) {
			assertValidFault(ir, suggestion);
		}
	});

	test("omits missing_ground when no GND net exists", () => {
		const { ir } = buildTestCircuit();
		ir.nets = ir.nets.filter((n) => n.name !== "GND");
		assert.ok(!suggestedKinds(ir).includes("missing_ground"));
	});

	test("omits overvoltage when no source part exists", () => {
		const { ir, bt } = buildTestCircuit();
		ir.parts = ir.parts.filter((p) => p.id !== bt.id);
		ir.nets = ir.nets.map((n) => ({
			...n,
			pins: n.pins.filter((p) => p.partId !== bt.id),
		}));
		assert.equal(suggestedKinds(ir).includes("overvoltage"), false);
	});

	test("returns empty list on invalid input", () => {
		assert.deepEqual([suggestFaults(null), suggestFaults({})], [[], []]);
	});
});
