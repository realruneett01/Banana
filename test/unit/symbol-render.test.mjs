import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	symbolPinPositions,
	symbolToSvgPrimitives,
	transformPrimitives,
} from "../../frontend/src/editor/symbolRender.js";

const RESISTOR_SYMBOL = {
	libId: "Device:R",
	name: "R",
	properties: { Reference: "R", Value: "R" },
	pins: [
		{
			number: "1",
			name: "~",
			type: "passive",
			at: [0, 3.81, 270],
			length: 1.27,
		},
		{
			number: "2",
			name: "~",
			type: "passive",
			at: [0, -3.81, 90],
			length: 1.27,
		},
	],
	graphics: [
		[
			{ sym: "rectangle" },
			[{ sym: "start" }, -1.016, -2.54],
			[{ sym: "end" }, 1.016, 2.54],
		],
	],
};

const TRANSISTOR_SYMBOL = {
	libId: "Transistor_BJT:Q_NPN_BCE",
	name: "Q_NPN_BCE",
	properties: { Reference: "Q", Value: "Q_NPN_BCE" },
	pins: [
		{
			number: "1",
			name: "B",
			type: "input",
			at: [-5.08, 0, 0],
			length: 2.54,
		},
		{
			number: "2",
			name: "C",
			type: "passive",
			at: [2.54, 5.08, 270],
			length: 2.54,
		},
		{
			number: "3",
			name: "E",
			type: "passive",
			at: [2.54, -5.08, 90],
			length: 2.54,
		},
	],
	graphics: [
		[
			{ sym: "polyline" },
			[{ sym: "pts" }, [{ sym: "xy" }, 0, 1], [{ sym: "xy" }, 0, -1]],
		],
	],
};

describe("symbolToSvgPrimitives conversion with Y flip", () => {
	const primitiveCases = [
		{
			name: "rectangle conversion flips Y and sets positive width/height",
			symbol: RESISTOR_SYMBOL,
			expectedType: "rect",
			verify: (prims) => {
				const rect = prims.find((p) => p.type === "rect");
				assert.ok(rect, "rect primitive found");
				assert.equal(rect.x, -1.016);
				assert.equal(rect.y, -2.54);
				assert.equal(rect.width, 2.032);
				assert.equal(rect.height, 5.08);
			},
		},
		{
			name: "polyline conversion flips Y for each point",
			symbol: TRANSISTOR_SYMBOL,
			expectedType: "polyline",
			verify: (prims) => {
				const poly = prims.find((p) => p.type === "polyline");
				assert.ok(poly, "polyline primitive found");
				assert.deepEqual(poly.points, [
					[0, -1],
					[0, 1],
				]);
			},
		},
		{
			name: "circle conversion flips cy",
			symbol: {
				graphics: [
					[
						{ sym: "circle" },
						[{ sym: "center" }, 2.54, 5.08],
						[{ sym: "radius" }, 1.27],
					],
				],
			},
			expectedType: "circle",
			verify: (prims) => {
				const circle = prims.find((p) => p.type === "circle");
				assert.ok(circle, "circle primitive found");
				assert.equal(circle.cx, 2.54);
				assert.equal(circle.cy, -5.08);
				assert.equal(circle.r, 1.27);
			},
		},
		{
			name: "arc conversion converts start/mid/end to SVG arc path",
			symbol: {
				graphics: [
					[
						{ sym: "arc" },
						[{ sym: "start" }, 1, 0],
						[{ sym: "mid" }, 0, 1],
						[{ sym: "end" }, -1, 0],
					],
				],
			},
			expectedType: "arc",
			verify: (prims) => {
				const arc = prims.find((p) => p.type === "arc");
				assert.ok(arc, "arc primitive found");
				assert.equal(arc.type, "arc");
				assert.ok(
					arc.d.startsWith("M 1 0 A 1 1"),
					`expected arc path, got ${arc.d}`,
				);
			},
		},
		{
			name: "collinear arc falls back to SVG line path",
			symbol: {
				graphics: [
					[
						{ sym: "arc" },
						[{ sym: "start" }, 0, 0],
						[{ sym: "mid" }, 1, 1],
						[{ sym: "end" }, 2, 2],
					],
				],
			},
			expectedType: "arc",
			verify: (prims) => {
				const arc = prims.find((p) => p.type === "arc");
				assert.ok(arc, "arc primitive found");
				assert.equal(arc.d, "M 0 0 L 2 -2");
			},
		},
		{
			name: "text conversion flips Y coordinate",
			symbol: {
				graphics: [[{ sym: "text" }, "GND", [{ sym: "at" }, 0, -2.54, 0]]],
			},
			expectedType: "text",
			verify: (prims) => {
				const text = prims.find((p) => p.type === "text");
				assert.ok(text, "text primitive found");
				assert.equal(text.text, "GND");
				assert.equal(text.x, 0);
				assert.equal(text.y, 2.54);
			},
		},
		{
			name: "pin conversion creates line from at by length in at direction",
			symbol: RESISTOR_SYMBOL,
			expectedType: "pin",
			verify: (prims) => {
				const pins = prims.filter((p) => p.type === "pin");
				assert.equal(pins.length, 2);
				const pin1 = pins.find((p) => p.number === "1");
				assert.equal(pin1.x, 0);
				assert.equal(pin1.y, -3.81);
				assert.equal(pin1.x2, 0);
				assert.equal(pin1.y2, -2.54);
				assert.ok(pin1.numberPos, "has numberPos");
				assert.ok(pin1.namePos, "has namePos");
			},
		},
		{
			name: "null and empty symbol return empty primitive list",
			symbol: null,
			verify: (prims) => {
				assert.deepEqual(prims, []);
				assert.deepEqual(symbolToSvgPrimitives({}), []);
			},
		},
	];

	for (const tc of primitiveCases) {
		test(tc.name, () => {
			const prims = symbolToSvgPrimitives(tc.symbol);
			tc.verify(prims);
		});
	}
});

