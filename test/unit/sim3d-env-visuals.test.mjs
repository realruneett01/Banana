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

describe("envVisuals - worstCaseAmbient", () => {
	test("defaults to 25 when env is missing", () => {
		assert.equal(worstCaseAmbient(null), 25);
		assert.equal(worstCaseAmbient(undefined), 25);
		assert.equal(worstCaseAmbient({}), 25);
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
		assert.deepEqual(envBadges(null), []);
		const office = findPreset("office");
		assert.deepEqual(envBadges(office), []);
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
		const auto = findPreset("automotive");
		const autoBadges = envBadges(auto);
		assert.ok(autoBadges.includes("Very hot"));
		assert.ok(autoBadges.includes("Freezing"));
		assert.ok(autoBadges.includes("Shaking"));
		assert.ok(autoBadges.includes("Humid"));

		const dc = findPreset("data-center");
		assert.deepEqual(envBadges(dc), ["Airflow"]);

		const aero = findPreset("aerospace");
		assert.ok(envBadges(aero).includes("High altitude"));
	});
});

describe("envVisuals - envToVisuals", () => {
	test("returns safe defaults when env is null", () => {
		const vis = envToVisuals(null);
		assert.equal(vis.droplets, 0);
		assert.equal(vis.frost, false);
		assert.equal(vis.heatShimmer, false);
		assert.equal(vis.shake.amplitudeMm, 0);
		assert.equal(vis.shake.frequencyHz, 0);
		assert.ok(typeof vis.label === "string");
	});

	test("maps automotive preset with shake, shimmer, frost and droplets", () => {
		const auto = findPreset("automotive");
		const vis = envToVisuals(auto);
		assert.equal(vis.frost, true);
		assert.equal(vis.heatShimmer, true);
		assert.ok(vis.droplets > 0);
		assert.ok(vis.shake.amplitudeMm > 0);
		assert.equal(vis.shake.frequencyHz, 10);
		assert.equal(
			vis.label,
			"Inside a car on a hot day: up to 125 C and constant shaking",
		);
	});

	test("maps office preset with no shake and clear visuals", () => {
		const office = findPreset("office");
		const vis = envToVisuals(office);
		assert.equal(vis.frost, false);
		assert.equal(vis.heatShimmer, false);
		assert.equal(vis.droplets, 0);
		assert.equal(vis.shake.amplitudeMm, 0);
	});

	test("maps outdoor preset with high humidity droplets and frost", () => {
		const outdoor = findPreset("outdoor");
		const vis = envToVisuals(outdoor);
		assert.equal(vis.frost, true);
		assert.equal(vis.heatShimmer, true);
		assert.equal(vis.droplets, 100);
		assert.equal(vis.shake.amplitudeMm, 0);
	});

	test("caps shake amplitude on extreme vibration", () => {
		const extreme = {
			vibration: { psdG2Hz: 20.0, fromHz: 10, toHz: 5000 },
		};
		const vis = envToVisuals(extreme);
		assert.equal(vis.shake.amplitudeMm, MAX_AMPLITUDE_MM);
		assert.ok(vis.shake.amplitudeMm <= 1.5);
	});
});
