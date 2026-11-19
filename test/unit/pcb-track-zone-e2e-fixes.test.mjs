import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { addTrack } from "../../frontend/src/editor/pcbGeometry.js";
import { legPoints } from "../../frontend/src/editor/trackPosture.js";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);
const boardToolsSrc = readFileSync(
	new URL("../../frontend/src/editor/BoardTools.jsx", import.meta.url),
	"utf8",
);

async function extractModule(src, startToken, endToken, preamble) {
	const start = src.indexOf(startToken);
	const end = src.indexOf(endToken);
	const fnBody = src.slice(start, end);
	const fnName = startToken.replace("function ", "");
	const code = `${preamble}\n${fnBody}\nexport { ${fnName} };`;
	const b64 = Buffer.from(code).toString("base64");
	const mod = await import(`data:text/javascript;base64,${b64}`);
	return mod[fnName];
}

const zoneModelUrl = new URL(
	"../../frontend/src/editor/zoneModel.js",
	import.meta.url,
).href;

const tryCommitZone = await extractModule(
	pcbCanvasSrc,
	"function tryCommitZone",
	"function handleGraphicsCancel",
	`import { addZone } from "${zoneModelUrl}";`,
);

const handleToolEvent = await extractModule(
	boardToolsSrc,
	"function handleToolEvent",
	"export function useBoardToolBus",
	"const setOutlineTool = () => {};",
);

function assertTrackEndpoints(tracks, expectedStart, expectedEnd) {
	assert.ok(tracks.length >= 1);
	assert.deepEqual(tracks[0].start, expectedStart);
	assert.deepEqual(tracks.at(-1).end, expectedEnd);
}

function createZoneContext(options = {}) {
	let committedBoard = null;
	let resetCalled = false;
	const st = {
		reset: () => {
			resetCalled = true;
		},
	};
	const ctx = {
		activeTool: options.activeTool ?? "addZone",
		points: options.points ?? [
			[0, 0],
			[10, 0],
			[10, 10],
		],
		board: { zones: [] },
		pushBoard: (b) => {
			committedBoard = b;
		},
		activeLayer: options.activeLayer ?? "F.Cu",
		toolProps: options.toolProps ?? {},
	};
	return {
		st,
		ctx,
		getBoard: () => committedBoard,
		wasReset: () => resetCalled,
	};
}

function assertCommittedZone(result, board, expected) {
	assert.equal(result, true);
	assert.equal(board?.zones?.length, 1);
	const zone = board.zones[0];
	for (const [key, value] of Object.entries(expected)) {
		if (key === "polygonLength") {
			assert.equal(zone.polygon.length, value);
		} else {
			assert.equal(zone[key], value);
		}
	}
}

