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

const makePart = (id, ref, value, [x, y]) => ({
	id,
	ref,
	value,
	placement: { x, y, rot: 0, side: "F" },
});

const makeNet = (id, name, pinPairs) => ({
	id,
	name,
	pins: pinPairs.map(([partId, pin]) => ({ partId, pin })),
});

const makeSheet = (id, name, [x, y, w, h], pinList) => ({
	id,
	name,
	file: `${name}.kicad_sch`,
	x,
	y,
	w,
	h,
	pins: pinList.map(([pId, pName]) => ({ id: pId, name: pName })),
});

function makeDoc() {
	const parts = [
		makePart("p_u1", "U1", "NE555", [100, 100]),
		makePart("p_r1", "R1", "10k", [150, 100]),
		makePart("p_r2", "R2", "1k", [200, 120]),
	];
	const nets = [
		makeNet("net_vcc", "VCC", [
			["p_u1", "8"],
			["p_r1", "1"],
			["p_r2", "1"],
		]),
		makeNet("net_out", "OUT", [
			["p_u1", "3"],
			["p_r2", "2"],
		]),
	];
	return {
		ir: {
			schemaVersion: 1,
			name: "test-circuit",
			parts,
			nets,
			annotations: [
				{ id: "ann_1", kind: "line", x: 100, y: 50, x2: 120, y2: 50 },
			],
			sheets: [
				makeSheet("sheet_1", "Sheet1", [10, 20, 40, 30], [["pin_1", "CLK"]]),
			],
		},
		selection: [],
		history: { past: [], future: [] },
	};
}

const makeTrack = (id, netId, layer, [start, end]) => ({
	id,
	uuid: `u-${id}`,
	netId,
	layer,
	start,
	end,
	widthMm: 0.25,
});

