import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { patchKicadText } from "../../backend/src/engine/kicad-inplace.js";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const at = (x, y, rot = 0, side = "F") => ({ x, y, rot, side });

const makePart = (patch = {}) => ({
	id: "p1",
	ref: "R1",
	value: "10k",
	symbol: "Device:R",
	footprint: "Resistor_SMD:R_0603",
	placement: at(10, 20),
	props: {},
	...patch,
});

const makeNet = (name, pins, id = `n_${name}`) => ({
	id,
	name,
	pins: pins.map(([partId, pin]) => ({ partId, pin })),
});

const ir = (parts, nets = []) => ({ parts, nets });

const ADD_SYMBOL_R5 = {
	op: "addSymbol",
	ref: "R5",
	libId: "Device:R",
	value: "10k",
	footprint: "Resistor_SMD:R_0603",
	x: 10,
	y: 20,
	rot: 0,
};

const ADD_FOOTPRINT_R5 = {
	op: "addFootprint",
	ref: "R5",
	libId: "Resistor_SMD:R_0603",
	value: "10k",
	x: 10,
	y: 20,
	rot: 0,
	side: "F",
};

const R5 = makePart({ id: "p5", ref: "R5" });
const R2 = makePart({ id: "p2", ref: "R2", placement: at(40, 20) });

// Pin 1 of a part at (10, 20) sits on the left edge of the 15.24 mm body.
const PIN1_AT_10_20 = { x: 2.38, y: 20 };

const PART_CASES = [
	{
		name: "added part maps to addSymbol and addFootprint",
		before: ir([]),
		after: ir([R5]),
		sch: [ADD_SYMBOL_R5],
		pcb: [ADD_FOOTPRINT_R5],
		summary: "1 added part will be saved",
	},
	{
		name: "added part without footprint is added to the schematic only",
		before: ir([]),
		after: ir([{ ...R5, footprint: "" }]),
		sch: [{ ...ADD_SYMBOL_R5, footprint: "" }],
		pcb: [],
		summary: "1 added part will be saved",
	},
	{
		name: "removed part maps to deleteSymbol and deleteFootprint",
		before: ir([makePart({ id: "c2", ref: "C2" })]),
		after: ir([]),
		sch: [{ op: "deleteSymbol", ref: "C2" }],
		pcb: [{ op: "deleteFootprint", ref: "C2" }],
		summary: "1 removed part will be saved",
	},
	{
		name: "removing a wired part does not block the save",
		before: ir(
			[makePart({ id: "c2", ref: "C2" }), R2],
			[
				makeNet("GND", [
					["c2", "1"],
					["p2", "1"],
				]),
			],
		),
		after: ir([R2], [makeNet("GND", [["p2", "1"]])]),
		sch: [{ op: "deleteSymbol", ref: "C2" }],
		pcb: [{ op: "deleteFootprint", ref: "C2" }],
		summary: "1 removed part will be saved",
	},
	{
		name: "rename maps to Reference field edits",
		before: ir([makePart()]),
		after: ir([makePart({ ref: "R10" })]),
		sch: [{ op: "setField", ref: "R1", name: "Reference", value: "R10" }],
		pcb: [
			{ op: "setFootprintField", ref: "R1", name: "Reference", value: "R10" },
		],
		summary: "1 field will be saved",
	},
	{
		name: "rename plus value plus move keeps the old ref for in-place ops",
		before: ir([makePart()]),
		after: ir([makePart({ ref: "R10", value: "22k", placement: at(5, 6) })]),
		sch: [
			{ op: "setValue", ref: "R1", value: "22k" },
			{ op: "setField", ref: "R1", name: "Reference", value: "R10" },
		],
		pcb: [
			{ op: "move", ref: "R1", x: 5, y: 6, rot: 0 },
			{ op: "setValue", ref: "R1", value: "22k" },
			{ op: "setFootprintField", ref: "R1", name: "Reference", value: "R10" },
		],
		summary: "1 value, 1 position and 1 field will be saved",
	},
	{
		name: "footprint change swaps the PCB footprint and keeps its pad nets",
		before: ir([makePart()], [makeNet("GND", [["p1", "1"]])]),
		after: ir(
			[makePart({ footprint: "Resistor_SMD:R_0805" })],
			[makeNet("GND", [["p1", "1"]])],
		),
		sch: [
			{
				op: "setField",
				ref: "R1",
				name: "Footprint",
				value: "Resistor_SMD:R_0805",
			},
		],
		pcb: [
			{ op: "deleteFootprint", ref: "R1" },
			{
				op: "addFootprint",
				ref: "R1",
				libId: "Resistor_SMD:R_0805",
				value: "10k",
				x: 10,
				y: 20,
				rot: 0,
				side: "F",
			},
			{ op: "setPadNet", ref: "R1", pad: "1", net: "GND" },
		],
		summary: "1 field will be saved",
	},
	{
		name: "text field change maps to setField and setFootprintField",
		before: ir([makePart({ props: { MPN: "A" } })]),
		after: ir([makePart({ props: { MPN: "B", Note: 3 } })]),
		sch: [
			{ op: "setField", ref: "R1", name: "MPN", value: "B" },
			{ op: "setField", ref: "R1", name: "Note", value: "3" },
		],
		pcb: [
			{ op: "setFootprintField", ref: "R1", name: "MPN", value: "B" },
			{ op: "setFootprintField", ref: "R1", name: "Note", value: "3" },
		],
		summary: "2 fields will be saved",
	},
	{
		name: "field change on a part without footprint stays in the schematic",
		before: ir([makePart({ footprint: "", props: { MPN: "A" } })]),
		after: ir([makePart({ footprint: "", props: { MPN: "B" } })]),
		sch: [{ op: "setField", ref: "R1", name: "MPN", value: "B" }],
		pcb: [],
		summary: "1 field will be saved",
	},
];

