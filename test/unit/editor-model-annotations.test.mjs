import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyCommand,
	createEditor,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";

function buildTestAnnotations() {
	return [
		{
			id: "ann-1",
			kind: "junction",
			x: 100,
			y: 100,
		},
		{
			id: "ann-2",
			kind: "line",
			x: 10,
			y: 20,
			x2: 30,
			y2: 40,
		},
		{
			id: "ann-3",
			kind: "bus",
			x: 50,
			y: 60,
			x2: 70,
			y2: 80,
		},
	];
}

function buildBaseIr(withAnnotations = true) {
	const ir = {
		schemaVersion: 1,
		name: "test-annotations-circuit",
		parts: [{ id: "part_u1", ref: "U1", value: "NE555" }],
		nets: [],
	};
	if (withAnnotations) {
		ir.annotations = buildTestAnnotations();
	}
	return ir;
}

function setupEditor(baseIr = buildBaseIr()) {
	const editor = createEditor(baseIr);
	return { baseIr, editor };
}

function assertModifiedState(editor, baseIr) {
	assert.notDeepEqual(editor.state.ir, baseIr);
	assert.equal(editor.canUndo, true);
}

function assertUndoneState(editor, baseIr) {
	editor.undo();
	assert.deepEqual(editor.state.ir, baseIr);
}

function assertUndoRedoCycle(editor, baseIr) {
	assertModifiedState(editor, baseIr);
	assertUndoneState(editor, baseIr);
	assert.equal(editor.canUndo, false);
	assert.equal(editor.canRedo, true);
	editor.redo();
	assertModifiedState(editor, baseIr);
	assertUndoneState(editor, baseIr);
}

function assertPureInvertCycle(baseIr, command) {
	const doc0 = {
		ir: baseIr,
		selection: [],
		history: { past: [], future: [] },
	};
	const inverse = invertCommand(doc0, command);
	assert.ok(inverse, "inverse must exist");
	const docAfter = applyCommand(doc0, command);
	assert.equal(docAfter.error, undefined);
	const docRestored = applyCommand(docAfter, inverse);
	assert.deepEqual(docRestored.ir, baseIr);
}

const ROUND_TRIP_CASES = [
	[
		"addAnnotation with explicit id",
		{
			type: "addAnnotation",
			annotation: {
				id: "ann-explicit",
				kind: "label",
				x: 120,
				y: 130,
				text: "CLK",
			},
		},
	],
	[
		"deleteAnnotation removes annotation",
		{
			type: "deleteAnnotation",
			id: "ann-1",
		},
	],
	[
		"moveAnnotation point coordinates",
		{
			type: "moveAnnotation",
			id: "ann-1",
			dx: 15,
			dy: -10,
		},
	],
	[
		"moveAnnotation line coordinates with x2 and y2",
		{
			type: "moveAnnotation",
			id: "ann-2",
			dx: 25,
			dy: 35,
		},
	],
	[
		"moveAnnotation bus coordinates with x2 and y2",
		{
			type: "moveAnnotation",
			id: "ann-3",
			dx: -20,
			dy: -30,
		},
	],
];

describe("round-trip editor undo and redo for annotations", () => {
	for (const [name, command] of ROUND_TRIP_CASES) {
		test(`editor undo/redo round-trip: ${name}`, () => {
			const { baseIr, editor } = setupEditor();
			editor.dispatch(command);
			assertUndoRedoCycle(editor, baseIr);
		});

		test(`pure applyCommand / invertCommand round-trip: ${name}`, () => {
			assertPureInvertCycle(buildBaseIr(), command);
		});
	}
});

describe("addAnnotation auto id generation", () => {
	test("assigns sequential ann-1 and ann-2 when id is missing", () => {
		const baseIr = { schemaVersion: 1, name: "empty-ann", parts: [], nets: [] };
		const editor = createEditor(baseIr);
		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "label", x: 10, y: 20, text: "VCC" },
		});
		assert.equal(editor.state.ir.annotations[0].id, "ann-1");

		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "junction", x: 30, y: 40 },
		});
		assert.equal(editor.state.ir.annotations[1].id, "ann-2");
		assert.equal(editor.state.ir.annotations.length, 2);

		editor.undo();
		assert.equal(editor.state.ir.annotations.length, 1);
		assert.equal(editor.state.ir.annotations[0].id, "ann-1");

		editor.redo();
		assert.equal(editor.state.ir.annotations.length, 2);
		assert.equal(editor.state.ir.annotations[1].id, "ann-2");
	});

	test("auto id increments beyond existing max ann-N", () => {
		const baseIr = {
			schemaVersion: 1,
			name: "existing-ann",
			parts: [],
			nets: [],
			annotations: [{ id: "ann-7", kind: "junction", x: 0, y: 0 }],
		};
		const editor = createEditor(baseIr);
		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "noConnect", x: 5, y: 5 },
		});
		assert.equal(editor.state.ir.annotations[1].id, "ann-8");
	});
});

