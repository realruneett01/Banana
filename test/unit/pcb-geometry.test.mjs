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

const REQUIRED_LAYERS = [
	"F.Cu",
	"B.Cu",
	"F.SilkS",
	"B.SilkS",
	"Edge.Cuts",
	"F.Mask",
	"B.Mask",
];

const FOOTPRINT_CASES = [
	{ fp: "R_0402_1005Metric", w: 1.0, h: 0.5 },
	{ fp: "C_0603_1608Metric", w: 1.6, h: 0.8 },
	{ fp: "Resistor_SMD:R_0805", w: 2.0, h: 1.25 },
	{ fp: "Capacitor_SMD:C_1206", w: 3.2, h: 1.6 },
	{ fp: "Package_TO_SOT_SMD:SOT-23", w: 2.9, h: 1.3 },
	{ fp: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", w: 4.9, h: 3.9 },
	{ fp: "Package_DIP:DIP-8_W7.62mm", w: 9.5, h: 6.5 },
	{ fp: "UnknownCustomFootprint", w: 5, h: 5 },
];

const HIT_CASES = [
	{
		name: "detects part hit within footprint boundary",
		target: [20.2, 20.1],
		expected: { kind: "part", id: "part_r1" },
	},
	{
		name: "detects track hit near track centerline",
		target: [5, 0.1],
		expected: { kind: "track", index: 0 },
	},
	{
		name: "detects via hit near via coordinate",
		target: [40.1, 40.0],
		expected: { kind: "via", index: 0 },
	},
];

function makeTestPart({ id, ref, footprint, placement, sizeMm }) {
	const part = { id, ref, footprint, placement };
	if (sizeMm) part.props = { sizeMm };
	return part;
}

function assertRectSize(rect, w, h) {
	assert.deepEqual([rect.w, rect.h], [w, h]);
}

function makePin(partId, pin = "1") {
	return { partId, pin };
}

function makeEndpoint(x, y, partId, pin) {
	return { x, y, partId, pin };
}

function makeTrackSegment(start, end, options = {}) {
	return {
		netId: options.netId ?? "net_gnd",
		layer: options.layer ?? "F.Cu",
		start,
		end,
		widthMm: options.widthMm ?? 0.5,
	};
}

function assertBoardTrackTransition(prev, next, prevCount, expectedTracks) {
	assert.ok(prev !== next);
	assert.equal(prev.tracks.length, prevCount);
	assert.deepEqual(next.tracks, expectedTracks);
}

function assertHitResult(hit, expectedProps) {
	assert.ok(hit);
	for (const [key, val] of Object.entries(expectedProps)) {
		assert.equal(hit[key], val);
	}
}

describe("pcbGeometry - LAYER_COLORS", () => {
	test("defines required KiCad-like layer colors", () => {
		for (const layer of REQUIRED_LAYERS) {
			const color = LAYER_COLORS[layer];
			assert.ok(typeof color === "string" && color.startsWith("#"));
		}
	});
});

describe("pcbGeometry - footprintRect", () => {
	test("resolves standard footprint sizes from name hints", () => {
		for (const c of FOOTPRINT_CASES) {
			const rect = footprintRect({ id: "p1", ref: "R1", footprint: c.fp });
			assertRectSize(rect, c.w, c.h);
		}
	});

	test("honors placement coordinates, rotation, and side", () => {
		const part = makeTestPart({
			id: "part_u1",
			ref: "U1",
			footprint: "Package_SO:SOIC-8",
			placement: { x: 42.5, y: 73.2, rot: 90, side: "B" },
		});
		const rect = footprintRect(part);
		assert.deepEqual(
			[rect.id, rect.ref, rect.x, rect.y, rect.rot, rect.side],
			["part_u1", "U1", 42.5, 73.2, 90, "B"],
		);
	});

	test("honors custom props.sizeMm when provided", () => {
		const part = makeTestPart({
			id: "part_x",
			ref: "X1",
			footprint: "Custom",
			placement: { x: 10, y: 20, rot: 0, side: "F" },
			sizeMm: { w: 12, h: 8 },
		});
		assertRectSize(footprintRect(part), 12, 8);
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
					pins: ["u1", "u2", "u3", "u4"].map((id) => makePin(id)),
				},
			],
		};

		const edges = ratsnest(ir);
		assert.equal(edges.length, 3);
		for (const edge of edges) {
			assert.equal(edge.netId, "net_clk");
			assert.ok(
				typeof edge.from.x === "number" && typeof edge.to.x === "number",
			);
		}
	});

	test("uses custom padPos callback when provided", () => {
		const ir = {
			parts: [{ id: "u1" }, { id: "u2" }],
			nets: [
				{
					id: "net_1",
					name: "N1",
					pins: [makePin("u1", "1"), makePin("u2", "2")],
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
		assert.deepEqual(edges[0].from, makeEndpoint(5, 5, "u1", "1"));
		assert.deepEqual(edges[0].to, makeEndpoint(15, 15, "u2", "2"));
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

		assertBoardTrackTransition(board, nextBoard, 0, [
			makeTrackSegment([0, 0], [10, 0]),
			makeTrackSegment([10, 0], [10, 10]),
		]);
	});

	test("deleteTrack is pure and removes track at index", () => {
		const board = {
			tracks: [
				{ netId: "net_1", start: [0, 0], end: [5, 5] },
				{ netId: "net_2", start: [5, 5], end: [10, 10] },
			],
		};

		const nextBoard = deleteTrack(board, 0);
		assertBoardTrackTransition(board, nextBoard, 2, [board.tracks[1]]);
		assert.equal(nextBoard.tracks[0].netId, "net_2");
	});
});

describe("pcbGeometry - snapToGrid", () => {
	test("snaps scalar, array, and point object to grid", () => {
		const grid = 0.25;
		const cases = [
			{ input: 1.23, expected: 1.25 },
			{ input: 0.12, expected: 0 },
			{ input: [1.23, 2.49], expected: [1.25, 2.5] },
			{ input: { x: 1.23, y: 2.49 }, expected: { x: 1.25, y: 2.5 } },
		];
		for (const { input, expected } of cases) {
			assert.deepEqual(snapToGrid(input, grid), expected);
		}
	});
});

describe("pcbGeometry - trackLength", () => {
	test("calculates track length accurately", () => {
		const cases = [
			{ track: { start: [0, 0], end: [3, 4] }, len: 5 },
			{
				track: {
					points: [
						[0, 0],
						[3, 0],
						[3, 4],
					],
				},
				len: 7,
			},
		];
		for (const { track, len } of cases) {
			assert.equal(trackLength(track), len);
		}
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

	for (const tc of HIT_CASES) {
		test(tc.name, () => {
			const hit = hitTest(ir, board, tc.target);
			assertHitResult(hit, tc.expected);
		});
	}

	test("returns null when clicking empty space", () => {
		const hit = hitTest(ir, board, [100, 100]);
		assert.equal(hit, null);
	});

	// KiCad turns +30 counter-clockwise on a Y-down board, so the part's long
	// axis points along (cos 30, -sin 30); along (cos 30, +sin 30) is outside.
	for (const side of ["F", "B"]) {
		test(`part rotated 30 degrees on ${side} is hit KiCad's way round`, () => {
			const part = {
				id: "part_u1",
				ref: "U1",
				props: { sizeMm: { w: 10, h: 2 } },
				placement: { x: 50, y: 50, rot: 30, side },
			};
			const along = (sy) => [50 + 4 * Math.cos(Math.PI / 6), 50 + sy * 4 * 0.5];
			assert.equal(hitTest({ parts: [part] }, {}, along(-1))?.id, "part_u1");
			assert.equal(hitTest({ parts: [part] }, {}, along(1)), null);
		});
	}
});
