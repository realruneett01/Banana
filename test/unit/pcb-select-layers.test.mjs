import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createLayerState } from "../../frontend/src/editor/layers.js";

function extractHelpersModule() {
	const canvasContent = readFileSync(
		new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
		"utf8",
	);
	const startTag = "// --- PCB Select and Layer pure helpers ---";
	const endTag = "// --- End PCB Select and Layer pure helpers ---";
	const content = canvasContent.split(startTag)[1]?.split(endTag)[0];
	assert.ok(content, "PcbCanvas helper section missing");

	const layersHref = new URL(
		"../../frontend/src/editor/layers.js",
		import.meta.url,
	).href;
	const bundled = `import { stepCopper, jumpCopper } from "${layersHref}";\n${content}`;
	const base64Uri = `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`;
	return { canvasContent, base64Uri };
}

const { canvasContent: pcbCanvasSrc, base64Uri } = extractHelpersModule();
const {
	collectSelectAllIds,
	walkConnectedTracksAndVias,
	findConnectedTracksAndVias,
	cycleCopperLayer,
	jumpCopperLayer,
	deleteItemsFromBoard,
} = await import(base64Uri);

const EMPTY_SELECTION = Object.freeze({
	partIds: [],
	trackIndices: [],
	viaIndices: [],
	zoneIndices: [],
	graphicIds: [],
});

function buildBoardFixture({
	trackCount = 2,
	viaCount = 1,
	zoneNets = ["GND"],
	graphicIds = ["gfx-1", "gfx-2"],
} = {}) {
	return {
		tracks: Array.from({ length: trackCount }, (_, i) => ({
			start: [i * 10, 0],
			end: [(i + 1) * 10, 0],
		})),
		vias: Array.from({ length: viaCount }, (_, i) => ({
			at: [(i + 1) * 10, 0],
		})),
		zones: zoneNets.map((netId) => ({ netId })),
		graphics: graphicIds.map((id) => ({ id })),
	};
}

function makeTrack(start, end, netId) {
	return netId ? { start, end, netId } : { start, end };
}

function runWalk(tracks, start = { trackIndex: 0 }, extra = {}) {
	return walkConnectedTracksAndVias({ tracks, start, ...extra });
}

function assertConnected(res, trackIndices, viaIndices = []) {
	assert.deepEqual(res.trackIndices, trackIndices);
	assert.deepEqual(res.viaIndices, viaIndices);
}

function verifyLayerSteps(initialState, steps) {
	let current = initialState;
	for (const [dir, expected] of steps) {
		current = cycleCopperLayer(current, dir);
		assert.equal(current.active, expected);
	}
	return current;
}

function verifyLayerJumps(state) {
	const top = jumpCopperLayer(state, "top");
	assert.equal(top.active, "F.Cu");
	const bottom = jumpCopperLayer(top, "bottom");
	assert.equal(bottom.active, "B.Cu");
}

function testCopperCycle(copperCount, forwardExpected, backwardExpected) {
	const initial = createLayerState({ copperCount });
	assert.equal(initial.active, "F.Cu");
	verifyLayerSteps(
		initial,
		forwardExpected.map((exp) => [1, exp]),
	);
	const backState = verifyLayerSteps(
		initial,
		backwardExpected.map((exp) => [-1, exp]),
	);
	verifyLayerJumps(backState);
}

function assertSingleItem(items, expected) {
	assert.equal(items.length, 1);
	assert.deepEqual(items[0], expected);
}

