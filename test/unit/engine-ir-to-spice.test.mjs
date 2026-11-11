import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import {
	irToSpice,
	parseSiValue,
} from "../../backend/src/engine/spice/ir-to-spice.js";

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

describe("irToSpice - voltage divider", () => {
	test("generates expected elements, nodes, and netlist for divider", () => {
		const v1 = makePart("V1", "5V", { props: { voltage: "5V" } });
		const r1 = makePart("R1", "10k");
		const r2 = makePart("R2", "10k");

		const netIn = makeNet("in", [
			{ partId: v1.id, pin: "1" },
			{ partId: r1.id, pin: "1" },
		]);
		const netOut = makeNet("out", [
			{ partId: r1.id, pin: "2" },
			{ partId: r2.id, pin: "1" },
		]);
		const netGnd = makeNet("GND", [
			{ partId: v1.id, pin: "2" },
			{ partId: r2.id, pin: "2" },
		]);

		const ir = makeIR([v1, r1, r2], [netIn, netOut, netGnd], "VoltageDivider");
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.nodeMap[netGnd.id], "0");
		assert.strictEqual(res.nodeMap[netIn.id], "n_in");
		assert.strictEqual(res.nodeMap[netOut.id], "n_out");

		assert.strictEqual(res.elementMap[v1.id], "V1");
		assert.strictEqual(res.elementMap[r1.id], "R1");
		assert.strictEqual(res.elementMap[r2.id], "R2");

		const lines = res.netlist.split("\n");
		assert.strictEqual(lines[0], "* VoltageDivider");
		assert.strictEqual(lines.includes(".options filetype=ascii"), true);
		assert.strictEqual(lines.includes("V1 n_in 0 DC 5"), true);
		assert.strictEqual(lines.includes("R1 n_in n_out 10000"), true);
		assert.strictEqual(lines.includes("R2 n_out 0 10000"), true);
		assert.strictEqual(lines.includes(".op"), true);
		assert.strictEqual(lines.includes(".save all @r*[i] @d*[id]"), true);
		assert.strictEqual(lines.includes(".end"), true);
	});
});

describe("irToSpice - LED, diode, and resistor", () => {
	test("generates diode lines with models and pin mapping", () => {
		const led = makePart("LED1", "Red", { symbol: "Device:LED" });
		const r1 = makePart("R1", "330");
		const v1 = makePart("V1", "5V");

		const netIn = makeNet("in", [
			{ partId: v1.id, pin: "1" },
			{ partId: r1.id, pin: "1" },
		]);
		const netMid = makeNet("mid", [
			{ partId: r1.id, pin: "2" },
			{ partId: led.id, pin: "A" },
		]);
		const netGnd = makeNet("0", [
			{ partId: led.id, pin: "K" },
			{ partId: v1.id, pin: "2" },
		]);

		const ir = makeIR([v1, r1, led], [netIn, netMid, netGnd], "LedCircuit");
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[led.id], "DLED1");
		assert.strictEqual(res.netlist.includes("DLED1 n_mid 0 LED"), true);
		assert.strictEqual(
			res.netlist.includes(".model LED D (IS=1e-22 N=2)"),
			true,
		);
	});

	test("generates generic diode line with D model", () => {
		const d1 = makePart("D1", "1N4148", { symbol: "Device:D" });
		const net1 = makeNet("in", [{ partId: d1.id, pin: "1" }]);
		const net2 = makeNet("GND", [{ partId: d1.id, pin: "2" }]);

		const ir = makeIR([d1], [net1, net2]);
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[d1.id], "D1");
		assert.strictEqual(res.netlist.includes("D1 n_in 0 D"), true);
		assert.strictEqual(res.netlist.includes(".model D D"), true);
	});
});

describe("irToSpice - switch and fuse", () => {
	test("models closed switch as 1 mOhm resistor", () => {
		const sw = makePart("SW1", "Switch", { props: { closed: true } });
		const net1 = makeNet("in", [{ partId: sw.id, pin: "1" }]);
		const net2 = makeNet("out", [{ partId: sw.id, pin: "2" }]);

		const ir = makeIR([sw], [net1, net2]);
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[sw.id], "RSW1");
		assert.strictEqual(res.netlist.includes("RSW1 n_in n_out 0.001"), true);
	});

	test("models open switch as 1 GOhm resistor", () => {
		const s1 = makePart("S1", "Switch", { props: { closed: false } });
		const net1 = makeNet("in", [{ partId: s1.id, pin: "1" }]);
		const net2 = makeNet("out", [{ partId: s1.id, pin: "2" }]);

		const ir = makeIR([s1], [net1, net2]);
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[s1.id], "RS1");
		assert.strictEqual(res.netlist.includes("RS1 n_in n_out 1000000000"), true);
	});

	test("models fuse as 10 mOhm resistor", () => {
		const f1 = makePart("F1", "500mA");
		const net1 = makeNet("in", [{ partId: f1.id, pin: "1" }]);
		const net2 = makeNet("out", [{ partId: f1.id, pin: "2" }]);

		const ir = makeIR([f1], [net1, net2]);
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[f1.id], "RF1");
		assert.strictEqual(res.netlist.includes("RF1 n_in n_out 0.01"), true);
	});
});

