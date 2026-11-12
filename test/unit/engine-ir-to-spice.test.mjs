import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import {
	irToSpice,
	parseSiValue,
} from "../../backend/src/engine/spice/ir-to-spice.js";

const makePart = (ref, value, overrides = {}) => ({
	id: newId("part"),
	ref,
	value,
	symbol: overrides.symbol ?? `Device:${ref.replace(/\d+$/, "")}`,
	footprint: overrides.footprint ?? "Resistor_SMD:R_0603_1608Metric",
	props: overrides.props ?? {},
	...overrides,
});

const makePin = (part, pin) => ({ partId: part.id, pin });
const connect = (name, ...pins) => ({ id: newId("net"), name, pins });

const makeIR = (parts, nets, name = "TestCircuit") => ({
	schemaVersion: 1,
	name,
	parts,
	nets,
	constraints: [],
});

function makeTwoPinIR(
	part,
	net1Name = "in",
	net2Name = "GND",
	title = "TestCircuit",
) {
	const net1 = connect(net1Name, makePin(part, "1"));
	const net2 = connect(net2Name, makePin(part, "2"));
	return { ir: makeIR([part], [net1, net2], title), net1, net2 };
}

function assertCircuitResult(
	res,
	{ elementId, expectedElem, netlistLines = [] } = {},
) {
	assert.strictEqual(res.ok, true);
	if (elementId !== undefined) {
		assert.strictEqual(res.elementMap[elementId], expectedElem);
	}
	for (const line of netlistLines) {
		assert.strictEqual(res.netlist.includes(line), true);
	}
}

describe("parseSiValue", () => {
	const validCases = [
		["10k", 10000],
		["4.7u", 4.7e-6],
		["100n", 100e-9],
		["1M", 1e6],
		["10meg", 10e6],
		["10Meg", 10e6],
		["10m", 0.01],
		["2R2", 2.2],
		["3V3", 3.3],
		["4k7", 4700],
		["0R1", 0.1],
		["5V", 5],
		["100uF", 100e-6],
		["10kOhm", 10000],
		["10kΩ", 10000],
		["100", 100],
		[220, 220],
		["1.5m", 0.0015],
		["1G", 1e9],
		["100pF", 100e-12],
	];

	for (const [input, expected] of validCases) {
		test(`parses valid SI value: ${input}`, () => {
			const actual = parseSiValue(input);
			assert.strictEqual(Math.abs(actual - expected) < 1e-12, true);
		});
	}

	const invalidCases = [
		"",
		"   ",
		"abc",
		"10xyz",
		null,
		undefined,
		Number.NaN,
		{},
		[],
		"k10",
	];

	for (const input of invalidCases) {
		test(`returns NaN for invalid input: ${String(input)}`, () => {
			assert.strictEqual(Number.isNaN(parseSiValue(input)), true);
		});
	}
});

function makeVoltageDivider() {
	const v1 = makePart("V1", "5V", { props: { voltage: "5V" } });
	const r1 = makePart("R1", "10k");
	const r2 = makePart("R2", "10k");
	const netIn = connect("in", makePin(v1, "1"), makePin(r1, "1"));
	const netOut = connect("out", makePin(r1, "2"), makePin(r2, "1"));
	const netGnd = connect("GND", makePin(v1, "2"), makePin(r2, "2"));
	const ir = makeIR([v1, r1, r2], [netIn, netOut, netGnd], "VoltageDivider");
	return { v1, r1, r2, netIn, netOut, netGnd, ir };
}

