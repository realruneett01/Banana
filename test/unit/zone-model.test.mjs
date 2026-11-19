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

function makeFrozenBoard(polygon) {
	return Object.freeze({
		zones: Object.freeze([
			Object.freeze({
				netId: "GND",
				layer: "F.Cu",
				polygon: Object.freeze(polygon),
			}),
		]),
	});
}

function verifyZoneCounts(beforeBoard, afterBoard, expectedCount) {
	assert.equal(beforeBoard.zones.length, 1);
	assert.equal(afterBoard.zones.length, expectedCount);
}

function verifyAddZoneRejected(pointSets) {
	const currentBoard = makeSampleBoard();
	for (const points of pointSets) {
		assert.equal(
			addZone(currentBoard, { netId: "GND", layer: "F.Cu", points }),
			currentBoard,
		);
	}
}

function verifyRemoveNoop(index) {
	const sample = makeSampleBoard();
	assert.equal(removeZone(sample, index), sample);
}

function verifyMoveNoop(zoneIndex, pointIndex, coords) {
	const targetBoard = makeSampleBoard();
	assert.equal(
		moveZonePoint(targetBoard, zoneIndex, pointIndex, coords),
		targetBoard,
	);
}

function verifyRectCorners(start, end, expectedCorners) {
	assert.deepEqual(rectZonePoints(start, end), expectedCorners);
}

function verifyZoneArea(points, expected) {
	assert.equal(zoneArea({ polygon: points }), expected);
}

function verifyPointsContainment(zone, points, expected) {
	for (const pt of points) {
		assert.equal(pointInZone(zone, pt), expected);
	}
}

function verifyZoneValid(zoneSpec) {
	assert.equal(validateZone(zoneSpec), null);
}

function verifyZoneValidation(targets, errorPattern) {
	const list = Array.isArray(targets) ? targets : [targets];
	for (const target of list) {
		assert.match(validateZone(target), errorPattern);
	}
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
		assert.equal(result.zones[0].netId, "");
		assert.equal(result.zones[0].keepout, true);
		assert.equal(result.zones.length, 1);
	});

	test("rejects point lists with fewer than 3 points", () => {
		verifyAddZoneRejected([
			[],
			[[0, 0]],
			[
				[0, 0],
				[1, 1],
			],
			null,
			undefined,
		]);
	});

	test("rejects point lists containing non-finite coordinates", () => {
		verifyAddZoneRejected([
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
		]);
	});

	test("does not mutate inputs", () => {
		const board = makeFrozenBoard([
			[0, 0],
			[1, 0],
			[1, 1],
		]);
		const points = Object.freeze([
			[0, 0],
			[10, 0],
			[10, 10],
		]);
		const opts = Object.freeze({ netId: "SIG", layer: "F.Cu", points });
		const result = addZone(board, opts);
		verifyZoneCounts(board, result, 2);
	});
});

describe("removeZone", () => {
	test("removes zone at valid index", () => {
		const initialBoard = {
			zones: [
				{ netId: "GND", layer: "F.Cu", polygon: RECT_POINTS },
				{ netId: "VCC", layer: "B.Cu", polygon: RECT_POINTS },
			],
		};
		const result = removeZone(initialBoard, 0);
		assert.equal(result.zones[0].netId, "VCC");
		assert.equal(result.zones.length, 1);
		assert.notEqual(result, initialBoard);
	});

	test("returns board unchanged when index is negative", () => {
		verifyRemoveNoop(-1);
	});

	test("returns board unchanged when index is out of bounds", () => {
		verifyRemoveNoop(99);
	});

	test("does not mutate input board", () => {
		const board = makeFrozenBoard(RECT_POINTS);
		const result = removeZone(board, 0);
		verifyZoneCounts(board, result, 0);
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
		verifyMoveNoop(5, 0, [10, 10]);
	});

	test("returns board unchanged when point index is invalid", () => {
		verifyMoveNoop(0, -1, [10, 10]);
		verifyMoveNoop(0, 99, [10, 10]);
	});

	test("returns board unchanged when coordinates are non-finite", () => {
		const badCoords = [[NaN, 0], [0, Infinity], "invalid", [1]];
		for (const coords of badCoords) {
			verifyMoveNoop(0, 0, coords);
		}
	});

	test("does not mutate input board", () => {
		const initialPt = Object.freeze([0, 0]);
		const board = makeFrozenBoard([initialPt, [5, 0], [5, 5]]);
		const result = moveZonePoint(board, 0, 0, [2, 2]);
		assert.deepEqual(board.zones[0].polygon[0], [0, 0]);
		assert.deepEqual(result.zones[0].polygon[0], [2, 2]);
	});
});

