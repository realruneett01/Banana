import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	nextE12,
	suggestFixes,
} from "../../backend/src/engine/sim/fix-suggest.js";
import { applyCommand } from "../../frontend/src/editor/editorModel.js";

function makeHealthyParts() {
	return [
		{ id: "part_bt", ref: "BT1", value: "9V", symbol: "Device:Battery" },
		{ id: "part_r1", ref: "R1", value: "580", symbol: "Device:R" },
		{ id: "part_d1", ref: "D1", value: "RED", symbol: "Device:LED" },
	];
}

function makeHealthyNets() {
	return [
		{
			id: "net_bat",
			name: "VCC",
			pins: [
				{ partId: "part_bt", pin: "1" },
				{ partId: "part_r1", pin: "1" },
			],
		},
		{
			id: "net_mid",
			name: "NET_LED",
			pins: [
				{ partId: "part_r1", pin: "2" },
				{ partId: "part_d1", pin: "A" },
			],
		},
		{
			id: "net_gnd",
			name: "GND",
			pins: [
				{ partId: "part_d1", pin: "K" },
				{ partId: "part_bt", pin: "2" },
			],
		},
	];
}

function makeHealthyCircuit() {
	return {
		ir: {
			schemaVersion: 1,
			name: "LED Circuit",
			parts: makeHealthyParts(),
			nets: makeHealthyNets(),
		},
		nodeVoltages: {
			net_bat: 9.0,
			net_mid: 2.0,
			net_gnd: 0.0,
		},
		partCurrents: {
			part_bt: 0.012,
			part_r1: 0.012,
			part_d1: 0.012,
		},
	};
}

describe("nextE12", () => {
	const cases = [
		{ input: 450, expected: 470 },
		{ input: 470, expected: 470 },
		{ input: 471, expected: 560 },
		{ input: 100, expected: 100 },
		{ input: 101, expected: 120 },
		{ input: 820, expected: 820 },
		{ input: 821, expected: 1000 },
		{ input: 1, expected: 1 },
		{ input: 0.015, expected: 0.015 },
		{ input: "450", expected: 470 },
		{ input: "1k", expected: 1000 },
		{ input: 0, expected: 1 },
		{ input: -10, expected: 1 },
		{ input: "invalid", expected: 1 },
	];

	for (const { input, expected } of cases) {
		test(`nextE12(${input}) -> ${expected}`, () => {
			assert.equal(nextE12(input), expected);
		});
	}
});

describe("suggestFixes input validation", () => {
	const garbageCases = [
		null,
		undefined,
		"garbage",
		123,
		{},
		{ ir: null },
		{ ir: "not-an-ir" },
		{ ir: { parts: "invalid" } },
	];

	for (const garbage of garbageCases) {
		test(`handles garbage ${JSON.stringify(garbage)} without throwing`, () => {
			assert.deepEqual(suggestFixes(garbage), []);
		});
	}

	test("healthy circuit produces no fixes", () => {
		const healthy = makeHealthyCircuit();
		const fixes = suggestFixes(healthy);
		assert.deepEqual(fixes, []);
	});
});

