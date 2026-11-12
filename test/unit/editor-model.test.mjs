import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyCommand,
	createEditor,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";

function makeCapPart(id, ref, value) {
	const part = {
		ref,
		value,
		symbol: "Device:C",
		footprint: "Capacitor_SMD:C_0805",
	};
	if (id !== undefined) {
		part.id = id;
		part.props = {};
	}
	return part;
}

function makeResistorPart(id, ref, value, placement) {
	return {
		id,
		ref,
		value,
		symbol: "Device:R",
		footprint: "Resistor_SMD:R_0805",
		props: {},
		placement: { y: 100, ...placement },
	};
}

function buildParts() {
	return [
		{
			id: "part_u1",
			ref: "U1",
			value: "NE555",
			symbol: "Timer:NE555",
			footprint: "Package_SO:SOIC-8",
			props: { temp: "industrial" },
			placement: { x: 100, y: 100, rot: 0, side: "F" },
		},
		makeResistorPart("part_r1", "R1", "10k", { x: 200, rot: 90, side: "F" }),
		makeResistorPart("part_r2", "R2", "1k", { x: 300, rot: 180, side: "B" }),
	];
}

function makeNet(id, name, pins) {
	return {
		id,
		name,
		pins: pins.map(([partId, pin]) => ({ partId, pin })),
	};
}

function buildNets() {
	return [
		makeNet("net_vcc", "VCC", [
			["part_u1", "8"],
			["part_r1", "1"],
		]),
		makeNet("net_gnd", "GND", [["part_u1", "1"]]),
	];
}

function buildBaseIr() {
	return {
		schemaVersion: 1,
		name: "test-circuit",
		parts: buildParts(),
		nets: buildNets(),
		constraints: [
			{ id: "c1", kind: "rail", target: "VCC", value: 5, unit: "V" },
		],
	};
}

let counter = 0;
function mockIdFn(kind) {
	counter += 1;
	return `${kind}_mock_${counter}`;
}

function setupEditor() {
	const baseIr = buildBaseIr();
	const editor = createEditor(baseIr, { idFn: mockIdFn });
	return { baseIr, editor };
}

function setupAndDispatch(command) {
	const ctx = setupEditor();
	ctx.editor.dispatch(command);
	return ctx;
}

function makeBatchCommands(field, value) {
	return [
		{ type: "movePart", partId: "part_u1", x: 10, y: 20 },
		{ type: "rotatePart", partId: "part_u1", deltaDeg: 90 },
		{ type: "setPartField", partId: "part_u1", field, value },
	];
}

function assertModifiedState(editor, baseIr) {
	assert.notDeepEqual(editor.state.ir, baseIr);
	assert.equal(editor.canUndo, true);
}

function assertUndoneState(editor, baseIr) {
	editor.undo();
	assert.deepEqual(editor.state.ir, baseIr);
}

function assertNoUndoState(editor, baseIr) {
	assert.equal(editor.canUndo, false);
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
	const inv = invertCommand(doc0, command);
	const doc1 = applyCommand(doc0, command, { idFn: mockIdFn });
	assert.equal(doc1.error, undefined);

	const docRestored = applyCommand(doc1, inv, { idFn: mockIdFn });
	assert.deepEqual(docRestored.ir, baseIr);
}

function assertHistoryLengths(editor, past, future) {
	assert.equal(editor.state.history.past.length, past);
	if (future !== undefined) {
		assert.equal(editor.state.history.future.length, future);
	}
}

function assertNetCount(editor, expected) {
	assert.equal(editor.state.ir.nets.length, expected);
}

function assertInvalidState(editor, baseIr) {
	assert.equal(typeof editor.state.error, "string");
	assertNoUndoState(editor, baseIr);
}

function assertEditorUndoRedoRoundTrip(command) {
	const { baseIr, editor } = setupAndDispatch(command);
	assertUndoRedoCycle(editor, baseIr);
}

function assertInvalidDispatch(command) {
	const { baseIr, editor } = setupAndDispatch(command);
	assertInvalidState(editor, baseIr);
}

function assertBatchCheck(editor, { past, canUndo, partValue } = {}) {
	if (past !== undefined) assert.equal(editor.state.history.past.length, past);
	if (canUndo !== undefined) assert.equal(editor.canUndo, canUndo);
	if (partValue !== undefined)
		assert.equal(editor.state.ir.parts[0].value, partValue);
}

