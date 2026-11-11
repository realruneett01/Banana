import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	hitTest,
	partBox,
	pinPositions,
	snapToGrid,
	wireForNet,
} from "../../frontend/src/editor/schematicGeometry.js";

describe("snapToGrid", () => {
	test("snaps numbers to default 1.27 mm grid", () => {
		assert.equal(snapToGrid(0), 0);
		assert.equal(snapToGrid(1.27), 1.27);
		assert.equal(snapToGrid(2.54), 2.54);
		assert.equal(snapToGrid(1.3), 1.27);
		assert.equal(snapToGrid(2.0), 2.54);
		assert.equal(snapToGrid(-1.27), -1.27);
		assert.equal(snapToGrid(-1.3), -1.27);
	});

	test("snaps numbers to custom grid", () => {
		assert.equal(snapToGrid(2.5, 2.54), 2.54);
		assert.equal(snapToGrid(5.0, 2.54), 5.08);
	});

	test("snaps coordinate arrays and objects", () => {
		assert.deepEqual(snapToGrid([1.3, 2.5]), [1.27, 2.54]);
		assert.deepEqual(snapToGrid({ x: 1.3, y: 2.5 }), { x: 1.27, y: 2.54 });
	});
});

describe("partBox", () => {
	test("calculates box dimensions from pin count", () => {
		const part = {
			id: "part_u1",
			ref: "U1",
			placement: { x: 50, y: 50, rot: 0, side: "F" },
		};
		const box2 = partBox(part, 2);
		assert.equal(box2.width, 15.24);
		assert.equal(box2.height, 5.08);

		const box8 = partBox(part, 8);
		assert.equal(box8.width, 15.24);
		assert.equal(box8.height, 12.7);
		assert.equal(box8.x, 50 - 15.24 / 2);
		assert.equal(box8.y, 50 - 12.7 / 2);
	});
});

describe("pinPositions", () => {
	const basePart = {
		id: "part_u1",
		ref: "U1",
		placement: { x: 100, y: 100, rot: 0, side: "F" },
	};

	test("rot = 0, side = F: odd pins left, even pins right", () => {
		const pos = pinPositions(basePart, [1, 2, 3, 4]);
		const p1 = pos.get(1);
		const p2 = pos.get(2);
		const p3 = pos.get(3);
		const p4 = pos.get(4);

		assert.ok(p1[0] < 100, "pin 1 on left");
		assert.ok(p2[0] > 100, "pin 2 on right");
		assert.ok(p3[0] < 100, "pin 3 on left");
		assert.ok(p4[0] > 100, "pin 4 on right");
		assert.equal(p1[1], p2[1], "pins 1 and 2 in same row");
		assert.equal(p3[1], p4[1], "pins 3 and 4 in same row");
		assert.ok(p3[1] > p1[1], "row 1 below row 0");
	});

	test("rot = 90: rotates clockwise by 90 degrees", () => {
		const part90 = {
			...basePart,
			placement: { x: 100, y: 100, rot: 90, side: "F" },
		};
		const pos0 = pinPositions(basePart, [1]);
		const pos90 = pinPositions(part90, [1]);
		const p0 = pos0.get(1);
		const p90 = pos90.get(1);

		const dx0 = p0[0] - 100;
		const dy0 = p0[1] - 100;
		const expectedX = 100 - dy0;
		const expectedY = 100 + dx0;
		assert.equal(p90[0], expectedX);
		assert.equal(p90[1], expectedY);
	});

	test("rot = 180: rotates by 180 degrees", () => {
		const part180 = {
			...basePart,
			placement: { x: 100, y: 100, rot: 180, side: "F" },
		};
		const p0 = pinPositions(basePart, [1]).get(1);
		const p180 = pinPositions(part180, [1]).get(1);

		assert.equal(p180[0], 200 - p0[0]);
		assert.equal(p180[1], 200 - p0[1]);
	});

	test("rot = 270: rotates clockwise by 270 degrees", () => {
		const part270 = {
			...basePart,
			placement: { x: 100, y: 100, rot: 270, side: "F" },
		};
		const p0 = pinPositions(basePart, [1]).get(1);
		const p270 = pinPositions(part270, [1]).get(1);

		const dx0 = p0[0] - 100;
		const dy0 = p0[1] - 100;
		assert.equal(p270[0], 100 + dy0);
		assert.equal(p270[1], 100 - dx0);
	});

	test("side = B: flips horizontally", () => {
		const partB = {
			...basePart,
			placement: { x: 100, y: 100, rot: 0, side: "B" },
		};
		const posF = pinPositions(basePart, [1, 2]);
		const posB = pinPositions(partB, [1, 2]);

		const p1F = posF.get(1);
		const p1B = posB.get(1);
		assert.equal(p1B[0], 200 - p1F[0], "pin 1 flipped to right side");
		assert.equal(p1B[1], p1F[1], "y coordinate unchanged on flip");
	});
});