describe("rectZonePoints", () => {
	test("returns 4 corner points in drawing order", () => {
		verifyRectCorners(
			[0, 0],
			[10, 5],
			[
				[0, 0],
				[10, 0],
				[10, 5],
				[0, 5],
			],
		);
	});

	test("preserves drawing order when second point is smaller", () => {
		verifyRectCorners(
			[10, 5],
			[0, 0],
			[
				[10, 5],
				[0, 5],
				[0, 0],
				[10, 0],
			],
		);
	});
});

describe("zoneArea", () => {
	test("computes correct area for a rectangle", () => {
		verifyZoneArea(RECT_POINTS, 50);
	});

	test("computes correct area for a triangle", () => {
		verifyZoneArea(
			[
				[0, 0],
				[10, 0],
				[0, 10],
			],
			50,
		);
	});

	test("returns non-negative area regardless of vertex winding", () => {
		verifyZoneArea(
			[
				[0, 0],
				[0, 10],
				[10, 0],
			],
			50,
		);
	});

	test("returns 0 for degenerate or insufficient points", () => {
		verifyZoneArea([], 0);
		verifyZoneArea(
			[
				[0, 0],
				[1, 1],
			],
			0,
		);
	});
});

describe("pointInZone", () => {
	const concaveZone = { polygon: CONCAVE_POINTS };

	test("returns true for points inside concave polygon arms", () => {
		verifyPointsContainment(
			concaveZone,
			[
				[1, 1],
				[3, 1],
				[1, 3],
			],
			true,
		);
	});

	test("returns false for points in concave cavity or outside hull", () => {
		verifyPointsContainment(
			concaveZone,
			[
				[3, 3],
				[5, 5],
				[-1, -1],
			],
			false,
		);
	});

	test("returns true for points on boundary edges or vertices", () => {
		verifyPointsContainment(
			concaveZone,
			[
				[2, 2],
				[3, 2],
				[2, 3],
				[0, 0],
			],
			true,
		);
	});
});

describe("validateZone", () => {
	test("returns null for a valid zone", () => {
		verifyZoneValid({
			netId: "GND",
			layer: "F.Cu",
			polygon: RECT_POINTS,
		});
	});

	test("validates keepout zone without a net as valid", () => {
		verifyZoneValid({
			layer: "F.Cu",
			polygon: RECT_POINTS,
			keepout: true,
		});
	});

	test("reports error when points count is fewer than 3", () => {
		verifyZoneValidation(
			{
				netId: "GND",
				layer: "F.Cu",
				polygon: [
					[0, 0],
					[1, 1],
				],
			},
			/points/i,
		);
	});

	test("reports error when polygon has zero area", () => {
		verifyZoneValidation(
			{
				netId: "GND",
				layer: "F.Cu",
				polygon: [
					[0, 0],
					[5, 0],
					[10, 0],
				],
			},
			/zero area/i,
		);
	});

	test("reports error when non-keepout zone is missing net", () => {
		verifyZoneValidation(
			[
				{ netId: "", layer: "F.Cu", polygon: RECT_POINTS },
				{ layer: "F.Cu", polygon: RECT_POINTS },
			],
			/net/i,
		);
	});

	test("reports error when layer is missing or empty string", () => {
		verifyZoneValidation(
			[
				{ netId: "GND", layer: "", polygon: RECT_POINTS },
				{ netId: "GND", layer: 123, polygon: RECT_POINTS },
			],
			/layer/i,
		);
	});
});