function assertBatchUndoFlow(editor, baseIr, expectedValue) {
	assertBatchCheck(editor, { past: 1, canUndo: true });
	assertUndoneState(editor, baseIr);
	assertHistoryLengths(editor, 0, 1);
	editor.redo();
	assertBatchCheck(editor, { past: 1, partValue: expectedValue });
}

function assertNetInfo(net, id, pinCount) {
	assert.equal(net.id, id);
	assert.equal(net.pins.length, pinCount);
}

function assertMergedNet(editor, baseIr) {
	assertNetCount(editor, 1);
	assertNetInfo(editor.state.ir.nets[0], "net_vcc", 3);
	assertUndoneState(editor, baseIr);
	assertNetCount(editor, 2);
}

function assertPinCleanup(editor, baseIr) {
	assert.equal(editor.state.ir.parts.length, 2);
	assertNetCount(editor, 2);
	const vcc = editor.state.ir.nets.find((n) => n.id === "net_vcc");
	const gnd = editor.state.ir.nets.find((n) => n.id === "net_gnd");
	assert.equal(vcc.pins[0].partId, "part_r1");
	assert.equal(vcc.pins.length, 1);
	assert.equal(gnd.pins.length, 0);
	assertUndoneState(editor, baseIr);
}

function assertPartId(editor, index, expectedId) {
	assert.equal(editor.state.ir.parts[index].id, expectedId);
}

function assertGeneratedMockId(id) {
	assert.equal(typeof id, "string");
	assert.equal(id.startsWith("part_mock_"), true);
}

function makeRoundTripCases() {
	return [
		[
			"addPart with explicit id",
			{ type: "addPart", part: makeCapPart("part_c1", "C1", "100nF") },
		],
		[
			"deletePart removes part and pins",
			{ type: "deletePart", partId: "part_r1" },
		],
		[
			"movePart updates placement",
			{ type: "movePart", partId: "part_u1", x: 150, y: 250 },
		],
		[
			"rotatePart with positive delta",
			{ type: "rotatePart", partId: "part_u1", deltaDeg: 90 },
		],
		[
			"rotatePart with negative delta",
			{ type: "rotatePart", partId: "part_u1", deltaDeg: -90 },
		],
		[
			"rotatePart with > 360 delta",
			{ type: "rotatePart", partId: "part_u1", deltaDeg: 450 },
		],
		["flipPart F to B", { type: "flipPart", partId: "part_u1" }],
		[
			"setPartField ref",
			{ type: "setPartField", partId: "part_u1", field: "ref", value: "U99" },
		],
		[
			"setPartField value",
			{
				type: "setPartField",
				partId: "part_u1",
				field: "value",
				value: "TLC555",
			},
		],
		[
			"setPartProp add prop",
			{
				type: "setPartProp",
				partId: "part_u1",
				key: "package",
				value: "DIP",
			},
		],
		[
			"setPartProp update existing prop",
			{
				type: "setPartProp",
				partId: "part_u1",
				key: "temp",
				value: "commercial",
			},
		],
		[
			"setPartProp delete prop",
			{
				type: "setPartProp",
				partId: "part_u1",
				key: "temp",
				value: undefined,
			},
		],
		[
			"connect unconnected pins creates new net",
			{
				type: "connect",
				partIdA: "part_r2",
				pinA: "1",
				partIdB: "part_r2",
				pinB: "2",
			},
		],
		[
			"connect unconnected pin to existing net",
			{
				type: "connect",
				partIdA: "part_r2",
				pinA: "1",
				partIdB: "part_u1",
				pinB: "8",
			},
		],
		[
			"disconnect pin from net",
			{ type: "disconnect", partId: "part_r1", pin: "1" },
		],
		[
			"renameNet updates name",
			{ type: "renameNet", netId: "net_vcc", name: "VCC_3V3" },
		],
		[
			"batch executes multiple commands",
			{ type: "batch", commands: makeBatchCommands("ref", "U10") },
		],
	];
}

const ROUND_TRIP_CASES = makeRoundTripCases();

describe("round-trip editor undo and redo", () => {
	for (const [name, command] of ROUND_TRIP_CASES) {
		test(`editor undo/redo round-trip: ${name}`, () => {
			assertEditorUndoRedoRoundTrip(command);
		});

		test(`pure applyCommand / invertCommand round-trip: ${name}`, () => {
			assertPureInvertCycle(buildBaseIr(), command);
		});
	}
});

