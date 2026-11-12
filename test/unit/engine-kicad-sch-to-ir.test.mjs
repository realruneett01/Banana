import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import { kicadSchToIr } from "../../backend/src/engine/kicad-sch-to-ir.js";
import { irToKicadSch } from "../../backend/src/engine/kicad-sch-writer.js";
import { sym } from "../../backend/src/engine/sexpr.js";

function makeIdCounter() {
	let count = 0;
	return (kind) => {
		count++;
		const hex = String(count).padStart(12, "0");
		return `${kind}_00000000-0000-0000-0000-${hex}`;
	};
}

function makeResistorLibSymbol() {
	return [
		sym("symbol"),
		"Device:R",
		[
			sym("pin"),
			"passive",
			"line",
			[sym("at"), -5, 0, 0],
			[sym("number"), "1"],
		],
		[sym("pin"), "passive", "line", [sym("at"), 5, 0, 0], [sym("number"), "2"]],
	];
}

function makeCapacitorLibSymbol() {
	return [
		sym("symbol"),
		"Device:C",
		[
			sym("pin"),
			"passive",
			"line",
			[sym("at"), 0, 2.54, 270],
			[sym("number"), "1"],
		],
		[
			sym("pin"),
			"passive",
			"line",
			[sym("at"), 0, -2.54, 90],
			[sym("number"), "2"],
		],
	];
}