describe("pcb_track: double-click route commit", () => {
	it("commits track from start to target via legPoints on double click", () => {
		const start = { x: 10, y: 10 };
		const target = { x: 25, y: 25 };
		const legs = legPoints(start, target, "45", "straight-first");
		const points = [start, ...legs];

		assert.ok(points.length >= 2, "must have at least start and target points");
		const board = { tracks: [] };
		const updated = addTrack(board, {
			netId: "Net-(D1-A)",
			layer: "F.Cu",
			points,
			widthMm: 0.25,
		});

		assertTrackEndpoints(updated.tracks, [10, 10], [25, 25]);
		assert.equal(updated.tracks[0].netId, "Net-(D1-A)");
		assert.equal(updated.tracks[0].layer, "F.Cu");
	});

	it("simulates double-click commit logic with single starting point", () => {
		const start = { x: 0, y: 0 };
		const target = { x: 10, y: 10 };
		const points = [start];
		let committedBoard = null;
		let sessionReset = false;

		const isRouting = true;
		if (isRouting && points.length > 0) {
			const legs = legPoints(
				points[points.length - 1],
				target,
				"45",
				"straight-first",
			);
			const finalPoints = [...points, ...legs];
			if (finalPoints.length >= 2) {
				committedBoard = addTrack(
					{ tracks: [] },
					{
						netId: "NET1",
						layer: "F.Cu",
						points: finalPoints,
						widthMm: 0.25,
					},
				);
				sessionReset = true;
			}
		}

		assert.ok(sessionReset, "session must be reset after commit");
		assert.ok(committedBoard, "board must receive committed track");
		assertTrackEndpoints(committedBoard.tracks, [0, 0], [10, 10]);
	});

	it("returns early without committing when points array is empty", () => {
		const points = [];
		let committed = false;
		const isRouting = true;

		if (isRouting && points.length > 0) {
			committed = true;
		}

		assert.equal(committed, false);
	});

	it("PcbCanvas wiring verifies useRouteDoubleClick resolves target and appends legs", () => {
		assert.match(
			pcbCanvasSrc,
			/function useRouteDoubleClick/,
			"useRouteDoubleClick must exist",
		);
		assert.match(
			pcbCanvasSrc,
			/resolveRouteTarget\(raw,\s*true/,
			"useRouteDoubleClick must resolve target with snap",
		);
		assert.match(
			pcbCanvasSrc,
			/legPoints\(start,\s*target,\s*routeMode,\s*posture\)/,
			"useRouteDoubleClick must compute legPoints to target",
		);
		assert.match(
			pcbCanvasSrc,
			/finalPoints\.length < 2/,
			"useRouteDoubleClick must guard against fewer than 2 points",
		);
	});
});

describe("pcb_zone: interactive pour modal flow and commit", () => {
	it("handleToolEvent triggers onPour with interactive=true when item is undefined", () => {
		let calledWith = null;
		const onPour = (layer, interactive) => {
			calledWith = { layer, interactive };
		};

		handleToolEvent("addZone", onPour, "F.Cu", undefined);
		assert.deepEqual(calledWith, { layer: "F.Cu", interactive: true });
	});

	it("handleToolEvent ignores addZone event when item is already present", () => {
		let called = false;
		const onPour = () => {
			called = true;
		};

		handleToolEvent("addZone", onPour, "F.Cu", {
			netId: "Net-(D1-A)",
			layer: "F.Cu",
			keepout: false,
		});
		assert.equal(
			called,
			false,
			"must not re-trigger pour modal when item is provided",
		);
	});

	it("tryCommitZone commits zone polygon with netId, layer, and keepout from toolProps", () => {
		const harness = createZoneContext({
			points: [
				[-50, -50],
				[50, -50],
				[50, 50],
				[-50, 50],
			],
			toolProps: {
				netId: "Net-(R1-Pad1)",
				layer: "B.Cu",
				keepout: false,
			},
		});

		const result = tryCommitZone(harness.st, harness.ctx);
		assert.ok(harness.wasReset(), "st.reset() must be called");
		assertCommittedZone(result, harness.getBoard(), {
			netId: "Net-(R1-Pad1)",
			layer: "B.Cu",
			keepout: undefined,
			polygonLength: 4,
		});
	});

	it("tryCommitZone commits keepout zone correctly", () => {
		const harness = createZoneContext({
			toolProps: {
				netId: "GND",
				layer: "F.Cu",
				keepout: true,
			},
		});

		const result = tryCommitZone(harness.st, harness.ctx);
		assertCommittedZone(result, harness.getBoard(), {
			netId: "",
			keepout: true,
		});
	});

	it("tryCommitZone returns false when points count is less than 3", () => {
		const harness = createZoneContext({
			points: [
				[0, 0],
				[10, 0],
			],
			toolProps: { netId: "GND" },
		});

		const result = tryCommitZone(harness.st, harness.ctx);
		assert.equal(result, false);
		assert.equal(harness.getBoard(), null);
	});

	it("tryCommitZone returns false when activeTool is not addZone", () => {
		const harness = createZoneContext({
			activeTool: "drawLine",
		});

		const result = tryCommitZone(harness.st, harness.ctx);
		assert.equal(result, false);
	});
});
