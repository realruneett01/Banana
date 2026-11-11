import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	addTrack,
	deleteTrack,
	footprintRect,
	hitTest,
	LAYER_COLORS,
	ratsnest,
	snapToGrid,
	trackLength,
} from "../../frontend/src/editor/pcbGeometry.js";

describe("pcbGeometry - LAYER_COLORS", () => {
	test("defines required KiCad-like layer colors", () => {
		const required = [
			"F.Cu",
			"B.Cu",
			"F.SilkS",
			"B.SilkS",
			"Edge.Cuts",
			"F.Mask",
			"B.Mask",
		];
		for (const layer of required) {
			assert.equal(typeof LAYER_COLORS[layer], "string");
			assert.ok(LAYER_COLORS[layer].startsWith("#"));
		}
	});
});

describe("pcbGeometry - footprintRect", () => {
	test("resolves standard footprint sizes from name hints", () => {
		const cases = [
			{ fp: "R_0402_1005Metric", w: 1.0, h: 0.5 },
			{ fp: "C_0603_1608Metric", w: 1.6, h: 0.8 },
			{ fp: "Resistor_SMD:R_0805", w: 2.0, h: 1.25 },
			{ fp: "Capacitor_SMD:C_1206", w: 3.2, h: 1.6 },
			{ fp: "Package_TO_SOT_SMD:SOT-23", w: 2.9, h: 1.3 },
			{ fp: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", w: 4.9, h: 3.9 },
			{ fp: "Package_DIP:DIP-8_W7.62mm", w: 9.5, h: 6.5 },
			{ fp: "UnknownCustomFootprint", w: 5, h: 5 },
		];

		for (const c of cases) {
			const rect = footprintRect({ id: "p1", ref: "R1", footprint: c.fp });
			assert.equal(rect.w, c.w);
			assert.equal(rect.h, c.h);
		}
	});

	test("honors placement coordinates, rotation, and side", () => {
		const part = {
			id: "part_u1",
			ref: "U1",
			footprint: "Package_SO:SOIC-8",
			placement: { x: 42.5, y: 73.2, rot: 90, side: "B" },
		};
		const rect = footprintRect(part);
		assert.equal(rect.id, "part_u1");
		assert.equal(rect.ref, "U1");
		assert.equal(rect.x, 42.5);
		assert.equal(rect.y, 73.2);
		assert.equal(rect.rot, 90);
		assert.equal(rect.side, "B");
	});

	test("honors custom props.sizeMm when provided", () => {
		const part = {
			id: "part_x",
			ref: "X1",
			footprint: "Custom",
			props: { sizeMm: { w: 12, h: 8 } },
			placement: { x: 10, y: 20, rot: 0, side: "F" },
		};
		const rect = footprintRect(part);
		assert.equal(rect.w, 12);
		assert.equal(rect.h, 8);
	});
});

describe("pcbGeometry - ratsnest", () => {
	test("connects every pin of a net with n-1 edges via MST", () => {
		const ir = {
			parts: [
				{ id: "u1", placement: { x: 0, y: 0 } },
				{ id: "u2", placement: { x: 10, y: 0 } },
				{ id: "u3", placement: { x: 10, y: 10 } },
				{ id: "u4", placement: { x: 0, y: 10 } },
			],
			nets: [
				{
					id: "net_clk",
					name: "CLK",
					pins: [
						{ partId: "u1", pin: "1" },
						{ partId: "u2", pin: "1" },
						{ partId: "u3", pin: "1" },
						{ partId: "u4", pin: "1" },
					],
				},
			],
		};

		const edges = ratsnest(ir);
		assert.equal(edges.length, 3);
		for (const edge of edges) {
			assert.equal(edge.netId, "net_clk");
			assert.ok(typeof edge.from.x === "number");
			assert.ok(typeof edge.to.x === "number");
		}
	});

	test("uses custom padPos callback when provided", () => {
		const ir = {
			parts: [{ id: "u1" }, { id: "u2" }],
			nets: [
				{
					id: "net_1",
					name: "N1",
					pins: [
						{ partId: "u1", pin: "1" },
						{ partId: "u2", pin: "2" },
					],
				},
			],
		};
		const padPos = (partId, pin) => {
			if (partId === "u1" && pin === "1") return { x: 5, y: 5 };
			if (partId === "u2" && pin === "2") return { x: 15, y: 15 };
			return null;
		};

		const edges = ratsnest(ir, padPos);
		assert.equal(edges.length, 1);
		assert.deepEqual(edges[0].from, {
			x: 5,
			y: 5,
			partId: "u1",
			pin: "1",
		});
		assert.deepEqual(edges[0].to, {
			x: 15,
			y: 15,
			partId: "u2",
			pin: "2",
		});
	});
});

describe("pcbGeometry - addTrack and deleteTrack", () => {
	test("addTrack is pure and creates segments from points", () => {
		const board = {
			outline: [],
			layers: ["F.Cu", "B.Cu"],
			tracks: [],
			vias: [],
			zones: [],
		};

		const nextBoard = addTrack(board, {
			netId: "net_gnd",
			layer: "F.Cu",
			points: [
				[0, 0],
				[10, 0],
				[10, 10],
			],
			widthMm: 0.5,
		});

		assert.notEqual(board, nextBoard);
		assert.equal(board.tracks.length, 0);
		assert.equal(nextBoard.tracks.length, 2);
		assert.deepEqual(nextBoard.tracks[0], {
			netId: "net_gnd",
			layer: "F.Cu",
			start: [0, 0],
			end: [10, 0],
			widthMm: 0.5,
		});
		assert.deepEqual(nextBoard.tracks[1], {
			netId: "net_gnd",
			layer: "F.Cu",
			start: [10, 0],
			end: [10, 10],
			widthMm: 0.5,
		});
	});

	test("deleteTrack is pure and removes track at index", () => {
		const board = {
			tracks: [
				{ netId: "net_1", start: [0, 0], end: [5, 5] },
				{ netId: "net_2", start: [5, 5], end: [10, 10] },
			],
		};

		const nextBoard = deleteTrack(board, 0);
		assert.notEqual(board, nextBoard);
		assert.equal(board.tracks.length, 2);
		assert.equal(nextBoard.tracks.length, 1);
		assert.equal(nextBoard.tracks[0].netId, "net_2");
	});
});

describe("pcbGeometry - snapToGrid", () => {
	test("snaps scalar, array, and point object to grid", () => {
		assert.equal(snapToGrid(1.23, 0.25), 1.25);
		assert.equal(snapToGrid(0.12, 0.25), 0);
		assert.deepEqual(snapToGrid([1.23, 2.49], 0.25), [1.25, 2.5]);
		assert.deepEqual(snapToGrid({ x: 1.23, y: 2.49 }, 0.25), {
			x: 1.25,
			y: 2.5,
		});
	});
});

describe("pcbGeometry - trackLength", () => {
	test("calculates track length accurately", () => {
		const seg = { start: [0, 0], end: [3, 4] };
		assert.equal(trackLength(seg), 5);

		const multi = {
			points: [
				[0, 0],
				[3, 0],
				[3, 4],
			],
		};
		assert.equal(trackLength(multi), 7);
	});
});

describe("pcbGeometry - hitTest", () => {
	const ir = {
		parts: [
			{
				id: "part_r1",
				ref: "R1",
				footprint: "Resistor_SMD:R_0805",
				placement: { x: 20, y: 20, rot: 0, side: "F" },
			},
		],
	};
	const board = {
		tracks: [
			{
				netId: "net_1",
				layer: "F.Cu",
				start: [0, 0],
				end: [10, 0],
				widthMm: 0.5,
			},
		],
		vias: [{ netId: "net_2", at: [40, 40], drillMm: 0.4, sizeMm: 0.8 }],
	};

	test("detects part hit within footprint boundary", () => {
		const hit = hitTest(ir, board, [20.2, 20.1]);
		assert.ok(hit);
		assert.equal(hit.kind, "part");
		assert.equal(hit.id, "part_r1");
	});

	test("detects track hit near track centerline", () => {
		const hit = hitTest(ir, board, [5, 0.1]);
		assert.ok(hit);
		assert.equal(hit.kind, "track");
		assert.equal(hit.index, 0);
	});

	test("detects via hit near via coordinate", () => {
		const hit = hitTest(ir, board, [40.1, 40.0]);
		assert.ok(hit);
		assert.equal(hit.kind, "via");
		assert.equal(hit.index, 0);
	});

	test("returns null when clicking empty space", () => {
		const hit = hitTest(ir, board, [100, 100]);
		assert.equal(hit, null);
	});
});
