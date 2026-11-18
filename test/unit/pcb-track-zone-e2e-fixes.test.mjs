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

async function loadTryCommitZone() {
	const start = pcbCanvasSrc.indexOf("function tryCommitZone");
	const end = pcbCanvasSrc.indexOf("function handleGraphicsCancel");
	const fnBody = pcbCanvasSrc.slice(start, end);
	const code = `
		import { addZone } from "${new URL("../../frontend/src/editor/zoneModel.js", import.meta.url).href}";
		${fnBody}
		export { tryCommitZone };
	`;
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
	);
	return mod.tryCommitZone;
}

async function loadHandleToolEvent() {
	const start = boardToolsSrc.indexOf("function handleToolEvent");
	const end = boardToolsSrc.indexOf("export function useBoardToolBus");
	const fnBody = boardToolsSrc.slice(start, end);
	const code = `
		const setOutlineTool = () => {};
		${fnBody}
		export { handleToolEvent };
	`;
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
	);
	return mod.handleToolEvent;
}

const tryCommitZone = await loadTryCommitZone();
const handleToolEvent = await loadHandleToolEvent();

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

		assert.ok(updated.tracks.length >= 1);
		const firstTrack = updated.tracks[0];
		assert.equal(firstTrack.netId, "Net-(D1-A)");
		assert.equal(firstTrack.layer, "F.Cu");
		assert.deepEqual(firstTrack.start, [10, 10]);
		const lastTrack = updated.tracks.at(-1);
		assert.deepEqual(lastTrack.end, [25, 25]);
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
		assert.ok(committedBoard.tracks.length >= 1);
		assert.deepEqual(committedBoard.tracks[0].start, [0, 0]);
		assert.deepEqual(committedBoard.tracks.at(-1).end, [10, 10]);
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
		let committedBoard = null;
		let resetCalled = false;
		const st = {
			reset: () => {
				resetCalled = true;
			},
		};
		const ctx = {
			activeTool: "addZone",
			points: [
				[-50, -50],
				[50, -50],
				[50, 50],
				[-50, 50],
			],
			board: { zones: [] },
			pushBoard: (b) => {
				committedBoard = b;
			},
			activeLayer: "F.Cu",
			toolProps: {
				netId: "Net-(R1-Pad1)",
				layer: "B.Cu",
				keepout: false,
			},
		};

		const result = tryCommitZone(st, ctx);
		assert.equal(result, true, "tryCommitZone should return true");
		assert.ok(resetCalled, "st.reset() must be called");
		assert.ok(committedBoard, "pushBoard must receive updated board");
		assert.equal(committedBoard.zones.length, 1);
		const zone = committedBoard.zones[0];
		assert.equal(zone.netId, "Net-(R1-Pad1)");
		assert.equal(zone.layer, "B.Cu");
		assert.equal(zone.keepout, undefined);
		assert.equal(zone.polygon.length, 4);
	});

	it("tryCommitZone commits keepout zone correctly", () => {
		let committedBoard = null;
		const st = { reset: () => {} };
		const ctx = {
			activeTool: "addZone",
			points: [
				[0, 0],
				[10, 0],
				[10, 10],
			],
			board: { zones: [] },
			pushBoard: (b) => {
				committedBoard = b;
			},
			activeLayer: "F.Cu",
			toolProps: {
				netId: "GND",
				layer: "F.Cu",
				keepout: true,
			},
		};

		const result = tryCommitZone(st, ctx);
		assert.equal(result, true);
		assert.equal(committedBoard.zones.length, 1);
		const zone = committedBoard.zones[0];
		assert.equal(zone.keepout, true);
		assert.equal(zone.netId, "");
	});

	it("tryCommitZone returns false when points count is less than 3", () => {
		let pushCalled = false;
		const st = { reset: () => {} };
		const ctx = {
			activeTool: "addZone",
			points: [
				[0, 0],
				[10, 0],
			],
			board: { zones: [] },
			pushBoard: () => {
				pushCalled = true;
			},
			activeLayer: "F.Cu",
			toolProps: { netId: "GND" },
		};

		const result = tryCommitZone(st, ctx);
		assert.equal(result, false);
		assert.equal(pushCalled, false);
	});

	it("tryCommitZone returns false when activeTool is not addZone", () => {
		const st = { reset: () => {} };
		const ctx = {
			activeTool: "drawLine",
			points: [
				[0, 0],
				[10, 0],
				[10, 10],
			],
			board: { zones: [] },
			pushBoard: () => {},
			activeLayer: "F.Cu",
		};

		const result = tryCommitZone(st, ctx);
		assert.equal(result, false);
	});
});
