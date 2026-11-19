import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ENV_PRESETS } from "../../frontend/src/components/envPresets.js";
import {
	envBadges,
	envToVisuals,
	MAX_AMPLITUDE_MM,
	worstCaseAmbient,
} from "../../frontend/src/components/sim3d/envVisuals.js";

function findPreset(key) {
	return ENV_PRESETS.find((p) => p.key === key);
}

function verifyVisualProps(vis, exp) {
	for (const [key, val] of Object.entries(exp)) {
		const actual = key in vis ? vis[key] : vis.shake?.[key];
		assert.equal(actual, val);
	}
}

const VISUAL_CASES = [
	{
		name: "returns safe defaults when env is null",
		env: null,
		expected: {
			droplets: 0,
			frost: false,
			heatShimmer: false,
			amplitudeMm: 0,
			frequencyHz: 0,
		},
		validate: (vis) => assert.ok(typeof vis.label === "string"),
	},
	{
		name: "maps automotive preset with shake, shimmer, frost and droplets",
		envKey: "automotive",
		expected: {
			frost: true,
			heatShimmer: true,
			frequencyHz: 10,
			label: "Inside a car on a hot day: up to 125 C and constant shaking",
		},
		validate: (vis) => {
			assert.ok(vis.droplets > 0);
			assert.ok(vis.shake.amplitudeMm > 0);
		},
	},
	{
		name: "maps office preset with no shake and clear visuals",
		envKey: "office",
		expected: {
			frost: false,
			heatShimmer: false,
			droplets: 0,
			amplitudeMm: 0,
		},
	},
	{
		name: "maps outdoor preset with high humidity droplets and frost",
		envKey: "outdoor",
		expected: {
			frost: true,
			heatShimmer: true,
			droplets: 100,
			amplitudeMm: 0,
		},
	},
	{
		name: "caps shake amplitude on extreme vibration",
		env: {
			vibration: { psdG2Hz: 20.0, fromHz: 10, toHz: 5000 },
		},
		expected: {
			amplitudeMm: MAX_AMPLITUDE_MM,
		},
		validate: (vis) => assert.ok(vis.shake.amplitudeMm <= 1.5),
	},
];

describe("envVisuals - worstCaseAmbient", () => {
	test("defaults to 25 when env is missing", () => {
		for (const input of [null, undefined, {}]) {
			assert.equal(worstCaseAmbient(input), 25);
		}
	});

	test("reads scalar and range ambientC", () => {
		assert.equal(worstCaseAmbient({ ambientC: 42 }), 42);
		assert.equal(worstCaseAmbient({ ambientC: { min: -20, max: 65 } }), 65);
	});

	test("resolves correct worst-case ambient for all presets", () => {
		const expected = {
			office: 40,
			automotive: 125,
			industrial: 85,
			outdoor: 70,
			aerospace: 125,
			"data-center": 35,
		};
		for (const [key, expMax] of Object.entries(expected)) {
			const preset = findPreset(key);
			assert.ok(preset, `preset ${key} should exist`);
			assert.equal(worstCaseAmbient(preset), expMax);
		}
	});
});

describe("envVisuals - envBadges", () => {
	test("returns empty badges for null or benign environment", () => {
		for (const env of [null, findPreset("office")]) {
			assert.deepEqual(envBadges(env), []);
		}
	});

	test("produces short chips for high stress conditions", () => {
		const customEnv = {
			ambientC: { min: 20, max: 75 },
			humidityPct: { min: 10, max: 92 },
			vibration: { psdG2Hz: 0.04, fromHz: 10, toHz: 2000 },
		};
		assert.deepEqual(envBadges(customEnv), ["Very hot", "Shaking", "Humid"]);
	});

	test("includes specific badges for presets", () => {
		const autoBadges = envBadges(findPreset("automotive"));
		for (const badge of ["Very hot", "Freezing", "Shaking", "Humid"]) {
			assert.ok(autoBadges.includes(badge));
		}

		assert.deepEqual(envBadges(findPreset("data-center")), ["Airflow"]);
		assert.ok(envBadges(findPreset("aerospace")).includes("High altitude"));
	});
});

describe("envVisuals - envToVisuals", () => {
	for (const tc of VISUAL_CASES) {
		test(tc.name, () => {
			const env = "env" in tc ? tc.env : findPreset(tc.envKey);
			const vis = envToVisuals(env);
			verifyVisualProps(vis, tc.expected);
			tc.validate?.(vis);
		});
	}
});
