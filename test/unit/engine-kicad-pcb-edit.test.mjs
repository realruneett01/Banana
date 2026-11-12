import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyPcbEdits } from "../../backend/src/engine/kicad-pcb-edit.js";
import { irToKicadPcb } from "../../backend/src/engine/kicad-pcb-writer.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const MINIMAL_FP_SOURCE = `(footprint "Resistor_SMD:R_0603"
	(layer "F.Cu")
	(uuid "orig-fp-uuid-0001")
	(property "Reference" "REF**"
		(at 0 -1 0)
		(layer "F.SilkS")
		(uuid "orig-ref-uuid-0002")
	)
	(property "Value" "VAL**"
		(at 0 1 0)
		(layer "F.Fab")
		(uuid "orig-val-uuid-0003")
	)
	(pad "1" smd rect
		(at -0.8 0)
		(size 0.8 1)
		(layers "F.Cu" "F.Paste" "F.Mask")
		(uuid "orig-pad1-uuid-0004")
	)
	(pad "2" smd rect
		(at 0.8 0)
		(size 0.8 1)
		(layers "F.Cu" "F.Paste" "F.Mask")
		(uuid "orig-pad2-uuid-0005")
	)
)`;

function makeBaseBoard() {
	const ir = {
		schemaVersion: 1,
		name: "EditTestBoard",
		parts: [
			{
				id: "part_11111111-1111-1111-1111-111111111111",
				ref: "R0",
				value: "10k",
				symbol: "Device:R",
				footprint: "Resistor_SMD:R_0805",
				props: {},
				placement: { x: 50, y: 50, rot: 0, side: "F" },
			},
		],
		nets: [],
		constraints: [],
	};
	const footprints = {
		"Resistor_SMD:R_0805": {
			pads: [
				{
					number: "1",
					type: "smd",
					shape: "roundrect",
					at: [-1, 0],
					size: [1, 1],
					layers: ["F.Cu", "F.Mask"],
				},
				{
					number: "2",
					type: "smd",
					shape: "roundrect",
					at: [1, 0],
					size: [1, 1],
					layers: ["F.Cu", "F.Mask"],
				},
			],
		},
	};
	const { text } = irToKicadPcb(ir, { footprints, boardW: 100, boardH: 100 });
	return text;
}

function findFootprint(ast, ref) {
	for (let i = 1; i < ast.length; i++) {
		const node = ast[i];
		if (!Array.isArray(node) || node[0]?.sym !== "footprint") continue;
		const refProp = node.find(
			(c) =>
				Array.isArray(c) &&
				c[0]?.sym === "property" &&
				c[1] === "Reference" &&
				c[2] === ref,
		);
		if (refProp) return node;
	}
	return null;
}

function findPads(fpNode) {
	return fpNode.filter((c) => Array.isArray(c) && c[0]?.sym === "pad");
}

function extractUuid(node) {
	const uNode = node.find((c) => Array.isArray(c) && c[0]?.sym === "uuid");
	return uNode ? uNode[1] : null;
}

function testAddFootprintFront(baseText) {
	let uuidCount = 0;
	const mockUuid = () => `mock-uuid-${++uuidCount}`;
	const res = applyPcbEdits(
		baseText,
		[
			{
				op: "addFootprint",
				libId: "Resistor_SMD:R_0603",
				source: MINIMAL_FP_SOURCE,
				ref: "R1",
				value: "10k",
				x: 10,
				y: 10,
				rot: 0,
				side: "F",
			},
		],
		{ newUuid: mockUuid },
	);
	assert.equal(res.ok, true);
	const ast = parse(res.text);
	const fp = findFootprint(ast, "R1");
	assert.ok(fp, "Footprint R1 must exist");
	assert.notEqual(extractUuid(fp), "orig-fp-uuid-0001");
	const pads = findPads(fp);
	assert.equal(pads.length, 2);
	assert.notEqual(extractUuid(pads[0]), "orig-pad1-uuid-0004");
	assert.notEqual(extractUuid(pads[1]), "orig-pad2-uuid-0005");
}

function testAddFootprintBack(baseText) {
	const res = applyPcbEdits(baseText, [
		{
			op: "addFootprint",
			libId: "Resistor_SMD:R_0603",
			source: MINIMAL_FP_SOURCE,
			ref: "R_BACK",
			value: "1k",
			x: 15,
			y: 20,
			rot: 90,
			side: "B",
		},
	]);
	assert.equal(res.ok, true);
	const ast = parse(res.text);
	const fp = findFootprint(ast, "R_BACK");
	assert.ok(fp);
	const layerNode = fp.find((c) => Array.isArray(c) && c[0]?.sym === "layer");
	assert.equal(layerNode?.[1], "B.Cu");
	const pads = findPads(fp);
	for (const pad of pads) {
		const lNode = pad.find((c) => Array.isArray(c) && c[0]?.sym === "layers");
		assert.ok(lNode.includes("B.Cu"), "Pad layers must contain B.Cu");
		assert.ok(!lNode.includes("F.Cu"), "Pad layers must not contain F.Cu");
	}
	const p1At = pads[0].find((c) => Array.isArray(c) && c[0]?.sym === "at");
	assert.equal(p1At?.[1], 0.8, "Pad 1 X coordinate must be mirrored to 0.8");
}

function testSetPadNetTwice(baseText) {
	const res = applyPcbEdits(baseText, [
		{ op: "setPadNet", ref: "R0", pad: "1", net: "GND" },
		{ op: "setPadNet", ref: "R0", pad: "2", net: "GND" },
	]);
	assert.equal(res.ok, true);
	const ast = parse(res.text);
	const gndDecls = ast.filter(
		(c) => Array.isArray(c) && c[0]?.sym === "net" && c[2] === "GND",
	);
	assert.equal(
		gndDecls.length,
		1,
		"GND net declaration must appear exactly once",
	);
	const fp = findFootprint(ast, "R0");
	const pads = findPads(fp);
	const p1Net = pads[0].find((c) => Array.isArray(c) && c[0]?.sym === "net");
	const p2Net = pads[1].find((c) => Array.isArray(c) && c[0]?.sym === "net");
	assert.equal(p1Net?.[2], "GND");
	assert.equal(p2Net?.[2], "GND");
	assert.equal(p1Net?.[1], gndDecls[0][1]);
}

function testTracksAndVias(baseText) {
	const res = applyPcbEdits(baseText, [
		{
			op: "addTrack",
			net: "GND",
			layer: "F.Cu",
			width: 0.25,
			points: [
				{ x: 10, y: 10 },
				{ x: 20, y: 10 },
				{ x: 20, y: 20 },
			],
		},
		{ op: "addVia", net: "GND", x: 20, y: 20, size: 0.6, drill: 0.3 },
	]);
	assert.equal(res.ok, true);
	const ast = parse(res.text);
	const segments = ast.filter(
		(c) => Array.isArray(c) && c[0]?.sym === "segment",
	);
	assert.equal(segments.length, 2, "3 points must yield 2 segments");
	const vias = ast.filter((c) => Array.isArray(c) && c[0]?.sym === "via");
	assert.equal(vias.length, 1, "1 via must be created");
	const segNet = segments[0].find(
		(c) => Array.isArray(c) && c[0]?.sym === "net",
	);
	const viaNet = vias[0].find((c) => Array.isArray(c) && c[0]?.sym === "net");
	assert.equal(segNet?.[1], viaNet?.[1], "Net numbers must match");
}

function testRenameAndDelete(baseText) {
	const res = applyPcbEdits(baseText, [
		{
			op: "setFootprintField",
			ref: "R0",
			name: "Reference",
			value: "R_RENAMED",
		},
		{ op: "setFootprintField", ref: "R_RENAMED", name: "Value", value: "22k" },
		{ op: "deleteFootprint", ref: "R_RENAMED" },
	]);
	assert.equal(res.ok, true);
	const ast = parse(res.text);
	assert.equal(findFootprint(ast, "R0"), null);
	assert.equal(findFootprint(ast, "R_RENAMED"), null);
}

function testDeleteTrack(baseText) {
	let trackUuid = null;
	const trackRes = applyPcbEdits(
		baseText,
		[
			{
				op: "addTrack",
				net: 1,
				layer: "F.Cu",
				width: 0.3,
				points: [
					{ x: 0, y: 0 },
					{ x: 5, y: 5 },
				],
			},
		],
		{ newUuid: () => "unique-track-uuid" },
	);
	assert.equal(trackRes.ok, true);
	trackUuid = "unique-track-uuid";
	const delRes = applyPcbEdits(trackRes.text, [
		{ op: "deleteTrack", uuid: trackUuid },
	]);
	assert.equal(delRes.ok, true);
	const ast = parse(delRes.text);
	const remaining = ast.filter(
		(c) =>
			Array.isArray(c) &&
			c[0]?.sym === "segment" &&
			extractUuid(c) === trackUuid,
	);
	assert.equal(remaining.length, 0);
}

function testChainedOperations(baseText) {
	const edits = [
		{
			op: "addFootprint",
			libId: "Resistor_SMD:R_0603",
			source: MINIMAL_FP_SOURCE,
			ref: "R1",
			value: "10k",
			x: 10,
			y: 10,
			rot: 0,
			side: "F",
		},
		{ op: "setPadNet", ref: "R1", pad: "1", net: "VCC" },
		{
			op: "addTrack",
			net: "VCC",
			layer: "F.Cu",
			width: 0.2,
			points: [
				{ x: 10, y: 10 },
				{ x: 15, y: 10 },
				{ x: 15, y: 15 },
			],
		},
		{ op: "addVia", net: "VCC", x: 15, y: 15 },
	];
	const res = applyPcbEdits(baseText, edits);
	assert.equal(res.ok, true);
	const reparsed = parse(res.text);
	assert.ok(Array.isArray(reparsed));
	assert.equal(reparsed[0]?.sym, "kicad_pcb");
}

const ERROR_TABLE = [
	{ name: "unknown operation", edit: { op: "unknownOp" } },
	{ name: "delete missing ref", edit: { op: "deleteFootprint", ref: "NO_FP" } },
	{
		name: "setPadNet missing pad",
		edit: { op: "setPadNet", ref: "R0", pad: "99", net: "GND" },
	},
	{
		name: "addTrack NaN width",
		edit: {
			op: "addTrack",
			layer: "F.Cu",
			width: Number.NaN,
			points: [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			],
			net: 1,
		},
	},
	{
		name: "addTrack NaN coords",
		edit: {
			op: "addTrack",
			layer: "F.Cu",
			width: 0.2,
			points: [
				{ x: 0, y: 0 },
				{ x: Number.NaN, y: 1 },
			],
			net: 1,
		},
	},
	{
		name: "addTrack single point",
		edit: {
			op: "addTrack",
			layer: "F.Cu",
			width: 0.2,
			points: [{ x: 0, y: 0 }],
			net: 1,
		},
	},
	{
		name: "addVia NaN coords",
		edit: { op: "addVia", x: Number.NaN, y: 0, net: 1 },
	},
	{
		name: "addVia negative size",
		edit: { op: "addVia", x: 10, y: 10, size: -1, net: 1 },
	},
	{
		name: "deleteTrack missing uuid",
		edit: { op: "deleteTrack", uuid: "missing-uuid" },
	},
	{
		name: "addFootprint NaN coords",
		edit: {
			op: "addFootprint",
			libId: "R",
			source: MINIMAL_FP_SOURCE,
			ref: "R2",
			value: "1k",
			x: Number.NaN,
			y: 0,
		},
	},
	{
		name: "addFootprint invalid source",
		edit: {
			op: "addFootprint",
			libId: "R",
			source: "not an sexpr",
			ref: "R2",
			value: "1k",
			x: 0,
			y: 0,
		},
	},
];

describe("kicad-pcb-edit", () => {
	const baseText = makeBaseBoard();

	test("addFootprint at (10,10) on front with fresh UUIDs", () => {
		testAddFootprintFront(baseText);
	});

	test("addFootprint on back flips layers and mirrors X coordinates", () => {
		testAddFootprintBack(baseText);
	});

	test("setPadNet declares GND once even when called twice", () => {
		testSetPadNetTwice(baseText);
	});

	test("addTrack with 3 points generates 2 segments and addVia works", () => {
		testTracksAndVias(baseText);
	});

	test("setFootprintField and deleteFootprint update and remove footprint", () => {
		testRenameAndDelete(baseText);
	});

	test("deleteTrack removes segment by uuid", () => {
		testDeleteTrack(baseText);
	});

	test("chained edits result in serializable and re-parsable PCB output", () => {
		testChainedOperations(baseText);
	});

	test("error table cases return ok: false", () => {
		for (const row of ERROR_TABLE) {
			const res = applyPcbEdits(baseText, [row.edit]);
			assert.equal(res.ok, false, `Expected error for ${row.name}`);
			assert.ok(res.error, `Error message required for ${row.name}`);
		}
	});
});
