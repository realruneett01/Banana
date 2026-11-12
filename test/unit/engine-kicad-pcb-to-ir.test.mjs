import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";

const F_CU_LAYERS = ["F.Cu", "F.Paste", "F.Mask"];

const RECT_100_80_OUTLINE = [
	[0, 0],
	[100, 0],
	[100, 80],
	[0, 80],
];

const SAMPLE_FOOTPRINTS = {
	"Resistor_SMD:R_0805": {
		pads: [-1, 1].map((x, idx) => ({
			number: String(idx + 1),
			type: "smd",
			shape: "roundrect",
			at: [x, 0],
			size: [1, 1],
			layers: F_CU_LAYERS,
		})),
	},
	"Package_TO_SOT_THT:TO-92": [-1.27, 0, 1.27].map((x, idx) => ({
		number: String(idx + 1),
		type: "thru_hole",
		shape: "circle",
		at: [x, 0],
		size: [1.5, 1.5],
		drill: 0.8,
		layers: ["*.Cu", "*.Mask"],
	})),
};

const ROUND_TRIP_IR = {
	schemaVersion: 1,
	name: "RoundTripBoard",
	parts: [
		{
			id: "part_00000000-0000-0000-0000-000000000001",
			ref: "R1",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0805",
			props: {},
			placement: { x: 30, y: 40, rot: 90, side: "F" },
		},
		{
			id: "part_00000000-0000-0000-0000-000000000002",
			ref: "Q1",
			value: "2N3904",
			symbol: "Device:Q_NPN",
			footprint: "Package_TO_SOT_THT:TO-92",
			props: {},
			placement: { x: 70, y: 40, rot: 0, side: "B" },
		},
	],
	nets: [
		{
			id: "net_00000000-0000-0000-0000-000000000001",
			name: "GND",
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
			name: "+3V3",
			pins: [
				{
					partId: "part_00000000-0000-0000-0000-000000000001",
					pin: "2",
				},
			],
		},
	],
	constraints: [],
};

const INVALID_INPUTS = [
	["null", null],
	["undefined", undefined],
	["number", 42],
	["object", {}],
	["empty string", ""],
	["whitespace only", "   \n\t  "],
	["unbalanced sexpr", "(kicad_pcb (version 20241229)"],
	["wrong root symbol", "(not_kicad_pcb (version 1))"],
];

const UNIQUE_REF_CASES = [
	{
		name: "two footprints with empty ref produce NOREF_1 and NOREF_2 with two warnings",
		pcb: '(kicad_pcb (version 20241229) (footprint "F1" (property "Reference" "")) (footprint "F2" (property "Reference" "")))',
		expectedRefs: ["NOREF_1", "NOREF_2"],
		expectedWarningCount: 2,
		expectedWarnings: [
			"renamed footprint reference empty to NOREF_1",
			"renamed footprint reference empty to NOREF_2",
		],
	},
	{
		name: "a REF** footprint produces NOREF_1 with one warning",
		pcb: '(kicad_pcb (version 20241229) (footprint "F1" (property "Reference" "REF**")))',
		expectedRefs: ["NOREF_1"],
		expectedWarningCount: 1,
		expectedWarnings: ["renamed footprint reference REF** to NOREF_1"],
	},
	{
		name: "two footprints both R1 produce R1 and R1_2 with one warning and pad net connects",
		pcb: '(kicad_pcb (version 20241229) (net 1 "GND") (footprint "R_0805" (property "Reference" "R1")) (footprint "R_0805" (property "Reference" "R1") (pad "1" smd (net 1 "GND"))))',
		expectedRefs: ["R1", "R1_2"],
		expectedWarningCount: 1,
		expectedWarnings: ["renamed footprint reference R1 to R1_2"],
		expectedNets: [{ name: "GND", partIndex: 1, pin: "1" }],
	},
];