const NET_CASES = [
	{
		name: "new connection maps to a label at each pin and pad nets",
		before: ir([makePart(), R2]),
		after: ir(
			[makePart(), R2],
			[
				makeNet("SIG", [
					["p1", "1"],
					["p2", "1"],
				]),
			],
		),
		sch: [
			{ op: "addLabel", net: "SIG", ...PIN1_AT_10_20 },
			{ op: "addLabel", net: "SIG", x: 32.38, y: 20 },
		],
		pcb: [
			{ op: "setPadNet", ref: "R1", pad: "1", net: "SIG" },
			{ op: "setPadNet", ref: "R2", pad: "1", net: "SIG" },
		],
		summary: "2 connections will be saved",
	},
	{
		name: "pin added to an existing connection labels only the new pin",
		before: ir([makePart(), R2], [makeNet("VCC", [["p1", "1"]])]),
		after: ir(
			[makePart(), R2],
			[
				makeNet("VCC", [
					["p1", "1"],
					["p2", "1"],
				]),
			],
		),
		sch: [{ op: "addLabel", net: "VCC", x: 32.38, y: 20 }],
		pcb: [{ op: "setPadNet", ref: "R2", pad: "1", net: "VCC" }],
		summary: "1 connection will be saved",
	},
	{
		name: "connection to a part without footprint is a label only",
		before: ir([makePart({ footprint: "" })]),
		after: ir([makePart({ footprint: "" })], [makeNet("GND", [["p1", "1"]])]),
		sch: [{ op: "addLabel", net: "GND", ...PIN1_AT_10_20 }],
		pcb: [],
		summary: "1 connection will be saved",
	},
	{
		name: "added part wired in one save is added before it is connected",
		before: ir([]),
		after: ir([R5], [makeNet("GND", [["p5", "1"]])]),
		sch: [ADD_SYMBOL_R5, { op: "addLabel", net: "GND", ...PIN1_AT_10_20 }],
		pcb: [
			ADD_FOOTPRINT_R5,
			{ op: "setPadNet", ref: "R5", pad: "1", net: "GND" },
		],
		summary: "1 added part and 1 connection will be saved",
	},
];

const board = (...tracks) => ({ tracks });
const seg = (patch = {}) => ({
	netId: "n_GND",
	layer: "F.Cu",
	start: [0, 0],
	end: [5, 0],
	widthMm: 0.3,
	...patch,
});
const gndIr = ir([makePart()], [makeNet("GND", [["p1", "1"]])]);

const TRACK_CASES = [
	{
		name: "drawn track maps to addTrack with the net name",
		before: gndIr,
		after: gndIr,
		boards: { before: board(), after: board(seg()) },
		sch: [],
		pcb: [
			{
				op: "addTrack",
				layer: "F.Cu",
				width: 0.3,
				points: [
					{ x: 0, y: 0 },
					{ x: 5, y: 0 },
				],
				net: "GND",
			},
		],
		summary: "1 track will be saved",
	},
	{
		name: "track without a known net uses net 0 and default width",
		before: gndIr,
		after: gndIr,
		boards: {
			before: board(),
			after: board({
				layer: "B.Cu",
				start: { x: 1, y: 2 },
				end: { x: 3, y: 4 },
			}),
		},
		sch: [],
		pcb: [
			{
				op: "addTrack",
				layer: "B.Cu",
				width: 0.25,
				points: [
					{ x: 1, y: 2 },
					{ x: 3, y: 4 },
				],
				net: 0,
			},
		],
		summary: "1 track will be saved",
	},
	{
		name: "removed track with a uuid maps to deleteTrack",
		before: gndIr,
		after: gndIr,
		boards: { before: board(seg({ uuid: "u-1" })), after: board() },
		sch: [],
		pcb: [{ op: "deleteTrack", uuid: "u-1" }],
		summary: "1 track will be saved",
	},
];

