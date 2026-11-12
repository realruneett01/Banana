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

const RECT_OUTLINE_CASES = [
	{
		x: 0,
		y: 0,
		w: 100,
		h: 80,
		expectedArea: 8000,
		expectedBBox: bbox(0, 0, 100, 80),
	},
	{
		x: 10,
		y: 20,
		w: 50,
		h: 30,
		expectedArea: 1500,
		expectedBBox: bbox(10, 20, 60, 50),
	},
];

const ROUNDED_RECT_CASES = [
	{ x: 0, y: 0, w: 100, h: 80, r: 10 },
	{ x: 10, y: 10, w: 60, h: 40, r: 5 },
	{ x: 0, y: 0, w: 50, h: 50, r: 25 },
];

const ARC_CENTER_CASES = [
	{
		name: "known circle centered at origin",
		start: pt(0, 5),
		mid: pt(5, 0),
		end: pt(0, -5),
		expected: pt(0, 0),
	},
	{
		name: "known circle centered at (3, 4)",
		start: pt(3, 9),
		mid: pt(8, 4),
		end: pt(3, -1),
		expected: pt(3, 4),
	},
	{
		name: "collinear horizontal points return null",
		start: pt(0, 0),
		mid: pt(5, 0),
		end: pt(10, 0),
		expected: null,
	},
	{
		name: "collinear diagonal points return null",
		start: pt(1, 1),
		mid: pt(2, 2),
		end: pt(3, 3),
		expected: null,
	},
];

const CHAIN_CLOSED_CASES = [
	{
		name: "shuffled and reversed line segments for 100x80 rectangle",
		shapes: [
			line(100, 80, 0, 80),
			line(0, 0, 100, 0),
			line(0, 80, 0, 0),
			line(100, 80, 100, 0),
		],
		expectedArea: 8000,
	},
	{
		name: "reversed triangle segments",
		shapes: [line(30, 0, 0, 40), line(0, 0, 30, 0), line(0, 40, 0, 0)],
		expectedArea: 600,
	},
];

const OPEN_OUTLINE_CASES = [
	{
		name: "missing fourth edge of rectangle",
		shapes: [line(0, 0, 100, 0), line(100, 0, 100, 80), line(100, 80, 0, 80)],
	},
	{
		name: "disconnected segments",
		shapes: [line(0, 0, 10, 0), line(20, 20, 30, 20)],
	},
	{
		name: "empty shape array",
		shapes: [],
	},
];

const POINT_IN_POLYGON_CASES = [
	{ pt: pt(50, 40), expected: true },
	{ pt: pt(10, 10), expected: true },
	{ pt: pt(90, 70), expected: true },
	{ pt: pt(-5, 40), expected: false },
	{ pt: pt(105, 40), expected: false },
	{ pt: pt(50, -10), expected: false },
	{ pt: pt(50, 90), expected: false },
	{ pt: pt(200, 200), expected: false },
];

const CIRCLE_CASES = [
	{ center: pt(0, 0), end: pt(10, 0), r: 10 },
	{ center: pt(50, 50), end: pt(50, 75), r: 25 },
];

describe("boardOutline - rectOutline", () => {
	for (const tc of RECT_OUTLINE_CASES) {
		test(`produces closed rectangle outline (${tc.w}x${tc.h})`, () => {
			const shapes = rectOutline(tc.x, tc.y, tc.w, tc.h);
			assert.equal(shapes.length, 4);
			const res = outlineToPolygon(shapes);
			assert.equal(res.ok, true);
			assert.equal(polygonArea(res.polygon), tc.expectedArea);
			assert.deepEqual(polygonBBox(res.polygon), tc.expectedBBox);
		});
	}
});

describe("boardOutline - roundedRectOutline", () => {
	for (const tc of ROUNDED_RECT_CASES) {
		test(`rounded rect area within 1 percent (${tc.w}x${tc.h} r=${tc.r})`, () => {
			const shapes = roundedRectOutline(tc.x, tc.y, tc.w, tc.h, tc.r);
			assert.equal(shapes.length, 8);
			const res = outlineToPolygon(shapes);
			assert.equal(res.ok, true);
			const expectedArea = tc.w * tc.h - (4 - Math.PI) * tc.r * tc.r;
			assert.ok(relError(polygonArea(res.polygon), expectedArea) < 0.01);
		});
	}

	for (const r of [0, -5]) {
		test(`non-positive radius (${r}) falls back to rectOutline`, () => {
			const shapes = roundedRectOutline(0, 0, 100, 80, r);
			assert.equal(shapes.length, 4);
			assert.equal(shapes[0].type, "line");
		});
	}
});

describe("boardOutline - arcCenter", () => {
	for (const tc of ARC_CENTER_CASES) {
		test(`calculates circumcentre: ${tc.name}`, () => {
			const center = arcCenter(tc.start, tc.mid, tc.end);
			if (tc.expected === null) {
				assert.equal(center, null);
			} else {
				assert.ok(center !== null);
				assert.ok(Math.abs(center.x - tc.expected.x) < 1e-6);
				assert.ok(Math.abs(center.y - tc.expected.y) < 1e-6);
			}
		});
	}
});

describe("boardOutline - outlineToPolygon chaining", () => {
	for (const tc of CHAIN_CLOSED_CASES) {
		test(`chains shuffled and reversed segments: ${tc.name}`, () => {
			const res = outlineToPolygon(tc.shapes);
			assert.equal(res.ok, true);
			const areaDiff = Math.abs(polygonArea(res.polygon) - tc.expectedArea);
			assert.ok(areaDiff < 1e-3);
		});
	}

	for (const tc of OPEN_OUTLINE_CASES) {
		test(`open outline returns ok false with exact error: ${tc.name}`, () => {
			const res = outlineToPolygon(tc.shapes);
			assert.equal(res.ok, false);
			assert.equal(res.error, "Outline is not closed");
		});
	}

	test("single rect is treated as already closed", () => {
		const rectRes = outlineToPolygon([
			{ type: "rect", start: pt(0, 0), end: pt(100, 80) },
		]);
		assert.equal(rectRes.ok, true);
		const rectArea = polygonArea(rectRes.polygon);
		assert.equal(rectArea, 8000);
	});

	test("single circle is treated as already closed", () => {
		const circleRes = outlineToPolygon([
			{ type: "circle", center: pt(0, 0), end: pt(10, 0) },
		]);
		assert.equal(circleRes.ok, true);
		const polyLength = circleRes.polygon.length;
		assert.ok(polyLength > 0);
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
	for (const tc of CIRCLE_CASES) {
		test(`circle area (r=${tc.r}) close to pi*r^2 within 2 percent`, () => {
			const shape = { type: "circle", center: tc.center, end: tc.end };
			const pts = flattenShape(shape, 64);
			const expectedArea = Math.PI * tc.r * tc.r;
			assert.ok(relError(polygonArea(pts), expectedArea) < 0.02);
		});
	}
});
