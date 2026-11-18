import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addVia } from "../../frontend/src/editor/routingModel.js";

async function loadCanvasPureHelpers() {
	const canvasPath = new URL(
		"../../frontend/src/editor/PcbCanvas.jsx",
		import.meta.url,
	);
	const text = readFileSync(canvasPath, "utf8");
	const [section] =
		text.match(
			/export function chooseViaNet[\s\S]*?(?=function handleViaClick)/,
		) ?? [];
	assert.ok(section, "Found exported pure helpers");
	const resolveUrl = (rel) =>
		JSON.stringify(new URL(rel, import.meta.url).href);
	const code = [
		`import { padHitTest } from ${resolveUrl("../../frontend/src/editor/footprintRender.js")};`,
		`import { addGraphic } from ${resolveUrl("../../frontend/src/editor/boardGraphics.js")};`,
		section,
	].join("\n");
	const base64 = Buffer.from(code).toString("base64");
	const mod = await import(`data:text/javascript;base64,${base64}`);
	return { text, mod };
}

const { text: pcbCanvasSrc, mod: canvasHelpers } =
	await loadCanvasPureHelpers();
const {
	chooseViaNet,
	buildDefaultTextGraphic,
	commitTextGraphic,
	findTextGraphicAt,
} = canvasHelpers;

function createPad(center, size, shape = "rect", netId = undefined) {
	const pad = { type: "pad", center, size, shape };
	if (netId) {
		pad.netId = netId;
	}
	return pad;
}

function assertViaNetCases(cases) {
	for (const [padList, point, expectedNet] of cases) {
		assert.equal(chooseViaNet(padList, point), expectedNet);
	}
}

function assertFoundTextId(graphicList, point, expectedId) {
	const hit = findTextGraphicAt(graphicList, point);
	assert.ok(hit);
	assert.equal(hit.id, expectedId);
}

function assertCanvasMatches(patterns) {
	for (const pattern of patterns) {
		assert.match(pcbCanvasSrc, pattern);
	}
}

describe("chooseViaNet", () => {
	const pads = [
		createPad([10, 20], [2, 2], "rect", "Net-(R1-Pad1)"),
		createPad([30, 40], [1.5, 1.5], "circle", "Net-(C1-Pad2)"),
		createPad([50, 60], [2, 2], "rect"),
	];

	it("returns pad netId when point is on pad center", () => {
		assertViaNetCases([
			[pads, [10, 20], "Net-(R1-Pad1)"],
			[pads, { x: 30, y: 40 }, "Net-(C1-Pad2)"],
		]);
	});

	it("returns pad netId when point is within pad bounds", () => {
		assertViaNetCases([
			[pads, [10.5, 20.5], "Net-(R1-Pad1)"],
			[pads, { x: 30.2, y: 40.2 }, "Net-(C1-Pad2)"],
		]);
	});

	it("returns empty string when point is outside all pads", () => {
		assertViaNetCases([
			[pads, [0, 0], ""],
			[pads, [15, 20], ""],
			[pads, { x: 100, y: 100 }, ""],
		]);
	});

	it("returns empty string when hit pad has no netId", () => {
		assert.equal(chooseViaNet(pads, [50, 60]), "");
	});

	it("handles empty or invalid inputs gracefully", () => {
		assertViaNetCases([
			[null, [10, 20], ""],
			[[], [10, 20], ""],
			[pads, null, ""],
			[pads, [Number.NaN, 20], ""],
		]);
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
		assertFoundTextId(graphics, [10, 20], "gfx-1");
	});

	it("finds text graphic when clicked in body of text", () => {
		assertFoundTextId(graphics, [12, 19.5], "gfx-1");
	});

	it("returns null when clicked far away or on non-text", () => {
		for (const [graphicList, point] of [
			[graphics, [100, 100]],
			[graphics, [13, 23]],
			[[], [10, 20]],
			[null, [10, 20]],
		]) {
			assert.equal(findTextGraphicAt(graphicList, point), null);
		}
	});
});

describe("Via placement flow", () => {
	const pads = [createPad([15, 25], [2, 2], "rect", "Net-(D1-Pad1)")];
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
		assertCanvasMatches([/if\s*\(key\s*===\s*"v"\)\s*\{[^}]*armVia/]);
	});

	it("arms placeVia in toolBus addVia handler when not routing", () => {
		assertCanvasMatches([/handleViaTool/, /else\s+armGfx\("placeVia"\)/]);
	});

	it("places text immediately with default TEXT without opening modal", () => {
		assertCanvasMatches([
			/if\s*\(activeTool\s*===\s*"placeText"\)\s*\{[^}]*st\.onTextSubmit\?\.\("TEXT",\s*pt\)/,
		]);
	});

	it("wires double-click on existing PCB text to open pre-filled modal", () => {
		assertCanvasMatches([/useSceneDoubleClick/, /findTextGraphicAt/]);
	});
});