function makeIdCounter() {
	let seq = 0;
	return (prefix) =>
		`${prefix}_00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
}

function assertInvalid(input) {
	const res = kicadPcbToIr(input);
	assert.strictEqual(res?.ok, false);
	assert.strictEqual(Array.isArray(res?.errors) && res.errors.length > 0, true);
}

function assertParsedSinglePart(res, expected) {
	assert.deepEqual(
		{
			ok: res.ok,
			partsCount: res.ir.parts.length,
			part: {
				ref: res.ir.parts[0].ref,
				value: res.ir.parts[0].value,
				footprint: res.ir.parts[0].footprint,
				placement: res.ir.parts[0].placement,
				...(expected.props ? { props: res.ir.parts[0].props } : {}),
			},
		},
		{
			ok: true,
			partsCount: 1,
			part: expected,
		},
	);
	return res.ir.parts[0];
}

function assertCopperGeometry(res, gndNetId, vccNetId) {
	assert.deepEqual(
		{
			ok: res.ok,
			tracks: res.board.tracks,
			vias: res.board.vias,
			zones: res.board.zones,
		},
		{
			ok: true,
			tracks: [
				{
					netId: gndNetId,
					layer: "F.Cu",
					start: [10, 20],
					end: [30, 40],
					widthMm: 0.25,
				},
			],
			vias: [
				{
					netId: gndNetId,
					at: [30, 40],
					drillMm: 0.4,
					sizeMm: 0.8,
				},
			],
			zones: [
				{
					netId: vccNetId,
					layer: "B.Cu",
					polygon: [
						[0, 0],
						[50, 0],
						[50, 50],
						[0, 50],
					],
				},
			],
		},
	);
}

function assertOutlineResult(res, expectedOutline) {
	assert.deepEqual(
		{ ok: res.ok, outline: res.board.outline },
		{ ok: true, outline: expectedOutline },
	);
}

function assertPartsMatch(actualParts, expectedParts) {
	assert.strictEqual(actualParts.length, expectedParts.length);
	const actualByRef = new Map(actualParts.map((p) => [p.ref, p]));
	for (const expected of expectedParts) {
		const match = actualByRef.get(expected.ref);
		assert.ok(match, `Part ${expected.ref} must exist`);
		assert.deepEqual(
			{
				value: match.value,
				footprint: match.footprint,
				placement: match.placement,
			},
			{
				value: expected.value,
				footprint: expected.footprint,
				placement: expected.placement,
			},
		);
	}
}

function assertNetsMatch(actualIr, expectedIr) {
	const buildNetMap = (ir) => {
		const refMap = new Map(ir.parts.map((p) => [p.id, p.ref]));
		return Object.fromEntries(
			ir.nets.map((n) => [
				n.name,
				n.pins.map((p) => `${refMap.get(p.partId)}.${p.pin}`).sort(),
			]),
		);
	};
	assert.deepEqual(buildNetMap(actualIr), buildNetMap(expectedIr));
}

function assertRoundTripSuccess(imported, expectedIR, expectedOutline) {
	assert.strictEqual(imported.ok, true);
	assert.strictEqual(validateCircuitIR(imported.ir).ok, true);
	assertPartsMatch(imported.ir.parts, expectedIR.parts);
	assertNetsMatch(imported.ir, expectedIR);
	assert.deepEqual(imported.board.outline, expectedOutline);
}

function assertNetPinConnected(net, expectedPartId, expectedPin) {
	const hasPin = net.pins.some(
		(p) => p.partId === expectedPartId && p.pin === expectedPin,
	);
	assert.strictEqual(hasPin, true);
}

function assertExpectedNets(nets, parts, expectedNets = []) {
	for (const spec of expectedNets) {
		const net = nets.find((n) => n.name === spec.name);
		assert.ok(net, `Net ${spec.name} must exist`);
		assertNetPinConnected(net, parts[spec.partIndex].id, spec.pin);
	}
}

function assertUniqueRefCase(tc) {
	const res = kicadPcbToIr(tc.pcb);
	assert.strictEqual(res.ok, true);
	assert.deepEqual(
		res.ir.parts.map((p) => p.ref),
		tc.expectedRefs,
	);
	assert.strictEqual(res.warnings.length, tc.expectedWarningCount);
	assert.deepEqual(res.warnings, tc.expectedWarnings);
	assertExpectedNets(res.ir.nets, res.ir.parts, tc.expectedNets);
}

describe("kicadPcbToIr garbage and invalid input", () => {
	for (const [name, input] of INVALID_INPUTS) {
		test(`returns { ok: false } without throwing for ${name}`, () => {
			assertInvalid(input);
		});
	}
});

describe("kicadPcbToIr footprints and legacy fp_text support", () => {
	test("parses modern KiCad 8 property footprints", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(layers (0 "F.Cu" signal) (2 "B.Cu" signal))
			(net 1 "GND")
			(footprint "Resistor_SMD:R_0805"
				(layer "F.Cu")
				(at 50 30 90)
				(property "Reference" "R1")
				(property "Value" "10k")
				(property "Tolerance" "1%")
				(pad "1" smd roundrect (at -1 0) (size 1 1) (net 1 "GND"))
				(pad "2" smd roundrect (at 1 0) (size 1 1))
			)
		)`;
		const res = kicadPcbToIr(text, { idFn: makeIdCounter() });
		const p = assertParsedSinglePart(res, {
			ref: "R1",
			value: "10k",
			footprint: "Resistor_SMD:R_0805",
			placement: { x: 50, y: 30, rot: 90, side: "F" },
			props: { Tolerance: "1%" },
		});
		assert.deepEqual(
			res.ir.nets.map((n) => ({ name: n.name, pins: n.pins })),
			[{ name: "GND", pins: [{ partId: p.id, pin: "1" }] }],
		);
	});

	test("parses older KiCad 6/7 fp_text reference and value and bottom side", () => {
		const text = `(kicad_pcb
			(version 20211014)
			(layers (0 "F.Cu" signal) (2 "B.Cu" signal))
			(footprint "Capacitor_SMD:C_0603"
				(layer "B.Cu")
				(at 20 40 180)
				(fp_text reference "C1" (at 0 -2 0) (layer "B.SilkS"))
				(fp_text value "100nF" (at 0 2 0) (layer "B.Fab"))
				(pad "1" smd roundrect (at -0.75 0) (size 0.8 0.8))
			)
		)`;
		const res = kicadPcbToIr(text, { idFn: makeIdCounter() });
		assertParsedSinglePart(res, {
			ref: "C1",
			value: "100nF",
			footprint: "Capacitor_SMD:C_0603",
			placement: { x: 20, y: 40, rot: 180, side: "B" },
		});
	});
});

