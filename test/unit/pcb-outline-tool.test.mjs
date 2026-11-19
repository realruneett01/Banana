import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function extractCanvasOutlineHelpers() {
	const source = readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	);
	const match = source.match(
		/function getPointCoord[\s\S]*?(?=function commitOutline)/,
	);
	assert.ok(match?.[0], "Found outline pure helpers");
	const outlineDep = new URL(
		"../../frontend/src/editor/boardOutline.js",
		import.meta.url,
	).href;
	const snippet = `import { rectOutline, roundedRectOutline } from "${outlineDep}";\n${match[0]}`;
	const base64Uri = `data:text/javascript;base64,${Buffer.from(snippet).toString("base64")}`;
	return { source, base64Uri };
}

const { source: pcbCanvasSrc, base64Uri } = extractCanvasOutlineHelpers();
const { normalizeOutlineRect, normalizeRect, createOutlineShapes } =
	await import(base64Uri);

function assertRectMatch(p1, p2, expected) {
	assert.deepEqual(normalizeOutlineRect(p1, p2), expected);
	assert.deepEqual(normalizeRect(p1, p2), expected);
}

function verifyRectOutline(shapes) {
	assert.ok(Array.isArray(shapes) && shapes.length === 4);
	const [first] = shapes;
	assert.deepEqual(
		{ type: first.type, start: first.start, end: first.end },
		{ type: "line", start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
	);
}

const pt = (x, y) => ({ x, y });
const box = (x, y, w, h) => ({ x, y, w, h });
const checkCase = (title, ...patterns) => [title, patterns];

const NORMALIZE_RECT_CASES = [
	[
		"standard order top-left to bottom-right",
		pt(0, 0),
		pt(100, 80),
		box(0, 0, 100, 80),
	],
	[
		"inverted order bottom-right to top-left",
		pt(100, 80),
		pt(0, 0),
		box(0, 0, 100, 80),
	],
	[
		"diagonal top-right to bottom-left",
		pt(100, 0),
		pt(0, 80),
		box(0, 0, 100, 80),
	],
	[
		"diagonal bottom-left to top-right",
		pt(0, 80),
		pt(100, 0),
		box(0, 0, 100, 80),
	],
	[
		"negative coordinates spanning origin",
		pt(-50, -40),
		pt(50, 40),
		box(-50, -40, 100, 80),
	],
	[
		"offset coordinates",
		pt(25.5, 15.25),
		pt(75.5, 45.25),
		box(25.5, 15.25, 50, 30),
	],
	["array point format [x, y]", [10, 20], [60, 50], box(10, 20, 50, 30)],
];

const ZERO_SIZE_CASES = [
	["identical points", pt(10, 20), pt(10, 20)],
	["zero width vertical segment", pt(15, 10), pt(15, 80)],
	["zero height horizontal segment", pt(10, 40), pt(90, 40)],
	["missing first point", null, pt(10, 20)],
	["missing second point", pt(10, 20), null],
	["non-finite coordinates", pt(Number.NaN, 0), pt(10, 20)],
];

describe("normalizeOutlineRect pure function", () => {
	for (const [name, p1, p2, expected] of NORMALIZE_RECT_CASES) {
		it(`normalizes rect: ${name}`, () => {
			assertRectMatch(p1, p2, expected);
		});
	}

	for (const [name, p1, p2] of ZERO_SIZE_CASES) {
		it(`ignores zero-size or invalid: ${name}`, () => {
			assertRectMatch(p1, p2, null);
		});
	}
});

describe("createOutlineShapes pure function", () => {
	it("creates 4 lines for rectangular outline", () => {
		const shapes = createOutlineShapes("rect", pt(0, 0), pt(100, 80), 1);
		verifyRectOutline(shapes);
	});

	it("creates lines and arcs for rounded rectangle outline", () => {
		const shapes = createOutlineShapes(
			"rounded_rect",
			pt(0, 0),
			pt(100, 80),
			5,
		);
		assert.equal(shapes?.length, 8);
		assert.deepEqual(
			shapes.map((s) => s.type),
			["line", "arc", "line", "arc", "line", "arc", "line", "arc"],
		);
	});

	it("returns null for zero-size inputs", () => {
		assert.equal(createOutlineShapes("rect", pt(10, 10), pt(10, 10), 1), null);
	});
});

const CANVAS_WIRING_CHECKS = [
	checkCase(
		"returns tool to select and replaces board outline on commit",
		/pushBoard\(\{\s*\.\.\.\(board\s*\|\|\s*\{\}\),\s*outline:\s*shapes\s*\}\)/,
		/setOutlineTool\(\{\s*activeTool:\s*null\s*\}\)/,
	),
	checkCase(
		"renders dashed preview using Edge.Cuts layer styling",
		/strokeDasharray="2,2"/,
		/getLayerColor\(PCB_THEME,\s*"Edge\.Cuts"\)/,
	),
	checkCase(
		"wires pointer down to commit on second click when drag.start exists",
		/function useOutlinePointerDown/,
		/if\s*\(drag\?\.start\)\s*\{/,
	),
	checkCase(
		"wires pointer up to commit press-drag-release",
		/function useOutlinePointerUp/,
		/if\s*\(shapes\s*&&\s*commitOutline\(shapes,\s*board,\s*pushBoard\)\)/,
	),
	checkCase(
		"wires pointer move to update live cursor during drawing",
		/function useOutlinePointerMove/,
		/setDrag\(\(prev\)\s*=>\s*\(prev\s*\?\s*\{\s*\.\.\.prev,\s*current:\s*pt\s*\}\s*:\s*null\)\)/,
	),
	checkCase(
		"wires Escape to cancel half-drawn outline",
		/function useOutlineCancel/,
		/if\s*\(drag\)\s*\{\s*setDrag\(null\);\s*return\s*true;\s*\}/,
	),
];

describe("PcbCanvas outline tool wiring and contracts", () => {
	for (const [title, patterns] of CANVAS_WIRING_CHECKS) {
		it(title, () => {
			for (const pat of patterns) {
				assert.match(pcbCanvasSrc, pat);
			}
		});
	}
});
