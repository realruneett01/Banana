import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	boxSelect,
	normalizeBox,
} from "../../frontend/src/editor/boxSelect.js";

// Fixture builders & helpers
const pt = (x, y) => ({ x, y });
const origin = pt(0, 0);
const corner = pt(10, 10);

const item = (id, coords) => ({
	id,
	bbox: Array.isArray(coords)
		? {
				minX: coords[0],
				minY: coords[1],
				maxX: coords[2],
				maxY: coords[3],
			}
		: coords,
});
const itemA = (coords) => item("A", coords);

const runSelectCases = (cases, defaultStart, defaultEnd) => {
	for (const [
		label,
		target,
		expected,
		start = defaultStart,
		end = defaultEnd,
	] of cases) {
		test(label, () => {
			const items = Array.isArray(target) ? target : [target];
			assert.deepEqual(boxSelect(items, start, end), expected);
		});
	}
};

describe("normalizeBox", () => {
	const expected1256 = { minX: 1, minY: 2, maxX: 5, maxY: 6 };

	for (const [label, start, end, expected] of [
		["ltr order unchanged", pt(1, 2), pt(5, 6), expected1256],
		["rtl swaps axes", pt(5, 6), pt(1, 2), expected1256],
		[
			"negative coordinates",
			pt(-10, -5),
			pt(-3, -1),
			{ minX: -10, minY: -5, maxX: -3, maxY: -1 },
		],
	]) {
		test(label, () => {
			assert.deepEqual(normalizeBox(start, end), expected);
		});
	}
});

const zeroBoxItems = [itemA([0, 0, 10, 10])];

const BOX_SUITES = [
	[
		"boxSelect – zero-size box",
		[
			["zero width", zeroBoxItems, [], pt(2, 0), pt(2, 5)],
			["zero height", zeroBoxItems, [], pt(0, 3), pt(5, 3)],
			["single point", zeroBoxItems, [], pt(5, 5), pt(5, 5)],
		],
	],
	[
		"boxSelect – left-to-right (fully inside)",
		[
			["fully inside", itemA([2, 2, 8, 8]), ["A"]],
			["exactly fills box", itemA([0, 0, 10, 10]), ["A"]],
			["partially outside", itemA([-1, 2, 8, 8]), []],
			["edge-touching still inside", itemA([0, 0, 5, 5]), ["A"]],
			["completely outside", itemA([11, 11, 20, 20]), []],
		],
		origin,
		corner,
	],
	[
		"boxSelect – right-to-left (touching / intersecting)",
		[
			["fully inside", itemA([2, 2, 8, 8]), ["A"]],
			["partially overlaps", itemA([-5, -5, 3, 3]), ["A"]],
			["edge-touching minX", itemA([-5, 2, 0, 8]), ["A"]],
			["edge-touching maxX", itemA([10, 2, 15, 8]), ["A"]],
			["edge-touching minY", itemA([2, -5, 8, 0]), ["A"]],
			["edge-touching maxY", itemA([2, 10, 8, 15]), ["A"]],
			["completely outside", itemA([11, 11, 20, 20]), []],
			["corner-only touch", itemA([10, 10, 15, 15]), ["A"]],
		],
		corner,
		origin,
	],
	[
		"boxSelect – ordering and multiple items",
		[
			[
				"returns ids in input order",
				[
					item("A", [1, 1, 3, 3]),
					item("B", [4, 4, 6, 6]),
					item("C", [7, 7, 9, 9]),
				],
				["A", "B", "C"],
			],
			[
				"excludes items outside ltr box preserving order",
				[item("A", [1, 1, 3, 3]), item("B", [20, 20, 30, 30])],
				["A"],
			],
			["empty items list", [], []],
		],
		origin,
		corner,
	],
	[
		"boxSelect – negative coordinates",
		[
			[
				"ltr fully inside negative region",
				itemA([-8, -8, -2, -2]),
				["A"],
				pt(-10, -10),
				pt(-1, -1),
			],
			[
				"rtl intersects negative region",
				itemA([-15, -15, -5, -5]),
				["A"],
				pt(-1, -1),
				pt(-10, -10),
			],
		],
	],
];

for (const [title, cases, defaultStart, defaultEnd] of BOX_SUITES) {
	describe(title, () => {
		runSelectCases(cases, defaultStart, defaultEnd);
	});
}
