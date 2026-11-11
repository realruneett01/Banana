import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	runIrDrop,
	traceResistanceOhm,
} from "../../backend/src/engine/sim/ir-drop.js";

const DEFAULT_COMMIT = "a5f23c1b89ef";

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

describe("traceResistanceOhm", () => {
	test("hand-computed resistance matches known theoretical value within tolerance", () => {
		const r = traceResistanceOhm({
			lengthMm: 100,
			widthMm: 0.254,
			thicknessUm: 35,
			tempC: 20,
		});
		assert.ok(Math.abs(r - 0.19348) < 0.001, `expected ~0.1935 ohm, got ${r}`);
	});

	test("hotter temperature produces higher resistance", () => {
		const r20 = traceResistanceOhm({
			lengthMm: 100,
			widthMm: 0.254,
			tempC: 20,
		});
		const r50 = traceResistanceOhm({
			lengthMm: 100,
			widthMm: 0.254,
			tempC: 50,
		});
		const r85 = traceResistanceOhm({
			lengthMm: 100,
			widthMm: 0.254,
			tempC: 85,
		});
		assert.ok(r50 > r20, "50C resistance should exceed 20C resistance");
		assert.ok(r85 > r50, "85C resistance should exceed 50C resistance");
	});

	test("defaults thicknessUm to 35 and tempC to 20", () => {
		const rDefault = traceResistanceOhm({ lengthMm: 100, widthMm: 0.254 });
		const rExplicit = traceResistanceOhm({
			lengthMm: 100,
			widthMm: 0.254,
			thicknessUm: 35,
			tempC: 20,
		});
		assert.equal(rDefault, rExplicit);
	});

	test("scales proportionally with geometry", () => {
		const base = traceResistanceOhm({ lengthMm: 50, widthMm: 0.5 });
		const doubleLen = traceResistanceOhm({ lengthMm: 100, widthMm: 0.5 });
		const doubleWidth = traceResistanceOhm({ lengthMm: 50, widthMm: 1.0 });
		const doubleThick = traceResistanceOhm({
			lengthMm: 50,
			widthMm: 0.5,
			thicknessUm: 70,
		});

		assert.ok(Math.abs(doubleLen - 2 * base) < 1e-6);
		assert.ok(Math.abs(doubleWidth - base / 2) < 1e-6);
		assert.ok(Math.abs(doubleThick - base / 2) < 1e-6);
	});
});

describe("runIrDrop", () => {
	test("returns empty results and issues when tracks array is empty", () => {
		const out = runIrDrop({
			tracks: [],
			railLimits: {},
			commit: DEFAULT_COMMIT,
		});
		assert.deepEqual(out, { results: [], issues: [] });
	});

	test("computes IR drop per track and sums drops per net in series worst case", () => {
		const netId = newId("net");
		const track1 = createTrack({ netId, lengthMm: 100, currentA: 1.0 });
		const track2 = createTrack({ netId, lengthMm: 100, currentA: 1.0 });

		const out = runIrDrop({
			tracks: [track1, track2],
			railLimits: {},
			commit: DEFAULT_COMMIT,
		});

		assert.equal(out.results.length, 3);
		const rTrack1 = out.results.find((r) => r.itemId === track1.id);
		const rTrack2 = out.results.find((r) => r.itemId === track2.id);
		const rNet = out.results.find((r) => r.itemId === netId);

		assert.ok(rTrack1 && rTrack2 && rNet);
		assert.equal(rTrack1.value, 0.1935);
		assert.equal(rTrack2.value, 0.1935);
		assert.equal(rNet.value, 0.387);
		assert.equal(rNet.unit, "V");
		assert.equal(rNet.metric, "ir_drop");
	});

	test("evaluates temperature from env.ambientC.max", () => {
		const netId = newId("net");
		const track = createTrack({ netId, lengthMm: 100, currentA: 1.0 });
		const envHot = {
			id: newId("env"),
			name: "Automotive Underhood",
			ambientC: { min: -40, max: 85 },
			humidityPct: { min: 5, max: 95 },
			altitudeM: 500,
		};

		const outHot = runIrDrop({
			tracks: [track],
			railLimits: {},
			env: envHot,
			commit: DEFAULT_COMMIT,
		});
		const outDefault = runIrDrop({
			tracks: [track],
			railLimits: {},
			commit: DEFAULT_COMMIT,
		});

		const hotVal = outHot.results.find((r) => r.itemId === netId).value;
		const defaultVal = outDefault.results.find((r) => r.itemId === netId).value;
		assert.ok(hotVal > defaultVal);
	});

	test("handles nets without limits: results are present but no issues generated", () => {
		const netId = newId("net");
		const track = createTrack({ netId, lengthMm: 50, currentA: 2.0 });

		const out = runIrDrop({
			tracks: [track],
			railLimits: {},
			commit: DEFAULT_COMMIT,
		});

		assert.equal(out.issues.length, 0);
		assert.equal(out.results.length, 2);
	});

	test("thresholds: no issue below 80% of limit", () => {
		const netId = newId("net");
		const track = createTrack({ netId, lengthMm: 100, currentA: 1.0 });
		const out = runIrDrop({
			tracks: [track],
			railLimits: { [netId]: 1.0 },
			commit: DEFAULT_COMMIT,
		});
		assert.equal(out.issues.length, 0);
	});

	test("thresholds: warning when total > 0.8 * limit and <= limit", () => {
		const netId = newId("net");
		const track = createTrack({ netId, lengthMm: 100, currentA: 1.0 });
		const out = runIrDrop({
			tracks: [track],
			railLimits: { [netId]: 0.22 },
			commit: DEFAULT_COMMIT,
		});

		assert.equal(out.issues.length, 1);
		const issue = out.issues[0];
		assert.equal(issue.severity, "warning");
		assert.equal(issue.measured, 0.1935);
		assert.equal(issue.limit, 0.22);
	});

	test("thresholds: error when total > limit", () => {
		const netId = newId("net");
		const track = createTrack({ netId, lengthMm: 100, currentA: 1.0 });
		const out = runIrDrop({
			tracks: [track],
			railLimits: { [netId]: 0.15 },
			commit: DEFAULT_COMMIT,
		});

		assert.equal(out.issues.length, 1);
		const issue = out.issues[0];
		assert.equal(issue.severity, "error");
		assert.equal(issue.measured, 0.1935);
		assert.equal(issue.limit, 0.15);
	});

	test("issues pass validateIssue and contain all specified fields", () => {
		const netId = newId("net");
		const track1 = createTrack({ netId });
		const track2 = createTrack({ netId });
		const simRunId = newId("sim");

		const out = runIrDrop({
			tracks: [track1, track2],
			railLimits: { [netId]: 0.1 },
			commit: DEFAULT_COMMIT,
			simRunId,
		});

		assert.equal(out.issues.length, 1);
		const issue = out.issues[0];

		assert.equal(issue.source, "sim");
		assert.equal(issue.severity, "error");
		assert.deepEqual(issue.itemIds, [netId, track1.id, track2.id]);
		assert.equal(issue.metric, "ir_drop");
		assert.equal(issue.unit, "V");
		assert.equal(
			issue.suggestion,
			"shorten or widen the path, or add a parallel copper pour",
		);
		assert.equal(issue.simRunId, simRunId);
		assert.equal(issue.commit, DEFAULT_COMMIT);
		assert.equal(issue.status, "open");
		assert.ok(typeof issue.message === "string" && issue.message.length > 0);

		const validation = validateIssue(issue);
		assert.deepEqual(validation, { ok: true, errors: [] });
	});
});
