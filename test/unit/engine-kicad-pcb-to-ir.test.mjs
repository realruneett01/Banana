import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import { kicadPcbToIr } from "../../backend/src/engine/kicad-pcb-to-ir.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";

const F_CU_LAYERS = ["F.Cu", "F.Paste", "F.Mask"];

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
	"Package_TO_SOT_THT:TO-92": [
		{
			number: "1",
			type: "thru_hole",
			shape: "circle",
			at: [-1.27, 0],
			size: [1.5, 1.5],
			drill: 0.8,
			layers: ["*.Cu", "*.Mask"],
		},
		{
			number: "2",
			type: "thru_hole",
			shape: "circle",
			at: [0, 0],
			size: [1.5, 1.5],
			drill: 0.8,
			layers: ["*.Cu", "*.Mask"],
		},
		{
			number: "3",
			type: "thru_hole",
			shape: "circle",
			at: [1.27, 0],
			size: [1.5, 1.5],
			drill: 0.8,
			layers: ["*.Cu", "*.Mask"],
		},
	],
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

function makeIdCounter() {
	let count = 0;
	return (kind) => {
		count++;
		const hex = String(count).padStart(12, "0");
		return `${kind}_00000000-0000-0000-0000-${hex}`;
	};
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

function assertPartsMatch(importedParts, originalParts) {
	assert.equal(importedParts.length, originalParts.length);
	for (const orig of originalParts) {
		const match = importedParts.find((p) => p.ref === orig.ref);
		assert.ok(match, `Part ${orig.ref} must exist`);
		assert.equal(match.value, orig.value);
		assert.equal(match.footprint, orig.footprint);
		assert.deepEqual(match.placement, orig.placement);
	}
}

function assertNetsMatch(importedIr, originalIr) {
	const origNets = normalizeNetMembership(originalIr);
	const impNets = normalizeNetMembership(importedIr);
	assert.deepEqual(impNets, origNets);
}

describe("kicadPcbToIr garbage and invalid input", () => {
	const GARBAGE_CASES = [
		{ name: "null", input: null },
		{ name: "undefined", input: undefined },
		{ name: "number", input: 42 },
		{ name: "object", input: {} },
		{ name: "empty string", input: "" },
		{ name: "whitespace only", input: "   \n\t  " },
		{ name: "unbalanced sexpr", input: "(kicad_pcb (version 20241229)" },
		{ name: "wrong root symbol", input: "(not_kicad_pcb (version 1))" },
		{
			name: "duplicate reference in parts",
			input:
				'(kicad_pcb (version 20241229) (footprint "R_0805" (property "Reference" "R1") (property "Value" "10k")) (footprint "R_0805" (property "Reference" "R1") (property "Value" "20k")))',
		},
	];

	for (const { name, input } of GARBAGE_CASES) {
		test(`returns { ok: false } without throwing for ${name}`, () => {
			const res = kicadPcbToIr(input);
			assert.equal(res.ok, false);
			assert.ok(Array.isArray(res.errors));
			assert.ok(res.errors.length > 0);
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
		assert.equal(res.ok, true);
		assert.equal(res.ir.parts.length, 1);
		const p = res.ir.parts[0];
		assert.equal(p.ref, "R1");
		assert.equal(p.value, "10k");
		assert.equal(p.footprint, "Resistor_SMD:R_0805");
		assert.deepEqual(p.placement, { x: 50, y: 30, rot: 90, side: "F" });
		assert.deepEqual(p.props, { Tolerance: "1%" });
		assert.equal(res.ir.nets.length, 1);
		assert.equal(res.ir.nets[0].name, "GND");
		assert.deepEqual(res.ir.nets[0].pins, [{ partId: p.id, pin: "1" }]);
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
		assert.equal(res.ok, true);
		assert.equal(res.ir.parts.length, 1);
		const p = res.ir.parts[0];
		assert.equal(p.ref, "C1");
		assert.equal(p.value, "100nF");
		assert.equal(p.footprint, "Capacitor_SMD:C_0603");
		assert.deepEqual(p.placement, { x: 20, y: 40, rot: 180, side: "B" });
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
		assert.equal(res.ok, true);
		const gndNetId = res.ir.nets.find((n) => n.name === "GND")?.id;
		const vccNetId = res.ir.nets.find((n) => n.name === "+3V3")?.id;
		assert.ok(gndNetId);
		assert.ok(vccNetId);

		assert.equal(res.board.tracks.length, 1);
		assert.deepEqual(res.board.tracks[0], {
			netId: gndNetId,
			layer: "F.Cu",
			start: [10, 20],
			end: [30, 40],
			widthMm: 0.25,
		});

		assert.equal(res.board.vias.length, 1);
		assert.deepEqual(res.board.vias[0], {
			netId: gndNetId,
			at: [30, 40],
			drillMm: 0.4,
			sizeMm: 0.8,
		});

		assert.equal(res.board.zones.length, 1);
		assert.deepEqual(res.board.zones[0], {
			netId: vccNetId,
			layer: "B.Cu",
			polygon: [
				[0, 0],
				[50, 0],
				[50, 50],
				[0, 50],
			],
		});
	});
});

describe("kicadPcbToIr Edge.Cuts board outline", () => {
	test("extracts rectangular outline from gr_rect", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(gr_rect (start 0 0) (end 100 80) (layer "Edge.Cuts"))
		)`;
		const res = kicadPcbToIr(text);
		assert.equal(res.ok, true);
		assert.deepEqual(res.board.outline, [
			[0, 0],
			[100, 0],
			[100, 80],
			[0, 80],
		]);
	});

	test("extracts chained line loop from gr_line elements", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(gr_line (start 0 0) (end 60 0) (layer "Edge.Cuts"))
			(gr_line (start 60 0) (end 60 40) (layer "Edge.Cuts"))
			(gr_line (start 60 40) (end 0 40) (layer "Edge.Cuts"))
			(gr_line (start 0 40) (end 0 0) (layer "Edge.Cuts"))
		)`;
		const res = kicadPcbToIr(text);
		assert.equal(res.ok, true);
		assert.deepEqual(res.board.outline, [
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
		assert.equal(res.ok, true);
		assert.ok(Array.isArray(res.board.outline));
		assert.ok(res.board.outline.length >= 10);
	});

	test("returns outline null when no Edge.Cuts elements exist", () => {
		const text = `(kicad_pcb
			(version 20241229)
			(layers (0 "F.Cu" signal))
		)`;
		const res = kicadPcbToIr(text);
		assert.equal(res.ok, true);
		assert.equal(res.board.outline, null);
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

		assert.equal(imported.ok, true);
		assert.equal(validateCircuitIR(imported.ir).ok, true);
		assertPartsMatch(imported.ir.parts, ROUND_TRIP_IR.parts);
		assertNetsMatch(imported.ir, ROUND_TRIP_IR);
		assert.deepEqual(imported.board.outline, [
			[0, 0],
			[100, 0],
			[100, 80],
			[0, 80],
		]);
	});

	test("deterministic idFn gives repeatable IDs", () => {
		const text = `(kicad_pcb (version 20241229) (net 1 "GND") (footprint "R_0805" (property "Reference" "R1") (property "Value" "1k") (pad "1" smd (net 1 "GND"))))`;
		const res1 = kicadPcbToIr(text, { idFn: makeIdCounter() });
		const res2 = kicadPcbToIr(text, { idFn: makeIdCounter() });
		assert.deepEqual(res1, res2);
	});
});
