import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	addGraphic,
	deleteGraphic,
	graphicsEdits,
	hitTestGraphic,
	moveGraphic,
} from "../../frontend/src/editor/boardGraphics.js";

const ADD_CASES = [
	{
		name: "defaults line width to 0.15 on F.SilkS and auto-generates id",
		input: { kind: "line", layer: "F.SilkS", x: 0, y: 0, x2: 10, y2: 0 },
		expectedId: "gfx-1",
		expectedWidth: 0.15,
	},
	{
		name: "defaults width to 0.1 on Edge.Cuts",
		input: { kind: "rect", layer: "Edge.Cuts", x: 0, y: 0, x2: 20, y2: 15 },
		expectedId: "gfx-1",
		expectedWidth: 0.1,
	},
	{
		name: "preserves explicit id and explicit width",
		input: {
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
		expectedId: "custom-arc",
		expectedWidth: 0.4,
	},
	{
		name: "adds circle on B.SilkS with default 0.15 width",
		input: {
			kind: "circle",
			layer: "B.SilkS",
			x: 10,
			y: 10,
			x2: 15,
			y2: 10,
		},
		expectedId: "gfx-1",
		expectedWidth: 0.15,
	},
	{
		name: "adds text on Dwgs.User with body text",
		input: {
			kind: "text",
			layer: "Dwgs.User",
			x: 5,
			y: 5,
			text: "Banana v2",
		},
		expectedId: "gfx-1",
		expectedWidth: 0.15,
	},
	{
		name: "adds dimension on F.Cu",
		input: {
			kind: "dimension",
			layer: "F.Cu",
			x: 0,
			y: 0,
			x2: 25,
			y2: 0,
		},
		expectedId: "gfx-1",
		expectedWidth: 0.15,
	},
];

describe("addGraphic", () => {
	for (const c of ADD_CASES) {
		test(c.name, () => {
			const board = { drawings: ["keep-me"] };
			const nextBoard = addGraphic(board, c.input);
			assert.equal(nextBoard.drawings, board.drawings);
			assert.equal(nextBoard.graphics.length, 1);
			const g = nextBoard.graphics[0];
			assert.equal(g.id, c.expectedId);
			assert.equal(g.width, c.expectedWidth);
			assert.equal(g.kind, c.input.kind);
			assert.equal(g.layer, c.input.layer);
		});
	}

	test("auto id increments past existing gfx-<n>", () => {
		let board = {};
		board = addGraphic(board, { kind: "line", layer: "F.SilkS", x: 0, y: 0 });
		board = addGraphic(board, { kind: "line", layer: "F.SilkS", x: 1, y: 1 });
		board = addGraphic(board, {
			id: "gfx-9",
			kind: "line",
			layer: "F.SilkS",
			x: 2,
			y: 2,
		});
		board = addGraphic(board, { kind: "line", layer: "F.SilkS", x: 3, y: 3 });
		assert.deepEqual(
			board.graphics.map((g) => g.id),
			["gfx-1", "gfx-2", "gfx-9", "gfx-10"],
		);
	});

	test("does not mutate original board", () => {
		const board = Object.freeze({ graphics: Object.freeze([]) });
		const nextBoard = addGraphic(board, {
			kind: "line",
			layer: "F.SilkS",
			x: 0,
			y: 0,
		});
		assert.equal(board.graphics.length, 0);
		assert.equal(nextBoard.graphics.length, 1);
	});
});

describe("deleteGraphic", () => {
	const board = {
		graphics: [
			{ id: "gfx-1", kind: "line", layer: "F.SilkS", x: 0, y: 0 },
			{ id: "gfx-2", kind: "circle", layer: "B.SilkS", x: 5, y: 5 },
		],
	};

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
		const frozen = Object.freeze({
			graphics: Object.freeze([{ id: "gfx-1" }]),
		});
		const next = deleteGraphic(frozen, "gfx-1");
		assert.equal(frozen.graphics.length, 1);
		assert.equal(next.graphics.length, 0);
	});
});

