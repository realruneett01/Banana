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
		// Fallback for Node test environments lacking JSX loader support
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
		assert.deepEqual(rectFromPoints({ x: 10, y: 20 }, { x: 50, y: 70 }), {
			x: 10,
			y: 20,
			w: 40,
			h: 50,
		});
	});

	test("normalizes rect from bottom-right to top-left inverted drag", () => {
		const [dragStart, dragEnd] = [
			{ x: 50, y: 70 },
			{ x: 10, y: 20 },
		];
		assert.deepEqual(rectFromPoints(dragStart, dragEnd), {
			x: 10,
			y: 20,
			w: 40,
			h: 50,
		});
	});

	test("enforces minimum size of 10 x 10 mm when drag displacement is smaller", () => {
		const small = rectFromPoints({ x: 15, y: 25 }, { x: 18, y: 28 });
		assert.equal(`${small.x},${small.y},${small.w},${small.h}`, "15,25,10,10");
	});

	test("enforces minimum size for zero-distance click", () => {
		const clickPt = { x: 30, y: 40 };
		assert.deepEqual(rectFromPoints(clickPt, clickPt), {
			...clickPt,
			w: 10,
			h: 10,
		});
	});

	test("handles missing or partial coordinates safely", () => {
		assert.deepEqual(rectFromPoints(null, null), { x: 0, y: 0, w: 10, h: 10 });
	});
});

describe("sheet handles and handle hit-testing", () => {
	const sheet = { id: "s1", x: 10, y: 20, w: 40, h: 30 };

	test("getSheetHandles generates 8 handles with correct coordinates", () => {
		const handles = getSheetHandles(sheet);
		const ids = handles.map((h) => h.id);
		const expectedCoordinates = Object.fromEntries([
			["nw", { x: 10, y: 20 }],
			["n", { x: 30, y: 20 }],
			["ne", { x: 50, y: 20 }],
			["e", { x: 50, y: 35 }],
			["se", { x: 50, y: 50 }],
			["s", { x: 30, y: 50 }],
			["sw", { x: 10, y: 50 }],
			["w", { x: 10, y: 35 }],
		]);
		const coordsById = Object.fromEntries(
			handles.map((h) => [h.id, { x: h.x, y: h.y }]),
		);
		assert.deepEqual(
			{ ids, coords: coordsById },
			{
				ids: ["nw", "n", "ne", "e", "se", "s", "sw", "w"],
				coords: expectedCoordinates,
			},
		);
	});

	test("handleAtPoint hits each of the 8 handles exactly", () => {
		for (const h of getSheetHandles(sheet)) {
			const pt = { x: h.x, y: h.y };
			const hit = handleAtPoint(sheet, pt, 1.5);
			const aliasHit = sheetHandleAt(sheet, pt, 1.5);
			assert.deepEqual([hit, aliasHit], [h.id, h.id]);
		}
	});

	test("handleAtPoint respects tolerance radius", () => {
		const hitWithin = handleAtPoint(sheet, { x: 10.8, y: 20.6 }, 1.5);
		const hitOutside = handleAtPoint(sheet, { x: 15, y: 25 }, 1.5);
		assert.deepEqual(
			{ hitWithin, hitOutside },
			{ hitWithin: "nw", hitOutside: null },
		);
	});

	test("handleAtPoint returns null for invalid inputs", () => {
		const bad1 = handleAtPoint(null, { x: 10, y: 20 });
		const bad2 = handleAtPoint(sheet, null);
		assert.ok(bad1 === null && bad2 === null);
	});
});

