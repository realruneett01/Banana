import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
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
		return { isSchematicPart, nextFreeLabelName, buildWireSegments, snapPointToPinOrGrid };
	`,
	);
	return fn(snapPoint);
}

const {
	isSchematicPart,
	nextFreeLabelName,
	buildWireSegments,
	snapPointToPinOrGrid,
} = loadSchematicPureFunctions();

describe("isSchematicPart pure function", () => {
	test("returns true for part with non-empty symbol string", () => {
		assert.equal(isSchematicPart({ id: "p1", symbol: "Device:R" }), true);
		assert.equal(isSchematicPart({ id: "p2", symbol: "R" }), true);
		assert.equal(isSchematicPart({ id: "p3", symbol: "LED" }), true);
	});

	test("returns false for part with empty or whitespace symbol string", () => {
		assert.equal(isSchematicPart({ id: "p1", symbol: "" }), false);
		assert.equal(isSchematicPart({ id: "p2", symbol: "   " }), false);
		assert.equal(isSchematicPart({ id: "p3", symbol: "\t\n" }), false);
	});

	test("returns false for part without symbol or with non-string symbol", () => {
		assert.equal(isSchematicPart({ id: "p1" }), false);
		assert.equal(isSchematicPart({ id: "p2", symbol: null }), false);
		assert.equal(isSchematicPart({ id: "p3", symbol: undefined }), false);
		assert.equal(isSchematicPart({ id: "p4", symbol: 123 }), false);
		assert.equal(isSchematicPart({ id: "p5", symbol: {} }), false);
	});

	test("returns false for null or undefined part", () => {
		assert.equal(isSchematicPart(null), false);
		assert.equal(isSchematicPart(undefined), false);
	});
});

describe("label auto-naming for immediate placement", () => {
	test("auto names NET1 and TEXT without opening dialog", () => {
		assert.equal(nextFreeLabelName("label", [], []), "NET1");
		assert.equal(nextFreeLabelName("text", [], []), "TEXT");
		assert.equal(nextFreeLabelName("globalLabel", [], []), "G1");
	});

	test("increments past existing net and label names", () => {
		const annotations = [
			{ kind: "label", text: "NET1" },
			{ kind: "label", text: "NET2" },
		];
		const nets = [{ name: "NET3" }];
		assert.equal(nextFreeLabelName("label", annotations, nets), "NET4");
	});
});

describe("wire segment construction and snapping", () => {
	test("buildWireSegments builds orthogonal segments", () => {
		const segs = buildWireSegments({ x: 0, y: 0 }, { x: 10, y: 20 });
		assert.equal(segs.length, 2);
		assert.deepEqual(segs[0], { x: 0, y: 0, x2: 10, y2: 0 });
		assert.deepEqual(segs[1], { x: 10, y: 0, x2: 10, y2: 20 });
	});

	test("snapPointToPinOrGrid snaps to nearby pin within tolerance", () => {
		const pinMap = new Map([["R1:1", [10, 20]]]);
		const res = snapPointToPinOrGrid({ x: 10.5, y: 20.2 }, pinMap, 1.27);
		assert.equal(res.x, 10);
		assert.equal(res.y, 20);
		assert.deepEqual(res.pin, { partId: "R1", pin: "1" });
	});
});

describe("Schematic Canvas UX source inspection", () => {
	const schSrc = fs.readFileSync(
		new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
		"utf8",
	);
	const annSrc = fs.readFileSync(
		new URL(
			"../../frontend/src/editor/SchAnnotationLayer.jsx",
			import.meta.url,
		),
		"utf8",
	);

	test("AnnotationTextModal only opens when textModal.id is set (editing existing)", () => {
		assert.match(schSrc, /open=\{Boolean\(textModal\?\.id\)\}/);
	});

	test("resetToolMode clears textModal", () => {
		assert.match(
			schSrc,
			/function resetToolMode[\s\S]*?target\.setTextModal\?\.\(null\);/,
		);
	});

	test("useToolBus includes setTextModal in setters", () => {
		assert.match(schSrc, /setTextModal[\s\S]*?annotationSession/);
	});

	test("WireSvg returns null when polylines and label are empty", () => {
		assert.match(schSrc, /if \(polylines\.length === 0 && !lbl\) return null;/);
	});

	test("renderWireAnnotation applies schematic-wire class to line", () => {
		assert.match(annSrc, /cls:\s*"schematic-wire schematic-annotation"/);
	});

	test("SchematicPartsLayer filters parts with isSchematicPart", () => {
		assert.match(
			schSrc,
			/\(parts \?\? \[\]\)[\s\S]*?\.filter\(isSchematicPart\)[\s\S]*?\.map/,
		);
	});

	test("schematicHitTest filters parts with isSchematicPart", () => {
		assert.match(schSrc, /parts:\s*doc\.ir\.parts\.filter\(isSchematicPart\)/);
	});

	test("commitBoxSelect filters parts with isSchematicPart", () => {
		assert.match(schSrc, /parts:\s*doc\.ir\.parts\.filter\(isSchematicPart\)/);
	});

	test("getSchematicBounds filters parts with isSchematicPart", () => {
		assert.match(
			schSrc,
			/\(doc\?\.ir\?\.parts \?\? \[\]\)\.filter\(isSchematicPart\)/,
		);
	});

	test("buildAllPinMap filters parts with isSchematicPart", () => {
		assert.match(schSrc, /\(parts \?\? \[\]\)\.filter\(isSchematicPart\)/);
	});

	test("single export of isSchematicPart", () => {
		const matches = schSrc.match(/export\s+.*isSchematicPart/g);
		assert.equal(matches?.length, 1);
	});
});
