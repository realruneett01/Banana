import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { distPointToSegment } from "../../frontend/src/editor/footprintRender.js";
import { snapPoint } from "../../frontend/src/editor/viewport.js";

const readSource = (relPath) =>
	fs.readFileSync(new URL(relPath, import.meta.url), "utf8");

function evalScope({ src, startMarker, endMarker, argName, argVal, names }) {
	const start = src.indexOf(startMarker);
	const end = src.indexOf(endMarker);
	const code = src.slice(start, end).replaceAll("export ", "");
	return new Function(argName, `${code}\nreturn { ${names.join(", ")} };`)(
		argVal,
	);
}

const canvasSrc = readSource("../../frontend/src/editor/SchematicCanvas.jsx");
const annotationSrc = readSource(
	"../../frontend/src/editor/SchAnnotationLayer.jsx",
);

const {
	nextFreeLabelName,
	buildWireSegments,
	findPinNearPoint,
	snapPointToPinOrGrid,
	findPinsConnectedByWires,
} = evalScope({
	src: canvasSrc,
	startMarker: "const SCH_GRID = 1.27;",
	endMarker: "function distToSeg(",
	argName: "snapPoint",
	argVal: snapPoint,
	names: [
		"nextFreeLabelName",
		"buildWireSegments",
		"findPinNearPoint",
		"snapPointToPinOrGrid",
		"findPinsConnectedByWires",
	],
});

const { hitTestAnnotation } = evalScope({
	src: annotationSrc,
	startMarker: "function isLineHit(",
	endMarker: "function renderSharedText(",
	argName: "distPointToSegment",
	argVal: distPointToSegment,
	names: ["hitTestAnnotation"],
});

const makeAnnList = (...pairs) => pairs.map(([kind, text]) => ({ kind, text }));

function checkLabelAllocations(expectedPairs, annotations = [], nets = []) {
	for (const [kind, expected] of expectedPairs) {
		assert.equal(nextFreeLabelName(kind, annotations, nets), expected);
	}
}

const makeWire = (x, y, x2, y2) => ({ kind: "wire", x, y, x2, y2 });

describe("nextFreeLabelName", () => {
	test("defaults to NET1, G1, H1, and TEXT on empty documents", () => {
		checkLabelAllocations([
			["label", "NET1"],
			["globalLabel", "G1"],
			["hierLabel", "H1"],
			["text", "TEXT"],
		]);
	});

	test("increments sequentially when lower numbers exist", () => {
		const annotations = [
			{ kind: "label", text: "NET1" },
			{ kind: "label", text: "NET2" },
			{ kind: "globalLabel", text: "G1" },
		];
		const nextLabel = nextFreeLabelName("label", annotations, []);
		const nextGlobal = nextFreeLabelName("globalLabel", annotations, []);
		assert.deepEqual([nextLabel, nextGlobal], ["NET3", "G2"]);
	});

	test("fills lowest unused gap", () => {
		const annotations = makeAnnList(
			["label", "NET1"],
			["label", "NET3"],
			["globalLabel", "G2"],
		);
		checkLabelAllocations(
			[
				["label", "NET2"],
				["globalLabel", "G1"],
			],
			annotations,
		);
	});

	test("respects names in nets array", () => {
		const nets = [{ id: "n1", name: "NET1", pins: [] }];
		assert.equal(nextFreeLabelName("label", [], nets), "NET2");
	});
});

describe("buildWireSegments", () => {
	test("returns empty array for identical points", () => {
		assert.deepEqual(buildWireSegments({ x: 10, y: 10 }, { x: 10, y: 10 }), []);
	});

	test("returns single horizontal or vertical segment", () => {
		const cases = [
			[{ x: 0, y: 5 }, { x: 10, y: 5 }, [{ x: 0, y: 5, x2: 10, y2: 5 }]],
			[{ x: 5, y: 0 }, { x: 5, y: 10 }, [{ x: 5, y: 0, x2: 5, y2: 10 }]],
		];
		for (const [p1, p2, expected] of cases) {
			assert.deepEqual(buildWireSegments(p1, p2), expected);
		}
	});

	test("returns orthogonal elbow for diagonal displacement (horizontal first)", () => {
		assert.deepEqual(buildWireSegments({ x: 0, y: 0 }, { x: 10, y: 20 }), [
			{ x: 0, y: 0, x2: 10, y2: 0 },
			{ x: 10, y: 0, x2: 10, y2: 20 },
		]);
	});

	test("returns orthogonal elbow for diagonal displacement (vertical first)", () => {
		const segs = buildWireSegments(
			{ x: 0, y: 0 },
			{ x: 10, y: 20 },
			"vertical-first",
		);
		const expectedElbow = [
			{ x: 0, y: 0, x2: 0, y2: 20 },
			{ x: 0, y: 20, x2: 10, y2: 20 },
		];
		assert.deepEqual(segs, expectedElbow);
	});
});

