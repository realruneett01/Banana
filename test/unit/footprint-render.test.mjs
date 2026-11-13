import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	arcToSvgPath,
	footprintToPrimitives,
	padHitTest,
	padWorldPositions,
	transformPrimitives,
} from "../../frontend/src/editor/footprintRender.js";

function makePad({ number, shape, center, size, rot = 0, layers }) {
	const pad = { type: "pad", number, shape, center, size, rot };
	if (layers) pad.layers = layers;
	return pad;
}

function assertPadProperties(actual, expected) {
	for (const key of ["type", "number", "shape", "rot"]) {
		assert.equal(actual[key], expected[key]);
	}
	for (const key of ["center", "size", "layers"]) {
		assert.deepEqual(actual[key], expected[key]);
	}
}

const PAD_SHAPE_CASES = [
	[
		"rect pad shape and rotation",
		"1",
		"smd",
		"rect",
		[1, 2, 45],
		[1.5, 2.5],
		["F.Cu"],
	],
	[
		"roundrect pad with default rot",
		"2",
		"smd",
		"roundrect",
		[-0.95, 0],
		[1, 1.45],
		["F.Cu", "F.Mask"],
	],
	[
		"circle pad shape",
		"3",
		"thru_hole",
		"circle",
		[0, 0, 0],
		[1.2, 1.2],
		["*.Cu"],
	],
	["oval pad shape", "4", "smd", "oval", [2, -1, 90], [3, 1], ["F.Cu"]],
].map(([name, number, type, shape, at, size, layers]) => ({
	name,
	pad: { number, type, shape, at, size, layers },
	expected: {
		type: "pad",
		number,
		shape,
		center: [at[0], at[1]],
		size,
		rot: at[2] ?? 0,
		layers,
	},
}));

function makeSideBPad(shape, center, size, layers) {
	return [makePad({ number: "1", shape, center, size, rot: 0, layers })];
}

const SIDE_B_CASES = [
	{
		name: "mirrors X and maps F.Cu to B.Cu at origin",
		placement: { x: 0, y: 0, rot: 0, side: "B" },
		inputPads: makeSideBPad("rect", [2, 3], [1, 1], ["F.Cu", "F.Mask"]),
		inputGraphics: [
			{
				type: "line",
				layer: "F.SilkS",
				width: 0.15,
				start: [-1, -2],
				end: [3, 4],
			},
		],
		expectedPadCenter: [-2, 3],
		expectedPadLayers: ["B.Cu", "B.Mask"],
		expectedLineStart: [1, -2],
		expectedLineEnd: [-3, 4],
		expectedLineLayer: "B.SilkS",
	},
	{
		name: "preserves *.Cu through-hole layer on side B",
		placement: { x: 10, y: 20, rot: 0, side: "B" },
		inputPads: makeSideBPad("circle", [1, 2], [1.5, 1.5], ["*.Cu"]),
		inputGraphics: [],
		expectedPadCenter: [9, 22],
		expectedPadLayers: ["*.Cu"],
	},
	{
		name: "mirrors and rotates 90 deg on side B",
		placement: { x: 10, y: 20, rot: 90, side: "B" },
		inputPads: makeSideBPad("rect", [2, 0], [1, 2], ["F.Cu"]),
		inputGraphics: [],
		expectedPadCenter: [10, 18],
		expectedPadLayers: ["B.Cu"],
	},
];

function assertSideBResult(res, tc) {
	const pad = res.pads[0];
	assert.ok(pad);
	assert.deepEqual(
		[Math.round(pad.center[0]), Math.round(pad.center[1])],
		tc.expectedPadCenter,
	);
	assert.deepEqual(pad.layers, tc.expectedPadLayers);

	if (!tc.expectedLineLayer) return;
	const line = res.graphics[0];
	assert.ok(line);
	assert.deepEqual(line.start, tc.expectedLineStart);
	assert.deepEqual(line.end, tc.expectedLineEnd);
	assert.equal(line.layer, tc.expectedLineLayer);
}

const TWO_PAD_FP = {
	pads: [
		{ number: "1", at: [-1, 0, 0] },
		{ number: "2", at: [1, 0, 0] },
	],
};

const PAD_WORLD_CASES = [
	{
		name: "front side with translation and rotation",
		fp: TWO_PAD_FP,
		placement: { x: 50, y: 30, rot: 90, side: "F" },
		expected: { 1: [50, 29], 2: [50, 31] },
	},
	{
		name: "back side mirrors X coordinates",
		fp: TWO_PAD_FP,
		placement: { x: 50, y: 30, rot: 0, side: "B" },
		expected: { 1: [51, 30], 2: [49, 30] },
	},
	{
		name: "empty or null footprint returns empty object",
		fp: null,
		placement: { x: 10, y: 10 },
		expected: {},
	},
];

const CIRCLE_PAD = {
	number: "C1",
	shape: "circle",
	center: [0, 0],
	size: [2, 2],
};

