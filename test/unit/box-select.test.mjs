import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	boxSelect,
	normalizeBox,
} from "../../frontend/src/editor/boxSelect.js";

// Helpers
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
		["ltr order unchanged", { x: 1, y: 2 }, { x: 5, y: 6 }, expected1256],
		["rtl swaps axes", { x: 5, y: 6 }, { x: 1, y: 2 }, expected1256],
		[
			"negative coordinates",
			{ x: -10, y: -5 },
			{ x: -3, y: -1 },
			{ minX: -10, minY: -5, maxX: -3, maxY: -1 },
		],
	]) {
		test(label, () => {
			assert.deepEqual(normalizeBox(start, end), expected);
		});
	}
});

describe("boxSelect – zero-size box", () => {
	const items = [item("A", [0, 0, 10, 10])];

	runSelectCases([
		["zero width", items, [], { x: 2, y: 0 }, { x: 2, y: 5 }],
		["zero height", items, [], { x: 0, y: 3 }, { x: 5, y: 3 }],
		["single point", items, [], { x: 5, y: 5 }, { x: 5, y: 5 }],
	]);
});

describe("boxSelect – left-to-right (fully inside)", () => {
	runSelectCases(
		[
			["fully inside", item("A", [2, 2, 8, 8]), ["A"]],
			["exactly fills box", item("A", [0, 0, 10, 10]), ["A"]],
			["partially outside", item("A", [-1, 2, 8, 8]), []],
			["edge-touching still inside", item("A", [0, 0, 5, 5]), ["A"]],
			["completely outside", item("A", [11, 11, 20, 20]), []],
		],
		{ x: 0, y: 0 },
		{ x: 10, y: 10 },
	);
});

describe("boxSelect – right-to-left (touching / intersecting)", () => {
	runSelectCases(
		[
			["fully inside", item("A", [2, 2, 8, 8]), ["A"]],
			["partially overlaps", item("A", [-5, -5, 3, 3]), ["A"]],
			["edge-touching minX", item("A", [-5, 2, 0, 8]), ["A"]],
			["edge-touching maxX", item("A", [10, 2, 15, 8]), ["A"]],
			["edge-touching minY", item("A", [2, -5, 8, 0]), ["A"]],
			["edge-touching maxY", item("A", [2, 10, 8, 15]), ["A"]],
			["completely outside", item("A", [11, 11, 20, 20]), []],
			["corner-only touch", item("A", [10, 10, 15, 15]), ["A"]],
		],
		{ x: 10, y: 10 },
		{ x: 0, y: 0 },
	);
});

describe("boxSelect – ordering and multiple items", () => {
	runSelectCases(
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
		{ x: 0, y: 0 },
		{ x: 10, y: 10 },
	);
});

describe("boxSelect – negative coordinates", () => {
	runSelectCases([
		[
			"ltr fully inside negative region",
			item("A", [-8, -8, -2, -2]),
			["A"],
			{ x: -10, y: -10 },
			{ x: -1, y: -1 },
		],
		[
			"rtl intersects negative region",
			item("A", [-15, -15, -5, -5]),
			["A"],
			{ x: -1, y: -1 },
			{ x: -10, y: -10 },
		],
	]);
});
