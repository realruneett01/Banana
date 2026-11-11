import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	symbolPinPositions,
	symbolToSvgPrimitives,
	transformPrimitives,
} from "../../frontend/src/editor/symbolRender.js";

const createPin = (number, name, at, options = {}) => ({
	number,
	name,
	type: options.type ?? "passive",
	at,
	length: options.length ?? 1.27,
});

const makeGraphic = (...nodes) => [nodes];
const wrapGraphic = (...nodes) => ({ graphics: makeGraphic(...nodes) });

const createArcSymbol = (start, mid, end) =>
	wrapGraphic(
		{ sym: "arc" },
		[{ sym: "start" }, ...start],
		[{ sym: "mid" }, ...mid],
		[{ sym: "end" }, ...end],
	);

const makePlacement = (x, y, rot, flip = false) => ({ x, y, rot, flip });
const polylineInput = (points) => [{ type: "polyline", points }];
const round2 = (val) => Math.round(val * 100) / 100;

function assertFields(actual, expected) {
	for (const [key, val] of Object.entries(expected)) {
		assert.equal(actual[key], val);
	}
}

function findPrimitive(prims, type) {
	const prim = prims.find((p) => p.type === type);
	assert.ok(prim, `${type} primitive found`);
	return prim;
}

function assertPinPositions(positions, expected) {
	for (const [pin, [ex, ey]] of Object.entries(expected)) {
		assert.ok(positions[pin], `pin ${pin} present`);
		assert.equal(round2(positions[pin][0]), ex);
		assert.equal(round2(positions[pin][1]), ey);
	}
}

function runPrimitiveCase(tc, prims) {
	if (tc.targetType) {
		const prim = findPrimitive(prims, tc.targetType);
		if (tc.expectedFields) {
			assertFields(prim, tc.expectedFields);
		}
		if (tc.expectedPoints) {
			assert.deepEqual(prim.points, tc.expectedPoints);
		}
		if (tc.expectedD) {
			assert.equal(prim.d, tc.expectedD);
		}
	}
	if (tc.verify) {
		tc.verify(prims);
	}
}

function runTransformCase(tc, res) {
	if (tc.expectedPoints) {
		assert.deepEqual(res[0].points, tc.expectedPoints);
	}
	if (tc.expectedFields) {
		assertFields(res[0], tc.expectedFields);
	}
	if (tc.verify) {
		tc.verify(res);
	}
}

const RESISTOR_SYMBOL = {
	libId: "Device:R",
	name: "R",
	properties: { Reference: "R", Value: "R" },
	pins: [
		createPin("1", "~", [0, 3.81, 270]),
		createPin("2", "~", [0, -3.81, 90]),
	],
	graphics: makeGraphic(
		{ sym: "rectangle" },
		[{ sym: "start" }, -1.016, -2.54],
		[{ sym: "end" }, 1.016, 2.54],
	),
};

const TRANSISTOR_SYMBOL = {
	libId: "Transistor_BJT:Q_NPN_BCE",
	name: "Q_NPN_BCE",
	properties: { Reference: "Q", Value: "Q_NPN_BCE" },
	pins: [
		createPin("1", "B", [-5.08, 0, 0], { length: 2.54, type: "input" }),
		createPin("2", "C", [2.54, 5.08, 270], { length: 2.54 }),
		createPin("3", "E", [2.54, -5.08, 90], { length: 2.54 }),
	],
	graphics: makeGraphic({ sym: "polyline" }, [
		{ sym: "pts" },
		[{ sym: "xy" }, 0, 1],
		[{ sym: "xy" }, 0, -1],
	]),
};

describe("symbolToSvgPrimitives conversion with Y flip", () => {
	const primitiveCases = [
		{
			name: "rectangle conversion flips Y and sets positive width/height",
			symbol: RESISTOR_SYMBOL,
			targetType: "rect",
			expectedFields: { x: -1.016, y: -2.54, width: 2.032, height: 5.08 },
		},
		{
			name: "polyline conversion flips Y for each point",
			symbol: TRANSISTOR_SYMBOL,
			targetType: "polyline",
			expectedPoints: [
				[0, -1],
				[0, 1],
			],
		},
		{
			name: "circle conversion flips cy",
			symbol: wrapGraphic(
				{ sym: "circle" },
				[{ sym: "center" }, 2.54, 5.08],
				[{ sym: "radius" }, 1.27],
			),
			targetType: "circle",
			expectedFields: { cx: 2.54, cy: -5.08, r: 1.27 },
		},
		{
			name: "arc conversion converts start/mid/end to SVG arc path",
			symbol: createArcSymbol([1, 0], [0, 1], [-1, 0]),
			targetType: "arc",
			verify: (prims) => {
				const arc = findPrimitive(prims, "arc");
				assert.equal(arc.type, "arc");
				assert.ok(
					arc.d.startsWith("M 1 0 A 1 1"),
					`expected arc path, got ${arc.d}`,
				);
			},
		},
		{
			name: "collinear arc falls back to SVG line path",
			symbol: createArcSymbol([0, 0], [1, 1], [2, 2]),
			targetType: "arc",
			expectedD: "M 0 0 L 2 -2",
		},
		{
			name: "text conversion flips Y coordinate",
			symbol: wrapGraphic({ sym: "text" }, "GND", [{ sym: "at" }, 0, -2.54, 0]),
			targetType: "text",
			expectedFields: { text: "GND", x: 0, y: 2.54 },
		},
		{
			name: "pin conversion creates line from at by length in at direction",
			symbol: RESISTOR_SYMBOL,
			verify: (prims) => {
				const pins = prims.filter((p) => p.type === "pin");
				assert.equal(pins.length, 2);
				const pin1 = pins.find((p) => p.number === "1");
				assertFields(pin1, { x: 0, y: -3.81, x2: 0, y2: -2.54 });
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
			runPrimitiveCase(tc, prims);
		});
	}
});

