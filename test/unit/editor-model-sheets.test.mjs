import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCircuitIR } from "../../backend/src/engine/circuit-ir.js";
import {
	applyCommand,
	createEditor,
	invertCommand,
} from "../../frontend/src/editor/editorModel.js";

const DEFAULT_PART_ID = "part_00000000-0000-0000-0000-000000000001";

function createSheetFixture(overrides = {}) {
	return {
		id: "sheet-1",
		name: "Sheet1",
		file: "Sheet1.kicad_sch",
		x: 10,
		y: 20,
		w: 40,
		h: 30,
		pins: [
			{
				id: "pin-1",
				name: "CLK",
				type: "input",
				side: "left",
				offset: 5,
			},
		],
		...overrides,
	};
}

function buildCircuitFixture(sheetsOption = [createSheetFixture()]) {
	const ir = {
		schemaVersion: 1,
		name: "test-sheets-circuit",
		parts: [
			{
				id: DEFAULT_PART_ID,
				ref: "U1",
				value: "NE555",
				symbol: "Timer:NE555",
				footprint: "Package_DIP:DIP-8_W7.62mm",
				props: {},
			},
		],
		nets: [],
		constraints: [],
	};
	if (Array.isArray(sheetsOption)) {
		ir.sheets = sheetsOption;
	} else if (sheetsOption === true) {
		ir.sheets = [createSheetFixture()];
	}
	return ir;
}

function makeEditorDoc(circuit = buildCircuitFixture()) {
	return {
		ir: circuit,
		selection: [],
		history: { past: [], future: [] },
	};
}

function executeAndFindSheet(cmd, doc = makeEditorDoc(), sheetId = "sheet-1") {
	const res = applyCommand(doc, cmd);
	return { res, sheet: res.ir.sheets.find((s) => s.id === sheetId) };
}

function assertSuccess(result, actualFields, expectedFields) {
	assert.deepEqual(
		{ error: result.error, ...actualFields },
		{ error: undefined, ...expectedFields },
	);
}

function checkUndoRedoCycle(editor, referenceIr) {
	const baselineJson = JSON.stringify(referenceIr);
	const matchesBase = () => JSON.stringify(editor.state.ir) === baselineJson;
	const states = [matchesBase()];
	for (const action of ["undo", "redo", "undo"]) {
		editor[action]();
		states.push(matchesBase());
	}
	assert.deepEqual(states, [false, true, false, true]);
}

function checkCommandInversion(circuit, command) {
	const startDoc = makeEditorDoc(circuit);
	const rev = invertCommand(startDoc, command);
	assert.ok(rev, "inverse must exist");
	const nextDoc = applyCommand(startDoc, command);
	const resetDoc = applyCommand(nextDoc, rev);
	assert.deepEqual(
		{ appliedErr: nextDoc.error, restoredErr: resetDoc.error, ir: resetDoc.ir },
		{ appliedErr: undefined, restoredErr: undefined, ir: circuit },
	);
}

const ROUND_TRIP_STEPS = [
	{
		title: "addSheet with explicit sheet",
		cmd: {
			type: "addSheet",
			sheet: {
				id: "sheet-2",
				name: "Power",
				file: "Power.kicad_sch",
				x: 50,
				y: 60,
				w: 70,
				h: 80,
				pins: [],
			},
		},
	},
	{
		title: "deleteSheet existing sheet",
		cmd: { type: "deleteSheet", sheetId: "sheet-1" },
	},
	{
		title: "moveSheet coordinates",
		cmd: { type: "moveSheet", sheetId: "sheet-1", dx: 15, dy: -5 },
	},
	{
		title: "resizeSheet dimensions",
		cmd: { type: "resizeSheet", sheetId: "sheet-1", w: 60, h: 50 },
	},
	{
		title: "renameSheet following filename",
		cmd: { type: "renameSheet", sheetId: "sheet-1", name: "AudioLogic" },
	},
	{
		title: "addSheetPin to sheet",
		cmd: {
			type: "addSheetPin",
			sheetId: "sheet-1",
			pin: {
				id: "pin-2",
				name: "DATA",
				type: "output",
				side: "right",
				offset: 10,
			},
		},
	},
	{
		title: "deleteSheetPin from sheet",
		cmd: { type: "deleteSheetPin", sheetId: "sheet-1", pinId: "pin-1" },
	},
];

describe("round-trip editor undo and redo for sheets", () => {
	for (const { title, cmd } of ROUND_TRIP_STEPS) {
		test(`editor undo/redo round-trip: ${title}`, () => {
			const circuit = buildCircuitFixture();
			const ed = createEditor(circuit);
			ed.dispatch(cmd);
			assert.equal(ed.state.error, undefined);
			checkUndoRedoCycle(ed, circuit);
		});

		test(`pure applyCommand / invertCommand round-trip: ${title}`, () => {
			checkCommandInversion(buildCircuitFixture(), cmd);
		});
	}
});

