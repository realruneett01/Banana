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

function tWires(dx) {
	return [
		w(dx, 0, dx + 10, 0),
		w(dx + 10, 0, dx + 20, 0),
		w(dx + 10, 0, dx + 10, 10),
	];
}

const CASES = [
	["T-junction: 3 wire ends meet -> dot", tWires(0), [], [p(10, 0)]],
	["simple corner: 2 ends meet -> no dot", [w(0, 0, 10, 0), w(10, 0, 10, 10)]],
	[
		"crossing wires without shared endpoint -> no dot",
		[w(0, 5, 10, 5), w(5, 0, 5, 10)],
	],
	[
		"4-way cross of 4 wires at one point -> one dot",
		[w(5, 0, 5, 5), w(5, 5, 5, 10), w(0, 5, 5, 5), w(5, 5, 10, 5)],
		[],
		[p(5, 5)],
	],
	[
		"pin on wire middle with wire ending there -> dot",
		[w(0, 0, 20, 0), w(10, 0, 10, 10)],
		[p(10, 0)],
		[p(10, 0)],
	],
	[
		"duplicates removed: same junction from multiple rules",
		tWires(0),
		[p(10, 0)],
		[p(10, 0)],
	],
	[
		"sorted by x then y",
		[...tWires(20), ...tWires(0)],
		[],
		[p(10, 0), p(30, 0)],
	],
	["empty inputs -> no dots", []],
	[
		"pin at wire end only (no crossing) -> no dot",
		[w(0, 0, 10, 0)],
		[p(10, 0)],
	],
].map(([name, wires, pins = [], expected = []]) => ({
	name,
	wires,
	pins,
	expected,
}));

describe("junctionPoints", () => {
	for (const tc of CASES) {
		test(tc.name, () => {
			assert.deepEqual(junctionPoints(tc.wires, tc.pins), tc.expected);
		});
	}
});
