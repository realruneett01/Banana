import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ratsnest } from "../../frontend/src/editor/ratsnest.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe("ratsnest", () => {
	const cases = [
		{
			label: "3 pads in a line -> 2 airlines",
			pads: [
				{ id: "A", net: "N1", x: 0, y: 0 },
				{ id: "B", net: "N1", x: 1, y: 0 },
				{ id: "C", net: "N1", x: 2, y: 0 },
			],
			tracks: [],
			check(result) {
				assert.equal(result.length, 2);
				assert.ok(result.every((r) => r.net === "N1"));
				assert.ok(result.every((r) => near(r.length, 1)));
			},
		},
		{
			label: "4-pad square -> 3 airlines, total length 3*side",
			pads: [
				{ id: "A", net: "N1", x: 0, y: 0 },
				{ id: "B", net: "N1", x: 1, y: 0 },
				{ id: "C", net: "N1", x: 1, y: 1 },
				{ id: "D", net: "N1", x: 0, y: 1 },
			],
			tracks: [],
			check(result) {
				assert.equal(result.length, 3);
				const total = result.reduce((s, r) => s + r.length, 0);
				assert.ok(near(total, 3), `expected total 3, got ${total}`);
			},
		},
		{
			label: "two pads joined by a track -> no airline",
			pads: [
				{ id: "A", net: "N1", x: 0, y: 0 },
				{ id: "B", net: "N1", x: 1, y: 0 },
			],
			tracks: [{ net: "N1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }],
			check(result) {
				assert.equal(result.length, 0);
			},
		},
		{
			label: "net 0 ignored",
			pads: [
				{ id: "A", net: 0, x: 0, y: 0 },
				{ id: "B", net: 0, x: 1, y: 0 },
			],
			tracks: [],
			check(result) {
				assert.equal(result.length, 0);
			},
		},
		{
			label: "two nets independent",
			pads: [
				{ id: "A", net: "N1", x: 0, y: 0 },
				{ id: "B", net: "N1", x: 1, y: 0 },
				{ id: "C", net: "N2", x: 10, y: 0 },
				{ id: "D", net: "N2", x: 11, y: 0 },
			],
			tracks: [],
			check(result) {
				assert.equal(result.length, 2);
				assert.equal(result.filter((r) => r.net === "N1").length, 1);
				assert.equal(result.filter((r) => r.net === "N2").length, 1);
			},
		},
		{
			label: "pads joined by a chain of two tracks -> no airline",
			pads: [
				{ id: "A", net: "N1", x: 0, y: 0 },
				{ id: "B", net: "N1", x: 10, y: 0 },
			],
			tracks: [
				{ net: "N1", start: { x: 0, y: 0 }, end: { x: 5, y: 3 } },
				{ net: "N1", start: { x: 5, y: 3 }, end: { x: 10, y: 0 } },
			],
			check: (r) => assert.deepEqual(r, []),
		},
	];

	for (const { label, pads, tracks, check } of cases) {
		it(label, () => check(ratsnest(pads, tracks)));
	}
});
