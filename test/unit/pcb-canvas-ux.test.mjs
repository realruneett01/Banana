import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fitToBounds } from "../../frontend/src/editor/viewport.js";

function makeImportHeader() {
	const toHref = (rel) => new URL(rel, import.meta.url).href;
	const geom = JSON.stringify(
		toHref("../../frontend/src/editor/pcbGeometry.js"),
	);
	const outl = JSON.stringify(
		toHref("../../frontend/src/editor/boardOutline.js"),
	);
	const view = JSON.stringify(toHref("../../frontend/src/editor/viewport.js"));
	return [
		`import { footprintRect } from ${geom};`,
		`import { outlineToPolygon, polygonBBox } from ${outl};`,
		`import { bboxOfPoints } from ${view};`,
	].join("\n");
}

async function loadHelpers() {
	const src = readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	);
	const body = src.slice(
		src.indexOf("function isValidOutline"),
		src.indexOf("function outlinePoints"),
	);
	const fullCode = `${makeImportHeader()}\n${body}`;
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(fullCode).toString("base64")}`
	);
	return { src, mod };
}

const { src: pcbCanvasSrc, mod: pcbHelpers } = await loadHelpers();
const {
	DEFAULT_WORK_AREA,
	defaultWorkAreaBounds,
	sceneBoundsFallback,
	getSceneBounds,
	getZonePoints,
	formatZonePt,
} = pcbHelpers;

describe("PcbCanvas default work area", () => {
	it("defines 100 x 80 mm bounds centered at origin", () => {
		assert.equal(DEFAULT_WORK_AREA.minX, -50);
		assert.equal(DEFAULT_WORK_AREA.maxX, 50);
		assert.equal(DEFAULT_WORK_AREA.minY, -40);
		assert.equal(DEFAULT_WORK_AREA.maxY, 40);
		assert.deepEqual(defaultWorkAreaBounds(), DEFAULT_WORK_AREA);
	});

	it("fits view to work area on empty scene instead of zoom=4 fallback", () => {
		const bounds = getSceneBounds({}, {});
		const view = fitToBounds(bounds, { width: 800, height: 600 });
		assert.equal(view.zoom, 6.75);
		assert.equal(view.pan.x, 400);
		assert.equal(view.pan.y, 300);
	});
});

describe("PcbCanvas scene bounds fallback", () => {
	it("falls back to default work area when no parts exist", () => {
		const fallback = sceneBoundsFallback({}, { parts: [] });
		assert.deepEqual(fallback, DEFAULT_WORK_AREA);
	});

	it("falls back to parts bounding box when parts are present", () => {
		const ir = {
			parts: [
				{ placement: { x: -10, y: -20 } },
				{ placement: { x: 30, y: 40 } },
			],
		};
		const fallback = sceneBoundsFallback({}, ir);
		assert.deepEqual(fallback, {
			minX: -12.5,
			maxX: 32.5,
			minY: -22.5,
			maxY: 42.5,
		});
	});
});

describe("PcbCanvas getSceneBounds", () => {
	it("prefers valid board outline over parts or default area", () => {
		const board = {
			outline: [
				[-25, -15],
				[25, -15],
				[25, 15],
				[-25, 15],
			],
		};
		const ir = {
			parts: [{ placement: { x: 100, y: 100 } }],
		};
		const bounds = getSceneBounds(board, ir);
		assert.deepEqual(bounds, {
			minX: -25,
			maxX: 25,
			minY: -15,
			maxY: 15,
		});
	});

	it("falls back to default work area on empty board without outline or parts", () => {
		assert.deepEqual(getSceneBounds(null, null), DEFAULT_WORK_AREA);
	});
});

describe("PcbCanvas zone points and formatting", () => {
	it("extracts points from zone polygon or points array", () => {
		const fromPolygon = getZonePoints({
			polygon: [
				[0, 0],
				[10, 0],
				[10, 10],
			],
		});
		assert.equal(fromPolygon.length, 3);
		const fromPoints = getZonePoints({
			points: [
				[1, 1],
				[2, 2],
				[3, 3],
			],
		});
		assert.equal(fromPoints.length, 3);
		assert.deepEqual(getZonePoints({}), []);
	});

	it("formats zone points for arrays and objects", () => {
		assert.equal(formatZonePt([12.5, 34.2]), "12.5,34.2");
		assert.equal(formatZonePt({ x: 5, y: -8 }), "5,-8");
		assert.equal(formatZonePt(null), null);
	});
});

describe("PcbCanvas text modal and placement routing", () => {
	it("guards text modal to only open when editing existing text with graphicId", () => {
		assert.match(
			pcbCanvasSrc,
			/open=\{Boolean\(\s*s\.graphicsDrawing\.textModal\.open\s*&&\s*s\.graphicsDrawing\.textModal\.graphicId,?\s*\)\}/,
		);
	});

	it("routes text tool clicks directly to onTextSubmit with default text", () => {
		assert.match(
			pcbCanvasSrc,
			/if\s*\(activeTool === "placeText"\)\s*\{\s*st\.onTextSubmit\?\.?\("TEXT", pt\);/,
		);
		assert.match(
			pcbCanvasSrc,
			/if\s*\(activeTool === "text" \|\| activeTool === "drawText"\)\s*\{\s*st\.onTextSubmit\?\.?\("TEXT", pt\);/,
		);
	});

	it("maps tool bus events for text and zone drawing", () => {
		assert.match(
			pcbCanvasSrc,
			/placeText:\s*\(\)\s*=>\s*armGfx\("placeText"\)/,
		);
		assert.match(pcbCanvasSrc, /drawText:\s*\(\)\s*=>\s*armGfx\("placeText"\)/);
		assert.match(pcbCanvasSrc, /text:\s*\(\)\s*=>\s*armGfx\("placeText"\)/);
		assert.match(pcbCanvasSrc, /addZone:\s*\(\)\s*=>\s*armGfx\("addZone"\)/);
	});

	it("commits zone on escape when at least 3 points collected", () => {
		assert.match(
			pcbCanvasSrc,
			/if\s*\(activeTool === "addZone" && points\.length >= 3\)\s*\{/,
		);
	});
});