describe("irToSpice - IC and warnings", () => {
	test("skips IC with warning and does not include in netlist", () => {
		const u1 = makePart("U1", "STM32F103", { symbol: "MCU:STM32F103" });
		const net1 = makeNet("VCC", [{ partId: u1.id, pin: "1" }]);
		const net2 = makeNet("GND", [{ partId: u1.id, pin: "2" }]);

		const ir = makeIR([u1], [net1, net2]);
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[u1.id], undefined);
		assert.strictEqual(res.netlist.includes("U1"), false);
		assert.strictEqual(
			res.warnings.some((w) => w.includes("U1") && w.includes("black box")),
			true,
		);
	});

	test("emits warning for parts with unconnected pins", () => {
		const r1 = makePart("R1", "10k");
		const net1 = makeNet("in", [{ partId: r1.id, pin: "1" }]);

		const ir = makeIR([r1], [net1]);
		const res = irToSpice(ir);

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
		const net1 = makeNet("in", [{ partId: r1.id, pin: "1" }]);
		const net2 = makeNet("GND", [{ partId: r1.id, pin: "2" }]);

		const ir = makeIR([r1], [net1, net2]);
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

	for (const payload of maliciousPayloads) {
		test(`prevents injection via part.ref: ${JSON.stringify(payload)}`, () => {
			const part = makePart(payload, "10k");
			const net1 = makeNet("in", [{ partId: part.id, pin: "1" }]);
			const net2 = makeNet("GND", [{ partId: part.id, pin: "2" }]);
			const ir = makeIR([part], [net1, net2]);
			const res = irToSpice(ir);
			assert.strictEqual(res.ok, true);
			assertSafeNetlist(res.netlist);
			const elementName = res.elementMap[part.id];
			if (elementName) {
				assert.strictEqual(/^[A-Za-z0-9_]{1,32}$/.test(elementName), true);
			}
		});

		test(`prevents injection via net.name: ${JSON.stringify(payload)}`, () => {
			const r1 = makePart("R1", "10k");
			const net1 = makeNet(payload, [{ partId: r1.id, pin: "1" }]);
			const net2 = makeNet("GND", [{ partId: r1.id, pin: "2" }]);
			const ir = makeIR([r1], [net1, net2]);
			const res = irToSpice(ir);
			assert.strictEqual(res.ok, true);
			assertSafeNetlist(res.netlist);
			assert.strictEqual(/^[A-Za-z0-9_]+$/.test(res.nodeMap[net1.id]), true);
		});

		test(`prevents injection via part.value: ${JSON.stringify(payload)}`, () => {
			const part = makePart("R1", payload);
			const net1 = makeNet("in", [{ partId: part.id, pin: "1" }]);
			const net2 = makeNet("GND", [{ partId: part.id, pin: "2" }]);
			const ir = makeIR([part], [net1, net2]);
			const res = irToSpice(ir);
			assert.strictEqual(res.ok, true);
			assertSafeNetlist(res.netlist);
		});

		test(`prevents injection via circuit title: ${JSON.stringify(payload)}`, () => {
			const r1 = makePart("R1", "10k");
			const net1 = makeNet("in", [{ partId: r1.id, pin: "1" }]);
			const net2 = makeNet("GND", [{ partId: r1.id, pin: "2" }]);
			const ir = makeIR([r1], [net1, net2], payload);
			const res = irToSpice(ir);
			assert.strictEqual(res.ok, true);
			assertSafeNetlist(res.netlist);
		});
	}

	test("de-duplicates when two parts sanitize to the same name and preserves max 32 chars", () => {
		const r1 = makePart("R1", "10k");
		const r2 = makePart("R-1", "10k");
		const longRef = `R${"A".repeat(40)}`;
		const r3 = makePart(longRef, "10k");
		const net1 = makeNet("in", [
			{ partId: r1.id, pin: "1" },
			{ partId: r2.id, pin: "1" },
			{ partId: r3.id, pin: "1" },
		]);
		const net2 = makeNet("GND", [
			{ partId: r1.id, pin: "2" },
			{ partId: r2.id, pin: "2" },
			{ partId: r3.id, pin: "2" },
		]);
		const ir = makeIR([r1, r2, r3], [net1, net2]);
		const res = irToSpice(ir);
		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[r1.id], "R1");
		assert.strictEqual(res.elementMap[r2.id], "R1_2");
		assert.strictEqual(res.elementMap[r3.id].length <= 32, true);
		assertSafeNetlist(res.netlist);
	});
});
