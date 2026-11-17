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

const EXACT_KIND_CASES = [
	{
		name: "line with explicit width",
		graphic: {
			id: "g1",
			kind: "line",
			layer: "F.SilkS",
			width: 0.2,
			x: 1,
			y: 2,
			x2: 3,
			y2: 4,
			uuid: "uuid-line-1",
		},
		expected:
			'(gr_line (start 1 2) (end 3 4) (stroke (width 0.2) (type default)) (layer "F.SilkS") (uuid "uuid-line-1"))',
	},
	{
		name: "line with default width on silkscreen",
		graphic: {
			id: "g2",
			kind: "line",
			layer: "F.SilkS",
			x: 0,
			y: 0,
			x2: 10,
			y2: 10,
			uuid: "uuid-line-2",
		},
		expected:
			'(gr_line (start 0 0) (end 10 10) (stroke (width 0.15) (type default)) (layer "F.SilkS") (uuid "uuid-line-2"))',
	},
	{
		name: "line with default width on Edge.Cuts",
		graphic: {
			id: "g3",
			kind: "line",
			layer: "Edge.Cuts",
			x: 0,
			y: 0,
			x2: 50,
			y2: 0,
			uuid: "uuid-line-edge",
		},
		expected:
			'(gr_line (start 0 0) (end 50 0) (stroke (width 0.1) (type default)) (layer "Edge.Cuts") (uuid "uuid-line-edge"))',
	},
	{
		name: "rect with fill none",
		graphic: {
			id: "g4",
			kind: "rect",
			layer: "F.SilkS",
			width: 0.15,
			x: 5,
			y: 6,
			x2: 15,
			y2: 16,
			uuid: "uuid-rect-1",
		},
		expected:
			'(gr_rect (start 5 6) (end 15 16) (stroke (width 0.15) (type default)) (fill none) (layer "F.SilkS") (uuid "uuid-rect-1"))',
	},
	{
		name: "circle with center, end, and fill none",
		graphic: {
			id: "g5",
			kind: "circle",
			layer: "B.SilkS",
			width: 0.15,
			x: 10,
			y: 10,
			x2: 15,
			y2: 10,
			uuid: "uuid-circle-1",
		},
		expected:
			'(gr_circle (center 10 10) (end 15 10) (stroke (width 0.15) (type default)) (fill none) (layer "B.SilkS") (uuid "uuid-circle-1"))',
	},
	{
		name: "arc with start, mid, end",
		graphic: {
			id: "g6",
			kind: "arc",
			layer: "Dwgs.User",
			width: 0.15,
			x: 0,
			y: 0,
			xm: 5,
			ym: 2,
			x2: 10,
			y2: 0,
			uuid: "uuid-arc-1",
		},
		expected:
			'(gr_arc (start 0 0) (mid 5 2) (end 10 0) (stroke (width 0.15) (type default)) (layer "Dwgs.User") (uuid "uuid-arc-1"))',
	},
	{
		name: "text with effects font",
		graphic: {
			id: "g7",
			kind: "text",
			layer: "F.SilkS",
			text: "Banana Rev 1",
			x: 20,
			y: 25,
			uuid: "uuid-text-1",
		},
		expected:
			'(gr_text "Banana Rev 1" (at 20 25 0) (layer "F.SilkS") (uuid "uuid-text-1") (effects (font (size 1 1) (thickness 0.15))))',
	},
	{
		name: "dimension with aligned type and style",
		graphic: {
			id: "g8",
			kind: "dimension",
			layer: "F.SilkS",
			x: 0,
			y: 0,
			x2: 50,
			y2: 0,
			uuid: "uuid-dim-1",
		},
		expected:
			'(dimension (type aligned) (layer "F.SilkS") (uuid "uuid-dim-1") (pts (xy 0 0) (xy 50 0)) (height 2) (format (units 2) (units_format 1) (precision 4)) (style (thickness 0.15) (arrow_length 1.27) (text_position_mode 0) (extension_height 0.58642) (extension_offset 0.5)))',
	},
];

