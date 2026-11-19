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
	["error", "red"],
	["ERROR", "red"],
	["warning", "orange"],
	["Warning", "orange"],
	["info", "blue"],
	["other", "blue"],
	[undefined, "blue"],
	[null, "blue"],
];

const INVALID_COORD_CASES = [
	["missing coords", { severity: "error" }],
	["NaN in array", { at: [Number.NaN, 10] }],
	["Infinity in array", { at: [10, Number.POSITIVE_INFINITY] }],
	["null coords", { at: [null, 10] }],
	["empty array", { position: [] }],
	["single coordinate", { position: [10] }],
	["non-finite object", { position: { x: Number.NaN, y: 10 } }],
	["non-object item", null],
];

const VALID_COORD_CASES = [
	["at array", { at: [10.5, 20.25] }, { x: 10.5, y: 20.25 }],
	["at object", { at: { x: 5, y: 15 } }, { x: 5, y: 15 }],
	["position array", { position: [30, 40] }, { x: 30, y: 40 }],
	["position object", { position: { x: 1, y: 2 } }, { x: 1, y: 2 }],
	["direct x/y", { x: 8, y: 9 }, { x: 8, y: 9 }],
	["zero coordinates", { at: [0, 0] }, { x: 0, y: 0 }],
	["negative coordinates", { at: [-10, -20.5] }, { x: -10, y: -20.5 }],
];

const RADIUS_CASES = [
	["omitted options", undefined, 1.2],
	["empty options object", {}, 1.2],
	["custom options.radius", { radius: 2.5 }, 2.5],
	["numeric options shorthand", 0.8, 0.8],
];

const TITLE_CASES = [
	[
		"from message property",
		{ at: [1, 1], message: "Trace clearance too small" },
		"Trace clearance too small",
	],
	[
		"from title property",
		{ at: [1, 1], title: "Clearance error" },
		"Clearance error",
	],
	["empty string fallback when omitted", { at: [1, 1] }, ""],
];

function assertGlyph(marker, checks, config = {}) {
	const glyphs = markerGlyphs([marker], config.options);
	assert.equal(
		glyphs.length,
		1,
		config.desc ? `Expected 1 glyph for ${config.desc}` : undefined,
	);
	for (const [prop, val] of Object.entries(checks)) {
		assert.equal(glyphs[0][prop], val);
	}
}

describe("markerRender", () => {
	test("returns empty array for non-array inputs", () => {
		for (const input of NON_ARRAY_INPUTS) {
			assert.deepEqual(markerGlyphs(input), []);
		}
	});

	test("maps severity to color lookup table correctly", () => {
		for (const [severity, expected] of SEVERITY_CASES) {
			assertGlyph({ at: [10, 20], severity }, { color: expected });
		}
	});

	test("skips markers without finite coordinates", () => {
		for (const [desc, marker] of INVALID_COORD_CASES) {
			const glyphs = markerGlyphs([marker]);
			assert.equal(glyphs.length, 0, `Expected 0 glyphs for ${desc}`);
		}
	});

	test("extracts valid coordinates from multiple supported shapes", () => {
		for (const [desc, marker, expected] of VALID_COORD_CASES) {
			assertGlyph(marker, expected, { desc });
		}
	});

	test("sets default radius and handles custom radius options", () => {
		for (const [desc, options, expected] of RADIUS_CASES) {
			assertGlyph({ at: [1, 2] }, { r: expected }, { options, desc });
		}
	});

	test("extracts plain-English title from message or title", () => {
		for (const [desc, marker, expected] of TITLE_CASES) {
			assertGlyph(marker, { title: expected }, { desc });
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
