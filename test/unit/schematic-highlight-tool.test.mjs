import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { netItemsAt } from "../../frontend/src/editor/netHighlight.js";
import {
	PCB_TOOLS,
	SCHEMATIC_TOOLS,
} from "../../frontend/src/editor/toolPalettes.js";

function loadPureHighlightFunctions() {
	const schSrc = fs.readFileSync(
		new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
		"utf8",
	);

	const p1Start = schSrc.indexOf("export function findPinNearPoint(");
	const p1End = schSrc.indexOf("function distToSeg(");
	const p1Code = schSrc.slice(p1Start, p1End).replaceAll("export ", "");

	const p2Start = schSrc.indexOf("function testWireHitWithMap(");
	const p2End = schSrc.indexOf("function testJunctionHit(");
	const p2Code = schSrc.slice(p2Start, p2End);

	const p3Start = schSrc.indexOf("function findNetByNameOrId(");
	const p3End = schSrc.indexOf("function findHighlightedWireAnnotations(");
	const p3Code = schSrc.slice(p3Start, p3End).replaceAll("export ", "");

	const factory = new Function(
		"netItemsAt",
		`
		${p1Code}
		${p2Code}
		${p3Code}
		return { resolveNetForHit, findPinNearPoint, testWireHitWithMap };
	`,
	);
	return factory(netItemsAt);
}

const { resolveNetForHit } = loadPureHighlightFunctions();

describe("Highlight Net palette configuration", () => {
	test("schematic highlightNet tool is enabled and ready", () => {
		const tool = SCHEMATIC_TOOLS.find((t) => t.id === "highlightNet");
		assert.ok(tool, "highlightNet tool exists in schematic palette");
		assert.equal(tool.ready, true);
		assert.equal(tool.hotkey, "backquote");
		assert.equal(tool.label, "Highlight net");
		assert.equal(tool.icon, "net");
	});

	test("pcb highlightNet tool is enabled and ready", () => {
		const tool = PCB_TOOLS.find((t) => t.id === "highlightNet");
		assert.ok(tool, "highlightNet tool exists in pcb palette");
		assert.equal(tool.ready, true);
	});
});

