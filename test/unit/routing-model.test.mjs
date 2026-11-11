import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	addVia,
	buildSegmentIndex,
	constrainAngle,
	proposeRoute,
	segmentClearance,
	WIDTH_PRESETS,
} from "../../frontend/src/editor/routingModel.js";

describe("routingModel - constrainAngle", () => {
	test("returns direct target when already orthogonal or 45 degrees in 45 mode", () => {
		assert.deepEqual(constrainAngle([0, 0], [10, 0], "45"), [[10, 0]]);
		assert.deepEqual(constrainAngle([0, 0], [0, 10], "45"), [[0, 10]]);
		assert.deepEqual(constrainAngle([0, 0], [10, 10], "45"), [[10, 10]]);
		assert.deepEqual(constrainAngle([0, 0], [-10, 10], "45"), [[-10, 10]]);
	});

	test("calculates 45-degree dogleg when absX > absY or absY > absX", () => {
		// absX (10) > absY (4): corner moves 6 mm along X, then 4 mm at 45 deg
		const ptsX = constrainAngle([0, 0], [10, 4], "45");
		assert.deepEqual(ptsX, [
			[6, 0],
			[10, 4],
		]);

		// absY (10) > absX (3): corner moves 7 mm along Y, then 3 mm at 45 deg
		const ptsY = constrainAngle([0, 0], [3, 10], "45");
		assert.deepEqual(ptsY, [
			[0, 7],
			[3, 10],
		]);
	});

	test("mode 90 produces orthogonal corner", () => {
		assert.deepEqual(constrainAngle([0, 0], [10, 0], "90"), [[10, 0]]);
		assert.deepEqual(constrainAngle([0, 0], [0, 10], "90"), [[0, 10]]);
		assert.deepEqual(constrainAngle([0, 0], [10, 5], "90"), [
			[10, 0],
			[10, 5],
		]);
		assert.deepEqual(constrainAngle([0, 0], [4, 8], "90"), [
			[0, 8],
			[4, 8],
		]);
	});

	test("accepts point objects with x and y", () => {
		const pts = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 0 });
		assert.deepEqual(pts, [[10, 0]]);
	});
});

describe("routingModel - segmentClearance", () => {
	test("detects collision when tracks are too close", () => {
		const seg = { start: [0, 0], end: [10, 0], widthMm: 0.25 };
		const others = [
			{ start: [0, 0.35], end: [10, 0.35], widthMm: 0.25 }, // center dist 0.35, gap = 0.35 - 0.25 = 0.10 mm < 0.2 mm
		];
		const res = segmentClearance(seg, others, 0.25, 0.2);
		assert.equal(res.ok, false);
		assert.ok(res.worst);
		assert.equal(res.worst.otherIndex, 0);
		assert.equal(res.worst.gapMm, 0.1);
	});

	test("returns ok when clearance requirement is met", () => {
		const seg = { start: [0, 0], end: [10, 0], widthMm: 0.25 };
		const others = [{ start: [0, 5], end: [10, 5], widthMm: 0.25 }];
		const res = segmentClearance(seg, others, 0.25, 0.2);
		assert.equal(res.ok, true);
		assert.equal(res.worst, null);
	});

	test("selects the worst offender among multiple colliding tracks", () => {
		const seg = { start: [0, 0], end: [10, 0], widthMm: 0.25 };
		const others = [
			{ start: [0, 0.4], end: [10, 0.4], widthMm: 0.25 }, // gap 0.15
			{ start: [0, 0.3], end: [10, 0.3], widthMm: 0.25 }, // gap 0.05
		];
		const res = segmentClearance(seg, others, 0.25, 0.2);
		assert.equal(res.ok, false);
		assert.equal(res.worst.otherIndex, 1);
		assert.equal(res.worst.gapMm, 0.05);
	});
});