describe("batch command", () => {
	test("batch undo is one step", () => {
		const { baseIr, editor } = setupAndDispatch({
			type: "batch",
			commands: makeBatchCommands("value", "NEW555"),
		});
		assertBatchUndoFlow(editor, baseIr, "NEW555");
	});
});

describe("connect and net merging", () => {
	test("connect merges two distinct nets correctly", () => {
		const { baseIr, editor } = setupAndDispatch({
			type: "connect",
			partIdA: "part_u1",
			pinA: "8",
			partIdB: "part_u1",
			pinB: "1",
		});
		assertMergedNet(editor, baseIr);
	});
});

describe("deletePart pin cleanup", () => {
	test("deletePart removes pins from nets while keeping empty nets", () => {
		const { baseIr, editor } = setupAndDispatch({
			type: "deletePart",
			partId: "part_u1",
		});
		assertPinCleanup(editor, baseIr);
	});
});

describe("id permanence", () => {
	test("ids never change on move or rotate", () => {
		const { editor } = setupAndDispatch({
			type: "movePart",
			partId: "part_u1",
			x: 999,
			y: 888,
		});
		assertPartId(editor, 0, "part_u1");

		editor.dispatch({
			type: "rotatePart",
			partId: "part_u1",
			deltaDeg: 180,
		});
		assertPartId(editor, 0, "part_u1");
	});
});

const INVALID_CASES = [
	["null command", null],
	["missing type", {}],
	["unknown type", { type: "unknownCommand" }],
	[
		"movePart non-numeric x",
		{ type: "movePart", partId: "part_u1", x: "abc", y: 10 },
	],
	[
		"movePart missing part",
		{ type: "movePart", partId: "missing_id", x: 10, y: 10 },
	],
	[
		"rotatePart non-numeric deg",
		{ type: "rotatePart", partId: "part_u1", deltaDeg: "not_a_num" },
	],
	["flipPart missing part", { type: "flipPart", partId: "missing_id" }],
	[
		"setPartField invalid field",
		{
			type: "setPartField",
			partId: "part_u1",
			field: "invalid",
			value: "val",
		},
	],
	[
		"setPartProp empty key",
		{ type: "setPartProp", partId: "part_u1", key: "", value: "val" },
	],
	[
		"connect pin to itself",
		{
			type: "connect",
			partIdA: "part_u1",
			pinA: "1",
			partIdB: "part_u1",
			pinB: "1",
		},
	],
	[
		"disconnect unconnected pin",
		{ type: "disconnect", partId: "part_r2", pin: "99" },
	],
	[
		"renameNet missing net",
		{ type: "renameNet", netId: "missing_net", name: "NEW" },
	],
	["select non-array ids", { type: "select", ids: "not-an-array" }],
	["batch non-array commands", { type: "batch", commands: "not-an-array" }],
];

describe("invalid commands", () => {
	for (const [name, command] of INVALID_CASES) {
		test(`invalid command returns error and no change: ${name}`, () => {
			assertInvalidDispatch(command);
		});
	}
});

describe("history cap", () => {
	test("caps past history at 200", () => {
		const { editor } = setupEditor();
		for (let i = 0; i < 210; i++) {
			editor.dispatch({
				type: "movePart",
				partId: "part_u1",
				x: i,
				y: i,
			});
		}
		assertHistoryLengths(editor, 200);
		for (let i = 0; i < 200; i++) {
			assert.equal(editor.canUndo, true);
			editor.undo();
		}
		assert.equal(editor.canUndo, false);
	});
});

describe("selection and missing id handling", () => {
	test("select command updates selection without undo entry", () => {
		const { baseIr, editor } = setupAndDispatch({
			type: "select",
			ids: ["part_u1", "net_vcc"],
		});
		assert.deepEqual(editor.selection, ["part_u1", "net_vcc"]);
		assertNoUndoState(editor, baseIr);
	});

	test("addPart assigns id using idFn when id is missing", () => {
		const { baseIr, editor } = setupAndDispatch({
			type: "addPart",
			part: makeCapPart(undefined, "C10", "10uF"),
		});
		const addedId = editor.state.ir.parts[3].id;
		assertGeneratedMockId(addedId);

		assertUndoneState(editor, baseIr);

		editor.redo();
		assertPartId(editor, 3, addedId);
	});
});