describe("irToSpice - voltage divider", () => {
	test("generates expected elements, nodes, and netlist for divider", () => {
		const { v1, r1, r2, netIn, netOut, netGnd, ir } = makeVoltageDivider();
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		for (const [net, expected] of [
			[netGnd, "0"],
			[netIn, "n_in"],
			[netOut, "n_out"],
		]) {
			assert.strictEqual(res.nodeMap[net.id], expected);
		}

		for (const [part, expected] of [
			[v1, "V1"],
			[r1, "R1"],
			[r2, "R2"],
		]) {
			assert.strictEqual(res.elementMap[part.id], expected);
		}

		const lines = res.netlist.split("\n");
		assert.strictEqual(lines[0], "* VoltageDivider");
		const expectedLines = [
			".options filetype=ascii",
			"V1 n_in 0 DC 5",
			"R1 n_in n_out 10000",
			"R2 n_out 0 10000",
			".op",
			".save all @r*[i] @d*[id]",
			".end",
		];
		for (const expected of expectedLines) {
			assert.strictEqual(lines.includes(expected), true);
		}
	});
});

describe("irToSpice - LED, diode, and resistor", () => {
	test("generates diode lines with models and pin mapping", () => {
		const led = makePart("LED1", "Red", { symbol: "Device:LED" });
		const r1 = makePart("R1", "330");
		const v1 = makePart("V1", "5V");
		const nets = [
			connect("in", makePin(v1, "1"), makePin(r1, "1")),
			connect("mid", makePin(r1, "2"), makePin(led, "A")),
			connect("0", makePin(led, "K"), makePin(v1, "2")),
		];
		const res = irToSpice(makeIR([v1, r1, led], nets, "LedCircuit"));
		assertCircuitResult(res, {
			elementId: led.id,
			expectedElem: "DLED1",
			netlistLines: ["DLED1 n_mid 0 LED", ".model LED D (IS=1e-22 N=2)"],
		});
	});

	test("generates generic diode line with D model", () => {
		const d1 = makePart("D1", "1N4148", { symbol: "Device:D" });
		const { ir } = makeTwoPinIR(d1, "in", "GND");
		assertCircuitResult(irToSpice(ir), {
			elementId: d1.id,
			expectedElem: "D1",
			netlistLines: ["D1 n_in 0 D", ".model D D"],
		});
	});
});

const SWITCH_AND_FUSE_CASES = [
	{
		name: "models closed switch as 1 mOhm resistor",
		ref: "SW1",
		val: "Switch",
		overrides: { props: { closed: true } },
		expectedElem: "RSW1",
		expectedLine: "RSW1 n_in n_out 0.001",
	},
	{
		name: "models open switch as 1 GOhm resistor",
		ref: "S1",
		val: "Switch",
		overrides: { props: { closed: false } },
		expectedElem: "RS1",
		expectedLine: "RS1 n_in n_out 1000000000",
	},
	{
		name: "models fuse as 10 mOhm resistor",
		ref: "F1",
		val: "500mA",
		overrides: {},
		expectedElem: "RF1",
		expectedLine: "RF1 n_in n_out 0.01",
	},
];

describe("irToSpice - switch and fuse", () => {
	for (const tc of SWITCH_AND_FUSE_CASES) {
		test(tc.name, () => {
			const part = makePart(tc.ref, tc.val, tc.overrides);
			const { ir } = makeTwoPinIR(part, "in", "out");
			assertCircuitResult(irToSpice(ir), {
				elementId: part.id,
				expectedElem: tc.expectedElem,
				netlistLines: [tc.expectedLine],
			});
		});
	}
});

describe("irToSpice - IC and warnings", () => {
	test("skips IC with warning and does not include in netlist", () => {
		const u1 = makePart("U1", "STM32F103", { symbol: "MCU:STM32F103" });
		const { ir } = makeTwoPinIR(u1, "VCC", "GND");
		const res = irToSpice(ir);

		assertCircuitResult(res, {
			elementId: u1.id,
			expectedElem: undefined,
		});
		assert.strictEqual(res.netlist.includes("U1"), false);
		assert.strictEqual(
			res.warnings.some((w) => w.includes("U1") && w.includes("black box")),
			true,
		);
	});

	test("emits warning for parts with unconnected pins", () => {
		const r1 = makePart("R1", "10k");
		const res = irToSpice(makeIR([r1], [connect("in", makePin(r1, "1"))]));

		assert.strictEqual(res.ok, true);
		assert.strictEqual(
			res.warnings.some((w) => w.includes("R1") && w.includes("unconnected")),
			true,
		);
	});
});