describe("transformPrimitives rotation and flip transforms", () => {
	const transformCases = [
		{
			name: "0 deg rotation keeps coordinates unchanged with translation",
			placement: { x: 10, y: 20, rot: 0, flip: false },
			input: [{ type: "circle", cx: 2, cy: 3, r: 1 }],
			verify: ([prim]) => {
				assert.equal(prim.cx, 12);
				assert.equal(prim.cy, 23);
			},
		},
		{
			name: "90 deg rotation transforms points clockwise in SVG",
			placement: { x: 0, y: 0, rot: 90, flip: false },
			input: [
				{
					type: "polyline",
					points: [
						[1, 0],
						[0, 2],
					],
				},
			],
			verify: ([prim]) => {
				assert.deepEqual(prim.points, [
					[0, 1],
					[-2, 0],
				]);
			},
		},
		{
			name: "180 deg rotation negates coordinates",
			placement: { x: 5, y: 5, rot: 180, flip: false },
			input: [
				{
					type: "polyline",
					points: [[1, 2]],
				},
			],
			verify: ([prim]) => {
				assert.deepEqual(prim.points, [[4, 3]]);
			},
		},
		{
			name: "270 deg rotation transforms points counter-clockwise in SVG",
			placement: { x: 0, y: 0, rot: 270, flip: false },
			input: [
				{
					type: "polyline",
					points: [
						[1, 0],
						[0, 2],
					],
				},
			],
			verify: ([prim]) => {
				assert.deepEqual(prim.points, [
					[0, -1],
					[2, 0],
				]);
			},
		},
		{
			name: "flip horizontally negates local x before rotation",
			placement: { x: 0, y: 0, rot: 0, flip: true },
			input: [
				{
					type: "polyline",
					points: [[3, 4]],
				},
			],
			verify: ([prim]) => {
				assert.deepEqual(prim.points, [[-3, 4]]);
			},
		},
		{
			name: "flip and 90 deg rotation combination",
			placement: { x: 10, y: 10, rot: 90, flip: true },
			input: [
				{
					type: "polyline",
					points: [[2, 0]],
				},
			],
			verify: ([prim]) => {
				// local x flipped: -2, 0. Rotated 90: (0, -2). Translated +10: (10, 8).
				assert.deepEqual(prim.points, [[10, 8]]);
			},
		},
		{
			name: "pin transform maintains line endpoints and label positions",
			placement: { x: 10, y: 20, rot: 90, flip: false },
			input: [
				{
					type: "pin",
					number: "1",
					name: "A",
					x: 0,
					y: -3.81,
					x2: 0,
					y2: -2.54,
					numberPos: [0.5, -3.175],
					namePos: [0, -2.04],
				},
			],
			verify: ([prim]) => {
				assert.equal(prim.x, 13.81);
				assert.equal(prim.y, 20);
				assert.equal(prim.x2, 12.54);
				assert.equal(prim.y2, 20);
				assert.ok(prim.numberPos);
				assert.ok(prim.namePos);
			},
		},
		{
			name: "rect transform recalculates bounds correctly for 90 deg rotation",
			placement: { x: 10, y: 10, rot: 90, flip: false },
			input: [{ type: "rect", x: -1, y: -2, width: 2, height: 4 }],
			verify: ([prim]) => {
				assert.equal(prim.x, 8);
				assert.equal(prim.y, 9);
				assert.equal(prim.width, 4);
				assert.equal(prim.height, 2);
			},
		},
	];

	for (const tc of transformCases) {
		test(tc.name, () => {
			const res = transformPrimitives(tc.input, tc.placement);
			tc.verify(res);
		});
	}
});

