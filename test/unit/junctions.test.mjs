import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { junctionPoints } from "../../frontend/src/editor/junctions.js";

// wire helper: { a:{x,y}, b:{x,y} }
function w(ax, ay, bx, by) {
	return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

// point helper
function p(x, y) {
	return { x, y };
}

const CASES = [
	{
		name: "T-junction: 3 wire ends meet -> dot",
		wires: [w(0, 0, 10, 0), w(10, 0, 20, 0), w(10, 0, 10, 10)],
		pins: [],
		expected: [p(10, 0)],
	},
	{
		name: "simple corner: 2 ends meet -> no dot",
		wires: [w(0, 0, 10, 0), w(10, 0, 10, 10)],
		pins: [],
		expected: [],
	},
	{
		name: "crossing wires without shared endpoint -> no dot",
		wires: [w(0, 5, 10, 5), w(5, 0, 5, 10)],
		pins: [],
		expected: [],
	},
	{
		name: "4-way cross of 4 wires at one point -> one dot",
		wires: [w(5, 0, 5, 5), w(5, 5, 5, 10), w(0, 5, 5, 5), w(5, 5, 10, 5)],
		pins: [],
		expected: [p(5, 5)],
	},
	{
		name: "pin on wire middle with wire ending there -> dot",
		wires: [w(0, 0, 20, 0), w(10, 0, 10, 10)],
		pins: [p(10, 0)],
		expected: [p(10, 0)],
	},
	{
		name: "duplicates removed: same junction from multiple rules",
		wires: [w(0, 0, 10, 0), w(10, 0, 20, 0), w(10, 0, 10, 10)],
		pins: [p(10, 0)],
		expected: [p(10, 0)],
	},
	{
		name: "sorted by x then y",
		wires: [
			w(20, 0, 30, 0),
			w(30, 0, 40, 0),
			w(30, 0, 30, 10),
			w(0, 0, 10, 0),
			w(10, 0, 20, 0),
			w(10, 0, 10, 10),
		],
		pins: [],
		expected: [p(10, 0), p(30, 0)],
	},
	{
		name: "empty inputs -> no dots",
		wires: [],
		pins: [],
		expected: [],
	},
	{
		name: "pin at wire end only (no crossing) -> no dot",
		wires: [w(0, 0, 10, 0)],
		pins: [p(10, 0)],
		expected: [],
	},
];

describe("junctionPoints", () => {
	for (const tc of CASES) {
		test(tc.name, () => {
			assert.deepEqual(junctionPoints(tc.wires, tc.pins), tc.expected);
		});
	}
});
