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

function makeTwoPinLibSymbol(name, p1At, p2At) {
	return [
		sym("symbol"),
		name,
		[sym("pin"), "passive", "line", [sym("at"), ...p1At], [sym("number"), "1"]],
		[sym("pin"), "passive", "line", [sym("at"), ...p2At], [sym("number"), "2"]],
	];
}

const makeResistorLibSymbol = () =>
	makeTwoPinLibSymbol("Device:R", [-5, 0, 0], [5, 0, 0]);

const makeCapacitorLibSymbol = () =>
	makeTwoPinLibSymbol("Device:C", [0, 2.54, 270], [0, -2.54, 90]);

function makeTestPart([idNum, ref, value, symbol, footprint]) {
	const hex = String(idNum).padStart(12, "0");
	return {
		id: `part_00000000-0000-0000-0000-${hex}`,
		ref,
		value,
		symbol,
		footprint,
		props: {},
	};
}

function makeTestNet(idNum, name, pins) {
	const hex = String(idNum).padStart(12, "0");
	return {
		id: `net_00000000-0000-0000-0000-${hex}`,
		name,
		pins: pins.map(([partIdNum, pin]) => ({
			partId: `part_00000000-0000-0000-0000-${String(partIdNum).padStart(12, "0")}`,
			pin,
		})),
	};
}

const RESISTOR_LIB_SYMBOL_SEXPR = `(lib_symbols
	(symbol "Device:R"
		(pin passive line (at -5 0 0) (number "1"))
		(pin passive line (at 5 0 0) (number "2"))
	)
)`;

function makeDuplicateRefSch(ref1, ref2, unitStr = "") {
	return `(kicad_sch
		(version 20250114)
		${RESISTOR_LIB_SYMBOL_SEXPR}
		(symbol
			(lib_id "Device:R")
			(at 30 30 0)
			${unitStr}
			(property "Reference" "${ref1}")
			(property "Value" "10k")
			(property "Footprint" "R_0603")
		)
		(symbol
			(lib_id "Device:R")
			(at 60 30 0)
			${unitStr}
			(property "Reference" "${ref2}")
			(property "Value" "20k")
			(property "Footprint" "R_0603")
		)
	)`;
}

const importSch = (sch) => kicadSchToIr(sch, { idFn: makeIdCounter() });

