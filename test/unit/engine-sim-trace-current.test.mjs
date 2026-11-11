import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { newId } from "../../backend/src/engine/ids.js";
import { validateIssue } from "../../backend/src/engine/issue.js";
import {
	maxCurrentA,
	runTraceCurrent,
} from "../../backend/src/engine/sim/trace-current.js";

const COMMIT_HASH = "e4d3c2b1a09876543210fedcba09876543210fed";

function makeEnv(maxAmbientC = 25) {
	return {
		altitudeM: 100,
		ambientC: { max: maxAmbientC, min: 20 },
		humidityPct: { max: 60, min: 30 },
		id: newId("env"),
		name: "Standard Lab",
	};
}

function makeTrack(overrides = {}) {
	return {
		currentA: 0.5,
		id: newId("trace"),
		layer: "F.Cu",
		thicknessUm: 35,
		widthMm: 0.254,
		...overrides,
	};
}

function simCurrent(tracks, options = {}) {
	const { env = makeEnv(25), simRunId, tempRiseC } = options;
	const runConfig = { commit: COMMIT_HASH, env, tracks };
	if (simRunId !== undefined) {
		runConfig.simRunId = simRunId;
	}
	if (tempRiseC !== undefined) {
		runConfig.tempRiseC = tempRiseC;
	}
	return runTraceCurrent(runConfig);
}

function checkFields(item, expectations) {
	for (const [key, value] of Object.entries(expectations)) {
		assert.equal(item[key], value);
	}
}

describe("maxCurrentA (IPC-2221)", () => {
	test("known IPC-2221 value: 0.254 mm wide, 35 um, external, dT 10 C gives ~1.0 A with tolerance", () => {
		const capacity = maxCurrentA({
			external: true,
			tempRiseC: 10,
			thicknessUm: 35,
			widthMm: 0.254,
		});
		const withinTolerance = capacity >= 0.8 && capacity <= 1.2;
		assert.ok(
			withinTolerance,
			`expected ~1.0 A with tolerance, got ${capacity}`,
		);
	});

	test("internal traces have lower capacity than external traces", () => {
		const opts = { tempRiseC: 10, thicknessUm: 35, widthMm: 0.5 };
		const external = maxCurrentA({ ...opts, external: true });
		const internal = maxCurrentA({ ...opts, external: false });
		assert.ok(internal < external);
		assert.equal(Math.round((internal / external) * 100) / 100, 0.5);
	});

	test("higher temperature rise and thicker copper increase current capacity", () => {
		const base = maxCurrentA({ tempRiseC: 10, thicknessUm: 35, widthMm: 0.5 });
		const elevatedCases = [
			{ tempRiseC: 20, thicknessUm: 35, widthMm: 0.5 },
			{ tempRiseC: 10, thicknessUm: 70, widthMm: 0.5 },
		];
		for (const params of elevatedCases) {
			assert.ok(maxCurrentA(params) > base);
		}
	});

	test("returns zero when inputs are non-positive or non-numbers", () => {
		const cases = [
			{ tempRiseC: 10, thicknessUm: 35, widthMm: 0 },
			{ tempRiseC: 10, thicknessUm: 35, widthMm: -0.5 },
			{ tempRiseC: 10, thicknessUm: 0, widthMm: 0.5 },
			{ tempRiseC: 0, thicknessUm: 35, widthMm: 0.5 },
			{ tempRiseC: -5, thicknessUm: 35, widthMm: 0.5 },
		];
		for (const c of cases) {
			assert.equal(maxCurrentA(c), 0);
		}
	});

	test("applies default parameter values when omitted", () => {
		const actual = maxCurrentA({ widthMm: 0.254 });
		const expected = maxCurrentA({
			external: true,
			tempRiseC: 10,
			thicknessUm: 35,
			widthMm: 0.254,
		});
		assert.equal(actual, expected);
	});
});

describe("runTraceCurrent", () => {
	test("identifies external vs internal layers", () => {
		const layers = ["F.Cu", "B.Cu", "In1.Cu"];
		const tracks = layers.map((layer) => makeTrack({ layer }));
		const { results } = simCurrent(tracks, { env: makeEnv(25) });

		assert.equal(results.length, 3);
		assert.equal(results[0].value, results[1].value);
		assert.ok(results[2].value < results[0].value);
	});

	test("hot ambient lowers effective dT and reduces current capacity", () => {
		const track = makeTrack({ widthMm: 0.5 });
		const coolRun = simCurrent([track], { env: makeEnv(25), tempRiseC: 20 });
		const hotRun = simCurrent([track], { env: makeEnv(100), tempRiseC: 20 });

		assert.ok(hotRun.results[0].value < coolRun.results[0].value);
	});

	test("effective dT <= 0 sets limit to 0 and flags currentA > 0 as error", () => {
		const activeTrack = makeTrack({ currentA: 1.2 });
		const idleTrack = makeTrack({ currentA: 0 });
		const { results, issues } = simCurrent([activeTrack, idleTrack], {
			env: makeEnv(105),
		});

		assert.equal(results[0].value, 0);
		assert.equal(results[1].value, 0);
		assert.equal(issues.length, 1);
		checkFields(issues[0], {
			limit: 0,
			measured: 1.2,
			severity: "error",
		});
	});

	test("thresholds: flags errors, warnings, and compliant tracks correctly", () => {
		const safeTrack = makeTrack({ currentA: 0.5 });
		const warnTrack = makeTrack({ currentA: 0.75 });
		const errorTrack = makeTrack({ currentA: 1.5 });

		const { issues } = simCurrent([safeTrack, warnTrack, errorTrack], {
			env: makeEnv(25),
			simRunId: newId("sim"),
		});

		assert.equal(issues.length, 2);
		const expectedChecks = [
			{ id: warnTrack.id, severity: "warning" },
			{ id: errorTrack.id, severity: "error" },
		];
		for (const [idx, exp] of expectedChecks.entries()) {
			assert.equal(issues[idx].severity, exp.severity);
			assert.equal(issues[idx].itemIds[0], exp.id);
		}
	});

	test("all generated issues pass validateIssue and adhere to issue contract", () => {
		const simRunId = newId("sim");
		const violatingTrack = makeTrack({ currentA: 2.5 });

		const { issues } = simCurrent([violatingTrack], {
			env: makeEnv(25),
			simRunId,
		});

		assert.equal(issues.length, 1);
		const [issue] = issues;
		checkFields(issue, {
			commit: COMMIT_HASH,
			metric: "current",
			simRunId,
			source: "sim",
			status: "open",
			suggestion: "widen the trace or use thicker copper",
			unit: "A",
		});

		const validation = validateIssue(issue);
		assert.equal(
			validation.ok,
			true,
			`Validation failed: ${validation.errors.join("; ")}`,
		);
	});

	test("handles empty tracks gracefully", () => {
		const { results, issues } = simCurrent([], { env: makeEnv(25) });
		assert.deepEqual(results, []);
		assert.deepEqual(issues, []);
	});
});
