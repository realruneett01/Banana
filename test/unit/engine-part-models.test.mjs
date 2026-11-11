import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { irToSpice } from "../../backend/src/engine/spice/ir-to-spice.js";
import { modelForPart } from "../../backend/src/engine/spice/part-models.js";

function makePart(ref, value, overrides = {}) {
	return {
		id: newId("part"),
		ref,
		value,
		symbol: `Device:${ref.replace(/\d+$/, "")}`,
		footprint: "Package_SO:SOIC-8_3.9x4.9mm",
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

function makeIR(parts, nets, name = "TestIR") {
	return {
		schemaVersion: 1,
		name,
		parts,
		nets,
		constraints: [],
	};
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
	const safePattern = /^[A-Za-z0-9_ .+\-=(){}*,]+$/;

	test("regulator lines match allowed character set", () => {
		const model = modelForPart(makePart("U1", "AMS1117-3.3"));
		const lines = model.build(
			{ in: "n_in", gnd: "0", out: "n_out" },
			"U1",
			model.params,
		);
		assert.strictEqual(lines.length >= 2, true);
		for (const line of lines) {
			assert.strictEqual(
				safePattern.test(line),
				true,
				`Invalid chars in: ${line}`,
			);
		}
	});

	test("opamp lines match allowed character set", () => {
		const model = modelForPart(makePart("U1", "LM358"));
		const nodes = {
			inp: "n_inp",
			inn: "n_inn",
			out: "n_out",
			vcc: "n_vcc",
			vee: "0",
		};
		const lines = model.build(nodes, "U1", model.params);
		assert.strictEqual(lines.length >= 2, true);
		for (const line of lines) {
			assert.strictEqual(
				safePattern.test(line),
				true,
				`Invalid chars in: ${line}`,
			);
		}
	});

	test("mcu lines match allowed character set", () => {
		const model = modelForPart(makePart("U1", "STM32F103"));
		const lines = model.build(
			{ supply: "n_vcc", gnd: "0" },
			"U1",
			model.params,
		);
		assert.strictEqual(lines.length >= 1, true);
		for (const line of lines) {
			assert.strictEqual(
				safePattern.test(line),
				true,
				`Invalid chars in: ${line}`,
			);
		}
	});
});

describe("modelForPart - security and hostile values", () => {
	const hostilePayloads = [
		"7805\n.control\nshell calc\n",
		"LM358;rm -rf /",
		"`whoami`",
		"STM32;.include /etc/passwd",
	];

	for (const payload of hostilePayloads) {
		test(`hostile payload never appears in output lines: ${JSON.stringify(payload)}`, () => {
			const part = makePart(payload, payload, {
				props: { vout: payload, supplyCurrent: payload },
			});
			const model = modelForPart(part);
			if (model) {
				const nodes = {
					in: "n_in",
					gnd: "0",
					out: "n_out",
					inp: "n_inp",
					inn: "n_inn",
					vcc: "n_vcc",
					vee: "0",
					supply: "n_vcc",
				};
				const lines = model.build(nodes, "U1", model.params);
				for (const line of lines) {
					assert.strictEqual(line.includes(".control"), false);
					assert.strictEqual(line.includes("shell"), false);
					assert.strictEqual(line.includes(";"), false);
					assert.strictEqual(line.includes("`"), false);
					assert.strictEqual(line.includes("\n"), false);
				}
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
		const reg = makePart("U1", "AMS1117-3.3", {
			props: { pinRoles: { in: "1", gnd: "2", out: "3" } },
		});
		const op = makePart("U2", "LM358", {
			props: { pinRoles: { out: "1", inn: "2", inp: "3", vee: "4", vcc: "8" } },
		});
		const mcu = makePart("U3", "STM32F103", {
			props: { pinRoles: { supply: "1", gnd: "2" } },
		});
		const r1 = makePart("R1", "10k");
		const r2 = makePart("R2", "10k");

		const netVin = makeNet("VIN", [
			{ partId: reg.id, pin: "1" },
			{ partId: r1.id, pin: "1" },
		]);
		const netV33 = makeNet("V33", [
			{ partId: reg.id, pin: "3" },
			{ partId: mcu.id, pin: "1" },
			{ partId: op.id, pin: "8" },
		]);
		const netGnd = makeNet("GND", [
			{ partId: reg.id, pin: "2" },
			{ partId: mcu.id, pin: "2" },
			{ partId: op.id, pin: "4" },
			{ partId: r2.id, pin: "2" },
		]);
		const netSig = makeNet("sig", [
			{ partId: r1.id, pin: "2" },
			{ partId: r2.id, pin: "1" },
			{ partId: op.id, pin: "3" },
		]);
		const netOut = makeNet("out", [
			{ partId: op.id, pin: "1" },
			{ partId: op.id, pin: "2" },
		]);

		const ir = makeIR(
			[reg, op, mcu, r1, r2],
			[netVin, netV33, netGnd, netSig, netOut],
		);
		const res = irToSpice(ir);

		assert.strictEqual(res.ok, true);
		assert.strictEqual(res.elementMap[reg.id], "U1");
		assert.strictEqual(res.elementMap[op.id], "U2");
		assert.strictEqual(res.elementMap[mcu.id], "U3");
		assert.strictEqual(res.elementMap[r1.id], "R1");
		assert.strictEqual(res.elementMap[r2.id], "R2");

		assert.strictEqual(res.netlist.includes("B_U1"), true);
		assert.strictEqual(res.netlist.includes("R_U2_in"), true);
		assert.strictEqual(res.netlist.includes("I_U3"), true);
		assert.strictEqual(res.netlist.includes("R1 n_VIN n_sig 10000"), true);
		assert.strictEqual(res.netlist.includes("R2 n_sig 0 10000"), true);
	});
});
