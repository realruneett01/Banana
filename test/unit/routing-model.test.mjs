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

function checkAngleRoutes(mode, cases) {
	for (const { target, expected } of cases) {
		assert.deepEqual(constrainAngle([0, 0], target, mode), expected);
	}
}

const CONSTRAIN_ANGLE_CASES = [
	{
		title:
			"returns direct target when already orthogonal or 45 degrees in 45 mode",
		mode: "45",
		cases: [
			{ target: [10, 0], expected: [[10, 0]] },
			{ target: [0, 10], expected: [[0, 10]] },
			{ target: [10, 10], expected: [[10, 10]] },
			{ target: [-10, 10], expected: [[-10, 10]] },
		],
	},
	{
		title: "calculates 45-degree dogleg when absX > absY or absY > absX",
		mode: "45",
		cases: [
			{
				target: [10, 4],
				expected: [
					[6, 0],
					[10, 4],
				],
			},
			{
				target: [3, 10],
				expected: [
					[0, 7],
					[3, 10],
				],
			},
		],
	},
	{
		title: "mode 90 produces orthogonal corner",
		mode: "90",
		cases: [
			{ target: [10, 0], expected: [[10, 0]] },
			{ target: [0, 10], expected: [[0, 10]] },
			{
				target: [10, 5],
				expected: [
					[10, 0],
					[10, 5],
				],
			},
			{
				target: [4, 8],
				expected: [
					[0, 8],
					[4, 8],
				],
			},
		],
	},
];

describe("routingModel - constrainAngle", () => {
	for (const { title, mode, cases } of CONSTRAIN_ANGLE_CASES) {
		test(title, () => {
			checkAngleRoutes(mode, cases);
		});
	}

	test("accepts point objects with x and y", () => {
		const pts = constrainAngle({ x: 0, y: 0 }, { x: 10, y: 0 });
		assert.deepEqual(pts, [[10, 0]]);
	});
});

const makeSeg = (y = 0) => ({ start: [0, y], end: [10, y], widthMm: 0.25 });

function verifyClearanceResult(res, expected) {
	assert.equal(res.ok, expected.ok);
	if (expected.ok) {
		assert.equal(res.worst, null);
		return;
	}
	assert.ok(res.worst);
	assert.equal(res.worst.otherIndex, expected.otherIndex);
	assert.equal(res.worst.gapMm, expected.gapMm);
}

const CLEARANCE_CASES = [
	{
		title: "detects collision when tracks are too close",
		// center dist 0.35, gap = 0.35 - 0.25 = 0.10 mm < 0.2 mm
		others: [makeSeg(0.35)],
		expected: { ok: false, otherIndex: 0, gapMm: 0.1 },
	},
	{
		title: "returns ok when clearance requirement is met",
		others: [makeSeg(5)],
		expected: { ok: true },
	},
	{
		title: "selects the worst offender among multiple colliding tracks",
		// gap 0.15 vs gap 0.05
		others: [makeSeg(0.4), makeSeg(0.3)],
		expected: { ok: false, otherIndex: 1, gapMm: 0.05 },
	},
];

