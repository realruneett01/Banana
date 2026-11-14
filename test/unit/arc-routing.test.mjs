import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	trackKey,
	trackLength,
} from "../../frontend/src/editor/pcbGeometry.js";
import { proposeRoute } from "../../frontend/src/editor/routingModel.js";

// Shallow arc from (0, 0) to (10, 0) bulging down to y = -2 at x = 5.
const ARC = {
	start: [0, 0],
	mid: [5, -2],
	end: [10, 0],
	layer: "F.Cu",
	widthMm: 0.25,
	netId: "GND",
};
const board = { tracks: [ARC] };

function route(start, cursor) {
	return proposeRoute({ start, cursor, board, netId: "VCC" });
}

describe("proposeRoute with arc tracks", () => {
	test("a segment through the arc bulge collides", () => {
		const { collisions } = route([5, -4], [5, -1.5]);
		assert.equal(collisions.length, 1);
		assert.equal(collisions[0].otherNetId, "GND");
		assert.equal(collisions[0].gapMm, 0);
	});

	test("a segment crossing only the chord region does not collide", () => {
		const { collisions } = route([4, 0.1], [6, 0.1]);
		assert.deepEqual(collisions, []);
	});

	test("a segment just outside the bulge reports the true arc gap", () => {
		const { collisions } = route([3, -2.3], [7, -2.3]);
		assert.equal(collisions.length, 1);
		assert.ok(collisions[0].gapMm > 0 && collisions[0].gapMm < 0.2);
	});

	test("straight tracks keep segment clearance", () => {
		const straight = { ...ARC, mid: undefined };
		const res = proposeRoute({
			start: [4, 0.1],
			cursor: [6, 0.1],
			board: { tracks: [straight] },
			netId: "VCC",
		});
		assert.equal(res.collisions.length, 1);
	});
});

describe("trackLength of arcs", () => {
	test("quarter circle r=10 is about 15.708", () => {
		const m = 10 * Math.SQRT1_2;
		const quarter = { start: [10, 0], mid: [m, m], end: [0, 10] };
		assert.ok(Math.abs(trackLength(quarter) - 5 * Math.PI) < 1e-6);
	});

	test("major arc is measured the long way round", () => {
		const major = { start: [10, 0], mid: [-10, 0], end: [0, 10] };
		assert.ok(Math.abs(trackLength(major) - 15 * Math.PI) < 1e-6);
	});

	test("collinear mid falls back to chord length", () => {
		const flat = { start: [0, 0], mid: [1, 0], end: [3, 0] };
		assert.equal(trackLength(flat), 3);
	});
});

describe("trackKey", () => {
	test("two arcs sharing endpoints get distinct keys", () => {
		const a = { ...ARC };
		const b = { ...ARC, mid: [5, 2] };
		assert.notEqual(trackKey(a, 0), trackKey(b, 1));
	});

	test("uses uuid when present", () => {
		const a = { ...ARC, uuid: "u-1" };
		assert.equal(trackKey(a, 0), trackKey(a, 5));
		assert.notEqual(trackKey(a, 0), trackKey({ ...ARC, uuid: "u-2" }, 0));
	});
});
