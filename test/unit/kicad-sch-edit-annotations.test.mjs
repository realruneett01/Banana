import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySchEdits } from "../../backend/src/engine/kicad-sch-edit.js";
import { parse, sym } from "../../backend/src/engine/sexpr.js";

const BASE_SCH = `(kicad_sch
	(version 20231120)
	(generator "banana")
	(uuid "00000000-0000-0000-0000-000000000000")
	(paper "A4")
)`;

const FIXED_UUID = "test-uuid-1234";
const EDIT_OPTIONS = { newUuid: () => FIXED_UUID };
const UUID_NODE = [sym("uuid"), FIXED_UUID];
const FONT_EFFECTS = [sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]];
const DEFAULT_STROKE = [
	sym("stroke"),
	[sym("width"), 0],
	[sym("type"), sym("default")],
];
const INPUT_SHAPE = [sym("shape"), sym("input")];

function findChildNode(node, tag) {
	return node?.find?.((c) => Array.isArray(c) && c[0]?.sym === tag);
}

function findNodeByUuid(root, uuid) {
	for (let i = 1; i < root.length; i++) {
		if (findChildNode(root[i], "uuid")?.[1] === uuid) {
			return root[i];
		}
	}
	return null;
}

function makeTextNode(tag, text, at, extra = null) {
	const node = [sym(tag), text];
	if (extra) {
		node.push(extra);
	}
	node.push(at, FONT_EFFECTS, UUID_NODE);
	return node;
}

function makeSegmentNode(tag, pts) {
	return [
		sym(tag),
		[sym("pts"), [sym("xy"), pts[0], pts[1]], [sym("xy"), pts[2], pts[3]]],
		DEFAULT_STROKE,
		UUID_NODE,
	];
}

function makeLabelCase(name, { net, x, y, rot = 0, kind = null }) {
	const head = kind ? `${kind}_label` : "label";
	const extra = kind ? INPUT_SHAPE : null;
	const edit = { op: "addLabel", net, x, y };
	if (rot) {
		edit.rot = rot;
	}
	if (kind) {
		edit.kind = kind;
	}
	return {
		name,
		edit,
		head,
		expected: makeTextNode(head, net, [sym("at"), x, y, rot], extra),
	};
}

function makeSegmentCase(op, name, head, pts) {
	return {
		name,
		edit: { op, x1: pts[0], y1: pts[1], x2: pts[2], y2: pts[3] },
		head,
		expected: makeSegmentNode(head, pts),
	};
}

const OP_TEST_CASES = [
	makeLabelCase("addLabel local default", { net: "CLK", x: 10, y: 20 }),
	makeLabelCase("addLabel global with rot", {
		net: "VCC",
		x: 30,
		y: 40,
		rot: 180,
		kind: "global",
	}),
	makeLabelCase("addLabel hierarchical", {
		net: "DATA",
		x: 50,
		y: 60,
		kind: "hierarchical",
	}),
	{
		name: "addJunction",
		edit: { op: "addJunction", x: 15.24, y: 25.4 },
		head: "junction",
		expected: [
			sym("junction"),
			[sym("at"), 15.24, 25.4],
			[sym("diameter"), 0],
			[sym("color"), 0, 0, 0, 0],
			UUID_NODE,
		],
	},
	{
		name: "addText",
		edit: { op: "addText", text: "Notes", x: 100, y: 200, rot: 90 },
		head: "text",
		expected: makeTextNode("text", "Notes", [sym("at"), 100, 200, 90]),
	},
	makeSegmentCase("addLine", "addLine", "polyline", [10, 20, 30, 40]),
	makeSegmentCase("addBus", "addBus", "bus", [5, 10, 15, 20]),
];

const INVALID_EDIT_CASES = [
	[
		"addLabel invalid kind",
		{ op: "addLabel", net: "N1", x: 0, y: 0, kind: "unknown" },
	],
	["addLabel empty net", { op: "addLabel", net: "", x: 0, y: 0 }],
	["addLabel missing net", { op: "addLabel", x: 0, y: 0 }],
	["addJunction non-finite x", { op: "addJunction", x: Number.NaN, y: 0 }],
	[
		"addJunction non-finite y",
		{ op: "addJunction", x: 0, y: Number.POSITIVE_INFINITY },
	],
	["addText empty text", { op: "addText", text: "", x: 0, y: 0 }],
	["addText missing text", { op: "addText", x: 0, y: 0 }],
	["addText non-finite x", { op: "addText", text: "T", x: "bad", y: 0 }],
	["addLine non-finite x1", { op: "addLine", x1: "bad", y1: 0, x2: 1, y2: 1 }],
	["addLine non-finite y2", { op: "addLine", x1: 0, y1: 0, x2: 1, y2: null }],
	[
		"addBus non-finite x2",
		{ op: "addBus", x1: 0, y1: 0, x2: undefined, y2: 1 },
	],
	["deleteItem missing uuid", { op: "deleteItem" }],
	["deleteItem empty uuid", { op: "deleteItem", uuid: "" }],
	["deleteItem non-existent uuid", { op: "deleteItem", uuid: "not-found" }],
];

function assertValidEdit(tc) {
	const res = applySchEdits(BASE_SCH, [tc.edit], EDIT_OPTIONS);
	assert.equal(res.ok, true);
	const ast = parse(res.text);
	assert.deepEqual(findChildNode(ast, tc.head), tc.expected);
}

function assertInvalidEdit(edit) {
	const res = applySchEdits(BASE_SCH, [edit]);
	assert.equal(res.ok, false);
	assert.match(res.error, /\S+/);
}

describe("kicad-sch-edit annotations", () => {
	for (const tc of OP_TEST_CASES) {
		it(`produces exact node for ${tc.name}`, () => {
			assertValidEdit(tc);
		});
	}

	it("deleteItem removes only matching uuid among multiple items", () => {
		let counter = 0;
		const options = { newUuid: () => `id-${++counter}` };
		const edits = [
			{ op: "addJunction", x: 10, y: 10 },
			{ op: "addText", text: "KeepMe", x: 20, y: 20 },
			{ op: "addLine", x1: 0, y1: 0, x2: 5, y2: 5 },
			{ op: "deleteItem", uuid: "id-2" },
		];
		const res = applySchEdits(BASE_SCH, edits, options);
		assert.equal(res.ok, true);
		const ast = parse(res.text);
		assert.ok(findNodeByUuid(ast, "id-1"));
		assert.equal(findNodeByUuid(ast, "id-2"), null);
		assert.ok(findNodeByUuid(ast, "id-3"));
	});

	for (const [name, edit] of INVALID_EDIT_CASES) {
		it(`rejects invalid input: ${name}`, () => {
			assertInvalidEdit(edit);
		});
	}
});
