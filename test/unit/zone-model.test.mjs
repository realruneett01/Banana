import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	addZone,
	moveZonePoint,
	pointInZone,
	rectZonePoints,
	removeZone,
	validateZone,
	zoneArea,
} from "../../frontend/src/editor/zoneModel.js";

const RECT_POINTS = [
	[0, 0],
	[10, 0],
	[10, 5],
	[0, 5],
];

const CONCAVE_POINTS = [
	[0, 0],
	[4, 0],
	[4, 2],
	[2, 2],
	[2, 4],
	[0, 4],
];

function makeSampleBoard() {
	return {
		outline: [
			[0, 0],
			[50, 0],
			[50, 50],
			[0, 50],
		],
		zones: [
			{
				netId: "GND",
				layer: "F.Cu",
				polygon: [
					[1, 1],
					[5, 1],
					[5, 5],
					[1, 5],
				],
			},
		],
	};
}

describe("addZone", () => {
	test("appends zone in expected shape", () => {
		const board = { zones: [] };
		const result = addZone(board, {
			netId: "VCC",
			layer: "F.Cu",
			points: RECT_POINTS,
		});
		assert.notEqual(result, board);
		assert.equal(result.zones.length, 1);
		assert.deepEqual(result.zones[0], {
			netId: "VCC",
			layer: "F.Cu",
			polygon: RECT_POINTS,
		});
	});

	test("appends keepout zone without net", () => {
		const board = { zones: [] };
		const result = addZone(board, {
			layer: "B.Cu",
			points: RECT_POINTS,
			keepout: true,
		});
		assert.equal(result.zones.length, 1);
		assert.equal(result.zones[0].netId, "");
		assert.equal(result.zones[0].keepout, true);
	});

	test("rejects point lists with fewer than 3 points", () => {
		const board = makeSampleBoard();
		const cases = [
			[],
			[[0, 0]],
			[
				[0, 0],
				[1, 1],
			],
			null,
			undefined,
		];
		for (const points of cases) {
			const res = addZone(board, { netId: "GND", layer: "F.Cu", points });
			assert.equal(res, board);
		}
	});

	test("rejects point lists containing non-finite coordinates", () => {
		const board = makeSampleBoard();
		const invalidPointSets = [
			[
				[0, 0],
				[NaN, 1],
				[2, 2],
			],
			[
				[0, 0],
				[Infinity, 1],
				[2, 2],
			],
			[[0, 0], null, [2, 2]],
			[[0, 0], [1], [2, 2]],
		];
		for (const points of invalidPointSets) {
			const res = addZone(board, { netId: "GND", layer: "F.Cu", points });
			assert.equal(res, board);
		}
	});

	test("does not mutate inputs", () => {
		const board = Object.freeze({
			zones: Object.freeze([
				Object.freeze({
					netId: "GND",
					layer: "F.Cu",
					polygon: Object.freeze([
						[0, 0],
						[1, 0],
						[1, 1],
					]),
				}),
			]),
		});
		const points = Object.freeze([
			[0, 0],
			[10, 0],
			[10, 10],
		]);
		const opts = Object.freeze({ netId: "SIG", layer: "F.Cu", points });
		const result = addZone(board, opts);
		assert.equal(board.zones.length, 1);
		assert.equal(result.zones.length, 2);
	});
});

describe("removeZone", () => {
	test("removes zone at valid index", () => {
		const board = {
			zones: [
				{ netId: "GND", layer: "F.Cu", polygon: RECT_POINTS },
				{ netId: "VCC", layer: "B.Cu", polygon: RECT_POINTS },
			],
		};
		const result = removeZone(board, 0);
		assert.notEqual(result, board);
		assert.equal(result.zones.length, 1);
		assert.equal(result.zones[0].netId, "VCC");
	});

	test("returns board unchanged when index is negative", () => {
		const board = makeSampleBoard();
		const result = removeZone(board, -1);
		assert.equal(result, board);
	});

	test("returns board unchanged when index is out of bounds", () => {
		const board = makeSampleBoard();
		const result = removeZone(board, 99);
		assert.equal(result, board);
	});

	test("does not mutate input board", () => {
		const board = Object.freeze({
			zones: Object.freeze([
				Object.freeze({ netId: "GND", layer: "F.Cu", polygon: RECT_POINTS }),
			]),
		});
		const result = removeZone(board, 0);
		assert.equal(board.zones.length, 1);
		assert.equal(result.zones.length, 0);
	});
});

