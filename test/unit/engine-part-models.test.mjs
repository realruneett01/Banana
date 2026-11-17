import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { irToSpice } from "../../backend/src/engine/spice/ir-to-spice.js";
import { modelForPart } from "../../backend/src/engine/spice/part-models.js";

const makePart = (ref, value, overrides = {}) =>
	Object.assign(
		{
			id: newId("part"),
			ref,
			value,
			symbol: `Device:${ref.replace(/\d+$/, "")}`,
			footprint: "Package_SO:SOIC-8_3.9x4.9mm",
			props: {},
		},
		overrides,
	);

const makeNet = (name, pins = []) => ({ id: newId("net"), name, pins });

const makeIR = (parts, nets, name = "TestIR") => ({
	constraints: [],
	name,
	nets,
	parts,
	schemaVersion: 1,
});

const makeRegulator = (ref = "U1") =>
	makePart(ref, "AMS1117-3.3", {
		props: { pinRoles: { in: "1", gnd: "2", out: "3" } },
	});

const safePattern = /^[A-Za-z0-9_ .+\-=(){}*,]+$/;

function assertSafeCharacters(lines) {
	for (const line of lines) {
		assert.strictEqual(
			safePattern.test(line),
			true,
			`Invalid chars in: ${line}`,
		);
	}
}

function isPayloadLine(line) {
	if (!line || line.startsWith("*")) return false;
	return !line.startsWith(".save");
}

function assertPayloadLinesSafe(netlist) {
	const nonCommentLines = netlist.split("\n").filter(isPayloadLine);
	assertSafeCharacters(nonCommentLines);
}

function assertForbiddenSubstrings(lines) {
	const forbidden = [".control", "shell", ";", "`", "\n"];
	for (const line of lines) {
		const matched = forbidden.find((sub) => line.includes(sub));
		assert.strictEqual(matched, undefined);
	}
}

function assertCircuitSpiceResult(
	res,
	expectedElements,
	expectedNetlistSnippets,
) {
	assert.strictEqual(res.ok, true);
	for (const [id, name] of Object.entries(expectedElements)) {
		assert.strictEqual(res.elementMap[id], name);
	}
	for (const snippet of expectedNetlistSnippets) {
		assert.strictEqual(res.netlist.includes(snippet), true);
	}
}

function makeComplexPartModelCircuit() {
	const parts = {
		reg: makeRegulator("U1"),
		op: makePart("U2", "LM358", {
			props: {
				pinRoles: { out: "1", inn: "2", inp: "3", vee: "4", vcc: "8" },
			},
		}),
		mcu: makePart("U3", "STM32F103", {
			props: { pinRoles: { supply: "1", gnd: "2" } },
		}),
		r1: makePart("R1", "10k"),
		r2: makePart("R2", "10k"),
	};
	const pin = (p, pinNumber) => ({ partId: parts[p].id, pin: pinNumber });
	const nets = [
		makeNet("VIN", [pin("reg", "1"), pin("r1", "1")]),
		makeNet("V33", [pin("reg", "3"), pin("mcu", "1"), pin("op", "8")]),
		makeNet("GND", [
			pin("reg", "2"),
			pin("mcu", "2"),
			pin("op", "4"),
			pin("r2", "2"),
		]),
		makeNet("sig", [pin("r1", "2"), pin("r2", "1"), pin("op", "3")]),
		makeNet("out", [pin("op", "1"), pin("op", "2")]),
	];
	return { parts, ir: makeIR(Object.values(parts), nets) };
}

function convertRegulatorWithRef(ref) {
	const reg = makeRegulator(ref);
	const ir = makeIR(
		[reg],
		[
			makeNet("VIN", [{ partId: reg.id, pin: "1" }]),
			makeNet("V33", [{ partId: reg.id, pin: "3" }]),
			makeNet("GND", [{ partId: reg.id, pin: "2" }]),
		],
	);
	const res = irToSpice(ir);
	assert.strictEqual(res.ok, true);
	assertPayloadLinesSafe(res.netlist);
	return { elementName: res.elementMap[reg.id] };
}

describe("modelForPart - family detection", () => {
	const detectionRows = [
		["AMS1117-3.3 by value", "AMS1117-3.3", "regulator"],
		["7805 by value", "7805", "regulator"],
		["LM317 by value", "LM317", "regulator"],
		["LDO by value", "LDO", "regulator"],
		["regulator keyword", "Voltage-Regulator", "regulator"],
		[
			"regulator by props.vout",
			"CustomIC",
			"regulator",
			{ props: { vout: "5V" } },
		],
		[
			"regulator by footprint",
			"Generic",
			"regulator",
			{ footprint: "SOT-223_AMS1117" },
		],
		["LM358 by value", "LM358", "opamp"],
		["TL072 by value", "TL072", "opamp"],
		["LM741 by value", "LM741", "opamp"],
		["MCP6002 by value", "MCP6002", "opamp"],
		["opamp keyword", "Dual-OpAmp", "opamp"],
		["op-amp keyword", "Precision-Op-Amp", "opamp"],
		["opamp by footprint", "Generic", "opamp", { footprint: "SOIC-8_OpAmp" }],
		["STM32 by value", "STM32F103", "mcu"],
		["ATmega by value", "ATmega328P", "mcu"],
		["ESP32 by value", "ESP32-WROOM", "mcu"],
		["RP2040 by value", "RP2040", "mcu"],
		["PIC by value", "PIC16F877A", "mcu"],
		["MCU keyword", "Generic-MCU", "mcu"],
		[
			"MCU by supplyCurrent",
			"CustomLogic",
			"mcu",
			{ props: { supplyCurrent: 0.03 } },
		],
		["MCU by footprint", "Generic", "mcu", { footprint: "LQFP-48_STM32" }],
	];

	for (const [name, val, kind, overrides] of detectionRows) {
		test(`detects ${name}`, () => {
			const model = modelForPart(makePart("U1", val, overrides));
			assert.notStrictEqual(model, null);
			assert.strictEqual(model.kind, kind);
		});
	}

	test("returns null for unknown IC", () => {
		const unknown = makePart("U1", "UNKNOWN_CHIP_12345");
		assert.strictEqual(modelForPart(unknown), null);
	});
});

