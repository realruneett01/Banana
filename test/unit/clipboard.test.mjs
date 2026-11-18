import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	copyBoard,
	copySchematic,
	cutSchematicCommands,
	duplicateBoard,
	duplicateSchematicCommands,
	pasteBoard,
	pasteSchematicCommands,
	selectAllIds,
} from "../../frontend/src/editor/clipboard.js";
import { applyCommand } from "../../frontend/src/editor/editorModel.js";

function makeDocParts() {
	return [
		{
			id: "p_u1",
			ref: "U1",
			value: "NE555",
			placement: { x: 100, y: 100, rot: 0, side: "F" },
		},
		{
			id: "p_r1",
			ref: "R1",
			value: "10k",
			placement: { x: 150, y: 100, rot: 0, side: "F" },
		},
		{
			id: "p_r2",
			ref: "R2",
			value: "1k",
			placement: { x: 200, y: 120, rot: 0, side: "F" },
		},
	];
}

function makeDocNets() {
	return [
		{
			id: "net_vcc",
			name: "VCC",
			pins: [
				{ partId: "p_u1", pin: "8" },
				{ partId: "p_r1", pin: "1" },
				{ partId: "p_r2", pin: "1" },
			],
		},
		{
			id: "net_out",
			name: "OUT",
			pins: [
				{ partId: "p_u1", pin: "3" },
				{ partId: "p_r2", pin: "2" },
			],
		},
	];
}

function makeDocSheets() {
	return [
		{
			id: "sheet_1",
			name: "Sheet1",
			file: "Sheet1.kicad_sch",
			x: 10,
			y: 20,
			w: 40,
			h: 30,
			pins: [{ id: "pin_1", name: "CLK" }],
		},
	];
}

function makeDoc() {
	return {
		ir: {
			schemaVersion: 1,
			name: "test-circuit",
			parts: makeDocParts(),
			nets: makeDocNets(),
			annotations: [
				{ id: "ann_1", kind: "line", x: 100, y: 50, x2: 120, y2: 50 },
			],
			sheets: makeDocSheets(),
		},
		selection: [],
		history: { past: [], future: [] },
	};
}

function makeBoardTracks() {
	return [
		{
			id: "t1",
			uuid: "u-t1",
			netId: "GND",
			layer: "F.Cu",
			start: [10, 10],
			end: [20, 10],
			widthMm: 0.25,
		},
		{
			id: "t2",
			uuid: "u-t2",
			netId: "UNKNOWN_NET",
			layer: "B.Cu",
			start: [20, 10],
			end: [20, 20],
			widthMm: 0.25,
		},
	];
}

function makeBoard() {
	return {
		nets: ["GND", "VCC"],
		tracks: makeBoardTracks(),
		vias: [{ id: "v1", uuid: "u-v1", netId: "VCC", at: [20, 10] }],
		graphics: [
			{
				id: "gfx-1",
				uuid: "u-g1",
				kind: "line",
				layer: "F.SilkS",
				x: 5,
				y: 5,
				x2: 15,
				y2: 5,
			},
		],
		footprints: [
			{
				id: "fp1",
				uuid: "u-fp1",
				reference: { text: "R1" },
				at: [30, 30],
			},
		],
	};
}

describe("selectAllIds", () => {
	test("returns all selectable schematic IDs", () => {
		const doc = makeDoc();
		const ids = selectAllIds(doc);
		assert.deepEqual(ids, ["p_u1", "p_r1", "p_r2", "ann_1", "sheet_1"]);
	});

	test("handles empty or null doc safely", () => {
		assert.deepEqual(selectAllIds(null), []);
		assert.deepEqual(selectAllIds({}), []);
	});
});

describe("copySchematic", () => {
	test("deep copies selected parts, annotations, sheets and computes origin", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_u1", "p_r1", "ann_1"]);
		assert.equal(clip.kind, "schematic");
		assert.equal(clip.parts.length, 2);
		assert.equal(clip.annotations.length, 1);
		assert.equal(clip.sheets.length, 0);
		// Origin is min(x) and min(y): p_u1 is (100, 100), ann_1 is (100, 50)
		assert.deepEqual(clip.origin, { x: 100, y: 50 });
	});

	test("keeps wires between copied parts and drops connections to non-copied parts", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_u1", "p_r1"]);
		assert.equal(clip.parts.length, 2);
		assert.ok(clip.connections.length > 0);
		for (const conn of clip.connections) {
			assert.notEqual(conn.partIdA, "p_r2");
			assert.notEqual(conn.partIdB, "p_r2");
		}
	});

	test("does not mutate original doc", () => {
		const doc = makeDoc();
		const snapshot = JSON.stringify(doc);
		copySchematic(doc, ["p_u1"]);
		assert.equal(JSON.stringify(doc), snapshot);
	});
});

