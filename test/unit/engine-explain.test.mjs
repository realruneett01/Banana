import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	explainCircuitResult,
	formatCurrent,
	formatPower,
	formatVoltage,
} from "../../backend/src/engine/sim/explain.js";
import { FAULT_INFO } from "../../backend/src/engine/sim/fault-inject.js";

function buildNet([id, name, pins]) {
	return {
		id,
		name,
		pins: pins.map(([partId, pin]) => ({ partId, pin })),
	};
}

function buildNets() {
	return [
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
	].map(buildNet);
}

function makeHealthyCircuit() {
	const parts = [
		["part_bt", "BT1", "9V", "Device:Battery"],
		["part_r1", "R1", "580", "Device:R"],
		["part_d1", "D1", "RED", "Device:LED"],
	].map(([id, ref, value, symbol]) => ({ id, ref, value, symbol }));

	return {
		ir: { parts, nets: buildNets() },
		nodeVoltages: { net_bat: 9.0, net_mid: 2.0, net_gnd: 0.0 },
		partCurrents: { part_bt: 0.012, part_r1: 0.012, part_d1: 0.012 },
	};
}

function assertSummary(result, predicate, minCards = 0) {
	assert.ok(predicate(result.summary));
	if (minCards > 0) {
		assert.ok(result.cards.length >= minCards);
	}
}

function assertCard(result, partId, { level, title, patterns = [] }) {
	const card = result.cards.find((c) => c.partIds.includes(partId));
	assert.ok(card);
	if (level) assert.equal(card.level, level);
	if (title) assert.match(card.title, title);
	for (const pattern of patterns) {
		assert.match(card.text, pattern);
	}
	return card;
}

function assertSafeResult(res) {
	assert.ok(res);
	assert.equal(typeof res.summary, "string");
	assert.ok(res.summary.length > 0);
	assert.ok(Array.isArray(res.cards));
}

describe("explainCircuitResult", () => {
	test("LED + resistor + battery healthy", () => {
		const result = explainCircuitResult(makeHealthyCircuit());
		assertSummary(
			result,
			(s) => s.includes("Your circuit works: the LED gets 12 mA."),
			3,
		);

		const expectedCards = [
			{ partId: "part_d1", level: "info", title: /lit/i, patterns: [/12 mA/] },
			{ partId: "part_r1", level: "info" },
			{ partId: "part_bt", level: "info", patterns: [/2000 mAh/, /hours/i] },
		];
		for (const spec of expectedCards) {
			assertCard(result, spec.partId, spec);
		}
	});

	test("LED overcurrent danger", () => {
		const input = makeHealthyCircuit();
		input.partCurrents.part_d1 = 0.05;

		const result = explainCircuitResult(input);
		assertSummary(result, (s) => s.startsWith("Something is wrong:"));
		assertCard(result, "part_d1", {
			level: "danger",
			patterns: [/will burn out/i],
		});
	});

	test("resistor overheating", () => {
		const input = makeHealthyCircuit();
		input.partPowers = { part_r1: 0.6 };

		const result = explainCircuitResult(input);
		assertSummary(result, (s) => s.startsWith("Something is wrong:"));
		assertCard(result, "part_r1", {
			level: "danger",
			title: /overheating/i,
		});
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
		assertSummary(result, (s) => s.startsWith("Something is wrong:"), 1);

		const firstCard = result.cards[0];
		assert.ok(firstCard.text.includes(FAULT_INFO.open_trace.plainEnglish));
		assert.match(firstCard.text, /stopped|off/i);
		assert.ok(firstCard.partIds.includes("part_d1"));
	});

	test("human number formatting table", () => {
		const cases = [
			[formatCurrent, 0.012, "12 mA"],
			[formatCurrent, 0.005, "5 mA"],
			[formatCurrent, 0.5, "500 mA"],
			[formatCurrent, 1.5, "1.5 A"],
			[formatCurrent, 0, "0 mA"],
			[formatVoltage, 0.25, "250 mV"],
			[formatVoltage, 0.05, "50 mV"],
			[formatVoltage, 5.0, "5 V"],
			[formatVoltage, 0, "0 V"],
			[formatPower, 0, "0 W"],
			[formatPower, 0.5, "500 mW"],
			[formatPower, 2.0, "2 W"],
		];
		for (const [fn, val, expected] of cases) {
			assert.equal(fn(val), expected);
		}
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
			assertSafeResult(explainCircuitResult(input));
		}
	});
});
