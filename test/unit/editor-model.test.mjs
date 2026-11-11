import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyCommand,
	createEditor,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";

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
		{
			id: "part_r1",
			ref: "R1",
			value: "10k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0805",
			props: {},
			placement: { x: 200, y: 100, rot: 90, side: "F" },
		},
		{
			id: "part_r2",
			ref: "R2",
			value: "1k",
			symbol: "Device:R",
			footprint: "Resistor_SMD:R_0805",
			props: {},
			placement: { x: 300, y: 100, rot: 180, side: "B" },
		},
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

const ROUND_TRIP_CASES = [
	{
		name: "addPart with explicit id",
		command: {
			type: "addPart",
			part: {
				id: "part_c1",
				ref: "C1",
				value: "100nF",
				symbol: "Device:C",
				footprint: "Capacitor_SMD:C_0805",
				props: {},
			},
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
	{
		name: "rotatePart with positive delta",
		command: { type: "rotatePart", partId: "part_u1", deltaDeg: 90 },
	},
	{
		name: "rotatePart with negative delta",
		command: { type: "rotatePart", partId: "part_u1", deltaDeg: -90 },
	},
	{
		name: "rotatePart with > 360 delta",
		command: { type: "rotatePart", partId: "part_u1", deltaDeg: 450 },
	},
	{
		name: "flipPart F to B",
		command: { type: "flipPart", partId: "part_u1" },
	},
	{
		name: "setPartField ref",
		command: {
			type: "setPartField",
			partId: "part_u1",
			field: "ref",
			value: "U99",
		},
	},
	{
		name: "setPartField value",
		command: {
			type: "setPartField",
			partId: "part_u1",
			field: "value",
			value: "TLC555",
		},
	},
	{
		name: "setPartProp add prop",
		command: {
			type: "setPartProp",
			partId: "part_u1",
			key: "package",
			value: "DIP",
		},
	},
	{
		name: "setPartProp update existing prop",
		command: {
			type: "setPartProp",
			partId: "part_u1",
			key: "temp",
			value: "commercial",
		},
	},
	{
		name: "setPartProp delete prop",
		command: {
			type: "setPartProp",
			partId: "part_u1",
			key: "temp",
			value: undefined,
		},
	},
	{
		name: "connect unconnected pins creates new net",
		command: {
			type: "connect",
			partIdA: "part_r2",
			pinA: "1",
			partIdB: "part_r2",
			pinB: "2",
		},
	},
	{
		name: "connect unconnected pin to existing net",
		command: {
			type: "connect",
			partIdA: "part_r2",
			pinA: "1",
			partIdB: "part_u1",
			pinB: "8",
		},
	},
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
			commands: [
				{ type: "movePart", partId: "part_u1", x: 10, y: 20 },
				{ type: "rotatePart", partId: "part_u1", deltaDeg: 90 },
				{
					type: "setPartField",
					partId: "part_u1",
					field: "ref",
					value: "U10",
				},
			],
		},
	},
];

describe("round-trip editor undo and redo", () => {
	for (const { name, command } of ROUND_TRIP_CASES) {
		test(`editor undo/redo round-trip: ${name}`, () => {
			const baseIr = buildBaseIr();
			const editor = createEditor(baseIr, { idFn: mockIdFn });
			editor.dispatch(command);
			assert.notDeepEqual(editor.state.ir, baseIr);
			assert.equal(editor.canUndo, true);

			editor.undo();
			assert.deepEqual(editor.state.ir, baseIr);
			assert.equal(editor.canUndo, false);
			assert.equal(editor.canRedo, true);

			editor.redo();
			assert.notDeepEqual(editor.state.ir, baseIr);
			assert.equal(editor.canUndo, true);

			editor.undo();
			assert.deepEqual(editor.state.ir, baseIr);
		});

		test(`pure applyCommand / invertCommand round-trip: ${name}`, () => {
			const baseIr = buildBaseIr();
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
		});
	}
});

describe("batch command", () => {
	test("batch undo is one step", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
		editor.dispatch({
			type: "batch",
			commands: [
				{ type: "movePart", partId: "part_u1", x: 10, y: 20 },
				{ type: "rotatePart", partId: "part_u1", deltaDeg: 90 },
				{
					type: "setPartField",
					partId: "part_u1",
					field: "value",
					value: "NEW555",
				},
			],
		});
		assert.equal(editor.state.history.past.length, 1);
		assert.equal(editor.canUndo, true);

		editor.undo();
		assert.equal(editor.state.history.past.length, 0);
		assert.equal(editor.state.history.future.length, 1);
		assert.deepEqual(editor.state.ir, baseIr);

		editor.redo();
		assert.equal(editor.state.history.past.length, 1);
		assert.equal(editor.state.ir.parts[0].value, "NEW555");
	});
});

