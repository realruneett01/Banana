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

function makeBatteryPart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "BT1",
		value: "9V",
		symbol: "Device:Battery",
		footprint: "Battery:BatteryHolder_Keystone_2460_1xAA",
		props: {},
		...overrides,
	};
}

function makeResistorPart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "R1",
		value: "330",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0603_1608Metric",
		props: {},
		...overrides,
	};
}

function makeLedPart(overrides = {}) {
	return {
		id: newId("part"),
		ref: "D1",
		value: "Red",
		symbol: "Device:LED",
		footprint: "LED_SMD:LED_0805_2012Metric",
		props: {},
		...overrides,
	};
}

function buildTestNets(btId, rId, ledId) {
	return [
		{
			id: newId("net"),
			name: "VCC",
			pins: [
				{ partId: btId, pin: "1" },
				{ partId: rId, pin: "1" },
			],
		},
		{
			id: newId("net"),
			name: "NET_LED",
			pins: [
				{ partId: rId, pin: "2" },
				{ partId: ledId, pin: "1" },
			],
		},
		{
			id: newId("net"),
			name: "GND",
			pins: [
				{ partId: ledId, pin: "2" },
				{ partId: btId, pin: "2" },
			],
		},
	];
}

function buildTestCircuit() {
	const bt = makeBatteryPart();
	const r = makeResistorPart();
	const led = makeLedPart();
	const nets = buildTestNets(bt.id, r.id, led.id);
	const ir = {
		schemaVersion: 1,
		name: "LedCircuit",
		parts: [bt, r, led],
		nets,
		constraints: [
			{
				id: "c_rail_vcc",
				kind: "rail",
				target: "VCC",
				value: 9,
				unit: "V",
			},
		],
	};
	return { ir, bt, r, led, netVcc: nets[0], netMid: nets[1], netGnd: nets[2] };
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
		const { ir, netVcc, bt } = buildTestCircuit();
		const fault = { kind: "open_trace", netId: netVcc.id, pinIndex: 0 };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		assert.equal(res.ir.nets.length, 4);
		const brokenNet = res.ir.nets.find((n) => n.name === "VCC_BROKEN");
		assert.ok(brokenNet);
		assert.equal(brokenNet.pins.length, 1);
		assert.equal(brokenNet.pins[0].partId, bt.id);
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("short_nets merges netB into netA", () => {
		const { ir, netVcc, netMid } = buildTestCircuit();
		const fault = { kind: "short_nets", netA: netVcc.id, netB: netMid.id };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		assert.equal(res.ir.nets.length, 2);
		const merged = res.ir.nets.find((n) => n.id === netVcc.id);
		assert.equal(merged.pins.length, 4);
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("part_open disconnects part from all nets", () => {
		const { ir, r } = buildTestCircuit();
		const fault = { kind: "part_open", partId: r.id };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		for (const net of res.ir.nets) {
			const hasPart = net.pins.some((p) => p.partId === r.id);
			assert.equal(hasPart, false);
		}
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("part_short merges all nets touched by part", () => {
		const { ir, r, netVcc, netMid } = buildTestCircuit();
		const fault = { kind: "part_short", partId: r.id };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		assert.equal(res.ir.nets.length, 2);
		assert.deepEqual(res.affected.netIds.sort(), [netVcc.id, netMid.id].sort());
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("reverse_polarity swaps pins 1 and 2", () => {
		const { ir, led, netMid, netGnd } = buildTestCircuit();
		const fault = { kind: "reverse_polarity", partId: led.id };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		const midPin = res.ir.nets
			.find((n) => n.id === netMid.id)
			.pins.find((p) => p.partId === led.id);
		const gndPin = res.ir.nets
			.find((n) => n.id === netGnd.id)
			.pins.find((p) => p.partId === led.id);
		assert.equal(midPin.pin, "2");
		assert.equal(gndPin.pin, "1");
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("value_drift scales part value with SI suffix", () => {
		const { ir, r } = buildTestCircuit();
		const fault = { kind: "value_drift", partId: r.id, factor: 2 };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		const newPart = res.ir.parts.find((p) => p.id === r.id);
		assert.equal(newPart.value, "660");
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("overvoltage scales power source value", () => {
		const { ir, bt } = buildTestCircuit();
		const fault = { kind: "overvoltage", partId: bt.id, factor: 1.5 };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		const newBt = res.ir.parts.find((p) => p.id === bt.id);
		assert.equal(newBt.value, "13.5V");
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("missing_ground renames ground net", () => {
		const { ir } = buildTestCircuit();
		const fault = { kind: "missing_ground" };
		const res = injectFault(ir, fault);

		assert.equal(res.ok, true);
		const gnd = res.ir.nets.find((n) => n.name === "GND");
		assert.equal(gnd, undefined);
		const disconnected = res.ir.nets.find((n) => n.name === "GND_DISCONNECTED");
		assert.ok(disconnected);
		assert.equal(validateCircuitIR(res.ir).ok, true);
	});

	test("injectFault never mutates the input IR", () => {
		const { ir, r } = buildTestCircuit();
		const snapshot = JSON.stringify(ir);
		injectFault(ir, { kind: "value_drift", partId: r.id, factor: 5 });
		assert.equal(JSON.stringify(ir), snapshot);
	});
});

describe("injectFault invalid parameter handling", () => {
	const invalidCases = [
		{ name: "null ir", ir: null, fault: { kind: "missing_ground" } },
		{ name: "null fault", ir: {}, fault: null },
		{ name: "unknown kind", ir: {}, fault: { kind: "magic_smoke" } },
		{
			name: "open_trace missing net",
			ir: buildTestCircuit().ir,
			fault: { kind: "open_trace", netId: "net_missing", pinIndex: 0 },
		},
		{
			name: "open_trace invalid pinIndex",
			ir: buildTestCircuit().ir,
			fault: {
				kind: "open_trace",
				netId: buildTestCircuit().netVcc.id,
				pinIndex: 99,
			},
		},
		{
			name: "short_nets same net",
			ir: buildTestCircuit().ir,
			fault: {
				kind: "short_nets",
				netA: buildTestCircuit().netVcc.id,
				netB: buildTestCircuit().netVcc.id,
			},
		},
		{
			name: "part_open missing part",
			ir: buildTestCircuit().ir,
			fault: { kind: "part_open", partId: "part_unknown" },
		},
		{
			name: "part_short with 1 net part",
			ir: {
				schemaVersion: 1,
				name: "OneNet",
				parts: [
					{
						id: "part_11111111-1111-1111-1111-111111111111",
						ref: "R1",
						value: "10k",
						symbol: "Device:R",
						footprint: "R",
						props: {},
					},
				],
				nets: [
					{
						id: "net_22222222-2222-2222-2222-222222222222",
						name: "N1",
						pins: [
							{
								partId: "part_11111111-1111-1111-1111-111111111111",
								pin: "1",
							},
						],
					},
				],
				constraints: [],
			},
			fault: {
				kind: "part_short",
				partId: "part_11111111-1111-1111-1111-111111111111",
			},
		},
		{
			name: "value_drift invalid factor",
			ir: buildTestCircuit().ir,
			fault: {
				kind: "value_drift",
				partId: buildTestCircuit().r.id,
				factor: -2,
			},
		},
		{
			name: "overvoltage invalid factor",
			ir: buildTestCircuit().ir,
			fault: {
				kind: "overvoltage",
				partId: buildTestCircuit().bt.id,
				factor: 0,
			},
		},
		{
			name: "missing_ground with no gnd net",
			ir: {
				schemaVersion: 1,
				name: "NoGnd",
				parts: [buildTestCircuit().r],
				nets: [buildTestCircuit().netVcc],
				constraints: [],
			},
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
		const kinds = suggestions.map((s) => s.kind);
		for (const k of FAULT_KINDS) {
			assert.ok(kinds.includes(k), `Missing suggestion for ${k}`);
		}

		for (const suggestion of suggestions) {
			const res = injectFault(ir, suggestion);
			assert.equal(res.ok, true, `Fault ${suggestion.kind} execution failed`);
			assert.equal(validateCircuitIR(res.ir).ok, true);
		}
	});

	test("omits missing_ground when no GND net exists", () => {
		const { ir } = buildTestCircuit();
		ir.nets = ir.nets.filter((n) => n.name !== "GND");
		const suggestions = suggestFaults(ir);
		const kinds = suggestions.map((s) => s.kind);
		assert.equal(kinds.includes("missing_ground"), false);
	});

	test("omits overvoltage when no source part exists", () => {
		const { ir, bt } = buildTestCircuit();
		ir.parts = ir.parts.filter((p) => p.id !== bt.id);
		ir.nets = ir.nets.map((n) => ({
			...n,
			pins: n.pins.filter((p) => p.partId !== bt.id),
		}));
		const suggestions = suggestFaults(ir);
		const kinds = suggestions.map((s) => s.kind);
		assert.equal(kinds.includes("overvoltage"), false);
	});

	test("returns empty list on invalid input", () => {
		assert.deepEqual(suggestFaults(null), []);
		assert.deepEqual(suggestFaults({}), []);
	});
});