describe("pinPosition pure helper", () => {
	const sheet = { x: 10, y: 20, w: 40, h: 30 };

	test("calculates pin coordinates for all 4 sides with offset", () => {
		const positions = {
			left: pinPosition(sheet, "left", 8),
			right: pinPosition(sheet, "right", 12),
			top: pinPosition(sheet, "top", 15),
			bottom: pinPosition(sheet, "bottom", 22),
		};
		assert.deepEqual(positions, {
			left: { x: 10, y: 28 },
			right: { x: 50, y: 32 },
			top: { x: 25, y: 20 },
			bottom: { x: 32, y: 50 },
		});
	});

	test("supports pin object argument", () => {
		const pin = { side: "right", offset: 5 };
		const p1 = pinPosition(sheet, pin);
		const p2 = sheetPinPosition(sheet, pin);
		assert.deepEqual(
			{ p1, p2 },
			{ p1: { x: 50, y: 25 }, p2: { x: 50, y: 25 } },
		);
	});

	test("defaults offset to zero when omitted", () => {
		const origin = { x: 10, y: 20 };
		const sides = ["left", "top"].map((side) => pinPosition(sheet, side));
		assert.deepEqual(sides, [origin, origin]);
	});

	test("handles null sheet safely", () => {
		assert.deepEqual(pinPosition(null, "left", 5), { x: 0, y: 0 });
	});
});

describe("nextSheetPinName and nextFreeSheetPinName", () => {
	test("defaults to H1 when sheet has no existing pins", () => {
		const emptySheet = { pins: [] };
		assert.equal(
			`${nextSheetPinName(emptySheet)}:${nextFreeSheetPinName(emptySheet)}`,
			"H1:H1",
		);
	});

	test("increments sequentially when lower numbers are in use", () => {
		const activeSheet = {
			pins: [
				{ name: "H1", side: "left", offset: 5 },
				{ name: "H2", side: "left", offset: 10 },
			],
		};
		assert.equal(nextSheetPinName(activeSheet), "H3");
	});

	test("fills lowest unused gap in existing names", () => {
		const gappedList = [
			{ name: "H1", offset: 5 },
			{ name: "H3", offset: 10 },
		];
		assert.equal(nextSheetPinName({ pins: gappedList }), "H2");
	});

	test("accounts for annotations and nets with H-prefixed names", () => {
		const sheetWithH1 = { pins: [{ name: "H1" }] };
		const hAnnotations = [{ text: "H2" }];
		const hNets = [{ name: "H3" }];
		assert.equal(nextSheetPinName(sheetWithH1, hAnnotations, hNets), "H4");
	});

	test("ignores non-H pin or net names", () => {
		const namedPins = [{ name: "CLK" }, { name: "RESET" }];
		const otherNets = [{ name: "VCC" }, { name: "GND" }];
		assert.equal(nextSheetPinName({ pins: namedPins }, [], otherNets), "H1");
	});
});

describe("sheet boundary and hit helpers", () => {
	const sheet = { x: 10, y: 20, w: 40, h: 30 };

	test("sheetBorderSideAndOffset identifies nearest side and computes offset", () => {
		const borders = {
			left: sheetBorderSideAndOffset(sheet, { x: 10.5, y: 25 }),
			top: sheetBorderSideAndOffset(sheet, { x: 25, y: 20.2 }),
			far: sheetBorderSideAndOffset(sheet, { x: 100, y: 100 }),
		};
		assert.deepEqual(borders, {
			left: { side: "left", offset: 5 },
			top: { side: "top", offset: 15 },
			far: null,
		});
	});

	test("isPointInSheet checks point containment inside sheet rectangle", () => {
		const hits = [
			isPointInSheet(sheet, { x: 20, y: 30 }),
			isPointInSheet(sheet, { x: 5, y: 30 }),
			isPointInSheet(sheet, { x: 20, y: 60 }),
		];
		assert.deepEqual(hits, [true, false, false]);
	});

	test("isPointInSheetName hits sheet title label area", () => {
		const namedSheet = { ...sheet, name: "SubSheet1" };
		const onTitle = isPointInSheetName(namedSheet, { x: 12, y: 18 });
		const onBody = isPointInSheetName(namedSheet, { x: 12, y: 35 });
		assert.equal(`${onTitle}/${onBody}`, "true/false");
	});

	test("sheetPinArrowPoints produces SVG coordinates for input and output pins", () => {
		const inArrow = sheetPinArrowPoints(sheet, {
			side: "left",
			offset: 5,
			type: "input",
		});
		const outArrow = sheetPinArrowPoints(sheet, {
			side: "right",
			offset: 5,
			type: "output",
		});
		assert.ok(
			inArrow &&
				outArrow &&
				typeof inArrow === "string" &&
				typeof outArrow === "string",
		);
	});
});
