import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { constrainAngle } from "../../frontend/src/editor/routingModel.js";
import {
	legPoints,
	proposePostureRoute,
	togglePosture,
} from "../../frontend/src/editor/trackPosture.js";

const START = [0, 0];
const TARGET = [10, 4];
const STRAIGHT_CORNER = [6, 0];
const DIAGONAL_CORNER = [4, 4];

describe("legPoints", () => {
	test("45 mode straight-first gives the constrainAngle corner", () => {
		const legs = legPoints(START, TARGET, "45", "straight-first");
		assert.deepEqual(legs, [STRAIGHT_CORNER, TARGET]);
		assert.deepEqual(legs, constrainAngle(START, TARGET, "45"));
	});

	test("45 mode after togglePosture gives the other parallelogram corner", () => {
		const posture = togglePosture("straight-first");
		assert.equal(posture, "diagonal-first");
		const legs = legPoints(START, TARGET, "45", posture);
		assert.deepEqual(legs, [DIAGONAL_CORNER, TARGET]);
	});

	test("45 mode straight line has no corner", () => {
		const legs = legPoints(START, [5, 5], "45", "diagonal-first");
		assert.deepEqual(legs, [[5, 5]]);
	});

	const passThrough = [
		["90", "straight-first"],
		["90", "diagonal-first"],
		["free", "diagonal-first"],
	];
	for (const [mode, posture] of passThrough) {
		test(`${mode} mode equals constrainAngle (${posture})`, () => {
			const expected = constrainAngle(START, TARGET, mode);
			assert.deepEqual(legPoints(START, TARGET, mode, posture), expected);
		});
	}
});

const BLOCKER = {
	netId: "GND",
	layer: "F.Cu",
	widthMm: 0.25,
	start: [1, 3],
	end: [3, 1],
};

function propose(posture) {
	const options = {
		start: START,
		cursor: TARGET,
		layer: "F.Cu",
		widthMm: 0.25,
		clearanceMm: 0.2,
		board: { tracks: [BLOCKER] },
		netId: "SIG",
		mode: "45",
	};
	return proposePostureRoute(options, posture);
}

describe("proposePostureRoute", () => {
	const cases = [
		["straight-first", STRAIGHT_CORNER, []],
		["diagonal-first", DIAGONAL_CORNER, [0]],
	];
	for (const [posture, corner, hitSegments] of cases) {
		test(`${posture}: preview path and collisions follow the posture`, () => {
			const { points, collisions } = propose(posture);
			assert.deepEqual(points, [START, corner, TARGET]);
			const segments = collisions.map((c) => c.segmentIndex);
			assert.deepEqual(segments, hitSegments);
		});
	}
});

describe("PcbCanvas wiring", () => {
	const src = readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	);
	const calls = (name) => new RegExp(`\\b${name}\\(`).test(src);
	const expectedCalls = {
		constrainAngle: false,
		proposeRoute: false,
		legPoints: true,
		proposePostureRoute: true,
		togglePosture: true,
	};

	for (const [name, expected] of Object.entries(expectedCalls)) {
		test(`PcbCanvas ${expected ? "calls" : "never calls"} ${name}`, () => {
			assert.equal(calls(name), expected);
		});
	}

	test("status bar shows the posture next to the angle", () => {
		assert.match(src.replace(/\s+/g, " "), /routeMode\}° \{posture\}/);
	});
});
