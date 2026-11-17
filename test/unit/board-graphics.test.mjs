import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	addGraphic,
	deleteGraphic,
	graphicsEdits,
	hitTestGraphic,
	moveGraphic,
} from "../../frontend/src/editor/boardGraphics.js";

const boardWith = (...graphics) => ({ graphics });
const freezeBoard = (graphics = []) =>
	Object.freeze({ graphics: Object.freeze(graphics) });

const lineAt = (x, y, extra = {}) => ({
	kind: "line",
	layer: "F.SilkS",
	x,
	y,
	...extra,
});
const rectAt = (layer, [x, y, x2, y2], extra = {}) => ({
	kind: "rect",
	layer,
	x,
	y,
	x2,
	y2,
	...extra,
});
const circleAt = (layer, [x, y, x2, y2], extra = {}) => ({
	kind: "circle",
	layer,
	x,
	y,
	x2,
	y2,
	...extra,
});
const arcAt = (layer, [x, y, xm, ym, x2, y2], extra = {}) => ({
	kind: "arc",
	layer,
	x,
	y,
	xm,
	ym,
	x2,
	y2,
	...extra,
});
const textAt = (layer, [x, y], text, extra = {}) => ({
	kind: "text",
	layer,
	x,
	y,
	text,
	...extra,
});
const dimAt = (layer, [x, y, x2, y2], extra = {}) => ({
	kind: "dimension",
	layer,
	x,
	y,
	x2,
	y2,
	...extra,
});

describe("addGraphic", () => {
	function checkAdd(input, expectedId = "gfx-1", expectedWidth = 0.15) {
		const board = { drawings: ["keep-me"] };
		const next = addGraphic(board, input);
		assert.equal(next.drawings, board.drawings);
		assert.equal(next.graphics.length, 1);
		const [g] = next.graphics;
		assert.deepEqual(
			{ id: g.id, width: g.width, kind: g.kind, layer: g.layer },
			{
				id: expectedId,
				width: expectedWidth,
				kind: input.kind,
				layer: input.layer,
			},
		);
	}

	test("defaults line width to 0.15 on F.SilkS and auto-generates id", () =>
		checkAdd(lineAt(0, 0, { x2: 10, y2: 0 })));
	test("defaults width to 0.1 on Edge.Cuts", () =>
		checkAdd(rectAt("Edge.Cuts", [0, 0, 20, 15]), "gfx-1", 0.1));
	test("preserves explicit id and explicit width", () =>
		checkAdd(
			arcAt("Edge.Cuts", [0, 0, 5, 2, 10, 0], {
				id: "custom-arc",
				width: 0.4,
			}),
			"custom-arc",
			0.4,
		));
	test("adds circle on B.SilkS with default 0.15 width", () =>
		checkAdd(circleAt("B.SilkS", [10, 10, 15, 10])));
	test("adds text on Dwgs.User with body text", () =>
		checkAdd(textAt("Dwgs.User", [5, 5], "Banana v2")));
	test("adds dimension on F.Cu", () => checkAdd(dimAt("F.Cu", [0, 0, 25, 0])));

	test("auto id increments past existing gfx-<n>", () => {
		let board = {};
		board = addGraphic(board, lineAt(0, 0));
		board = addGraphic(board, lineAt(1, 1));
		board = addGraphic(board, lineAt(2, 2, { id: "gfx-9" }));
		board = addGraphic(board, lineAt(3, 3));
		assert.deepEqual(
			board.graphics.map((g) => g.id),
			["gfx-1", "gfx-2", "gfx-9", "gfx-10"],
		);
	});

	test("does not mutate original board", () => {
		const board = freezeBoard();
		const nextBoard = addGraphic(board, lineAt(0, 0));
		assert.equal(board.graphics.length, 0);
		assert.equal(nextBoard.graphics.length, 1);
	});
});

