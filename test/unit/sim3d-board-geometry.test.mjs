import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BOARD_THICKNESS,
	netSegments,
} from "../../frontend/src/components/sim3d/boardGeometry.js";

const EMPTY_BOARD_INPUTS = [null, undefined, {}, { tracks: [] }];

const TRACK_ROUTE_CASES = [
	{
		name: "a net with two joined segments becomes one polyline in order",
		board: {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0], layer: "F.Cu" },
				{ netId: "n1", start: [10, 0], end: [10, 10], layer: "F.Cu" },
			],
		},
		expectedSegments: [
			{
				netId: "n1",
				real: true,
				points: [
					[0, 0, 0],
					[10, 0, 0],
					[10, 10, 0],
				],
			},
		],
	},
	{
		name: "reversed segments are joined correctly",
		board: {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0] },
				{ netId: "n1", start: [20, 0], end: [10, 0] },
			],
		},
		expectedSegments: [
			{
				points: [
					[0, 0, 0],
					[10, 0, 0],
					[20, 0, 0],
				],
			},
		],
	},
	{
		name: "two disconnected runs give two polylines",
		board: {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [5, 0] },
				{ netId: "n1", start: [5, 0], end: [10, 0] },
				{ netId: "n1", start: [50, 50], end: [55, 50] },
				{ netId: "n1", start: [55, 50], end: [60, 50] },
			],
		},
		expectedSegments: [
			{
				points: [
					[0, 0, 0],
					[5, 0, 0],
					[10, 0, 0],
				],
			},
			{
				points: [
					[50, 50, 0],
					[55, 50, 0],
					[60, 50, 0],
				],
			},
		],
	},
	{
		name: "via adds a vertical segment",
		board: {
			tracks: [{ netId: "n1", start: [0, 0], end: [5, 5], layer: "F.Cu" }],
			vias: [{ netId: "n1", at: [5, 5] }],
		},
		expectedSegments: [
			{
				points: [
					[0, 0, 0],
					[5, 5, 0],
					[5, 5, -BOARD_THICKNESS],
				],
			},
		],
	},
	{
		name: "multi-layer route connects front track, via, and back track into single polyline",
		board: {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [5, 5], layer: "F.Cu" },
				{ netId: "n1", start: [5, 5], end: [10, 10], layer: "B.Cu" },
			],
			vias: [{ netId: "n1", at: [5, 5] }],
		},
		expectedSegments: [
			{
				points: [
					[0, 0, 0],
					[5, 5, 0],
					[5, 5, -BOARD_THICKNESS],
					[10, 10, -BOARD_THICKNESS],
				],
			},
		],
	},
];

const MALFORMED_TRACKS = [
	null,
	undefined,
	{},
	{ netId: "valid_net" },
	{ netId: "valid_net", points: [[0, 0]] },
	{ netId: "valid_net", start: [0, 0] },
	{ netId: "valid_net", start: [NaN, 0], end: [1, 1] },
	{ netId: "valid_net", start: [Infinity, 0], end: [1, 1] },
	{ netId: "valid_net", start: [0, 0], end: ["abc", 1] },
	{ netId: "unknown_net", start: [0, 0], end: [1, 1] },
	{ netId: "", start: [0, 0], end: [1, 1] },
	{ netId: "valid_net", start: [0, 0], end: [5, 5] },
];

const TOLERANCE_CASES = [
	{
		board: {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0] },
				{ netId: "n1", start: [10.005, 0], end: [20, 0] },
			],
		},
		expectedCount: 1,
	},
	{
		board: {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0] },
				{ netId: "n1", start: [10.02, 0], end: [20, 0] },
			],
		},
		expectedCount: 2,
	},
];

function assertExpectedSegments(actual, expected) {
	assert.equal(actual.length, expected.length);
	for (let i = 0; i < expected.length; i++) {
		const act = actual[i];
		const exp = expected[i];
		if (exp.netId !== undefined) {
			assert.equal(act.netId, exp.netId);
		}
		if (exp.real !== undefined) {
			assert.equal(act.real, exp.real);
		}
		assert.deepEqual(act.points, exp.points);
	}
}

describe("sim3d boardGeometry - netSegments with real tracks", () => {
	test("no board gives exactly the previous output", () => {
		const ir = {
			parts: [
				{ id: "p1", placement: { x: 10, y: 10 } },
				{ id: "p2", placement: { x: 20, y: 20 } },
			],
			nets: [{ id: "n1", pins: [{ partId: "p1" }, { partId: "p2" }] }],
		};
		const expected = netSegments(ir);
		for (const emptyBoard of EMPTY_BOARD_INPUTS) {
			assert.deepEqual(netSegments(ir, emptyBoard), expected);
		}
	});

	for (const tc of TRACK_ROUTE_CASES) {
		test(tc.name, () => {
			const segs = netSegments(null, tc.board);
			assertExpectedSegments(segs, tc.expectedSegments);
		});
	}

	test("back-layer track sits below the board", () => {
		const board = {
			tracks: [{ netId: "n1", start: [0, 0], end: [10, 0], layer: "B.Cu" }],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 1);
		for (const pt of segs[0].points) {
			assert.equal(pt[2], -BOARD_THICKNESS);
		}
		assert.ok(segs[0].points[0][2] < 0);
	});

	test("a net without tracks keeps the synthetic path while another net uses real tracks", () => {
		const ir = {
			parts: [
				{ id: "p1", placement: { x: 10, y: 10 } },
				{ id: "p2", placement: { x: 30, y: 10 } },
			],
			nets: [
				{ id: "net_real", pins: [] },
				{ id: "net_synth", pins: [{ partId: "p1" }, { partId: "p2" }] },
			],
		};
		const board = {
			tracks: [{ netId: "net_real", start: [0, 0], end: [5, 0] }],
		};
		const segs = netSegments(ir, board);
		const realSeg = segs.find((s) => s.netId === "net_real");
		const synthSeg = segs.find((s) => s.netId === "net_synth");
		assert.ok(realSeg);
		assert.equal(realSeg.real, true);
		assert.ok(synthSeg);
		assert.equal(synthSeg.real, undefined);
		assert.deepEqual(synthSeg.points, [
			[10, 10, 0],
			[30, 10, 0],
		]);
	});

	test("malformed tracks (missing points, non-finite numbers, unknown netId) are ignored without throwing", () => {
		const ir = {
			nets: [{ id: "valid_net" }],
		};
		const segs = netSegments(ir, { tracks: MALFORMED_TRACKS });
		assertExpectedSegments(segs, [
			{
				netId: "valid_net",
				points: [
					[0, 0, 0],
					[5, 5, 0],
				],
			},
		]);
	});

	test("joins endpoints within 0.01 tolerance but separates larger gaps", () => {
		for (const tc of TOLERANCE_CASES) {
			const segs = netSegments(null, tc.board);
			assert.equal(segs.length, tc.expectedCount);
		}
	});
});
