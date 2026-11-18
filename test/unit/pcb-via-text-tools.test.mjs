import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addVia } from "../../frontend/src/editor/routingModel.js";

// Extract pure functions exported from PcbCanvas.jsx
const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);
const startMarker = "export function chooseViaNet";
const endMarker = "function handleViaClick";
const sliceStart = pcbCanvasSrc.indexOf(startMarker);
const sliceEnd = pcbCanvasSrc.indexOf(endMarker);
assert.ok(sliceStart !== -1 && sliceEnd !== -1, "Found exported pure helpers");
const pureHelpersCode = pcbCanvasSrc.slice(sliceStart, sliceEnd);

const footprintRenderUrl = new URL(
	"../../frontend/src/editor/footprintRender.js",
	import.meta.url,
).href;
const boardGraphicsUrl = new URL(
	"../../frontend/src/editor/boardGraphics.js",
	import.meta.url,
).href;

const dynamicModule = [
	`import { padHitTest } from ${JSON.stringify(footprintRenderUrl)};`,
	`import { addGraphic } from ${JSON.stringify(boardGraphicsUrl)};`,
	pureHelpersCode,
].join("\n");

const {
	chooseViaNet,
	buildDefaultTextGraphic,
	commitTextGraphic,
	findTextGraphicAt,
} = await import(
	`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
);

describe("chooseViaNet", () => {
	const pads = [
		{
			type: "pad",
			center: [10, 20],
			size: [2, 2],
			shape: "rect",
			netId: "Net-(R1-Pad1)",
		},
		{
			type: "pad",
			center: [30, 40],
			size: [1.5, 1.5],
			shape: "circle",
			netId: "Net-(C1-Pad2)",
		},
		{
			type: "pad",
			center: [50, 60],
			size: [2, 2],
			shape: "rect",
		},
	];

	it("returns pad netId when point is on pad center", () => {
		assert.equal(chooseViaNet(pads, [10, 20]), "Net-(R1-Pad1)");
		assert.equal(chooseViaNet(pads, { x: 30, y: 40 }), "Net-(C1-Pad2)");
	});

	it("returns pad netId when point is within pad bounds", () => {
		assert.equal(chooseViaNet(pads, [10.5, 20.5]), "Net-(R1-Pad1)");
		assert.equal(chooseViaNet(pads, { x: 30.2, y: 40.2 }), "Net-(C1-Pad2)");
	});

	it("returns empty string when point is outside all pads", () => {
		assert.equal(chooseViaNet(pads, [0, 0]), "");
		assert.equal(chooseViaNet(pads, [15, 20]), "");
		assert.equal(chooseViaNet(pads, { x: 100, y: 100 }), "");
	});

	it("returns empty string when hit pad has no netId", () => {
		assert.equal(chooseViaNet(pads, [50, 60]), "");
	});

	it("handles empty or invalid inputs gracefully", () => {
		assert.equal(chooseViaNet(null, [10, 20]), "");
		assert.equal(chooseViaNet([], [10, 20]), "");
		assert.equal(chooseViaNet(pads, null), "");
		assert.equal(chooseViaNet(pads, [Number.NaN, 20]), "");
	});
});

describe("buildDefaultTextGraphic", () => {
	it("builds a graphic object with default text TEXT and default layer F.SilkS", () => {
		const g = buildDefaultTextGraphic([12, 34]);
		assert.deepEqual(g, {
			kind: "text",
			layer: "F.SilkS",
			x: 12,
			y: 34,
			text: "TEXT",
		});
	});

	it("supports custom layer, text, and object coordinates", () => {
		const g = buildDefaultTextGraphic({ x: 5, y: 8 }, "B.SilkS", "LOGO");
		assert.deepEqual(g, {
			kind: "text",
			layer: "B.SilkS",
			x: 5,
			y: 8,
			text: "LOGO",
		});
	});
});

describe("commitTextGraphic", () => {
	const initialBoard = {
		graphics: [
			{
				id: "gfx-1",
				kind: "text",
				layer: "F.SilkS",
				x: 10,
				y: 20,
				text: "EXISTING",
				width: 0.15,
			},
		],
	};

	it("adds new text graphic without mutating original board", () => {
		const next = commitTextGraphic(initialBoard, {
			pos: [50, 60],
			layer: "F.SilkS",
			text: "TEXT",
		});
		assert.equal(initialBoard.graphics.length, 1);
		assert.equal(next.graphics.length, 2);
		assert.equal(next.graphics[1].text, "TEXT");
		assert.equal(next.graphics[1].x, 50);
		assert.equal(next.graphics[1].y, 60);
	});

	it("updates existing text graphic when graphicId is provided", () => {
		const next = commitTextGraphic(initialBoard, {
			graphicId: "gfx-1",
			text: "EDITED",
		});
		assert.equal(initialBoard.graphics[0].text, "EXISTING");
		assert.equal(next.graphics.length, 1);
		assert.equal(next.graphics[0].text, "EDITED");
		assert.equal(next.graphics[0].id, "gfx-1");
		assert.equal(next.graphics[0].x, 10);
	});
});

describe("findTextGraphicAt", () => {
	const graphics = [
		{
			id: "gfx-1",
			kind: "text",
			layer: "F.SilkS",
			x: 10,
			y: 20,
			text: "HELLO",
		},
		{
			id: "gfx-2",
			kind: "rect",
			layer: "F.SilkS",
			x: 10,
			y: 20,
			x2: 15,
			y2: 25,
		},
	];

	it("finds text graphic when clicked near anchor", () => {
		const hit = findTextGraphicAt(graphics, [10, 20]);
		assert.ok(hit);
		assert.equal(hit.id, "gfx-1");
	});

	it("finds text graphic when clicked in body of text", () => {
		const hit = findTextGraphicAt(graphics, [12, 19.5]);
		assert.ok(hit);
		assert.equal(hit.id, "gfx-1");
	});

	it("returns null when clicked far away or on non-text", () => {
		assert.equal(findTextGraphicAt(graphics, [100, 100]), null);
		assert.equal(findTextGraphicAt(graphics, [13, 23]), null);
		assert.equal(findTextGraphicAt([], [10, 20]), null);
		assert.equal(findTextGraphicAt(null, [10, 20]), null);
	});
});

describe("Via placement flow", () => {
	const pads = [
		{
			type: "pad",
			center: [15, 25],
			size: [2, 2],
			shape: "rect",
			netId: "Net-(D1-Pad1)",
		},
	];
	const board = { vias: [] };

	it("places via at snapped point with net of copper pad under cursor", () => {
		const cursor = [15.2, 25.1];
		const snapped = [15, 25];
		const netId = chooseViaNet(pads, cursor);
		assert.equal(netId, "Net-(D1-Pad1)");
		const nextBoard = addVia(board, {
			at: snapped,
			netId,
			drillMm: 0.3,
			sizeMm: 0.6,
		});
		assert.equal(nextBoard.vias.length, 1);
		assert.deepEqual(nextBoard.vias[0], {
			at: [15, 25],
			netId: "Net-(D1-Pad1)",
			drillMm: 0.3,
			sizeMm: 0.6,
		});
	});

	it("places via with empty netId when cursor is not over any copper pad", () => {
		const cursor = [50, 50];
		const netId = chooseViaNet(pads, cursor);
		assert.equal(netId, "");
		const nextBoard = addVia(board, {
			at: cursor,
			netId,
			drillMm: 0.3,
			sizeMm: 0.6,
		});
		assert.equal(nextBoard.vias[0].netId, "");
	});
});

describe("PcbCanvas wiring checks", () => {
	it("wires armVia into shortcuts on V hotkey when not routing", () => {
		assert.match(pcbCanvasSrc, /if\s*\(key\s*===\s*"v"\)\s*\{[^}]*armVia/);
	});

	it("arms placeVia in toolBus addVia handler when not routing", () => {
		assert.match(pcbCanvasSrc, /handleViaTool/);
		assert.match(pcbCanvasSrc, /else\s+armGfx\("placeVia"\)/);
	});

	it("places text immediately with default TEXT without opening modal", () => {
		assert.match(
			pcbCanvasSrc,
			/if\s*\(activeTool\s*===\s*"placeText"\)\s*\{[^}]*st\.onTextSubmit\?\.\("TEXT",\s*pt\)/,
		);
	});

	it("wires double-click on existing PCB text to open pre-filled modal", () => {
		assert.match(pcbCanvasSrc, /useSceneDoubleClick/);
		assert.match(pcbCanvasSrc, /findTextGraphicAt/);
	});
});
