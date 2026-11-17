import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyPcbEdits } from "../../backend/src/engine/kicad-pcb-edit.js";
import { parse } from "../../backend/src/engine/sexpr.js";

const BASE_PCB = `(kicad_pcb
	(version 20240108)
	(generator "banana")
	(generator_version "2.0")
	(general (thickness 1.6))
	(paper "A4")
	(layers
		(0 "F.Cu" signal)
		(31 "B.Cu" signal)
		(36 "B.SilkS" user "B.Silkscreen")
		(37 "F.SilkS" user "F.Silkscreen")
		(44 "Edge.Cuts" user)
		(48 "Dwgs.User" user "User.Drawings")
	)
)`;

const addOp = (graphic) => ({
	op: "addGraphic",
	...(graphic ? { graphic } : {}),
});
const delOp = (uuid) => ({ op: "deleteGraphic", ...(uuid ? { uuid } : {}) });

function findNodeByUuid(ast, uuid) {
	return (
		ast.find((c) => {
			if (!Array.isArray(c)) return false;
			const u = c.find((ch) => Array.isArray(ch) && ch[0]?.sym === "uuid");
			return u?.[1] === uuid;
		}) ?? null
	);
}

function runSuccessfulEdits(edits, opts, pcb = BASE_PCB) {
	const res = applyPcbEdits(pcb, edits, opts);
	if (!res.ok) {
		assert.fail(res.error ?? "applyPcbEdits failed");
	}
	return { text: res.text, ast: parse(res.text) };
}

function checkGraphic(name, graphic, expected) {
	test(`addGraphic: ${name}`, () => {
		const { ast } = runSuccessfulEdits([addOp(graphic)]);
		const node = findNodeByUuid(ast, graphic.uuid);
		assert.ok(node, `Node ${graphic.uuid} not found`);
		assert.deepEqual(node, parse(expected));
	});
}

function checkError(name, edit) {
	test(`error handling: ${name}`, () => {
		const res = applyPcbEdits(BASE_PCB, [edit]);
		assert.deepStrictEqual(
			{ ok: res.ok, err: Boolean(res.error) },
			{ ok: false, err: true },
			`Expected error for ${name}`,
		);
	});
}

