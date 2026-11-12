import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	bboxOfPoints,
	fitToBounds,
	formatCoord,
	GRID_PRESETS,
	panBy,
	screenToWorld,
	snap,
	snapPoint,
	worldToScreen,
	ZOOM_MAX,
	ZOOM_MIN,
	zoomAt,
} from "../../frontend/src/editor/viewport.js";

const ROUNDTRIP_CASES = [
	{ pt: { x: 0, y: 0 }, view: { pan: { x: 100, y: 50 }, zoom: 2 } },
	{
		pt: { x: 123.45, y: -67.89 },
		view: { pan: { x: -40, y: 80 }, zoom: 0.5 },
	},
	{ pt: { x: -500, y: 300 }, view: { pan: { x: 0, y: 0 }, zoom: 10 } },
	{
		pt: { x: 10, y: 20 },
		view: { pan: { x: 25.5, y: -14.2 }, zoom: 1.27 },
	},
];

const ZOOM_ANCHOR_CASES = [
	{
		view: { pan: { x: 100, y: 50 }, zoom: 1 },
		anchor: { x: 200, y: 150 },
		factor: 1.5,
	},
	{
		view: { pan: { x: -50, y: 120 }, zoom: 2.5 },
		anchor: { x: 0, y: 0 },
		factor: 0.8,
	},
	{
		view: { pan: { x: 300, y: -200 }, zoom: 0.2 },
		anchor: { x: 500, y: 400 },
		factor: 2,
	},
];

const ZOOM_CLAMP_CASES = [
	{
		view: { pan: { x: 0, y: 0 }, zoom: 100 },
		factor: 5,
		expected: ZOOM_MAX,
	},
	{
		view: { pan: { x: 0, y: 0 }, zoom: 0.1 },
		factor: 0.1,
		expected: ZOOM_MIN,
	},
	{
		view: { pan: { x: 0, y: 0 }, zoom: 200 },
		factor: 2,
		expected: ZOOM_MAX,
	},
	{
		view: { pan: { x: 0, y: 0 }, zoom: 0.05 },
		factor: 0.5,
		expected: ZOOM_MIN,
	},
];

const PAN_CASES = [
	{
		view: { pan: { x: 10, y: 20 }, zoom: 2 },
		dx: 15,
		dy: -5,
		expected: { pan: { x: 25, y: 15 }, zoom: 2 },
	},
	{
		view: { pan: { x: -100, y: 50 }, zoom: 0.5 },
		dx: -20,
		dy: 30,
		expected: { pan: { x: -120, y: 80 }, zoom: 0.5 },
	},
];

const FIT_FALLBACK_CASES = [
	{ bounds: null, size: { width: 800, height: 600 } },
	{
		bounds: { minX: 10, minY: 10, maxX: 10, maxY: 10 },
		size: { width: 800, height: 600 },
	},
	{
		bounds: { minX: 5, minY: 5, maxX: 0, maxY: 0 },
		size: { width: 800, height: 600 },
	},
];

const SNAP_CASES = [
	{ val: 0, grid: 1.27, expected: 0 },
	{ val: 1.27, grid: 1.27, expected: 1.27 },
	{ val: 1.3, grid: 1.27, expected: 1.27 },
	{ val: 2.0, grid: 1.27, expected: 2.54 },
	{ val: -1.3, grid: 1.27, expected: -1.27 },
	{ val: -0.01, grid: 1.27, expected: 0 },
	{ val: 5.5, grid: 0, expected: 5.5 },
	{ val: -3.2, grid: 0, expected: -3.2 },
	{ val: 0.3, grid: 0.1, expected: 0.3 },
	{ val: -0, grid: 1.27, expected: 0 },
	{ val: 4.2, grid: -1, expected: 4.2 },
];

const SNAP_POINT_CASES = [
	{
		pt: { x: 1.3, y: -1.3 },
		grid: 1.27,
		expected: { x: 1.27, y: -1.27 },
	},
	{ pt: { x: 5.5, y: -3.2 }, grid: 0, expected: { x: 5.5, y: -3.2 } },
	{ pt: { x: -0.01, y: 0.01 }, grid: 1.27, expected: { x: 0, y: 0 } },
];

const FORMAT_CASES = [
	{ mm: 1.27, units: "mm", expected: "1.2700" },
	{ mm: 25.4, units: "in", expected: "1.0000" },
	{ mm: 2.54, units: "mil", expected: "100.0" },
	{ mm: 1.27, units: "custom", expected: "1.2700" },
	{ mm: 1.27, units: undefined, expected: "1.2700" },
	{ mm: 0, units: "mm", expected: "0.0000" },
	{ mm: -0, units: "mm", expected: "0.0000" },
];

