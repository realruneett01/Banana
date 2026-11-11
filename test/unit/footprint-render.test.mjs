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

const PAD_SHAPE_TABLE = [
	{
		name: "rect pad shape and rotation",
		number: "1",
		type: "smd",
		shape: "rect",
		at: [1, 2, 45],
		size: [1.5, 2.5],
		layers: ["F.Cu"],
	},
	{
		name: "roundrect pad with default rot",
		number: "2",
		type: "smd",
		shape: "roundrect",
		at: [-0.95, 0],
		size: [1, 1.45],
		layers: ["F.Cu", "F.Mask"],
	},
	{
		name: "circle pad shape",
		number: "3",
		type: "thru_hole",
		shape: "circle",
		at: [0, 0, 0],
		size: [1.2, 1.2],
		layers: ["*.Cu"],
	},
	{
		name: "oval pad shape",
		number: "4",
		type: "smd",
		shape: "oval",
		at: [2, -1, 90],
		size: [3, 1],
		layers: ["F.Cu"],
	},
];

function makePadShapeCase(tc) {
	return {
		name: tc.name,
		pad: {
			number: tc.number,
			type: tc.type,
			shape: tc.shape,
			at: tc.at,
			size: tc.size,
			layers: tc.layers,
		},
		expected: {
			type: "pad",
			number: tc.number,
			shape: tc.shape,
			center: [tc.at[0], tc.at[1]],
			size: tc.size,
			rot: tc.at[2] ?? 0,
			layers: tc.layers,
		},
	};
}

const PAD_SHAPE_CASES = PAD_SHAPE_TABLE.map(makePadShapeCase);

const SIDE_B_TABLE = [
	{
		name: "mirrors X and maps F.Cu to B.Cu at origin",
		placement: { x: 0, y: 0, rot: 0, side: "B" },
		pad: {
			shape: "rect",
			center: [2, 3],
			size: [1, 1],
			layers: ["F.Cu", "F.Mask"],
		},
		graphic: {
			type: "line",
			layer: "F.SilkS",
			width: 0.15,
			start: [-1, -2],
			end: [3, 4],
		},
		expectedPad: { center: [-2, 3], layers: ["B.Cu", "B.Mask"] },
		expectedLine: { start: [1, -2], end: [-3, 4], layer: "B.SilkS" },
	},
	{
		name: "preserves *.Cu through-hole layer on side B",
		placement: { x: 10, y: 20, rot: 0, side: "B" },
		pad: {
			shape: "circle",
			center: [1, 2],
			size: [1.5, 1.5],
			layers: ["*.Cu"],
		},
		expectedPad: { center: [9, 22], layers: ["*.Cu"] },
	},
	{
		name: "mirrors and rotates 90 deg on side B",
		placement: { x: 10, y: 20, rot: 90, side: "B" },
		pad: {
			shape: "rect",
			center: [2, 0],
			size: [1, 2],
			layers: ["F.Cu"],
		},
		expectedPad: { center: [10, 18], layers: ["B.Cu"] },
	},
];

function makeSideBCase(tc) {
	return {
		name: tc.name,
		placement: tc.placement,
		inputPads: [
			makePad({
				number: "1",
				shape: tc.pad.shape,
				center: tc.pad.center,
				size: tc.pad.size,
				rot: 0,
				layers: tc.pad.layers,
			}),
		],
		inputGraphics: tc.graphic ? [tc.graphic] : [],
		expectedPadCenter: tc.expectedPad.center,
		expectedPadLayers: tc.expectedPad.layers,
		expectedLineStart: tc.expectedLine?.start ?? null,
		expectedLineEnd: tc.expectedLine?.end ?? null,
		expectedLineLayer: tc.expectedLine?.layer ?? null,
	};
}

const SIDE_B_CASES = SIDE_B_TABLE.map(makeSideBCase);

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
		expected: {
			1: [50, 29],
			2: [50, 31],
		},
	},
	{
		name: "back side mirrors X coordinates",
		fp: TWO_PAD_FP,
		placement: { x: 50, y: 30, rot: 0, side: "B" },
		expected: {
			1: [51, 30],
			2: [49, 30],
		},
	},
	{
		name: "empty or null footprint returns empty object",
		fp: null,
		placement: { x: 10, y: 10 },
		expected: {},
	},
];

