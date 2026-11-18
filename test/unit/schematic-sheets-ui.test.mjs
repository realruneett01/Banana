import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

const sheetLayerUrl = new URL(
	"../../frontend/src/editor/SheetLayer.jsx",
	import.meta.url,
);
const sheetLayerSrc = fs.readFileSync(sheetLayerUrl, "utf8");

async function loadSheetLayerPureFunctions() {
	try {
		return await import(sheetLayerUrl.href);
	} catch {
		const start = sheetLayerSrc.indexOf("export function rectFromPoints");
		const end = sheetLayerSrc.indexOf("function SchematicSheetPin");
		const chunk = sheetLayerSrc.slice(start, end);
		return await import(`data:text/javascript,${encodeURIComponent(chunk)}`);
	}
}

const {
	rectFromPoints,
	pinPosition,
	sheetPinPosition,
	getSheetHandles,
	handleAtPoint,
	sheetHandleAt,
	sheetBorderSideAndOffset,
	isPointInSheet,
	isPointInSheetName,
	nextSheetPinName,
	nextFreeSheetPinName,
	sheetPinArrowPoints,
} = await loadSheetLayerPureFunctions();

describe("rectFromPoints pure helper", () => {
	test("constructs rect from two points ordered top-left to bottom-right", () => {
		const rect = rectFromPoints({ x: 10, y: 20 }, { x: 50, y: 70 });
		assert.deepEqual(rect, { x: 10, y: 20, w: 40, h: 50 });
	});

	test("normalizes rect from bottom-right to top-left inverted drag", () => {
		const rect = rectFromPoints({ x: 50, y: 70 }, { x: 10, y: 20 });
		assert.deepEqual(rect, { x: 10, y: 20, w: 40, h: 50 });
	});

	test("enforces minimum size of 10 x 10 mm when drag displacement is smaller", () => {
		const rect = rectFromPoints({ x: 15, y: 25 }, { x: 18, y: 28 });
		assert.deepEqual(rect, { x: 15, y: 25, w: 10, h: 10 });
	});

	test("enforces minimum size for zero-distance click", () => {
		const rect = rectFromPoints({ x: 30, y: 40 }, { x: 30, y: 40 });
		assert.deepEqual(rect, { x: 30, y: 40, w: 10, h: 10 });
	});

	test("handles missing or partial coordinates safely", () => {
		const rect = rectFromPoints(null, null);
		assert.deepEqual(rect, { x: 0, y: 0, w: 10, h: 10 });
	});
});

describe("sheet handles and handle hit-testing", () => {
	const sheet = { id: "s1", x: 10, y: 20, w: 40, h: 30 };

	test("getSheetHandles generates 8 handles with correct coordinates", () => {
		const handles = getSheetHandles(sheet);
		assert.equal(handles.length, 8);
		const ids = handles.map((h) => h.id);
		assert.deepEqual(ids, ["nw", "n", "ne", "e", "se", "s", "sw", "w"]);

		const map = Object.fromEntries(handles.map((h) => [h.id, h]));
		assert.deepEqual({ x: map.nw.x, y: map.nw.y }, { x: 10, y: 20 });
		assert.deepEqual({ x: map.n.x, y: map.n.y }, { x: 30, y: 20 });
		assert.deepEqual({ x: map.ne.x, y: map.ne.y }, { x: 50, y: 20 });
		assert.deepEqual({ x: map.e.x, y: map.e.y }, { x: 50, y: 35 });
		assert.deepEqual({ x: map.se.x, y: map.se.y }, { x: 50, y: 50 });
		assert.deepEqual({ x: map.s.x, y: map.s.y }, { x: 30, y: 50 });
		assert.deepEqual({ x: map.sw.x, y: map.sw.y }, { x: 10, y: 50 });
		assert.deepEqual({ x: map.w.x, y: map.w.y }, { x: 10, y: 35 });
	});

	test("handleAtPoint hits each of the 8 handles exactly", () => {
		const handles = getSheetHandles(sheet);
		for (const h of handles) {
			const hit = handleAtPoint(sheet, { x: h.x, y: h.y }, 1.5);
			assert.equal(hit, h.id, `Failed for handle ${h.id}`);
			const hitAlias = sheetHandleAt(sheet, { x: h.x, y: h.y }, 1.5);
			assert.equal(hitAlias, h.id);
		}
	});

	test("handleAtPoint respects tolerance radius", () => {
		assert.equal(handleAtPoint(sheet, { x: 10.8, y: 20.6 }, 1.5), "nw");
		assert.equal(handleAtPoint(sheet, { x: 15, y: 25 }, 1.5), null);
	});

	test("handleAtPoint returns null for invalid inputs", () => {
		assert.equal(handleAtPoint(null, { x: 10, y: 20 }), null);
		assert.equal(handleAtPoint(sheet, null), null);
	});
});

