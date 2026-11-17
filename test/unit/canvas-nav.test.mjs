import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	applyNav,
	edgePan,
	keyAction,
	wheelAction,
	ZOOM_STEP,
} from "../../frontend/src/editor/canvasNav.js";
import {
	fitToBounds,
	screenToWorld,
	worldToScreen,
	ZOOM_MAX,
	ZOOM_MIN,
} from "../../frontend/src/editor/viewport.js";

const DEFAULT_VIEW = Object.freeze({
	pan: { x: 100, y: 50 },
	zoom: 2,
});

const DEFAULT_SIZE = Object.freeze({
	width: 800,
	height: 600,
});

const WHEEL_CASES = [
	[0, -2.5, 0, true, false, false, "zoom", Math.exp(0.025), "pinch in"],
	[0, 3.2, 0, true, false, false, "zoom", Math.exp(-0.032), "pinch out"],
	[0, 0.1, 1, true, false, false, "zoom", Math.exp(-0.016), "pinch lines"],
	[0, -100, 0, false, false, false, "zoom", ZOOM_STEP, "wheel in"],
	[0, 100, 0, false, false, false, "zoom", 1 / ZOOM_STEP, "wheel out"],
	[0, -3, 1, false, false, false, "zoom", ZOOM_STEP, "wheel lines"],
	[0, 50, 0, true, false, false, "pan", [-50, 0], "ctrl pan"],
	[0, 12.5, 0, true, false, false, "pan", [-12.5, 0], "ctrl pan float"],
	[0, 2, 1, true, false, false, "pan", [-32, 0], "ctrl pan lines"],
	[0, 40, 0, false, true, false, "pan", [0, -40], "shift pan"],
	[0, -1.5, 1, false, true, false, "pan", [0, 24], "shift pan lines"],
	[25, -30, 0, false, false, false, "pan", [-25, 30], "two finger pan"],
	[-2, 1, 1, false, false, false, "pan", [32, -16], "two finger lines"],
	[0, 0, 0, false, false, false, null, null, "zero delta"],
	[0, 50, 0, false, false, true, null, null, "meta key"],
];

const KEY_CASES = [
	["F1", "zoomIn"],
	["f1", "zoomIn"],
	["F2", "zoomOut"],
	["f2", "zoomOut"],
	["F4", "centerCursor"],
	["f4", "centerCursor"],
	["Home", "zoomFit"],
	["home", "zoomFit"],
	["HOME", "zoomFit"],
	["Enter", null],
	["Escape", null],
	["", null],
	[null, null],
	[undefined, null],
];

const EDGE_CASES = [
	[10, 300, 800, 600, 24, 12, 12, 0],
	[790, 300, 800, 600, 24, 12, -12, 0],
	[400, 15, 800, 600, 24, 12, 0, 12],
	[400, 585, 800, 600, 24, 12, 0, -12],
	[400, 300, 800, 600, 24, 12, 0, 0],
	[5, 5, 800, 600, 24, 12, 12, 12],
	[30, 300, 800, 600, 40, 25, 25, 0],
	[null, null, 800, 600, 24, 12, 0, 0],
	[10, 10, null, null, 24, 12, 0, 0],
];

function assertPointClose(actual, expected) {
	const diffX = Math.abs(actual.x - expected.x);
	const diffY = Math.abs(actual.y - expected.y);
	assert.ok(diffX < 1e-9);
	assert.ok(diffY < 1e-9);
}

describe("canvasNav constants", () => {
	test("ZOOM_STEP is 1.15", () => {
		assert.equal(ZOOM_STEP, 1.15);
	});
});

describe("canvasNav wheelAction", () => {
	test("wheelAction handles each modifier and delta pattern", () => {
		for (const [x, y, m, c, s, meta, type, val, name] of WHEEL_CASES) {
			const res = wheelAction({
				deltaX: x,
				deltaY: y,
				deltaMode: m,
				ctrlKey: c,
				shiftKey: s,
				metaKey: meta,
			});
			if (!type) {
				assert.equal(res, null, name);
			} else if (type === "zoom") {
				assert.equal(res.type, "zoom", name);
				assert.ok(Math.abs(res.factor - val) < 1e-9, name);
			} else {
				assert.deepEqual(res, { type: "pan", dx: val[0], dy: val[1] }, name);
			}
		}
	});
});

describe("canvasNav keyAction", () => {
	test("keyAction maps navigation hotkeys case-insensitively", () => {
		for (const [key, expected] of KEY_CASES) {
			assert.equal(keyAction(key), expected, `key: ${key}`);
		}
	});
});

