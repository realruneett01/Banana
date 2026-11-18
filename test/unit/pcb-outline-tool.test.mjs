import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);

const startMarker = "function getPointCoord";
const endMarker = "function commitOutline";
const sliceStart = pcbCanvasSrc.indexOf(startMarker);
const sliceEnd = pcbCanvasSrc.indexOf(endMarker);
assert.ok(sliceStart !== -1 && sliceEnd !== -1, "Found outline pure helpers");
const pureHelpersCode = pcbCanvasSrc.slice(sliceStart, sliceEnd);

const boardOutlineUrl = new URL(
	"../../frontend/src/editor/boardOutline.js",
	import.meta.url,
).href;

const dynamicModule = [
	`import { rectOutline, roundedRectOutline } from ${JSON.stringify(boardOutlineUrl)};`,
	pureHelpersCode,
].join("\n");

const { normalizeOutlineRect, normalizeRect, createOutlineShapes } =
	await import(
		`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
	);

const NORMALIZE_RECT_CASES = [
	{
		name: "standard order top-left to bottom-right",
		p1: { x: 0, y: 0 },
		p2: { x: 100, y: 80 },
		expected: { x: 0, y: 0, w: 100, h: 80 },
	},
	{
		name: "inverted order bottom-right to top-left",
		p1: { x: 100, y: 80 },
		p2: { x: 0, y: 0 },
		expected: { x: 0, y: 0, w: 100, h: 80 },
	},
	{
		name: "diagonal top-right to bottom-left",
		p1: { x: 100, y: 0 },
		p2: { x: 0, y: 80 },
		expected: { x: 0, y: 0, w: 100, h: 80 },
	},
	{
		name: "diagonal bottom-left to top-right",
		p1: { x: 0, y: 80 },
		p2: { x: 100, y: 0 },
		expected: { x: 0, y: 0, w: 100, h: 80 },
	},
	{
		name: "negative coordinates spanning origin",
		p1: { x: -50, y: -40 },
		p2: { x: 50, y: 40 },
		expected: { x: -50, y: -40, w: 100, h: 80 },
	},
	{
		name: "offset coordinates",
		p1: { x: 25.5, y: 15.25 },
		p2: { x: 75.5, y: 45.25 },
		expected: { x: 25.5, y: 15.25, w: 50, h: 30 },
	},
	{
		name: "array point format [x, y]",
		p1: [10, 20],
		p2: [60, 50],
		expected: { x: 10, y: 20, w: 50, h: 30 },
	},
];

const ZERO_SIZE_CASES = [
	{ name: "identical points", p1: { x: 10, y: 20 }, p2: { x: 10, y: 20 } },
	{
		name: "zero width vertical segment",
		p1: { x: 15, y: 10 },
		p2: { x: 15, y: 80 },
	},
	{
		name: "zero height horizontal segment",
		p1: { x: 10, y: 40 },
		p2: { x: 90, y: 40 },
	},
	{ name: "missing first point", p1: null, p2: { x: 10, y: 20 } },
	{ name: "missing second point", p1: { x: 10, y: 20 }, p2: null },
	{
		name: "non-finite coordinates",
		p1: { x: Number.NaN, y: 0 },
		p2: { x: 10, y: 20 },
	},
];

describe("normalizeOutlineRect pure function", () => {
	for (const tc of NORMALIZE_RECT_CASES) {
		it(`normalizes rect: ${tc.name}`, () => {
			assert.deepEqual(normalizeOutlineRect(tc.p1, tc.p2), tc.expected);
			assert.deepEqual(normalizeRect(tc.p1, tc.p2), tc.expected);
		});
	}

	for (const tc of ZERO_SIZE_CASES) {
		it(`ignores zero-size or invalid: ${tc.name}`, () => {
			assert.equal(normalizeOutlineRect(tc.p1, tc.p2), null);
			assert.equal(normalizeRect(tc.p1, tc.p2), null);
		});
	}
});

describe("createOutlineShapes pure function", () => {
	it("creates 4 lines for rectangular outline", () => {
		const shapes = createOutlineShapes(
			"rect",
			{ x: 0, y: 0 },
			{ x: 100, y: 80 },
			1,
		);
		assert.ok(Array.isArray(shapes));
		assert.equal(shapes.length, 4);
		assert.equal(shapes[0].type, "line");
		assert.deepEqual(shapes[0].start, { x: 0, y: 0 });
		assert.deepEqual(shapes[0].end, { x: 100, y: 0 });
	});

	it("creates lines and arcs for rounded rectangle outline", () => {
		const shapes = createOutlineShapes(
			"rounded_rect",
			{ x: 0, y: 0 },
			{ x: 100, y: 80 },
			5,
		);
		assert.ok(Array.isArray(shapes));
		assert.equal(shapes.length, 8);
		const types = shapes.map((s) => s.type);
		assert.deepEqual(types, [
			"line",
			"arc",
			"line",
			"arc",
			"line",
			"arc",
			"line",
			"arc",
		]);
	});

	it("returns null for zero-size inputs", () => {
		const shapes = createOutlineShapes(
			"rect",
			{ x: 10, y: 10 },
			{ x: 10, y: 10 },
			1,
		);
		assert.equal(shapes, null);
	});
});

describe("PcbCanvas outline tool wiring and contracts", () => {
	it("returns tool to select and replaces board outline on commit", () => {
		assert.match(
			pcbCanvasSrc,
			/pushBoard\(\{\s*\.\.\.\(board\s*\|\|\s*\{\}\),\s*outline:\s*shapes\s*\}\)/,
		);
		assert.match(
			pcbCanvasSrc,
			/setOutlineTool\(\{\s*activeTool:\s*null\s*\}\)/,
		);
	});

	it("renders dashed preview using Edge.Cuts layer styling", () => {
		assert.match(pcbCanvasSrc, /strokeDasharray="2,2"/);
		assert.match(pcbCanvasSrc, /getLayerColor\(PCB_THEME,\s*"Edge\.Cuts"\)/);
	});

	it("wires pointer down to commit on second click when drag.start exists", () => {
		assert.match(pcbCanvasSrc, /function useOutlinePointerDown/);
		assert.match(pcbCanvasSrc, /if\s*\(drag\?\.start\)\s*\{/);
	});

	it("wires pointer up to commit press-drag-release", () => {
		assert.match(pcbCanvasSrc, /function useOutlinePointerUp/);
		assert.match(
			pcbCanvasSrc,
			/if\s*\(shapes\s*&&\s*commitOutline\(shapes,\s*board,\s*pushBoard\)\)/,
		);
	});

	it("wires pointer move to update live cursor during drawing", () => {
		assert.match(pcbCanvasSrc, /function useOutlinePointerMove/);
		assert.match(
			pcbCanvasSrc,
			/setDrag\(\(prev\)\s*=>\s*\(prev\s*\?\s*\{\s*\.\.\.prev,\s*current:\s*pt\s*\}\s*:\s*null\)\)/,
		);
	});

	it("wires Escape to cancel half-drawn outline", () => {
		assert.match(pcbCanvasSrc, /function useOutlineCancel/);
		assert.match(
			pcbCanvasSrc,
			/if\s*\(drag\)\s*\{\s*setDrag\(null\);\s*return\s*true;\s*\}/,
		);
	});
});
