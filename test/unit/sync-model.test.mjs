import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	removeOrphans,
	syncBoardFromIr,
} from "../../frontend/src/editor/syncModel.js";

const DEFAULT_OUTLINE = [
	[0, 0],
	[100, 0],
	[100, 80],
	[0, 80],
];

function makePart(id, placement = null) {
	const part = { id, ref: id };
	if (placement !== null) {
		part.placement = placement;
	}
	return part;
}

function makeNet(id, name = id) {
	return { id, name, pins: [] };
}

function makeBoard(overrides = {}) {
	return {
		outline: DEFAULT_OUTLINE,
		tracks: [],
		vias: [],
		zones: [],
		...overrides,
	};
}

function assertPlacedAt(part, x, y) {
	assert.deepEqual(part.placement, { x, y, rot: 0, side: "F" });
}

function assertInSync(report) {
	assert.equal(report.inSync, true);
	assert.equal(report.summary, "Board already matches the schematic");
	assert.deepEqual(report.placed, []);
}

function assertIds(items, ids) {
	assert.deepEqual(
		items.map((item) => item.id),
		ids,
	);
}

describe("syncBoardFromIr - placement rules", () => {
	test("new part gets placement outside the outline", () => {
		const ir = { parts: [makePart("R1")], nets: [] };
		const board = makeBoard();
		const result = syncBoardFromIr(ir, board);

		assert.equal(result.report.placed.length, 1);
		assert.equal(result.report.placed[0], "R1");
		const placed = result.ir.parts[0].placement;
		assert.ok(placed.x > 100);
		assert.equal(placed.rot, 0);
		assert.equal(placed.side, "F");
	});

	test("several new parts do not overlap each other", () => {
		const ir = {
			parts: [makePart("R1"), makePart("R2"), makePart("R3")],
			nets: [],
		};
		const board = makeBoard();
		const result = syncBoardFromIr(ir, board, { spacing: 12 });

		assert.equal(result.report.placed.length, 3);
		const positions = result.ir.parts.map((p) => p.placement);
		const yCoords = positions.map((p) => p.y);
		assert.equal(new Set(yCoords).size, 3);
		assert.equal(positions[1].y - positions[0].y, 12);
		assert.equal(positions[2].y - positions[1].y, 12);
	});

	test("existing placements untouched", () => {
		const fixedPlacement = { x: 50, y: 40, rot: 90, side: "B" };
		const ir = {
			parts: [makePart("U1", fixedPlacement), makePart("R1")],
			nets: [],
		};
		const board = makeBoard();
		const result = syncBoardFromIr(ir, board);

		assert.deepEqual(result.ir.parts[0].placement, fixedPlacement);
		assert.deepEqual(result.report.placed, ["R1"]);
	});

	test("no outline case places parts starting at (0, 0)", () => {
		const ir = {
			parts: [makePart("C1"), makePart("C2")],
			nets: [],
		};
		const board = { outline: null, tracks: [], vias: [], zones: [] };
		const result = syncBoardFromIr(ir, board, { spacing: 15 });

		assertPlacedAt(result.ir.parts[0], 0, 0);
		assertPlacedAt(result.ir.parts[1], 0, 15);
	});

	test("non-finite or partial placement coordinates are replaced", () => {
		const testCases = [
			{ x: Number.NaN, y: 10 },
			{ x: 10, y: Number.POSITIVE_INFINITY },
			{ x: "invalid", y: 20 },
		];
		for (const badPlacement of testCases) {
			const ir = { parts: [makePart("R_bad", badPlacement)], nets: [] };
			const result = syncBoardFromIr(ir, makeBoard());
			assert.equal(result.report.placed.includes("R_bad"), true);
			assert.equal(Number.isFinite(result.ir.parts[0].placement.x), true);
		}
	});

	test("new parts avoid collisions with existing placed parts on the grid row", () => {
		const outline = [
			[0, 0],
			[100, 0],
			[100, 50],
			[0, 50],
		];
		const occupied = { x: 110, y: 0, rot: 0, side: "F" };
		const ir = {
			parts: [makePart("R_old", occupied), makePart("R_new")],
			nets: [],
		};
		const board = makeBoard({ outline });
		const result = syncBoardFromIr(ir, board, { spacing: 10 });

		assertPlacedAt(result.ir.parts[1], 110, 10);
	});
});