describe("collectSelectAllIds pure helper", () => {
	it("returns empty arrays when ir and board are empty or missing", () => {
		for (const input of [undefined, { ir: null, board: null }]) {
			assert.deepEqual(collectSelectAllIds(input), EMPTY_SELECTION);
		}
	});

	it("collects all footprint, track, via, zone, and graphic identifiers", () => {
		const ir = {
			parts: [
				{ id: "R1", ref: "R1" },
				{ id: "C1", ref: "C1" },
			],
		};
		const board = buildBoardFixture({
			trackCount: 2,
			viaCount: 1,
			zoneNets: ["GND"],
		});

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
			makeTrack([0, 0], [10, 0], "Net1"),
			makeTrack([10, 0], [20, 0], "Net1"),
			makeTrack([30, 0], [40, 0], "Net1"),
			makeTrack([10, 0], [10, 10], "Net2"),
		];

		assertConnected(runWalk(tracks), [0, 1]);

		const aliasRes = findConnectedTracksAndVias({
			tracks,
			start: { trackIndex: 1 },
		});
		assert.deepEqual(aliasRes.trackIndices, [0, 1]);
	});

	it("walks across vias connecting tracks of the same net", () => {
		const tracks = [
			makeTrack([0, 0], [10, 0], "NetA"),
			makeTrack([10, 0], [20, 0], "NetA"),
			makeTrack([20, 0], [20, 10], "NetA"),
		];
		const vias = [
			{ at: [10, 0], netId: "NetA" },
			{ at: [50, 50], netId: "NetA" },
		];

		for (const start of [{ viaIndex: 0 }, { trackIndex: 2 }]) {
			assertConnected(runWalk(tracks, start, { vias }), [0, 1, 2], [0]);
		}
	});

	it("walks connected tracks starting from a pad", () => {
		const tracks = [
			makeTrack([5, 5], [15, 5], "NetPad"),
			makeTrack([15, 5], [25, 5], "NetPad"),
		];
		const pads = [{ center: [5, 5], netId: "NetPad" }];

		assertConnected(runWalk(tracks, { pad: pads[0] }, { pads }), [0, 1]);
	});

	it("respects the 0.01 mm connection tolerance threshold", () => {
		const tracks = [
			makeTrack([0, 0], [10, 0], "NetTol"),
			makeTrack([10.005, 0], [20, 0], "NetTol"),
			makeTrack([20.02, 0], [30, 0], "NetTol"),
		];

		assertConnected(runWalk(tracks), [0, 1]);
	});

	it("handles closed cyclic loops without infinite recursion", () => {
		const tracks = [
			makeTrack([0, 0], [10, 0], "Loop"),
			makeTrack([10, 0], [10, 10], "Loop"),
			makeTrack([10, 10], [0, 0], "Loop"),
		];

		assertConnected(runWalk(tracks), [0, 1, 2]);
	});

	it("returns empty arrays for invalid or missing start", () => {
		const tracks = [makeTrack([0, 0], [10, 0])];
		assert.deepEqual(runWalk(tracks, null), {
			trackIndices: [],
			viaIndices: [],
		});
	});
});

describe("copper layer cycling pure helpers", () => {
	it("cycles 2-layer board copper forward, backward, and wraps", () => {
		testCopperCycle(2, ["B.Cu", "F.Cu"], ["B.Cu"]);
	});

	it("cycles 4-layer board copper through all copper layers", () => {
		testCopperCycle(
			4,
			["In1.Cu", "In2.Cu", "B.Cu", "F.Cu"],
			["B.Cu", "In2.Cu"],
		);
	});
});

describe("deleteItemsFromBoard pure helper", () => {
	it("removes specified track, via, zone, and graphic items in one push", () => {
		const board = buildBoardFixture({
			trackCount: 3,
			viaCount: 2,
			zoneNets: ["GND", "VCC"],
		});

		const nextBoard = deleteItemsFromBoard(board, {
			trackIndices: [0, 2],
			viaIndices: [1],
			zoneIndices: [0],
			graphicIds: ["gfx-1"],
		});

		assertSingleItem(nextBoard.tracks, { start: [10, 0], end: [20, 0] });
		assertSingleItem(nextBoard.vias, { at: [10, 0] });
		assertSingleItem(nextBoard.zones, { netId: "VCC" });
		assertSingleItem(nextBoard.graphics, { id: "gfx-2" });
	});
});

describe("PcbCanvas shortcuts contracts", () => {
	it("includes selectAll and selectConnected in shortcut dispatching", () => {
		for (const name of ["selectAll", "selectConnected"]) {
			const handler = `handle${name[0].toUpperCase()}${name.slice(1)}Shortcut`;
			assert.ok(
				pcbCanvasSrc.includes(handler) || pcbCanvasSrc.includes(name),
				`PcbCanvas handles ${name} shortcut`,
			);
		}
	});
});