const HIT_TEST_CASES = [
	{
		name: "hits center of rect pad",
		pads: [
			{ number: "1", shape: "rect", center: [10, 10], size: [2, 4] },
			{ number: "2", shape: "rect", center: [20, 20], size: [2, 2] },
		],
		point: [10, 10],
		expected: "1",
	},
	{
		name: "hits edge of circle pad",
		pads: [CIRCLE_PAD],
		point: [0.9, 0],
		expected: "C1",
	},
	{
		name: "misses outside circle pad",
		pads: [CIRCLE_PAD],
		point: [1.2, 0],
		expected: null,
	},
	{
		name: "hits inside rotated pad",
		pads: [
			{ number: "R90", shape: "rect", center: [0, 0], size: [2, 6], rot: 90 },
		],
		point: [2.5, 0.5],
		expected: "R90",
	},
	{
		name: "hits inside oval stadium pad",
		pads: [{ number: "OV", shape: "oval", center: [0, 0], size: [4, 2] }],
		point: [1.5, 0.5],
		expected: "OV",
	},
	{
		name: "misses corner of roundrect",
		pads: [{ number: "RR", shape: "roundrect", center: [0, 0], size: [2, 2] }],
		point: [0.98, 0.98],
		expected: null,
	},
].map((tc) => ({
	name: tc.name,
	prims: { pads: tc.pads.map(makePad) },
	point: tc.point,
	expected: tc.expected,
}));

function makeArcNode(spec) {
	const middle = spec.mid
		? [
				[{ sym: "mid" }, ...spec.mid],
				[{ sym: "end" }, ...spec.end],
			]
		: [
				[{ sym: "end" }, ...spec.end],
				[{ sym: "angle" }, spec.angle],
			];
	const stroke = spec.mid
		? [{ sym: "stroke" }, [{ sym: "width" }, spec.width]]
		: [{ sym: "width" }, spec.width];
	return [
		{ sym: "fp_arc" },
		[{ sym: "start" }, ...spec.start],
		...middle,
		[{ sym: "layer" }, spec.layer],
		stroke,
	];
}

function makeArcExpected(width) {
	return {
		expectedType: "arc",
		expectedLayer: "F.SilkS",
		expectedWidth: width,
		expectedRadius: 1,
		expectedCenter: [0, 0],
	};
}

const ARC_CONVERSION_CASES = [
	{
		name: "converts KiCad v6 3-point mid arc",
		rawNode: makeArcNode({
			start: [0, 1],
			mid: [1, 0],
			end: [0, -1],
			layer: "F.SilkS",
			width: 0.15,
		}),
		...makeArcExpected(0.15),
	},
	{
		name: "converts KiCad v5 angle arc",
		rawNode: makeArcNode({
			start: [0, 0],
			end: [1, 0],
			angle: 90,
			layer: "F.SilkS",
			width: 0.12,
		}),
		...makeArcExpected(0.12),
	},
];

function assertArcAttributes(g, tc) {
	assert.equal(g.type, tc.expectedType);
	assert.equal(g.layer, tc.expectedLayer);
	assert.equal(g.width, tc.expectedWidth);
}

function assertArcGeometry(g, tc) {
	assert.equal(Math.round(g.radius * 100) / 100, tc.expectedRadius);
	assert.deepEqual(
		[Math.round(g.center[0]), Math.round(g.center[1])],
		tc.expectedCenter,
	);
	assert.ok(typeof g.d === "string" && g.d.startsWith("M"));
}

function runCases(cases, fn) {
	for (const tc of cases) {
		test(tc.name, () => fn(tc));
	}
}

describe("footprintRender", () => {
	// [describe name, cases, per-case check]
	const SUITES = [
		[
			"pad shapes and rotation",
			PAD_SHAPE_CASES,
			(tc) => {
				const res = footprintToPrimitives({ pads: [tc.pad], graphics: [] });
				assert.equal(res.pads.length, 1);
				assertPadProperties(res.pads[0], tc.expected);
			},
		],
		[
			"side B mirroring and layer mapping",
			SIDE_B_CASES,
			(tc) => {
				const prims = { pads: tc.inputPads, graphics: tc.inputGraphics };
				assertSideBResult(transformPrimitives(prims, tc.placement), tc);
			},
		],
		[
			"pad world positions",
			PAD_WORLD_CASES,
			(tc) =>
				assert.deepEqual(padWorldPositions(tc.fp, tc.placement), tc.expected),
		],
		[
			"padHitTest",
			HIT_TEST_CASES,
			(tc) => assert.equal(padHitTest(tc.prims, tc.point), tc.expected),
		],
	];
	for (const [name, cases, check] of SUITES) {
		describe(name, () => runCases(cases, check));
	}

	describe("arc conversion", () => {
		runCases(ARC_CONVERSION_CASES, (tc) => {
			const prims = footprintToPrimitives({
				pads: [],
				graphics: [tc.rawNode],
			});
			assert.equal(prims.graphics.length, 1);
			assertArcAttributes(prims.graphics[0], tc);
			assertArcGeometry(prims.graphics[0], tc);
		});

		test("arcToSvgPath formats valid SVG path string", () => {
			const arc = {
				start: [0, 1],
				end: [0, -1],
				mid: [1, 0],
				center: [0, 0],
				radius: 1,
			};
			const d = arcToSvgPath(arc);
			assert.ok(d.startsWith("M 0 1 A 1 1 0"));
		});
	});
});
