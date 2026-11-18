import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

async function loadGridModule() {
	const source = readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	);
	const bounds = [
		source.indexOf("// --- PCB Grid pure helpers ---"),
		source.indexOf("// --- End PCB Grid pure helpers ---"),
	];
	assert.ok(
		bounds.every((pos) => pos >= 0),
		"Found PCB grid pure helpers",
	);

	const resolveUrl = (relPath) =>
		JSON.stringify(new URL(relPath, import.meta.url).href);
	const header = [
		`import { get as getEditorStatus } from ${resolveUrl("../../frontend/src/editor/editorStatus.js")};`,
		`import { PCB_THEME } from ${resolveUrl("../../frontend/src/editor/theme.js")};`,
	].join("\n");

	const code = `${header}\n${source.slice(bounds[0], bounds[1])}`;
	const base64 = Buffer.from(code).toString("base64");
	const mod = await import(`data:text/javascript;base64,${base64}`);
	return { source, ...mod };
}

const {
	source: pcbCanvasSrc,
	currentGrid,
	adaptiveStepMultiple,
	visibleGridRange,
	getGridColors,
} = await loadGridModule();

function verifyCurrentGridCases(cases) {
	for (const [status, expected] of cases) {
		assert.equal(currentGrid(status), expected);
	}
}

function verifyAdaptiveMultiples(cases) {
	for (const [pitch, zoom, expected] of cases) {
		assert.equal(adaptiveStepMultiple(pitch, zoom), expected);
	}
}

function verifyGridRange(view, size, step, bounds) {
	const [minX, maxX, minY, maxY, startX, endX, startY, endY] = bounds;
	assert.deepEqual(visibleGridRange(view, size, step), {
		minX,
		maxX,
		minY,
		maxY,
		startX,
		endX,
		startY,
		endY,
	});
}

function verifyGridColors(theme, expected) {
	assert.deepEqual(getGridColors(theme), expected);
}

function verifyCanvasMatches(patterns) {
	for (const pattern of patterns) {
		assert.match(pcbCanvasSrc, pattern);
	}
}

describe("currentGrid fallback and status parsing", () => {
	it("returns grid pitch from status when positive number", () => {
		verifyCurrentGridCases([
			[{ grid: 1.27 }, 1.27],
			[{ grid: 0.5 }, 0.5],
			[{ grid: "2.54" }, 2.54],
		]);
	});

	it("falls back to 0.25 mm on invalid or missing grid", () => {
		verifyCurrentGridCases([
			[{}, 0.25],
			[null, 0.25],
			[{ grid: 0 }, 0.25],
			[{ grid: -1 }, 0.25],
			[{ grid: "invalid" }, 0.25],
			[{ grid: Number.NaN }, 0.25],
		]);
	});

	it("reads from live editorStatus store when called without args", () => {
		const val = currentGrid();
		assert.equal(typeof val, "number");
		assert.ok(val > 0);
	});
});

describe("adaptiveStepMultiple", () => {
	it("returns 1 when on-screen spacing is >= 8 px", () => {
		verifyAdaptiveMultiples([
			[1, 10, 1],
			[1, 8, 1],
			[0.5, 16, 1],
		]);
	});

	it("returns 2 when 2x spacing reaches >= 8 px", () => {
		verifyAdaptiveMultiples([
			[1, 5, 2],
			[1, 4, 2],
		]);
	});

	it("returns 5 when 2x is < 8 px but 5x reaches >= 8 px", () => {
		verifyAdaptiveMultiples([
			[1, 2, 5],
			[1, 3, 5],
		]);
	});

	it("returns 10 when 5x is < 8 px but 10x reaches >= 8 px", () => {
		verifyAdaptiveMultiples([
			[1, 1, 10],
			[1, 0.8, 10],
		]);
	});

	it("scales to larger multiples when zoomed far out", () => {
		verifyAdaptiveMultiples([
			[0.25, 1, 50],
			[0.1, 0.5, 200],
		]);
	});

	it("returns 1 on non-positive or non-finite inputs", () => {
		verifyAdaptiveMultiples([
			[0, 10, 1],
			[-1, 10, 1],
			[1, 0, 1],
			[Number.NaN, 10, 1],
		]);
	});
});

describe("visibleGridRange", () => {
	it("computes world bounds and snapped start/end range", () => {
		verifyGridRange(
			{ pan: { x: 0, y: 0 }, zoom: 1 },
			{ width: 800, height: 600 },
			10,
			[0, 800, 0, 600, 0, 800, 0, 600],
		);
	});

	it("correctly offsets world bounds according to pan and zoom", () => {
		verifyGridRange(
			{ pan: { x: 100, y: 50 }, zoom: 2 },
			{ width: 800, height: 600 },
			5,
			[-50, 350, -25, 275, -50, 350, -25, 275],
		);
	});

	it("falls back to default dimensions and step when missing", () => {
		const range = visibleGridRange(null, null);
		const bounds = [range.minX, range.maxX, range.minY, range.maxY];
		assert.ok(bounds.every(Number.isFinite));
		assert.ok(range.maxX > range.minX && range.maxY > range.minY);
	});
});

describe("getGridColors", () => {
	it("uses theme grid color when available and derives major color", () => {
		verifyGridColors(
			{ grid: "#848484" },
			{
				dot: "#848484",
				major: "#a6a6a6",
			},
		);
	});

	it("respects explicit gridMajor if defined in theme", () => {
		verifyGridColors(
			{ grid: "#111111", gridMajor: "#222222" },
			{
				dot: "#111111",
				major: "#222222",
			},
		);
	});

	it("falls back to subtle grey colors when theme has no grid", () => {
		const fallback = { dot: "#3a3f4b", major: "#4f5563" };
		for (const theme of [{}, null]) {
			verifyGridColors(theme, fallback);
		}
	});
});

describe("PcbCanvas grid and cursor contracts", () => {
	it("exports pure grid helpers from PcbCanvas.jsx", () => {
		verifyCanvasMatches([
			/export function currentGrid/,
			/export function adaptiveStepMultiple/,
			/export function visibleGridRange/,
			/export function getGridColors/,
		]);
	});

	it("renders PcbGrid and PcbCrosshair components under board content", () => {
		const tags = ["<PcbGrid", "<PcbCrosshair", "<PcbSvgContent"];
		const [gridIdx, crosshairIdx, contentIdx] = tags.map((tag) =>
			pcbCanvasSrc.indexOf(tag),
		);
		assert.ok(
			[gridIdx, crosshairIdx, contentIdx].every((idx) => idx !== -1),
			"All canvas elements exist",
		);
		assert.ok(
			gridIdx < crosshairIdx && crosshairIdx < contentIdx,
			"PcbGrid before PcbCrosshair before PcbSvgContent",
		);
	});

	it("wires onPointerLeave on the SVG canvas to clear the crosshair cursor", () => {
		verifyCanvasMatches([
			/onPointerLeave=\{ev\.onPointerLeave\}/,
			/setCursorPoint\(null\)/,
		]);
	});

	it("has no hard-coded 0.25 snapToGrid calls remaining", () => {
		assert.doesNotMatch(pcbCanvasSrc, /snapToGrid\([^)]*0\.25\)/);
	});
});
