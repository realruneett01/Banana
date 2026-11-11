import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	arcToSvgPath,
	footprintToPrimitives,
	padHitTest,
	padWorldPositions,
	transformPrimitives,
} from "../../frontend/src/editor/footprintRender.js";

const PAD_SHAPE_CASES = [
	{
		name: "rect pad shape and rotation",
		pad: {
			number: "1",
			type: "smd",
			shape: "rect",
			at: [1, 2, 45],
			size: [1.5, 2.5],
			layers: ["F.Cu"],
		},
		expected: {
			type: "pad",
			number: "1",
			shape: "rect",
			center: [1, 2],
			size: [1.5, 2.5],
			rot: 45,
			layers: ["F.Cu"],
		},
	},
	{
		name: "roundrect pad with default rot",
		pad: {
			number: "2",
			type: "smd",
			shape: "roundrect",
			at: [-0.95, 0],
			size: [1, 1.45],
			layers: ["F.Cu", "F.Mask"],
		},
		expected: {
			type: "pad",
			number: "2",
			shape: "roundrect",
			center: [-0.95, 0],
			size: [1, 1.45],
			rot: 0,
			layers: ["F.Cu", "F.Mask"],
		},
	},
	{
		name: "circle pad shape",
		pad: {
			number: "3",
			type: "thru_hole",
			shape: "circle",
			at: [0, 0, 0],
			size: [1.2, 1.2],
			layers: ["*.Cu"],
		},
		expected: {
			type: "pad",
			number: "3",
			shape: "circle",
			center: [0, 0],
			size: [1.2, 1.2],
			rot: 0,
			layers: ["*.Cu"],
		},
	},
	{
		name: "oval pad shape",
		pad: {
			number: "4",
			type: "smd",
			shape: "oval",
			at: [2, -1, 90],
			size: [3, 1],
			layers: ["F.Cu"],
		},
		expected: {
			type: "pad",
			number: "4",
			shape: "oval",
			center: [2, -1],
			size: [3, 1],
			rot: 90,
			layers: ["F.Cu"],
		},
	},
];

const SIDE_B_CASES = [
	{
		name: "mirrors X and maps F.Cu to B.Cu at origin",
		placement: { x: 0, y: 0, rot: 0, side: "B" },
		inputPads: [
			{
				type: "pad",
				number: "1",
				shape: "rect",
				center: [2, 3],
				size: [1, 1],
				rot: 0,
				layers: ["F.Cu", "F.Mask"],
			},
		],
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
		inputPads: [
			{
				type: "pad",
				number: "1",
				shape: "circle",
				center: [1, 2],
				size: [1.5, 1.5],
				rot: 0,
				layers: ["*.Cu"],
			},
		],
		inputGraphics: [],
		expectedPadCenter: [9, 22],
		expectedPadLayers: ["*.Cu"],
		expectedLineStart: null,
		expectedLineEnd: null,
		expectedLineLayer: null,
	},
	{
		name: "mirrors and rotates 90 deg on side B",
		placement: { x: 10, y: 20, rot: 90, side: "B" },
		inputPads: [
			{
				type: "pad",
				number: "1",
				shape: "rect",
				center: [2, 0],
				size: [1, 2],
				rot: 0,
				layers: ["F.Cu"],
			},
		],
		inputGraphics: [],
		expectedPadCenter: [10, 18],
		expectedPadLayers: ["B.Cu"],
		expectedLineStart: null,
		expectedLineEnd: null,
		expectedLineLayer: null,
	},
];

