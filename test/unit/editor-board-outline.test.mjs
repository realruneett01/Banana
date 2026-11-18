import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	arcCenter,
	flattenShape,
	outlineToPolygon,
	pointInPolygon,
	polygonArea,
	polygonBBox,
	rectOutline,
	roundedRectOutline,
} from "../../frontend/src/editor/boardOutline.js";

const pt = (x, y) => ({ x, y });

const bbox = (minX, minY, maxX, maxY) => ({ minX, minY, maxX, maxY });

const line = (x1, y1, x2, y2) => ({
	type: "line",
	start: pt(x1, y1),
	end: pt(x2, y2),
});

const relError = (actual, expected) => Math.abs(actual - expected) / expected;

const toValidPolygon = (shapes) => {
	const res = outlineToPolygon(shapes);
	assert.equal(res.ok, true);
	return res.polygon;
};

const assertPolygonBounds = (poly, expectedArea, expectedBBox) => {
	assert.equal(polygonArea(poly), expectedArea);
	assert.deepEqual(polygonBBox(poly), expectedBBox);
};

const assertAreaWithinTol = (polygon, expectedArea, tol) => {
	assert.ok(relError(polygonArea(polygon), expectedArea) < tol);
};

const assertPointClose = (actual, expected, tol = 1e-6) => {
	assert.ok(actual !== null);
	assert.ok(Math.abs(actual.x - expected.x) < tol);
	assert.ok(Math.abs(actual.y - expected.y) < tol);
};

const assertOpenOutline = (shapes, expectedError = "Outline is not closed") => {
	assert.deepEqual(outlineToPolygon(shapes), {
		ok: false,
		error: expectedError,
	});
};

const checkRectOutline = (tc) => {
	const shapes = rectOutline(tc.x, tc.y, tc.w, tc.h);
	assert.equal(shapes.length, 4);
	assertPolygonBounds(toValidPolygon(shapes), tc.expectedArea, tc.expectedBBox);
};

const RECT_OUTLINE_CASES = [
	[0, 0, 100, 80, 8000, bbox(0, 0, 100, 80)],
	[10, 20, 50, 30, 1500, bbox(10, 20, 60, 50)],
].map(([x, y, w, h, expectedArea, expectedBBox]) => ({
	x,
	y,
	w,
	h,
	expectedArea,
	expectedBBox,
}));

const ROUNDED_RECT_CASES = [
	{ x: 0, y: 0, w: 100, h: 80, r: 10 },
	{ x: 10, y: 10, w: 60, h: 40, r: 5 },
	{ x: 0, y: 0, w: 50, h: 50, r: 25 },
];

const ARC_CENTER_CASES = [
	["known circle centered at origin", [0, 5], [5, 0], [0, -5], pt(0, 0)],
	["known circle centered at (3, 4)", [3, 9], [8, 4], [3, -1], pt(3, 4)],
	["collinear horizontal points return null", [0, 0], [5, 0], [10, 0], null],
	["collinear diagonal points return null", [1, 1], [2, 2], [3, 3], null],
].map(([name, s, m, e, expected]) => ({
	name,
	start: pt(s[0], s[1]),
	mid: pt(m[0], m[1]),
	end: pt(e[0], e[1]),
	expected,
}));

const chainCase = (name, shapes, expectedArea) => ({
	name,
	shapes,
	expectedArea,
});

const CHAIN_CLOSED_CASES = [
	chainCase(
		"shuffled and reversed line segments for 100x80 rectangle",
		[
			line(100, 80, 0, 80),
			line(0, 0, 100, 0),
			line(0, 80, 0, 0),
			line(100, 80, 100, 0),
		],
		8000,
	),
	chainCase(
		"reversed triangle segments",
		[line(30, 0, 0, 40), line(0, 0, 30, 0), line(0, 40, 0, 0)],
		600,
	),
];

const openCase = (name, shapes) => ({ name, shapes });

const OPEN_OUTLINE_CASES = [
	openCase(
		"missing fourth edge of rectangle",
		rectOutline(0, 0, 100, 80).slice(0, 3),
	),
	openCase("disconnected segments", [line(0, 0, 10, 0), line(20, 20, 30, 20)]),
	openCase("empty shape array", []),
];