describe("irToSpice - validation and analysis options", () => {
	test("returns ok:false on invalid IR", () => {
		const resNull = irToSpice(null);
		assert.strictEqual(resNull.ok, false);
		assert.strictEqual(Array.isArray(resNull.errors), true);
		assert.strictEqual(resNull.errors.length > 0, true);

		const resBad = irToSpice({ schemaVersion: 2 });
		assert.strictEqual(resBad.ok, false);
	});

	test("supports transient analysis configuration", () => {
		const r1 = makePart("R1", "1k");
		const { ir } = makeTwoPinIR(r1, "in", "GND");
		const res = irToSpice(ir, {
			analysis: { type: "tran", stepS: "1u", stopS: "10m" },
		});

		assert.strictEqual(res.ok, true);
		const lines = res.netlist.split("\n");
		assert.strictEqual(lines.includes(".tran 1u 10m"), true);
		assert.strictEqual(lines.includes(".op"), false);
	});
});

describe("irToSpice - security and injection prevention", () => {
	const maliciousPayloads = [
		"R1\n.control",
		"R1 x y 1\nshell calc",
		"`whoami`",
		"R1;.include /etc/passwd",
	];
	const allowedDirectives = [
		".options",
		".op",
		".tran",
		".save",
		".model",
		".end",
	];

	function assertSafeNetlist(netlist) {
		assert.strictEqual(netlist.includes("`"), false);
		const lines = netlist.split("\n");
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith(".")) {
				const isAllowed = allowedDirectives.some((cmd) =>
					trimmed.startsWith(cmd),
				);
				assert.strictEqual(
					isAllowed,
					true,
					`Disallowed dot command found: ${trimmed}`,
				);
			}
		}
	}

	function runInjectionCircuit(part, netName = "in", title = "TestCircuit") {
		const { ir, net1 } = makeTwoPinIR(part, netName, "GND", title);
		const res = irToSpice(ir);
		assert.strictEqual(res.ok, true);
		assertSafeNetlist(res.netlist);
		return { res, net1 };
	}

	for (const payload of maliciousPayloads) {
		test(`prevents injection via part.ref: ${JSON.stringify(payload)}`, () => {
			const part = makePart(payload, "10k");
			const { res } = runInjectionCircuit(part);
			const elementName = res.elementMap[part.id];
			if (elementName) {
				assert.strictEqual(/^[A-Za-z0-9_]{1,32}$/.test(elementName), true);
			}
		});

		test(`prevents injection via net.name: ${JSON.stringify(payload)}`, () => {
			const { res, net1 } = runInjectionCircuit(makePart("R1", "10k"), payload);
			assert.strictEqual(/^[A-Za-z0-9_]+$/.test(res.nodeMap[net1.id]), true);
		});

		test(`prevents injection via part.value: ${JSON.stringify(payload)}`, () => {
			runInjectionCircuit(makePart("R1", payload));
		});

		test(`prevents injection via circuit title: ${JSON.stringify(payload)}`, () => {
			runInjectionCircuit(makePart("R1", "10k"), "in", payload);
		});
	}

	test("de-duplicates when two parts sanitize to the same name and preserves max 32 chars", () => {
		const r1 = makePart("R1", "10k");
		const r2 = makePart("R-1", "10k");
		const r3 = makePart(`R${"A".repeat(40)}`, "10k");
		const parts = [r1, r2, r3];
		const net1 = connect("in", ...parts.map((p) => makePin(p, "1")));
		const net2 = connect("GND", ...parts.map((p) => makePin(p, "2")));
		const res = irToSpice(makeIR(parts, [net1, net2]));

		assert.strictEqual(res.ok, true);
		for (const [part, expected] of [
			[r1, "R1"],
			[r2, "R1_2"],
		]) {
			assert.strictEqual(res.elementMap[part.id], expected);
		}
		assert.strictEqual(res.elementMap[r3.id].length <= 32, true);
		assertSafeNetlist(res.netlist);
	});
});