function createSeededLcg(seed = 123456789) {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(1664525, s) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function bruteForceCheck(seg, segments, widthMm, clearanceMm) {
	const allIndices = segments.map((_, i) => i);
	const mockIndex = {
		_isIndex: true,
		segments,
		query: () => allIndices,
	};
	return segmentClearance(seg, mockIndex, widthMm, clearanceMm);
}

describe("routingModel - index vs brute force", () => {
	test("index finds same results as brute force on a seeded 200-segment board", () => {
		const rand = createSeededLcg(42);
		const segments = [];
		for (let i = 0; i < 200; i++) {
			const x1 = rand() * 100;
			const y1 = rand() * 100;
			const len = 2 + rand() * 15;
			const angle = (Math.floor(rand() * 8) * Math.PI) / 4;
			const x2 = x1 + Math.cos(angle) * len;
			const y2 = y1 + Math.sin(angle) * len;
			segments.push({
				start: [x1, y1],
				end: [x2, y2],
				widthMm: 0.25,
				netId: `net_${i % 10}`,
				layer: "F.Cu",
			});
		}

		const index = buildSegmentIndex(segments, 4.0);
		const testSegments = [
			{ start: [10, 10], end: [20, 20], widthMm: 0.25 },
			{ start: [50, 50], end: [50, 70], widthMm: 0.25 },
			{ start: [0, 0], end: [5, 0], widthMm: 0.25 },
			{ start: [80, 20], end: [90, 30], widthMm: 0.5 },
			{ start: [30, 40], end: [40, 40], widthMm: 0.25 },
		];

		for (const testSeg of testSegments) {
			const indexRes = segmentClearance(testSeg, index, 0.25, 0.2);
			const bruteRes = bruteForceCheck(testSeg, segments, 0.25, 0.2);
			assert.equal(indexRes.ok, bruteRes.ok);
			if (!indexRes.ok) {
				assert.equal(indexRes.worst.otherIndex, bruteRes.worst.otherIndex);
				assert.equal(indexRes.worst.gapMm, bruteRes.worst.gapMm);
			}
		}
	});
});

describe("routingModel - addVia", () => {
	test("is pure and creates via with defaults", () => {
		const board = Object.freeze({
			tracks: [],
			vias: Object.freeze([{ at: [5, 5], netId: "GND" }]),
		});

		const nextBoard = addVia(board, { at: [10, 20], netId: "VCC" });
		assert.notEqual(board, nextBoard);
		assert.equal(board.vias.length, 1);
		assert.equal(nextBoard.vias.length, 2);
		assert.deepEqual(nextBoard.vias[1], {
			at: [10, 20],
			netId: "VCC",
			drillMm: 0.3,
			sizeMm: 0.6,
		});
	});
});

describe("routingModel - proposeRoute", () => {
	test("proposes 45-degree route points and detects collision only against other nets", () => {
		const board = {
			tracks: [
				{
					start: [0, 1],
					end: [20, 1],
					layer: "F.Cu",
					netId: "GND",
					widthMm: 0.25,
				},
				{
					start: [0, 5],
					end: [20, 5],
					layer: "F.Cu",
					netId: "VCC",
					widthMm: 0.25,
				},
				{
					start: [0, 1],
					end: [20, 1],
					layer: "B.Cu",
					netId: "GND",
					widthMm: 0.25,
				},
			],
		};

		// Routing on F.Cu with netId "GND" near the GND track: same net, so no collision!
		const resSameNet = proposeRoute({
			start: [0, 1.2],
			cursor: [20, 1.2],
			layer: "F.Cu",
			widthMm: 0.25,
			clearanceMm: 0.2,
			board,
			netId: "GND",
		});
		assert.equal(resSameNet.collisions.length, 0);

		// Routing on F.Cu with netId "SIG1" near the GND track: different net -> collision!
		const resDiffNet = proposeRoute({
			start: [0, 1.2],
			cursor: [20, 1.2],
			layer: "F.Cu",
			widthMm: 0.25,
			clearanceMm: 0.2,
			board,
			netId: "SIG1",
		});
		assert.equal(resDiffNet.collisions.length, 1);
		assert.equal(resDiffNet.collisions[0].otherNetId, "GND");
		assert.ok(resDiffNet.collisions[0].message.includes("Too close to GND"));
	});
});

describe("routingModel - WIDTH_PRESETS", () => {
	test("contains standard presets with current capacity hints", () => {
		assert.equal(WIDTH_PRESETS.length, 3);
		assert.equal(WIDTH_PRESETS[0].label, "Signal 0.25 mm");
		assert.equal(WIDTH_PRESETS[0].mm, 0.25);
		assert.equal(WIDTH_PRESETS[1].label, "Power 0.5 mm");
		assert.equal(WIDTH_PRESETS[1].mm, 0.5);
		assert.equal(WIDTH_PRESETS[2].label, "High current 1.0 mm");
		assert.equal(WIDTH_PRESETS[2].mm, 1.0);
		for (const p of WIDTH_PRESETS) {
			assert.ok(p.hint && p.hint.length > 0);
		}
	});
});
