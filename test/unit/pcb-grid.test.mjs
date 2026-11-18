import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);

const startMarker = "// --- PCB Grid pure helpers ---";
const endMarker = "// --- End PCB Grid pure helpers ---";
const sliceStart = pcbCanvasSrc.indexOf(startMarker);
const sliceEnd = pcbCanvasSrc.indexOf(endMarker);
assert.ok(sliceStart !== -1 && sliceEnd !== -1, "Found PCB grid pure helpers");
const pureHelpersCode = pcbCanvasSrc.slice(sliceStart, sliceEnd);

const editorStatusUrl = new URL(
	"../../frontend/src/editor/editorStatus.js",
	import.meta.url,
).href;
const themeUrl = new URL("../../frontend/src/editor/theme.js", import.meta.url)
	.href;

const dynamicModule = [
	`import { get as getEditorStatus } from ${JSON.stringify(editorStatusUrl)};`,
	`import { PCB_THEME } from ${JSON.stringify(themeUrl)};`,
	pureHelpersCode,
].join("\n");

const { currentGrid, adaptiveStepMultiple, visibleGridRange, getGridColors } =
	await import(
		`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
	);

describe("currentGrid fallback and status parsing", () => {
	it("returns grid pitch from status when positive number", () => {
		assert.equal(currentGrid({ grid: 1.27 }), 1.27);
		assert.equal(currentGrid({ grid: 0.5 }), 0.5);
		assert.equal(currentGrid({ grid: "2.54" }), 2.54);
	});

	it("falls back to 0.25 mm on invalid or missing grid", () => {
		assert.equal(currentGrid({}), 0.25);
		assert.equal(currentGrid(null), 0.25);
		assert.equal(currentGrid({ grid: 0 }), 0.25);
		assert.equal(currentGrid({ grid: -1 }), 0.25);
		assert.equal(currentGrid({ grid: "invalid" }), 0.25);
		assert.equal(currentGrid({ grid: Number.NaN }), 0.25);
	});

	it("reads from live editorStatus store when called without args", () => {
		const val = currentGrid();
		assert.equal(typeof val, "number");
		assert.ok(val > 0);
	});
});

describe("adaptiveStepMultiple", () => {
	it("returns 1 when on-screen spacing is >= 8 px", () => {
		assert.equal(adaptiveStepMultiple(1, 10), 1);
		assert.equal(adaptiveStepMultiple(1, 8), 1);
		assert.equal(adaptiveStepMultiple(0.5, 16), 1);
	});

	it("returns 2 when 2x spacing reaches >= 8 px", () => {
		assert.equal(adaptiveStepMultiple(1, 5), 2);
		assert.equal(adaptiveStepMultiple(1, 4), 2);
	});

	it("returns 5 when 2x is < 8 px but 5x reaches >= 8 px", () => {
		assert.equal(adaptiveStepMultiple(1, 2), 5);
		assert.equal(adaptiveStepMultiple(1, 3), 5);
	});

	it("returns 10 when 5x is < 8 px but 10x reaches >= 8 px", () => {
		assert.equal(adaptiveStepMultiple(1, 1), 10);
		assert.equal(adaptiveStepMultiple(1, 0.8), 10);
	});

	it("scales to larger multiples when zoomed far out", () => {
		assert.equal(adaptiveStepMultiple(0.25, 1), 50);
		assert.equal(adaptiveStepMultiple(0.1, 0.5), 200);
	});

	it("returns 1 on non-positive or non-finite inputs", () => {
		assert.equal(adaptiveStepMultiple(0, 10), 1);
		assert.equal(adaptiveStepMultiple(-1, 10), 1);
		assert.equal(adaptiveStepMultiple(1, 0), 1);
		assert.equal(adaptiveStepMultiple(Number.NaN, 10), 1);
	});
});

describe("visibleGridRange", () => {
	it("computes world bounds and snapped start/end range", () => {
		const view = { pan: { x: 0, y: 0 }, zoom: 1 };
		const size = { width: 800, height: 600 };
		const range = visibleGridRange(view, size, 10);
		assert.equal(range.minX, 0);
		assert.equal(range.maxX, 800);
		assert.equal(range.minY, 0);
		assert.equal(range.maxY, 600);
		assert.equal(range.startX, 0);
		assert.equal(range.endX, 800);
		assert.equal(range.startY, 0);
		assert.equal(range.endY, 600);
	});

	it("correctly offsets world bounds according to pan and zoom", () => {
		const view = { pan: { x: 100, y: 50 }, zoom: 2 };
		const size = { width: 800, height: 600 };
		const range = visibleGridRange(view, size, 5);
		assert.equal(range.minX, -50);
		assert.equal(range.maxX, 350);
		assert.equal(range.minY, -25);
		assert.equal(range.maxY, 275);
		assert.equal(range.startX, -50);
		assert.equal(range.endX, 350);
		assert.equal(range.startY, -25);
		assert.equal(range.endY, 275);
	});

	it("falls back to default dimensions and step when missing", () => {
		const range = visibleGridRange(null, null);
		assert.ok(Number.isFinite(range.minX));
		assert.ok(Number.isFinite(range.maxX));
		assert.ok(Number.isFinite(range.minY));
		assert.ok(Number.isFinite(range.maxY));
		assert.ok(range.maxX > range.minX);
		assert.ok(range.maxY > range.minY);
	});
});

describe("getGridColors", () => {
	it("uses theme grid color when available and derives major color", () => {
		const colors = getGridColors({ grid: "#848484" });
		assert.equal(colors.dot, "#848484");
		assert.equal(colors.major, "#a6a6a6");
	});

	it("respects explicit gridMajor if defined in theme", () => {
		const colors = getGridColors({ grid: "#111111", gridMajor: "#222222" });
		assert.equal(colors.dot, "#111111");
		assert.equal(colors.major, "#222222");
	});

	it("falls back to subtle grey colors when theme has no grid", () => {
		const colors = getGridColors({});
		assert.equal(colors.dot, "#3a3f4b");
		assert.equal(colors.major, "#4f5563");
		const colorsNull = getGridColors(null);
		assert.equal(colorsNull.dot, "#3a3f4b");
		assert.equal(colorsNull.major, "#4f5563");
	});
});

describe("PcbCanvas grid and cursor contracts", () => {
	it("exports pure grid helpers from PcbCanvas.jsx", () => {
		assert.match(pcbCanvasSrc, /export function currentGrid/);
		assert.match(pcbCanvasSrc, /export function adaptiveStepMultiple/);
		assert.match(pcbCanvasSrc, /export function visibleGridRange/);
		assert.match(pcbCanvasSrc, /export function getGridColors/);
	});

	it("renders PcbGrid and PcbCrosshair components under board content", () => {
		assert.match(pcbCanvasSrc, /<PcbGrid/);
		assert.match(pcbCanvasSrc, /<PcbCrosshair/);
		const gridIdx = pcbCanvasSrc.indexOf("<PcbGrid");
		const crosshairIdx = pcbCanvasSrc.indexOf("<PcbCrosshair");
		const contentIdx = pcbCanvasSrc.indexOf("<PcbSvgContent");
		assert.ok(gridIdx !== -1 && crosshairIdx !== -1 && contentIdx !== -1);
		assert.ok(
			gridIdx < crosshairIdx,
			"PcbGrid is rendered before PcbCrosshair",
		);
		assert.ok(
			crosshairIdx < contentIdx,
			"PcbCrosshair is rendered before PcbSvgContent",
		);
	});

	it("wires onPointerLeave on the SVG canvas to clear the crosshair cursor", () => {
		assert.match(pcbCanvasSrc, /onPointerLeave=\{ev\.onPointerLeave\}/);
		assert.match(pcbCanvasSrc, /setCursorPoint\(null\)/);
	});

	it("has no hard-coded 0.25 snapToGrid calls remaining", () => {
		assert.doesNotMatch(pcbCanvasSrc, /snapToGrid\([^)]*0\.25\)/);
	});
});
