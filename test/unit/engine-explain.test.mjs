import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	explainCircuitResult,
	formatCurrent,
	formatPower,
	formatVoltage,
} from "../../backend/src/engine/sim/explain.js";
import { FAULT_INFO } from "../../backend/src/engine/sim/fault-inject.js";

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

describe("explainCircuitResult", () => {
	test("LED + resistor + battery healthy", () => {
		const input = makeHealthyCircuit();
		const result = explainCircuitResult(input);

		assert.ok(
			result.summary.includes("Your circuit works: the LED gets 12 mA."),
		);
		assert.ok(result.cards.length >= 3);

		const ledCard = result.cards.find((c) => c.partIds.includes("part_d1"));
		assert.ok(ledCard);
		assert.equal(ledCard.level, "info");
		assert.match(ledCard.title, /lit/i);
		assert.match(ledCard.text, /12 mA/);

		const resCard = result.cards.find((c) => c.partIds.includes("part_r1"));
		assert.ok(resCard);
		assert.equal(resCard.level, "info");

		const batCard = result.cards.find((c) => c.partIds.includes("part_bt"));
		assert.ok(batCard);
		assert.equal(batCard.level, "info");
		assert.match(batCard.text, /2000 mAh/);
		assert.match(batCard.text, /hours/i);
	});

	test("LED overcurrent danger", () => {
		const input = makeHealthyCircuit();
		input.partCurrents.part_d1 = 0.05;

		const result = explainCircuitResult(input);
		assert.ok(result.summary.startsWith("Something is wrong:"));

		const ledCard = result.cards.find((c) => c.partIds.includes("part_d1"));
		assert.ok(ledCard);
		assert.equal(ledCard.level, "danger");
		assert.match(ledCard.text, /will burn out/i);
	});

	test("resistor overheating", () => {
		const input = makeHealthyCircuit();
		input.partPowers = { part_r1: 0.6 };

		const result = explainCircuitResult(input);
		assert.ok(result.summary.startsWith("Something is wrong:"));

		const resCard = result.cards.find((c) => c.partIds.includes("part_r1"));
		assert.ok(resCard);
		assert.equal(resCard.level, "danger");
		assert.match(resCard.title, /overheating/i);
	});

	test("open_trace fault -> LED off card first", () => {
		const input = makeHealthyCircuit();
		input.partCurrents.part_bt = 0;
		input.partCurrents.part_r1 = 0;
		input.partCurrents.part_d1 = 0;
		input.nodeVoltages.net_mid = 0;
		input.fault = {
			kind: "open_trace",
			netId: "net_mid",
			pinIndex: 0,
		};

		const result = explainCircuitResult(input);
		assert.ok(result.summary.startsWith("Something is wrong:"));
		assert.ok(result.cards.length > 0);

		const firstCard = result.cards[0];
		assert.ok(firstCard.text.includes(FAULT_INFO.open_trace.plainEnglish));
		assert.match(firstCard.text, /stopped|off/i);
		assert.ok(firstCard.partIds.includes("part_d1"));
	});

	test("human number formatting table", () => {
		const currentCases = [
			{ val: 0.012, expected: "12 mA" },
			{ val: 0.005, expected: "5 mA" },
			{ val: 0.5, expected: "500 mA" },
			{ val: 1.5, expected: "1.5 A" },
			{ val: 0, expected: "0 mA" },
		];
		for (const tc of currentCases) {
			assert.equal(formatCurrent(tc.val), tc.expected);
		}

		const voltageCases = [
			{ val: 0.25, expected: "250 mV" },
			{ val: 0.05, expected: "50 mV" },
			{ val: 5.0, expected: "5 V" },
			{ val: 0, expected: "0 V" },
		];
		for (const tc of voltageCases) {
			assert.equal(formatVoltage(tc.val), tc.expected);
		}

		assert.equal(formatPower(0), "0 W");
		assert.equal(formatPower(0.5), "500 mW");
		assert.equal(formatPower(2.0), "2 W");
	});

	test("empty/garbage input -> a safe summary without throwing", () => {
		const garbageCases = [
			undefined,
			null,
			{},
			{ ir: null, nodeVoltages: null, partCurrents: null },
			{ ir: { parts: "garbage", nets: 123 } },
			{ fault: { kind: "unknown_kind" } },
			{
				nodeVoltages: { n1: Number.NaN },
				partCurrents: { p1: "not a number" },
			},
		];

		for (const input of garbageCases) {
			const res = explainCircuitResult(input);
			assert.ok(res);
			assert.equal(typeof res.summary, "string");
			assert.ok(res.summary.length > 0);
			assert.ok(Array.isArray(res.cards));
		}
	});
});
