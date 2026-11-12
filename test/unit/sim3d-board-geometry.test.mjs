import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	BOARD_THICKNESS,
	netSegments,
} from "../../frontend/src/components/sim3d/boardGeometry.js";

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
		assert.deepEqual(netSegments(ir, null), expected);
		assert.deepEqual(netSegments(ir, undefined), expected);
		assert.deepEqual(netSegments(ir, {}), expected);
		assert.deepEqual(netSegments(ir, { tracks: [] }), expected);
	});

	test("a net with two joined segments becomes one polyline in order", () => {
		const board = {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0], layer: "F.Cu" },
				{ netId: "n1", start: [10, 0], end: [10, 10], layer: "F.Cu" },
			],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 1);
		assert.equal(segs[0].netId, "n1");
		assert.equal(segs[0].real, true);
		assert.deepEqual(segs[0].points, [
			[0, 0, 0],
			[10, 0, 0],
			[10, 10, 0],
		]);
	});

	test("reversed segments are joined correctly", () => {
		const board = {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0] },
				{ netId: "n1", start: [20, 0], end: [10, 0] },
			],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 1);
		assert.deepEqual(segs[0].points, [
			[0, 0, 0],
			[10, 0, 0],
			[20, 0, 0],
		]);
	});

	test("two disconnected runs give two polylines", () => {
		const board = {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [5, 0] },
				{ netId: "n1", start: [5, 0], end: [10, 0] },
				{ netId: "n1", start: [50, 50], end: [55, 50] },
				{ netId: "n1", start: [55, 50], end: [60, 50] },
			],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 2);
		assert.deepEqual(segs[0].points, [
			[0, 0, 0],
			[5, 0, 0],
			[10, 0, 0],
		]);
		assert.deepEqual(segs[1].points, [
			[50, 50, 0],
			[55, 50, 0],
			[60, 50, 0],
		]);
	});

	test("back-layer track sits below the board", () => {
		const board = {
			tracks: [{ netId: "n1", start: [0, 0], end: [10, 0], layer: "B.Cu" }],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 1);
		assert.equal(segs[0].points[0][2], -BOARD_THICKNESS);
		assert.equal(segs[0].points[1][2], -BOARD_THICKNESS);
		assert.ok(segs[0].points[0][2] < 0);
	});

	test("via adds a vertical segment", () => {
		const board = {
			tracks: [{ netId: "n1", start: [0, 0], end: [5, 5], layer: "F.Cu" }],
			vias: [{ netId: "n1", at: [5, 5] }],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 1);
		assert.deepEqual(segs[0].points, [
			[0, 0, 0],
			[5, 5, 0],
			[5, 5, -BOARD_THICKNESS],
		]);
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
		const board = {
			tracks: [
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
			],
		};
		const segs = netSegments(ir, board);
		assert.equal(segs.length, 1);
		assert.equal(segs[0].netId, "valid_net");
		assert.deepEqual(segs[0].points, [
			[0, 0, 0],
			[5, 5, 0],
		]);
	});

	test("joins endpoints within 0.01 tolerance but separates larger gaps", () => {
		const boardClose = {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0] },
				{ netId: "n1", start: [10.005, 0], end: [20, 0] },
			],
		};
		const segsClose = netSegments(null, boardClose);
		assert.equal(segsClose.length, 1);

		const boardFar = {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [10, 0] },
				{ netId: "n1", start: [10.02, 0], end: [20, 0] },
			],
		};
		const segsFar = netSegments(null, boardFar);
		assert.equal(segsFar.length, 2);
	});

	test("multi-layer route connects front track, via, and back track into single polyline", () => {
		const board = {
			tracks: [
				{ netId: "n1", start: [0, 0], end: [5, 5], layer: "F.Cu" },
				{ netId: "n1", start: [5, 5], end: [10, 10], layer: "B.Cu" },
			],
			vias: [{ netId: "n1", at: [5, 5] }],
		};
		const segs = netSegments(null, board);
		assert.equal(segs.length, 1);
		assert.deepEqual(segs[0].points, [
			[0, 0, 0],
			[5, 5, 0],
			[5, 5, -BOARD_THICKNESS],
			[10, 10, -BOARD_THICKNESS],
		]);
	});
});
