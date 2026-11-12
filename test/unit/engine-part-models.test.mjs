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

function assertPayloadLinesSafe(netlist) {
	const nonCommentLines = netlist
		.split("\n")
		.filter(
			(line) => line && !line.startsWith("*") && !line.startsWith(".save"),
		);
	assertSafeCharacters(nonCommentLines);
}

function assertForbiddenSubstrings(lines) {
	const forbidden = [".control", "shell", ";", "`", "\n"];
	for (const line of lines) {
		for (const sub of forbidden) {
			assert.strictEqual(line.includes(sub), false);
		}
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
		reg: makePart("U1", "AMS1117-3.3", {
			props: { pinRoles: { in: "1", gnd: "2", out: "3" } },
		}),
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
	const reg = makePart(ref, "AMS1117-3.3", {
		props: { pinRoles: { in: "1", gnd: "2", out: "3" } },
	});
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
	const detectionCases = [
		{
			name: "AMS1117-3.3 by value",
			part: makePart("U1", "AMS1117-3.3"),
			kind: "regulator",
		},
		{ name: "7805 by value", part: makePart("U1", "7805"), kind: "regulator" },
		{
			name: "LM317 by value",
			part: makePart("U1", "LM317"),
			kind: "regulator",
		},
		{ name: "LDO by value", part: makePart("U1", "LDO"), kind: "regulator" },
		{
			name: "regulator keyword",
			part: makePart("U1", "Voltage-Regulator"),
			kind: "regulator",
		},
		{
			name: "regulator by props.vout",
			part: makePart("U1", "CustomIC", { props: { vout: "5V" } }),
			kind: "regulator",
		},
		{
			name: "regulator by footprint",
			part: makePart("U1", "Generic", { footprint: "SOT-223_AMS1117" }),
			kind: "regulator",
		},
		{ name: "LM358 by value", part: makePart("U1", "LM358"), kind: "opamp" },
		{ name: "TL072 by value", part: makePart("U1", "TL072"), kind: "opamp" },
		{ name: "LM741 by value", part: makePart("U1", "LM741"), kind: "opamp" },
		{
			name: "MCP6002 by value",
			part: makePart("U1", "MCP6002"),
			kind: "opamp",
		},
		{
			name: "opamp keyword",
			part: makePart("U1", "Dual-OpAmp"),
			kind: "opamp",
		},
		{
			name: "op-amp keyword",
			part: makePart("U1", "Precision-Op-Amp"),
			kind: "opamp",
		},
		{
			name: "opamp by footprint",
			part: makePart("U1", "Generic", { footprint: "SOIC-8_OpAmp" }),
			kind: "opamp",
		},
		{ name: "STM32 by value", part: makePart("U1", "STM32F103"), kind: "mcu" },
		{
			name: "ATmega by value",
			part: makePart("U1", "ATmega328P"),
			kind: "mcu",
		},
		{
			name: "ESP32 by value",
			part: makePart("U1", "ESP32-WROOM"),
			kind: "mcu",
		},
		{ name: "RP2040 by value", part: makePart("U1", "RP2040"), kind: "mcu" },
		{ name: "PIC by value", part: makePart("U1", "PIC16F877A"), kind: "mcu" },
		{ name: "MCU keyword", part: makePart("U1", "Generic-MCU"), kind: "mcu" },
		{
			name: "MCU by supplyCurrent",
			part: makePart("U1", "CustomLogic", { props: { supplyCurrent: 0.03 } }),
			kind: "mcu",
		},
		{
			name: "MCU by footprint",
			part: makePart("U1", "Generic", { footprint: "LQFP-48_STM32" }),
			kind: "mcu",
		},
	];

	for (const { name, part, kind } of detectionCases) {
		test(`detects ${name}`, () => {
			const model = modelForPart(part);
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
	const voutCases = [
		{ value: "7805", props: {}, expected: 5 },
		{ value: "7812", props: {}, expected: 12 },
		{ value: "AMS1117-3.3", props: {}, expected: 3.3 },
		{ value: "AMS1117-5.0", props: {}, expected: 5 },
		{ value: "LDO-3V3", props: {}, expected: 3.3 },
		{ value: "Regulator", props: { vout: "5V" }, expected: 5 },
		{ value: "Regulator", props: { vout: 2.5 }, expected: 2.5 },
		{ value: "LDO", props: {}, expected: 3.3 },
	];

	for (const { value, props, expected } of voutCases) {
		test(`parses vout ${expected} from ${value} with props ${JSON.stringify(props)}`, () => {
			const model = modelForPart(makePart("U1", value, { props }));
			assert.notStrictEqual(model, null);
			assert.strictEqual(model.params.vout, expected);
		});
	}
});

describe("modelForPart - character set and template lines", () => {
	const charsetCases = [
		{
			title: "regulator lines match allowed character set",
			part: makePart("U1", "AMS1117-3.3"),
			nodes: { in: "n_in", gnd: "0", out: "n_out" },
			minLines: 2,
		},
		{
			title: "opamp lines match allowed character set",
			part: makePart("U1", "LM358"),
			nodes: {
				inp: "n_inp",
				inn: "n_inn",
				out: "n_out",
				vcc: "n_vcc",
				vee: "0",
			},
			minLines: 2,
		},
		{
			title: "mcu lines match allowed character set",
			part: makePart("U1", "STM32F103"),
			nodes: { supply: "n_vcc", gnd: "0" },
			minLines: 1,
		},
	];

	for (const { title, part, nodes, minLines } of charsetCases) {
		test(title, () => {
			const model = modelForPart(part);
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
	test("regulator falls back to defaults for non-finite vout and dropout", () => {
		const part = makePart("U1", "LDO", {
			props: { vout: Number.NaN, dropout: Number.POSITIVE_INFINITY },
		});
		const model = modelForPart(part);
		assert.strictEqual(model.params.vout, 3.3);
		assert.strictEqual(model.params.dropout, 1.1);
	});

	test("mcu falls back to default for non-finite supplyCurrent", () => {
		const part = makePart("U1", "MCU", {
			props: { supplyCurrent: "invalid_current" },
		});
		const model = modelForPart(part);
		assert.strictEqual(model.params.supplyCurrent, 0.02);
	});
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
	const prefixCases = [
		{ ref: ";x", rawChar: ";", forbiddenInName: ";" },
		{ ref: "$U1", rawChar: "$", forbiddenInName: "$" },
		{ ref: ".control", rawChar: ".", forbiddenInName: "." },
		{ ref: "'a", rawChar: "'", forbiddenInName: "'" },
		{ ref: " \n.shell", rawChar: ".", forbiddenInName: "." },
		{ ref: "1abc", rawChar: "1", forbiddenInName: null },
	];

	for (const { ref, rawChar, forbiddenInName } of prefixCases) {
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