describe("kicad-pcb-edit graphics", () => {
	const cases = JSON.parse(
		'[["line with explicit width", {"id": "g1", "kind": "line", "layer": "F.SilkS", "width": 0.2, "x": 1, "y": 2, "x2": 3, "y2": 4, "uuid": "uuid-line-1"}, "(gr_line (start 1 2) (end 3 4) (stroke (width 0.2) (type default)) (layer \\"F.SilkS\\") (uuid \\"uuid-line-1\\"))"], ["line with default width on silkscreen", {"id": "g2", "kind": "line", "layer": "F.SilkS", "x": 0, "y": 0, "x2": 10, "y2": 10, "uuid": "uuid-line-2"}, "(gr_line (start 0 0) (end 10 10) (stroke (width 0.15) (type default)) (layer \\"F.SilkS\\") (uuid \\"uuid-line-2\\"))"], ["line with default width on Edge.Cuts", {"id": "g3", "kind": "line", "layer": "Edge.Cuts", "x": 0, "y": 0, "x2": 50, "y2": 0, "uuid": "uuid-line-edge"}, "(gr_line (start 0 0) (end 50 0) (stroke (width 0.1) (type default)) (layer \\"Edge.Cuts\\") (uuid \\"uuid-line-edge\\"))"], ["rect with fill none", {"id": "g4", "kind": "rect", "layer": "F.SilkS", "width": 0.15, "x": 5, "y": 6, "x2": 15, "uuid": "uuid-rect-1", "y2": 16}, "(gr_rect (start 5 6) (end 15 16) (stroke (width 0.15) (type default)) (fill none) (layer \\"F.SilkS\\") (uuid \\"uuid-rect-1\\"))"], ["circle with center, end, and fill none", {"id": "g5", "kind": "circle", "layer": "B.SilkS", "width": 0.15, "x": 10, "y": 10, "x2": 15, "y2": 10, "uuid": "uuid-circle-1"}, "(gr_circle (center 10 10) (end 15 10) (stroke (width 0.15) (type default)) (fill none) (layer \\"B.SilkS\\") (uuid \\"uuid-circle-1\\"))"], ["arc with start, mid, end", {"id": "g6", "kind": "arc", "layer": "Dwgs.User", "width": 0.15, "x": 0, "y": 0, "xm": 5, "ym": 2, "x2": 10, "y2": 0, "uuid": "uuid-arc-1"}, "(gr_arc (start 0 0) (mid 5 2) (end 10 0) (stroke (width 0.15) (type default)) (layer \\"Dwgs.User\\") (uuid \\"uuid-arc-1\\"))"], ["text with effects font", {"id": "g7", "kind": "text", "layer": "F.SilkS", "text": "Banana Rev 1", "x": 20, "y": 25, "uuid": "uuid-text-1"}, "(gr_text \\"Banana Rev 1\\" (at 20 25 0) (layer \\"F.SilkS\\") (uuid \\"uuid-text-1\\") (effects (font (size 1 1) (thickness 0.15))))"], ["dimension with aligned type and style", {"id": "g8", "kind": "dimension", "layer": "F.SilkS", "x": 0, "y": 0, "x2": 50, "y2": 0, "uuid": "uuid-dim-1"}, "(dimension (type aligned) (layer \\"F.SilkS\\") (uuid \\"uuid-dim-1\\") (pts (xy 0 0) (xy 50 0)) (height 2) (format (units 2) (units_format 1) (precision 4)) (style (thickness 0.15) (arrow_length 1.27) (text_position_mode 0) (extension_height 0.58642) (extension_offset 0.5)))"]]',
	);
	for (const [name, graphic, expected] of cases) {
		checkGraphic(name, graphic, expected);
	}

	test("addGraphic generates new uuid when omitted", () => {
		const graphic = {
			kind: "line",
			layer: "F.SilkS",
			x: 1,
			y: 1,
			x2: 2,
			y2: 2,
		};
		const { ast } = runSuccessfulEdits([addOp(graphic)], {
			newUuid: () => "generated-uuid-999",
		});
		assert.ok(
			findNodeByUuid(ast, "generated-uuid-999"),
			"Node with generated uuid not found",
		);
	});

	test("deleteGraphic removes only matching uuid", () => {
		const g1 = {
			kind: "line",
			layer: "F.SilkS",
			x: 0,
			y: 0,
			x2: 1,
			y2: 1,
			uuid: "keep-me",
		};
		const g2 = {
			kind: "rect",
			layer: "F.SilkS",
			x: 2,
			y: 2,
			x2: 3,
			y2: 3,
			uuid: "delete-me",
		};
		const added = runSuccessfulEdits([addOp(g1), addOp(g2)]);
		const deleted = runSuccessfulEdits(
			[delOp("delete-me")],
			undefined,
			added.text,
		);
		assert.deepStrictEqual(
			{
				deleted: findNodeByUuid(deleted.ast, "delete-me"),
				kept: Boolean(findNodeByUuid(deleted.ast, "keep-me")),
			},
			{ deleted: null, kept: true },
		);
	});

	test("chained graphic edits preserve serializable kicad_pcb ast", () => {
		const edits = [
			addOp({
				kind: "circle",
				layer: "F.SilkS",
				x: 10,
				y: 10,
				x2: 15,
				y2: 10,
				uuid: "c1",
			}),
			addOp({
				kind: "text",
				layer: "F.SilkS",
				text: "Test",
				x: 5,
				y: 5,
				uuid: "t1",
			}),
			delOp("c1"),
		];
		const { ast } = runSuccessfulEdits(edits);
		assert.deepStrictEqual(
			{
				root: ast[0]?.sym,
				deleted: findNodeByUuid(ast, "c1"),
				kept: Boolean(findNodeByUuid(ast, "t1")),
			},
			{ root: "kicad_pcb", deleted: null, kept: true },
		);
	});

	checkError(
		"unknown graphic kind",
		addOp({ kind: "ellipse", layer: "F.SilkS", x: 0, y: 0, x2: 1, y2: 1 }),
	);
	checkError(
		"missing layer",
		addOp({ kind: "line", x: 0, y: 0, x2: 1, y2: 1 }),
	);
	checkError(
		"invalid negative width",
		addOp({
			kind: "line",
			layer: "F.SilkS",
			width: -0.2,
			x: 0,
			y: 0,
			x2: 1,
			y2: 1,
		}),
	);
	checkError(
		"non-finite coords on line start",
		addOp({
			kind: "line",
			layer: "F.SilkS",
			x: Number.NaN,
			y: 0,
			x2: 1,
			y2: 1,
		}),
	);
	checkError(
		"non-finite coords on rect end",
		addOp({
			kind: "rect",
			layer: "F.SilkS",
			x: 0,
			y: 0,
			x2: 1,
			y2: Number.POSITIVE_INFINITY,
		}),
	);
	checkError(
		"non-finite arc mid point",
		addOp({
			kind: "arc",
			layer: "F.SilkS",
			x: 0,
			y: 0,
			xm: Number.NaN,
			ym: 1,
			x2: 2,
			y2: 0,
		}),
	);
	checkError(
		"empty text body",
		addOp({ kind: "text", layer: "F.SilkS", text: "", x: 0, y: 0 }),
	);
	checkError(
		"missing text field",
		addOp({ kind: "text", layer: "F.SilkS", x: 0, y: 0 }),
	);
	checkError("missing graphic payload", addOp());
	checkError("deleteGraphic missing uuid", delOp());
	checkError("deleteGraphic missing matching uuid", delOp("does-not-exist"));
});