describe("pasteSchematicCommands", () => {
	test("returns one batch command translating geometry to target point", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_u1", "p_r1"]);
		const batch = pasteSchematicCommands(doc, clip, { x: 300, y: 250 });
		assert.equal(batch.type, "batch");
		assert.ok(Array.isArray(batch.commands));

		const nextDoc = applyCommand(doc, batch);
		assert.equal(nextDoc.error, undefined);
		assert.equal(nextDoc.ir.parts.length, 5);

		const pastedU = nextDoc.ir.parts[3];
		const pastedR = nextDoc.ir.parts[4];
		assert.equal(pastedU.placement.x, 300);
		assert.equal(pastedU.placement.y, 250);
		assert.equal(pastedR.placement.x, 350);
		assert.equal(pastedR.placement.y, 250);
		assert.equal(pastedR.placement.x - pastedU.placement.x, 50);
	});

	test("renumbers references to next free number per prefix", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_r1"]);
		const batch = pasteSchematicCommands(doc, clip, { x: 250, y: 250 });
		const nextDoc = applyCommand(doc, batch);
		const pasted = nextDoc.ir.parts[nextDoc.ir.parts.length - 1];
		assert.equal(pasted.ref, "R3");
		assert.notEqual(pasted.id, "p_r1");
	});

	test("handles R? style references like annotate.js", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_r1"]);
		clip.parts[0].ref = "R?";
		const batch = pasteSchematicCommands(doc, clip, { x: 250, y: 250 });
		const nextDoc = applyCommand(doc, batch);
		const pasted = nextDoc.ir.parts[nextDoc.ir.parts.length - 1];
		assert.equal(pasted.ref, "R3");
	});

	test("makes sheet names and files unique", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["sheet_1"]);
		const batch = pasteSchematicCommands(doc, clip, { x: 50, y: 50 });
		const nextDoc = applyCommand(doc, batch);
		assert.equal(nextDoc.ir.sheets.length, 2);
		const pastedSheet = nextDoc.ir.sheets[1];
		assert.notEqual(pastedSheet.name, "Sheet1");
		assert.notEqual(pastedSheet.file, "Sheet1.kicad_sch");
		assert.notEqual(pastedSheet.id, "sheet_1");
	});
});

describe("duplicateSchematicCommands", () => {
	test("duplicates selection with offset", () => {
		const doc = makeDoc();
		const batch = duplicateSchematicCommands(doc, ["p_u1"], {
			x: 2.54,
			y: 2.54,
		});
		const nextDoc = applyCommand(doc, batch);
		assert.equal(nextDoc.ir.parts.length, 4);
		const dup = nextDoc.ir.parts[3];
		assert.equal(dup.placement.x, 102.54);
		assert.equal(dup.placement.y, 102.54);
	});
});

describe("cutSchematicCommands", () => {
	test("returns clip and batch command that deletes selection", () => {
		const doc = makeDoc();
		const { clip, command } = cutSchematicCommands(doc, ["p_r1", "ann_1"]);
		assert.equal(clip.parts.length, 1);
		assert.equal(clip.parts[0].id, "p_r1");
		assert.equal(clip.annotations.length, 1);

		const nextDoc = applyCommand(doc, command);
		assert.equal(
			nextDoc.ir.parts.some((p) => p.id === "p_r1"),
			false,
		);
		assert.equal(
			nextDoc.ir.annotations.some((a) => a.id === "ann_1"),
			false,
		);
		assert.equal(nextDoc.ir.parts.length, 2);
	});
});

describe("copyBoard / pasteBoard / duplicateBoard", () => {
	test("copyBoard creates pure clip with origin", () => {
		const board = makeBoard();
		const clip = copyBoard(board, ["t1", "v1", "gfx-1"]);
		assert.equal(clip.kind, "board");
		assert.equal(clip.tracks.length, 1);
		assert.equal(clip.vias.length, 1);
		assert.equal(clip.graphics.length, 1);
		assert.deepEqual(clip.origin, { x: 5, y: 5 });
	});

	test("pasteBoard translates geometry and generates new IDs", () => {
		const board = makeBoard();
		const clip = copyBoard(board, ["t1", "t2", "v1", "gfx-1"]);
		const nextBoard = pasteBoard(board, clip, { x: 50, y: 50 });

		assert.equal(board.tracks.length, 2);
		assert.equal(nextBoard.tracks.length, 4);
		assert.equal(nextBoard.vias.length, 2);
		assert.equal(nextBoard.graphics.length, 2);

		const pastedT1 = nextBoard.tracks[2];
		const pastedV1 = nextBoard.vias[1];
		const pastedGfx = nextBoard.graphics[1];

		assert.deepEqual(pastedT1.start, [55, 55]);
		assert.deepEqual(pastedT1.end, [65, 55]);
		assert.notEqual(pastedT1.uuid, "u-t1");
		assert.notEqual(pastedV1.uuid, "u-v1");
		assert.notEqual(pastedGfx.id, "gfx-1");
	});

	test("pasteBoard keeps known nets and clears unknown nets", () => {
		const board = makeBoard();
		const clip = copyBoard(board, ["t1", "t2", "v1"]);
		const nextBoard = pasteBoard(board, clip, { x: 50, y: 50 });

		const pastedT1 = nextBoard.tracks[2];
		const pastedT2 = nextBoard.tracks[3];
		const pastedV1 = nextBoard.vias[1];

		assert.equal(pastedT1.netId, "GND");
		assert.equal(pastedT2.netId, "");
		assert.equal(pastedV1.netId, "VCC");
	});

	test("duplicateBoard shifts by offset", () => {
		const board = makeBoard();
		const nextBoard = duplicateBoard(board, ["v1"], { x: 2, y: 3 });
		assert.equal(nextBoard.vias.length, 2);
		const dupVia = nextBoard.vias[1];
		assert.deepEqual(dupVia.at, [22, 13]);
	});

	test("inputs never mutated by board operations", () => {
		const board = makeBoard();
		const snapshot = JSON.stringify(board);
		const clip = copyBoard(board, ["t1"]);
		pasteBoard(board, clip, { x: 100, y: 100 });
		duplicateBoard(board, ["t1"]);
		assert.equal(JSON.stringify(board), snapshot);
	});
});
