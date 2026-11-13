import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	boxSelect,
	normalizeBox,
} from "../../frontend/src/editor/boxSelect.js";

// Helpers
const item = (id, minX, minY, maxX, maxY) => ({
	id,
	bbox: { minX, minY, maxX, maxY },
});

describe("normalizeBox", () => {
	test("ltr order unchanged", () => {
		assert.deepEqual(normalizeBox({ x: 1, y: 2 }, { x: 5, y: 6 }), {
			minX: 1,
			minY: 2,
			maxX: 5,
			maxY: 6,
		});
	});

	test("rtl swaps axes", () => {
		assert.deepEqual(normalizeBox({ x: 5, y: 6 }, { x: 1, y: 2 }), {
			minX: 1,
			minY: 2,
			maxX: 5,
			maxY: 6,
		});
	});

	test("negative coordinates", () => {
		assert.deepEqual(normalizeBox({ x: -10, y: -5 }, { x: -3, y: -1 }), {
			minX: -10,
			minY: -5,
			maxX: -3,
			maxY: -1,
		});
	});
});

describe("boxSelect – zero-size box", () => {
	const items = [item("A", 0, 0, 10, 10)];

	for (const [label, start, end] of [
		["zero width", { x: 2, y: 0 }, { x: 2, y: 5 }],
		["zero height", { x: 0, y: 3 }, { x: 5, y: 3 }],
		["single point", { x: 5, y: 5 }, { x: 5, y: 5 }],
	]) {
		test(label, () => {
			assert.deepEqual(boxSelect(items, start, end), []);
		});
	}
});

describe("boxSelect – left-to-right (fully inside)", () => {
	const start = { x: 0, y: 0 };
	const end = { x: 10, y: 10 };

	for (const [label, bbox, expectIds] of [
		["fully inside", item("A", 2, 2, 8, 8), ["A"]],
		["exactly fills box", item("A", 0, 0, 10, 10), ["A"]],
		["partially outside", item("A", -1, 2, 8, 8), []],
		["edge-touching still inside", item("A", 0, 0, 5, 5), ["A"]],
		["completely outside", item("A", 11, 11, 20, 20), []],
	]) {
		test(label, () => {
			assert.deepEqual(boxSelect([bbox], start, end), expectIds);
		});
	}
});

describe("boxSelect – right-to-left (touching / intersecting)", () => {
	const start = { x: 10, y: 10 };
	const end = { x: 0, y: 0 };

	for (const [label, bbox, expectIds] of [
		["fully inside", item("A", 2, 2, 8, 8), ["A"]],
		["partially overlaps", item("A", -5, -5, 3, 3), ["A"]],
		["edge-touching minX", item("A", -5, 2, 0, 8), ["A"]],
		["edge-touching maxX", item("A", 10, 2, 15, 8), ["A"]],
		["edge-touching minY", item("A", 2, -5, 8, 0), ["A"]],
		["edge-touching maxY", item("A", 2, 10, 8, 15), ["A"]],
		["completely outside", item("A", 11, 11, 20, 20), []],
		["corner-only touch", item("A", 10, 10, 15, 15), ["A"]],
	]) {
		test(label, () => {
			assert.deepEqual(boxSelect([bbox], start, end), expectIds);
		});
	}
});

describe("boxSelect – ordering and multiple items", () => {
	test("returns ids in input order", () => {
		const items = [
			item("A", 1, 1, 3, 3),
			item("B", 4, 4, 6, 6),
			item("C", 7, 7, 9, 9),
		];
		assert.deepEqual(boxSelect(items, { x: 0, y: 0 }, { x: 10, y: 10 }), [
			"A",
			"B",
			"C",
		]);
	});

	test("excludes items outside ltr box preserving order", () => {
		const items = [item("A", 1, 1, 3, 3), item("B", 20, 20, 30, 30)];
		assert.deepEqual(boxSelect(items, { x: 0, y: 0 }, { x: 10, y: 10 }), ["A"]);
	});

	test("empty items list", () => {
		assert.deepEqual(boxSelect([], { x: 0, y: 0 }, { x: 10, y: 10 }), []);
	});
});

describe("boxSelect – negative coordinates", () => {
	test("ltr fully inside negative region", () => {
		const items = [item("A", -8, -8, -2, -2)];
		assert.deepEqual(boxSelect(items, { x: -10, y: -10 }, { x: -1, y: -1 }), [
			"A",
		]);
	});

	test("rtl intersects negative region", () => {
		const items = [item("A", -15, -15, -5, -5)];
		assert.deepEqual(boxSelect(items, { x: -1, y: -1 }, { x: -10, y: -10 }), [
			"A",
		]);
	});
});
