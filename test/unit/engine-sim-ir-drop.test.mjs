import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	runIrDrop,
	traceResistanceOhm,
} from "../../backend/src/engine/sim/ir-drop.js";

const DEFAULT_COMMIT = "a5f23c1b89ef";

const THRESHOLD_CASES = [
	{
		name: "thresholds: no issue below 80% of limit",
		limit: 1.0,
		expectedIssue: null,
	},
	{
		name: "thresholds: warning when total > 0.8 * limit and <= limit",
		limit: 0.22,
		expectedIssue: { severity: "warning", measured: 0.1935, limit: 0.22 },
	},
	{
		name: "thresholds: error when total > limit",
		limit: 0.15,
		expectedIssue: { severity: "error", measured: 0.1935, limit: 0.15 },
	},
];

function createTrack(overrides = {}) {
	return {
		id: newId("trace"),
		netId: newId("net"),
		lengthMm: 100,
		widthMm: 0.254,
		thicknessUm: 35,
		currentA: 1.0,
		...overrides,
	};
}

function calcResistance(overrides = {}) {
	return traceResistanceOhm({
		lengthMm: 100,
		widthMm: 0.254,
		...overrides,
	});
}

function execIrDrop(options = {}) {
	const { tracks = [], railLimits = {}, env, simRunId } = options;
	return runIrDrop({
		tracks,
		railLimits,
		commit: DEFAULT_COMMIT,
		...(env ? { env } : {}),
		...(simRunId ? { simRunId } : {}),
	});
}

describe("traceResistanceOhm", () => {
	test("hand-computed resistance matches known theoretical value within tolerance", () => {
		const r = calcResistance({ thicknessUm: 35, tempC: 20 });
		assert.ok(Math.abs(r - 0.19348) < 0.001, `expected ~0.1935 ohm, got ${r}`);
	});

	test("hotter temperature produces higher resistance", () => {
		const [r20, r50, r85] = [20, 50, 85].map((tempC) =>
			calcResistance({ tempC }),
		);
		for (const [lower, higher, label] of [
			[r20, r50, "50C resistance should exceed 20C resistance"],
			[r50, r85, "85C resistance should exceed 50C resistance"],
		]) {
			assert.ok(higher > lower, label);
		}
	});

	test("defaults thicknessUm to 35 and tempC to 20", () => {
		const rDefault = calcResistance();
		const rExplicit = calcResistance({ thicknessUm: 35, tempC: 20 });
		assert.equal(rDefault, rExplicit);
	});

	test("scales proportionally with geometry", () => {
		const baseGeom = { lengthMm: 50, widthMm: 0.5 };
		const base = traceResistanceOhm(baseGeom);
		const doubleLen = traceResistanceOhm({ ...baseGeom, lengthMm: 100 });
		const doubleWidth = traceResistanceOhm({ ...baseGeom, widthMm: 1.0 });
		const doubleThick = traceResistanceOhm({
			...baseGeom,
			thicknessUm: 70,
		});

		for (const [actual, expected] of [
			[doubleLen, 2 * base],
			[doubleWidth, base / 2],
			[doubleThick, base / 2],
		]) {
			assert.ok(Math.abs(actual - expected) < 1e-6);
		}
	});
});

describe("runIrDrop", () => {
	test("returns empty results and issues when tracks array is empty", () => {
		const out = execIrDrop({ tracks: [] });
		assert.deepEqual(out, { results: [], issues: [] });
	});

	test("computes IR drop per track and sums drops per net in series worst case", () => {
		const netId = newId("net");
		const track1 = createTrack({ netId });
		const track2 = createTrack({ netId });

		const out = execIrDrop({ tracks: [track1, track2] });

		assert.equal(out.results.length, 3);
		const rTrack1 = out.results.find((r) => r.itemId === track1.id);
		const rTrack2 = out.results.find((r) => r.itemId === track2.id);
		const rNet = out.results.find((r) => r.itemId === netId);

		assert.ok(rTrack1 && rTrack2 && rNet);
		for (const [entry, expected] of [
			[rTrack1, 0.1935],
			[rTrack2, 0.1935],
			[rNet, 0.387],
		]) {
			assert.equal(entry.value, expected);
		}
		assert.deepEqual(
			{ unit: rNet.unit, metric: rNet.metric },
			{ unit: "V", metric: "ir_drop" },
		);
	});

	test("evaluates temperature from env.ambientC.max", () => {
		const netId = newId("net");
		const track = createTrack({ netId });
		const envHot = {
			id: newId("env"),
			name: "Automotive Underhood",
			ambientC: { min: -40, max: 85 },
			humidityPct: { min: 5, max: 95 },
			altitudeM: 500,
		};

		const outHot = execIrDrop({ tracks: [track], env: envHot });
		const outDefault = execIrDrop({ tracks: [track] });

		const hotVal = outHot.results.find((r) => r.itemId === netId).value;
		const defaultVal = outDefault.results.find((r) => r.itemId === netId).value;
		assert.ok(hotVal > defaultVal);
	});

	test("handles nets without limits: results are present but no issues generated", () => {
		const netId = newId("net");
		const track = createTrack({ netId, lengthMm: 50, currentA: 2.0 });

		const out = execIrDrop({ tracks: [track] });

		assert.deepEqual(
			{ issues: out.issues.length, results: out.results.length },
			{ issues: 0, results: 2 },
		);
	});

	for (const tc of THRESHOLD_CASES) {
		test(tc.name, () => {
			const netId = newId("net");
			const track = createTrack({ netId });
			const out = execIrDrop({
				tracks: [track],
				railLimits: { [netId]: tc.limit },
			});
			if (!tc.expectedIssue) {
				assert.equal(out.issues.length, 0);
				return;
			}
			assert.equal(out.issues.length, 1);
			const [issue] = out.issues;
			assert.deepEqual(
				{
					severity: issue.severity,
					measured: issue.measured,
					limit: issue.limit,
				},
				tc.expectedIssue,
			);
		});
	}

	test("issues pass validateIssue and contain all specified fields", () => {
		const netId = newId("net");
		const track1 = createTrack({ netId });
		const track2 = createTrack({ netId });
		const simRunId = newId("sim");

		const out = execIrDrop({
			tracks: [track1, track2],
			railLimits: { [netId]: 0.1 },
			simRunId,
		});

		assert.equal(out.issues.length, 1);
		const [issue] = out.issues;
		const expectedFields = {
			source: "sim",
			severity: "error",
			itemIds: [netId, track1.id, track2.id],
			metric: "ir_drop",
			unit: "V",
			suggestion: "shorten or widen the path, or add a parallel copper pour",
			simRunId,
			commit: DEFAULT_COMMIT,
			status: "open",
		};
		for (const [key, val] of Object.entries(expectedFields)) {
			assert.deepEqual(issue[key], val);
		}
		assert.ok(typeof issue.message === "string" && issue.message.length > 0);

		const validation = validateIssue(issue);
		assert.deepEqual(validation, { ok: true, errors: [] });
	});
});
