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

function makePad(number, atX) {
	return {
		number,
		type: "smd",
		shape: "roundrect",
		at: [atX, 0],
		size: [1, 1],
		layers: ["F.Cu", "F.Mask"],
	};
}

function makeBaseBoard() {
	const part = {
		id: "part_11111111-1111-1111-1111-111111111111",
		ref: "R0",
		value: "10k",
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0805",
		props: {},
		placement: { x: 50, y: 50, rot: 0, side: "F" },
	};
	const footprints = {
		"Resistor_SMD:R_0805": { pads: [makePad("1", -1), makePad("2", 1)] },
	};
	const ir = {
		schemaVersion: 1,
		name: "EditTestBoard",
		parts: [part],
		nets: [],
		constraints: [],
	};
	return irToKicadPcb(ir, {
		footprints,
		boardW: 100,
		boardH: 100,
	}).text;
}

function makeFpEdit(ref, value, x, y) {
	return {
		op: "addFootprint",
		libId: "Resistor_SMD:R_0603",
		source: MINIMAL_FP_SOURCE,
		ref,
		value,
		x,
		y,
		rot: 0,
		side: "F",
	};
}

function makeTrackEdit(net, width, points) {
	return { op: "addTrack", net, layer: "F.Cu", width, points };
}

function makeInvalidFpEdit(source, x) {
	return {
		op: "addFootprint",
		libId: "R",
		source,
		ref: "R2",
		value: "1k",
		x,
		y: 0,
	};
}

const FRONT_FP_EDITS = [makeFpEdit("R1", "10k", 10, 10)];

const BACK_FP_EDITS = [
	{
		...FRONT_FP_EDITS[0],
		ref: "R_BACK",
		value: "1k",
		x: 15,
		y: 20,
		rot: 90,
		side: "B",
	},
];

const SET_PAD_NET_EDITS = ["1", "2"].map((pad) => ({
	op: "setPadNet",
	ref: "R0",
	pad,
	net: "GND",
}));

const TRACK_AND_VIA_EDITS = [
	makeTrackEdit("GND", 0.25, [
		{ x: 10, y: 10 },
		{ x: 20, y: 10 },
		{ x: 20, y: 20 },
	]),
	{ op: "addVia", net: "GND", x: 20, y: 20, size: 0.6, drill: 0.3 },
];

const RENAME_AND_DELETE_EDITS = [
	{
		op: "setFootprintField",
		ref: "R0",
		name: "Reference",
		value: "R_RENAMED",
	},
	{
		op: "setFootprintField",
		ref: "R_RENAMED",
		name: "Value",
		value: "22k",
	},
	{ op: "deleteFootprint", ref: "R_RENAMED" },
];

const CHAINED_EDITS = [
	...FRONT_FP_EDITS,
	{ op: "setPadNet", ref: "R1", pad: "1", net: "VCC" },
	makeTrackEdit("VCC", 0.2, [
		{ x: 10, y: 10 },
		{ x: 15, y: 10 },
		{ x: 15, y: 15 },
	]),
	{ op: "addVia", net: "VCC", x: 15, y: 15 },
];

const nodeTag = (node) =>
	Array.isArray(node) ? node[0]?.sym : (node?.sym ?? null);
const getChild = (tree, tag) => tree?.find?.((n) => nodeTag(n) === tag) ?? null;
const getChildren = (tree, tag) =>
	Array.isArray(tree) ? tree.filter((n) => nodeTag(n) === tag) : [];

function isMatchingRef(child, ref) {
	if (nodeTag(child) !== "property") return false;
	return child[1] === "Reference" && child[2] === ref;
}

function findFootprint(ast, ref) {
	return (
		ast.find(
			(node) =>
				nodeTag(node) === "footprint" &&
				node.some((child) => isMatchingRef(child, ref)),
		) ?? null
	);
}

function findPads(fpNode) {
	return getChildren(fpNode, "pad");
}

function extractUuid(node) {
	return getChild(node, "uuid")?.[1] ?? null;
}

function isSegmentWithUuid(node, uuid) {
	return nodeTag(node) === "segment" && extractUuid(node) === uuid;
}

function isGndNet(node) {
	return nodeTag(node) === "net" && node[2] === "GND";
}

function executeEdits(baseText, edits, opts) {
	const res = applyPcbEdits(baseText, edits, opts);
	return { res, ast: res.ok ? parse(res.text) : null };
}

function verifyPadLayers(pad) {
	const lNode = getChild(pad, "layers");
	assert.ok(lNode.includes("B.Cu"), "Pad layers must contain B.Cu");
	assert.ok(!lNode.includes("F.Cu"), "Pad layers must not contain F.Cu");
}

function verifyEditRejected(outcome, caseName) {
	assert.equal(outcome.ok, false, `Expected error for ${caseName}`);
	assert.equal(
		Boolean(outcome.error),
		true,
		`Error message required for ${caseName}`,
	);
}