describe("routingModel - segmentClearance", () => {
	for (const { title, others, expected } of CLEARANCE_CASES) {
		test(title, () => {
			const res = segmentClearance(makeSeg(0), others, 0.25, 0.2);
			verifyClearanceResult(res, expected);
		});
	}
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

function generateRandomSegments(count, seed) {
	const rand = createSeededLcg(seed);
	const segments = [];
	for (let i = 0; i < count; i++) {
		const x1 = rand() * 100;
		const y1 = rand() * 100;
		const len = 2 + rand() * 15;
		const angle = (Math.floor(rand() * 8) * Math.PI) / 4;
		segments.push({
			start: [x1, y1],
			end: [x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len],
			widthMm: 0.25,
			netId: `net_${i % 10}`,
			layer: "F.Cu",
		});
	}
	return segments;
}

function assertClearanceMatches(indexRes, bruteRes) {
	assert.equal(indexRes.ok, bruteRes.ok);
	if (!indexRes.ok) {
		assert.equal(indexRes.worst.otherIndex, bruteRes.worst.otherIndex);
		assert.equal(indexRes.worst.gapMm, bruteRes.worst.gapMm);
	}
}

const BENCHMARK_TEST_SEGMENTS = [
	{ start: [10, 10], end: [20, 20], widthMm: 0.25 },
	{ start: [50, 50], end: [50, 70], widthMm: 0.25 },
	{ start: [0, 0], end: [5, 0], widthMm: 0.25 },
	{ start: [80, 20], end: [90, 30], widthMm: 0.5 },
	{ start: [30, 40], end: [40, 40], widthMm: 0.25 },
];

describe("routingModel - index vs brute force", () => {
	test("index finds same results as brute force on a seeded 200-segment board", () => {
		const segments = generateRandomSegments(200, 42);
		const index = buildSegmentIndex(segments, 4.0);

		for (const testSeg of BENCHMARK_TEST_SEGMENTS) {
			const indexRes = segmentClearance(testSeg, index, 0.25, 0.2);
			const bruteRes = bruteForceCheck(testSeg, segments, 0.25, 0.2);
			assertClearanceMatches(indexRes, bruteRes);
		}
	});
});

function verifyImmutableViaAddition(initialBoard, updatedBoard, expectedVia) {
	assert.ok(initialBoard !== updatedBoard);
	assert.deepEqual(
		{
			initialCount: initialBoard.vias.length,
			updatedCount: updatedBoard.vias.length,
			newVia: updatedBoard.vias[1],
		},
		{
			initialCount: 1,
			updatedCount: 2,
			newVia: expectedVia,
		},
	);
}

describe("routingModel - addVia", () => {
	test("is pure and creates via with defaults", () => {
		const board = Object.freeze({
			tracks: [],
			vias: Object.freeze([{ at: [5, 5], netId: "GND" }]),
		});

		const nextBoard = addVia(board, { at: [10, 20], netId: "VCC" });
		verifyImmutableViaAddition(board, nextBoard, {
			at: [10, 20],
			netId: "VCC",
			drillMm: 0.3,
			sizeMm: 0.6,
		});
	});
});

const makeTrack = (y, netId, layer = "F.Cu") => ({
	start: [0, y],
	end: [20, y],
	layer,
	netId,
	widthMm: 0.25,
});

function runPropose(board, netId) {
	return proposeRoute({
		start: [0, 1.2],
		cursor: [20, 1.2],
		layer: "F.Cu",
		widthMm: 0.25,
		clearanceMm: 0.2,
		board,
		netId,
	});
}

const makeSampleBoard = () => ({
	tracks: [
		makeTrack(1, "GND"),
		makeTrack(5, "VCC"),
		makeTrack(1, "GND", "B.Cu"),
	],
});

function verifyRouteCollisions(collisions, expectedList) {
	assert.equal(collisions.length, expectedList.length);
	for (let i = 0; i < expectedList.length; i++) {
		const act = collisions[i];
		const exp = expectedList[i];
		assert.equal(act.otherNetId, exp.netId);
		assert.ok(act.message.includes(exp.text));
	}
}

describe("routingModel - proposeRoute", () => {
	test("proposes 45-degree route points and detects collision only against other nets", () => {
		const board = makeSampleBoard();

		// Routing on F.Cu with netId "GND" near the GND track: same net, so no collision!
		const resSameNet = runPropose(board, "GND");
		verifyRouteCollisions(resSameNet.collisions, []);

		// Routing on F.Cu with netId "SIG1" near the GND track: different net -> collision!
		const resDiffNet = runPropose(board, "SIG1");
		verifyRouteCollisions(resDiffNet.collisions, [
			{ netId: "GND", text: "Too close to GND" },
		]);
	});
});

const EXPECTED_WIDTH_PRESETS = [
	{ label: "Signal 0.25 mm", mm: 0.25 },
	{ label: "Power 0.5 mm", mm: 0.5 },
	{ label: "High current 1.0 mm", mm: 1.0 },
];

describe("routingModel - WIDTH_PRESETS", () => {
	test("contains standard presets with current capacity hints", () => {
		assert.equal(WIDTH_PRESETS.length, EXPECTED_WIDTH_PRESETS.length);
		const presets = WIDTH_PRESETS.map((p) => ({ label: p.label, mm: p.mm }));
		assert.deepEqual(presets, EXPECTED_WIDTH_PRESETS);
		for (const preset of WIDTH_PRESETS) {
			assert.equal(typeof preset.hint, "string");
			assert.ok(preset.hint.length > 0);
		}
	});
});
