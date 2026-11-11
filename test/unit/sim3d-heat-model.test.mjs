import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { createHeatLayer } from "../../frontend/src/components/sim3d/heatLayer.js";
import {
	heatGrid,
	legendStops,
	partTemperatures,
	plainHeatSummary,
} from "../../frontend/src/components/sim3d/heatModel.js";

function assertPartTemps(temps, expected) {
	for (const [id, temp] of Object.entries(expected)) {
		assert.equal(temps[id], temp);
	}
}

function makeGrid(options = {}) {
	return heatGrid({
		boardW: 50,
		boardH: 30,
		cellMm: 1,
		ambientC: 25,
		placements: [],
		...options,
	});
}

const PART_TEMP_CASES = [
	{
		name: "calculates part temperature using ambient + P * thetaJA",
		input: {
			ir: {
				parts: [
					{ id: "U1", footprint: "SOIC-8" },
					{ id: "R1", footprint: "R_0805" },
				],
			},
			partPowers: { U1: 0.5, R1: 0.1 },
			ambientC: 25,
			thetaJA: { default: 150 },
		},
		expected: { U1: 100, R1: 40 },
	},
	{
		name: "respects per-footprint thetaJA overrides",
		input: {
			ir: {
				parts: [
					{ id: "U1", footprint: "Package_TO_SOT_SMD:SOT-223" },
					{ id: "U2", footprint: "Package_SO:SOIC-8" },
				],
			},
			partPowers: { U1: 1.0, U2: 1.0 },
			ambientC: 25,
			thetaJA: {
				default: 150,
				"Package_TO_SOT_SMD:SOT-223": 50,
			},
		},
		expected: { U1: 75, U2: 175 },
	},
	{
		name: "supports ambient temperature as object with max field",
		input: {
			ir: { parts: [{ id: "U1", footprint: "SOIC-8" }] },
			partPowers: { U1: 0.2 },
			ambientC: { min: 10, max: 35 },
			thetaJA: 100,
		},
		expected: { U1: 55 },
	},
	{
		name: "falls back to part.props when partPowers not specified",
		input: {
			ir: {
				parts: [
					{
						id: "U1",
						footprint: "QFN-16",
						props: { powerW: 0.4, thetaJA: 80 },
					},
				],
			},
			ambientC: 25,
		},
		expected: { U1: 57 },
	},
];

describe("heatModel - partTemperatures", () => {
	for (const { name, input, expected } of PART_TEMP_CASES) {
		test(name, () => {
			assertPartTemps(partTemperatures(input), expected);
		});
	}
});

describe("heatModel - heatGrid", () => {
	test("creates Float32Array grid with correct dimensions", () => {
		const grid = makeGrid();

		assert.equal(grid.cols, 50);
		assert.equal(grid.rows, 30);
		assert.equal(grid.values instanceof Float32Array, true);
		assert.equal(grid.values.length, 1500);
		assert.equal(grid.values[0], 25);
	});

	test("produces peak at hot part and monotonic falloff with distance", () => {
		const grid = makeGrid({
			placements: [{ x: 25, y: 15, tempC: 95, radiusMm: 5 }],
		});

		const centerCol = 24;
		const centerRow = 14;
		const peakVal = grid.values[centerRow * grid.cols + centerCol];
		const neighbor1Val = grid.values[centerRow * grid.cols + (centerCol + 2)];
		const neighbor2Val = grid.values[centerRow * grid.cols + (centerCol + 5)];
		const edgeVal = grid.values[0];

		assert.ok(peakVal > 90, `peakVal should be near 95, got ${peakVal}`);
		assert.ok(peakVal > neighbor1Val, "center should be hotter than neighbor1");
		assert.ok(
			neighbor1Val > neighbor2Val,
			"neighbor1 should be hotter than neighbor2",
		);
		assert.ok(neighbor2Val > edgeVal, "neighbor2 should be hotter than edge");
		assert.ok(
			Math.abs(edgeVal - 25) < 0.1,
			"far edge should be close to ambient 25",
		);
	});

	test("blends multiple hot spots using max blend", () => {
		const grid = makeGrid({
			boardW: 30,
			boardH: 20,
			placements: [
				{ x: 10, y: 10, tempC: 80, radiusMm: 4 },
				{ x: 12, y: 10, tempC: 85, radiusMm: 4 },
			],
		});

		for (let i = 0; i < grid.values.length; i++) {
			assert.ok(
				grid.values[i] <= 85.01,
				`value ${grid.values[i]} should not exceed max component temp 85`,
			);
		}
	});
});

describe("heatModel - legendStops", () => {
	test("returns 5 stops in ascending order with required labels and colors", () => {
		const stops = legendStops(25, 105);

		assert.equal(stops.length, 5);
		const labels = stops.map((s) => s.label);
		const requiredLabels = [
			"cool",
			"warm",
			"hot - avoid touching",
			"too hot - parts may fail",
		];
		for (const label of requiredLabels) {
			assert.ok(labels.includes(label));
		}

		for (let i = 0; i < stops.length - 1; i++) {
			assert.ok(
				stops[i].tempC < stops[i + 1].tempC,
				`stop ${i} should be cooler than stop ${i + 1}`,
			);
		}

		for (const stop of stops) {
			assert.equal(Array.isArray(stop.color), true);
			assert.equal(stop.color.length, 3);
		}
	});
});

describe("heatModel - plainHeatSummary", () => {
	test("picks the hottest part and produces a friendly sentence", () => {
		const temps = { U1: 45, U2: 92, R1: 30 };
		const summary = plainHeatSummary(temps);

		assert.ok(summary.includes("U2"), "summary should name U2");
		assert.ok(summary.includes("92"), "summary should include temperature 92");
		assert.ok(
			summary.includes("hot") || summary.includes("fail"),
			"summary should indicate heat level",
		);
	});

	test("flags parts exceeding their rated limit", () => {
		const temps = { U1: 110, R1: 40 };
		const ratings = { U1: 100 };
		const summary = plainHeatSummary(temps, ratings);

		assert.ok(summary.includes("U1"));
		assert.ok(summary.includes("exceeding") || summary.includes("limit"));
	});

	test("provides friendly message when board is cool", () => {
		const temps = { R1: 28, R2: 30 };
		const summary = plainHeatSummary(temps);

		assert.ok(summary.includes("R2"));
		assert.ok(summary.includes("cool"));
	});
});

describe("heatLayer - 3D scene layer", () => {
	test("creates plane mesh with DataTexture and pulsing sprites for hot parts", () => {
		const scene = new THREE.Scene();
		const boardToScene = (x, y, z) => [x * 0.1, z * 0.1, y * 0.1];
		const layer = createHeatLayer(scene, { boardToScene });

		for (const fn of ["setGrid", "setVisible", "dispose"]) {
			assert.equal(typeof layer[fn], "function");
		}

		const grid = makeGrid({
			boardW: 40,
			placements: [
				{ x: 10, y: 10, tempC: 90, radiusMm: 3 },
				{ x: 30, y: 20, tempC: 50, radiusMm: 3 },
			],
		});

		layer.setGrid(grid);
		assert.equal(scene.children.length, 1);
		const root = scene.children[0];
		assert.ok(
			root.children.length >= 2,
			"root should contain plane mesh and hot sprite",
		);

		layer.update(0.1);
		layer.setVisible(false);
		assert.equal(root.visible, false);

		layer.dispose();
		assert.equal(scene.children.length, 0);
	});
});