function normalizeNetMembership(ir) {
	const partIdToRef = new Map(ir.parts.map((p) => [p.id, p.ref]));
	return ir.nets
		.map((net) => {
			const pinKeys = net.pins
				.map((p) => `${partIdToRef.get(p.partId)}.${p.pin}`)
				.sort();
			return { name: net.name, pins: pinKeys };
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

describe("kicadSchToIr garbage and invalid input", () => {
	const GARBAGE_CASES = [
		{ name: "null", input: null },
		{ name: "undefined", input: undefined },
		{ name: "number", input: 42 },
		{ name: "object", input: {} },
		{ name: "empty string", input: "" },
		{ name: "whitespace only", input: "   \n\t  " },
		{ name: "unbalanced sexpr", input: "(kicad_sch (version 20250114)" },
		{ name: "wrong root symbol", input: "(not_kicad_sch (version 1))" },
		{
			name: "duplicate reference in parts",
			input:
				'(kicad_sch (version 20250114) (symbol (lib_id "Device:R") (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603")) (symbol (lib_id "Device:R") (property "Reference" "R1") (property "Value" "20k") (property "Footprint" "R_0603")))',
		},
	];

	for (const { name, input } of GARBAGE_CASES) {
		test(`returns { ok: false } without throwing for ${name}`, () => {
			const res = kicadSchToIr(input);
			assert.equal(res.ok, false);
			assert.ok(Array.isArray(res.errors));
			assert.ok(res.errors.length > 0);
		});
	}
});

describe("kicadSchToIr symbol and property parsing", () => {
	test("parses symbol properties, placement, and extra props", () => {
		const sch = `(kicad_sch
			(version 20250114)
			(lib_symbols
				(symbol "Device:R"
					(pin passive line (at -5 0 0) (number "1"))
					(pin passive line (at 5 0 0) (number "2"))
				)
			)
			(symbol
				(lib_id "Device:R")
				(at 100 150 90)
				(property "Reference" "R1")
				(property "Value" "10k")
				(property "Footprint" "Resistor_SMD:R_0603")
				(property "Tolerance" "1%")
				(property "Manufacturer" "Yageo")
			)
		)`;

		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.equal(res.ir.parts.length, 1);

		const part = res.ir.parts[0];
		assert.equal(part.ref, "R1");
		assert.equal(part.value, "10k");
		assert.equal(part.footprint, "Resistor_SMD:R_0603");
		assert.equal(part.symbol, "Device:R");
		assert.deepEqual(part.props, { Tolerance: "1%", Manufacturer: "Yageo" });
		assert.deepEqual(part.placement, { x: 100, y: 150, rot: 90, side: "F" });

		const valid = validateCircuitIR(res.ir);
		assert.equal(valid.ok, true);
	});

	test("skips power symbols and #-prefixed references", () => {
		const sch = `(kicad_sch
			(version 20250114)
			(symbol (lib_id "power:GND") (at 10 10 0) (property "Reference" "#PWR0101") (property "Value" "GND") (property "Footprint" ""))
			(symbol (lib_id "power:+3V3") (at 20 20 0) (property "Reference" "#PWR0102") (property "Value" "+3V3") (property "Footprint" ""))
			(symbol (lib_id "Mechanical:MountingHole") (at 30 30 0) (property "Reference" "#H1") (property "Value" "Hole") (property "Footprint" "MountingHole:3mm"))
			(symbol (lib_id "Device:R") (at 40 40 0) (property "Reference" "R1") (property "Value" "1k") (property "Footprint" "Resistor_SMD:R_0603"))
		)`;

		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.equal(res.ir.parts.length, 1);
		assert.equal(res.ir.parts[0].ref, "R1");
	});
});

describe("kicadSchToIr net connectivity and naming", () => {
	test("wires join pin coordinates and label names the net", () => {
		const sch = `(kicad_sch
			(version 20250114)
			(lib_symbols
				(symbol "Device:R"
					(pin passive line (at -5 0 0) (number "1"))
					(pin passive line (at 5 0 0) (number "2"))
				)
			)
			(symbol (lib_id "Device:R") (at 50 50 0) (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603"))
			(symbol (lib_id "Device:R") (at 100 50 0) (property "Reference" "R2") (property "Value" "20k") (property "Footprint" "R_0603"))
			(wire (pts (xy 55 50) (xy 95 50)))
			(label "SIG_OUT" (at 75 50 0))
		)`;

		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.equal(res.ir.nets.length, 1);
		assert.equal(res.ir.nets[0].name, "SIG_OUT");

		const partMap = new Map(res.ir.parts.map((p) => [p.id, p.ref]));
		const pins = res.ir.nets[0].pins
			.map((p) => `${partMap.get(p.partId)}.${p.pin}`)
			.sort();
		assert.deepEqual(pins, ["R1.2", "R2.1"]);
	});

	test("unlabeled connected pins receive Net-(<ref>-Pad<pin>) name", () => {
		const sch = `(kicad_sch
			(version 20250114)
			(lib_symbols
				(symbol "Device:R"
					(pin passive line (at -5 0 0) (number "1"))
					(pin passive line (at 5 0 0) (number "2"))
				)
			)
			(symbol (lib_id "Device:R") (at 30 40 0) (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603"))
			(symbol (lib_id "Device:R") (at 60 40 0) (property "Reference" "R2") (property "Value" "10k") (property "Footprint" "R_0603"))
			(wire (pts (xy 35 40) (xy 55 40)))
		)`;

		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.equal(res.ir.nets.length, 1);
		assert.equal(res.ir.nets[0].name, "Net-(R1-Pad2)");
	});

	test("records warning on unsupported buses and sheets without failing", () => {
		const sch = `(kicad_sch
			(version 20250114)
			(bus (pts (xy 10 10) (xy 50 10)))
			(sheet (at 20 20) (size 10 10))
			(symbol (lib_id "Device:R") (at 30 30 0) (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603"))
		)`;

		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.ok(res.warnings.some((w) => w.includes("bus")));
		assert.ok(res.warnings.some((w) => w.includes("sheet")));
	});

	test("computes pin positions with rotation and mirror", () => {
		const sch = `(kicad_sch
			(version 20250114)
			(lib_symbols
				(symbol "Device:R"
					(pin passive line (at -5 0 0) (number "1"))
					(pin passive line (at 5 0 0) (number "2"))
				)
			)
			(symbol
				(lib_id "Device:R")
				(at 100 100 90)
				(mirror x)
				(property "Reference" "R1")
				(property "Value" "10k")
				(property "Footprint" "R_0603")
			)
			(global_label "NET_PIN1" (at 100 95 0))
		)`;

		const res = kicadSchToIr(sch, { idFn: makeIdCounter() });
		assert.equal(res.ok, true);
		assert.equal(res.ir.nets.length, 1);
		assert.equal(res.ir.nets[0].name, "NET_PIN1");
		assert.equal(res.ir.nets[0].pins[0].pin, "1");
	});
});

describe("kicadSchToIr round trip with kicad-sch-writer", () => {
	const ROUND_TRIP_CIRCUITS = [
		{
			name: "SingleResistorNet",
			parts: [
				{
					id: "part_00000000-0000-0000-0000-000000000001",
					ref: "R1",
					value: "10k",
					symbol: "Device:R",
					footprint: "Resistor_SMD:R_0603_1608Metric",
					props: {},
				},
				{
					id: "part_00000000-0000-0000-0000-000000000002",
					ref: "R2",
					value: "4.7k",
					symbol: "Device:R",
					footprint: "Resistor_SMD:R_0603_1608Metric",
					props: {},
				},
			],
			nets: [
				{
					id: "net_00000000-0000-0000-0000-000000000001",
					name: "VCC",
					pins: [
						{
							partId: "part_00000000-0000-0000-0000-000000000001",
							pin: "1",
						},
						{
							partId: "part_00000000-0000-0000-0000-000000000002",
							pin: "1",
						},
					],
				},
				{
					id: "net_00000000-0000-0000-0000-000000000002",
					name: "MID",
					pins: [
						{
							partId: "part_00000000-0000-0000-0000-000000000001",
							pin: "2",
						},
						{
							partId: "part_00000000-0000-0000-0000-000000000002",
							pin: "2",
						},
					],
				},
			],
		},
		{
			name: "RC_Filter",
			parts: [
				{
					id: "part_00000000-0000-0000-0000-000000000011",
					ref: "R1",
					value: "1k",
					symbol: "Device:R",
					footprint: "Resistor_SMD:R_0603_1608Metric",
					props: {},
				},
				{
					id: "part_00000000-0000-0000-0000-000000000012",
					ref: "C1",
					value: "100n",
					symbol: "Device:C",
					footprint: "Capacitor_SMD:C_0603_1608Metric",
					props: {},
				},
			],
			nets: [
				{
					id: "net_00000000-0000-0000-0000-000000000011",
					name: "AUDIO_IN",
					pins: [
						{
							partId: "part_00000000-0000-0000-0000-000000000011",
							pin: "1",
						},
					],
				},
				{
					id: "net_00000000-0000-0000-0000-000000000012",
					name: "FILTERED",
					pins: [
						{
							partId: "part_00000000-0000-0000-0000-000000000011",
							pin: "2",
						},
						{
							partId: "part_00000000-0000-0000-0000-000000000012",
							pin: "1",
						},
					],
				},
				{
					id: "net_00000000-0000-0000-0000-000000000013",
					name: "GND",
					pins: [
						{
							partId: "part_00000000-0000-0000-0000-000000000012",
							pin: "2",
						},
					],
				},
			],
		},
	];

	const libSymbols = {
		"Device:R": makeResistorLibSymbol(),
		"Device:C": makeCapacitorLibSymbol(),
	};

	const pinOffsets = {
		"Device:R": {
			1: { dx: -5, dy: 0 },
			2: { dx: 5, dy: 0 },
		},
		"Device:C": {
			1: { dx: 0, dy: 2.54 },
			2: { dx: 0, dy: -2.54 },
		},
	};

	for (const circuit of ROUND_TRIP_CIRCUITS) {
		test(`round-trips ${circuit.name} preserving parts and net membership`, () => {
			const originalIR = {
				schemaVersion: 1,
				name: circuit.name,
				parts: circuit.parts,
				nets: circuit.nets,
				constraints: [],
			};

			const { text } = irToKicadSch(originalIR, { libSymbols, pinOffsets });
			const imported = kicadSchToIr(text, {
				name: circuit.name,
				idFn: makeIdCounter(),
			});

			assert.equal(imported.ok, true);
			const valid = validateCircuitIR(imported.ir);
			assert.equal(valid.ok, true);

			assert.equal(imported.ir.parts.length, originalIR.parts.length);
			for (let i = 0; i < originalIR.parts.length; i++) {
				const orig = originalIR.parts[i];
				const match = imported.ir.parts.find((p) => p.ref === orig.ref);
				assert.ok(match, `Part ${orig.ref} must exist`);
				assert.equal(match.value, orig.value);
				assert.equal(match.footprint, orig.footprint);
				assert.equal(match.symbol, orig.symbol);
			}

			const expectedMembership = normalizeNetMembership(originalIR);
			const importedMembership = normalizeNetMembership(imported.ir);
			assert.deepEqual(importedMembership, expectedMembership);
		});
	}
});

describe("kicadSchToIr multi-unit symbols and unannotated references", () => {
	const MULTI_UNIT_SCH = `(kicad_sch
		(version 20250114)
		(lib_symbols
			(symbol "Simulation:DualOpamp"
				(symbol "DualOpamp_0_1"
					(pin power_in line (at 0 10 270) (number "3"))
				)
				(symbol "DualOpamp_1_1"
					(pin output line (at 5 0 180) (number "1"))
				)
				(symbol "DualOpamp_2_1"
					(pin output line (at 5 0 180) (number "2"))
				)
			)
		)
		(symbol
			(lib_id "Simulation:DualOpamp")
			(at 50 50 0)
			(unit 1)
			(property "Reference" "U1")
			(property "Value" "Dual")
			(property "Footprint" "SOIC-8")
		)
		(symbol
			(lib_id "Simulation:DualOpamp")
			(at 100 50 0)
			(unit 2)
			(property "Reference" "U1")
			(property "Value" "Dual")
			(property "Footprint" "SOIC-8")
		)
		(label "NET_A" (at 55 50 0))
		(label "NET_B" (at 105 50 0))
		(label "NET_VCC1" (at 50 60 0))
		(label "NET_VCC2" (at 100 60 0))
	)`;

	const UNANNOTATED_SCH = `(kicad_sch
		(version 20250114)
		(lib_symbols
			(symbol "Device:R"
				(pin passive line (at -5 0 0) (number "1"))
				(pin passive line (at 5 0 0) (number "2"))
			)
		)
		(symbol
			(lib_id "Device:R")
			(at 30 30 0)
			(property "Reference" "R?")
			(property "Value" "10k")
			(property "Footprint" "R_0603")
		)
		(symbol
			(lib_id "Device:R")
			(at 60 30 0)
			(property "Reference" "R?")
			(property "Value" "20k")
			(property "Footprint" "R_0603")
		)
	)`;

	const TEST_CASES = [
		{
			name: "multi-unit symbol instances merge into one part with unit-specific and common pins",
			sch: MULTI_UNIT_SCH,
			expectedOk: true,
			expectedParts: ["U1"],
			expectedNets: [
				{ name: "NET_A", pins: ["U1.1"] },
				{ name: "NET_B", pins: ["U1.2"] },
				{ name: "NET_VCC1", pins: ["U1.3"] },
				{ name: "NET_VCC2", pins: ["U1.3"] },
			],
			expectedWarningCount: 0,
		},
		{
			name: "repeated unannotated references receive unique suffixes and push warning",
			sch: UNANNOTATED_SCH,
			expectedOk: true,
			expectedParts: ["R?", "R?_2"],
			expectedNets: [],
			expectedWarningCount: 1,
			expectedWarningSubstring: "renamed unannotated reference",
		},
	];

	for (const tc of TEST_CASES) {
		test(tc.name, () => {
			const res = kicadSchToIr(tc.sch, { idFn: makeIdCounter() });
			assert.equal(res.ok, tc.expectedOk);
			const partRefs = res.ir.parts.map((p) => p.ref);
			assert.deepEqual(partRefs, tc.expectedParts);
			assert.equal(res.warnings.length, tc.expectedWarningCount);
			if (tc.expectedWarningSubstring) {
				assert.ok(res.warnings[0].includes(tc.expectedWarningSubstring));
			}
			const partMap = new Map(res.ir.parts.map((p) => [p.id, p.ref]));
			for (const expectedNet of tc.expectedNets) {
				const net = res.ir.nets.find((n) => n.name === expectedNet.name);
				assert.ok(net, `Net ${expectedNet.name} must exist`);
				const pins = net.pins.map((p) => `${partMap.get(p.partId)}.${p.pin}`);
				assert.deepEqual(pins, expectedNet.pins);
			}
		});
	}
});
