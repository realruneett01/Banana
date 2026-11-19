import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { snapPoint } from "../../frontend/src/editor/viewport.js";

const readRelative = (relPath) =>
	fs.readFileSync(new URL(relPath, import.meta.url), "utf8");

const makeSchematicContext = () => {
	const canvasText = readRelative(
		"../../frontend/src/editor/SchematicCanvas.jsx",
	);
	const startIdx = canvasText.indexOf("const SCH_GRID = 1.27;");
	const stopIdx = canvasText.indexOf("function distToSeg(");
	const stripped = canvasText
		.slice(startIdx, stopIdx)
		.replaceAll("export ", "");
	const factory = new Function(
		"snapPoint",
		[
			stripped,
			"return { isSchematicPart, nextFreeLabelName, buildWireSegments, snapPointToPinOrGrid };",
		].join("\n"),
	);
	return {
		canvasText,
		pure: factory(snapPoint),
	};
};

const { canvasText: schSrc, pure } = makeSchematicContext();
const {
	isSchematicPart,
	nextFreeLabelName,
	buildWireSegments,
	snapPointToPinOrGrid,
} = pure;
const annSrc = readRelative("../../frontend/src/editor/SchAnnotationLayer.jsx");

const checkIsSchematicPart = (items, expected) => {
	for (const item of items) {
		assert.equal(isSchematicPart(item), expected);
	}
};

describe("isSchematicPart pure function", () => {
	test("returns true for part with non-empty symbol string", () => {
		checkIsSchematicPart(
			[
				{ id: "p1", symbol: "Device:R" },
				{ id: "p2", symbol: "R" },
				{ id: "p3", symbol: "LED" },
			],
			true,
		);
	});

	test("returns false for part with empty or whitespace symbol string", () => {
		checkIsSchematicPart(
			[
				{ id: "p1", symbol: "" },
				{ id: "p2", symbol: "   " },
				{ id: "p3", symbol: "\t\n" },
			],
			false,
		);
	});

	test("returns false for part without symbol or with non-string symbol", () => {
		checkIsSchematicPart(
			[
				{ id: "p1" },
				{ id: "p2", symbol: null },
				{ id: "p3", symbol: undefined },
				{ id: "p4", symbol: 123 },
				{ id: "p5", symbol: {} },
			],
			false,
		);
	});

	test("returns false for null or undefined part", () => {
		checkIsSchematicPart([null, undefined], false);
	});
});

describe("label auto-naming for immediate placement", () => {
	test("auto names NET1 and TEXT without opening dialog", () => {
		const baselineLabels = [
			["label", "NET1"],
			["text", "TEXT"],
			["globalLabel", "G1"],
		];
		for (const [kind, expected] of baselineLabels) {
			assert.equal(nextFreeLabelName(kind, [], []), expected);
		}
	});

	test("increments past existing net and label names", () => {
		const existingAnns = ["NET1", "NET2"].map((text) => ({
			kind: "label",
			text,
		}));
		const assignedNets = [{ name: "NET3" }];
		assert.equal(
			nextFreeLabelName("label", existingAnns, assignedNets),
			"NET4",
		);
	});
});

describe("wire segment construction and snapping", () => {
	test("buildWireSegments builds orthogonal segments", () => {
		const origin = { x: 0, y: 0 };
		const target = { x: 10, y: 20 };
		const segs = buildWireSegments(origin, target);
		assert.equal(segs.length, 2);
		const expectedPairs = [
			{ x: 0, y: 0, x2: 10, y2: 0 },
			{ x: 10, y: 0, x2: 10, y2: 20 },
		];
		expectedPairs.forEach((targetSeg, index) => {
			assert.deepEqual(segs[index], targetSeg);
		});
	});

	test("snapPointToPinOrGrid snaps to nearby pin within tolerance", () => {
		const pinMap = new Map([["R1:1", [10, 20]]]);
		const res = snapPointToPinOrGrid({ x: 10.5, y: 20.2 }, pinMap, 1.27);
		for (const [key, expected] of [
			["x", 10],
			["y", 20],
		]) {
			assert.equal(res[key], expected);
		}
		assert.deepEqual(res.pin, { partId: "R1", pin: "1" });
	});
});

describe("Schematic Canvas UX source inspection", () => {
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
