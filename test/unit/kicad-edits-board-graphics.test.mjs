import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editsFromIrChange } from "../../frontend/src/editor/kicadEdits.js";

const emptyIr = { parts: [], nets: [] };
const board = (graphics = []) => ({ graphics });

const lineGraphic = {
	id: "g1",
	kind: "line",
	layer: "F.SilkS",
	x: 0,
	y: 0,
	x2: 10,
	y2: 0,
	width: 0.15,
};

const rectGraphic = {
	id: "g2",
	uuid: "u-rect-1",
	kind: "rect",
	layer: "Edge.Cuts",
	x: 0,
	y: 0,
	x2: 20,
	y2: 15,
	width: 0.1,
};

const circleGraphic = {
	id: "g3",
	kind: "circle",
	layer: "B.SilkS",
	x: 10,
	y: 10,
	x2: 15,
	y2: 10,
	width: 0.15,
};

const arcGraphic = {
	id: "g4",
	kind: "arc",
	layer: "Dwgs.User",
	x: 0,
	y: 0,
	xm: 5,
	ym: 2,
	x2: 10,
	y2: 0,
	width: 0.15,
};

const textGraphic = {
	id: "g5",
	kind: "text",
	layer: "F.SilkS",
	x: 5,
	y: 5,
	text: "Banana v2",
	width: 0.15,
};

const dimensionGraphic = {
	id: "g6",
	kind: "dimension",
	layer: "F.Cu",
	x: 0,
	y: 0,
	x2: 25,
	y2: 0,
	width: 0.15,
};

const segTrack = {
	layer: "F.Cu",
	start: [0, 0],
	end: [5, 0],
	widthMm: 0.3,
};

const TEST_CASES = [
	{
		name: "added graphic produces addGraphic op in pcb edits",
		boards: { before: board([]), after: board([lineGraphic]) },
		expectedPcb: [{ op: "addGraphic", graphic: lineGraphic }],
		expectedCanSave: true,
	},
	{
		name: "deleted graphic with uuid produces deleteGraphic op in pcb edits",
		boards: { before: board([rectGraphic]), after: board([]) },
		expectedPcb: [{ op: "deleteGraphic", uuid: "u-rect-1" }],
		expectedCanSave: true,
	},
	{
		name: "deleted graphic without uuid produces no deleteGraphic op",
		boards: { before: board([lineGraphic]), after: board([]) },
		expectedPcb: [],
		expectedCanSave: false,
	},
	{
		name: "unchanged graphic produces no extra edits",
		boards: { before: board([rectGraphic]), after: board([rectGraphic]) },
		expectedPcb: [],
		expectedCanSave: false,
	},
	{
		name: "modified graphic with uuid produces deleteGraphic then addGraphic",
		boards: {
			before: board([rectGraphic]),
			after: board([{ ...rectGraphic, x2: 30 }]),
		},
		expectedPcb: [
			{ op: "deleteGraphic", uuid: "u-rect-1" },
			{ op: "addGraphic", graphic: { ...rectGraphic, x2: 30 } },
		],
		expectedCanSave: true,
	},
	{
		name: "empty boards produce no extra edits",
		boards: { before: board([]), after: board([]) },
		expectedPcb: [],
		expectedCanSave: false,
	},
	{
		name: "undefined boards produce no extra edits",
		boards: undefined,
		expectedPcb: [],
		expectedCanSave: false,
	},
	{
		name: "added circle, arc, text, and dimension produce addGraphic ops",
		boards: {
			before: board([]),
			after: board([circleGraphic, arcGraphic, textGraphic, dimensionGraphic]),
		},
		expectedPcb: [
			{ op: "addGraphic", graphic: circleGraphic },
			{ op: "addGraphic", graphic: arcGraphic },
			{ op: "addGraphic", graphic: textGraphic },
			{ op: "addGraphic", graphic: dimensionGraphic },
		],
		expectedCanSave: true,
	},
	{
		name: "combines track edits and graphic edits in pcb edits",
		boards: {
			before: { tracks: [], graphics: [] },
			after: { tracks: [segTrack], graphics: [lineGraphic] },
		},
		expectedPcb: [
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
			{ op: "addGraphic", graphic: lineGraphic },
		],
		expectedCanSave: true,
	},
];

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