describe("addSheet auto naming and id generation", () => {
	test("assigns sequential Sheet1 and sheet-1 when empty", () => {
		const doc = makeEditorDoc(buildCircuitFixture(false));
		const res1 = applyCommand(doc, { type: "addSheet", sheet: {} });
		const res2 = applyCommand(res1, { type: "addSheet", sheet: {} });
		const [s1, s2] = [res1.ir.sheets[0], res2.ir.sheets[1]];
		assert.deepEqual(
			{
				err1: res1.error,
				id1: s1.id,
				name1: s1.name,
				file1: s1.file,
				err2: res2.error,
				id2: s2.id,
				name2: s2.name,
				file2: s2.file,
			},
			{
				err1: undefined,
				id1: "sheet-1",
				name1: "Sheet1",
				file1: "Sheet1.kicad_sch",
				err2: undefined,
				id2: "sheet-2",
				name2: "Sheet2",
				file2: "Sheet2.kicad_sch",
			},
		);
	});

	test("auto name finds next unused sheet name and sanitizes filename", () => {
		const seededCircuit = buildCircuitFixture([
			{ id: "sheet-1", name: "Sheet2", file: "Sheet2.kicad_sch" },
			{ id: "sheet-2", name: "Sheet3", file: "Sheet3.kicad_sch" },
		]);
		const res = applyCommand(makeEditorDoc(seededCircuit), {
			type: "addSheet",
			sheet: {},
		});
		const resSan = applyCommand(makeEditorDoc(buildCircuitFixture(false)), {
			type: "addSheet",
			sheet: { name: "Power/Sub?Sheet*1" },
		});
		assert.deepEqual(
			{
				err1: res.error,
				name1: res.ir.sheets[2].name,
				file1: res.ir.sheets[2].file,
				errSan: resSan.error,
				nameSan: resSan.ir.sheets[0].name,
				fileSan: resSan.ir.sheets[0].file,
			},
			{
				err1: undefined,
				name1: "Sheet1",
				file1: "Sheet1.kicad_sch",
				errSan: undefined,
				nameSan: "Power/Sub?Sheet*1",
				fileSan: "PowerSubSheet1.kicad_sch",
			},
		);
	});
});

describe("resizeSheet min size clamp", () => {
	const resizeCases = [
		{ w: 4, h: 3, expectedW: 10, expectedH: 10 },
		{ w: 35, h: 45, expectedW: 35, expectedH: 45 },
	];
	for (const { w, h, expectedW, expectedH } of resizeCases) {
		test(`clamps or accepts size w=${w}, h=${h}`, () => {
			const { res, sheet } = executeAndFindSheet({
				type: "resizeSheet",
				sheetId: "sheet-1",
				w,
				h,
			});
			assertSuccess(
				res,
				{ w: sheet.w, h: sheet.h },
				{ w: expectedW, h: expectedH },
			);
		});
	}
});

describe("renameSheet file following behavior", () => {
	const renameCases = [
		{
			title: "file follows name when file was not set explicitly",
			circuit: buildCircuitFixture(true),
			sheetId: "sheet-1",
			name: "MotorControl",
			expectedFile: "MotorControl.kicad_sch",
		},
		{
			title: "file stays unchanged when file was set explicitly",
			circuit: buildCircuitFixture([
				{
					id: "sheet-custom",
					name: "Sensors",
					file: "custom_sensors.kicad_sch",
					explicitFile: true,
				},
			]),
			sheetId: "sheet-custom",
			name: "AnalogSensors",
			expectedFile: "custom_sensors.kicad_sch",
		},
	];
	for (const tc of renameCases) {
		test(tc.title, () => {
			const { res, sheet } = executeAndFindSheet(
				{ type: "renameSheet", sheetId: tc.sheetId, name: tc.name },
				makeEditorDoc(tc.circuit),
				tc.sheetId,
			);
			assertSuccess(
				res,
				{ name: sheet.name, file: sheet.file },
				{ name: tc.name, file: tc.expectedFile },
			);
		});
	}
});

describe("addSheetPin behavior", () => {
	const pinCases = [
		{
			title: "defaults name from hierarchical label if given",
			pinInput: { hierLabel: "SPI_MOSI", type: "output" },
			expectedName: "SPI_MOSI",
			expectedType: "output",
		},
		{
			title: "auto names pin when hierarchical label not given",
			pinInput: {},
			expectedName: "Pin1",
			expectedType: "input",
		},
	];
	for (const tc of pinCases) {
		test(tc.title, () => {
			const { res, sheet } = executeAndFindSheet({
				type: "addSheetPin",
				sheetId: "sheet-1",
				pin: tc.pinInput,
			});
			const pin = sheet.pins.find((p) => p.name === tc.expectedName);
			assertSuccess(
				res,
				{ name: pin?.name, type: pin?.type },
				{ name: tc.expectedName, type: tc.expectedType },
			);
		});
	}
});

describe("CIRCUIT_IR_SCHEMA sheets validation", () => {
	test("schema accepts a doc with sheets and rejects a sheet without id", () => {
		const validRes = validateCircuitIR(buildCircuitFixture(true));
		const invalidRes = validateCircuitIR(
			buildCircuitFixture([
				{
					name: "NoIdSheet",
					file: "NoIdSheet.kicad_sch",
					x: 0,
					y: 0,
					w: 20,
					h: 20,
				},
			]),
		);
		assert.deepEqual(
			{
				validOk: validRes.ok,
				invalidOk: invalidRes.ok,
				hasIdError: invalidRes.errors.some((e) => e.includes("id")),
			},
			{ validOk: true, invalidOk: false, hasIdError: true },
		);
	});
});

describe("setPartField allows datasheet", () => {
	test("sets datasheet on part and inverts cleanly", () => {
		const doc = makeEditorDoc();
		const cmd = {
			type: "setPartField",
			partId: DEFAULT_PART_ID,
			field: "datasheet",
			value: "https://example.com/ne555.pdf",
		};
		const applied = applyCommand(doc, cmd);
		const part = applied.ir.parts.find((p) => p.id === DEFAULT_PART_ID);
		const restored = applyCommand(applied, invertCommand(doc, cmd));
		assert.deepEqual(
			{
				setErr: applied.error,
				datasheet: part.datasheet,
				restoredErr: restored.error,
				ir: restored.ir,
			},
			{
				setErr: undefined,
				datasheet: "https://example.com/ne555.pdf",
				restoredErr: undefined,
				ir: doc.ir,
			},
		);
	});
});