describe("moveAnnotation coordinate precision", () => {
	test("moves only x and y for point annotation", () => {
		const { editor } = setupEditor();
		editor.dispatch({
			type: "moveAnnotation",
			id: "ann-1",
			dx: 5,
			dy: 7,
		});
		const item = editor.state.ir.annotations.find((a) => a.id === "ann-1");
		assert.equal(item.x, 105);
		assert.equal(item.y, 107);
		assert.equal("x2" in item, false);
		assert.equal("y2" in item, false);
	});

	test("moves both (x, y) and (x2, y2) for line annotation", () => {
		const { editor } = setupEditor();
		editor.dispatch({
			type: "moveAnnotation",
			id: "ann-2",
			dx: 10,
			dy: 20,
		});
		const item = editor.state.ir.annotations.find((a) => a.id === "ann-2");
		assert.equal(item.x, 20);
		assert.equal(item.y, 40);
		assert.equal(item.x2, 40);
		assert.equal(item.y2, 60);
	});
});

describe("unknown id is a no-op", () => {
	const NOOP_CASES = [
		[
			"deleteAnnotation with unknown id",
			{ type: "deleteAnnotation", id: "unknown" },
		],
		[
			"moveAnnotation with unknown id",
			{ type: "moveAnnotation", id: "unknown", dx: 5, dy: 5 },
		],
	];

	for (const [name, command] of NOOP_CASES) {
		test(`editor dispatch ${name} is a no-op`, () => {
			const { baseIr, editor } = setupEditor();
			editor.dispatch(command);
			assert.equal(editor.canUndo, false);
			assert.deepEqual(editor.state.ir, baseIr);
			assert.equal(editor.state.error, undefined);
		});

		test(`applyCommand ${name} returns unmodified doc`, () => {
			const doc = {
				ir: buildBaseIr(),
				selection: [],
				history: { past: [], future: [] },
			};
			const res = applyCommand(doc, command);
			assert.deepEqual(res, doc);
			assert.equal(res.error, undefined);
		});
	}
});

describe("selection handling with annotations", () => {
	test("selects annotation id and deselects on deleteAnnotation", () => {
		const { editor } = setupEditor();
		editor.dispatch({ type: "select", ids: ["part_u1", "ann-1"] });
		assert.deepEqual(editor.selection, ["part_u1", "ann-1"]);

		editor.dispatch({ type: "deleteAnnotation", id: "ann-1" });
		assert.deepEqual(editor.selection, ["part_u1"]);
		assert.equal(
			editor.state.ir.annotations.some((a) => a.id === "ann-1"),
			false,
		);
	});
});

describe("missing ir.annotations round-trip", () => {
	test("handles undefined ir.annotations on base document", () => {
		const baseIr = buildBaseIr(false);
		const editor = createEditor(baseIr);
		assert.equal(editor.state.ir.annotations, undefined);

		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "text", x: 1, y: 2, text: "Banana" },
		});
		assert.equal(editor.state.ir.annotations.length, 1);
		assert.equal(editor.state.ir.annotations[0].id, "ann-1");

		editor.undo();
		assert.deepEqual(editor.state.ir, baseIr);
	});
});

describe("annotation command validation errors", () => {
	const ERROR_CASES = [
		["addAnnotation missing object", { type: "addAnnotation" }],
		[
			"addAnnotation non-object",
			{ type: "addAnnotation", annotation: "invalid" },
		],
		[
			"addAnnotation duplicate id",
			{
				type: "addAnnotation",
				annotation: { id: "ann-1", kind: "junction", x: 0, y: 0 },
			},
		],
		[
			"moveAnnotation non-number dx",
			{ type: "moveAnnotation", id: "ann-1", dx: "5", dy: 5 },
		],
		[
			"moveAnnotation non-number dy",
			{ type: "moveAnnotation", id: "ann-1", dx: 5, dy: null },
		],
	];

	for (const [name, command] of ERROR_CASES) {
		test(`rejects ${name}`, () => {
			const doc = {
				ir: buildBaseIr(),
				selection: [],
				history: { past: [], future: [] },
			};
			const res = applyCommand(doc, command);
			assert.ok(res.error, `expected error for ${name}`);
			assert.deepEqual(res.ir, doc.ir);
		});
	}
});
