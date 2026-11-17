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

function findChildNode(node, tag) {
	return node?.find?.((c) => Array.isArray(c) && c[0]?.sym === tag);
}

function findNodeByUuid(root, uuid) {
	for (let i = 1; i < root.length; i++) {
		const child = root[i];
		const uuidChild = findChildNode(child, "uuid");
		if (uuidChild?.[1] === uuid) {
			return child;
		}
	}
	return null;
}

const OP_TEST_CASES = [
	{
		name: "addLabel local default",
		edit: { op: "addLabel", net: "CLK", x: 10, y: 20 },
		head: "label",
		expected: [
			sym("label"),
			"CLK",
			[sym("at"), 10, 20, 0],
			[sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]],
			[sym("uuid"), FIXED_UUID],
		],
	},
	{
		name: "addLabel global with rot",
		edit: {
			op: "addLabel",
			net: "VCC",
			x: 30,
			y: 40,
			rot: 180,
			kind: "global",
		},
		head: "global_label",
		expected: [
			sym("global_label"),
			"VCC",
			[sym("shape"), sym("input")],
			[sym("at"), 30, 40, 180],
			[sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]],
			[sym("uuid"), FIXED_UUID],
		],
	},
	{
		name: "addLabel hierarchical",
		edit: {
			op: "addLabel",
			net: "DATA",
			x: 50,
			y: 60,
			kind: "hierarchical",
		},
		head: "hierarchical_label",
		expected: [
			sym("hierarchical_label"),
			"DATA",
			[sym("shape"), sym("input")],
			[sym("at"), 50, 60, 0],
			[sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]],
			[sym("uuid"), FIXED_UUID],
		],
	},
	{
		name: "addJunction",
		edit: { op: "addJunction", x: 15.24, y: 25.4 },
		head: "junction",
		expected: [
			sym("junction"),
			[sym("at"), 15.24, 25.4],
			[sym("diameter"), 0],
			[sym("color"), 0, 0, 0, 0],
			[sym("uuid"), FIXED_UUID],
		],
	},
	{
		name: "addText",
		edit: { op: "addText", text: "Notes", x: 100, y: 200, rot: 90 },
		head: "text",
		expected: [
			sym("text"),
			"Notes",
			[sym("at"), 100, 200, 90],
			[sym("effects"), [sym("font"), [sym("size"), 1.27, 1.27]]],
			[sym("uuid"), FIXED_UUID],
		],
	},
	{
		name: "addLine",
		edit: { op: "addLine", x1: 10, y1: 20, x2: 30, y2: 40 },
		head: "polyline",
		expected: [
			sym("polyline"),
			[sym("pts"), [sym("xy"), 10, 20], [sym("xy"), 30, 40]],
			[sym("stroke"), [sym("width"), 0], [sym("type"), sym("default")]],
			[sym("uuid"), FIXED_UUID],
		],
	},
	{
		name: "addBus",
		edit: { op: "addBus", x1: 5, y1: 10, x2: 15, y2: 20 },
		head: "bus",
		expected: [
			sym("bus"),
			[sym("pts"), [sym("xy"), 5, 10], [sym("xy"), 15, 20]],
			[sym("stroke"), [sym("width"), 0], [sym("type"), sym("default")]],
			[sym("uuid"), FIXED_UUID],
		],
	},
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

describe("kicad-sch-edit annotations", () => {
	for (const tc of OP_TEST_CASES) {
		it(`produces exact node for ${tc.name}`, () => {
			const res = applySchEdits(BASE_SCH, [tc.edit], EDIT_OPTIONS);
			assert.equal(res.ok, true);
			const ast = parse(res.text);
			const node = findChildNode(ast, tc.head);
			assert.deepEqual(node, tc.expected);
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
			const res = applySchEdits(BASE_SCH, [edit]);
			assert.equal(res.ok, false);
			assert.equal(typeof res.error, "string");
			assert.ok(res.error.length > 0);
		});
	}
});
