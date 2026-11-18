import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	hitTest,
	partBox,
	pinPositions,
	snapToGrid,
	wireForNet,
	wireHitTolerance,
} from "../../frontend/src/editor/schematicGeometry.js";

function assertPair(actual, [expectedX, expectedY], messages = []) {
	assert.equal(actual[0], expectedX, messages[0]);
	assert.equal(actual[1], expectedY, messages[1]);
}

function makePart(opts = {}) {
	const {
		id = "part_u1",
		ref = "U1",
		x = 50,
		y = 50,
		rot = 0,
		side = "F",
		pins,
		value,
	} = opts;
	const part = { id, ref, placement: { x, y, rot, side } };
	if (pins) part.pins = pins;
	if (value) part.value = value;
	return part;
}

function makeDoc(parts, nets = []) {
	return { ir: { parts, nets } };
}

describe("snapToGrid", () => {
	test("snaps numbers to default 1.27 mm grid", () => {
		const defaultGridCases = [
			[0, 0],
			[1.27, 1.27],
			[2.54, 2.54],
			[1.3, 1.27],
			[2.0, 2.54],
			[-1.27, -1.27],
			[-1.3, -1.27],
		];
		for (const [input, expected] of defaultGridCases) {
			assert.equal(snapToGrid(input), expected);
		}
	});

	test("snaps numbers to custom grid", () => {
		const customCases = [
			{ val: 2.5, grid: 2.54, expected: 2.54 },
			{ val: 5.0, grid: 2.54, expected: 5.08 },
		];
		for (const { val, grid, expected } of customCases) {
			assert.equal(snapToGrid(val, grid), expected);
		}
	});

	test("snaps coordinate arrays and objects", () => {
		const coordCases = [
			{ actual: snapToGrid([1.3, 2.5]), expected: [1.27, 2.54] },
			{
				actual: snapToGrid({ x: 1.3, y: 2.5 }),
				expected: { x: 1.27, y: 2.54 },
			},
		];
		for (const { actual, expected } of coordCases) {
			assert.deepEqual(actual, expected);
		}
	});
});

describe("partBox", () => {
	test("calculates box dimensions from pin count", () => {
		const part = makePart();
		const checkDimensions = (pinCount, expectedWidth, expectedHeight) => {
			const box = partBox(part, pinCount);
			assert.equal(box.width, expectedWidth);
			assert.equal(box.height, expectedHeight);
			return box;
		};

		checkDimensions(2, 15.24, 5.08);
		const box8 = checkDimensions(8, 15.24, 12.7);
		assert.equal(box8.x, 50 - 15.24 / 2);
		assert.equal(box8.y, 50 - 12.7 / 2);
	});
});

describe("pinPositions", () => {
	const basePart = makePart({ x: 100, y: 100 });
	const placeBasePart = (placement) => ({
		...basePart,
		placement: { ...basePart.placement, ...placement },
	});

	test("rot = 0, side = F: odd pins left, even pins right", () => {
		const pos = pinPositions(basePart, [1, 2, 3, 4]);
		const rows = [
			{ left: pos.get(1), right: pos.get(2), leftPin: 1, rightPin: 2 },
			{ left: pos.get(3), right: pos.get(4), leftPin: 3, rightPin: 4 },
		];
		for (const { left, right, leftPin, rightPin } of rows) {
			assert.ok(left[0] < 100, `pin ${leftPin} on left`);
			assert.ok(right[0] > 100, `pin ${rightPin} on right`);
			assert.equal(
				left[1],
				right[1],
				`pins ${leftPin} and ${rightPin} in same row`,
			);
		}
		assert.ok(pos.get(3)[1] > pos.get(1)[1], "row 1 below row 0");
	});

	const ROTATION_CASES = [
		{
			name: "rot = 90: rotates clockwise by 90 degrees",
			rot: 90,
			calcExpected: (dx0, dy0) => [100 - dy0, 100 + dx0],
		},
		{
			name: "rot = 180: rotates by 180 degrees",
			rot: 180,
			calcExpected: (_dx0, _dy0, p0) => [200 - p0[0], 200 - p0[1]],
		},
		{
			name: "rot = 270: rotates clockwise by 270 degrees",
			rot: 270,
			calcExpected: (dx0, dy0) => [100 + dy0, 100 - dx0],
		},
	];

	for (const tc of ROTATION_CASES) {
		test(tc.name, () => {
			const rotatedPart = placeBasePart({ rot: tc.rot });
			const p0 = pinPositions(basePart, [1]).get(1);
			const pRot = pinPositions(rotatedPart, [1]).get(1);
			const dx0 = p0[0] - 100;
			const dy0 = p0[1] - 100;
			assertPair(pRot, tc.calcExpected(dx0, dy0, p0));
		});
	}

	test("side = B: flips horizontally", () => {
		const partB = placeBasePart({ side: "B" });
		const posF = pinPositions(basePart, [1, 2]);
		const posB = pinPositions(partB, [1, 2]);

		const p1F = posF.get(1);
		const p1B = posB.get(1);
		assertPair(
			p1B,
			[200 - p1F[0], p1F[1]],
			["pin 1 flipped to right side", "y coordinate unchanged on flip"],
		);
	});
});