describe("deleteGraphic", () => {
	const board = boardWith(
		lineAt(0, 0, { id: "gfx-1" }),
		circleAt("B.SilkS", [5, 5], { id: "gfx-2" }),
	);

	test("deletes existing graphic by id", () => {
		const next = deleteGraphic(board, "gfx-1");
		assert.equal(next.graphics.length, 1);
		assert.equal(next.graphics[0].id, "gfx-2");
	});

	test("no-op when id does not exist", () => {
		const next = deleteGraphic(board, "nonexistent");
		assert.equal(next.graphics.length, 2);
	});

	test("does not mutate original board", () => {
		const frozen = freezeBoard([{ id: "gfx-1" }]);
		const next = deleteGraphic(frozen, "gfx-1");
		assert.equal(frozen.graphics.length, 1);
		assert.equal(next.graphics.length, 0);
	});
});

const MOVE_CASES = [
	[
		"moves line coordinates (x, y, x2, y2)",
		lineAt(1, 2, { x2: 3, y2: 4 }),
		[5, -1],
		{ x: 6, y: 1, x2: 8, y2: 3 },
	],
	[
		"moves rect coordinates (x, y, x2, y2)",
		rectAt("Edge.Cuts", [10, 20, 30, 40]),
		[-2, 3],
		{ x: 8, y: 23, x2: 28, y2: 43 },
	],
	[
		"moves circle coordinates (x, y, x2, y2)",
		circleAt("F.SilkS", [5, 5, 8, 5]),
		[2, 2],
		{ x: 7, y: 7, x2: 10, y2: 7 },
	],
	[
		"moves arc coordinates (x, y, xm, ym, x2, y2)",
		arcAt("Dwgs.User", [0, 0, 5, 2, 10, 0]),
		[1, 4],
		{ x: 1, y: 4, xm: 6, ym: 6, x2: 11, y2: 4 },
	],
	[
		"moves text anchor (x, y)",
		textAt("F.SilkS", [12, 18], "Note"),
		[-2, -3],
		{ x: 10, y: 15 },
	],
	[
		"moves dimension (x, y, x2, y2)",
		dimAt("F.SilkS", [0, 10, 20, 10]),
		[5, 5],
		{ x: 5, y: 15, x2: 25, y2: 15 },
	],
];

describe("moveGraphic", () => {
	const other = {
		id: "other",
		kind: "line",
		x: 100,
		y: 100,
		x2: 101,
		y2: 101,
	};
	for (const [name, graphic, [dx, dy], expected] of MOVE_CASES) {
		test(name, () => {
			const next = moveGraphic(
				boardWith({ id: "g1", ...graphic }, other),
				"g1",
				dx,
				dy,
			);
			const moved = next.graphics.find((g) => g.id === "g1");
			for (const [key, val] of Object.entries(expected)) {
				assert.equal(moved[key], val);
			}
			assert.equal(next.graphics[1].x, 100);
		});
	}

	test("does not mutate original board", () => {
		const frozen = freezeBoard([{ id: "g1", x: 1, y: 1 }]);
		const next = moveGraphic(frozen, "g1", 2, 3);
		assert.equal(frozen.graphics[0].x, 1);
		assert.equal(next.graphics[0].x, 3);
	});
});

const editLine = lineAt(0, 0, { id: "g1", x2: 5, y2: 0 });
const movedCircle = circleAt("F.SilkS", [15, 15, 17, 15], {
	id: "g1",
	uuid: "u-456",
});
const sameText = textAt("F.SilkS", [5, 5], "Same", {
	id: "g1",
	uuid: "u-789",
});

const EDITS_CASES = [
	[
		"emits addGraphic for newly added graphic",
		[],
		[editLine],
		[{ op: "addGraphic", graphic: editLine }],
	],
	[
		"emits deleteGraphic for removed graphic with uuid",
		[{ ...editLine, uuid: "u-123" }],
		[],
		[{ op: "deleteGraphic", uuid: "u-123" }],
	],
	["ignores removed graphic without uuid", [editLine], [], []],
	[
		"emits deleteGraphic then addGraphic for moved graphic with uuid",
		[circleAt("F.SilkS", [10, 10, 12, 10], { id: "g1", uuid: "u-456" })],
		[movedCircle],
		[
			{ op: "deleteGraphic", uuid: "u-456" },
			{ op: "addGraphic", graphic: movedCircle },
		],
	],
	["emits no ops when graphics are unchanged", [sameText], [sameText], []],
];

