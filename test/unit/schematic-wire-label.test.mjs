import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { distPointToSegment } from "../../frontend/src/editor/footprintRender.js";
import { snapPoint } from "../../frontend/src/editor/viewport.js";

function loadSchematicPureFunctions() {
	const src = fs.readFileSync(
		new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
		"utf8",
	);
	const start = src.indexOf("const SCH_GRID = 1.27;");
	const end = src.indexOf("function distToSeg(");
	const code = src.slice(start, end).replaceAll("export ", "");
	const fn = new Function(
		"snapPoint",
		`
		${code}
		return { nextFreeLabelName, buildWireSegments, findPinNearPoint, snapPointToPinOrGrid, findPinsConnectedByWires };
	`,
	);
	return fn(snapPoint);
}

function loadSchAnnotationPureFunctions() {
	const src = fs.readFileSync(
		new URL(
			"../../frontend/src/editor/SchAnnotationLayer.jsx",
			import.meta.url,
		),
		"utf8",
	);
	const start = src.indexOf("function isLineHit(");
	const end = src.indexOf("function renderSharedText(");
	const code = src.slice(start, end).replaceAll("export ", "");
	const fn = new Function(
		"distPointToSegment",
		`
		${code}
		return { isLineHit, isPointHit, isTextHit, isAnnotationHit, hitTestAnnotation };
	`,
	);
	return fn(distPointToSegment);
}

const {
	nextFreeLabelName,
	buildWireSegments,
	findPinNearPoint,
	snapPointToPinOrGrid,
	findPinsConnectedByWires,
} = loadSchematicPureFunctions();

const { hitTestAnnotation } = loadSchAnnotationPureFunctions();

