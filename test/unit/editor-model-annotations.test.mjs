import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyCommand,
	createEditor,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";

const FIXTURE_ANNOTATIONS = [
	{ id: "ann-1", kind: "junction", x: 100, y: 100 },
	{ id: "ann-2", kind: "line", x: 10, y: 20, x2: 30, y2: 40 },
	{ id: "ann-3", kind: "bus", x: 50, y: 60, x2: 70, y2: 80 },
];

function createAnnotationHarness(options = {}) {
	const annotations = options.empty
		? undefined
		: (options.annotations ?? FIXTURE_ANNOTATIONS);
	const ir = {
		schemaVersion: 1,
		name: options.name ?? "test-annotations-circuit",
		parts: options.parts ?? [{ id: "part_u1", ref: "U1", value: "NE555" }],
		nets: [],
		...(annotations !== undefined ? { annotations } : {}),
	};
	return {
		ir,
		doc: { ir, selection: [], history: { past: [], future: [] } },
		editor: createEditor(ir),
	};
}

function dispatchCommand(command) {
	const harness = createAnnotationHarness();
	harness.editor.dispatch(command);
	return harness;
}

function applyToDoc(command) {
	const { doc } = createAnnotationHarness();
	return { doc, res: applyCommand(doc, command) };
}

function assertUndoRedoRoundTrip(editor, originalIr) {
	const steps = [
		[true, false, false],
		[false, true, true],
		[true, false, false],
		[false, true, true],
	];
	for (let i = 0; i < steps.length; i++) {
		if (i === 1 || i === 3) {
			editor.undo();
		} else if (i === 2) {
			editor.redo();
		}
		const [canUndo, canRedo, matchOriginal] = steps[i];
		assert.equal(editor.canUndo, canUndo);
		assert.equal(editor.canRedo, canRedo);
		if (matchOriginal) {
			assert.deepEqual(editor.state.ir, originalIr);
		} else {
			assert.notDeepEqual(editor.state.ir, originalIr);
		}
	}
}

function assertInvertRoundTrip(command) {
	const { ir, doc } = createAnnotationHarness();
	const inv = invertCommand(doc, command);
	assert.ok(inv, "inverse must exist");
	const step1 = applyCommand(doc, command);
	const step2 = applyCommand(step1, inv);
	assert.deepEqual(
		{ error: step1.error, ir: step2.ir },
		{ error: undefined, ir },
	);
}

function assertAnnotationIds(editor, expectedIds) {
	assert.deepEqual(
		editor.state.ir.annotations.map((a) => a.id),
		expectedIds,
	);
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
			const { ir, editor } = dispatchCommand(command);
			assertUndoRedoRoundTrip(editor, ir);
		});

		test(`pure applyCommand / invertCommand round-trip: ${name}`, () => {
			assertInvertRoundTrip(command);
		});
	}
});

describe("addAnnotation auto id generation", () => {
	test("assigns sequential ann-1 and ann-2 when id is missing", () => {
		const { editor } = createAnnotationHarness({
			empty: true,
			name: "empty-ann",
			parts: [],
		});
		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "label", x: 10, y: 20, text: "VCC" },
		});
		assertAnnotationIds(editor, ["ann-1"]);

		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "junction", x: 30, y: 40 },
		});
		assertAnnotationIds(editor, ["ann-1", "ann-2"]);

		editor.undo();
		assertAnnotationIds(editor, ["ann-1"]);

		editor.redo();
		assertAnnotationIds(editor, ["ann-1", "ann-2"]);
	});

	test("auto id increments beyond existing max ann-N", () => {
		const { editor } = createAnnotationHarness({
			name: "existing-ann",
			parts: [],
			annotations: [{ id: "ann-7", kind: "junction", x: 0, y: 0 }],
		});
		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "noConnect", x: 5, y: 5 },
		});
		assert.equal(editor.state.ir.annotations[1].id, "ann-8");
	});
});

describe("moveAnnotation coordinate precision", () => {
	function moveAndFind(id, dx, dy) {
		const { editor } = dispatchCommand({ type: "moveAnnotation", id, dx, dy });
		return editor.state.ir.annotations.find((a) => a.id === id);
	}

	test("moves only x and y for point annotation", () => {
		const item = moveAndFind("ann-1", 5, 7);
		assert.deepEqual(
			{ x: item.x, y: item.y, hasX2: "x2" in item, hasY2: "y2" in item },
			{ x: 105, y: 107, hasX2: false, hasY2: false },
		);
	});

	test("moves both (x, y) and (x2, y2) for line annotation", () => {
		const item = moveAndFind("ann-2", 10, 20);
		assert.deepEqual(
			{ x: item.x, y: item.y, x2: item.x2, y2: item.y2 },
			{ x: 20, y: 40, x2: 40, y2: 60 },
		);
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
			const { ir, editor } = dispatchCommand(command);
			assert.deepEqual(
				{
					canUndo: editor.canUndo,
					error: editor.state.error,
					ir: editor.state.ir,
				},
				{ canUndo: false, error: undefined, ir },
			);
		});

		test(`applyCommand ${name} returns unmodified doc`, () => {
			const { doc, res } = applyToDoc(command);
			assert.deepEqual(
				{ error: res.error, doc: res },
				{ error: undefined, doc },
			);
		});
	}
});

describe("selection handling with annotations", () => {
	test("selects annotation id and deselects on deleteAnnotation", () => {
		const { editor } = createAnnotationHarness();
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
		const { ir, editor } = createAnnotationHarness({ empty: true });
		assert.equal(editor.state.ir.annotations, undefined);

		editor.dispatch({
			type: "addAnnotation",
			annotation: { kind: "text", x: 1, y: 2, text: "Banana" },
		});
		assertAnnotationIds(editor, ["ann-1"]);

		editor.undo();
		assert.deepEqual(editor.state.ir, ir);
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
			const { doc, res } = applyToDoc(command);
			assert.deepEqual(
				{ hasError: typeof res.error === "string", ir: res.ir },
				{ hasError: true, ir: doc.ir },
				`expected error for ${name}`,
			);
		});
	}
});