function makeBoard() {
	return {
		nets: ["GND", "VCC"],
		tracks: [
			makeTrack("t1", "GND", "F.Cu", [
				[10, 10],
				[20, 10],
			]),
			makeTrack("t2", "UNKNOWN_NET", "B.Cu", [
				[20, 10],
				[20, 20],
			]),
		],
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

function applyPastedSchematic(doc, ids, target, mutator = null) {
	const clip = copySchematic(doc, ids);
	if (mutator) {
		mutator(clip);
	}
	const batch = pasteSchematicCommands(doc, clip, target);
	return { clip, batch, nextDoc: applyCommand(doc, batch) };
}

function pasteBoardFromSelection(board, ids, target = { x: 50, y: 50 }) {
	const clip = copyBoard(board, ids);
	return { clip, nextBoard: pasteBoard(board, clip, target) };
}

function assertPreservesInput(input, action) {
	const snapshot = JSON.stringify(input);
	action();
	assert.equal(JSON.stringify(input), snapshot);
}

describe("selectAllIds", () => {
	test("returns all selectable schematic IDs", () => {
		const doc = makeDoc();
		assert.deepEqual(selectAllIds(doc), [
			"p_u1",
			"p_r1",
			"p_r2",
			"ann_1",
			"sheet_1",
		]);
	});

	test("handles empty or null doc safely", () => {
		for (const input of [null, {}]) {
			assert.deepEqual(selectAllIds(input), []);
		}
	});
});

describe("copySchematic", () => {
	test("deep copies selected parts, annotations, sheets and computes origin", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_u1", "p_r1", "ann_1"]);
		assert.equal(clip.kind, "schematic");
		assert.deepEqual(clip.origin, { x: 100, y: 50 });
		assert.equal(clip.parts.length, 2);
		assert.equal(clip.annotations.length, 1);
		assert.equal(clip.sheets.length, 0);
	});

	test("keeps wires between copied parts and drops connections to non-copied parts", () => {
		const doc = makeDoc();
		const clip = copySchematic(doc, ["p_u1", "p_r1"]);
		assert.equal(clip.parts.length, 2);
		assert.ok(clip.connections.length > 0);
		for (const conn of clip.connections) {
			assert.ok(![conn.partIdA, conn.partIdB].includes("p_r2"));
		}
	});

	test("does not mutate original doc", () => {
		const doc = makeDoc();
		assertPreservesInput(doc, () => copySchematic(doc, ["p_u1"]));
	});
});

describe("pasteSchematicCommands", () => {
	test("returns one batch command translating geometry to target point", () => {
		const doc = makeDoc();
		const { batch, nextDoc } = applyPastedSchematic(doc, ["p_u1", "p_r1"], {
			x: 300,
			y: 250,
		});
		assert.deepEqual(
			[
				batch.type,
				Array.isArray(batch.commands),
				nextDoc.error,
				nextDoc.ir.parts.length,
			],
			["batch", true, undefined, 5],
		);

		const [pastedU, pastedR] = nextDoc.ir.parts.slice(3, 5);
		assert.deepEqual(
			[
				pastedU.placement.x,
				pastedU.placement.y,
				pastedR.placement.x,
				pastedR.placement.y,
				pastedR.placement.x - pastedU.placement.x,
			],
			[300, 250, 350, 250, 50],
		);
	});

	for (const { name, mutator, verify } of [
		{
			name: "renumbers references to next free number per prefix",
			mutator: null,
			verify: (p) => assert.deepEqual([p.ref, p.id !== "p_r1"], ["R3", true]),
		},
		{
			name: "handles R? style references like annotate.js",
			mutator: (clip) => {
				clip.parts[0].ref = "R?";
			},
			verify: (p) => assert.equal(p.ref, "R3"),
		},
	]) {
		test(name, () => {
			const doc = makeDoc();
			const { nextDoc } = applyPastedSchematic(
				doc,
				["p_r1"],
				{ x: 250, y: 250 },
				mutator,
			);
			verify(nextDoc.ir.parts.at(-1));
		});
	}

	test("makes sheet names and files unique", () => {
		const doc = makeDoc();
		const { nextDoc } = applyPastedSchematic(doc, ["sheet_1"], {
			x: 50,
			y: 50,
		});
		assert.equal(nextDoc.ir.sheets.length, 2);
		const pastedSheet = nextDoc.ir.sheets[1];
		assert.deepEqual(
			[
				pastedSheet.name === "Sheet1",
				pastedSheet.file === "Sheet1.kicad_sch",
				pastedSheet.id === "sheet_1",
			],
			[false, false, false],
		);
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
		assert.deepEqual(
			{ x: dup.placement.x, y: dup.placement.y },
			{ x: 102.54, y: 102.54 },
		);
	});
});

describe("cutSchematicCommands", () => {
	test("returns clip and batch command that deletes selection", () => {
		const doc = makeDoc();
		const { clip, command } = cutSchematicCommands(doc, ["p_r1", "ann_1"]);
		assert.deepEqual(
			[clip.parts.length, clip.parts[0]?.id, clip.annotations.length],
			[1, "p_r1", 1],
		);

		const nextDoc = applyCommand(doc, command);
		const remainingParts = nextDoc.ir.parts.map((p) => p.id);
		const remainingAnnotations = nextDoc.ir.annotations.map((a) => a.id);
		assert.deepEqual(
			[
				remainingParts.includes("p_r1"),
				remainingAnnotations.includes("ann_1"),
				nextDoc.ir.parts.length,
			],
			[false, false, 2],
		);
	});
});

describe("copyBoard / pasteBoard / duplicateBoard", () => {
	test("copyBoard creates pure clip with origin", () => {
		const board = makeBoard();
		const clip = copyBoard(board, ["t1", "v1", "gfx-1"]);
		assert.deepEqual(
			[
				clip.kind,
				clip.tracks.length,
				clip.vias.length,
				clip.graphics.length,
				clip.origin,
			],
			["board", 1, 1, 1, { x: 5, y: 5 }],
		);
	});

	test("pasteBoard translates geometry and generates new IDs", () => {
		const board = makeBoard();
		const { nextBoard } = pasteBoardFromSelection(board, [
			"t1",
			"t2",
			"v1",
			"gfx-1",
		]);

		assert.deepEqual(
			[
				board.tracks.length,
				nextBoard.tracks.length,
				nextBoard.vias.length,
				nextBoard.graphics.length,
			],
			[2, 4, 2, 2],
		);

		const pastedT1 = nextBoard.tracks[2];
		const pastedV1 = nextBoard.vias[1];
		const pastedGfx = nextBoard.graphics[1];

		assert.deepEqual(
			{ start: pastedT1.start, end: pastedT1.end },
			{ start: [55, 55], end: [65, 55] },
		);
		assert.deepEqual(
			[
				pastedT1.uuid === "u-t1",
				pastedV1.uuid === "u-v1",
				pastedGfx.id === "gfx-1",
			],
			[false, false, false],
		);
	});

	test("pasteBoard keeps known nets and clears unknown nets", () => {
		const board = makeBoard();
		const { nextBoard } = pasteBoardFromSelection(board, ["t1", "t2", "v1"]);
		const [trackA, trackB] = nextBoard.tracks.slice(2, 4);
		assert.deepEqual(
			[trackA.netId, trackB.netId, nextBoard.vias[1].netId],
			["GND", "", "VCC"],
		);
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
		assertPreservesInput(board, () => {
			const clip = copyBoard(board, ["t1"]);
			pasteBoard(board, clip, { x: 100, y: 100 });
			duplicateBoard(board, ["t1"]);
		});
	});
});