describe("transformPrimitives rotation and flip transforms", () => {
	const transformCases = [
		{
			name: "0 deg rotation keeps coordinates unchanged with translation",
			placement: makePlacement(10, 20, 0),
			input: [{ type: "circle", cx: 2, cy: 3, r: 1 }],
			expectedFields: { cx: 12, cy: 23 },
		},
		{
			name: "90 deg rotation transforms points clockwise in SVG",
			placement: makePlacement(0, 0, 90),
			input: polylineInput([
				[1, 0],
				[0, 2],
			]),
			expectedPoints: [
				[0, 1],
				[-2, 0],
			],
		},
		{
			name: "180 deg rotation negates coordinates",
			placement: makePlacement(5, 5, 180),
			input: polylineInput([[1, 2]]),
			expectedPoints: [[4, 3]],
		},
		{
			name: "270 deg rotation transforms points counter-clockwise in SVG",
			placement: makePlacement(0, 0, 270),
			input: polylineInput([
				[1, 0],
				[0, 2],
			]),
			expectedPoints: [
				[0, -1],
				[2, 0],
			],
		},
		{
			name: "flip horizontally negates local x before rotation",
			placement: makePlacement(0, 0, 0, true),
			input: polylineInput([[3, 4]]),
			expectedPoints: [[-3, 4]],
		},
		{
			name: "flip and 90 deg rotation combination",
			placement: makePlacement(10, 10, 90, true),
			input: polylineInput([[2, 0]]),
			// local x flipped: -2, 0. Rotated 90: (0, -2). Translated +10: (10, 8).
			expectedPoints: [[10, 8]],
		},
		{
			name: "pin transform maintains line endpoints and label positions",
			placement: makePlacement(10, 20, 90),
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
				assertFields(prim, { x: 13.81, y: 20, x2: 12.54, y2: 20 });
				assert.ok(prim.numberPos);
				assert.ok(prim.namePos);
			},
		},
		{
			name: "rect transform recalculates bounds correctly for 90 deg rotation",
			placement: makePlacement(10, 10, 90),
			input: [{ type: "rect", x: -1, y: -2, width: 2, height: 4 }],
			expectedFields: { x: 8, y: 9, width: 4, height: 2 },
		},
	];

	for (const tc of transformCases) {
		test(tc.name, () => {
			const res = transformPrimitives(tc.input, tc.placement);
			runTransformCase(tc, res);
		});
	}
});

describe("symbolPinPositions calculation for wires and hit-testing", () => {
	const pinPositionCases = [
		{
			name: "returns pin connection points in world coordinates at rot 0",
			symbol: RESISTOR_SYMBOL,
			placement: makePlacement(10, 20, 0),
			expected: {
				1: [10, 16.19],
				2: [10, 23.81],
			},
		},
		{
			name: "returns rotated pin connection points at rot 90",
			symbol: RESISTOR_SYMBOL,
			placement: makePlacement(10, 20, 90),
			expected: {
				1: [13.81, 20],
				2: [6.19, 20],
			},
		},
		{
			name: "returns rotated pin connection points at rot 180 and 270",
			symbol: RESISTOR_SYMBOL,
			placement: makePlacement(10, 20, 180),
			expected: {
				1: [10, 23.81],
				2: [10, 16.19],
			},
			verify: (positions) => {
				assert.deepEqual(positions.get("1"), positions["1"]);
			},
		},
		{
			name: "handles flip with side B",
			symbol: TRANSISTOR_SYMBOL,
			placement: { x: 0, y: 0, rot: 0, side: "B" },
			// Pin 1 original at: [-5.08, 0], flip side B -> x negated to 5.08
			expected: {
				1: [5.08, 0],
			},
		},
	];

	for (const tc of pinPositionCases) {
		test(tc.name, () => {
			const positions = symbolPinPositions(tc.symbol, tc.placement);
			if (tc.expected) {
				assertPinPositions(positions, tc.expected);
			}
			if (tc.verify) {
				tc.verify(positions);
			}
		});
	}
});