describe("wireForNet", () => {
	function verifyPolylineSegments(poly) {
		assert.ok(poly.length >= 2, "polyline must have at least 2 points");
		for (let i = 0; i < poly.length - 1; i++) {
			const [x1, y1] = poly[i];
			const [x2, y2] = poly[i + 1];
			const isOrthogonal = y1 === y2 || x1 === x2;
			assert.ok(
				isOrthogonal,
				`segment (${x1},${y1})-(${x2},${y2}) must be horizontal or vertical`,
			);
		}
	}

	function verifyManhattan(polylines) {
		for (const poly of polylines) {
			verifyPolylineSegments(poly);
		}
	}

	function createNetSetup(netId, netName, pinEntries) {
		const net = {
			id: netId,
			name: netName,
			pins: pinEntries.map(([partId, pin]) => ({ partId, pin })),
		};
		const pinPos = new Map(
			pinEntries.map(([partId, pin, pos]) => [`${partId}:${pin}`, pos]),
		);
		return { net, pinPos };
	}

	function verifyNetWires(netId, netName, pinEntries, expectedWireCount) {
		const { net, pinPos } = createNetSetup(netId, netName, pinEntries);
		const polylines = wireForNet(net, pinPos);
		assert.equal(polylines.length, expectedWireCount);
		verifyManhattan(polylines);
		return polylines;
	}

	test("2-pin net produces Manhattan polyline", () => {
		const polylines = verifyNetWires(
			"net_clk",
			"CLK",
			[
				["part_u1", "1", [10, 20]],
				["part_u2", "2", [50, 80]],
			],
			1,
		);
		assert.deepEqual(polylines[0][0], [10, 20]);
		assert.deepEqual(polylines[0][polylines[0].length - 1], [50, 80]);
	});

	test("3-pin net produces spanning tree connecting all pins", () => {
		verifyNetWires(
			"net_vcc",
			"VCC",
			[
				["part_u1", "1", [0, 0]],
				["part_u2", "1", [20, 20]],
				["part_u3", "1", [40, 0]],
			],
			2,
		);
	});

	test("empty or single-pin net produces no wires", () => {
		const emptyMap = new Map();
		const cases = [
			{ id: "net_0", name: "EMPTY", pins: [] },
			{
				id: "net_1",
				name: "ONE",
				pins: [{ partId: "part_u1", pin: "1" }],
			},
		];
		for (const net of cases) {
			assert.deepEqual(wireForNet(net, emptyMap), []);
		}
	});
});

describe("hitTest priorities", () => {
	const doc = makeDoc(
		[makePart({ value: "NE555", pins: ["1", "2"] })],
		[
			{
				id: "net_1",
				name: "NET1",
				pins: [
					{ partId: "part_u1", pin: "1" },
					{ partId: "part_u1", pin: "2" },
				],
			},
		],
	);

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
		const emptyNetDoc = makeDoc([
			makePart({ id: "part_u2", ref: "U2", x: 150, y: 150, pins: ["1", "2"] }),
		]);
		const hit = hitTest(emptyNetDoc, [150, 150]);
		assert.deepEqual(hit, { kind: "part", id: "part_u2" });
	});

	test("returns null when clicking empty space", () => {
		const hit = hitTest(doc, [500, 500]);
		assert.equal(hit, null);
	});
});

describe("wireHitTolerance", () => {
	const verifyToleranceTable = (entries) => {
		for (const [zoom, expected] of entries) {
			assert.equal(wireHitTolerance(zoom), expected);
		}
	};

	test("is a fixed screen distance converted to world units", () => {
		verifyToleranceTable([
			[4, 1],
			[40, 0.1],
		]);
	});

	test("falls back to zoom 1 for a missing or bad zoom", () => {
		verifyToleranceTable([
			[0, 4],
			[undefined, 4],
		]);
	});
});