describe("nextFreeLabelName", () => {
	test("defaults to NET1, G1, H1, and TEXT on empty documents", () => {
		assert.equal(nextFreeLabelName("label", [], []), "NET1");
		assert.equal(nextFreeLabelName("globalLabel", [], []), "G1");
		assert.equal(nextFreeLabelName("hierLabel", [], []), "H1");
		assert.equal(nextFreeLabelName("text", [], []), "TEXT");
	});

	test("increments sequentially when lower numbers exist", () => {
		const annotations = [
			{ kind: "label", text: "NET1" },
			{ kind: "label", text: "NET2" },
			{ kind: "globalLabel", text: "G1" },
		];
		assert.equal(nextFreeLabelName("label", annotations, []), "NET3");
		assert.equal(nextFreeLabelName("globalLabel", annotations, []), "G2");
	});

	test("fills lowest unused gap", () => {
		const annotations = [
			{ kind: "label", text: "NET1" },
			{ kind: "label", text: "NET3" },
			{ kind: "globalLabel", text: "G2" },
		];
		assert.equal(nextFreeLabelName("label", annotations, []), "NET2");
		assert.equal(nextFreeLabelName("globalLabel", annotations, []), "G1");
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
		const h = buildWireSegments({ x: 0, y: 5 }, { x: 10, y: 5 });
		assert.deepEqual(h, [{ x: 0, y: 5, x2: 10, y2: 5 }]);

		const v = buildWireSegments({ x: 5, y: 0 }, { x: 5, y: 10 });
		assert.deepEqual(v, [{ x: 5, y: 0, x2: 5, y2: 10 }]);
	});

	test("returns orthogonal elbow for diagonal displacement (horizontal first)", () => {
		const segs = buildWireSegments({ x: 0, y: 0 }, { x: 10, y: 20 });
		assert.deepEqual(segs, [
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
		assert.deepEqual(segs, [
			{ x: 0, y: 0, x2: 0, y2: 20 },
			{ x: 0, y: 20, x2: 10, y2: 20 },
		]);
	});
});

describe("findPinNearPoint and snapPointToPinOrGrid", () => {
	const allPinPos = new Map([
		["part_u1:1", [10, 20]],
		["part_u1:2", [20, 20]],
	]);

	test("finds pin within 1.27 grid radius", () => {
		const pin = findPinNearPoint({ x: 10.5, y: 20.2 }, allPinPos, 1.27);
		assert.deepEqual(pin, { partId: "part_u1", pin: "1", x: 10, y: 20 });
	});

	test("returns null if beyond search radius", () => {
		const pin = findPinNearPoint({ x: 13, y: 20 }, allPinPos, 1.27);
		assert.equal(pin, null);
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
		assert.equal(snapped.pin, null);
		assert.equal(typeof snapped.x, "number");
		assert.equal(typeof snapped.y, "number");
	});
});

describe("findPinsConnectedByWires", () => {
	const allPinPos = new Map([
		["part_u1:1", [0, 0]],
		["part_u2:1", [20, 0]],
		["part_u3:1", [50, 50]],
	]);

	test("returns empty array when no wire annotations exist", () => {
		assert.deepEqual(findPinsConnectedByWires([], allPinPos), []);
	});

	test("connects two pins via single wire segment", () => {
		const wires = [{ kind: "wire", x: 0, y: 0, x2: 20, y2: 0 }];
		const pairs = findPinsConnectedByWires(wires, allPinPos);
		assert.equal(pairs.length, 1);
		assert.deepEqual(pairs[0], {
			partIdA: "part_u1",
			pinA: "1",
			partIdB: "part_u2",
			pinB: "1",
		});
	});

	test("connects two pins via multi-segment wire chain", () => {
		const wires = [
			{ kind: "wire", x: 0, y: 0, x2: 10, y2: 0 },
			{ kind: "wire", x: 10, y: 0, x2: 20, y2: 0 },
		];
		const pairs = findPinsConnectedByWires(wires, allPinPos);
		assert.equal(pairs.length, 1);
		assert.deepEqual(pairs[0], {
			partIdA: "part_u1",
			pinA: "1",
			partIdB: "part_u2",
			pinB: "1",
		});
	});

	test("does not connect isolated pins", () => {
		const wires = [{ kind: "wire", x: 0, y: 0, x2: 10, y2: 0 }];
		const pairs = findPinsConnectedByWires(wires, allPinPos);
		assert.deepEqual(pairs, []);
	});
});

describe("hitTestAnnotation with wire and label", () => {
	const annotations = [
		{ id: "w-1", kind: "wire", x: 0, y: 0, x2: 10, y2: 0 },
		{ id: "lbl-1", kind: "label", x: 30, y: 30, text: "NET1" },
		{ id: "txt-1", kind: "text", x: 50, y: 50, text: "TEXT" },
	];

	test("hits wire annotation along segment", () => {
		assert.equal(hitTestAnnotation(annotations, { x: 5, y: 0.2 }, 1.27), "w-1");
		assert.equal(hitTestAnnotation(annotations, { x: 5, y: 5 }, 1.27), null);
	});

	test("hits label and text annotations", () => {
		assert.equal(
			hitTestAnnotation(annotations, { x: 30.5, y: 30.2 }, 1.27),
			"lbl-1",
		);
		assert.equal(
			hitTestAnnotation(annotations, { x: 50.5, y: 50.2 }, 1.27),
			"txt-1",
		);
	});
});

describe("SchematicCanvas source wiring verification", () => {
	const src = fs.readFileSync(
		new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
		"utf8",
	);

	test("exports required pure functions", () => {
		assert.match(src, /export function nextFreeLabelName/);
		assert.match(src, /export function buildWireSegments/);
		assert.match(src, /export function findPinNearPoint/);
		assert.match(src, /export function snapPointToPinOrGrid/);
		assert.match(src, /export function findPinsConnectedByWires/);
	});

	test("wire pointer down commits segments and connects pins", () => {
		assert.match(src, /function handleWirePointerDown/);
		assert.match(src, /commitWireSegments/);
		assert.match(src, /connectPinsIfTouched/);
	});

	test("escape key keeps committed segments", () => {
		assert.match(src, /if \(ctx\.wireStart\) \{\s*ctx\.setWireStart\(null\);/);
	});

	test("double click ends wire drawing", () => {
		assert.match(
			src,
			/if \(s\.wire\.wireMode && s\.wire\.wireStart\) \{\s*s\.wire\.setWireStart\(null\);/,
		);
	});

	test("double click opens text modal for editing existing label", () => {
		assert.match(src, /s\.annotationSession\.setTextModal\(ann\);/);
	});
});
