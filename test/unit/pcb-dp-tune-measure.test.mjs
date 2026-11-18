import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const pcbCanvasSrc = readFileSync(
	new URL("../../frontend/src/editor/PcbCanvas.jsx", import.meta.url),
	"utf8",
);

const startMarker = "// --- PCB DiffPair, Tune, Measure pure helpers ---";
const endMarker = "// --- End PCB DiffPair, Tune, Measure pure helpers ---";
const sliceStart = pcbCanvasSrc.indexOf(startMarker);
const sliceEnd = pcbCanvasSrc.indexOf(endMarker);
assert.ok(
	sliceStart !== -1 && sliceEnd !== -1,
	"Found pure helpers section in PcbCanvas.jsx",
);
const pureHelpersCode = pcbCanvasSrc.slice(sliceStart, sliceEnd);

const viewportUrl = new URL(
	"../../frontend/src/editor/viewport.js",
	import.meta.url,
).href;

const dynamicModule = [
	`import { formatCoord } from ${JSON.stringify(viewportUrl)};`,
	pureHelpersCode,
].join("\n");

const {
	calcMeasureReadout,
	calcLengthTuneDefaults,
	resolveDiffPairDimensions,
	findPartnerPad,
	replaceTrackWithPoints,
} = await import(
	`data:text/javascript;base64,${Buffer.from(dynamicModule).toString("base64")}`
);

describe("calcMeasureReadout pure function", () => {
	test("calculates distance, dx, dy, and angle for horizontal segment", () => {
		const res = calcMeasureReadout([0, 0], [10, 0], "mm");
		assert.equal(res.distance, 10);
		assert.equal(res.dx, 10);
		assert.equal(res.dy, 0);
		assert.equal(res.angle, 0);
		assert.equal(res.distStr, "10.0000 mm");
		assert.equal(res.dxStr, "10.0000 mm");
		assert.equal(res.dyStr, "0.0000 mm");
		assert.equal(res.angleStr, "0.0°");
		assert.ok(res.text.includes("10.0000 mm"));
	});

	test("calculates distance, dx, dy, and angle for 3-4-5 triangle", () => {
		const res = calcMeasureReadout({ x: 0, y: 0 }, { x: 3, y: 4 }, "mm");
		assert.equal(res.distance, 5);
		assert.equal(res.dx, 3);
		assert.equal(res.dy, 4);
		assert.equal(res.distStr, "5.0000 mm");
		assert.equal(res.angleStr, "53.1°");
	});

	test("respects inches and mils units", () => {
		const inRes = calcMeasureReadout([0, 0], [25.4, 0], "in");
		assert.equal(inRes.distStr, "1.0000 in");
		assert.equal(inRes.dxStr, "1.0000 in");

		const milRes = calcMeasureReadout([0, 0], [2.54, 0], "mil");
		assert.equal(milRes.distStr, "100.0 mil");
	});

	test("handles zero distance without NaN", () => {
		const res = calcMeasureReadout([5, 5], [5, 5], "mm");
		assert.equal(res.distance, 0);
		assert.equal(res.angle, 0);
		assert.equal(res.distStr, "0.0000 mm");
	});
});

describe("calcLengthTuneDefaults pure function", () => {
	test("prefills target length with +10% and standard amplitude/spacing", () => {
		const defs = calcLengthTuneDefaults(10);
		assert.equal(defs.currentLength, 10);
		assert.equal(defs.targetLengthMm, 11);
		assert.equal(defs.amplitudeMm, 1.0);
		assert.equal(defs.spacingMm, 0.6);
	});

	test("handles fractional lengths correctly", () => {
		const defs = calcLengthTuneDefaults(25.5);
		assert.equal(defs.currentLength, 25.5);
		assert.equal(defs.targetLengthMm, 28.05);
	});

	test("handles zero or non-numeric input", () => {
		const defs = calcLengthTuneDefaults(0);
		assert.equal(defs.currentLength, 0);
		assert.equal(defs.targetLengthMm, 0);
	});
});