const MOVE_CASES = [
	{
		name: "moves line coordinates (x, y, x2, y2)",
		graphic: {
			id: "g1",
			kind: "line",
			layer: "F.SilkS",
			x: 1,
			y: 2,
			x2: 3,
			y2: 4,
		},
		dx: 5,
		dy: -1,
		expected: { x: 6, y: 1, x2: 8, y2: 3 },
	},
	{
		name: "moves rect coordinates (x, y, x2, y2)",
		graphic: {
			id: "g1",
			kind: "rect",
			layer: "Edge.Cuts",
			x: 10,
			y: 20,
			x2: 30,
			y2: 40,
		},
		dx: -2,
		dy: 3,
		expected: { x: 8, y: 23, x2: 28, y2: 43 },
	},
	{
		name: "moves circle coordinates (x, y, x2, y2)",
		graphic: {
			id: "g1",
			kind: "circle",
			layer: "F.SilkS",
			x: 5,
			y: 5,
			x2: 8,
			y2: 5,
		},
		dx: 2,
		dy: 2,
		expected: { x: 7, y: 7, x2: 10, y2: 7 },
	},
	{
		name: "moves arc coordinates (x, y, xm, ym, x2, y2)",
		graphic: {
			id: "g1",
			kind: "arc",
			layer: "Dwgs.User",
			x: 0,
			y: 0,
			xm: 5,
			ym: 2,
			x2: 10,
			y2: 0,
		},
		dx: 1,
		dy: 4,
		expected: { x: 1, y: 4, xm: 6, ym: 6, x2: 11, y2: 4 },
	},
	{
		name: "moves text anchor (x, y)",
		graphic: {
			id: "g1",
			kind: "text",
			layer: "F.SilkS",
			x: 12,
			y: 18,
			text: "Note",
		},
		dx: -2,
		dy: -3,
		expected: { x: 10, y: 15 },
	},
	{
		name: "moves dimension (x, y, x2, y2)",
		graphic: {
			id: "g1",
			kind: "dimension",
			layer: "F.SilkS",
			x: 0,
			y: 10,
			x2: 20,
			y2: 10,
		},
		dx: 5,
		dy: 5,
		expected: { x: 5, y: 15, x2: 25, y2: 15 },
	},
];

describe("moveGraphic", () => {
	for (const c of MOVE_CASES) {
		test(c.name, () => {
			const board = {
				graphics: [
					c.graphic,
					{ id: "other", kind: "line", x: 100, y: 100, x2: 101, y2: 101 },
				],
			};
			const next = moveGraphic(board, "g1", c.dx, c.dy);
			const moved = next.graphics.find((g) => g.id === "g1");
			for (const [key, val] of Object.entries(c.expected)) {
				assert.equal(moved[key], val);
			}
			assert.equal(next.graphics[1].x, 100);
		});
	}

	test("does not mutate original board", () => {
		const frozen = Object.freeze({
			graphics: Object.freeze([{ id: "g1", x: 1, y: 1 }]),
		});
		const next = moveGraphic(frozen, "g1", 2, 3);
		assert.equal(frozen.graphics[0].x, 1);
		assert.equal(next.graphics[0].x, 3);
	});
});

