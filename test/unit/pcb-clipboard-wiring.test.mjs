import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	copyBoard,
	duplicateBoard,
	pasteBoard,
} from "../../frontend/src/editor/clipboard.js";
import { PCB_HOTKEYS } from "../../frontend/src/editor/hotkeys.js";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);

const clipMarker = "// --- PCB Clipboard pure helpers ---";
const clipEnd = "// --- End PCB Clipboard pure helpers ---";
const pureHelpersCode = pcbCanvasSrc.slice(
	pcbCanvasSrc.indexOf(clipMarker),
	pcbCanvasSrc.indexOf(clipEnd),
);

const geomUrl = new URL(
	"../../frontend/src/editor/pcbGeometry.js",
	import.meta.url,
).href;

const dynamicModule = [
	`import { snapToGrid } from ${JSON.stringify(geomUrl)};`,
	pureHelpersCode,
].join("\n");

const {
	calculatePasteAnchor,
	collectPastedSelection,
	collectSelectedBoardItems,
} = await import(
	`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
);

function createMockBoard() {
	return {
		nets: ["NET_A", "NET_B"],
		tracks: [{ id: "tr0", start: [2, 2], end: [8, 2] }],
		vias: [{ id: "vi0", at: [8, 2] }],
		graphics: [{ id: "gf0", x: 1, y: 1 }],
		footprints: [{ id: "ft0", at: [10, 10] }],
		zones: [{ id: "zn0", polygon: [] }],
	};
}

describe("calculatePasteAnchor pure helper", () => {
	it("snaps coordinates to grid accurately", () => {
		assert.deepEqual(calculatePasteAnchor([10.23, 20.47], 0.25), {
			x: 10.25,
			y: 20.5,
		});
		assert.deepEqual(calculatePasteAnchor({ x: 12.3, y: 5.8 }, 1.0), {
			x: 12,
			y: 6,
		});
		assert.deepEqual(calculatePasteAnchor(null, 0.5), { x: 0, y: 0 });
		assert.deepEqual(calculatePasteAnchor(undefined, 0.5), { x: 0, y: 0 });
		assert.deepEqual(calculatePasteAnchor([1.1, 2.2]), { x: 1, y: 2.25 });
	});
});

describe("collectPastedSelection pure helper", () => {
	it("returns empty arrays when nextBoard is missing or unchanged", () => {
		const board = createMockBoard();
		assert.deepEqual(collectPastedSelection(board, null).trackIndices, []);
		assert.deepEqual(collectPastedSelection(board, board).trackIndices, []);
	});

	it("identifies appended items across all categories", () => {
		const base = createMockBoard();
		const expanded = {
			...base,
			tracks: [...base.tracks, { id: "tr1" }, { id: "tr2" }],
			vias: [...base.vias, { id: "vi1" }],
			zones: [...base.zones, { id: "zn1" }],
			graphics: [...base.graphics, { id: "gf1" }],
			footprints: [...base.footprints, { id: "ft1" }],
		};
		const result = collectPastedSelection(base, expanded);
		assert.deepEqual(result, {
			trackIndices: [1, 2],
			viaIndices: [1],
			zoneIndices: [1],
			graphicIds: ["gf1"],
			partIds: ["ft1"],
		});
	});

	it("extracts pasted indices from pasteBoard and duplicateBoard outputs", () => {
		const board = createMockBoard();
		const clip = copyBoard(board, ["tr0", "vi0"]);
		const pasted = pasteBoard(board, clip, { x: 20, y: 20 });
		const pSel = collectPastedSelection(board, pasted);
		assert.deepEqual(pSel.trackIndices, [1]);
		assert.deepEqual(pSel.viaIndices, [1]);

		const duplicated = duplicateBoard(board, ["tr0"]);
		const dSel = collectPastedSelection(board, duplicated);
		assert.deepEqual(dSel.trackIndices, [1]);
	});
});

describe("collectSelectedBoardItems pure helper", () => {
	it("collects items from plural and singular selections", () => {
		const board = createMockBoard();
		const pluralSel = {
			selectedTrackIndices: [0],
			selectedViaIndices: [0],
			selectedZoneIndices: [0],
			selectedGraphicIds: ["gf0"],
			selectedPartIds: ["ft0"],
		};
		assert.equal(collectSelectedBoardItems(board, pluralSel).length, 5);

		const singularSel = {
			selectedTrackIndex: 0,
			selectedViaIndex: 0,
			selectedZoneIndex: 0,
			selectedGraphicId: "gf0",
			selectedPartId: "ft0",
		};
		assert.equal(collectSelectedBoardItems(board, singularSel).length, 5);
	});

	it("returns empty array when selection or board is empty", () => {
		assert.deepEqual(collectSelectedBoardItems(null, {}), []);
		assert.deepEqual(collectSelectedBoardItems(createMockBoard(), {}), []);
	});
});

describe("PcbCanvas clipboard wiring contracts", () => {
	it("verifies PCB_HOTKEYS bindings", () => {
		assert.equal(
			`${PCB_HOTKEYS.copy}:${PCB_HOTKEYS.paste}:${PCB_HOTKEYS.duplicate}`,
			"ctrl+c:ctrl+v:ctrl+d",
		);
		assert.equal(typeof PCB_HOTKEYS.cut, "undefined");
	});

	it("verifies key-dispatch wiring and text input guards in PcbCanvas", () => {
		assert.ok(pcbCanvasSrc.includes("handleClipboardShortcuts"));
		assert.ok(pcbCanvasSrc.includes("usePcbClipboard"));
		assert.ok(pcbCanvasSrc.includes("clipboardRef"));
		assert.ok(pcbCanvasSrc.includes("if (isTextInput(e.target)) return;"));
	});
});