describe("suggestFixes rules", () => {
	test("LED overcurrent raises series resistor to E12 at 15 mA", () => {
		const circuit = makeHealthyCircuit();
		circuit.ir.parts[1].value = "100";
		circuit.partCurrents.part_d1 = 0.035;
		circuit.partCurrents.part_r1 = 0.035;

		const fixes = suggestFixes(circuit);
		assert.equal(fixes.length, 1);
		const fix = fixes[0];
		assert.equal(fix.forCardId, "card-part_d1");
		assert.equal(fix.risk, "low");
		assert.match(fix.why, /bigger resistor lets less electricity through/i);
		assert.deepEqual(fix.commands, [
			{
				type: "setPartField",
				partId: "part_r1",
				field: "value",
				value: "470",
			},
		]);

		const doc = {
			ir: circuit.ir,
			selection: [],
			history: { past: [], future: [] },
		};
		const nextDoc = applyCommand(doc, fix.commands[0]);
		assert.equal(nextDoc.error, undefined);
		assert.equal(nextDoc.ir.parts.find((p) => p.id === "part_r1").value, "470");
	});

	test("resistor over power suggests next E12 <= 50% power and 0.5W rating", () => {
		const circuit = makeHealthyCircuit();
		circuit.partCurrents.part_r1 = 0.06;
		circuit.partCurrents.part_d1 = 0.02;
		circuit.partPowers = { part_r1: 0.36 };

		const fixes = suggestFixes(circuit);
		assert.ok(fixes.length >= 2);
		const valueFix = fixes.find((f) => f.commands[0]?.type === "setPartField");
		const propFix = fixes.find((f) => f.commands[0]?.type === "setPartProp");

		assert.ok(valueFix);
		assert.equal(valueFix.forCardId, "card-part_r1");
		assert.equal(valueFix.risk, "low");

		assert.ok(propFix);
		assert.equal(propFix.forCardId, "card-part_r1");
		assert.equal(propFix.risk, "low");
		assert.deepEqual(propFix.commands, [
			{
				type: "setPartProp",
				partId: "part_r1",
				key: "power",
				value: "0.5W",
			},
		]);

		const doc = {
			ir: circuit.ir,
			selection: [],
			history: { past: [], future: [] },
		};
		const nextDoc = applyCommand(doc, propFix.commands[0]);
		assert.equal(nextDoc.error, undefined);
		assert.equal(
			nextDoc.ir.parts.find((p) => p.id === "part_r1").props.power,
			"0.5W",
		);
	});

	test("LED too dim lowers resistor while keeping current <= 20 mA", () => {
		const circuit = makeHealthyCircuit();
		circuit.ir.parts[1].value = "10k";
		circuit.partCurrents.part_d1 = 0.0005;
		circuit.partCurrents.part_r1 = 0.0005;

		const fixes = suggestFixes(circuit);
		assert.equal(fixes.length, 1);
		const fix = fixes[0];
		assert.equal(fix.forCardId, "card-part_d1");
		assert.equal(fix.risk, "low");
		assert.deepEqual(fix.commands, [
			{
				type: "setPartField",
				partId: "part_r1",
				field: "value",
				value: "390",
			},
		]);

		const doc = {
			ir: circuit.ir,
			selection: [],
			history: { past: [], future: [] },
		};
		const nextDoc = applyCommand(doc, fix.commands[0]);
		assert.equal(nextDoc.error, undefined);
		assert.equal(nextDoc.ir.parts.find((p) => p.id === "part_r1").value, "390");
	});

	test("short_nets fault on unprotected supply suggests adding fuse in series", () => {
		const circuit = makeHealthyCircuit();
		const idMap = { part: "part_f1" };
		const mockIdFn = (kind) => idMap[kind] || `${kind}_mock`;

		const fixes = suggestFixes({
			...circuit,
			fault: { kind: "short_nets", netA: "net_bat", netB: "net_gnd" },
			idFn: mockIdFn,
		});

		assert.equal(fixes.length, 1);
		const fix = fixes[0];
		assert.equal(fix.forCardId, "card-fault-short_nets");
		assert.equal(fix.risk, "medium");
		assert.equal(fix.commands.length, 1);
		assert.equal(fix.commands[0].type, "batch");

		const batchCmds = fix.commands[0].commands;
		assert.equal(batchCmds[0].type, "disconnect");
		assert.equal(batchCmds[0].partId, "part_bt");
		assert.equal(batchCmds[1].type, "addPart");
		assert.equal(batchCmds[1].part.ref, "F1");
		assert.match(batchCmds[1].part.value, /24mA|30mA/);
		assert.equal(batchCmds[2].type, "connect");
		assert.equal(batchCmds[3].type, "connect");

		const doc = {
			ir: circuit.ir,
			selection: [],
			history: { past: [], future: [] },
		};
		const nextDoc = applyCommand(doc, fix.commands[0], { idFn: mockIdFn });
		assert.equal(nextDoc.error, undefined);
		assert.ok(nextDoc.ir.parts.some((p) => p.ref === "F1"));
	});

	test("reverse_polarity fault suggests adding 1N5819 diode in series", () => {
		const circuit = makeHealthyCircuit();
		const mockIdFn = (kind) => `${kind}_diode_mock`;

		const fixes = suggestFixes({
			...circuit,
			fault: { kind: "reverse_polarity", partId: "part_d1" },
			idFn: mockIdFn,
		});

		assert.equal(fixes.length, 1);
		const fix = fixes[0];
		assert.equal(fix.forCardId, "card-fault-reverse_polarity");
		assert.equal(fix.risk, "medium");
		assert.equal(fix.commands.length, 1);
		assert.equal(fix.commands[0].type, "batch");

		const batchCmds = fix.commands[0].commands;
		assert.equal(batchCmds[1].type, "addPart");
		assert.equal(batchCmds[1].part.ref, "D2");
		assert.equal(batchCmds[1].part.value, "1N5819");

		const doc = {
			ir: circuit.ir,
			selection: [],
			history: { past: [], future: [] },
		};
		const nextDoc = applyCommand(doc, fix.commands[0], { idFn: mockIdFn });
		assert.equal(nextDoc.error, undefined);
		assert.ok(nextDoc.ir.parts.some((p) => p.ref === "D2"));
	});

	test("missing_ground fault suggests reconnecting ground net", () => {
		const circuit = makeHealthyCircuit();
		circuit.ir.nets[2].name = "GND_DISCONNECTED";

		const fixes = suggestFixes({
			...circuit,
			fault: { kind: "missing_ground", netId: "net_gnd" },
		});

		assert.equal(fixes.length, 1);
		const fix = fixes[0];
		assert.equal(fix.forCardId, "card-fault-missing_ground");
		assert.equal(fix.risk, "low");
		assert.equal(fix.commands.length, 1);
		assert.equal(fix.commands[0].type, "connect");
		assert.ok(fix.commands[0].partIdA);
		assert.ok(fix.commands[0].partIdB);
	});
});
