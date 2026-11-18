import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createLayerState } from "../../frontend/src/editor/layers.js";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);

const startMarker = "// --- PCB Select and Layer pure helpers ---";
const endMarker = "// --- End PCB Select and Layer pure helpers ---";
const sliceStart = pcbCanvasSrc.indexOf(startMarker);
const sliceEnd = pcbCanvasSrc.indexOf(endMarker);
assert.ok(
	sliceStart !== -1 && sliceEnd !== -1,
	"Found PCB select and layer pure helpers section in PcbCanvas.jsx",
);
const pureHelpersCode = pcbCanvasSrc.slice(sliceStart, sliceEnd);

const layersUrl = new URL(
	"../../frontend/src/editor/layers.js",
	import.meta.url,
).href;

const dynamicModule = [
	`import { stepCopper, jumpCopper } from ${JSON.stringify(layersUrl)};`,
	pureHelpersCode,
].join("\n");

const {
	collectSelectAllIds,
	walkConnectedTracksAndVias,
	findConnectedTracksAndVias,
	cycleCopperLayer,
	jumpCopperLayer,
	deleteItemsFromBoard,
} = await import(
	`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
);

describe("collectSelectAllIds pure helper", () => {
	it("returns empty arrays when ir and board are empty or missing", () => {
		const emptyRes = collectSelectAllIds();
		assert.deepEqual(emptyRes, {
			partIds: [],
			trackIndices: [],
			viaIndices: [],
			zoneIndices: [],
			graphicIds: [],
		});

		const nullRes = collectSelectAllIds({ ir: null, board: null });
		assert.deepEqual(nullRes, {
			partIds: [],
			trackIndices: [],
			viaIndices: [],
			zoneIndices: [],
			graphicIds: [],
		});
	});

	it("collects all footprint, track, via, zone, and graphic identifiers", () => {
		const ir = {
			parts: [
				{ id: "R1", ref: "R1" },
				{ id: "C1", ref: "C1" },
			],
		};
		const board = {
			tracks: [
				{ start: [0, 0], end: [10, 0] },
				{ start: [10, 0], end: [20, 0] },
			],
			vias: [{ at: [10, 0] }],
			zones: [{ netId: "GND" }],
			graphics: [{ id: "gfx-1" }, { id: "gfx-2" }],
		};

		const res = collectSelectAllIds({ ir, board });
		assert.deepEqual(res.partIds, ["R1", "C1"]);
		assert.deepEqual(res.trackIndices, [0, 1]);
		assert.deepEqual(res.viaIndices, [0]);
		assert.deepEqual(res.zoneIndices, [0]);
		assert.deepEqual(res.graphicIds, ["gfx-1", "gfx-2"]);
	});
});

describe("walkConnectedTracksAndVias pure helper", () => {
	it("walks a connected track graph of the same net", () => {
		const tracks = [
			{ start: [0, 0], end: [10, 0], netId: "Net1" },
			{ start: [10, 0], end: [20, 0], netId: "Net1" },
			{ start: [30, 0], end: [40, 0], netId: "Net1" }, // disconnected
			{ start: [10, 0], end: [10, 10], netId: "Net2" }, // different net
		];

		const res = walkConnectedTracksAndVias({
			tracks,
			start: { trackIndex: 0 },
		});
		assert.deepEqual(res.trackIndices, [0, 1]);
		assert.deepEqual(res.viaIndices, []);

		// Also check alias findConnectedTracksAndVias
		const aliasRes = findConnectedTracksAndVias({
			tracks,
			start: { trackIndex: 1 },
		});
		assert.deepEqual(aliasRes.trackIndices, [0, 1]);
	});

	it("walks across vias connecting tracks of the same net", () => {
		const tracks = [
			{ start: [0, 0], end: [10, 0], netId: "NetA" },
			{ start: [10, 0], end: [20, 0], netId: "NetA" },
			{ start: [20, 0], end: [20, 10], netId: "NetA" },
		];
		const vias = [
			{ at: [10, 0], netId: "NetA" },
			{ at: [50, 50], netId: "NetA" }, // disconnected via
		];

		const fromVia = walkConnectedTracksAndVias({
			tracks,
			vias,
			start: { viaIndex: 0 },
		});
		assert.deepEqual(fromVia.trackIndices, [0, 1, 2]);
		assert.deepEqual(fromVia.viaIndices, [0]);

		const fromTrack = walkConnectedTracksAndVias({
			tracks,
			vias,
			start: { trackIndex: 2 },
		});
		assert.deepEqual(fromTrack.trackIndices, [0, 1, 2]);
		assert.deepEqual(fromTrack.viaIndices, [0]);
	});

	it("walks connected tracks starting from a pad", () => {
		const tracks = [
			{ start: [5, 5], end: [15, 5], netId: "NetPad" },
			{ start: [15, 5], end: [25, 5], netId: "NetPad" },
		];
		const pads = [{ center: [5, 5], netId: "NetPad" }];

		const res = walkConnectedTracksAndVias({
			tracks,
			pads,
			start: { pad: pads[0] },
		});
		assert.deepEqual(res.trackIndices, [0, 1]);
		assert.deepEqual(res.viaIndices, []);
	});

	it("respects the 0.01 mm connection tolerance threshold", () => {
		const tracks = [
			{ start: [0, 0], end: [10, 0], netId: "NetTol" },
			{ start: [10.005, 0], end: [20, 0], netId: "NetTol" }, // within 0.01 mm
			{ start: [20.02, 0], end: [30, 0], netId: "NetTol" }, // outside 0.01 mm
		];

		const res = walkConnectedTracksAndVias({
			tracks,
			start: { trackIndex: 0 },
		});
		assert.deepEqual(res.trackIndices, [0, 1]);
	});

	it("handles closed cyclic loops without infinite recursion", () => {
		const tracks = [
			{ start: [0, 0], end: [10, 0], netId: "Loop" },
			{ start: [10, 0], end: [10, 10], netId: "Loop" },
			{ start: [10, 10], end: [0, 0], netId: "Loop" },
		];

		const res = walkConnectedTracksAndVias({
			tracks,
			start: { trackIndex: 0 },
		});
		assert.deepEqual(res.trackIndices, [0, 1, 2]);
	});

	it("returns empty arrays for invalid or missing start", () => {
		const res = walkConnectedTracksAndVias({
			tracks: [{ start: [0, 0], end: [10, 0] }],
			start: null,
		});
		assert.deepEqual(res, { trackIndices: [], viaIndices: [] });
	});
});

describe("copper layer cycling pure helpers", () => {
	it("cycles 2-layer board copper forward, backward, and wraps", () => {
		const state2 = createLayerState({ copperCount: 2 });
		assert.equal(state2.active, "F.Cu");

		const next1 = cycleCopperLayer(state2, 1);
		assert.equal(next1.active, "B.Cu");

		const next2 = cycleCopperLayer(next1, 1);
		assert.equal(next2.active, "F.Cu"); // wraps forward

		const prev1 = cycleCopperLayer(state2, -1);
		assert.equal(prev1.active, "B.Cu"); // wraps backward

		const top = jumpCopperLayer(state2, "top");
		assert.equal(top.active, "F.Cu");

		const bottom = jumpCopperLayer(state2, "bottom");
		assert.equal(bottom.active, "B.Cu");
	});

	it("cycles 4-layer board copper through all copper layers", () => {
		const state4 = createLayerState({ copperCount: 4 });
		assert.equal(state4.active, "F.Cu");

		const step1 = cycleCopperLayer(state4, 1);
		assert.equal(step1.active, "In1.Cu");

		const step2 = cycleCopperLayer(step1, 1);
		assert.equal(step2.active, "In2.Cu");

		const step3 = cycleCopperLayer(step2, 1);
		assert.equal(step3.active, "B.Cu");

		const step4 = cycleCopperLayer(step3, 1);
		assert.equal(step4.active, "F.Cu"); // wraps

		const back1 = cycleCopperLayer(state4, -1);
		assert.equal(back1.active, "B.Cu"); // wraps backward

		const back2 = cycleCopperLayer(back1, -1);
		assert.equal(back2.active, "In2.Cu");

		const top = jumpCopperLayer(back2, "top");
		assert.equal(top.active, "F.Cu");

		const bottom = jumpCopperLayer(top, "bottom");
		assert.equal(bottom.active, "B.Cu");
	});
});

describe("deleteItemsFromBoard pure helper", () => {
	it("removes specified track, via, zone, and graphic items in one push", () => {
		const board = {
			tracks: [
				{ start: [0, 0], end: [10, 0] },
				{ start: [10, 0], end: [20, 0] },
				{ start: [20, 0], end: [30, 0] },
			],
			vias: [{ at: [10, 0] }, { at: [20, 0] }],
			zones: [{ netId: "GND" }, { netId: "VCC" }],
			graphics: [{ id: "gfx-1" }, { id: "gfx-2" }],
		};

		const nextBoard = deleteItemsFromBoard(board, {
			trackIndices: [0, 2],
			viaIndices: [1],
			zoneIndices: [0],
			graphicIds: ["gfx-1"],
		});

		assert.equal(nextBoard.tracks.length, 1);
		assert.deepEqual(nextBoard.tracks[0], { start: [10, 0], end: [20, 0] });

		assert.equal(nextBoard.vias.length, 1);
		assert.deepEqual(nextBoard.vias[0], { at: [10, 0] });

		assert.equal(nextBoard.zones.length, 1);
		assert.deepEqual(nextBoard.zones[0], { netId: "VCC" });

		assert.equal(nextBoard.graphics.length, 1);
		assert.deepEqual(nextBoard.graphics[0], { id: "gfx-2" });
	});
});

describe("PcbCanvas shortcuts contracts", () => {
	it("includes selectAll and selectConnected in shortcut dispatching", () => {
		assert.ok(
			pcbCanvasSrc.includes("handleSelectAllShortcut") ||
				pcbCanvasSrc.includes("selectAll"),
			"PcbCanvas handles selectAll shortcut",
		);
		assert.ok(
			pcbCanvasSrc.includes("handleSelectConnectedShortcut") ||
				pcbCanvasSrc.includes("selectConnected"),
			"PcbCanvas handles selectConnected shortcut",
		);
	});
});
