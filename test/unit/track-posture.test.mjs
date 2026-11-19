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
	for (let i = 0; i < pts.length - 1; i++) {
		const angle = segAngle(pts[i], pts[i + 1]);
		assert.ok(
			isMultipleOf45(angle),
			`segment ${i} angle ${angle} not mult of 45`,
		);
	}
	const last = pts[pts.length - 1];
	assert.equal(last[0], end[0]);
	assert.equal(last[1], end[1]);
}

function assertTwoPointPath(pts, start, end) {
	assert.equal(pts.length, 2);
	assert.deepEqual(pts[0], start);
	assert.deepEqual(pts[1], end);
}

function assertCornerPlacement(pts, expectedCorner) {
	assert.equal(pts.length, 3);
	assert.deepEqual(pts[1], expectedCorner);
}

// 8 octants × 2 modes
const OCTANT_CASES = [
	{ start: [0, 0], end: [5, 0] },
	{ start: [0, 0], end: [5, 2] },
	{ start: [0, 0], end: [4, 4] },
	{ start: [0, 0], end: [2, 5] },
	{ start: [0, 0], end: [0, 5] },
	{ start: [0, 0], end: [-2, 5] },
	{ start: [0, 0], end: [-5, 2] },
	{ start: [0, 0], end: [-5, 0] },
];

for (const mode of ["straight-first", "diagonal-first"]) {
	describe(`posture45 - 8 octants ${mode}`, () => {
		for (const { start, end } of OCTANT_CASES) {
			test(`${mode} (${start})->(${end})`, () => {
				checkPath(posture45(start, end, mode), end);
			});
		}
	});
}

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
				assertTwoPointPath(posture45(start, end, mode), start, end);
			});
		}
	}
});

describe("posture45 - zero-length", () => {
	test("start equals end returns 2-point path", () => {
		const origin = [3, 4];
		assertTwoPointPath(posture45(origin, origin), origin, origin);
	});
});

describe("posture45 - mode corner placement", () => {
	const CORNER_CASES = [
		["straight-first corner on start row", [5, 2], "straight-first", [3, 0]],
		["diagonal-first corner on end row", [5, 2], "diagonal-first", [2, 2]],
		[
			"straight-first ady>adx corner on start col",
			[2, 5],
			"straight-first",
			[0, 3],
		],
		[
			"diagonal-first ady>adx corner on end col",
			[2, 5],
			"diagonal-first",
			[2, 2],
		],
	];

	for (const [name, end, mode, corner] of CORNER_CASES) {
		test(name, () => {
			assertCornerPlacement(posture45([0, 0], end, mode), corner);
		});
	}
});

describe("togglePosture", () => {
	const TRANSITIONS = [
		["straight-first", "diagonal-first"],
		["diagonal-first", "straight-first"],
	];
	for (const [from, to] of TRANSITIONS) {
		test(`${from} -> ${to}`, () => {
			assert.equal(togglePosture(from), to);
		});
	}
});
