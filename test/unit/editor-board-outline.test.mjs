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

const RECT_OUTLINE_CASES = [
	{
		x: 0,
		y: 0,
		w: 100,
		h: 80,
		expectedArea: 8000,
		expectedBBox: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
	},
	{
		x: 10,
		y: 20,
		w: 50,
		h: 30,
		expectedArea: 1500,
		expectedBBox: { minX: 10, minY: 20, maxX: 60, maxY: 50 },
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
		start: { x: 0, y: 5 },
		mid: { x: 5, y: 0 },
		end: { x: 0, y: -5 },
		expected: { x: 0, y: 0 },
	},
	{
		name: "known circle centered at (3, 4)",
		start: { x: 3, y: 9 },
		mid: { x: 8, y: 4 },
		end: { x: 3, y: -1 },
		expected: { x: 3, y: 4 },
	},
	{
		name: "collinear horizontal points return null",
		start: { x: 0, y: 0 },
		mid: { x: 5, y: 0 },
		end: { x: 10, y: 0 },
		expected: null,
	},
	{
		name: "collinear diagonal points return null",
		start: { x: 1, y: 1 },
		mid: { x: 2, y: 2 },
		end: { x: 3, y: 3 },
		expected: null,
	},
];

const CHAIN_CLOSED_CASES = [
	{
		name: "shuffled and reversed line segments for 100x80 rectangle",
		shapes: [
			{ type: "line", start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
			{ type: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
			{ type: "line", start: { x: 0, y: 80 }, end: { x: 0, y: 0 } },
			{ type: "line", start: { x: 100, y: 80 }, end: { x: 100, y: 0 } },
		],
		expectedArea: 8000,
	},
	{
		name: "reversed triangle segments",
		shapes: [
			{ type: "line", start: { x: 30, y: 0 }, end: { x: 0, y: 40 } },
			{ type: "line", start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
			{ type: "line", start: { x: 0, y: 40 }, end: { x: 0, y: 0 } },
		],
		expectedArea: 600,
	},
];

const OPEN_OUTLINE_CASES = [
	{
		name: "missing fourth edge of rectangle",
		shapes: [
			{ type: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
			{ type: "line", start: { x: 100, y: 0 }, end: { x: 100, y: 80 } },
			{ type: "line", start: { x: 100, y: 80 }, end: { x: 0, y: 80 } },
		],
	},
	{
		name: "disconnected segments",
		shapes: [
			{ type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
			{ type: "line", start: { x: 20, y: 20 }, end: { x: 30, y: 20 } },
		],
	},
	{
		name: "empty shape array",
		shapes: [],
	},
];

const POINT_IN_POLYGON_CASES = [
	{ pt: { x: 50, y: 40 }, expected: true },
	{ pt: { x: 10, y: 10 }, expected: true },
	{ pt: { x: 90, y: 70 }, expected: true },
	{ pt: { x: -5, y: 40 }, expected: false },
	{ pt: { x: 105, y: 40 }, expected: false },
	{ pt: { x: 50, y: -10 }, expected: false },
	{ pt: { x: 50, y: 90 }, expected: false },
	{ pt: { x: 200, y: 200 }, expected: false },
];

const CIRCLE_CASES = [
	{ center: { x: 0, y: 0 }, end: { x: 10, y: 0 }, r: 10 },
	{ center: { x: 50, y: 50 }, end: { x: 50, y: 75 }, r: 25 },
];

describe("boardOutline - rectOutline", () => {
	test("produces closed rectangle outlines with expected area and bbox", () => {
		for (const tc of RECT_OUTLINE_CASES) {
			const shapes = rectOutline(tc.x, tc.y, tc.w, tc.h);
			assert.equal(shapes.length, 4);
			const res = outlineToPolygon(shapes);
			assert.equal(res.ok, true);
			assert.equal(polygonArea(res.polygon), tc.expectedArea);
			assert.deepEqual(polygonBBox(res.polygon), tc.expectedBBox);
		}
	});
});

describe("boardOutline - roundedRectOutline", () => {
	test("rounded rect area is within 1 percent of theoretical area", () => {
		for (const tc of ROUNDED_RECT_CASES) {
			const shapes = roundedRectOutline(tc.x, tc.y, tc.w, tc.h, tc.r);
			assert.equal(shapes.length, 8);
			const res = outlineToPolygon(shapes);
			assert.equal(res.ok, true);
			const actualArea = polygonArea(res.polygon);
			const expectedArea = tc.w * tc.h - (4 - Math.PI) * tc.r * tc.r;
			const relError = Math.abs(actualArea - expectedArea) / expectedArea;
			assert.ok(relError < 0.01);
		}
	});

	test("non-positive radius falls back to rectOutline", () => {
		for (const r of [0, -5]) {
			const shapes = roundedRectOutline(0, 0, 100, 80, r);
			assert.equal(shapes.length, 4);
			assert.equal(shapes[0].type, "line");
		}
	});
});

describe("boardOutline - arcCenter", () => {
	test("calculates circumcentre or returns null when collinear", () => {
		for (const tc of ARC_CENTER_CASES) {
			const center = arcCenter(tc.start, tc.mid, tc.end);
			if (tc.expected === null) {
				assert.equal(center, null);
			} else {
				assert.ok(center !== null);
				assert.ok(Math.abs(center.x - tc.expected.x) < 1e-6);
				assert.ok(Math.abs(center.y - tc.expected.y) < 1e-6);
			}
		}
	});
});

describe("boardOutline - outlineToPolygon chaining", () => {
	test("chains shuffled and reversed segments into closed polygon", () => {
		for (const tc of CHAIN_CLOSED_CASES) {
			const res = outlineToPolygon(tc.shapes);
			assert.equal(res.ok, true);
			assert.ok(Math.abs(polygonArea(res.polygon) - tc.expectedArea) < 1e-3);
		}
	});

	test("open outline returns ok false with exact error", () => {
		for (const tc of OPEN_OUTLINE_CASES) {
			const res = outlineToPolygon(tc.shapes);
			assert.equal(res.ok, false);
			assert.equal(res.error, "Outline is not closed");
		}
	});

	test("single rect or circle is treated as already closed", () => {
		const rectRes = outlineToPolygon([
			{ type: "rect", start: { x: 0, y: 0 }, end: { x: 100, y: 80 } },
		]);
		assert.equal(rectRes.ok, true);
		assert.equal(polygonArea(rectRes.polygon), 8000);

		const circleRes = outlineToPolygon([
			{ type: "circle", center: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
		]);
		assert.equal(circleRes.ok, true);
		assert.ok(circleRes.polygon.length > 0);
	});
});

describe("boardOutline - pointInPolygon", () => {
	test("detects points inside and outside polygon", () => {
		const res = outlineToPolygon(rectOutline(0, 0, 100, 80));
		assert.equal(res.ok, true);
		for (const tc of POINT_IN_POLYGON_CASES) {
			assert.equal(pointInPolygon(tc.pt, res.polygon), tc.expected);
		}
	});
});

describe("boardOutline - circle area", () => {
	test("circle area close to pi*r^2 within 2 percent at 64 segments", () => {
		for (const tc of CIRCLE_CASES) {
			const shape = { type: "circle", center: tc.center, end: tc.end };
			const pts = flattenShape(shape, 64);
			const area = polygonArea(pts);
			const expectedArea = Math.PI * tc.r * tc.r;
			const relError = Math.abs(area - expectedArea) / expectedArea;
			assert.ok(relError < 0.02);
		}
	});
});