describe("resolveNetForHit pure function", () => {
	const ir = {
		parts: [
			{ id: "R1", ref: "R1", pins: ["1", "2"] },
			{ id: "R2", ref: "R2", pins: ["1", "2"] },
		],
		nets: [
			{
				id: "n-vcc",
				name: "VCC",
				pins: [
					{ partId: "R1", pin: "1" },
					{ partId: "R2", pin: "1" },
				],
			},
			{
				id: "n-gnd",
				name: "GND",
				pins: [
					{ partId: "R1", pin: "2" },
					{ partId: "R2", pin: "2" },
				],
			},
		],
		annotations: [
			{ id: "w1", kind: "wire", x: 10, y: 10, x2: 20, y2: 10 },
			{ id: "lbl1", kind: "label", x: 10, y: 10, text: "VCC" },
			{ id: "lbl2", kind: "globalLabel", x: 30, y: 30, text: "GND" },
			{ id: "junc1", kind: "junction", x: 10, y: 10 },
		],
	};

	const allPinPos = new Map([
		["R1:1", [10, 10]],
		["R1:2", [10, 30]],
		["R2:1", [20, 10]],
		["R2:2", [20, 30]],
	]);

	test("resolves net from a pin hit", () => {
		const hit = { kind: "pin", id: "R1", pin: "1" };
		const res = resolveNetForHit(hit, ir, allPinPos);
		assert.ok(res);
		assert.equal(res.netId, "n-vcc");
		assert.equal(res.netName, "VCC");
		assert.equal(res.partIds.has("R1"), true);
	});

	test("resolves net from a wire hit", () => {
		const hit = { kind: "wire", id: "n-gnd" };
		const res = resolveNetForHit(hit, ir, allPinPos);
		assert.ok(res);
		assert.equal(res.netId, "n-gnd");
		assert.equal(res.netName, "GND");
	});

	test("resolves net from a wire annotation hit touching pins", () => {
		const hit = { kind: "annotation", id: "w1" };
		const res = resolveNetForHit(hit, ir, allPinPos);
		assert.ok(res);
		assert.equal(res.netId, "n-vcc");
		assert.equal(res.netName, "VCC");
	});

	test("resolves net from a label annotation hit by text", () => {
		const hit1 = { kind: "annotation", id: "lbl1" };
		const res1 = resolveNetForHit(hit1, ir, allPinPos);
		assert.ok(res1);
		assert.equal(res1.netName, "VCC");

		const hit2 = { kind: "annotation", id: "lbl2" };
		const res2 = resolveNetForHit(hit2, ir, allPinPos);
		assert.ok(res2);
		assert.equal(res2.netName, "GND");
	});

	test("resolves net from a junction annotation hit", () => {
		const hit = { kind: "annotation", id: "junc1" };
		const res = resolveNetForHit(hit, ir, allPinPos);
		assert.ok(res);
		assert.equal(res.netName, "VCC");
	});

	test("resolves net from an IR junction hit object", () => {
		const hit = { kind: "junction", x: 10, y: 10 };
		const res = resolveNetForHit(hit, ir, allPinPos);
		assert.ok(res);
		assert.equal(res.netName, "VCC");
	});

	test("returns null for empty canvas or null hit", () => {
		assert.equal(resolveNetForHit(null, ir, allPinPos), null);
		assert.equal(resolveNetForHit(undefined, ir, allPinPos), null);
	});

	test("returns null for hit on unrelated part body", () => {
		const hit = { kind: "part", id: "R1" };
		assert.equal(resolveNetForHit(hit, ir, allPinPos), null);
	});
});

describe("SchematicCanvas highlight net implementation checks", () => {
	const src = fs.readFileSync(
		new URL("../../frontend/src/editor/SchematicCanvas.jsx", import.meta.url),
		"utf8",
	);

	test("handleBusTool activates highlightNet mode", () => {
		assert.match(
			src,
			/tool === "highlightNet"[\s\S]*?setters\.setHighlightMode\(true\)/,
		);
	});

	test("reportActiveTool reports highlightNet when active", () => {
		assert.match(
			src,
			/else if \(highlightMode\)[\s\S]*?emitActiveTool\(\{\s*tab:\s*"schematic",\s*tool:\s*"highlightNet",\s*item:\s*null\s*\}\)/,
		);
	});

	test("backquote hotkey handles hover highlight and tool arming", () => {
		assert.match(src, /function handleBackquoteKey/);
		assert.match(src, /e\.key === "`" \|\| e\.code === "Backquote"/);
		assert.match(
			src,
			/const net = resolveNetForHit[\s\S]*?ctx\.setHighlightNet\?\.\(net\)/,
		);
	});

	test("pointer down in highlightMode sets highlightNet and consumes click", () => {
		assert.match(src, /if \(hitCtx\.highlightMode\) return;/);
	});

	test("Escape key clears highlight and resets tool mode", () => {
		assert.match(
			src,
			/function handleEscapeKey[\s\S]*?ctx\.setHighlightNet\?\.\(null\)/,
		);
	});

	test("SchematicSvgScene dims background to 0.35 opacity when net is highlighted", () => {
		assert.match(src, /const isDimmed = Boolean\(highlightNet\);/);
		assert.match(src, /<g opacity=\{isDimmed \? 0\.35 : 1\}>/);
	});

	test("SchematicNetHighlightLayer draws highlighted wires and pin rings", () => {
		assert.match(src, /function SchematicNetHighlightLayer/);
		assert.match(src, /strokeWidth=\{0\.6\}/);
		assert.match(src, /strokeWidth=\{0\.5\}/);
	});
});
