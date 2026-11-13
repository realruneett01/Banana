import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	posture45,
	togglePosture,
} from "../../frontend/src/editor/trackPosture.js";

// Returns angle in degrees of segment from a to b (multiples of 45 only)
function segAngle(a, b) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function isMultipleOf45(deg) {
	const rounded = Math.round(deg / 45) * 45;
	return Math.abs(deg - rounded) < 1e-9;
}

function checkPath(pts, end) {
	// all segments are multiples of 45 degrees
	for (let i = 0; i < pts.length - 1; i++) {
		const angle = segAngle(pts[i], pts[i + 1]);
		assert.ok(
			isMultipleOf45(angle),
			`segment ${i} angle ${angle} not mult of 45`,
		);
	}
	// path ends at end
	const last = pts[pts.length - 1];
	assert.equal(last[0], end[0]);
	assert.equal(last[1], end[1]);
}

// 8 octants × 2 modes
const OCTANT_CASES = [
	// octant 0: dx>0, dy=0 (east)
	{ start: [0, 0], end: [5, 0] },
	// octant 1: dx>dy>0 (ENE)
	{ start: [0, 0], end: [5, 2] },
	// octant 2: dx=dy>0 (NE diagonal)
	{ start: [0, 0], end: [4, 4] },
	// octant 3: dy>dx>0 (NNE)
	{ start: [0, 0], end: [2, 5] },
	// octant 4: dx=0, dy>0 (north)
	{ start: [0, 0], end: [0, 5] },
	// octant 5: dx<0, dy>0, |dx|<dy (NNW)
	{ start: [0, 0], end: [-2, 5] },
	// octant 6: dx<0, dy>0, |dx|>dy (WNW)
	{ start: [0, 0], end: [-5, 2] },
	// octant 7: dx<0, dy=0 (west)
	{ start: [0, 0], end: [-5, 0] },
];

describe("posture45 - 8 octants straight-first", () => {
	for (const { start, end } of OCTANT_CASES) {
		test(`straight-first (${start})->(${end})`, () => {
			const pts = posture45(start, end, "straight-first");
			checkPath(pts, end);
		});
	}
});

describe("posture45 - 8 octants diagonal-first", () => {
	for (const { start, end } of OCTANT_CASES) {
		test(`diagonal-first (${start})->(${end})`, () => {
			const pts = posture45(start, end, "diagonal-first");
			checkPath(pts, end);
		});
	}
});

describe("posture45 - pure H/V/45 cases return 2 points", () => {
	const ALIGNED = [
		{ start: [0, 0], end: [10, 0] },
		{ start: [0, 0], end: [0, 7] },
		{ start: [0, 0], end: [6, 6] },
		{ start: [0, 0], end: [-3, 3] },
	];
	for (const { start, end } of ALIGNED) {
		for (const mode of ["straight-first", "diagonal-first"]) {
			test(`${mode} (${start})->(${end})`, () => {
				const pts = posture45(start, end, mode);
				assert.equal(pts.length, 2);
				assert.deepEqual(pts[0], start);
				assert.deepEqual(pts[1], end);
			});
		}
	}
});

describe("posture45 - zero-length", () => {
	test("start equals end returns 2-point path", () => {
		const pts = posture45([3, 4], [3, 4]);
		assert.equal(pts.length, 2);
		assert.deepEqual(pts[0], [3, 4]);
		assert.deepEqual(pts[1], [3, 4]);
	});
});

describe("posture45 - mode corner placement", () => {
	// start [0,0] end [5,2]: dx=5 dy=2, adx>ady
	// straight-first: H leg first => corner at (5-2, 0) = (3, 0)
	// diagonal-first: diag leg first => corner at (0+2, 2) = (2, 2)
	test("straight-first corner on start row", () => {
		const pts = posture45([0, 0], [5, 2], "straight-first");
		assert.equal(pts.length, 3);
		assert.deepEqual(pts[1], [3, 0]);
	});

	test("diagonal-first corner on end row", () => {
		const pts = posture45([0, 0], [5, 2], "diagonal-first");
		assert.equal(pts.length, 3);
		assert.deepEqual(pts[1], [2, 2]);
	});

	// start [0,0] end [2,5]: dy>dx
	// straight-first: V leg first => corner at (0, 5-2) = (0, 3)
	// diagonal-first: diag leg first => corner at (2, 0+2) = (2, 2)
	test("straight-first ady>adx corner on start col", () => {
		const pts = posture45([0, 0], [2, 5], "straight-first");
		assert.equal(pts.length, 3);
		assert.deepEqual(pts[1], [0, 3]);
	});

	test("diagonal-first ady>adx corner on end col", () => {
		const pts = posture45([0, 0], [2, 5], "diagonal-first");
		assert.equal(pts.length, 3);
		assert.deepEqual(pts[1], [2, 2]);
	});
});

describe("togglePosture", () => {
	test("straight-first -> diagonal-first", () => {
		assert.equal(togglePosture("straight-first"), "diagonal-first");
	});
	test("diagonal-first -> straight-first", () => {
		assert.equal(togglePosture("diagonal-first"), "straight-first");
	});
});