describe("findPinNearPoint and snapPointToPinOrGrid", () => {
	const allPinPos = new Map([
		["part_u1:1", [10, 20]],
		["part_u1:2", [20, 20]],
	]);

	test("finds pin within 1.27 grid radius", () => {
		assert.deepEqual(findPinNearPoint({ x: 10.5, y: 20.2 }, allPinPos, 1.27), {
			partId: "part_u1",
			pin: "1",
			x: 10,
			y: 20,
		});
	});

	test("returns null if beyond search radius", () => {
		assert.equal(findPinNearPoint({ x: 13, y: 20 }, allPinPos, 1.27), null);
	});

	test("snaps to pin coordinates when near pin", () => {
		const snapped = snapPointToPinOrGrid({ x: 10.5, y: 20.2 }, allPinPos);
		assert.deepEqual(snapped, {
			x: 10,
			y: 20,
			pin: { partId: "part_u1", pin: "1" },
		});
	});

	test("snaps to grid when not near pin", () => {
		const snapped = snapPointToPinOrGrid({ x: 13, y: 20 }, allPinPos);
		assert.deepEqual(
			[snapped.pin, typeof snapped.x, typeof snapped.y],
			[null, "number", "number"],
		);
	});
});

describe("findPinsConnectedByWires", () => {
	const allPinPos = new Map([
		["part_u1:1", [0, 0]],
		["part_u2:1", [20, 0]],
		["part_u3:1", [50, 50]],
	]);

	const expectedConnectedPair = [
		{
			partIdA: "part_u1",
			pinA: "1",
			partIdB: "part_u2",
			pinB: "1",
		},
	];

	test("returns empty array when no wire annotations exist", () => {
		assert.deepEqual(findPinsConnectedByWires([], allPinPos), []);
	});

	test("connects two pins via single wire segment", () => {
		const singleWire = [{ kind: "wire", x: 0, y: 0, x2: 20, y2: 0 }];
		const connected = findPinsConnectedByWires(singleWire, allPinPos);
		assert.deepEqual(connected, expectedConnectedPair);
	});

	test("connects two pins via multi-segment wire chain", () => {
		const chain = [makeWire(0, 0, 10, 0), makeWire(10, 0, 20, 0)];
		assert.deepEqual(
			findPinsConnectedByWires(chain, allPinPos),
			expectedConnectedPair,
		);
	});

	test("does not connect isolated pins", () => {
		assert.deepEqual(
			findPinsConnectedByWires([makeWire(0, 0, 10, 0)], allPinPos),
			[],
		);
	});
});

describe("hitTestAnnotation with wire and label", () => {
	const annotations = [
		{ id: "w-1", kind: "wire", x: 0, y: 0, x2: 10, y2: 0 },
		{ id: "lbl-1", kind: "label", x: 30, y: 30, text: "NET1" },
		{ id: "txt-1", kind: "text", x: 50, y: 50, text: "TEXT" },
	];

	const verifyHits = (entries) => {
		for (const [point, expectedId] of entries) {
			assert.equal(hitTestAnnotation(annotations, point, 1.27), expectedId);
		}
	};

	test("hits wire annotation along segment", () => {
		const hit = hitTestAnnotation(annotations, { x: 5, y: 0.2 }, 1.27);
		const miss = hitTestAnnotation(annotations, { x: 5, y: 5 }, 1.27);
		assert.deepEqual([hit, miss], ["w-1", null]);
	});

	test("hits label and text annotations", () => {
		verifyHits([
			[{ x: 30.5, y: 30.2 }, "lbl-1"],
			[{ x: 50.5, y: 50.2 }, "txt-1"],
		]);
	});
});

describe("SchematicCanvas source wiring verification", () => {
	const verifySourcePatterns = (patterns) => {
		for (const pattern of patterns) {
			assert.match(canvasSrc, pattern);
		}
	};

	test("exports required pure functions", () => {
		verifySourcePatterns([
			/export function nextFreeLabelName/,
			/export function buildWireSegments/,
			/export function findPinNearPoint/,
			/export function snapPointToPinOrGrid/,
			/export function findPinsConnectedByWires/,
		]);
	});

	test("wire pointer down commits segments and connects pins", () => {
		verifySourcePatterns([
			/function handleWirePointerDown/,
			/commitWireSegments/,
			/connectPinsIfTouched/,
		]);
	});

	test("escape key keeps committed segments", () => {
		assert.match(
			canvasSrc,
			/if \(ctx\.wireStart\) \{\s*ctx\.setWireStart\(null\);/,
		);
	});

	test("double click ends wire drawing", () => {
		assert.match(
			canvasSrc,
			/if \(s\.wire\.wireMode && s\.wire\.wireStart\) \{\s*s\.wire\.setWireStart\(null\);/,
		);
	});

	test("double click opens text modal for editing existing label", () => {
		assert.match(canvasSrc, /s\.annotationSession\.setTextModal\(ann\);/);
	});
});