describe("pinPosition pure helper", () => {
	const sheet = { x: 10, y: 20, w: 40, h: 30 };

	test("calculates pin coordinates for all 4 sides with offset", () => {
		assert.deepEqual(pinPosition(sheet, "left", 8), { x: 10, y: 28 });
		assert.deepEqual(pinPosition(sheet, "right", 12), { x: 50, y: 32 });
		assert.deepEqual(pinPosition(sheet, "top", 15), { x: 25, y: 20 });
		assert.deepEqual(pinPosition(sheet, "bottom", 22), { x: 32, y: 50 });
	});

	test("supports pin object argument", () => {
		const pin = { side: "right", offset: 5 };
		assert.deepEqual(pinPosition(sheet, pin), { x: 50, y: 25 });
		assert.deepEqual(sheetPinPosition(sheet, pin), { x: 50, y: 25 });
	});

	test("defaults offset to zero when omitted", () => {
		assert.deepEqual(pinPosition(sheet, "left"), { x: 10, y: 20 });
		assert.deepEqual(pinPosition(sheet, "top"), { x: 10, y: 20 });
	});

	test("handles null sheet safely", () => {
		assert.deepEqual(pinPosition(null, "left", 5), { x: 0, y: 0 });
	});
});

describe("nextSheetPinName and nextFreeSheetPinName", () => {
	test("defaults to H1 when sheet has no existing pins", () => {
		assert.equal(nextSheetPinName({ pins: [] }), "H1");
		assert.equal(nextFreeSheetPinName({ pins: [] }), "H1");
	});

	test("increments sequentially when lower numbers are in use", () => {
		const sheet = {
			pins: [
				{ name: "H1", side: "left", offset: 5 },
				{ name: "H2", side: "left", offset: 10 },
			],
		};
		assert.equal(nextSheetPinName(sheet), "H3");
	});

	test("fills lowest unused gap in existing names", () => {
		const sheet = {
			pins: [
				{ name: "H1", side: "left", offset: 5 },
				{ name: "H3", side: "left", offset: 10 },
			],
		};
		assert.equal(nextSheetPinName(sheet), "H2");
	});

	test("accounts for annotations and nets with H-prefixed names", () => {
		const sheet = { pins: [{ name: "H1" }] };
		const annotations = [{ text: "H2" }];
		const nets = [{ name: "H3" }];
		assert.equal(nextSheetPinName(sheet, annotations, nets), "H4");
	});

	test("ignores non-H pin or net names", () => {
		const sheet = { pins: [{ name: "CLK" }, { name: "RESET" }] };
		const nets = [{ name: "VCC" }, { name: "GND" }];
		assert.equal(nextSheetPinName(sheet, [], nets), "H1");
	});
});

describe("sheet boundary and hit helpers", () => {
	const sheet = { x: 10, y: 20, w: 40, h: 30 };

	test("sheetBorderSideAndOffset identifies nearest side and computes offset", () => {
		const leftBorder = sheetBorderSideAndOffset(sheet, { x: 10.5, y: 25 });
		assert.equal(leftBorder?.side, "left");
		assert.equal(leftBorder?.offset, 5);

		const topBorder = sheetBorderSideAndOffset(sheet, { x: 25, y: 20.2 });
		assert.equal(topBorder?.side, "top");
		assert.equal(topBorder?.offset, 15);

		const farPoint = sheetBorderSideAndOffset(sheet, { x: 100, y: 100 });
		assert.equal(farPoint, null);
	});

	test("isPointInSheet checks point containment inside sheet rectangle", () => {
		assert.equal(isPointInSheet(sheet, { x: 20, y: 30 }), true);
		assert.equal(isPointInSheet(sheet, { x: 5, y: 30 }), false);
		assert.equal(isPointInSheet(sheet, { x: 20, y: 60 }), false);
	});

	test("isPointInSheetName hits sheet title label area", () => {
		const namedSheet = { ...sheet, name: "SubSheet1" };
		assert.equal(isPointInSheetName(namedSheet, { x: 12, y: 18 }), true);
		assert.equal(isPointInSheetName(namedSheet, { x: 12, y: 35 }), false);
	});

	test("sheetPinArrowPoints produces SVG coordinates for input and output pins", () => {
		const inputPin = { side: "left", offset: 5, type: "input" };
		const outputPin = { side: "right", offset: 5, type: "output" };
		const inputPts = sheetPinArrowPoints(sheet, inputPin);
		const outputPts = sheetPinArrowPoints(sheet, outputPin);
		assert.ok(typeof inputPts === "string" && inputPts.length > 0);
		assert.ok(typeof outputPts === "string" && outputPts.length > 0);
	});
});