describe("modelForPart - vout parsing", () => {
	const voutRows = [
		["7805", {}, 5],
		["7812", {}, 12],
		["AMS1117-3.3", {}, 3.3],
		["AMS1117-5.0", {}, 5],
		["LDO-3V3", {}, 3.3],
		["Regulator", { vout: "5V" }, 5],
		["Regulator", { vout: 2.5 }, 2.5],
		["LDO", {}, 3.3],
	];

	for (const [val, props, expected] of voutRows) {
		test(`parses vout ${expected} from ${val} with props ${JSON.stringify(props)}`, () => {
			const model = modelForPart(makePart("U1", val, { props }));
			assert.notStrictEqual(model, null);
			assert.strictEqual(model.params.vout, expected);
		});
	}
});

describe("modelForPart - character set and template lines", () => {
	const charsetRows = [
		[
			"regulator lines match allowed character set",
			"AMS1117-3.3",
			{ in: "n_in", gnd: "0", out: "n_out" },
			2,
		],
		[
			"opamp lines match allowed character set",
			"LM358",
			{
				inp: "n_inp",
				inn: "n_inn",
				out: "n_out",
				vcc: "n_vcc",
				vee: "0",
			},
			2,
		],
		[
			"mcu lines match allowed character set",
			"STM32F103",
			{ supply: "n_vcc", gnd: "0" },
			1,
		],
	];

	for (const [title, value, nodes, minLines] of charsetRows) {
		test(title, () => {
			const model = modelForPart(makePart("U1", value));
			const lines = model.build(nodes, "U1", model.params);
			assert.strictEqual(lines.length >= minLines, true);
			assertSafeCharacters(lines);
		});
	}
});

describe("modelForPart - security and hostile values", () => {
	const hostilePayloads = [
		"7805\n.control\nshell calc\n",
		"LM358;rm -rf /",
		"`whoami`",
		"STM32;.include /etc/passwd",
	];

	const hostileNodes = {
		in: "n_in",
		gnd: "0",
		out: "n_out",
		inp: "n_inp",
		inn: "n_inn",
		vcc: "n_vcc",
		vee: "0",
		supply: "n_vcc",
	};

	for (const payload of hostilePayloads) {
		test(`hostile payload never appears in output lines: ${JSON.stringify(payload)}`, () => {
			const part = makePart(payload, payload, {
				props: { vout: payload, supplyCurrent: payload },
			});
			const model = modelForPart(part);
			if (model) {
				const lines = model.build(hostileNodes, "U1", model.params);
				assertForbiddenSubstrings(lines);
			}
		});
	}
});

describe("modelForPart - non-finite numeric props fallback", () => {
	const fallbackCases = [
		{
			title: "regulator falls back to defaults for non-finite vout and dropout",
			value: "LDO",
			props: { vout: Number.NaN, dropout: Number.POSITIVE_INFINITY },
			expected: { vout: 3.3, dropout: 1.1 },
		},
		{
			title: "mcu falls back to default for non-finite supplyCurrent",
			value: "MCU",
			props: { supplyCurrent: "invalid_current" },
			expected: { supplyCurrent: 0.02 },
		},
	];

	for (const { title, value, props, expected } of fallbackCases) {
		test(title, () => {
			const model = modelForPart(makePart("U1", value, { props }));
			for (const [key, val] of Object.entries(expected)) {
				assert.strictEqual(model.params[key], val);
			}
		});
	}
});

describe("irToSpice - integration with part models and passives", () => {
	test("includes regulator, opamp, and mcu in netlist with passives", () => {
		const { parts, ir } = makeComplexPartModelCircuit();
		const res = irToSpice(ir);
		assertCircuitSpiceResult(
			res,
			{
				[parts.reg.id]: "U1",
				[parts.op.id]: "U2",
				[parts.mcu.id]: "U3",
				[parts.r1.id]: "R1",
				[parts.r2.id]: "R2",
			},
			["B_U1", "R_U2_in", "I_U3", "R1 n_VIN n_sig 10000", "R2 n_sig 0 10000"],
		);
	});
});

describe("irToSpice - part model prefix sanitization", () => {
	const prefixRows = [
		[";x", ";", ";"],
		["$U1", "$", "$"],
		[".control", ".", "."],
		["'a", "'", "'"],
		[" \n.shell", ".", "."],
		["1abc", "1", null],
	];

	for (const [ref, rawChar, forbiddenInName] of prefixRows) {
		test(`sanitizes regulator reference ${JSON.stringify(ref)}`, () => {
			const { elementName } = convertRegulatorWithRef(ref);
			assert.notStrictEqual(elementName, undefined);
			assert.strictEqual(elementName.startsWith(rawChar), false);
			assert.strictEqual(elementName.startsWith("U"), true);
			if (forbiddenInName) {
				assert.strictEqual(elementName.includes(forbiddenInName), false);
			}
		});
	}

	test("normal reference U7 produces a name starting with U7", () => {
		const { elementName } = convertRegulatorWithRef("U7");
		assert.strictEqual(elementName.startsWith("U7"), true);
	});
});