const HIT_TEST_TABLE = [
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
		pads: [{ number: "C1", shape: "circle", center: [0, 0], size: [2, 2] }],
		point: [0.9, 0],
		expected: "C1",
	},
	{
		name: "misses outside circle pad",
		pads: [{ number: "C1", shape: "circle", center: [0, 0], size: [2, 2] }],
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
];

function makeHitCase(tc) {
	return {
		name: tc.name,
		prims: { pads: tc.pads.map(makePad) },
		point: tc.point,
		expected: tc.expected,
	};
}

const HIT_TEST_CASES = HIT_TEST_TABLE.map(makeHitCase);

function makeArcNode(spec) {
	if (spec.mid) {
		return [
			{ sym: "fp_arc" },
			[{ sym: "start" }, ...spec.start],
			[{ sym: "mid" }, ...spec.mid],
			[{ sym: "end" }, ...spec.end],
			[{ sym: "layer" }, spec.layer],
			[{ sym: "stroke" }, [{ sym: "width" }, spec.width]],
		];
	}
	return [
		{ sym: "fp_arc" },
		[{ sym: "start" }, ...spec.start],
		[{ sym: "end" }, ...spec.end],
		[{ sym: "angle" }, spec.angle],
		[{ sym: "layer" }, spec.layer],
		[{ sym: "width" }, spec.width],
	];
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
		expectedType: "arc",
		expectedLayer: "F.SilkS",
		expectedWidth: 0.15,
		expectedRadius: 1,
		expectedCenter: [0, 0],
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
		expectedType: "arc",
		expectedLayer: "F.SilkS",
		expectedWidth: 0.12,
		expectedRadius: 1,
		expectedCenter: [0, 0],
	},
];

function assertArcResult(g, tc) {
	assert.equal(g.type, tc.expectedType);
	assert.equal(g.layer, tc.expectedLayer);
	assert.equal(g.width, tc.expectedWidth);
	assert.equal(Math.round(g.radius * 100) / 100, tc.expectedRadius);
	assert.deepEqual(
		[Math.round(g.center[0]), Math.round(g.center[1])],
		tc.expectedCenter,
	);
	assert.ok(typeof g.d === "string" && g.d.startsWith("M"));
}

describe("footprintRender", () => {
	describe("pad shapes and rotation", () => {
		for (const tc of PAD_SHAPE_CASES) {
			test(tc.name, () => {
				const res = footprintToPrimitives({ pads: [tc.pad], graphics: [] });
				assert.equal(res.pads.length, 1);
				assertPadProperties(res.pads[0], tc.expected);
			});
		}
	});

	describe("side B mirroring and layer mapping", () => {
		for (const tc of SIDE_B_CASES) {
			test(tc.name, () => {
				const prims = { pads: tc.inputPads, graphics: tc.inputGraphics };
				const res = transformPrimitives(prims, tc.placement);
				assertSideBResult(res, tc);
			});
		}
	});

	describe("pad world positions", () => {
		for (const tc of PAD_WORLD_CASES) {
			test(tc.name, () => {
				const positions = padWorldPositions(tc.fp, tc.placement);
				assert.deepEqual(positions, tc.expected);
			});
		}
	});

	describe("padHitTest", () => {
		for (const tc of HIT_TEST_CASES) {
			test(tc.name, () => {
				const hit = padHitTest(tc.prims, tc.point);
				assert.equal(hit, tc.expected);
			});
		}
	});

	describe("arc conversion", () => {
		for (const tc of ARC_CONVERSION_CASES) {
			test(tc.name, () => {
				const prims = footprintToPrimitives({
					pads: [],
					graphics: [tc.rawNode],
				});
				assert.equal(prims.graphics.length, 1);
				assertArcResult(prims.graphics[0], tc);
			});
		}

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
