import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	trackKey,
	trackLength,
} from "../../frontend/src/editor/pcbGeometry.js";
import { proposeRoute } from "../../frontend/src/editor/routingModel.js";

// Shallow arc from (0, 0) to (10, 0) bulging down to y = -2 at x = 5.
const ARC = Object.freeze({
	start: [0, 0],
	mid: [5, -2],
	end: [10, 0],
	layer: "F.Cu",
	widthMm: 0.25,
	netId: "GND",
});

const withArc = (patch) => (patch ? { ...ARC, ...patch } : ARC);

function routeTrack(start, cursor, track = ARC) {
	return proposeRoute({
		start,
		cursor,
		board: { tracks: [track] },
		netId: "VCC",
	});
}

function assertCollisionHit(collisions, expectedNetId, expectedGapMm) {
	const [hit] = collisions;
	assert.deepEqual(
		{
			count: collisions.length,
			otherNetId: hit?.otherNetId,
			gapMm: hit?.gapMm,
		},
		{ count: 1, otherNetId: expectedNetId, gapMm: expectedGapMm },
	);
}

function makeArcSegment(start, mid, end) {
	return { start, mid, end };
}

function assertApproxLength(track, expected) {
	assert.ok(Math.abs(trackLength(track) - expected) < 1e-6);
}

describe("proposeRoute with arc tracks", () => {
	test("a segment through the arc bulge collides", () => {
		const { collisions } = routeTrack([5, -4], [5, -1.5]);
		assertCollisionHit(collisions, "GND", 0);
	});

	test("a segment crossing only the chord region does not collide", () => {
		const { collisions } = routeTrack([4, 0.1], [6, 0.1]);
		assert.deepEqual(collisions, []);
	});

	test("a segment just outside the bulge reports the true arc gap", () => {
		const { collisions } = routeTrack([3, -2.3], [7, -2.3]);
		assert.equal(collisions.length, 1);
		assert.ok(collisions[0].gapMm > 0 && collisions[0].gapMm < 0.2);
	});

	test("straight tracks keep segment clearance", () => {
		const straight = withArc({ mid: undefined });
		const res = routeTrack([4, 0.1], [6, 0.1], straight);
		assert.equal(res.collisions.length, 1);
	});
});

describe("trackLength of arcs", () => {
	test("quarter circle r=10 is about 15.708", () => {
		const m = 10 * Math.SQRT1_2;
		assertApproxLength(makeArcSegment([10, 0], [m, m], [0, 10]), 5 * Math.PI);
	});

	test("major arc is measured the long way round", () => {
		assertApproxLength(
			makeArcSegment([10, 0], [-10, 0], [0, 10]),
			15 * Math.PI,
		);
	});

	test("collinear mid falls back to chord length", () => {
		assert.equal(trackLength(makeArcSegment([0, 0], [1, 0], [3, 0])), 3);
	});
});

describe("trackKey", () => {
	test("two arcs sharing endpoints get distinct keys", () => {
		const a = withArc();
		const b = withArc({ mid: [5, 2] });
		assert.notEqual(trackKey(a, 0), trackKey(b, 1));
	});

	test("uses uuid when present", () => {
		const a = withArc({ uuid: "u-1" });
		assert.equal(trackKey(a, 0), trackKey(a, 5));
		assert.notEqual(trackKey(a, 0), trackKey(withArc({ uuid: "u-2" }), 0));
	});
});
