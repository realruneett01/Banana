import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	nextE12,
	suggestFixes,
} from "../../backend/src/engine/sim/fix-suggest.js";
import { applyCommand } from "../../frontend/src/editor/editorModel.js";

const RAW_PARTS = [
	["part_bt", "BT1", "9V", "Device:Battery"],
	["part_r1", "R1", "580", "Device:R"],
	["part_d1", "D1", "RED", "Device:LED"],
];

const RAW_NETS = [
	[
		"net_bat",
		"VCC",
		[
			["part_bt", "1"],
			["part_r1", "1"],
		],
	],
	[
		"net_mid",
		"NET_LED",
		[
			["part_r1", "2"],
			["part_d1", "A"],
		],
	],
	[
		"net_gnd",
		"GND",
		[
			["part_d1", "K"],
			["part_bt", "2"],
		],
	],
];

function makeHealthyCircuit() {
	return {
		ir: {
			schemaVersion: 1,
			name: "LED Circuit",
			parts: RAW_PARTS.map(([id, ref, value, symbol]) => ({
				id,
				ref,
				value,
				symbol,
			})),
			nets: RAW_NETS.map(([id, name, pins]) => ({
				id,
				name,
				pins: pins.map(([partId, pin]) => ({ partId, pin })),
			})),
		},
		nodeVoltages: { net_bat: 9.0, net_mid: 2.0, net_gnd: 0.0 },
		partCurrents: { part_bt: 0.012, part_r1: 0.012, part_d1: 0.012 },
	};
}

function getSingleFix(circuit) {
	const fixes = suggestFixes(circuit);
	assert.equal(fixes.length, 1);
	return fixes[0];
}

function applyFixCommand(circuit, command, options) {
	const doc = {
		ir: circuit.ir,
		selection: [],
		history: { past: [], future: [] },
	};
	const nextDoc = applyCommand(doc, command, options);
	assert.equal(nextDoc.error, undefined);
	return nextDoc;
}

function assertSingleCommandFix(fix, { forCardId, risk, type }) {
	assert.equal(fix.forCardId, forCardId);
	assert.equal(fix.risk, risk);
	assert.equal(fix.commands.length, 1);
	assert.equal(fix.commands[0].type, type);
}

function assertSetPartValueFix(fix, { cardId, partId, value }) {
	assert.equal(fix.forCardId, cardId);
	assert.equal(fix.risk, "low");
	assert.deepEqual(fix.commands, [
		{
			type: "setPartField",
			partId,
			field: "value",
			value,
		},
	]);
}

function assertAddedPart(cmd, ref, expectedValue) {
	assert.equal(cmd.type, "addPart");
	assert.equal(cmd.part.ref, ref);
	if (typeof expectedValue === "string") {
		assert.equal(cmd.part.value, expectedValue);
	} else {
		assert.match(cmd.part.value, expectedValue);
	}
}

function getPartValue(doc, partId) {
	return doc.ir.parts.find((p) => p.id === partId)?.value;
}

function getPartProp(doc, partId, prop) {
	return doc.ir.parts.find((p) => p.id === partId)?.props?.[prop];
}

function hasPartWithRef(doc, ref) {
	return doc.ir.parts.some((p) => p.ref === ref);
}

function assertPartPropFix(fix, { partId, key, value }) {
	assert.deepEqual(fix.commands, [
		{
			type: "setPartProp",
			partId,
			key,
			value,
		},
	]);
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
	function runResistorTestCase({
		initialValue,
		current,
		expectedValue,
		whyPattern,
	}) {
		const circuit = makeHealthyCircuit();
		circuit.ir.parts[1].value = initialValue;
		circuit.partCurrents.part_d1 = current;
		circuit.partCurrents.part_r1 = current;

		const fix = getSingleFix(circuit);
		assertSetPartValueFix(fix, {
			cardId: "card-part_d1",
			partId: "part_r1",
			value: expectedValue,
		});
		if (whyPattern) {
			assert.match(fix.why, whyPattern);
		}

		const nextDoc = applyFixCommand(circuit, fix.commands[0]);
		assert.equal(getPartValue(nextDoc, "part_r1"), expectedValue);
	}

	test("LED overcurrent raises series resistor to E12 at 15 mA", () => {
		runResistorTestCase({
			initialValue: "100",
			current: 0.035,
			expectedValue: "470",
			whyPattern: /bigger resistor lets less electricity through/i,
		});
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

		for (const targetFix of [valueFix, propFix]) {
			assert.ok(targetFix);
			assert.equal(targetFix.forCardId, "card-part_r1");
			assert.equal(targetFix.risk, "low");
		}

		assertPartPropFix(propFix, {
			partId: "part_r1",
			key: "power",
			value: "0.5W",
		});

		const nextDoc = applyFixCommand(circuit, propFix.commands[0]);
		assert.equal(getPartProp(nextDoc, "part_r1", "power"), "0.5W");
	});

	test("LED too dim lowers resistor while keeping current <= 20 mA", () => {
		runResistorTestCase({
			initialValue: "10k",
			current: 0.0005,
			expectedValue: "390",
		});
	});

	const batchFaultCases = [
		{
			title:
				"short_nets fault on unprotected supply suggests adding fuse in series",
			fault: { kind: "short_nets", netA: "net_bat", netB: "net_gnd" },
			idFn: (kind) => ({ part: "part_f1" })[kind] || `${kind}_mock`,
			cardId: "card-fault-short_nets",
			addedRef: "F1",
			addedValue: /24mA|30mA/,
			checkExtraCmds(batchCmds) {
				assert.equal(batchCmds[0].type, "disconnect");
				assert.equal(batchCmds[0].partId, "part_bt");
				assert.equal(batchCmds[2].type, "connect");
				assert.equal(batchCmds[3].type, "connect");
			},
		},
		{
			title: "reverse_polarity fault suggests adding 1N5819 diode in series",
			fault: { kind: "reverse_polarity", partId: "part_d1" },
			idFn: (kind) => `${kind}_diode_mock`,
			cardId: "card-fault-reverse_polarity",
			addedRef: "D2",
			addedValue: "1N5819",
		},
	];

	for (const tc of batchFaultCases) {
		test(tc.title, () => {
			const circuit = makeHealthyCircuit();
			const fix = getSingleFix({
				...circuit,
				fault: tc.fault,
				idFn: tc.idFn,
			});

			assertSingleCommandFix(fix, {
				forCardId: tc.cardId,
				risk: "medium",
				type: "batch",
			});

			const batchCmds = fix.commands[0].commands;
			assertAddedPart(batchCmds[1], tc.addedRef, tc.addedValue);
			tc.checkExtraCmds?.(batchCmds);

			const nextDoc = applyFixCommand(circuit, fix.commands[0], {
				idFn: tc.idFn,
			});
			assert.ok(hasPartWithRef(nextDoc, tc.addedRef));
		});
	}

	test("missing_ground fault suggests reconnecting ground net", () => {
		const circuit = makeHealthyCircuit();
		circuit.ir.nets[2].name = "GND_DISCONNECTED";

		const fix = getSingleFix({
			...circuit,
			fault: { kind: "missing_ground", netId: "net_gnd" },
		});

		assertSingleCommandFix(fix, {
			forCardId: "card-fault-missing_ground",
			risk: "low",
			type: "connect",
		});
		assert.ok(fix.commands[0].partIdA);
		assert.ok(fix.commands[0].partIdB);
	});
});