describe("moveZonePoint", () => {
	test("moves specified vertex to new coordinates", () => {
		const board = {
			zones: [{ netId: "GND", layer: "F.Cu", polygon: [...RECT_POINTS] }],
		};
		const result = moveZonePoint(board, 0, 1, [12, 1]);
		assert.notEqual(result, board);
		assert.deepEqual(result.zones[0].polygon[1], [12, 1]);
		assert.deepEqual(result.zones[0].polygon[0], [0, 0]);
	});

	test("returns board unchanged when zone index is invalid", () => {
		const board = makeSampleBoard();
		const result = moveZonePoint(board, 5, 0, [10, 10]);
		assert.equal(result, board);
	});

	test("returns board unchanged when point index is invalid", () => {
		const board = makeSampleBoard();
		const negativeRes = moveZonePoint(board, 0, -1, [10, 10]);
		const overflowRes = moveZonePoint(board, 0, 99, [10, 10]);
		assert.equal(negativeRes, board);
		assert.equal(overflowRes, board);
	});

	test("returns board unchanged when coordinates are non-finite", () => {
		const board = makeSampleBoard();
		const badCoords = [[NaN, 0], [0, Infinity], "invalid", [1]];
		for (const coords of badCoords) {
			const res = moveZonePoint(board, 0, 0, coords);
			assert.equal(res, board);
		}
	});

	test("does not mutate input board", () => {
		const initialPt = Object.freeze([0, 0]);
		const board = Object.freeze({
			zones: Object.freeze([
				Object.freeze({
					netId: "GND",
					layer: "F.Cu",
					polygon: Object.freeze([initialPt, [5, 0], [5, 5]]),
				}),
			]),
		});
		const result = moveZonePoint(board, 0, 0, [2, 2]);
		assert.deepEqual(board.zones[0].polygon[0], [0, 0]);
		assert.deepEqual(result.zones[0].polygon[0], [2, 2]);
	});
});

describe("rectZonePoints", () => {
	test("returns 4 corner points in drawing order", () => {
		const pts = rectZonePoints([0, 0], [10, 5]);
		assert.deepEqual(pts, [
			[0, 0],
			[10, 0],
			[10, 5],
			[0, 5],
		]);
	});

	test("preserves drawing order when second point is smaller", () => {
		const pts = rectZonePoints([10, 5], [0, 0]);
		assert.deepEqual(pts, [
			[10, 5],
			[0, 5],
			[0, 0],
			[10, 0],
		]);
	});
});

describe("zoneArea", () => {
	test("computes correct area for a rectangle", () => {
		const zone = { polygon: RECT_POINTS };
		const area = zoneArea(zone);
		assert.equal(area, 50);
	});

	test("computes correct area for a triangle", () => {
		const zone = {
			polygon: [
				[0, 0],
				[10, 0],
				[0, 10],
			],
		};
		assert.equal(zoneArea(zone), 50);
	});

	test("returns non-negative area regardless of vertex winding", () => {
		const clockwiseZone = {
			polygon: [
				[0, 0],
				[0, 10],
				[10, 0],
			],
		};
		assert.equal(zoneArea(clockwiseZone), 50);
	});

	test("returns 0 for degenerate or insufficient points", () => {
		assert.equal(zoneArea({ polygon: [] }), 0);
		assert.equal(
			zoneArea({
				polygon: [
					[0, 0],
					[1, 1],
				],
			}),
			0,
		);
	});
});

describe("pointInZone", () => {
	const concaveZone = { polygon: CONCAVE_POINTS };

	test("returns true for points inside concave polygon arms", () => {
		const insidePoints = [
			[1, 1],
			[3, 1],
			[1, 3],
		];
		for (const pt of insidePoints) {
			assert.equal(pointInZone(concaveZone, pt), true);
		}
	});

	test("returns false for points in concave cavity or outside hull", () => {
		const outsidePoints = [
			[3, 3],
			[5, 5],
			[-1, -1],
		];
		for (const pt of outsidePoints) {
			assert.equal(pointInZone(concaveZone, pt), false);
		}
	});

	test("returns true for points on boundary edges or vertices", () => {
		const boundaryPoints = [
			[2, 2],
			[3, 2],
			[2, 3],
			[0, 0],
		];
		for (const pt of boundaryPoints) {
			assert.equal(pointInZone(concaveZone, pt), true);
		}
	});
});

describe("validateZone", () => {
	test("returns null for a valid zone", () => {
		const zone = {
			netId: "GND",
			layer: "F.Cu",
			polygon: RECT_POINTS,
		};
		assert.equal(validateZone(zone), null);
	});

	test("validates keepout zone without a net as valid", () => {
		const zone = {
			layer: "F.Cu",
			polygon: RECT_POINTS,
			keepout: true,
		};
		assert.equal(validateZone(zone), null);
	});

	test("reports error when points count is fewer than 3", () => {
		const zone = {
			netId: "GND",
			layer: "F.Cu",
			polygon: [
				[0, 0],
				[1, 1],
			],
		};
		const err = validateZone(zone);
		assert.match(err, /points/i);
	});

	test("reports error when polygon has zero area", () => {
		const zone = {
			netId: "GND",
			layer: "F.Cu",
			polygon: [
				[0, 0],
				[5, 0],
				[10, 0],
			],
		};
		const err = validateZone(zone);
		assert.match(err, /zero area/i);
	});

	test("reports error when non-keepout zone is missing net", () => {
		const emptyNetZone = {
			netId: "",
			layer: "F.Cu",
			polygon: RECT_POINTS,
		};
		const missingNetZone = {
			layer: "F.Cu",
			polygon: RECT_POINTS,
		};
		assert.match(validateZone(emptyNetZone), /net/i);
		assert.match(validateZone(missingNetZone), /net/i);
	});

	test("reports error when layer is missing or empty string", () => {
		const emptyLayerZone = {
			netId: "GND",
			layer: "",
			polygon: RECT_POINTS,
		};
		const nonStringLayerZone = {
			netId: "GND",
			layer: 123,
			polygon: RECT_POINTS,
		};
		assert.match(validateZone(emptyLayerZone), /layer/i);
		assert.match(validateZone(nonStringLayerZone), /layer/i);
	});
});
