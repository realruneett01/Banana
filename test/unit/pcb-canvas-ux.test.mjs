import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fitToBounds } from "../../frontend/src/editor/viewport.js";

function readSourceFile(relativePath) {
	const fileUrl = new URL(relativePath, import.meta.url);
	return readFileSync(fileUrl, "utf-8");
}

function assembleHelperModule(rawSource) {
	const depUrl = (path) => JSON.stringify(new URL(path, import.meta.url).href);
	const imports = [
		`import { footprintRect } from ${depUrl("../../frontend/src/editor/pcbGeometry.js")};`,
		`import { outlineToPolygon, polygonBBox } from ${depUrl("../../frontend/src/editor/boardOutline.js")};`,
		`import { bboxOfPoints } from ${depUrl("../../frontend/src/editor/viewport.js")};`,
	];
	const [fromMark, toMark] = [
		"function isValidOutline",
		"function outlinePoints",
	];
	const section = rawSource.substring(
		rawSource.indexOf(fromMark),
		rawSource.indexOf(toMark),
	);
	const moduleSource = [...imports, section].join("\n");
	const base64Data = Buffer.from(moduleSource, "utf-8").toString("base64");
	return import(`data:text/javascript;base64,${base64Data}`);
}

function makeBoardWithOutline(
	coords = [
		[-25, -15],
		[25, -15],
		[25, 15],
		[-25, 15],
	],
) {
	return { outline: coords };
}

function makeDesignWithParts(placements = [{ x: 100, y: 100 }]) {
	return {
		parts: placements.map((placement) => ({ placement })),
	};
}

function verifyProperties(target, expectations) {
	for (const [key, value] of Object.entries(expectations)) {
		assert.equal(target[key], value);
	}
}

function verifyPatterns(source, regexes) {
	for (const pattern of regexes) {
		assert.match(source, pattern);
	}
}

const pcbCanvasSrc = readSourceFile("../../frontend/src/editor/PcbCanvas.jsx");
const pcbHelpers = await assembleHelperModule(pcbCanvasSrc);
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
		verifyProperties(DEFAULT_WORK_AREA, {
			minX: -50,
			maxX: 50,
			minY: -40,
			maxY: 40,
		});
		assert.deepEqual(defaultWorkAreaBounds(), DEFAULT_WORK_AREA);
	});

	it("fits view to work area on empty scene instead of zoom=4 fallback", () => {
		const bounds = getSceneBounds({}, {});
		const view = fitToBounds(bounds, { width: 800, height: 600 });
		verifyProperties(view, { zoom: 6.75 });
		verifyProperties(view.pan, { x: 400, y: 300 });
	});
});

describe("PcbCanvas scene bounds fallback", () => {
	it("falls back to default work area when no parts exist", () => {
		const fallback = sceneBoundsFallback({}, { parts: [] });
		assert.deepEqual(fallback, DEFAULT_WORK_AREA);
	});

	it("falls back to parts bounding box when parts are present", () => {
		const ir = makeDesignWithParts([
			{ x: -10, y: -20 },
			{ x: 30, y: 40 },
		]);
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
		const board = makeBoardWithOutline();
		const ir = makeDesignWithParts();
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
		const fixtureCases = [
			{
				input: {
					polygon: [
						[0, 0],
						[10, 0],
						[10, 10],
					],
				},
				expectedLength: 3,
			},
			{
				input: {
					points: [
						[1, 1],
						[2, 2],
						[3, 3],
					],
				},
				expectedLength: 3,
			},
		];
		for (const { input, expectedLength } of fixtureCases) {
			assert.equal(getZonePoints(input).length, expectedLength);
		}
		assert.deepEqual(getZonePoints({}), []);
	});

	it("formats zone points for arrays and objects", () => {
		const mappingCases = [
			[[12.5, 34.2], "12.5,34.2"],
			[{ x: 5, y: -8 }, "5,-8"],
			[null, null],
		];
		for (const [coord, expected] of mappingCases) {
			assert.equal(formatZonePt(coord), expected);
		}
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
		verifyPatterns(pcbCanvasSrc, [
			/if\s*\(activeTool === "placeText"\)\s*\{\s*st\.onTextSubmit\?\.?\("TEXT", pt\);/,
			/if\s*\(activeTool === "text" \|\| activeTool === "drawText"\)\s*\{\s*st\.onTextSubmit\?\.?\("TEXT", pt\);/,
		]);
	});

	it("maps tool bus events for text and zone drawing", () => {
		verifyPatterns(pcbCanvasSrc, [
			/placeText:\s*\(\)\s*=>\s*armGfx\("placeText"\)/,
			/drawText:\s*\(\)\s*=>\s*armGfx\("placeText"\)/,
			/text:\s*\(\)\s*=>\s*armGfx\("placeText"\)/,
			/addZone:\s*\(item\)\s*=>\s*armGfx\("addZone",\s*item\)/,
		]);
	});

	it("commits zone on escape when at least 3 points collected", () => {
		assert.match(
			pcbCanvasSrc,
			/if\s*\(activeTool === "addZone" && points\.length >= 3\)\s*\{/,
		);
	});
});