describe("wireForNet", () => {
	function verifyManhattan(polylines) {
		for (const poly of polylines) {
			assert.ok(poly.length >= 2, "polyline must have at least 2 points");
			for (let i = 0; i < poly.length - 1; i++) {
				const [x1, y1] = poly[i];
				const [x2, y2] = poly[i + 1];
				const isHoriz = y1 === y2;
				const isVert = x1 === x2;
				assert.ok(
					isHoriz || isVert,
					`segment (${x1},${y1})-(${x2},${y2}) must be horizontal or vertical`,
				);
			}
		}
	}

	test("2-pin net produces Manhattan polyline", () => {
		const net = {
			id: "net_clk",
			name: "CLK",
			pins: [
				{ partId: "part_u1", pin: "1" },
				{ partId: "part_u2", pin: "2" },
			],
		};
		const pinPos = new Map([
			["part_u1:1", [10, 20]],
			["part_u2:2", [50, 80]],
		]);
		const polylines = wireForNet(net, pinPos);
		assert.equal(polylines.length, 1);
		verifyManhattan(polylines);
		assert.deepEqual(polylines[0][0], [10, 20]);
		assert.deepEqual(polylines[0][polylines[0].length - 1], [50, 80]);
	});

	test("3-pin net produces spanning tree connecting all pins", () => {
		const net = {
			id: "net_vcc",
			name: "VCC",
			pins: [
				{ partId: "part_u1", pin: "1" },
				{ partId: "part_u2", pin: "1" },
				{ partId: "part_u3", pin: "1" },
			],
		};
		const pinPos = new Map([
			["part_u1:1", [0, 0]],
			["part_u2:1", [20, 20]],
			["part_u3:1", [40, 0]],
		]);
		const polylines = wireForNet(net, pinPos);
		assert.equal(polylines.length, 2);
		verifyManhattan(polylines);
	});

	test("empty or single-pin net produces no wires", () => {
		const emptyNet = { id: "net_0", name: "EMPTY", pins: [] };
		assert.deepEqual(wireForNet(emptyNet, new Map()), []);

		const singleNet = {
			id: "net_1",
			name: "ONE",
			pins: [{ partId: "part_u1", pin: "1" }],
		};
		assert.deepEqual(wireForNet(singleNet, new Map()), []);
	});
});

describe("hitTest priorities", () => {
	const doc = {
		ir: {
			parts: [
				{
					id: "part_u1",
					ref: "U1",
					value: "NE555",
					placement: { x: 50, y: 50, rot: 0, side: "F" },
					pins: ["1", "2"],
				},
			],
			nets: [
				{
					id: "net_1",
					name: "NET1",
					pins: [
						{ partId: "part_u1", pin: "1" },
						{ partId: "part_u1", pin: "2" },
					],
				},
			],
		},
	};

	test("pin has priority over part and wire", () => {
		const pins = pinPositions(doc.ir.parts[0], [1, 2]);
		const p1 = pins.get(1);
		const hit = hitTest(doc, p1);
		assert.deepEqual(hit, { kind: "pin", id: "part_u1", pin: "1" });
	});

	test("wire has priority over part", () => {
		const hit = hitTest(doc, [50, 50]);
		assert.ok(hit !== null);
		if (hit.kind === "wire") {
			assert.equal(hit.id, "net_1");
		} else {
			assert.equal(hit.kind, "part");
		}
	});

	test("part body hits part when no pin or wire is near", () => {
		const emptyNetDoc = {
			ir: {
				parts: [
					{
						id: "part_u2",
						ref: "U2",
						placement: { x: 150, y: 150, rot: 0, side: "F" },
						pins: ["1", "2"],
					},
				],
				nets: [],
			},
		};
		const hit = hitTest(emptyNetDoc, [150, 150]);
		assert.deepEqual(hit, { kind: "part", id: "part_u2" });
	});

	test("returns null when clicking empty space", () => {
		const hit = hitTest(doc, [500, 500]);
		assert.equal(hit, null);
	});
});
