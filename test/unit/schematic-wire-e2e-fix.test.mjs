import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

describe("Schematic Canvas pin rendering and wire e2e fix", () => {
	const schSrc = fs.readFileSync(
		new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
		"utf8",
	);

	test("ArmedGhostMarker passes isGhost={true} to PartSvg", () => {
		assert.match(
			schSrc,
			/<PartSvg[\s\S]*?part=\{geom\.dummyPart\}[\s\S]*?isGhost=\{true\}/,
		);
	});

	test("SymbolPartSvg uses schematic-ghost-part class when isGhost is true", () => {
		assert.match(
			schSrc,
			/className=\{isGhost \? "schematic-ghost-part" : "schematic-part"\}/,
		);
	});

	test("BoxPartSvg uses schematic-ghost-part class when isGhost is true", () => {
		assert.match(
			schSrc,
			/className=\{\s*isGhost \? "schematic-ghost-part" : "schematic-part"\s*\}/,
		);
	});

	test("SymbolPin suppresses pin circle when isGhost is true", () => {
		assert.match(
			schSrc,
			/function SymbolPin\(\{[\s\S]*?isGhost = false[\s\S]*?\}\) \{[\s\S]*?!isGhost && \([\s\S]*?<circle[\s\S]*?r=\{0\.65\}/,
		);
	});

	test("BoxPartPins returns null when isGhost is true", () => {
		assert.match(
			schSrc,
			/function BoxPartPins\(\{[\s\S]*?isGhost = false[\s\S]*?\}\) \{\s*if \(isGhost\) return null;/,
		);
	});

	test("WireHoverMarker renders hover target when wireMode is armed", () => {
		assert.match(schSrc, /function WireHoverMarker/);
		assert.match(schSrc, /className="schematic-pin-hover"/);
		assert.match(schSrc, /<WireHoverMarker/);
	});

	test("handlePinConnect retrieves pin coordinates from allPinPos", () => {
		assert.match(
			schSrc,
			/function handlePinConnect\(hit, wireState, dispatchCmd\) \{[\s\S]*?allPinPos\?\.get\?\.\(`\$\{hit\.id\}:\$\{hit\.pin\}`\)/,
		);
	});

	test("preserves annotationSession.setTextModal call", () => {
		assert.match(schSrc, /s\.annotationSession\.setTextModal\(ann\);/);
	});
});