const BBOX_CASES = [
	{ points: [], expected: null },
	{ points: null, expected: null },
	{
		points: [
			{ x: 10, y: 20 },
			{ x: 30, y: -5 },
			{ x: 0, y: 15 },
		],
		expected: { minX: 0, minY: -5, maxX: 30, maxY: 20 },
	},
	{
		points: [
			[10, 20],
			[30, -5],
			[0, 15],
		],
		expected: { minX: 0, minY: -5, maxX: 30, maxY: 20 },
	},
];

describe("viewport coordinate transforms", () => {
	test("screenToWorld and worldToScreen round-trip", () => {
		for (const { pt, view } of ROUNDTRIP_CASES) {
			const world = screenToWorld(pt, view);
			const backScreen = worldToScreen(world, view);
			assert.ok(Math.abs(backScreen.x - pt.x) < 1e-9);
			assert.ok(Math.abs(backScreen.y - pt.y) < 1e-9);

			const backWorld = screenToWorld(backScreen, view);
			assert.ok(Math.abs(backWorld.x - world.x) < 1e-9);
			assert.ok(Math.abs(backWorld.y - world.y) < 1e-9);
		}
	});

	test("panBy moves pan by screen pixels without mutation", () => {
		for (const { view, dx, dy, expected } of PAN_CASES) {
			const originalPanX = view.pan.x;
			const actual = panBy(view, dx, dy);
			assert.deepEqual(actual, expected);
			assert.equal(view.pan.x, originalPanX);
		}
	});
});

describe("viewport zoom operations", () => {
	test("zoomAt keeps the anchor point fixed within 1e-9", () => {
		for (const { view, anchor, factor } of ZOOM_ANCHOR_CASES) {
			const wBefore = screenToWorld(anchor, view);
			const zoomed = zoomAt(view, anchor, factor);
			const wAfter = screenToWorld(anchor, zoomed);
			assert.ok(Math.abs(wAfter.x - wBefore.x) < 1e-9);
			assert.ok(Math.abs(wAfter.y - wBefore.y) < 1e-9);
		}
	});

	test("zoomAt clamps zoom to ZOOM_MIN and ZOOM_MAX", () => {
		for (const { view, factor, expected } of ZOOM_CLAMP_CASES) {
			const zoomed = zoomAt(view, { x: 0, y: 0 }, factor);
			assert.equal(zoomed.zoom, expected);
		}
	});
});

describe("fitToBounds", () => {
	test("centres a 100x50 box in 800x600 with margins", () => {
		const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
		const size = { width: 800, height: 600 };
		const view = fitToBounds(bounds, size, 0.05);

		const centerWorld = { x: 50, y: 25 };
		const centerScreen = worldToScreen(centerWorld, view);
		assert.ok(Math.abs(centerScreen.x - 400) < 1e-9);
		assert.ok(Math.abs(centerScreen.y - 300) < 1e-9);

		assert.equal(view.zoom, 7.2);
		const left = worldToScreen({ x: 0, y: 25 }, view);
		const right = worldToScreen({ x: 100, y: 25 }, view);
		assert.ok(Math.abs(left.x - 40) < 1e-9);
		assert.ok(Math.abs(right.x - 760) < 1e-9);
	});

	test("returns default view when bounds are null or empty", () => {
		for (const { bounds, size } of FIT_FALLBACK_CASES) {
			const view = fitToBounds(bounds, size);
			assert.deepEqual(view, { pan: { x: 400, y: 300 }, zoom: 4 });
		}
	});
});

describe("snap and snapPoint", () => {
	test("snap cases round to grid and avoid -0", () => {
		for (const { val, grid, expected } of SNAP_CASES) {
			const actual = snap(val, grid);
			assert.equal(actual, expected);
			assert.equal(Object.is(actual, -0), false);
		}
	});

	test("snapPoint snaps coordinates and avoids -0", () => {
		for (const { pt, grid, expected } of SNAP_POINT_CASES) {
			const actual = snapPoint(pt, grid);
			assert.deepEqual(actual, expected);
			assert.equal(Object.is(actual.x, -0), false);
			assert.equal(Object.is(actual.y, -0), false);
		}
	});
});

describe("formatCoord, GRID_PRESETS, bboxOfPoints", () => {
	test("formatCoord formats across units and falls back to mm", () => {
		for (const { mm, units, expected } of FORMAT_CASES) {
			assert.equal(formatCoord(mm, units), expected);
		}
	});

	test("GRID_PRESETS exposes frozen schematic and pcb arrays", () => {
		assert.deepEqual(GRID_PRESETS.schematic, [0.635, 1.27, 2.54]);
		assert.deepEqual(GRID_PRESETS.pcb, [0.1, 0.25, 0.5, 1, 1.27, 2.54]);
		assert.equal(Object.isFrozen(GRID_PRESETS), true);
	});

	test("bboxOfPoints computes bounding box or returns null", () => {
		for (const { points, expected } of BBOX_CASES) {
			assert.deepEqual(bboxOfPoints(points), expected);
		}
	});
});
