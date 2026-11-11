import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { markerGlyphs } from "../../frontend/src/editor/markerRender.js";

const NON_ARRAY_INPUTS = [
	null,
	undefined,
	42,
	"string",
	{},
	true,
	false,
	Symbol("test"),
];

const SEVERITY_CASES = [
	{ severity: "error", expected: "red" },
	{ severity: "ERROR", expected: "red" },
	{ severity: "warning", expected: "orange" },
	{ severity: "Warning", expected: "orange" },
	{ severity: "info", expected: "blue" },
	{ severity: "other", expected: "blue" },
	{ severity: undefined, expected: "blue" },
	{ severity: null, expected: "blue" },
];

const INVALID_COORD_CASES = [
	{ desc: "missing coords", marker: { severity: "error" } },
	{ desc: "NaN in array", marker: { at: [Number.NaN, 10] } },
	{ desc: "Infinity in array", marker: { at: [10, Number.POSITIVE_INFINITY] } },
	{ desc: "null coords", marker: { at: [null, 10] } },
	{ desc: "empty array", marker: { position: [] } },
	{ desc: "single coordinate", marker: { position: [10] } },
	{ desc: "non-finite object", marker: { position: { x: Number.NaN, y: 10 } } },
	{ desc: "non-object item", marker: null },
];

const VALID_COORD_CASES = [
	{
		desc: "at array",
		marker: { at: [10.5, 20.25] },
		expected: { x: 10.5, y: 20.25 },
	},
	{
		desc: "at object",
		marker: { at: { x: 5, y: 15 } },
		expected: { x: 5, y: 15 },
	},
	{
		desc: "position array",
		marker: { position: [30, 40] },
		expected: { x: 30, y: 40 },
	},
	{
		desc: "position object",
		marker: { position: { x: 1, y: 2 } },
		expected: { x: 1, y: 2 },
	},
	{
		desc: "direct x/y",
		marker: { x: 8, y: 9 },
		expected: { x: 8, y: 9 },
	},
	{
		desc: "zero coordinates",
		marker: { at: [0, 0] },
		expected: { x: 0, y: 0 },
	},
	{
		desc: "negative coordinates",
		marker: { at: [-10, -20.5] },
		expected: { x: -10, y: -20.5 },
	},
];

const RADIUS_CASES = [
	{ desc: "omitted options", options: undefined, expected: 1.2 },
	{ desc: "empty options object", options: {}, expected: 1.2 },
	{ desc: "custom options.radius", options: { radius: 2.5 }, expected: 2.5 },
	{ desc: "numeric options shorthand", options: 0.8, expected: 0.8 },
];

const TITLE_CASES = [
	{
		desc: "from message property",
		marker: { at: [1, 1], message: "Trace clearance too small" },
		expected: "Trace clearance too small",
	},
	{
		desc: "from title property",
		marker: { at: [1, 1], title: "Clearance error" },
		expected: "Clearance error",
	},
	{
		desc: "empty string fallback when omitted",
		marker: { at: [1, 1] },
		expected: "",
	},
];

describe("markerRender", () => {
	test("returns empty array for non-array inputs", () => {
		for (const input of NON_ARRAY_INPUTS) {
			assert.deepEqual(markerGlyphs(input), []);
		}
	});

	test("maps severity to color lookup table correctly", () => {
		for (const { severity, expected } of SEVERITY_CASES) {
			const glyphs = markerGlyphs([{ at: [10, 20], severity }]);
			assert.equal(glyphs.length, 1);
			assert.equal(glyphs[0].color, expected);
		}
	});

	test("skips markers without finite coordinates", () => {
		for (const { desc, marker } of INVALID_COORD_CASES) {
			const glyphs = markerGlyphs([marker]);
			assert.equal(glyphs.length, 0, `Expected 0 glyphs for ${desc}`);
		}
	});

	test("extracts valid coordinates from multiple supported shapes", () => {
		for (const { desc, marker, expected } of VALID_COORD_CASES) {
			const glyphs = markerGlyphs([marker]);
			assert.equal(glyphs.length, 1, `Expected 1 glyph for ${desc}`);
			assert.equal(glyphs[0].x, expected.x);
			assert.equal(glyphs[0].y, expected.y);
		}
	});

	test("sets default radius and handles custom radius options", () => {
		for (const { desc, options, expected } of RADIUS_CASES) {
			const glyphs = markerGlyphs([{ at: [1, 2] }], options);
			assert.equal(glyphs.length, 1, `Expected 1 glyph for ${desc}`);
			assert.equal(glyphs[0].r, expected);
		}
	});

	test("extracts plain-English title from message or title", () => {
		for (const { desc, marker, expected } of TITLE_CASES) {
			const glyphs = markerGlyphs([marker]);
			assert.equal(glyphs.length, 1, `Expected 1 glyph for ${desc}`);
			assert.equal(glyphs[0].title, expected);
		}
	});

	test("generates stable and unique keys across calls and duplicates", () => {
		const markers = [
			{ id: "m1", at: [1, 1] },
			{ id: "m1", at: [2, 2] },
			{ at: [3, 4] },
			{ at: [3, 4] },
		];
		const first = markerGlyphs(markers);
		const second = markerGlyphs(markers);

		assert.equal(first.length, 4);
		assert.deepEqual(
			first.map((g) => g.key),
			second.map((g) => g.key),
		);

		const keySet = new Set(first.map((g) => g.key));
		assert.equal(keySet.size, first.length);
	});
});