describe("resolveDiffPairDimensions pure function", () => {
	test("returns default 0.2 mm width and 0.25 mm gap when setup is empty", () => {
		const { widthMm, gapMm } = resolveDiffPairDimensions(null);
		assert.equal(widthMm, 0.2);
		assert.equal(gapMm, 0.25);
	});

	test("reads setup diffPairWidth and diffPairGap", () => {
		const board = { setup: { diffPairWidth: 0.35, diffPairGap: 0.15 } };
		const { widthMm, gapMm } = resolveDiffPairDimensions(board);
		assert.equal(widthMm, 0.35);
		assert.equal(gapMm, 0.15);
	});

	test("reads snake_case setup values", () => {
		const board = { setup: { diff_pair_width: 0.18, diff_pair_gap: 0.22 } };
		const { widthMm, gapMm } = resolveDiffPairDimensions(board);
		assert.equal(widthMm, 0.18);
		assert.equal(gapMm, 0.22);
	});
});

describe("findPartnerPad pure function", () => {
	const irFixture = {
		nets: [
			{
				id: "net_dp_p",
				name: "USB_D+",
				pins: [
					{ partId: "U1", pin: "1" },
					{ partId: "J1", pin: "2" },
				],
			},
			{
				id: "net_dp_n",
				name: "USB_D-",
				pins: [
					{ partId: "U1", pin: "2" },
					{ partId: "J1", pin: "3" },
				],
			},
		],
	};

	const padPositionsFixture = {
		U1: {
			1: [10, 10],
			2: [10, 12],
		},
		J1: {
			2: [50, 10],
			3: [50, 12],
		},
	};

	test("finds partner pad on the same part as start pad", () => {
		const startPad = {
			partId: "U1",
			pinNum: "1",
			pos: [10, 10],
			netName: "USB_D+",
		};
		const partner = findPartnerPad(startPad, "USB_D-", {
			ir: irFixture,
			padPositions: padPositionsFixture,
			pads: [],
		});
		assert.ok(partner);
		assert.equal(partner.partId, "U1");
		assert.equal(partner.pinNum, "2");
		assert.deepEqual(partner.pos, [10, 12]);
	});

	test("finds closest partner pad when no pad on same part exists", () => {
		const startPad = {
			partId: "R1",
			pinNum: "1",
			pos: [48, 11],
			netName: "USB_D+",
		};
		const partner = findPartnerPad(startPad, "USB_D-", {
			ir: irFixture,
			padPositions: padPositionsFixture,
			pads: [],
		});
		assert.ok(partner);
		assert.equal(partner.partId, "J1");
		assert.equal(partner.pinNum, "3");
		assert.deepEqual(partner.pos, [50, 12]);
	});

	test("returns null when partner net does not exist", () => {
		const startPad = {
			partId: "U1",
			pinNum: "1",
			pos: [10, 10],
			netName: "USB_D+",
		};
		const partner = findPartnerPad(startPad, "NONEXISTENT", {
			ir: irFixture,
			padPositions: padPositionsFixture,
			pads: [],
		});
		assert.equal(partner, null);
	});
});

describe("replaceTrackWithPoints pure function", () => {
	test("replaces single track with multiple segments from meander output", () => {
		const board = {
			tracks: [
				{
					netId: "NET1",
					layer: "F.Cu",
					start: [0, 0],
					end: [10, 0],
					widthMm: 0.25,
				},
			],
		};
		const points = [
			[0, 0],
			[4, 0],
			[4, 2],
			[6, 2],
			[6, 0],
			[10, 0],
		];
		const updated = replaceTrackWithPoints(board, 0, points);
		assert.equal(updated.tracks.length, 5);
		assert.deepEqual(updated.tracks[0].start, [0, 0]);
		assert.deepEqual(updated.tracks[0].end, [4, 0]);
		assert.equal(updated.tracks[0].netId, "NET1");
		assert.equal(updated.tracks[0].layer, "F.Cu");
	});
});

describe("PcbCanvas tool contracts", () => {
	test("contains tool bus registrations for routeDiffPair, tuneLength, and measure", () => {
		assert.ok(pcbCanvasSrc.includes("routeDiffPair:"));
		assert.ok(pcbCanvasSrc.includes("tuneLength:"));
		assert.ok(pcbCanvasSrc.includes("measure:"));
	});

	test("contains hotkey handling for 6, 7, and Ctrl+Shift+M", () => {
		assert.ok(pcbCanvasSrc.includes('key === "6"'));
		assert.ok(pcbCanvasSrc.includes('key === "7"'));
		assert.ok(
			pcbCanvasSrc.includes("ctrlKey") &&
				pcbCanvasSrc.includes("shiftKey") &&
				pcbCanvasSrc.includes('"m"'),
		);
	});
});
