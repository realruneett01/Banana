import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyCommand,
	createEditor,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";

function createPart(
	id,
	ref,
	value,
	{
		placement,
		symbol = "Device:R",
		footprint = "Resistor_SMD:R_0805",
		props = {},
	} = {},
) {
	return { id, ref, value, symbol, footprint, props, placement };
}

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

function buildParts() {
	return [
		createPart("part_u1", "U1", "NE555", {
			placement: { x: 100, y: 100, rot: 0, side: "F" },
			symbol: "Timer:NE555",
			footprint: "Package_SO:SOIC-8",
			props: { temp: "industrial" },
		}),
		createPart("part_r1", "R1", "10k", {
			placement: { x: 200, y: 100, rot: 90, side: "F" },
		}),
		createPart("part_r2", "R2", "1k", {
			placement: { x: 300, y: 100, rot: 180, side: "B" },
		}),
	];
}

function buildNets() {
	return [
		{
			id: "net_vcc",
			name: "VCC",
			pins: [
				{ partId: "part_u1", pin: "8" },
				{ partId: "part_r1", pin: "1" },
			],
		},
		{
			id: "net_gnd",
			name: "GND",
			pins: [{ partId: "part_u1", pin: "1" }],
		},
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

const ROUND_TRIP_CASES = [
	{
		name: "addPart with explicit id",
		command: {
			type: "addPart",
			part: makeCapPart("part_c1", "C1", "100nF"),
		},
	},
	{
		name: "deletePart removes part and pins",
		command: { type: "deletePart", partId: "part_r1" },
	},
	{
		name: "movePart updates placement",
		command: { type: "movePart", partId: "part_u1", x: 150, y: 250 },
	},
	...[
		["positive delta", 90],
		["negative delta", -90],
		["> 360 delta", 450],
	].map(([desc, deltaDeg]) => ({
		name: `rotatePart with ${desc}`,
		command: { type: "rotatePart", partId: "part_u1", deltaDeg },
	})),
	{
		name: "flipPart F to B",
		command: { type: "flipPart", partId: "part_u1" },
	},
	...[
		["ref", "U99"],
		["value", "TLC555"],
	].map(([field, value]) => ({
		name: `setPartField ${field}`,
		command: { type: "setPartField", partId: "part_u1", field, value },
	})),
	...[
		["add prop", "package", "DIP"],
		["update existing prop", "temp", "commercial"],
		["delete prop", "temp", undefined],
	].map(([desc, key, value]) => ({
		name: `setPartProp ${desc}`,
		command: { type: "setPartProp", partId: "part_u1", key, value },
	})),
	...[
		["connect unconnected pins creates new net", "part_r2", "2"],
		["connect unconnected pin to existing net", "part_u1", "8"],
	].map(([name, partIdB, pinB]) => ({
		name,
		command: { type: "connect", partIdA: "part_r2", pinA: "1", partIdB, pinB },
	})),
	{
		name: "disconnect pin from net",
		command: { type: "disconnect", partId: "part_r1", pin: "1" },
	},
	{
		name: "renameNet updates name",
		command: { type: "renameNet", netId: "net_vcc", name: "VCC_3V3" },
	},
	{
		name: "batch executes multiple commands",
		command: {
			type: "batch",
			commands: makeBatchCommands("ref", "U10"),
		},
	},
];

describe("round-trip editor undo and redo", () => {
	for (const { name, command } of ROUND_TRIP_CASES) {
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

describe("batch command", () => {
	test("batch undo is one step", () => {
		const { baseIr, editor } = setupEditor();
		editor.dispatch({
			type: "batch",
			commands: makeBatchCommands("value", "NEW555"),
		});
		assertHistoryLengths(editor, 1);
		assert.equal(editor.canUndo, true);

		assertUndoneState(editor, baseIr);
		assertHistoryLengths(editor, 0, 1);

		editor.redo();
		assertHistoryLengths(editor, 1);
		assert.equal(editor.state.ir.parts[0].value, "NEW555");
	});
});

describe("connect and net merging", () => {
	test("connect merges two distinct nets correctly", () => {
		const { baseIr, editor } = setupEditor();
		editor.dispatch({
			type: "connect",
			partIdA: "part_u1",
			pinA: "8",
			partIdB: "part_u1",
			pinB: "1",
		});
		assertNetCount(editor, 1);
		const mergedNet = editor.state.ir.nets[0];
		assert.equal(mergedNet.id, "net_vcc");
		assert.equal(mergedNet.pins.length, 3);

		assertUndoneState(editor, baseIr);
		assertNetCount(editor, 2);
	});
});

describe("deletePart pin cleanup", () => {
	test("deletePart removes pins from nets while keeping empty nets", () => {
		const { baseIr, editor } = setupEditor();
		editor.dispatch({ type: "deletePart", partId: "part_u1" });

		assert.equal(editor.state.ir.parts.length, 2);
		assertNetCount(editor, 2);
		const vcc = editor.state.ir.nets.find((n) => n.id === "net_vcc");
		assert.equal(vcc.pins.length, 1);
		assert.equal(vcc.pins[0].partId, "part_r1");

		const gnd = editor.state.ir.nets.find((n) => n.id === "net_gnd");
		assert.equal(gnd.pins.length, 0);

		assertUndoneState(editor, baseIr);
	});
});

describe("id permanence", () => {
	test("ids never change on move or rotate", () => {
		const { editor } = setupEditor();
		editor.dispatch({
			type: "movePart",
			partId: "part_u1",
			x: 999,
			y: 888,
		});
		assert.equal(editor.state.ir.parts[0].id, "part_u1");

		editor.dispatch({
			type: "rotatePart",
			partId: "part_u1",
			deltaDeg: 180,
		});
		assert.equal(editor.state.ir.parts[0].id, "part_u1");
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
].map(([name, command]) => ({ name, command }));

describe("invalid commands", () => {
	for (const { name, command } of INVALID_CASES) {
		test(`invalid command returns error and no change: ${name}`, () => {
			const { baseIr, editor } = setupEditor();
			editor.dispatch(command);
			assertInvalidState(editor, baseIr);
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
		const { baseIr, editor } = setupEditor();
		editor.dispatch({ type: "select", ids: ["part_u1", "net_vcc"] });
		assert.deepEqual(editor.selection, ["part_u1", "net_vcc"]);
		assertNoUndoState(editor, baseIr);
	});

	test("addPart assigns id using idFn when id is missing", () => {
		const { baseIr, editor } = setupEditor();
		editor.dispatch({
			type: "addPart",
			part: makeCapPart(undefined, "C10", "10uF"),
		});
		const addedPart = editor.state.ir.parts[3];
		assert.equal(typeof addedPart.id, "string");
		assert.equal(addedPart.id.startsWith("part_mock_"), true);

		assertUndoneState(editor, baseIr);

		editor.redo();
		assert.equal(editor.state.ir.parts[3].id, addedPart.id);
	});
});