const UNSUPPORTED_CASES = [
	{
		name: "added part without library symbol",
		before: ir([]),
		after: ir([{ ...R5, symbol: "" }]),
		sentence: "R5 has no library symbol",
	},
	{
		name: "added part with non-finite placement",
		before: ir([]),
		after: ir([{ ...R5, placement: at(Number.NaN, 0) }]),
		sentence: "R5 has non-finite coordinates",
	},
	{
		name: "non-text field",
		before: ir([makePart({ props: { sizeMm: { w: 1, h: 1 } } })]),
		after: ir([makePart({ props: { sizeMm: { w: 2, h: 1 } } })]),
		sentence: "R1 changed field sizeMm",
	},
	{
		name: "removed field",
		before: ir([makePart({ props: { MPN: "A" } })]),
		after: ir([makePart({ props: {} })]),
		sentence: "R1 changed field MPN",
	},
	{
		name: "renamed connection",
		before: ir([makePart()], [makeNet("GND", [["p1", "1"]], "n1")]),
		after: ir([makePart()], [makeNet("AGND", [["p1", "1"]], "n1")]),
		sentence: "connection GND was renamed to AGND",
	},
	{
		name: "pin removed from a connection",
		before: ir(
			[makePart(), R2],
			[
				makeNet("VCC", [
					["p1", "1"],
					["p2", "1"],
				]),
			],
		),
		after: ir([makePart(), R2], [makeNet("VCC", [["p1", "1"]])]),
		sentence: "connection VCC lost a pin",
	},
	{
		name: "removed connection",
		before: gndIr,
		after: ir([makePart()]),
		sentence: "connection GND removed",
	},
	{
		name: "removed track without uuid",
		before: gndIr,
		after: gndIr,
		boards: { before: board(seg()), after: board() },
		sentence: "a track on F.Cu was removed",
	},
];

function runMappingCase(tc) {
	test(tc.name, () => {
		const res = editsFromIrChange(tc.before, tc.after, tc.boards);
		assert.deepEqual(res.unsupported, []);
		assert.deepEqual(res.sch, tc.sch);
		assert.deepEqual(res.pcb, tc.pcb);
		assert.equal(res.canSaveInPlace, true);
		assert.equal(res.summary, tc.summary);
	});
}

describe("kicadEdits mapping - parts (K4)", () => {
	for (const tc of PART_CASES) runMappingCase(tc);
});

describe("kicadEdits mapping - connections and tracks (K5)", () => {
	for (const tc of [...NET_CASES, ...TRACK_CASES]) runMappingCase(tc);
});

describe("kicadEdits mapping - truly unsupported", () => {
	for (const tc of UNSUPPORTED_CASES) {
		test(tc.name, () => {
			const res = editsFromIrChange(tc.before, tc.after, tc.boards);
			assert.ok(
				res.unsupported.includes(tc.sentence),
				`missing "${tc.sentence}" in ${JSON.stringify(res.unsupported)}`,
			);
			assert.equal(res.canSaveInPlace, false);
		});
	}
});

const DEMO_SCH =
	"C:/Program Files/KiCad/10.0/share/kicad/demos/ecc83/ecc83-pp.kicad_sch";
const demoSkip = fs.existsSync(DEMO_SCH) ? false : `missing ${DEMO_SCH}`;

describe("kicadEdits round trip on a KiCad demo", { skip: demoSkip }, () => {
	test("added part and connection land in the real schematic", () => {
		const text = fs.readFileSync(DEMO_SCH, "utf8");
		const r99 = makePart({ id: "p99", ref: "R99", symbol: "ecc83-pp:R" });
		const after = ir([r99], [makeNet("BANANA_NET", [["p99", "1"]])]);
		const { sch } = editsFromIrChange(ir([]), after);
		const res = patchKicadText(text, { kind: "sch", edits: sch });
		assert.equal(res.ok, true, res.error);
		const expected = [
			/\(property "Reference" "R99"/,
			/\(label "BANANA_NET"\s*\(at 2\.38 20/,
		];
		for (const pattern of expected) {
			assert.ok(pattern.test(res.text), `patched schematic lacks ${pattern}`);
		}
		const countLibIds = (s) => s.split('(lib_id "ecc83-pp:R")').length;
		assert.equal(countLibIds(res.text), countLibIds(text) + 1);
	});
});
