import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ratsnest } from "../../frontend/src/editor/pcbGeometry.js";

// Pad i is part u<i+1>, pin 1, at (10*i, 0) on net_a.
function pad(i) {
	return { x: i * 10, y: 0, partId: `u${i + 1}`, pin: "1" };
}

function makeIr(padCount) {
	const pads = Array.from({ length: padCount }, (_, i) => pad(i));
	return {
		parts: pads.map((p) => ({ id: p.partId, placement: { x: p.x, y: 0 } })),
		nets: [
			{
				id: "net_a",
				name: "A",
				pins: pads.map(({ partId, pin }) => ({ partId, pin })),
			},
		],
	};
}

// A board track (array endpoints) joining pad 0 and pad 1, or none.
function tracksOn(netId) {
	if (!netId) return [];
	return [{ netId, layer: "F.Cu", start: [0, 0], end: [10, 0], widthMm: 0.25 }];
}

const CASES = [
	{
		name: "two pads, no track: one airline",
		pads: 2,
		trackNet: null,
		airlines: [[0, 1]],
	},
	{
		name: "two pads joined by a track: none",
		pads: 2,
		trackNet: "net_a",
		airlines: [],
	},
	{
		name: "three pads, track joins two: one",
		pads: 3,
		trackNet: "net_a",
		airlines: [[1, 2]],
	},
	{
		name: "track on another net is ignored",
		pads: 2,
		trackNet: "net_b",
		airlines: [[0, 1]],
	},
];

describe("pcbGeometry - track-aware ratsnest", () => {
	for (const c of CASES) {
		test(c.name, () => {
			const lines = ratsnest(makeIr(c.pads), undefined, tracksOn(c.trackNet));
			const want = c.airlines.map(([a, b]) => ({
				netId: "net_a",
				name: "A",
				from: pad(a),
				to: pad(b),
			}));
			assert.deepEqual(lines, want);
		});
	}
});