const POINT_IN_POLYGON_CASES = [
	[50, 40, true],
	[10, 10, true],
	[90, 70, true],
	[-5, 40, false],
	[105, 40, false],
	[50, -10, false],
	[50, 90, false],
	[200, 200, false],
].map(([x, y, expected]) => ({ pt: pt(x, y), expected }));

const CIRCLE_CASES = [
	{ center: pt(0, 0), end: pt(10, 0), r: 10 },
	{ center: pt(50, 50), end: pt(50, 75), r: 25 },
];

describe("boardOutline - rectOutline", () => {
	for (const tc of RECT_OUTLINE_CASES) {
		test(`produces closed rectangle outline (${tc.w}x${tc.h})`, () => {
			checkRectOutline(tc);
		});
	}
});

describe("boardOutline - roundedRectOutline", () => {
	for (const tc of ROUNDED_RECT_CASES) {
		test(`rounded rect area within 1 percent (${tc.w}x${tc.h} r=${tc.r})`, () => {
			const shapes = roundedRectOutline(tc.x, tc.y, tc.w, tc.h, tc.r);
			assert.equal(shapes.length, 8);
			const expected = tc.w * tc.h - (4 - Math.PI) * tc.r * tc.r;
			assertAreaWithinTol(toValidPolygon(shapes), expected, 0.01);
		});
	}

	for (const r of [0, -5]) {
		test(`non-positive radius (${r}) falls back to rectOutline`, () => {
			const fallbackShapes = roundedRectOutline(0, 0, 100, 80, r);
			assert.deepEqual(
				fallbackShapes.map((s) => s.type),
				["line", "line", "line", "line"],
			);
		});
	}
});

describe("boardOutline - arcCenter", () => {
	for (const tc of ARC_CENTER_CASES) {
		test(`calculates circumcentre: ${tc.name}`, () => {
			const center = arcCenter(tc.start, tc.mid, tc.end);
			if (!tc.expected) {
				assert.equal(center, null);
				return;
			}
			assertPointClose(center, tc.expected);
		});
	}
});

describe("boardOutline - outlineToPolygon chaining", () => {
	for (const tc of CHAIN_CLOSED_CASES) {
		test(`chains shuffled and reversed segments: ${tc.name}`, () => {
			const poly = toValidPolygon(tc.shapes);
			assert.ok(Math.abs(polygonArea(poly) - tc.expectedArea) < 1e-3);
		});
	}

	for (const tc of OPEN_OUTLINE_CASES) {
		test(`open outline returns ok false with exact error: ${tc.name}`, () => {
			assertOpenOutline(tc.shapes);
		});
	}

	test("single rect is treated as already closed", () => {
		const poly = toValidPolygon([
			{ type: "rect", start: pt(0, 0), end: pt(100, 80) },
		]);
		assert.equal(polygonArea(poly), 8000);
	});

	test("single circle is treated as already closed", () => {
		assert.ok(
			toValidPolygon([{ type: "circle", center: pt(0, 0), end: pt(10, 0) }])
				.length > 0,
		);
	});
});

describe("boardOutline - pointInPolygon", () => {
	const res = outlineToPolygon(rectOutline(0, 0, 100, 80));
	test("base rectangle is closed", () => {
		assert.equal(res.ok, true);
	});
	for (const tc of POINT_IN_POLYGON_CASES) {
		test(`detects point (${tc.pt.x}, ${tc.pt.y}) is ${tc.expected}`, () => {
			assert.equal(pointInPolygon(tc.pt, res.polygon), tc.expected);
		});
	}
});

describe("boardOutline - circle area", () => {
	CIRCLE_CASES.forEach((tc) => {
		test(`circle area (r=${tc.r}) close to pi*r^2 within 2 percent`, () => {
			const pts = flattenShape(
				{ type: "circle", center: tc.center, end: tc.end },
				64,
			);
			assertAreaWithinTol(pts, Math.PI * tc.r * tc.r, 0.02);
		});
	});
});