const ERROR_CASES = [
	{
		name: "unknown graphic kind",
		edit: {
			op: "addGraphic",
			graphic: { kind: "ellipse", layer: "F.SilkS", x: 0, y: 0, x2: 1, y2: 1 },
		},
	},
	{
		name: "missing layer",
		edit: {
			op: "addGraphic",
			graphic: { kind: "line", x: 0, y: 0, x2: 1, y2: 1 },
		},
	},
	{
		name: "invalid negative width",
		edit: {
			op: "addGraphic",
			graphic: {
				kind: "line",
				layer: "F.SilkS",
				width: -0.2,
				x: 0,
				y: 0,
				x2: 1,
				y2: 1,
			},
		},
	},
	{
		name: "non-finite coords on line start",
		edit: {
			op: "addGraphic",
			graphic: {
				kind: "line",
				layer: "F.SilkS",
				x: Number.NaN,
				y: 0,
				x2: 1,
				y2: 1,
			},
		},
	},
	{
		name: "non-finite coords on rect end",
		edit: {
			op: "addGraphic",
			graphic: {
				kind: "rect",
				layer: "F.SilkS",
				x: 0,
				y: 0,
				x2: 1,
				y2: Number.POSITIVE_INFINITY,
			},
		},
	},
	{
		name: "non-finite arc mid point",
		edit: {
			op: "addGraphic",
			graphic: {
				kind: "arc",
				layer: "F.SilkS",
				x: 0,
				y: 0,
				xm: Number.NaN,
				ym: 1,
				x2: 2,
				y2: 0,
			},
		},
	},
	{
		name: "empty text body",
		edit: {
			op: "addGraphic",
			graphic: { kind: "text", layer: "F.SilkS", text: "", x: 0, y: 0 },
		},
	},
	{
		name: "missing text field",
		edit: {
			op: "addGraphic",
			graphic: { kind: "text", layer: "F.SilkS", x: 0, y: 0 },
		},
	},
	{
		name: "missing graphic payload",
		edit: { op: "addGraphic" },
	},
	{
		name: "deleteGraphic missing uuid",
		edit: { op: "deleteGraphic" },
	},
	{
		name: "deleteGraphic missing matching uuid",
		edit: { op: "deleteGraphic", uuid: "does-not-exist" },
	},
];

function findNodeByUuid(ast, uuid) {
	return (
		ast.find((c) => {
			if (!Array.isArray(c)) return false;
			const u = c.find((ch) => Array.isArray(ch) && ch[0]?.sym === "uuid");
			return u?.[1] === uuid;
		}) ?? null
	);
}

describe("kicad-pcb-edit graphics", () => {
	for (const row of EXACT_KIND_CASES) {
		test(`addGraphic: ${row.name}`, () => {
			const res = applyPcbEdits(BASE_PCB, [
				{ op: "addGraphic", graphic: row.graphic },
			]);
			assert.equal(res.ok, true, res.error);
			const ast = parse(res.text);
			const node = findNodeByUuid(ast, row.graphic.uuid);
			assert.ok(node, `Node with uuid ${row.graphic.uuid} not found`);
			const expectedNode = parse(row.expected);
			assert.deepEqual(node, expectedNode);
		});
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
		const res = applyPcbEdits(BASE_PCB, [{ op: "addGraphic", graphic }], {
			newUuid: () => "generated-uuid-999",
		});
		assert.equal(res.ok, true, res.error);
		const ast = parse(res.text);
		const node = findNodeByUuid(ast, "generated-uuid-999");
		assert.ok(node, "Node with generated uuid not found");
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
		const addRes = applyPcbEdits(BASE_PCB, [
			{ op: "addGraphic", graphic: g1 },
			{ op: "addGraphic", graphic: g2 },
		]);
		assert.equal(addRes.ok, true, addRes.error);

		const delRes = applyPcbEdits(addRes.text, [
			{ op: "deleteGraphic", uuid: "delete-me" },
		]);
		assert.equal(delRes.ok, true, delRes.error);
		const ast = parse(delRes.text);
		assert.equal(findNodeByUuid(ast, "delete-me"), null);
		assert.ok(findNodeByUuid(ast, "keep-me"));
	});

	test("chained graphic edits preserve serializable kicad_pcb ast", () => {
		const edits = [
			{
				op: "addGraphic",
				graphic: {
					kind: "circle",
					layer: "F.SilkS",
					x: 10,
					y: 10,
					x2: 15,
					y2: 10,
					uuid: "c1",
				},
			},
			{
				op: "addGraphic",
				graphic: {
					kind: "text",
					layer: "F.SilkS",
					text: "Test",
					x: 5,
					y: 5,
					uuid: "t1",
				},
			},
			{ op: "deleteGraphic", uuid: "c1" },
		];
		const res = applyPcbEdits(BASE_PCB, edits);
		assert.equal(res.ok, true, res.error);
		const ast = parse(res.text);
		assert.equal(ast[0]?.sym, "kicad_pcb");
		assert.equal(findNodeByUuid(ast, "c1"), null);
		assert.ok(findNodeByUuid(ast, "t1"));
	});

	for (const row of ERROR_CASES) {
		test(`error handling: ${row.name}`, () => {
			const res = applyPcbEdits(BASE_PCB, [row.edit]);
			assert.equal(res.ok, false, `Expected error for ${row.name}`);
			assert.ok(res.error, `Error message required for ${row.name}`);
		});
	}
});