describe("graphicsEdits", () => {
	for (const [name, beforeGfx, afterGfx, expected] of EDITS_CASES) {
		test(name, () => {
			assert.deepEqual(
				graphicsEdits(boardWith(...beforeGfx), boardWith(...afterGfx)),
				expected,
			);
		});
	}
});

const hit = (shape, pt, tol = 0.5) => hitTestGraphic([shape], pt, tol);

const HIT_SHAPES = {
	line: lineAt(0, 0, { id: "line-1", x2: 10, y2: 0 }),
	rect: rectAt("Edge.Cuts", [0, 0, 10, 10], { id: "rect-1" }),
	circle: circleAt("F.SilkS", [10, 10, 15, 10], { id: "circle-1" }),
	arc: arcAt("Dwgs.User", [0, 0, 5, 5, 10, 0], { id: "arc-1" }),
	text: textAt("F.SilkS", [10, 20], "Label", { id: "text-1" }),
	dimension: dimAt("F.SilkS", [5, 10, 25, 10], { id: "dim-1" }),
};

const HIT_CASES = [
	["line", [0.1, 0.1], "hits near start", "line-1"],
	["line", [5, 0.2], "hits near middle", "line-1"],
	["line", [9.9, -0.1], "hits near end", "line-1"],
	["line", [5, 2], "misses when outside tolerance", null],
	["rect", [5, 0.1], "hits top edge", "rect-1"],
	["rect", [9.9, 5], "hits right edge", "rect-1"],
	["rect", [5, 9.9], "hits bottom edge", "rect-1"],
	["rect", [0.1, 5], "hits left edge", "rect-1"],
	["rect", [5, 5], "misses deep inside unfilled rect", null],
	["rect", [15, 15], "misses far outside rect", null],
	["circle", [10, 5.1], "hits circumference at top", "circle-1"],
	["circle", [14.9, 10], "hits circumference at right", "circle-1"],
	["circle", [10, 10], "misses at center", null],
	["circle", [20, 10], "misses outside radius", null],
	["arc", [0.1, 0.1], "hits near start", "arc-1"],
	["arc", [5.1, 4.9], "hits near mid", "arc-1"],
	["arc", [9.9, 0.1], "hits near end", "arc-1"],
	["arc", [5, 10], "misses far off arc", null],
	["text", [10.2, 20.3], "hits within bbox around anchor", "text-1"],
	["text", [10, 20], "hits at anchor point exactly", "text-1"],
	["text", [11, 20], "misses outside bbox around anchor", null],
	["dimension", [4.8, 9.9], "hits within bbox around anchor", "dim-1"],
	["dimension", [8, 10], "misses outside bbox around anchor", null],
];

for (const [kind, shape] of Object.entries(HIT_SHAPES)) {
	describe(`hitTestGraphic - ${kind}`, () => {
		const cases = HIT_CASES.filter(([k]) => k === kind);
		for (const [, pt, title, expected] of cases) {
			test(title, () => assert.equal(hit(shape, pt), expected));
		}
	});
}

describe("hitTestGraphic - edge cases", () => {
	test("returns null for non-array graphics or missing pt", () => {
		for (const [gfx, pt] of [
			[null, [0, 0]],
			[[], [0, 0]],
			[[{ id: "g1", kind: "line" }], null],
		]) {
			assert.equal(hitTestGraphic(gfx, pt), null);
		}
	});

	test("supports point object input", () => {
		const line = lineAt(0, 0, { id: "line-1", x2: 10, y2: 0 });
		assert.equal(hitTestGraphic([line], { x: 5, y: 0.1 }, 0.5), "line-1");
	});
});
