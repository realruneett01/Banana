import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ratsnest } from "../../frontend/src/editor/ratsnest.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const pad = (id, x, y, net = "N1") => ({ id, net, x, y });

const cases = [
	{
		label: "3 pads in a line -> 2 airlines",
		pads: [pad("A", 0, 0), pad("B", 1, 0), pad("C", 2, 0)],
		check(result) {
			assert.equal(result.length, 2);
			assert.ok(result.every((r) => r.net === "N1" && near(r.length, 1)));
		},
	},
	{
		label: "4-pad square -> 3 airlines, total length 3*side",
		pads: [pad("A", 0, 0), pad("B", 1, 0), pad("C", 1, 1), pad("D", 0, 1)],
		check(result) {
			assert.equal(result.length, 3);
			const total = result.reduce((s, r) => s + r.length, 0);
			assert.ok(near(total, 3), `expected total 3, got ${total}`);
		},
	},
	{
		label: "two pads joined by a track -> no airline",
		pads: [pad("A", 0, 0), pad("B", 1, 0)],
		tracks: [{ net: "N1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }],
		check: (r) => assert.equal(r.length, 0),
	},
	{
		label: "net 0 ignored",
		pads: [pad("A", 0, 0, 0), pad("B", 1, 0, 0)],
		check: (r) => assert.equal(r.length, 0),
	},
	{
		label: "two nets independent",
		pads: [
			pad("A", 0, 0),
			pad("B", 1, 0),
			pad("C", 10, 0, "N2"),
			pad("D", 11, 0, "N2"),
		],
		check(result) {
			assert.equal(result.length, 2);
			for (const net of ["N1", "N2"]) {
				assert.equal(result.filter((r) => r.net === net).length, 1);
			}
		},
	},
	{
		label: "pads joined by a chain of two tracks -> no airline",
		pads: [pad("A", 0, 0), pad("B", 10, 0)],
		tracks: [
			{ net: "N1", start: { x: 0, y: 0 }, end: { x: 5, y: 3 } },
			{ net: "N1", start: { x: 5, y: 3 }, end: { x: 10, y: 0 } },
		],
		check: (r) => assert.deepEqual(r, []),
	},
];

describe("ratsnest", () => {
	for (const { label, pads, tracks = [], check } of cases) {
		it(label, () => check(ratsnest(pads, tracks)));
	}
});