describe("connect and net merging", () => {
	test("connect merges two distinct nets correctly", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
		editor.dispatch({
			type: "connect",
			partIdA: "part_u1",
			pinA: "8",
			partIdB: "part_u1",
			pinB: "1",
		});
		assert.equal(editor.state.ir.nets.length, 1);
		const mergedNet = editor.state.ir.nets[0];
		assert.equal(mergedNet.id, "net_vcc");
		assert.equal(mergedNet.pins.length, 3);

		editor.undo();
		assert.equal(editor.state.ir.nets.length, 2);
		assert.deepEqual(editor.state.ir, baseIr);
	});
});

describe("deletePart pin cleanup", () => {
	test("deletePart removes pins from nets while keeping empty nets", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
		editor.dispatch({ type: "deletePart", partId: "part_u1" });

		assert.equal(editor.state.ir.parts.length, 2);
		assert.equal(editor.state.ir.nets.length, 2);
		const vcc = editor.state.ir.nets.find((n) => n.id === "net_vcc");
		assert.equal(vcc.pins.length, 1);
		assert.equal(vcc.pins[0].partId, "part_r1");

		const gnd = editor.state.ir.nets.find((n) => n.id === "net_gnd");
		assert.equal(gnd.pins.length, 0);

		editor.undo();
		assert.deepEqual(editor.state.ir, baseIr);
	});
});

describe("id permanence", () => {
	test("ids never change on move or rotate", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
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
	{ name: "null command", command: null },
	{ name: "missing type", command: {} },
	{ name: "unknown type", command: { type: "unknownCommand" } },
	{
		name: "movePart non-numeric x",
		command: { type: "movePart", partId: "part_u1", x: "abc", y: 10 },
	},
	{
		name: "movePart missing part",
		command: { type: "movePart", partId: "missing_id", x: 10, y: 10 },
	},
	{
		name: "rotatePart non-numeric deg",
		command: {
			type: "rotatePart",
			partId: "part_u1",
			deltaDeg: "not_a_num",
		},
	},
	{
		name: "flipPart missing part",
		command: { type: "flipPart", partId: "missing_id" },
	},
	{
		name: "setPartField invalid field",
		command: {
			type: "setPartField",
			partId: "part_u1",
			field: "invalid",
			value: "val",
		},
	},
	{
		name: "setPartProp empty key",
		command: { type: "setPartProp", partId: "part_u1", key: "", value: "val" },
	},
	{
		name: "connect pin to itself",
		command: {
			type: "connect",
			partIdA: "part_u1",
			pinA: "1",
			partIdB: "part_u1",
			pinB: "1",
		},
	},
	{
		name: "disconnect unconnected pin",
		command: { type: "disconnect", partId: "part_r2", pin: "99" },
	},
	{
		name: "renameNet missing net",
		command: { type: "renameNet", netId: "missing_net", name: "NEW" },
	},
	{
		name: "select non-array ids",
		command: { type: "select", ids: "not-an-array" },
	},
	{
		name: "batch non-array commands",
		command: { type: "batch", commands: "not-an-array" },
	},
];

describe("invalid commands", () => {
	for (const { name, command } of INVALID_CASES) {
		test(`invalid command returns error and no change: ${name}`, () => {
			const baseIr = buildBaseIr();
			const editor = createEditor(baseIr, { idFn: mockIdFn });
			editor.dispatch(command);
			assert.equal(typeof editor.state.error, "string");
			assert.deepEqual(editor.state.ir, baseIr);
			assert.equal(editor.canUndo, false);
		});
	}
});

describe("history cap", () => {
	test("caps past history at 200", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
		for (let i = 0; i < 210; i++) {
			editor.dispatch({
				type: "movePart",
				partId: "part_u1",
				x: i,
				y: i,
			});
		}
		assert.equal(editor.state.history.past.length, 200);
		for (let i = 0; i < 200; i++) {
			assert.equal(editor.canUndo, true);
			editor.undo();
		}
		assert.equal(editor.canUndo, false);
	});
});

describe("selection and missing id handling", () => {
	test("select command updates selection without undo entry", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
		editor.dispatch({ type: "select", ids: ["part_u1", "net_vcc"] });
		assert.deepEqual(editor.selection, ["part_u1", "net_vcc"]);
		assert.equal(editor.canUndo, false);
		assert.deepEqual(editor.state.ir, baseIr);
	});

	test("addPart assigns id using idFn when id is missing", () => {
		const baseIr = buildBaseIr();
		const editor = createEditor(baseIr, { idFn: mockIdFn });
		editor.dispatch({
			type: "addPart",
			part: {
				ref: "C10",
				value: "10uF",
				symbol: "Device:C",
				footprint: "Capacitor_SMD:C_0805",
			},
		});
		const addedPart = editor.state.ir.parts[3];
		assert.equal(typeof addedPart.id, "string");
		assert.equal(addedPart.id.startsWith("part_mock_"), true);

		editor.undo();
		assert.deepEqual(editor.state.ir, baseIr);

		editor.redo();
		assert.equal(editor.state.ir.parts[3].id, addedPart.id);
	});
});
