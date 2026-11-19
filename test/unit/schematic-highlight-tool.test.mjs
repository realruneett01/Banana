import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { netItemsAt } from "../../frontend/src/editor/netHighlight.js";
import {
	PCB_TOOLS,
	SCHEMATIC_TOOLS,
} from "../../frontend/src/editor/toolPalettes.js";

const SCHEMATIC_CANVAS_SRC = fs.readFileSync(
	new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
	"utf8",
);

function extractCodeSlice(source, startMarker, endMarker, stripExport = false) {
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker);
	const section = source.slice(start, end);
	return stripExport ? section.replaceAll("export ", "") : section;
}

function compileHighlightFunctions(source) {
	const codeBlocks = [
		extractCodeSlice(
			source,
			"export function findPinNearPoint(",
			"function distToSeg(",
			true,
		),
		extractCodeSlice(
			source,
			"function testWireHitWithMap(",
			"function testJunctionHit(",
		),
		extractCodeSlice(
			source,
			"function findNetByNameOrId(",
			"function findHighlightedWireAnnotations(",
			true,
		),
	];

	const factory = new Function(
		"netItemsAt",
		`${codeBlocks.join("\n")}\nreturn { resolveNetForHit };`,
	);
	return factory(netItemsAt);
}

const { resolveNetForHit } = compileHighlightFunctions(SCHEMATIC_CANVAS_SRC);

function assertPaletteTool(palette, toolId, expected) {
	const item = palette.find((entry) => entry.id === toolId);
	assert.ok(item, `${toolId} tool exists in palette`);
	for (const [key, value] of Object.entries(expected)) {
		assert.equal(item[key], value);
	}
}

function createSchematicFixture() {
	const parts = ["R1", "R2"].map((name) => ({
		id: name,
		ref: name,
		pins: ["1", "2"],
	}));

	const nets = [
		{ id: "n-vcc", name: "VCC", pin: "1" },
		{ id: "n-gnd", name: "GND", pin: "2" },
	].map(({ id, name, pin }) => ({
		id,
		name,
		pins: parts.map((part) => ({ partId: part.id, pin })),
	}));

	const annotations = [
		{ id: "w1", kind: "wire", x: 10, y: 10, x2: 20, y2: 10 },
		{ id: "lbl1", kind: "label", x: 10, y: 10, text: "VCC" },
		{ id: "lbl2", kind: "globalLabel", x: 30, y: 30, text: "GND" },
		{ id: "junc1", kind: "junction", x: 10, y: 10 },
	];

	const pinLocations = new Map([
		["R1:1", [10, 10]],
		["R1:2", [10, 30]],
		["R2:1", [20, 10]],
		["R2:2", [20, 30]],
	]);

	return {
		ir: { parts, nets, annotations },
		allPinPos: pinLocations,
	};
}

function verifyResolvedNet(hit, expected, fixture) {
	const res = resolveNetForHit(hit, fixture.ir, fixture.allPinPos);
	if (expected === null) {
		assert.equal(res, null);
		return;
	}
	assert.ok(res, "expected resolved net hit");
	if (expected.netName !== undefined) {
		assert.equal(res.netName, expected.netName);
	}
	if (expected.netId !== undefined) {
		assert.equal(res.netId, expected.netId);
	}
	if (expected.partId !== undefined) {
		assert.equal(res.partIds.has(expected.partId), true);
	}
}

function assertMatchesPatterns(source, patterns) {
	for (const pattern of patterns) {
		assert.match(source, pattern);
	}
}

describe("Highlight Net palette configuration", () => {
	test("schematic highlightNet tool is enabled and ready", () => {
		assertPaletteTool(SCHEMATIC_TOOLS, "highlightNet", {
			ready: true,
			hotkey: "backquote",
			label: "Highlight net",
			icon: "net",
		});
	});

	test("pcb highlightNet tool is enabled and ready", () => {
		assertPaletteTool(PCB_TOOLS, "highlightNet", {
			ready: true,
		});
	});
});

describe("resolveNetForHit pure function", () => {
	const fixture = createSchematicFixture();
	const checkHit = (hit, expected) => verifyResolvedNet(hit, expected, fixture);

	test("resolves net from a pin hit", () => {
		checkHit(
			{ kind: "pin", id: "R1", pin: "1" },
			{ netId: "n-vcc", netName: "VCC", partId: "R1" },
		);
	});

	test("resolves net from a wire hit", () => {
		checkHit({ kind: "wire", id: "n-gnd" }, { netId: "n-gnd", netName: "GND" });
	});

	test("resolves net from a wire annotation hit touching pins", () => {
		checkHit(
			{ kind: "annotation", id: "w1" },
			{ netId: "n-vcc", netName: "VCC" },
		);
	});

	test("resolves net from a label annotation hit by text", () => {
		checkHit({ kind: "annotation", id: "lbl1" }, { netName: "VCC" });
		checkHit({ kind: "annotation", id: "lbl2" }, { netName: "GND" });
	});

	test("resolves net from a junction annotation hit", () => {
		checkHit({ kind: "annotation", id: "junc1" }, { netName: "VCC" });
	});

	test("resolves net from an IR junction hit object", () => {
		checkHit({ kind: "junction", x: 10, y: 10 }, { netName: "VCC" });
	});

	test("returns null for empty canvas or null hit", () => {
		checkHit(null, null);
		checkHit(undefined, null);
	});

	test("returns null for hit on unrelated part body", () => {
		checkHit({ kind: "part", id: "R1" }, null);
	});
});

describe("SchematicCanvas highlight net implementation checks", () => {
	test("handleBusTool activates highlightNet mode", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/tool === "highlightNet"[\s\S]*?setters\.setHighlightMode\(true\)/,
		]);
	});

	test("reportActiveTool reports highlightNet when active", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/else if \(highlightMode\)[\s\S]*?emitActiveTool\(\{\s*tab:\s*"schematic",\s*tool:\s*"highlightNet",\s*item:\s*null\s*\}\)/,
		]);
	});

	test("backquote hotkey handles hover highlight and tool arming", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/function handleBackquoteKey/,
			/e\.key === "`" \|\| e\.code === "Backquote"/,
			/const net = resolveNetForHit[\s\S]*?ctx\.setHighlightNet\?\.\(net\)/,
		]);
	});

	test("pointer down in highlightMode sets highlightNet and consumes click", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/if \(hitCtx\.highlightMode\) return;/,
		]);
	});

	test("Escape key clears highlight and resets tool mode", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/function handleEscapeKey[\s\S]*?ctx\.setHighlightNet\?\.\(null\)/,
		]);
	});

	test("SchematicSvgScene dims background to 0.35 opacity when net is highlighted", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/const isDimmed = Boolean\(highlightNet\);/,
			/<g opacity=\{isDimmed \? 0\.35 : 1\}>/,
		]);
	});

	test("SchematicNetHighlightLayer draws highlighted wires and pin rings", () => {
		assertMatchesPatterns(SCHEMATIC_CANVAS_SRC, [
			/function SchematicNetHighlightLayer/,
			/strokeWidth=\{0\.6\}/,
			/strokeWidth=\{0\.5\}/,
		]);
	});
});