describe("kicadPcbToIr copper geometry: tracks, vias, and zones", () => {
	test("parses tracks, vias, and polygon zones with resolved netId", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(layers (0 "F.Cu" signal) (2 "B.Cu" signal))
			(net 1 "GND")
			(net 2 "+3V3")
			(segment (start 10 20) (end 30 40) (width 0.25) (layer "F.Cu") (net 1))
			(via (at 30 40) (size 0.8) (drill 0.4) (net 1))
			(zone (net 2) (layer "B.Cu") (polygon (pts (xy 0 0) (xy 50 0) (xy 50 50) (xy 0 50))))
		)`;
		const res = kicadPcbToIr(text, { idFn: makeIdCounter() });
		const netMap = new Map(res.ir.nets.map((n) => [n.name, n.id]));
		const gndNetId = netMap.get("GND");
		const vccNetId = netMap.get("+3V3");
		assert.strictEqual(Boolean(gndNetId && vccNetId), true);
		assertCopperGeometry(res, gndNetId, vccNetId);
	});
});

describe("kicadPcbToIr Edge.Cuts board outline", () => {
	test("extracts rectangular outline from gr_rect", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(gr_rect (start 0 0) (end 100 80) (layer "Edge.Cuts"))
		)`;
		assertOutlineResult(kicadPcbToIr(text), RECT_100_80_OUTLINE);
	});

	test("extracts chained line loop from gr_line elements", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(gr_line (start 0 0) (end 60 0) (layer "Edge.Cuts"))
			(gr_line (start 60 0) (end 60 40) (layer "Edge.Cuts"))
			(gr_line (start 60 40) (end 0 40) (layer "Edge.Cuts"))
			(gr_line (start 0 40) (end 0 0) (layer "Edge.Cuts"))
		)`;
		assertOutlineResult(kicadPcbToIr(text), [
			[0, 0],
			[60, 0],
			[60, 40],
			[0, 40],
		]);
	});

	test("approximates gr_arc by 8 segments", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(gr_line (start 0 0) (end 50 0) (layer "Edge.Cuts"))
			(gr_line (start 50 0) (end 50 50) (layer "Edge.Cuts"))
			(gr_arc (start 50 50) (mid 25 60) (end 0 50) (layer "Edge.Cuts"))
			(gr_line (start 0 50) (end 0 0) (layer "Edge.Cuts"))
		)`;
		const res = kicadPcbToIr(text);
		assert.deepEqual(
			{
				ok: res.ok,
				isArray: Array.isArray(res.board?.outline),
				hasSegments: (res.board?.outline?.length ?? 0) >= 10,
			},
			{ ok: true, isArray: true, hasSegments: true },
		);
	});

	test("returns outline null when no Edge.Cuts elements exist", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(layers (0 "F.Cu" signal))
		)`;
		assertOutlineResult(kicadPcbToIr(text), null);
	});
});

describe("kicadPcbToIr determinism and round trip", () => {
	test("round trip preserves refs, footprints, placement, and net membership", () => {
		const pcb = irToKicadPcb(ROUND_TRIP_IR, {
			boardW: 100,
			boardH: 80,
			footprints: SAMPLE_FOOTPRINTS,
		});
		const imported = kicadPcbToIr(pcb.text, {
			name: ROUND_TRIP_IR.name,
			idFn: makeIdCounter(),
		});
		assertRoundTripSuccess(imported, ROUND_TRIP_IR, RECT_100_80_OUTLINE);
	});

	test("deterministic idFn gives repeatable IDs", () => {
		const text = `(kicad_pcb (version 20241229) (net 1 "GND") (footprint "R_0805" (property "Reference" "R1") (property "Value" "1k") (pad "1" smd (net 1 "GND"))))`;
		const res1 = kicadPcbToIr(text, { idFn: makeIdCounter() });
		const res2 = kicadPcbToIr(text, { idFn: makeIdCounter() });
		assert.deepEqual(res1, res2);
	});
});

describe("kicadPcbToIr unique references and empty ref handling", () => {
	for (const tc of UNIQUE_REF_CASES) {
		test(tc.name, () => {
			assertUniqueRefCase(tc);
		});
	}
});
