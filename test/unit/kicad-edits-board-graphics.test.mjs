import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const emptyIr = { parts: [], nets: [] };
const board = (graphics = []) => ({ graphics });

const makeGraphic = (id, kind, layer, props = {}) => ({
	id,
	kind,
	layer,
	x: 0,
	y: 0,
	width: 0.15,
	...props,
});

const [
	lineGraphic,
	rectGraphic,
	circleGraphic,
	arcGraphic,
	textGraphic,
	dimensionGraphic,
] = [
	["g1", "line", "F.SilkS", { x2: 10, y2: 0 }],
	["g2", "rect", "Edge.Cuts", { uuid: "u-rect-1", x2: 20, y2: 15, width: 0.1 }],
	["g3", "circle", "B.SilkS", { x: 10, y: 10, x2: 15, y2: 10 }],
	["g4", "arc", "Dwgs.User", { xm: 5, ym: 2, x2: 10, y2: 0 }],
	["g5", "text", "F.SilkS", { x: 5, y: 5, text: "Banana v2" }],
	["g6", "dimension", "F.Cu", { x2: 25, y2: 0 }],
].map(([id, kind, layer, props]) => makeGraphic(id, kind, layer, props));

const segTrack = {
	layer: "F.Cu",
	start: [0, 0],
	end: [5, 0],
	widthMm: 0.3,
};

const boardDiff = (beforeGraphics = [], afterGraphics = []) => ({
	before: board(beforeGraphics),
	after: board(afterGraphics),
});

const addOp = (graphic) => ({ op: "addGraphic", graphic });
const delOp = (uuid) => ({ op: "deleteGraphic", uuid });

const multiGraphics = [
	circleGraphic,
	arcGraphic,
	textGraphic,
	dimensionGraphic,
];

const TEST_CASES = [
	[
		"added graphic produces addGraphic op in pcb edits",
		boardDiff([], [lineGraphic]),
		[addOp(lineGraphic)],
	],
	[
		"deleted graphic with uuid produces deleteGraphic op in pcb edits",
		boardDiff([rectGraphic], []),
		[delOp("u-rect-1")],
	],
	[
		"deleted graphic without uuid produces no deleteGraphic op",
		boardDiff([lineGraphic], []),
		[],
	],
	[
		"unchanged graphic produces no extra edits",
		boardDiff([rectGraphic], [rectGraphic]),
		[],
	],
	[
		"modified graphic with uuid produces deleteGraphic then addGraphic",
		boardDiff([rectGraphic], [{ ...rectGraphic, x2: 30 }]),
		[delOp("u-rect-1"), addOp({ ...rectGraphic, x2: 30 })],
	],
	["empty boards produce no extra edits", boardDiff([], []), []],
	["undefined boards produce no extra edits", undefined, []],
	[
		"added circle, arc, text, and dimension produce addGraphic ops",
		boardDiff([], multiGraphics),
		multiGraphics.map(addOp),
	],
	[
		"combines track edits and graphic edits in pcb edits",
		{
			before: { tracks: [], graphics: [] },
			after: { tracks: [segTrack], graphics: [lineGraphic] },
		},
		[
			{
				op: "addTrack",
				layer: "F.Cu",
				width: 0.3,
				points: [
					{ x: 0, y: 0 },
					{ x: 5, y: 0 },
				],
				net: 0,
			},
			addOp(lineGraphic),
		],
	],
].map(([name, boards, expectedPcb]) => ({
	name,
	boards,
	expectedPcb,
	expectedCanSave: expectedPcb.length > 0,
}));

function runBoardGraphicsCase(tc) {
	test(tc.name, () => {
		const res = editsFromIrChange(emptyIr, emptyIr, tc.boards);
		assert.deepEqual(res.sch, []);
		assert.deepEqual(res.pcb, tc.expectedPcb);
		assert.equal(res.canSaveInPlace, tc.expectedCanSave);
		assert.deepEqual(res.unsupported, []);
	});
}

describe("kicadEdits - board graphics", () => {
	for (const tc of TEST_CASES) {
		runBoardGraphicsCase(tc);
	}
});