describe("symbolPinPositions calculation for wires and hit-testing", () => {
	const pinPositionCases = [
		{
			name: "returns pin connection points in world coordinates at rot 0",
			symbol: RESISTOR_SYMBOL,
			placement: { x: 10, y: 20, rot: 0, flip: false },
			expected: {
				1: [10, 16.19],
				2: [10, 23.81],
			},
		},
		{
			name: "returns rotated pin connection points at rot 90",
			symbol: RESISTOR_SYMBOL,
			placement: { x: 10, y: 20, rot: 90, flip: false },
			expected: {
				1: [13.81, 20],
				2: [6.19, 20],
			},
		},
		{
			name: "returns rotated pin connection points at rot 180 and 270",
			symbol: RESISTOR_SYMBOL,
			placement: { x: 10, y: 20, rot: 180, flip: false },
			verify: (positions) => {
				assert.equal(Math.round(positions["1"][0] * 100) / 100, 10);
				assert.equal(Math.round(positions["1"][1] * 100) / 100, 23.81);
				assert.equal(Math.round(positions["2"][0] * 100) / 100, 10);
				assert.equal(Math.round(positions["2"][1] * 100) / 100, 16.19);
				assert.deepEqual(positions.get("1"), positions["1"]);
			},
		},
		{
			name: "handles flip with side B",
			symbol: TRANSISTOR_SYMBOL,
			placement: { x: 0, y: 0, rot: 0, side: "B" },
			verify: (positions) => {
				// Pin 1 original at: [-5.08, 0], flip side B -> x negated to 5.08
				assert.equal(positions["1"][0], 5.08);
				assert.equal(positions["1"][1], 0);
			},
		},
	];

	for (const tc of pinPositionCases) {
		test(tc.name, () => {
			const positions = symbolPinPositions(tc.symbol, tc.placement);
			if (tc.expected) {
				for (const [pin, [ex, ey]] of Object.entries(tc.expected)) {
					assert.ok(positions[pin], `pin ${pin} present`);
					assert.equal(Math.round(positions[pin][0] * 100) / 100, ex);
					assert.equal(Math.round(positions[pin][1] * 100) / 100, ey);
				}
			}
			if (tc.verify) {
				tc.verify(positions);
			}
		});
	}
});