const PAD_WORLD_CASES = [
	{
		name: "front side with translation and rotation",
		fp: {
			pads: [
				{ number: "1", at: [-1, 0, 0] },
				{ number: "2", at: [1, 0, 0] },
			],
		},
		placement: { x: 50, y: 30, rot: 90, side: "F" },
		expected: {
			1: [50, 29],
			2: [50, 31],
		},
	},
	{
		name: "back side mirrors X coordinates",
		fp: {
			pads: [
				{ number: "1", at: [-1, 0, 0] },
				{ number: "2", at: [1, 0, 0] },
			],
		},
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

const HIT_TEST_CASES = [
	{
		name: "hits center of rect pad",
		prims: {
			pads: [
				{
					type: "pad",
					number: "1",
					shape: "rect",
					center: [10, 10],
					size: [2, 4],
					rot: 0,
				},
				{
					type: "pad",
					number: "2",
					shape: "rect",
					center: [20, 20],
					size: [2, 2],
					rot: 0,
				},
			],
		},
		point: [10, 10],
		expected: "1",
	},
	{
		name: "hits edge of circle pad",
		prims: {
			pads: [
				{
					type: "pad",
					number: "C1",
					shape: "circle",
					center: [0, 0],
					size: [2, 2],
					rot: 0,
				},
			],
		},
		point: [0.9, 0],
		expected: "C1",
	},
	{
		name: "misses outside circle pad",
		prims: {
			pads: [
				{
					type: "pad",
					number: "C1",
					shape: "circle",
					center: [0, 0],
					size: [2, 2],
					rot: 0,
				},
			],
		},
		point: [1.2, 0],
		expected: null,
	},
	{
		name: "hits inside rotated pad",
		prims: {
			pads: [
				{
					type: "pad",
					number: "R90",
					shape: "rect",
					center: [0, 0],
					size: [2, 6],
					rot: 90,
				},
			],
		},
		point: [2.5, 0.5],
		expected: "R90",
	},
	{
		name: "hits inside oval stadium pad",
		prims: {
			pads: [
				{
					type: "pad",
					number: "OV",
					shape: "oval",
					center: [0, 0],
					size: [4, 2],
					rot: 0,
				},
			],
		},
		point: [1.5, 0.5],
		expected: "OV",
	},
	{
		name: "misses corner of roundrect",
		prims: {
			pads: [
				{
					type: "pad",
					number: "RR",
					shape: "roundrect",
					center: [0, 0],
					size: [2, 2],
					rot: 0,
				},
			],
		},
		point: [0.98, 0.98],
		expected: null,
	},
];

const ARC_CONVERSION_CASES = [
	{
		name: "converts KiCad v6 3-point mid arc",
		rawNode: [
			{ sym: "fp_arc" },
			[{ sym: "start" }, 0, 1],
			[{ sym: "mid" }, 1, 0],
			[{ sym: "end" }, 0, -1],
			[{ sym: "layer" }, "F.SilkS"],
			[{ sym: "stroke" }, [{ sym: "width" }, 0.15]],
		],
		expectedType: "arc",
		expectedLayer: "F.SilkS",
		expectedWidth: 0.15,
		expectedRadius: 1,
		expectedCenter: [0, 0],
	},
	{
		name: "converts KiCad v5 angle arc",
		rawNode: [
			{ sym: "fp_arc" },
			[{ sym: "start" }, 0, 0],
			[{ sym: "end" }, 1, 0],
			[{ sym: "angle" }, 90],
			[{ sym: "layer" }, "F.SilkS"],
			[{ sym: "width" }, 0.12],
		],
		expectedType: "arc",
		expectedLayer: "F.SilkS",
		expectedWidth: 0.12,
		expectedRadius: 1,
		expectedCenter: [0, 0],
	},
];

describe("footprintRender", () => {
	describe("pad shapes and rotation", () => {
		for (const tc of PAD_SHAPE_CASES) {
			test(tc.name, () => {
				const res = footprintToPrimitives({ pads: [tc.pad], graphics: [] });
				assert.equal(res.pads.length, 1);
				const p = res.pads[0];
				assert.equal(p.type, tc.expected.type);
				assert.equal(p.number, tc.expected.number);
				assert.equal(p.shape, tc.expected.shape);
				assert.deepEqual(p.center, tc.expected.center);
				assert.deepEqual(p.size, tc.expected.size);
				assert.equal(p.rot, tc.expected.rot);
				assert.deepEqual(p.layers, tc.expected.layers);
			});
		}
	});

	describe("side B mirroring and layer mapping", () => {
		for (const tc of SIDE_B_CASES) {
			test(tc.name, () => {
				const prims = { pads: tc.inputPads, graphics: tc.inputGraphics };
				const res = transformPrimitives(prims, tc.placement);
				const pad = res.pads[0];
				assert.ok(pad);
				assert.deepEqual(
					[Math.round(pad.center[0]), Math.round(pad.center[1])],
					tc.expectedPadCenter,
				);
				assert.deepEqual(pad.layers, tc.expectedPadLayers);

				if (tc.expectedLineLayer) {
					const line = res.graphics[0];
					assert.ok(line);
					assert.deepEqual(line.start, tc.expectedLineStart);
					assert.deepEqual(line.end, tc.expectedLineEnd);
					assert.equal(line.layer, tc.expectedLineLayer);
				}
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
				const g = prims.graphics[0];
				assert.equal(g.type, tc.expectedType);
				assert.equal(g.layer, tc.expectedLayer);
				assert.equal(g.width, tc.expectedWidth);
				assert.equal(Math.round(g.radius * 100) / 100, tc.expectedRadius);
				assert.deepEqual(
					[Math.round(g.center[0]), Math.round(g.center[1])],
					tc.expectedCenter,
				);
				assert.ok(typeof g.d === "string" && g.d.startsWith("M"));
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