const EDITS_CASES = [
	{
		name: "emits addGraphic for newly added graphic",
		before: { graphics: [] },
		after: {
			graphics: [
				{ id: "g1", kind: "line", layer: "F.SilkS", x: 0, y: 0, x2: 5, y2: 0 },
			],
		},
		expected: [
			{
				op: "addGraphic",
				graphic: {
					id: "g1",
					kind: "line",
					layer: "F.SilkS",
					x: 0,
					y: 0,
					x2: 5,
					y2: 0,
				},
			},
		],
	},
	{
		name: "emits deleteGraphic for removed graphic with uuid",
		before: {
			graphics: [
				{
					id: "g1",
					uuid: "u-123",
					kind: "line",
					layer: "F.SilkS",
					x: 0,
					y: 0,
					x2: 5,
					y2: 0,
				},
			],
		},
		after: { graphics: [] },
		expected: [{ op: "deleteGraphic", uuid: "u-123" }],
	},
	{
		name: "ignores removed graphic without uuid",
		before: {
			graphics: [
				{ id: "g1", kind: "line", layer: "F.SilkS", x: 0, y: 0, x2: 5, y2: 0 },
			],
		},
		after: { graphics: [] },
		expected: [],
	},
	{
		name: "emits deleteGraphic then addGraphic for moved graphic with uuid",
		before: {
			graphics: [
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
		},
		after: {
			graphics: [
				{
					id: "g1",
					uuid: "u-456",
					kind: "circle",
					layer: "F.SilkS",
					x: 15,
					y: 15,
					x2: 17,
					y2: 15,
				},
			],
		},
		expected: [
			{ op: "deleteGraphic", uuid: "u-456" },
			{
				op: "addGraphic",
				graphic: {
					id: "g1",
					uuid: "u-456",
					kind: "circle",
					layer: "F.SilkS",
					x: 15,
					y: 15,
					x2: 17,
					y2: 15,
				},
			},
		],
	},
	{
		name: "emits no ops when graphics are unchanged",
		before: {
			graphics: [
				{
					id: "g1",
					uuid: "u-789",
					kind: "text",
					layer: "F.SilkS",
					x: 5,
					y: 5,
					text: "Same",
				},
			],
		},
		after: {
			graphics: [
				{
					id: "g1",
					uuid: "u-789",
					kind: "text",
					layer: "F.SilkS",
					x: 5,
					y: 5,
					text: "Same",
				},
			],
		},
		expected: [],
	},
];

describe("graphicsEdits", () => {
	for (const c of EDITS_CASES) {
		test(c.name, () => {
			const ops = graphicsEdits(c.before, c.after);
			assert.deepEqual(ops, c.expected);
		});
	}
});

const HIT_LINE_CASES = [
	{ name: "hits near start", pt: [0.1, 0.1], tol: 0.5, expected: "line-1" },
	{ name: "hits near middle", pt: [5, 0.2], tol: 0.5, expected: "line-1" },
	{ name: "hits near end", pt: [9.9, -0.1], tol: 0.5, expected: "line-1" },
	{
		name: "misses when outside tolerance",
		pt: [5, 2],
		tol: 0.5,
		expected: null,
	},
];

describe("hitTestGraphic - line", () => {
	const line = {
		id: "line-1",
		kind: "line",
		layer: "F.SilkS",
		x: 0,
		y: 0,
		x2: 10,
		y2: 0,
	};
	for (const c of HIT_LINE_CASES) {
		test(c.name, () => {
			assert.equal(hitTestGraphic([line], c.pt, c.tol), c.expected);
		});
	}
});

const HIT_RECT_CASES = [
	{ name: "hits top edge", pt: [5, 0.1], tol: 0.5, expected: "rect-1" },
	{ name: "hits right edge", pt: [9.9, 5], tol: 0.5, expected: "rect-1" },
	{ name: "hits bottom edge", pt: [5, 9.9], tol: 0.5, expected: "rect-1" },
	{ name: "hits left edge", pt: [0.1, 5], tol: 0.5, expected: "rect-1" },
	{
		name: "misses deep inside unfilled rect",
		pt: [5, 5],
		tol: 0.5,
		expected: null,
	},
	{ name: "misses far outside rect", pt: [15, 15], tol: 0.5, expected: null },
];

describe("hitTestGraphic - rect", () => {
	const rect = {
		id: "rect-1",
		kind: "rect",
		layer: "Edge.Cuts",
		x: 0,
		y: 0,
		x2: 10,
		y2: 10,
	};
	for (const c of HIT_RECT_CASES) {
		test(c.name, () => {
			assert.equal(hitTestGraphic([rect], c.pt, c.tol), c.expected);
		});
	}
});

const HIT_CIRCLE_CASES = [
	{
		name: "hits circumference at top",
		pt: [10, 5.1],
		tol: 0.5,
		expected: "circle-1",
	},
	{
		name: "hits circumference at right",
		pt: [14.9, 10],
		tol: 0.5,
		expected: "circle-1",
	},
	{ name: "misses at center", pt: [10, 10], tol: 0.5, expected: null },
	{
		name: "misses outside radius",
		pt: [20, 10],
		tol: 0.5,
		expected: null,
	},
];

describe("hitTestGraphic - circle", () => {
	const circle = {
		id: "circle-1",
		kind: "circle",
		layer: "F.SilkS",
		x: 10,
		y: 10,
		x2: 15,
		y2: 10,
	};
	for (const c of HIT_CIRCLE_CASES) {
		test(c.name, () => {
			assert.equal(hitTestGraphic([circle], c.pt, c.tol), c.expected);
		});
	}
});

const HIT_ARC_CASES = [
	{ name: "hits near start", pt: [0.1, 0.1], tol: 0.5, expected: "arc-1" },
	{ name: "hits near mid", pt: [5.1, 4.9], tol: 0.5, expected: "arc-1" },
	{ name: "hits near end", pt: [9.9, 0.1], tol: 0.5, expected: "arc-1" },
	{ name: "misses far off arc", pt: [5, 10], tol: 0.5, expected: null },
];

describe("hitTestGraphic - arc", () => {
	const arc = {
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
	for (const c of HIT_ARC_CASES) {
		test(c.name, () => {
			assert.equal(hitTestGraphic([arc], c.pt, c.tol), c.expected);
		});
	}
});

const HIT_TEXT_CASES = [
	{
		name: "hits within bbox around anchor",
		pt: [10.2, 20.3],
		tol: 0.5,
		expected: "text-1",
	},
	{
		name: "hits at anchor point exactly",
		pt: [10, 20],
		tol: 0.5,
		expected: "text-1",
	},
	{
		name: "misses outside bbox around anchor",
		pt: [11, 20],
		tol: 0.5,
		expected: null,
	},
];

describe("hitTestGraphic - text", () => {
	const txt = {
		id: "text-1",
		kind: "text",
		layer: "F.SilkS",
		x: 10,
		y: 20,
		text: "Label",
	};
	for (const c of HIT_TEXT_CASES) {
		test(c.name, () => {
			assert.equal(hitTestGraphic([txt], c.pt, c.tol), c.expected);
		});
	}
});

const HIT_DIMENSION_CASES = [
	{
		name: "hits within bbox around anchor",
		pt: [4.8, 9.9],
		tol: 0.5,
		expected: "dim-1",
	},
	{
		name: "misses outside bbox around anchor",
		pt: [8, 10],
		tol: 0.5,
		expected: null,
	},
];

describe("hitTestGraphic - dimension", () => {
	const dim = {
		id: "dim-1",
		kind: "dimension",
		layer: "F.SilkS",
		x: 5,
		y: 10,
		x2: 25,
		y2: 10,
	};
	for (const c of HIT_DIMENSION_CASES) {
		test(c.name, () => {
			assert.equal(hitTestGraphic([dim], c.pt, c.tol), c.expected);
		});
	}
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