// Imports sch, asserts ok and that ir[kind] has `count` entries.
function importExpecting(sch, kind, count) {
	const res = importSch(sch);
	assert.equal(res.ok, true);
	assert.equal(res.ir[kind].length, count);
	return res;
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

function assertImportedPartsMatch(importedParts, originalParts) {
	assert.equal(importedParts.length, originalParts.length);
	for (const orig of originalParts) {
		const match = importedParts.find((p) => p.ref === orig.ref);
		assert.ok(match, `Part ${orig.ref} must exist`);
		assert.equal(match.value, orig.value);
		assert.equal(match.footprint, orig.footprint);
		assert.equal(match.symbol, orig.symbol);
	}
}

function assertExpectedNets(nets, parts, expectedNets) {
	const partMap = new Map(parts.map((p) => [p.id, p.ref]));
	for (const expectedNet of expectedNets) {
		const net = nets.find((n) => n.name === expectedNet.name);
		assert.ok(net, `Net ${expectedNet.name} must exist`);
		const pins = net.pins.map((p) => `${partMap.get(p.partId)}.${p.pin}`);
		assert.deepEqual(pins, expectedNet.pins);
	}
}

const SYMBOL_PARSING_SCH = `(kicad_sch
	(version 20250114)
	${RESISTOR_LIB_SYMBOL_SEXPR}
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

const POWER_AND_VIRTUAL_SYMBOLS_SCH = `(kicad_sch
	(version 20250114)
	(symbol (lib_id "power:GND") (at 10 10 0) (property "Reference" "#PWR0101") (property "Value" "GND") (property "Footprint" ""))
	(symbol (lib_id "power:+3V3") (at 20 20 0) (property "Reference" "#PWR0102") (property "Value" "+3V3") (property "Footprint" ""))
	(symbol (lib_id "Mechanical:MountingHole") (at 30 30 0) (property "Reference" "#H1") (property "Value" "Hole") (property "Footprint" "MountingHole:3mm"))
	(symbol (lib_id "Device:R") (at 40 40 0) (property "Reference" "R1") (property "Value" "1k") (property "Footprint" "Resistor_SMD:R_0603"))
)`;

const LABELED_NET_SCH = `(kicad_sch
	(version 20250114)
	${RESISTOR_LIB_SYMBOL_SEXPR}
	(symbol (lib_id "Device:R") (at 50 50 0) (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603"))
	(symbol (lib_id "Device:R") (at 100 50 0) (property "Reference" "R2") (property "Value" "20k") (property "Footprint" "R_0603"))
	(wire (pts (xy 55 50) (xy 95 50)))
	(label "SIG_OUT" (at 75 50 0))
)`;

const UNLABELED_NET_SCH = `(kicad_sch
	(version 20250114)
	${RESISTOR_LIB_SYMBOL_SEXPR}
	(symbol (lib_id "Device:R") (at 30 40 0) (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603"))
	(symbol (lib_id "Device:R") (at 60 40 0) (property "Reference" "R2") (property "Value" "10k") (property "Footprint" "R_0603"))
	(wire (pts (xy 35 40) (xy 55 40)))
)`;

const BUS_AND_SHEET_SCH = `(kicad_sch
	(version 20250114)
	(bus (pts (xy 10 10) (xy 50 10)))
	(sheet (at 20 20) (size 10 10))
	(symbol (lib_id "Device:R") (at 30 30 0) (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0603"))
)`;

const ROTATION_MIRROR_SCH = `(kicad_sch
	(version 20250114)
	${RESISTOR_LIB_SYMBOL_SEXPR}
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
	];

	for (const { name, input } of GARBAGE_CASES) {
		test(`returns { ok: false } without throwing for ${name}`, () => {
			const res = kicadSchToIr(input);
			assert.equal(res.ok, false);
			assert.equal(Array.isArray(res.errors), true);
			assert.ok(res.errors.length > 0);
		});
	}
});

describe("kicadSchToIr symbol and property parsing", () => {
	test("parses symbol properties and validates circuit IR", () => {
		const res = importExpecting(SYMBOL_PARSING_SCH, "parts", 1);
		const part = res.ir.parts[0];
		assert.equal(part.ref, "R1");
		assert.equal(part.value, "10k");
		assert.equal(part.footprint, "Resistor_SMD:R_0603");
		assert.equal(part.symbol, "Device:R");
		const valid = validateCircuitIR(res.ir);
		assert.equal(valid.ok, true);
	});

	test("parses symbol extra props and placement", () => {
		const res = importSch(SYMBOL_PARSING_SCH);
		const part = res.ir.parts[0];
		assert.deepEqual(part.props, { Tolerance: "1%", Manufacturer: "Yageo" });
		assert.deepEqual(part.placement, { x: 100, y: 150, rot: 90, side: "F" });
	});

	test("skips power symbols and #-prefixed references", () => {
		const res = importExpecting(POWER_AND_VIRTUAL_SYMBOLS_SCH, "parts", 1);
		assert.equal(res.ir.parts[0].ref, "R1");
	});
});

describe("kicadSchToIr net connectivity and naming", () => {
	test("wires join pin coordinates and label names the net", () => {
		const res = importExpecting(LABELED_NET_SCH, "nets", 1);
		assert.equal(res.ir.nets[0].name, "SIG_OUT");

		const partMap = new Map(res.ir.parts.map((p) => [p.id, p.ref]));
		const pins = res.ir.nets[0].pins
			.map((p) => `${partMap.get(p.partId)}.${p.pin}`)
			.sort();
		assert.deepEqual(pins, ["R1.2", "R2.1"]);
	});

	test("unlabeled connected pins receive Net-(<ref>-Pad<pin>) name", () => {
		const [net] = importExpecting(UNLABELED_NET_SCH, "nets", 1).ir.nets;
		assert.equal(net.name, "Net-(R1-Pad2)");
	});

	test("records warning on unsupported buses and sheets without failing", () => {
		const res = importSch(BUS_AND_SHEET_SCH);
		assert.equal(res.ok, true);
		assert.equal(
			res.warnings.some((w) => w.includes("bus")),
			true,
		);
		assert.ok(res.warnings.some((w) => w.includes("sheet")));
	});

	test("computes pin positions with rotation and mirror", () => {
		const res = importExpecting(ROTATION_MIRROR_SCH, "nets", 1);
		assert.equal(res.ir.nets[0].pins[0].pin, "1");
		assert.equal(res.ir.nets[0].name, "NET_PIN1");
	});
});

describe("kicadSchToIr round trip with kicad-sch-writer", () => {
	const R_0603 = "Resistor_SMD:R_0603_1608Metric";
	// parts: [idNum, ref, value, symbol, footprint]
	const ROUND_TRIP_CIRCUITS = [
		{
			name: "SingleResistorNet",
			parts: [
				makeTestPart([1, "R1", "10k", "Device:R", R_0603]),
				makeTestPart([2, "R2", "4.7k", "Device:R", R_0603]),
			],
			nets: [
				makeTestNet(1, "VCC", [
					[1, "1"],
					[2, "1"],
				]),
				makeTestNet(2, "MID", [
					[1, "2"],
					[2, "2"],
				]),
			],
		},
		{
			name: "RC_Filter",
			parts: [
				makeTestPart([11, "R1", "1k", "Device:R", R_0603]),
				makeTestPart([
					12,
					"C1",
					"100n",
					"Device:C",
					"Capacitor_SMD:C_0603_1608Metric",
				]),
			],
			nets: [
				makeTestNet(11, "AUDIO_IN", [[11, "1"]]),
				makeTestNet(12, "FILTERED", [
					[11, "2"],
					[12, "1"],
				]),
				makeTestNet(13, "GND", [[12, "2"]]),
			],
		},
	];

	const libSymbols = {
		"Device:R": makeResistorLibSymbol(),
		"Device:C": makeCapacitorLibSymbol(),
	};

	// Sheet-space (Y-down) offsets of the Y-up lib pins above.
	const pinOffsets = {
		"Device:R": {
			1: { dx: -5, dy: 0 },
			2: { dx: 5, dy: 0 },
		},
		"Device:C": {
			1: { dx: 0, dy: -2.54 },
			2: { dx: 0, dy: 2.54 },
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
			assertImportedPartsMatch(imported.ir.parts, originalIR.parts);
			assert.deepEqual(
				normalizeNetMembership(imported.ir),
				normalizeNetMembership(originalIR),
			);
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
		(label "NET_VCC1" (at 50 40 0))
		(label "NET_VCC2" (at 100 40 0))
	)`;

	const UNANNOTATED_SCH = makeDuplicateRefSch("R?", "R?");
	const DUPLICATE_ANNOTATED_SCH = makeDuplicateRefSch("R1", "R1", "(unit 1)");

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
			expectedWarningSubstring: "renamed duplicate reference",
		},
		{
			name: "duplicate annotated references receive unique suffixes and push warning",
			sch: DUPLICATE_ANNOTATED_SCH,
			expectedOk: true,
			expectedParts: ["R1", "R1_2"],
			expectedNets: [],
			expectedWarningCount: 1,
			expectedWarningSubstring: "renamed duplicate reference",
		},
	];

	for (const tc of TEST_CASES) {
		test(tc.name, () => {
			const res = importSch(tc.sch);
			assert.equal(res.ok, tc.expectedOk);
			const partRefs = res.ir.parts.map((p) => p.ref);
			assert.deepEqual(partRefs, tc.expectedParts);
			assert.equal(res.warnings.length, tc.expectedWarningCount);
			if (tc.expectedWarningSubstring) {
				assert.ok(res.warnings[0].includes(tc.expectedWarningSubstring));
			}
			assertExpectedNets(res.ir.nets, res.ir.parts, tc.expectedNets);
		});
	}
});

// KiCad file format: lib_symbols pin coordinates are Y-up, schematic sheet
// coordinates are Y-down, and a symbol's (at x y angle) turns it
// counter-clockwise as seen on the sheet; (mirror ...) applies after rotation.
describe("kicadSchToIr KiCad symbol coordinate conventions", () => {
	const VERTICAL_LIB = `(lib_symbols
		(symbol "Device:C"
			(pin passive line (at 0 2.54 270) (number "1"))
			(pin passive line (at 0 -2.54 90) (number "2"))
		)
	)`;

	function oneSymbolSch(lib, symbolAttrs, labels) {
		return `(kicad_sch
			(version 20250114)
			${lib}
			(symbol ${symbolAttrs}
				(property "Reference" "C1")
				(property "Value" "100n")
				(property "Footprint" "C_0603")
			)
			${labels}
		)`;
	}

	function labelledPins(sch) {
		const res = importSch(sch);
		assert.equal(res.ok, true, JSON.stringify(res.errors));
		return Object.fromEntries(
			res.ir.nets.map((n) => [n.name, n.pins.map((p) => p.pin).join(",")]),
		);
	}

	test("lib pin with positive Y lands above the symbol origin", () => {
		const sch = oneSymbolSch(
			VERTICAL_LIB,
			`(lib_id "Device:C") (at 50 50 0)`,
			`(label "TOP" (at 50 47.46 0)) (label "BOTTOM" (at 50 52.54 0))`,
		);
		assert.deepEqual(labelledPins(sch), { TOP: "1", BOTTOM: "2" });
	});

	test("rotation 90 turns a top pin to the left of the symbol", () => {
		const sch = oneSymbolSch(
			VERTICAL_LIB,
			`(lib_id "Device:C") (at 50 50 90)`,
			`(label "LEFT" (at 47.46 50 0)) (label "RIGHT" (at 52.54 50 0))`,
		);
		assert.deepEqual(labelledPins(sch), { LEFT: "1", RIGHT: "2" });
	});

	test("instance lib_name selects the matching lib_symbols entry", () => {
		const lib = `(lib_symbols
			(symbol "C_1"
				(pin passive line (at 0 2.54 270) (number "1"))
				(pin passive line (at 0 -2.54 90) (number "2"))
			)
		)`;
		const sch = oneSymbolSch(
			lib,
			`(lib_name "C_1") (lib_id "Device:C") (at 50 50 0)`,
			`(label "TOP" (at 50 47.46 0))`,
		);
		assert.deepEqual(labelledPins(sch), { TOP: "1" });
	});
});