describe("syncBoardFromIr - orphan detection and reports", () => {
	test("orphan track, via and zone reported not deleted", () => {
		const ir = { parts: [], nets: [makeNet("net_active")] };
		const board = makeBoard({
			tracks: [
				{ netId: "net_active", start: [0, 0], end: [10, 0] },
				{ netId: "net_deleted", start: [10, 0], end: [20, 0] },
			],
			vias: [
				{ netId: "net_deleted", at: [20, 0] },
				{ netId: "net_active", at: [30, 0] },
			],
			zones: [{ netId: "net_deleted", layer: "F.Cu", polygon: [] }],
		});
		const result = syncBoardFromIr(ir, board);

		assert.deepEqual(result.report.orphanTracks, [1]);
		assert.deepEqual(result.report.orphanVias, [0]);
		assert.deepEqual(result.report.orphanZones, [0]);
		assert.equal(result.board.tracks.length, 2);
		assert.equal(result.board.vias.length, 2);
		assert.equal(result.board.zones.length, 1);
	});

	test("in-sync design reports inSync true and matches summary", () => {
		const ir = {
			parts: [makePart("R1", { x: 10, y: 10, rot: 0, side: "F" })],
			nets: [makeNet("net_1")],
		};
		const board = makeBoard({
			tracks: [{ netId: "net_1", start: [0, 0], end: [10, 0] }],
			vias: [{ netId: "net_1", at: [10, 0] }],
			zones: [{ netId: "net_1", layer: "B.Cu", polygon: [] }],
		});
		const result = syncBoardFromIr(ir, board);

		assertInSync(result.report);
	});

	test("summary sentence formats singular and plural clauses", () => {
		const cases = [
			{
				parts: [makePart("R1")],
				tracks: [{ netId: "old" }],
				vias: [],
				zones: [],
				expected:
					"1 new part placed next to the board, 1 track no longer belongs to any connection",
			},
			{
				parts: [makePart("R1"), makePart("R2")],
				tracks: [{ netId: "a" }, { netId: "b" }],
				vias: [{ netId: "c" }],
				zones: [{ netId: "d" }, { netId: "e" }],
				expected:
					"2 new parts placed next to the board, 2 tracks no longer belong to any connection, 1 via no longer belongs to any connection, 2 zones no longer belong to any connection",
			},
		];

		for (const tc of cases) {
			const res = syncBoardFromIr(
				{ parts: tc.parts, nets: [] },
				makeBoard({ tracks: tc.tracks, vias: tc.vias, zones: tc.zones }),
			);
			assert.equal(res.report.inSync, false);
			assert.equal(res.report.summary, tc.expected);
		}
	});
});

describe("removeOrphans and safety guarantees", () => {
	test("removeOrphans removes exactly the reported items", () => {
		const board = makeBoard({
			tracks: [
				{ id: "t0", netId: "n1" },
				{ id: "t1", netId: "old" },
				{ id: "t2", netId: "n1" },
			],
			vias: [
				{ id: "v0", netId: "old" },
				{ id: "v1", netId: "n1" },
			],
			zones: [
				{ id: "z0", netId: "n1" },
				{ id: "z1", netId: "old" },
			],
		});
		const report = {
			orphanTracks: [1],
			orphanVias: [0],
			orphanZones: [1],
		};
		const cleaned = removeOrphans(board, report);

		assertIds(cleaned.tracks, ["t0", "t2"]);
		assertIds(cleaned.vias, ["v1"]);
		assertIds(cleaned.zones, ["z0"]);
		assert.equal(board.tracks.length, 3);
	});

	test("removeOrphans handles null board or missing report safely", () => {
		const cleaned1 = removeOrphans(null, null);
		assert.deepEqual(cleaned1, { tracks: [], vias: [], zones: [] });

		const board = makeBoard({ tracks: [{ netId: "n1" }] });
		const cleaned2 = removeOrphans(board, null);
		assert.equal(cleaned2.tracks.length, 1);
	});

	test("null board and null ir handled without throwing", () => {
		const result = syncBoardFromIr(null, null);
		assert.ok(result);
		assertInSync(result.report);
		assert.deepEqual(result.ir.parts, []);
	});

	test("inputs not mutated", () => {
		const originalPart = makePart("R1");
		const ir = { parts: [originalPart], nets: [] };
		const track = { netId: "ghost" };
		const board = makeBoard({ tracks: [track] });

		syncBoardFromIr(ir, board);

		assert.equal(originalPart.placement, undefined);
		assert.equal(ir.parts.length, 1);
		assert.equal(board.tracks.length, 1);
	});
});