describe("kicad-pcb-edit", () => {
	const baseText = makeBaseBoard();

	test("addFootprint at (10,10) on front with fresh UUIDs", () => {
		let uuidCount = 0;
		const mockUuid = () => `mock-uuid-${++uuidCount}`;
		const { res, ast } = executeEdits(baseText, FRONT_FP_EDITS, {
			newUuid: mockUuid,
		});
		assert.equal(res.ok, true);
		const fp = findFootprint(ast, "R1");
		assert.ok(fp, "Footprint R1 must exist");
		assert.notEqual(extractUuid(fp), "orig-fp-uuid-0001");
		const pads = findPads(fp);
		assert.equal(pads.length, 2);
		const origPadUuids = ["orig-pad1-uuid-0004", "orig-pad2-uuid-0005"];
		pads.forEach((pad, i) => {
			assert.notEqual(extractUuid(pad), origPadUuids[i]);
		});
	});

	test("addFootprint on back flips layers and flips top-bottom like KiCad", () => {
		const { res, ast } = executeEdits(baseText, BACK_FP_EDITS);
		assert.equal(res.ok, true);
		const fp = findFootprint(ast, "R_BACK");
		assert.ok(fp);
		const layerNode = getChild(fp, "layer");
		assert.equal(layerNode?.[1], "B.Cu");
		const pads = findPads(fp);
		pads.forEach(verifyPadLayers);
		const p1At = getChild(pads[0], "at");
		assert.equal(p1At?.[1], -0.8, "Pad 1 X coordinate must stay -0.8");
		assert.equal(p1At?.[3], 90, "Pad 1 angle must carry the footprint's 90");
		const ref = fp.find((c) => Array.isArray(c) && c[2] === "R_BACK");
		const refAt = getChild(ref, "at");
		assert.deepEqual(
			refAt.slice(1),
			[0, 1, 270],
			"Reference text flips to y=1",
		);
	});

	test("setPadNet declares GND once even when called twice", () => {
		const { res, ast } = executeEdits(baseText, SET_PAD_NET_EDITS);
		assert.equal(res.ok, true);
		const gndDecls = ast.filter(isGndNet);
		assert.equal(
			gndDecls.length,
			1,
			"GND net declaration must appear exactly once",
		);
		const fp = findFootprint(ast, "R0");
		const pads = findPads(fp);
		pads.forEach((pad) => {
			assert.equal(getChild(pad, "net")?.[2], "GND");
		});
		assert.equal(getChild(pads[0], "net")?.[1], gndDecls[0][1]);
	});

	test("addTrack with 3 points generates 2 segments and addVia works", () => {
		const { res, ast } = executeEdits(baseText, TRACK_AND_VIA_EDITS);
		assert.equal(res.ok, true);
		const segments = getChildren(ast, "segment");
		assert.equal(segments.length, 2, "3 points must yield 2 segments");
		const vias = getChildren(ast, "via");
		assert.equal(vias.length, 1, "1 via must be created");
		const segNet = getChild(segments[0], "net");
		const viaNet = getChild(vias[0], "net");
		assert.equal(segNet?.[1], viaNet?.[1], "Net numbers must match");
	});

	test("setFootprintField and deleteFootprint update and remove footprint", () => {
		const { res, ast } = executeEdits(baseText, RENAME_AND_DELETE_EDITS);
		assert.equal(res.ok, true);
		["R0", "R_RENAMED"].forEach((ref) => {
			assert.equal(findFootprint(ast, ref), null);
		});
	});

	test("deleteTrack removes segment by uuid", () => {
		const trackUuid = "unique-track-uuid";
		const trackEdits = [
			makeTrackEdit(1, 0.3, [
				{ x: 0, y: 0 },
				{ x: 5, y: 5 },
			]),
		];
		const trackRes = applyPcbEdits(baseText, trackEdits, {
			newUuid: () => trackUuid,
		});
		assert.equal(trackRes.ok, true);
		const delEdits = [{ op: "deleteTrack", uuid: trackUuid }];
		const { res: delRes, ast } = executeEdits(trackRes.text, delEdits);
		assert.equal(delRes.ok, true);
		const remaining = ast.filter((c) => isSegmentWithUuid(c, trackUuid));
		assert.equal(remaining.length, 0);
	});

	test("chained edits result in serializable PCB output", () => {
		const { res, ast } = executeEdits(baseText, CHAINED_EDITS);
		assert.equal(res.ok, true);
		assert.ok(Array.isArray(ast));
	});

	test("chained edits preserve kicad_pcb root s-expression", () => {
		const { res, ast } = executeEdits(baseText, CHAINED_EDITS);
		assert.equal(res.ok, true);
		assert.equal(nodeTag(ast), "kicad_pcb");
	});

	function runErrorTest(name, edit) {
		test(`error handling: ${name}`, () => {
			const res = applyPcbEdits(baseText, [edit]);
			verifyEditRejected(res, name);
		});
	}

	runErrorTest("unknown operation", { op: "unknownOp" });
	runErrorTest("delete missing ref", { op: "deleteFootprint", ref: "NO_FP" });
	runErrorTest("setPadNet missing pad", {
		op: "setPadNet",
		ref: "R0",
		pad: "99",
		net: "GND",
	});
	runErrorTest(
		"addTrack NaN width",
		makeTrackEdit(1, Number.NaN, [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		]),
	);
	runErrorTest(
		"addTrack NaN coords",
		makeTrackEdit(1, 0.2, [
			{ x: 0, y: 0 },
			{ x: Number.NaN, y: 1 },
		]),
	);
	runErrorTest(
		"addTrack single point",
		makeTrackEdit(1, 0.2, [{ x: 0, y: 0 }]),
	);
	runErrorTest("addVia NaN coords", {
		op: "addVia",
		x: Number.NaN,
		y: 0,
		net: 1,
	});
	runErrorTest("addVia negative size", {
		op: "addVia",
		x: 10,
		y: 10,
		size: -1,
		net: 1,
	});
	runErrorTest("deleteTrack missing uuid", {
		op: "deleteTrack",
		uuid: "missing-uuid",
	});
	runErrorTest(
		"addFootprint NaN coords",
		makeInvalidFpEdit(MINIMAL_FP_SOURCE, Number.NaN),
	);
	runErrorTest(
		"addFootprint invalid source",
		makeInvalidFpEdit("not an sexpr", 0),
	);
});
