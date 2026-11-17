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
		checkAdd({ kind: "line", layer: "F.SilkS", x: 0, y: 0, x2: 10, y2: 0 }));
	test("defaults width to 0.1 on Edge.Cuts", () =>
		checkAdd(
			{ kind: "rect", layer: "Edge.Cuts", x: 0, y: 0, x2: 20, y2: 15 },
			"gfx-1",
			0.1,
		));
	test("preserves explicit id and explicit width", () =>
		checkAdd(
			{
				id: "custom-arc",
				kind: "arc",
				layer: "Edge.Cuts",
				x: 0,
				y: 0,
				xm: 5,
				ym: 2,
				x2: 10,
				y2: 0,
				width: 0.4,
			},
			"custom-arc",
			0.4,
		));
	test("adds circle on B.SilkS with default 0.15 width", () =>
		checkAdd({
			kind: "circle",
			layer: "B.SilkS",
			x: 10,
			y: 10,
			x2: 15,
			y2: 10,
		}));
	test("adds text on Dwgs.User with body text", () =>
		checkAdd({
			kind: "text",
			layer: "Dwgs.User",
			x: 5,
			y: 5,
			text: "Banana v2",
		}));
	test("adds dimension on F.Cu", () =>
		checkAdd({
			kind: "dimension",
			layer: "F.Cu",
			x: 0,
			y: 0,
			x2: 25,
			y2: 0,
		}));

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
	const board = boardWith(lineAt(0, 0, { id: "gfx-1" }), {
		id: "gfx-2",
		kind: "circle",
		layer: "B.SilkS",
		x: 5,
		y: 5,
	});

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
		{ kind: "rect", layer: "Edge.Cuts", x: 10, y: 20, x2: 30, y2: 40 },
		[-2, 3],
		{ x: 8, y: 23, x2: 28, y2: 43 },
	],
	[
		"moves circle coordinates (x, y, x2, y2)",
		{ kind: "circle", layer: "F.SilkS", x: 5, y: 5, x2: 8, y2: 5 },
		[2, 2],
		{ x: 7, y: 7, x2: 10, y2: 7 },
	],
	[
		"moves arc coordinates (x, y, xm, ym, x2, y2)",
		{
			kind: "arc",
			layer: "Dwgs.User",
			x: 0,
			y: 0,
			xm: 5,
			ym: 2,
			x2: 10,
			y2: 0,
		},
		[1, 4],
		{ x: 1, y: 4, xm: 6, ym: 6, x2: 11, y2: 4 },
	],
	[
		"moves text anchor (x, y)",
		{ kind: "text", layer: "F.SilkS", x: 12, y: 18, text: "Note" },
		[-2, -3],
		{ x: 10, y: 15 },
	],
	[
		"moves dimension (x, y, x2, y2)",
		{ kind: "dimension", layer: "F.SilkS", x: 0, y: 10, x2: 20, y2: 10 },
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

const editLine = {
	id: "g1",
	kind: "line",
	layer: "F.SilkS",
	x: 0,
	y: 0,
	x2: 5,
	y2: 0,
};
const movedCircle = {
	id: "g1",
	uuid: "u-456",
	kind: "circle",
	layer: "F.SilkS",
	x: 15,
	y: 15,
	x2: 17,
	y2: 15,
};
const sameText = {
	id: "g1",
	uuid: "u-789",
	kind: "text",
	layer: "F.SilkS",
	x: 5,
	y: 5,
	text: "Same",
};

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
		[
			{
				id: "g1",
				uuid: "u-456",
				kind: "circle",
				layer: "F.SilkS",
				x: 10,
				y: 10,
				x2: 12,
				y2: 10,
			},
		],
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

describe("hitTestGraphic - line", () => {
	const s = {
		id: "line-1",
		kind: "line",
		layer: "F.SilkS",
		x: 0,
		y: 0,
		x2: 10,
		y2: 0,
	};
	test("hits near start", () => assert.equal(hit(s, [0.1, 0.1]), "line-1"));
	test("hits near middle", () => assert.equal(hit(s, [5, 0.2]), "line-1"));
	test("hits near end", () => assert.equal(hit(s, [9.9, -0.1]), "line-1"));
	test("misses when outside tolerance", () =>
		assert.equal(hit(s, [5, 2]), null));
});

describe("hitTestGraphic - rect", () => {
	const s = {
		id: "rect-1",
		kind: "rect",
		layer: "Edge.Cuts",
		x: 0,
		y: 0,
		x2: 10,
		y2: 10,
	};
	test("hits top edge", () => assert.equal(hit(s, [5, 0.1]), "rect-1"));
	test("hits right edge", () => assert.equal(hit(s, [9.9, 5]), "rect-1"));
	test("hits bottom edge", () => assert.equal(hit(s, [5, 9.9]), "rect-1"));
	test("hits left edge", () => assert.equal(hit(s, [0.1, 5]), "rect-1"));
	test("misses deep inside unfilled rect", () =>
		assert.equal(hit(s, [5, 5]), null));
	test("misses far outside rect", () => assert.equal(hit(s, [15, 15]), null));
});

describe("hitTestGraphic - circle", () => {
	const s = {
		id: "circle-1",
		kind: "circle",
		layer: "F.SilkS",
		x: 10,
		y: 10,
		x2: 15,
		y2: 10,
	};
	test("hits circumference at top", () =>
		assert.equal(hit(s, [10, 5.1]), "circle-1"));
	test("hits circumference at right", () =>
		assert.equal(hit(s, [14.9, 10]), "circle-1"));
	test("misses at center", () => assert.equal(hit(s, [10, 10]), null));
	test("misses outside radius", () => assert.equal(hit(s, [20, 10]), null));
});

describe("hitTestGraphic - arc", () => {
	const s = {
		id: "arc-1",
		kind: "arc",
		layer: "Dwgs.User",
		x: 0,
		y: 0,
		xm: 5,
		ym: 5,
		x2: 10,
		y2: 0,
	};
	test("hits near start", () => assert.equal(hit(s, [0.1, 0.1]), "arc-1"));
	test("hits near mid", () => assert.equal(hit(s, [5.1, 4.9]), "arc-1"));
	test("hits near end", () => assert.equal(hit(s, [9.9, 0.1]), "arc-1"));
	test("misses far off arc", () => assert.equal(hit(s, [5, 10]), null));
});

describe("hitTestGraphic - text", () => {
	const s = {
		id: "text-1",
		kind: "text",
		layer: "F.SilkS",
		x: 10,
		y: 20,
		text: "Label",
	};
	test("hits within bbox around anchor", () =>
		assert.equal(hit(s, [10.2, 20.3]), "text-1"));
	test("hits at anchor point exactly", () =>
		assert.equal(hit(s, [10, 20]), "text-1"));
	test("misses outside bbox around anchor", () =>
		assert.equal(hit(s, [11, 20]), null));
});

describe("hitTestGraphic - dimension", () => {
	const s = {
		id: "dim-1",
		kind: "dimension",
		layer: "F.SilkS",
		x: 5,
		y: 10,
		x2: 25,
		y2: 10,
	};
	test("hits within bbox around anchor", () =>
		assert.equal(hit(s, [4.8, 9.9]), "dim-1"));
	test("misses outside bbox around anchor", () =>
		assert.equal(hit(s, [8, 10]), null));
});

describe("hitTestGraphic - edge cases", () => {
	test("returns null for non-array graphics or missing pt", () => {
		assert.equal(hitTestGraphic(null, [0, 0]), null);
		assert.equal(hitTestGraphic([], [0, 0]), null);
		assert.equal(hitTestGraphic([{ id: "g1", kind: "line" }], null), null);
	});

	test("supports point object input", () => {
		const line = {
			id: "line-1",
			kind: "line",
			layer: "F.SilkS",
			x: 0,
			y: 0,
			x2: 10,
			y2: 0,
		};
		assert.equal(hitTestGraphic([line], { x: 5, y: 0.1 }, 0.5), "line-1");
	});
});