describe("canvasNav applyNav", () => {
	test("zoom and zoomIn/zoomOut keep anchor point fixed", () => {
		const cursor = { x: 250, y: 180 };
		const actions = [
			{ type: "zoom", factor: 1.3 },
			"zoomIn",
			"zoomOut",
			{ type: "zoomIn" },
			{ type: "zoomOut" },
		];

		for (const action of actions) {
			const wBefore = screenToWorld(cursor, DEFAULT_VIEW);
			const nextView = applyNav(DEFAULT_VIEW, action, {
				cursor,
				size: DEFAULT_SIZE,
			});
			const screenAfter = worldToScreen(wBefore, nextView);
			assertPointClose(screenAfter, cursor);
		}
	});

	test("missing cursor anchors zoom to centre of viewport size", () => {
		const center = {
			x: DEFAULT_SIZE.width / 2,
			y: DEFAULT_SIZE.height / 2,
		};
		const wBefore = screenToWorld(center, DEFAULT_VIEW);
		const nextView = applyNav(DEFAULT_VIEW, "zoomIn", {
			size: DEFAULT_SIZE,
		});
		const screenAfter = worldToScreen(wBefore, nextView);
		assertPointClose(screenAfter, center);
	});

	test("zoom clamps to ZOOM_MIN and ZOOM_MAX", () => {
		const highZoomView = { pan: { x: 0, y: 0 }, zoom: 180 };
		const clampedMax = applyNav(
			highZoomView,
			{ type: "zoom", factor: 5 },
			{ size: DEFAULT_SIZE },
		);
		assert.equal(clampedMax.zoom, ZOOM_MAX);

		const lowZoomView = { pan: { x: 0, y: 0 }, zoom: 0.1 };
		const clampedMin = applyNav(
			lowZoomView,
			{ type: "zoom", factor: 0.1 },
			{ size: DEFAULT_SIZE },
		);
		assert.equal(clampedMin.zoom, ZOOM_MIN);
	});

	test("pan action moves pan offset without mutating zoom", () => {
		const action = { type: "pan", dx: 35, dy: -20 };
		const next = applyNav(DEFAULT_VIEW, action, { size: DEFAULT_SIZE });
		assert.deepEqual(next, {
			pan: { x: 135, y: 30 },
			zoom: 2,
		});
	});

	test("centerCursor shifts cursor world position to centre of viewport", () => {
		const cursor = { x: 150, y: 220 };
		const center = {
			x: DEFAULT_SIZE.width / 2,
			y: DEFAULT_SIZE.height / 2,
		};
		const wBefore = screenToWorld(cursor, DEFAULT_VIEW);
		const next = applyNav(DEFAULT_VIEW, "centerCursor", {
			cursor,
			size: DEFAULT_SIZE,
		});
		const screenAfter = worldToScreen(wBefore, next);
		assertPointClose(screenAfter, center);
	});

	test("centerCursor returns unchanged view when cursor or size is missing", () => {
		const missingCursor = applyNav(DEFAULT_VIEW, "centerCursor", {
			size: DEFAULT_SIZE,
		});
		assert.deepEqual(missingCursor, DEFAULT_VIEW);

		const missingSize = applyNav(DEFAULT_VIEW, "centerCursor", {
			cursor: { x: 100, y: 100 },
		});
		assert.deepEqual(missingSize, DEFAULT_VIEW);
	});

	test("zoomFit fits bounds or returns unchanged view when bounds missing", () => {
		const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 50 };
		const expectedFit = fitToBounds(bounds, DEFAULT_SIZE);
		const actualFit = applyNav(DEFAULT_VIEW, "zoomFit", {
			bounds,
			size: DEFAULT_SIZE,
		});
		assert.deepEqual(actualFit, expectedFit);

		const noBounds = applyNav(DEFAULT_VIEW, "zoomFit", {
			size: DEFAULT_SIZE,
		});
		assert.deepEqual(noBounds, DEFAULT_VIEW);
	});

	test("unhandled action returns unchanged view", () => {
		assert.deepEqual(applyNav(DEFAULT_VIEW, null, {}), DEFAULT_VIEW);
		assert.deepEqual(applyNav(DEFAULT_VIEW, "unknown", {}), DEFAULT_VIEW);
	});
});

describe("canvasNav edgePan", () => {
	test("edgePan determines direction based on margin boundaries", () => {
		for (const [x, y, w, h, m, spd, exDx, exDy] of EDGE_CASES) {
			const cursor = x === null ? null : { x, y };
			const size = w === null ? null : { width: w, height: h };
			const actual = edgePan(cursor, size, m, spd);
			assert.deepEqual(actual, { dx: exDx, dy: exDy });
		}
	});
});
